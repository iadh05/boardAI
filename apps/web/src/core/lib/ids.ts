/**
 * A random v4 UUID.
 *
 * `crypto.randomUUID()` only exists in secure contexts (https, localhost). Opening the dev
 * server from a phone on the LAN (http://192.168.x.x) is not one, so fall back to
 * `crypto.getRandomValues()`, which is available everywhere.
 */
export const createId = (): string => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  // Per RFC 9562: version 4 in byte 6, variant 10xx in byte 8. Both bytes exist (length 16).
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
