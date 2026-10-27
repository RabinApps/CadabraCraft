/** Non-cryptographic 64-bit style hash (two FNV-1a lanes). Used only as a cache key, so collisions just mean a re-render. */
export function contentHash(...parts: string[]): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x9747b28c;
  for (const ch of parts.join("\u0000")) {
    const c = ch.codePointAt(0) ?? 0;
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x85ebca6b) >>> 0;
    b = (b ^ (b >>> 13)) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}
