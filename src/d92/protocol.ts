// Pure CRT protocol helpers for the MiraBox D92 (no I/O).
// Command bytes are inherited from the StreamDock 293 (see src/streamdock.ts)
// and confirmed against the D92 during probing.

export const CMD_PREFIX = [0x43, 0x52, 0x54, 0x00, 0x00]; // "CRT\0\0"
export const PACKET_SIZE = 512;
export const DEFAULT_REPORT_ID = 0x00;

/** Big-endian length as a byte array (default 4 bytes). */
export function sizeBytes(size: number, bytes = 4): number[] {
  const hex = size.toString(16).padStart(bytes * 2, "0");
  return [...Buffer.from(hex, "hex")];
}

/** Build a full 512-byte CRT command packet: prefix + body, zero-padded. */
export function packet(body: number[]): Buffer {
  const head = Buffer.from([...CMD_PREFIX, ...body]);
  if (head.length > PACKET_SIZE) {
    throw new Error(`command too long: ${head.length} > ${PACKET_SIZE}`);
  }
  return Buffer.concat([head, Buffer.alloc(PACKET_SIZE - head.length)]);
}

/** Prepend the HID report id required by hidapi writes. */
export function frame(pkt: Buffer, reportId = DEFAULT_REPORT_ID): Buffer {
  return Buffer.concat([Buffer.from([reportId]), pkt]);
}

/** Split a buffer into PACKET_SIZE chunks; the last chunk is zero-padded. */
export function chunk(data: Buffer, size = PACKET_SIZE): Buffer[] {
  const out: Buffer[] = [];
  for (let off = 0; off < data.length; off += size) {
    const slice = data.subarray(off, Math.min(off + size, data.length));
    out.push(slice.length < size ? Buffer.concat([slice, Buffer.alloc(size - slice.length)]) : slice);
  }
  return out;
}

/** Known CRT command bodies (without prefix/padding). */
export const Commands = {
  brightness: (value: number) => [0x4c, 0x49, 0x47, 0x00, 0x00, value], // LIG
  clear: (target: number) => [0x43, 0x4c, 0x45, 0x00, 0x00, 0x00, target], // CLE
  wake: () => [0x44, 0x49, 0x53, 0x00, 0x00], // DIS
  refresh: () => [0x53, 0x54, 0x50, 0x00, 0x00], // STP
  keyImage: (size: number, keyId: number) => [0x42, 0x41, 0x54, ...sizeBytes(size), keyId], // BAT
  logo: () => [0x4c, 0x4f, 0x47, 0x00, 0x11, 0x94, 0x00, 0x01], // LOG
};