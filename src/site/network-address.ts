/**
 * Syntactic public-address checks shared by the share-image reader and provider configuration.
 * These inspect the host text only. They are not a DNS resolver: a public-looking hostname can
 * still resolve to an internal address, and the MV3 service worker has no API to pin resolved IPs.
 */

/** `host` must be a dotted-quad IPv4 literal. Reserved, private, shared and documentation ranges are not public. */
export function isPublicIpv4(host: string): boolean {
  const [a = 0, b = 0, c = 0] = host.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99)))
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    || (a === 203 && b === 0 && c === 113));
}

/** `host` is a bracketed IPv6 literal as produced by the URL parser. */
export function isPublicIpv6(host: string): boolean {
  // URL has already parsed and canonicalized IPv6, including mapped IPv4.
  const [first = 0, second = 0] = host.slice(1, -1).split(':').map(word => Number.parseInt(word || '0', 16));
  // Conservatively allow ordinary global unicast only, excluding special-purpose,
  // documentation and 6to4 prefixes (which can embed a private IPv4 destination).
  return first >= 0x2000 && first <= 0x3fff && first !== 0x2002 && first !== 0x3fff
    && !(first === 0x2001 && (second < 0x200 || second === 0xdb8));
}
