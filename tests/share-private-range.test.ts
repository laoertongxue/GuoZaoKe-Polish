import { afterEach, expect, it, vi } from 'vitest';
import { publicImageUrl, readShareImage } from '../src/site/share-images';
import { isPublicIpv4 } from '../src/site/network-address';
import { validatePublicUrl } from '../src/rating/providers';

afterEach(() => vi.unstubAllGlobals());

it('rejects every reserved and private IPv4 literal, including documentation ranges the reader used to miss', () => {
  for (const host of ['0.1.2.3', '10.1.2.3', '100.64.0.1', '127.0.0.1', '169.254.1.1', '172.16.0.1', '192.168.0.1', '192.0.0.5', '192.0.2.5', '192.88.99.1', '198.18.0.1', '198.51.100.7', '203.0.113.9', '224.0.0.1']) {
    expect(isPublicIpv4(host), host).toBe(false);
    expect(() => publicImageUrl(`https://${host}/a.png`), host).toThrow();
  }
});

it('accepts ordinary public IPv4 literals', () => {
  for (const host of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.63.255.1']) {
    expect(isPublicIpv4(host), host).toBe(true);
    expect(publicImageUrl(`https://${host}/a.png`).hostname).toBe(host);
  }
});

it('the provider boundary and the image reader share the same IPv4 table', () => {
  for (const host of ['198.51.100.7', '203.0.113.9', '192.0.2.5']) {
    expect(() => validatePublicUrl(`https://${host}/v1`)).toThrow();
  }
});

it('network failures and HTTP errors do not reveal the status code or host to the caller', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('secret internal body', { status: 503 })));
  let message = '';
  try { await readShareImage('https://image.example.com/a.png', async () => true); } catch (e) { message = (e as Error).message; }
  expect(message).toContain('读取图片失败');
  expect(message).not.toContain('503');
  expect(message).not.toContain('image.example.com');
});
