export interface ModelConfig {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  declaredVersion: string;
}
export interface ChatMessage { role: 'system' | 'user'; content: string }
export interface ChatResult {
  value: unknown;
  usage: { inputTokens: number | null; outputTokens: number | null };
  providerModel: string | null;
}
export interface ChatOptions {
  signal?: AbortSignal;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
  validate?: (value: unknown) => boolean;
}
export type ProviderErrorCode =
  | 'invalid_url' | 'invalid_config' | 'invalid_key' | 'invalid_request'
  | 'unauthorized' | 'rate_limited' | 'http_error' | 'network'
  | 'timeout' | 'cancelled' | 'too_large' | 'invalid_json' | 'schema' | 'output_truncated';

const ERROR_MESSAGES: Record<ProviderErrorCode, string> = {
  invalid_url: '地址必须是无账号、无片段的公开 HTTPS 地址。',
  invalid_config: '模型配置不完整或超出允许范围。',
  invalid_key: '请填写有效的 API key。',
  invalid_request: '分析请求格式无效或超出大小限制。',
  unauthorized: '模型服务拒绝了认证（401）。',
  rate_limited: '模型服务请求过于频繁（429）。',
  http_error: '模型服务返回了错误状态。',
  network: '无法连接模型服务，请检查服务地址与网络。',
  timeout: '模型请求超时。',
  cancelled: '模型请求已取消。',
  too_large: '模型响应超过允许的大小。',
  output_truncated: '模型回答达到输出上限，内容不完整。',
  invalid_json: '模型未返回有效的 JSON 对象。',
  schema: '模型返回内容不符合分析结构。',
};

/** Only fixed messages are exposed; never attach a remote body, URL, key, or cause. */
export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status: number | null;
  constructor(code: ProviderErrorCode, status: number | null = null) {
    super(ERROR_MESSAGES[code]);
    this.name = 'ProviderError';
    this.code = code;
    this.status = status;
  }
}

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function isPublicIpv4(host: string): boolean {
  const [a = 0, b = 0, c = 0] = host.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99)))
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    || (a === 203 && b === 0 && c === 113));
}

function isPublicIpv6(host: string): boolean {
  // URL has already parsed and canonicalized IPv6, including mapped IPv4.
  const [first = 0, second = 0] = host.slice(1, -1).split(':').map(word => Number.parseInt(word || '0', 16));
  // Conservatively allow ordinary global unicast only, excluding special-purpose,
  // documentation and 6to4 prefixes (which can embed a private IPv4 destination).
  return first >= 0x2000 && first <= 0x3fff && first !== 0x2002 && first !== 0x3fff
    && !(first === 0x2001 && (second < 0x200 || second === 0xdb8));
}

/**
 * Shared by provider configuration and evidence URLs. Evidence queries are allowed.
 * This is a syntactic public-address boundary, not a DNS resolver: a public-looking
 * hostname can resolve or rebind to an internal address. Browser fetch offers no
 * resolved-IP pinning; callers must deny redirects and must not add a server proxy.
 */
export function validatePublicUrl(input: string): URL {
  if (typeof input !== 'string' || input.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(input) || input.includes('#')) {
    throw new ProviderError('invalid_url');
  }
  let url: URL;
  try { url = new URL(input); } catch { throw new ProviderError('invalid_url'); }
  const authority = input.match(/^https:\/\/([^/?#]+)/i)?.[1];
  if (url.protocol !== 'https:' || !authority || authority.includes('@') || authority.includes('%') || url.username || url.password) {
    throw new ProviderError('invalid_url');
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[')) {
    if (!isPublicIpv6(host)) throw new ProviderError('invalid_url');
  } else if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    // Reject decimal, octal, hex and shortened numeric host spellings, even if the
    // URL parser normalizes them into an otherwise public IPv4 address.
    if (authority.split(':')[0] !== host || !isPublicIpv4(host)) throw new ProviderError('invalid_url');
  } else {
    const labels = host.split('.');
    if (host.length > 253 || labels.length < 2
      || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
      || /(?:^|\.)(?:localhost|local|localdomain|internal|lan|home|test|invalid|example|onion)$/.test(host)
      || host === 'home.arpa' || host.endsWith('.home.arpa')) throw new ProviderError('invalid_url');
  }
  return url;
}

function configString(value: unknown, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value) || (!allowEmpty && !value.trim())) {
    throw new ProviderError('invalid_config');
  }
  return value.trim();
}

export function normalizeModelConfig(input: unknown): ModelConfig {
  if (!isObject(input)) throw new ProviderError('invalid_config');
  const id = configString(input.id, 100);
  const name = configString(input.name, 100);
  const model = configString(input.model, 200);
  const declaredVersion = configString(input.declaredVersion, 200, true);
  const base = configString(input.baseUrl, 2048);
  if (base.includes('?')) throw new ProviderError('invalid_config');
  const url = validatePublicUrl(base);
  const { temperature, maxOutputTokens } = input;
  if (typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < 0 || temperature > 2
    || typeof maxOutputTokens !== 'number' || !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 32768) {
    throw new ProviderError('invalid_config');
  }
  return { id, name, baseUrl: url.href.replace(/\/+$/, ''), model, temperature, maxOutputTokens, declaredVersion };
}

function requestMessages(messages: ChatMessage[]): ChatMessage[] {
  if (!Array.isArray(messages) || !messages.length || messages.length > 64) throw new ProviderError('invalid_request');
  let length = 0;
  return messages.map(message => {
    if (!isObject(message) || (message.role !== 'system' && message.role !== 'user') || typeof message.content !== 'string' || !message.content.trim()) {
      throw new ProviderError('invalid_request');
    }
    length += message.content.length;
    if (length > 1024 * 1024) throw new ProviderError('invalid_request');
    return { role: message.role, content: message.content };
  });
}

function parseCompletion(text: string, validate?: ChatOptions['validate']): ChatResult {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new ProviderError('invalid_json'); }
  if (!isObject(raw) || !Array.isArray(raw.choices)) throw new ProviderError('invalid_json');
  const choice: unknown = raw.choices[0];
  if (isObject(choice) && choice.finish_reason === 'length') throw new ProviderError('output_truncated');
  if (isObject(choice) && (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'function_call')) throw new ProviderError('invalid_json');
  const message = isObject(choice) ? choice.message : undefined;
  if (!isObject(message) || message.role !== 'assistant' || typeof message.content !== 'string'
    || (message.tool_calls != null && (!Array.isArray(message.tool_calls) || message.tool_calls.length > 0))
    || message.function_call != null) throw new ProviderError('invalid_json');
  let content = message.content.trim();
  // Only unwrap one complete standard JSON/unlabelled fence. No prose extraction,
  // repair, evaluation, tool execution or second request is attempted.
  const fenced = content.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  if (fenced) content = fenced[1]!;
  let value: unknown;
  try { value = JSON.parse(content); } catch { throw new ProviderError('invalid_json'); }
  if (!isObject(value)) throw new ProviderError('invalid_json');
  if (validate) {
    try { if (validate(value) !== true) throw new ProviderError('schema'); }
    catch { throw new ProviderError('schema'); }
  }
  const tokenCount = (count: unknown) => typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : null;
  const usage = isObject(raw.usage) ? raw.usage : {};
  return {
    value,
    usage: { inputTokens: tokenCount(usage.prompt_tokens), outputTokens: tokenCount(usage.completion_tokens) },
    // Both this alias and config.declaredVersion are claims, not a pinned backend version.
    providerModel: typeof raw.model === 'string' && raw.model.trim() && raw.model.length <= 200 ? raw.model.trim() : null,
  };
}

function interruptible<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new ProviderError(signal.reason === 'timeout' ? 'timeout' : 'cancelled'));
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    if (signal.aborted) onAbort();
  });
}

export async function chatCompletion(config: ModelConfig, key: string, messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
  const normalized = normalizeModelConfig(config);
  if (typeof key !== 'string' || !key.trim() || key.length > 8192 || /[^\x20-\x7e]/.test(key) || /\s/.test(key.trim())) throw new ProviderError('invalid_key');
  const endpoint = new URL(normalized.baseUrl);
  if (!endpoint.pathname.endsWith('/chat/completions')) endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, '')}/chat/completions`;
  const body = JSON.stringify({
    model: normalized.model, messages: requestMessages(messages), temperature: normalized.temperature,
    max_tokens: normalized.maxOutputTokens, response_format: { type: 'json_object' }, stream: false,
  });
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000
    || !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > MAX_RESPONSE_BYTES) throw new ProviderError('invalid_request');
  if (options.signal?.aborted) throw new ProviderError('cancelled');
  const controller = new AbortController();
  const onAbort = () => controller.abort('cancelled');
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort('timeout'), timeoutMs);
  let response: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let complete = false;
  try {
    const request = (options.fetch ?? globalThis.fetch)(endpoint.href, {
      method: 'POST', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.trim()}` },
      body, signal: controller.signal,
    }).then(result => {
      // An injected transport may settle after cancellation; release its late body too.
      if (controller.signal.aborted) void result.body?.cancel().catch(() => {});
      // Retain ownership before the interruptible handoff: cancellation can win
      // between these microtasks. Already-cancelled late bodies stay out of finally.
      else response = result;
      return result;
    });
    response = await interruptible(request, controller.signal);
    if (response.redirected || (response.url && new URL(response.url).origin !== endpoint.origin)) throw new ProviderError('network');
    if (!response.ok) {
      const code = response.status === 401 ? 'unauthorized' : response.status === 429 ? 'rate_limited' : 'http_error';
      throw new ProviderError(code, response.status);
    }
    const declaredLength = response.headers.get('content-length');
    if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > maxResponseBytes) throw new ProviderError('too_large');
    if (!response.body) throw new ProviderError('invalid_json');
    reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let text = '', bytes = 0;
    while (true) {
      const chunk = await interruptible(reader.read(), controller.signal);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxResponseBytes) throw new ProviderError('too_large');
      try { text += decoder.decode(chunk.value, { stream: true }); } catch { throw new ProviderError('invalid_json'); }
    }
    try { text += decoder.decode(); } catch { throw new ProviderError('invalid_json'); }
    const result = parseCompletion(text, options.validate);
    complete = true;
    return result;
  } catch (error) {
    if (controller.signal.aborted) throw new ProviderError(controller.signal.reason === 'timeout' ? 'timeout' : 'cancelled');
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('network');
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onAbort);
    if (!complete) {
      controller.abort('cancelled');
      // Do not await a remote/custom stream's cancel callback; it may never settle.
      if (reader) void reader.cancel().catch(() => {});
      else void response?.body?.cancel().catch(() => {});
    }
    reader?.releaseLock();
  }
}
