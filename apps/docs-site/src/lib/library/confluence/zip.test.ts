// The export zip: a valid archive (local headers, central directory, end record) whose entries read back intact.
import { inflateRawSync, deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { crc32, zipFiles } from './zip';

/** Reads a zip from its central directory, as an unzip tool does. */
function unzip(buf: Uint8Array): Record<string, string> {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const end = buf.length - 22;
  expect(v.getUint32(end, true)).toBe(0x06054b50);
  const count = v.getUint16(end + 10, true);
  let at = v.getUint32(end + 16, true);
  const out: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(at, true)).toBe(0x02014b50);
    const method = v.getUint16(at + 10, true);
    const crc = v.getUint32(at + 16, true);
    const size = v.getUint32(at + 20, true);
    const nameLen = v.getUint16(at + 28, true);
    const local = v.getUint32(at + 42, true);
    const name = new TextDecoder().decode(buf.subarray(at + 46, at + 46 + nameLen));
    const localName = v.getUint16(local + 26, true);
    const start = local + 30 + localName;
    const body = buf.subarray(start, start + size);
    const data = method === 8 ? new Uint8Array(inflateRawSync(body)) : body;
    expect(crc32(data)).toBe(crc);
    out[name] = new TextDecoder().decode(data);
    at += 46 + nameLen;
  }
  return out;
}

describe('zipFiles', () => {
  const enc = new TextEncoder();
  it('crc32 matches the reference value', () => {
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
  });
  it('stores and deflates entries that read back intact, UTF-8 names included', () => {
    const files = { 'index.md': '# Index\n', 'components/button.md': `# Button\n${'Long line. '.repeat(200)}`, 'foundations/crème.md': 'é' };
    const zip = zipFiles(Object.entries(files).map(([path, s]) => ({ path, data: enc.encode(s) })), { day: '2026-10-31', deflate: (d) => new Uint8Array(deflateRawSync(d)) });
    expect(unzip(zip)).toEqual(files);
    expect(zip.length).toBeLessThan(files['components/button.md'].length);
  });
  it('works without a compressor', () => {
    const zip = zipFiles([{ path: 'a.md', data: enc.encode('a') }], { day: '2026-10-31' });
    expect(unzip(zip)).toEqual({ 'a.md': 'a' });
  });
});
