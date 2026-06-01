// Full-screen background via the LOG + raw-BGR path (like the 293 boot image).
//   handshake -> LOG(size=W*H*3) -> raw BGR888 reports -> [ULEND] -> STP!#
//
// Usage: tsx scripts/probe-logo.ts [W] [H] [rotate] [ulend?]
//   default 800x480, rotate 180. Pass "ulend" as 4th arg to also send ULEND.
import { Jimp } from "jimp";
import { HID, devices } from "node-hid";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const W = Number(process.argv[2] ?? 800);
const H = Number(process.argv[3] ?? 480);
const ROTATE = Number(process.argv[4] ?? 180);
const DO_ULEND = process.argv[5] === "ulend";

const PACKET = 512;
const pad = (b: number[] | Buffer) => { const o = Buffer.alloc(PACKET); Buffer.from(b).copy(o); return o; };
const pkt = (body: number[]) => pad([0x43, 0x52, 0x54, 0x00, 0x00, ...body]);
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

const rgba = (r: number, g: number, b: number) => ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0;
function diagnostic(w: number, h: number) {
  const img = new Jimp({ width: w, height: h, color: 0x000000ff });
  const hw = (w / 2) | 0, hh = (h / 2) | 0, bd = Math.max(2, (Math.min(w, h) * 0.04) | 0);
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

async function main() {
  console.log(`LOG raw-BGR ${W}x${H} rotate=${ROTATE} ulend=${DO_ULEND}`);
  const img = diagnostic(W, H);
  if (ROTATE) img.rotate(ROTATE);
  // raw BGR888, like 293 setBootImage
  const bgr = Buffer.alloc(W * H * 3);
  let i = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const px = img.getPixelColor(x, y); // 0xRRGGBBAA
      bgr[i++] = (px >>> 8) & 0xff;  // B
      bgr[i++] = (px >>> 16) & 0xff; // G
      bgr[i++] = (px >>> 24) & 0xff; // R
    }
  console.log(`raw bytes: ${bgr.length} (= ${W}x${H}x3)`);

  const m = devices().find((d: any) => d.vendorId === 0x5548 && d.productId === 0x1011);
  if (!m?.path) throw new Error("D92 not found");
  const dev = new HID(m.path);
  dev.on("data", (b: Buffer) => console.log("IN <-", b.subarray(0, 24).toString("hex")));
  const send = (buf: Buffer) => dev.write([0x00, ...buf]);

  send(pkt([0x44, 0x49, 0x53])); // wake
  await sleep(150);
  send(pkt([0x4c, 0x49, 0x47, 0x00, 0x00, 0xff])); // brightness max
  await sleep(150);
  console.log("handshake; settle 2.5s");
  send(pad([0x48, 0x41, 0x4e, 0x43])); // HANC
  await sleep(2500);
  send(pkt([0x4c, 0x49, 0x47, 0x00, 0x00, 0xff])); // brightness again

  // LOG header: CRT + LOG + size(BE32) + 0x01  (293 used [00 11 94 00 01] = 1152000,1)
  send(pkt([0x4c, 0x4f, 0x47, ...be32(bgr.length), 0x01]));
  let reports = 0;
  for (let off = 0; off < bgr.length; off += PACKET) {
    send(pad(bgr.subarray(off, off + PACKET)));
    reports++;
  }
  if (DO_ULEND) send(pkt([0x55, 0x4c, 0x45, 0x4e, 0x44]));
  send(pkt([0x53, 0x54, 0x50, 0x21, 0x23])); // STP!#
  console.log(`sent LOG header + ${reports} reports${DO_ULEND ? " + ULEND" : ""} + STP!#`);

  await sleep(1000);
  dev.close();
  console.log("done");
}

main().catch((e) => { console.error(e); process.exit(1); });