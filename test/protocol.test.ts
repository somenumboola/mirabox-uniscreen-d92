import test from "node:test";
import assert from "node:assert/strict";
import {
  sizeBytes, ascii, packet, rawPacket, frame, chunk, drawHeader, Commands,
  OUTPUT_REPORT_SIZE, CMD_PREFIX, LEGACY_HANDSHAKE_293,
} from "../src/d92/protocol";

test("sizeBytes encodes big-endian 4-byte length", () => {
  assert.deepEqual(sizeBytes(1), [0x00, 0x00, 0x00, 0x01]);
  assert.deepEqual(sizeBytes(0x1234), [0x00, 0x00, 0x12, 0x34]);
  assert.deepEqual(sizeBytes(1774080), [0x00, 0x1b, 0x12, 0x00]); // 1920*462*2
});

test("ascii converts to bytes", () => {
  assert.deepEqual(ascii("CRT"), [0x43, 0x52, 0x54]);
  assert.deepEqual(ascii("DRA"), [0x44, 0x52, 0x41]);
});

test("packet prefixes CRT\\0\\0 and pads to the output report size (1024)", () => {
  const p = packet(Commands.wake());
  assert.equal(p.length, OUTPUT_REPORT_SIZE);
  assert.deepEqual([...p.subarray(0, 5)], CMD_PREFIX); // "CRT\0\0"
  assert.deepEqual([...p.subarray(5, 8)], [0x44, 0x49, 0x53]); // "DIS"
  assert.equal(p[8], 0x00); // padding
});

test("packet throws if body too long", () => {
  assert.throws(() => packet(new Array(1100).fill(0)));
});

test("frame prepends report id and rawPacket has no CRT prefix", () => {
  const f = frame(packet(Commands.wake()), 0x00);
  assert.equal(f.length, OUTPUT_REPORT_SIZE + 1);
  assert.equal(f[0], 0x00);
  const r = rawPacket(LEGACY_HANDSHAKE_293);
  assert.deepEqual([...r.subarray(0, 4)], [0x48, 0x41, 0x4e, 0x43]); // "HANC", no CRT
});

test("chunk splits and zero-pads the last chunk", () => {
  const chunks = chunk(Buffer.alloc(OUTPUT_REPORT_SIZE + 10, 0xaa));
  assert.equal(chunks.length, 2);
  assert.ok(chunks.every((c) => c.length === OUTPUT_REPORT_SIZE));
  assert.equal(chunks[1][9], 0xaa);
  assert.equal(chunks[1][10], 0x00); // padded
});

test("command opcodes match the reverse-engineered vocabulary", () => {
  assert.deepEqual(Commands.brightness(0x19), [0x4c, 0x49, 0x47, 0x00, 0x00, 0x19]); // LIG
  assert.deepEqual(Commands.clear(0xff), [0x43, 0x4c, 0x45, 0x00, 0x00, 0xff]); // CLE
  assert.deepEqual(Commands.wake(), [0x44, 0x49, 0x53]); // DIS
  assert.deepEqual(Commands.finish(), [0x53, 0x54, 0x50, 0x21, 0x23]); // STP!#
  assert.deepEqual(Commands.uploadFinished(), [0x55, 0x4c, 0x45, 0x4e, 0x44]); // ULEND
  assert.deepEqual(Commands.connect(), [0x43, 0x4f, 0x4e, 0x4e, 0x45, 0x43, 0x54]); // CONNECT
  assert.deepEqual(Commands.version(), [0x56, 0x45, 0x52]); // VER
  assert.deepEqual(Commands.mode(1), [0x4d, 0x4f, 0x44, 0x00, 0x00, 0x01]); // MOD
  assert.deepEqual(Commands.keyImage(0x1234, 0), [0x42, 0x41, 0x54, 0x00, 0x00, 0x12, 0x34, 0x00]); // BAT
  assert.deepEqual(Commands.logo(0x1234, 1), [0x4c, 0x4f, 0x47, 0x00, 0x00, 0x12, 0x34, 0x01]); // LOG
});

test("drawHeader builds the 32-byte DRA region header", () => {
  const hd = drawHeader(1000, { x: 0, y: 0, w: 1920, h: 462, flag: 0 });
  assert.equal(hd.length, 32);
  assert.deepEqual([...hd.subarray(0, 8)], [0x43, 0x52, 0x54, 0x00, 0x00, 0x44, 0x52, 0x41]); // CRT\0\0DRA
  assert.deepEqual([...hd.subarray(8, 12)], sizeBytes(1000 + 32)); // BE32(len+32)
  assert.deepEqual([...hd.subarray(12, 14)], [0x00, 0x00]); // flag
  assert.deepEqual([...hd.subarray(18, 20)], [0x07, 0x80]); // w=1920
  assert.deepEqual([...hd.subarray(20, 22)], [0x01, 0xce]); // h=462
});
