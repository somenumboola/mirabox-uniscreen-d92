// Pure CRT protocol for the MiraBox D92 telemetry screen (no I/O, transport-agnostic).
//
// Reverse-engineered from the vendor library SDLibrary1.dll + live probing.
// See docs/superpowers/notes/d92-protocol-findings.md for the full derivation.
//
// Confirmed facts:
//   - Device: VID 0x5548 / PID 0x1011, vendor HID (UsagePage 0xFFA0), report id 0.
//   - INPUT report 512 bytes, OUTPUT report 1024 bytes.
//   - Screen 1920x462. Images are JPEG (also accepts raw frames on the LOG path).
//   - Command frame: "CRT\0\0" + <opcode/body>, zero-padded to the output report size.
//   - Confirmed WORKING live: brightness (LIG), wake (DIS), clear (CLE), the CONNECT
//     handshake (distinct device reaction). Image/draw paths (BAT/LOG/DRA) are framed
//     here but the device gates live presentation behind a stateful activation
//     exchange not yet replicated (see findings doc).

export const VID = 0x5548;
export const PID = 0x1011;
export const SCREEN_WIDTH = 1920;
export const SCREEN_HEIGHT = 462;

export const CMD_PREFIX = [0x43, 0x52, 0x54, 0x00, 0x00]; // "CRT\0\0"
export const OUTPUT_REPORT_SIZE = 1024; // HID OUTPUT report size (from report descriptor)
export const INPUT_REPORT_SIZE = 512; // HID INPUT report size
export const DEFAULT_REPORT_ID = 0x00; // device uses unnumbered reports

/** Big-endian byte array of a length value (default 4 bytes). */
export function sizeBytes(size: number, bytes = 4): number[] {
  const hex = size.toString(16).padStart(bytes * 2, "0");
  return [...Buffer.from(hex, "hex")];
}

/** ASCII string -> byte array (helper for opcodes). */
export function ascii(s: string): number[] {
  return [...Buffer.from(s, "latin1")];
}

/** Build a CRT command report: "CRT\0\0" + body, zero-padded to `size`. */
export function packet(body: number[], size = OUTPUT_REPORT_SIZE): Buffer {
  const head = Buffer.from([...CMD_PREFIX, ...body]);
  if (head.length > size) throw new Error(`command too long: ${head.length} > ${size}`);
  return Buffer.concat([head, Buffer.alloc(size - head.length)]);
}

/** Build a raw report (no CRT prefix), zero-padded to `size`. Used by the legacy HANC handshake. */
export function rawPacket(body: number[], size = OUTPUT_REPORT_SIZE): Buffer {
  const b = Buffer.from(body);
  if (b.length > size) throw new Error(`packet too long: ${b.length} > ${size}`);
  return Buffer.concat([b, Buffer.alloc(size - b.length)]);
}

/** Prepend the HID report id (hidapi write convention; 0 = unnumbered). */
export function frame(pkt: Buffer, reportId = DEFAULT_REPORT_ID): Buffer {
  return Buffer.concat([Buffer.from([reportId]), pkt]);
}

/** Split a buffer into `size`-byte chunks; the last chunk is zero-padded. */
export function chunk(data: Buffer, size = OUTPUT_REPORT_SIZE): Buffer[] {
  const out: Buffer[] = [];
  for (let off = 0; off < data.length; off += size) {
    const slice = data.subarray(off, Math.min(off + size, data.length));
    out.push(slice.length < size ? Buffer.concat([slice, Buffer.alloc(size - slice.length)]) : slice);
  }
  return out;
}

/**
 * Build the 32-byte "DRA" (draw region) header used for live secondary-screen
 * updates: "CRT\0\0DRA" + BE32(dataLen+32) + BE16(flag) + BE16(x,y,w,h).
 * Returned buffer is exactly 32 bytes (pad to the report size before sending).
 */
export function drawHeader(
  dataLen: number,
  rect: { x: number; y: number; w: number; h: number; flag?: number } = { x: 0, y: 0, w: SCREEN_WIDTH, h: SCREEN_HEIGHT },
): Buffer {
  const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
  const hd = Buffer.from([
    ...CMD_PREFIX, ...ascii("DRA"),
    ...sizeBytes(dataLen + 32),
    ...be16(rect.flag ?? 0),
    ...be16(rect.x), ...be16(rect.y), ...be16(rect.w), ...be16(rect.h),
  ]);
  return Buffer.concat([hd, Buffer.alloc(32 - hd.length)]);
}

/**
 * CRT command bodies (the bytes AFTER the "CRT\0\0" prefix; pass to packet()).
 * Opcodes verified against SDLibrary1.dll command builders.
 */
export const Commands = {
  wake: () => ascii("DIS"), // wake screen
  clear: (target = 0xff) => [...ascii("CLE"), 0x00, 0x00, target], // clear (target 0xff = all)
  brightness: (value: number) => [...ascii("LIG"), 0x00, 0x00, value & 0xff], // screen brightness
  finish: () => [...ascii("STP"), 0x21, 0x23], // commit/refresh ("STP!#")
  uploadFinished: () => ascii("ULEND"), // finalize an upload
  connect: () => ascii("CONNECT"), // D92 handshake (non-293 devices)
  version: () => ascii("VER"), // query hardware/firmware version
  mode: (m: number) => [...ascii("MOD"), 0x00, 0x00, m & 0xff], // change device mode
  keyImage: (size: number, index = 0) => [...ascii("BAT"), ...sizeBytes(size), index & 0xff], // pic upload header
  logo: (size: number, flag = 1) => [...ascii("LOG"), ...sizeBytes(size), flag & 0xff], // boot-logo upload header
};

/** Legacy StreamDock 293 handshake ("HANC", no CRT prefix). Kept for reference. */
export const LEGACY_HANDSHAKE_293 = ascii("HANC");