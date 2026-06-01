import test from "node:test";
import assert from "node:assert/strict";
import { sizeBytes, packet, frame, chunk, Commands, PACKET_SIZE } from "../src/d92/protocol";

test("sizeBytes encodes big-endian 4-byte length", () => {
  assert.deepEqual(sizeBytes(1), [0x00, 0x00, 0x00, 0x01]);
  assert.deepEqual(sizeBytes(0x1234), [0x00, 0x00, 0x12, 0x34]);
});

test("packet prefixes CRT and pads to 512", () => {
  const p = packet(Commands.wake());
  assert.equal(p.length, PACKET_SIZE);
  assert.deepEqual([...p.subarray(0, 5)], [0x43, 0x52, 0x54, 0x00, 0x00]); // "CRT\0\0"
  assert.deepEqual([...p.subarray(5, 10)], [0x44, 0x49, 0x53, 0x00, 0x00]); // "DIS\0\0"
  assert.equal(p[11], 0x00); // padding
});

test("packet throws if body too long", () => {
  assert.throws(() => packet(new Array(520).fill(0)));
});

test("frame prepends the report id", () => {
  const f = frame(packet(Commands.wake()), 0x00);
  assert.equal(f.length, PACKET_SIZE + 1);
  assert.equal(f[0], 0x00);
});

test("chunk splits and zero-pads the last chunk", () => {
  const chunks = chunk(Buffer.alloc(PACKET_SIZE + 10, 0xaa));
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].length, PACKET_SIZE);
  assert.equal(chunks[1].length, PACKET_SIZE);
  assert.equal(chunks[1][9], 0xaa);
  assert.equal(chunks[1][10], 0x00); // padded
});

test("brightness command body", () => {
  assert.deepEqual(Commands.brightness(0x19), [0x4c, 0x49, 0x47, 0x00, 0x00, 0x19]);
});