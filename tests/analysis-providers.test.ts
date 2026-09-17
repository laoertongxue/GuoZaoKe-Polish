// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatCompletion, normalizeModelConfig, ProviderError, validatePublicUrl, type ModelConfig } from '../src/analysis/providers';

const config: ModelConfig = {
  id: 'personal', name: '个人 AI', baseUrl: 'https://api.example.com/v1', model: 'my-model',
  temperature: 0, maxOutputTokens: 4096, declaredVersion: '2026-09',
};
const key = 'test-only-secret-never-send';
const messages = [{ role: 'user' as const, content: 'Return a JSON object.' }];
const envelope = (content: unknown = '{"ok":true}', extra: Record<string, unknown> = {}) => ({
  choices: [{ message: { role: 'assistant', content } }], ...extra,
});
const respond = (value: unknown = envelope()) => vi.fn<typeof fetch>(async () => new Response(JSON.stringify(value)));
const call = (fetch: typeof globalThis.fetch, options: Parameters<typeof chatCompletion>[3] = {}) => chatCompletion(config, key, messages, { fetch, ...options });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('public HTTPS URL boundary', () => {
  it.each([
    'http://api.example.com', 'https://user:pass@api.example.com', 'https://api.example.com/#secret',
    'https://localhost', 'https://localhost.', 'https://a.localhost', 'https://printer.local',
    'https://router.internal', 'https://router.home.arpa', 'https://home.arpa', 'https://intranet',
    'https://127.0.0.1', 'https://127.1', 'https://2130706433', 'https://0x7f000001', 'https://0177.0.0.1',
    'https://0.0.0.0', 'https://10.4.5.6', 'https://100.64.0.1', 'https://169.254.169.254',
    'https://172.16.0.1', 'https://172.31.255.255', 'https://192.168.0.1', 'https://192.0.0.8',
    'https://192.0.2.2', 'https://192.88.99.1', 'https://198.18.0.1', 'https://198.51.100.1',
    'https://203.0.113.1', 'https://224.0.0.1', 'https://255.255.255.255',
    'https://[::1]', 'https://[::]', 'https://[fc00::1]', 'https://[fd00::1]', 'https://[fe80::1]',
    'https://[::ffff:127.0.0.1]', 'https://[::ffff:8.8.8.8]', 'https://[64:ff9b::a00:1]',
    'https://[2002:0a00:0001::1]', 'https://[2001::1]', 'https://[2001:db8::1]', 'https://[ff02::1]',
    'https://%31%32%37.0.0.1', 'https://134744072', 'https://0x08080808',
    'https://api.example.com\\@127.0.0.1', 'https://api.exam\nple.com', 'https://bad_label.example.com',
  ])('rejects unsafe or ambiguous URL %s', input => {
    expect(() => validatePublicUrl(input)).toThrow(ProviderError);
  });

  it.each(['https://api.example.com/v1', 'https://8.8.8.8/', 'https://[2606:4700:4700::1111]/'])('accepts public destination %s', input => {
    expect(validatePublicUrl(input).protocol).toBe('https:');
  });

  it('preserves a public evidence URL query without permitting a fragment', () => {
    expect(validatePublicUrl('https://data.example.com/report?year=2026').search).toBe('?year=2026');
  });
});

describe('model configuration', () => {
  it('normalizes fields and discards credentials and unknown properties', () => {
    const result = normalizeModelConfig({ ...config, name: '  个人 AI  ', model: ' my-model ', baseUrl: 'https://API.example.com/v1///', key });
    expect(result).toEqual({ ...config, baseUrl: 'https://api.example.com/v1', model: 'my-model' });
    expect(JSON.stringify(result)).not.toContain(key);
  });

  it.each([
    null, [], {}, { ...config, baseUrl: 'https://api.example.com/v1?key=secret' },
    { ...config, baseUrl: 'https://api.example.com/v1?' }, { ...config, baseUrl: 'https://api.example.com/v1#' },
    { ...config, model: ' ' }, { ...config, model: 'x'.repeat(201) },
    { ...config, name: 'x'.repeat(101) }, { ...config, id: 'x'.repeat(101) },
    { ...config, declaredVersion: 'x'.repeat(201) }, { ...config, baseUrl: 'https://api.example.com/' + 'x'.repeat(2048) },
    { ...config, temperature: NaN }, { ...config, temperature: -1 }, { ...config, temperature: 2.1 },
    { ...config, maxOutputTokens: 0 }, { ...config, maxOutputTokens: 1.5 }, { ...config, maxOutputTokens: 32769 },
  ])('rejects invalid configuration %#', input => expect(() => normalizeModelConfig(input)).toThrow(ProviderError));
});

describe('JSON completion transport', () => {
  it.each(['https://api.example.com/v1', 'https://api.example.com/v1/chat/completions', 'https://api.example.com/v1/chat/completions/'])('posts only to the configured endpoint from %s', async baseUrl => {
    let request: Request | undefined;
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      request = new Request(input, init);
      return new Response(JSON.stringify(envelope()));
    });
    expect(await chatCompletion({ ...config, baseUrl }, key, messages, { fetch })).toEqual({
      value: { ok: true }, usage: { inputTokens: null, outputTokens: null }, providerModel: null,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(request!.url).toBe('https://api.example.com/v1/chat/completions');
    expect(request!.method).toBe('POST');
    expect(request!.credentials).toBe('omit');
    expect(request!.redirect).toBe('error');
    expect(request!.referrerPolicy).toBe('no-referrer');
    expect(request!.headers.get('authorization')).toBe(`Bearer ${key}`);
    expect(request!.headers.get('content-type')).toBe('application/json');
    expect(await request!.json()).toEqual({
      model: config.model, messages, temperature: 0, max_tokens: 4096,
      response_format: { type: 'json_object' }, stream: false,
    });
  });

  it('returns valid usage and provider model as unverified response metadata', async () => {
    expect(await call(respond(envelope('{"ok":true}', {
      usage: { prompt_tokens: 23, completion_tokens: 17 }, model: 'server-model-alias',
    })))).toEqual({ value: { ok: true }, usage: { inputTokens: 23, outputTokens: 17 }, providerModel: 'server-model-alias' });
  });

  it('leaves missing or invalid token counts unknown', async () => {
    expect((await call(respond(envelope('{"ok":true}', {
      usage: { prompt_tokens: -1, completion_tokens: '23' }, model: '',
    })))).usage).toEqual({ inputTokens: null, outputTokens: null });
  });

  it.each(['```json\n{"ok":true}\n```', '```\n{"ok":true}\n```', ' \n{"ok":true}\n '])('accepts only a complete JSON object or complete JSON fence %#', async content => {
    expect((await call(respond(envelope(content)))).value).toEqual({ ok: true });
  });

  it.each(['', 'plain text', '[]', 'null', '42', '"text"', 'Here is the result: {"ok":true}', '```javascript\n{"ok":true}\n```', '```json\n{"ok":true}\n``` trailing', '{"ok":'])('rejects non-object or malformed assistant content %#', async content => {
    await expect(call(respond(envelope(content)))).rejects.toMatchObject({ code: 'invalid_json' });
  });

  it.each([
    {}, { choices: [] }, envelope(null), envelope([{ type: 'text', text: '{}' }]),
    { choices: [{ message: { role: 'user', content: '{}' } }] },
    { choices: [{ message: { role: 'assistant', content: '{}', tool_calls: [{ id: 'call', type: 'function' }] } }] },
    { choices: [{ message: { role: 'assistant', content: '{}', function_call: { name: 'execute' } } }] },
    { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: '{}' } }] },
    { choices: [{ finish_reason: 'function_call', message: { role: 'assistant', content: '{}' } }] },
  ])('rejects missing assistant JSON and tool requests %#', async value => {
    await expect(call(respond(value))).rejects.toMatchObject({ code: 'invalid_json' });
  });

  it('rejects non-JSON transport envelopes without exposing server text', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(`private-server-body ${key}`));
    await expect(call(fetch)).rejects.toMatchObject({ code: 'invalid_json' });
    await expect(call(fetch)).rejects.not.toThrow('private-server-body');
  });

  it('applies optional schema validation and sanitizes validator failures', async () => {
    await expect(call(respond(), { validate: value => typeof value === 'object' && value !== null && 'required' in value })).rejects.toMatchObject({ code: 'schema' });
    await expect(call(respond(), { validate: () => { throw new Error(key); } })).rejects.toMatchObject({ code: 'schema' });
    expect((await call(respond(), { validate: () => true })).value).toEqual({ ok: true });
  });

  it.each([[401, 'unauthorized'], [429, 'rate_limited'], [500, 'http_error'], [302, 'http_error']] as const)('returns safe code and status for HTTP %i', async (status, code) => {
    const cancel = vi.fn();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(new ReadableStream({ cancel }), { status }));
    const error = await call(fetch).catch(error => error);
    expect(error).toMatchObject({ code, status });
    expect(error.message).not.toContain(key);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('sanitizes network errors including the key, URL query, and raw remote error', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => { throw new Error(`${key} https://api.example.com/v1?private=query private-server-body`); });
    const error = await call(fetch).catch(error => error);
    expect(error).toMatchObject({ code: 'network', status: null });
    expect(`${error.message} ${JSON.stringify(error)}`).not.toMatch(/test-only-secret|private=query|private-server-body/);
  });

  it('rejects invalid destination and key before fetching', async () => {
    const fetch = respond();
    await expect(chatCompletion({ ...config, baseUrl: 'http://localhost' }, key, messages, { fetch })).rejects.toBeInstanceOf(ProviderError);
    await expect(chatCompletion(config, 'bad\r\nkey', messages, { fetch })).rejects.toMatchObject({ code: 'invalid_key' });
    await expect(chatCompletion(config, '', messages, { fetch })).rejects.toMatchObject({ code: 'invalid_key' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { timeoutMs: 0 }, { timeoutMs: NaN }, { timeoutMs: 300001 },
    { maxResponseBytes: 0 }, { maxResponseBytes: 2 * 1024 * 1024 + 1 },
  ])('rejects invalid resource limits before fetching %#', async options => {
    const fetch = respond();
    await expect(call(fetch, options)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects empty, excessive and oversized messages before fetching', async () => {
    const fetch = respond();
    for (const input of [[], Array.from({ length: 65 }, () => messages[0]!), [{ role: 'user' as const, content: 'x'.repeat(1024 * 1024 + 1) }]]) {
      await expect(chatCompletion(config, key, input, { fetch })).rejects.toMatchObject({ code: 'invalid_request' });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { redirected: true, url: 'https://api.example.com/v1/chat/completions' },
    { redirected: false, url: 'https://other.example.com/v1/chat/completions?private=query' },
  ])('rejects a transport that reports a redirected or different origin %#', async properties => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }));
    for (const [name, value] of Object.entries(properties)) Object.defineProperty(response, name, { value });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response);
    await expect(call(fetch)).rejects.toMatchObject({ code: 'network' });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects injected tool roles and unknown request properties', async () => {
    const fetch = respond();
    await expect(chatCompletion(config, key, [{ role: 'tool', content: 'execute' }] as never, { fetch })).rejects.toMatchObject({ code: 'invalid_request' });
    await chatCompletion(config, key, [{ role: 'user', content: 'JSON', tool_calls: ['execute'] }] as never, { fetch });
    const init = fetch.mock.calls[0]![1]!;
    expect(JSON.parse(String(init.body)).messages).toEqual([{ role: 'user', content: 'JSON' }]);
  });
});

describe('response bounds and interruption', () => {
  it('rejects excessive Content-Length before reading and releases the body', async () => {
    const cancel = vi.fn();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(new ReadableStream({ cancel }), { headers: { 'Content-Length': String(2 * 1024 * 1024 + 1) } }));
    await expect(call(fetch)).rejects.toMatchObject({ code: 'too_large' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('measures streamed bytes even when Content-Length understates the response', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(21)); }, cancel });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(body, { headers: { 'Content-Length': '1' } }));
    await expect(call(fetch, { maxResponseBytes: 20 })).rejects.toMatchObject({ code: 'too_large' });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });

  it('enforces the default 2 MiB bound without a Content-Length header', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(new Uint8Array(2 * 1024 * 1024 + 1)));
    await expect(call(fetch)).rejects.toMatchObject({ code: 'too_large' });
  });

  it('decodes a multibyte character split across stream chunks', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(envelope('{"text":"中文"}')));
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(new ReadableStream({ start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    } })));
    expect((await call(fetch, { maxResponseBytes: bytes.length })).value).toEqual({ text: '中文' });
  });

  it('rejects malformed UTF-8 instead of replacing bytes inside assistant JSON', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(new Uint8Array([0xc3, 0x28])));
    await expect(call(fetch)).rejects.toMatchObject({ code: 'invalid_json' });
  });

  it('sanitizes a stream read failure and releases its reader', async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error(key)); } });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(body));
    const error = await call(fetch).catch(error => error);
    expect(error).toMatchObject({ code: 'network' });
    expect(error.message).not.toContain(key);
    expect(body.locked).toBe(false);
  });

  it('does not fetch for an already cancelled operation', async () => {
    const controller = new AbortController(); controller.abort(new Error(key));
    const fetch = respond();
    await expect(call(fetch, { signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('times out a hung fetch and aborts the actual request signal', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetch = vi.fn<typeof globalThis.fetch>((_, init) => { signal = init!.signal!; return new Promise(() => {}); });
    const pending = call(fetch, { timeoutMs: 10 }).catch(error => error);
    await vi.advanceTimersByTimeAsync(11);
    expect(await pending).toMatchObject({ code: 'timeout' });
    expect(signal!.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['timeout', 'cancelled'] as const)('releases a reader blocked mid-stream on %s', async reason => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); }, cancel });
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(body));
    const pending = call(fetch, { signal: controller.signal, timeoutMs: 20 }).catch(error => error);
    await vi.advanceTimersByTimeAsync(1);
    if (reason === 'cancelled') controller.abort(new Error(key));
    else await vi.advanceTimersByTimeAsync(20);
    expect(await pending).toMatchObject({ code: reason });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans timeout and caller abort listener after successful completion', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    await call(respond(), { signal: controller.signal });
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    expect(controller.signal.aborted).toBe(false);
  });

  it('releases a response cancelled between fetch settlement and response handoff', async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const cancelBody = vi.spyOn(body, 'cancel');
    const response = new Response(body);
    const fetch = vi.fn<typeof globalThis.fetch>(() => {
      const ready = Promise.resolve(response);
      void ready.then(() => queueMicrotask(() => controller.abort()));
      return ready;
    });
    await expect(call(fetch, { signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' });
    expect(cancelBody).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });

  it('cancels only once when the caller aborts before fetch settlement', async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const cancelBody = vi.spyOn(body, 'cancel');
    const fetch = vi.fn<typeof globalThis.fetch>(() => {
      controller.abort();
      return Promise.resolve(new Response(body));
    });
    await expect(call(fetch, { signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' });
    expect(cancelBody).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('cancels a response that arrives after fetch has already timed out', async () => {
    vi.useFakeTimers();
    let settle!: (response: Response) => void;
    const cancel = vi.fn();
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise(resolve => { settle = resolve; }));
    const pending = call(fetch, { timeoutMs: 10 }).catch(error => error);
    await vi.advanceTimersByTimeAsync(11);
    expect(await pending).toMatchObject({ code: 'timeout' });
    const body = new ReadableStream<Uint8Array>({ cancel });
    const cancelBody = vi.spyOn(body, 'cancel');
    settle(new Response(body));
    await vi.advanceTimersByTimeAsync(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancelBody).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not wait for a hung stream cancel callback', async () => {
    vi.useFakeTimers();
    const body = new ReadableStream<Uint8Array>({ cancel: () => new Promise(() => {}) });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(body));
    const pending = call(fetch, { timeoutMs: 10 }).catch(error => error);
    await vi.advanceTimersByTimeAsync(11);
    expect(await pending).toMatchObject({ code: 'timeout' });
    expect(body.locked).toBe(false);
  });
});
