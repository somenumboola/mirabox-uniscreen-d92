// Full-screen image upload using the REAL command sequence discovered from the DLL:
//   wake -> [handshake HANC] -> BAT(size,index) -> raw JPEG reports -> ULEND -> STP!#
//
// Usage: tsx scripts/probe-image.ts [W] [H] [index] [rotate] [quality] [handshake?]
//   handshake: pass "hs" as the 6th arg to send a HANC handshake first.
//
// Diagnostic image: TL=red TR=green BL=blue BR=yellow, white border, black cross.
import { Jimp } from "jimp";
import { HID, devices } from "node-hid";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const W = Number(process.argv[2] ?? 480);
const H = Number(process.argv[3] ?? 480);
const INDEX = Number(process.argv[4] ?? 0);
const ROTATE = Number(process.argv[5] ?? 180);
const QUALITY = Number(process.argv[6] ?? 90);
const DO_HANDSHAKE = process.argv[7] === "hs";

const PACKET = 512;
const REPORT_ID = 0x00;
const PREFIX = [0x43, 0x52, 0x54, 0x00, 0x00]; // "CRT\0\0"

const pad = (b: number[]) => {
  const out = Buffer.alloc(PACKET);
  Buffer.from(b).copy(out);
  return out;
};
const pkt = (body: number[]) => pad([...PREFIX, ...body]); // CRT\0\0 + body
const raw = (body: number[]) => pad(body); // no prefix (for HANC)
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

const CMD = {
  wake: () => pkt([0x44, 0x49, 0x53]), // DIS
  brightness: (v: number) => pkt([0x4c, 0x49, 0x47, 0x00, 0x00, v]), // LIG
  handshake: () => raw([0x48, 0x41, 0x4e, 0x43]), // HANC
  bat: (size: number, index: number) => pkt([0x42, 0x41, 0x54, ...be32(size), index]), // BAT + size + index
  ulend: () => pkt([0x55, 0x4c, 0x45, 0x4e, 0x44]), // ULEND (upload finished)
  finish: () => pkt([0x53, 0x54, 0x50, 0x21, 0x23]), // STP!#
};

const rgba = (r: number, g: number, b: number) => ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0;
function diagnostic(w: number, h: number) {
  const img = new Jimp({ width: w, height: h, color: 0x000000ff });
  const hw = Math.floor(w / 2), hh = Math.floor(h / 2);
  const bd = Math.max(2, Math.floor(Math.min(w, h) * 0.04));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let c: number;
      if (x < bd || y < bd || x >= w - bd || y >= h - bd) c = rgba(255, 255, 255);
      else if (Math.abs(x - hw) < bd || Math.abs(y - hh) < bd) c = rgba(0, 0, 0);
      else if (x < hw && y < hh) c = rgba(255, 0, 0);
      else if (x >= hw && y < hh) c = rgba(0, 255, 0);
      else if (x < hw && y >= hh) c = rgba(0, 0, 255);
      else c = rgba(255, 255, 0);
      img.setPixelColor(c, x, y);
    }
  return img;
}

function findPath(): string {
  const m = devices().find((d: any) => d.vendorId === 0x5548 && d.productId === 0x1011);
  if (!m?.path) throw new Error("D92 not found");
  return m.path;
}

async function main() {
  console.log(`render ${W}x${H}, index=${INDEX}, rotate=${ROTATE}, q=${QUALITY}, handshake=${DO_HANDSHAKE}`);
  const img = diagnostic(W, H);
  if (ROTATE) img.rotate(ROTATE);
  const jpeg = await img.getBuffer("image/jpeg", { quality: QUALITY });
  console.log(`jpeg bytes: ${jpeg.length}`);

  const dev = new HID(findPath());
  dev.on("data", (b: Buffer) => console.log("IN <-", b.subarray(0, 24).toString("hex")));
  const send = (buf: Buffer) => dev.write([REPORT_ID, ...buf]);

  send(CMD.wake());
  await sleep(200);
  send(CMD.brightness(0xff));
  await sleep(200);
  if (DO_HANDSHAKE) {
    console.log("handshake; waiting 3s for device to settle...");
    send(CMD.handshake());
    await sleep(3000);
    send(CMD.brightness(0xff));
    await sleep(200);
    send(pkt([0x43, 0x4c, 0x45, 0x00, 0x00, 0x00, 0xff])); // clear all (CLE, target 0xff)
    await sleep(500);
  }

  send(CMD.bat(jpeg.length, INDEX));
  let reports = 0;
  for (let off = 0; off < jpeg.length; off += PACKET) {
    send(pad([...jpeg.subarray(off, off + PACKET)]));
    reports++;
  }
  send(CMD.ulend());
  send(CMD.finish());
  console.log(`sent header + ${reports} data reports + ULEND + STP!#`);

  await sleep(800);
  dev.close();
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});