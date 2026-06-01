// Resolution sweep for the LOG raw-BGR full-screen path.
// Handshakes once, then uploads the diagnostic image at each candidate
// resolution with a display window, announcing the size so you can call out
// which one renders a clean, full image (vs black/garbled/revert-to-logo).
import { Jimp } from "jimp";
import { HID, devices } from "node-hid";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ROTATE = Number(process.argv[2] ?? 180);
const HOLD = Number(process.argv[3] ?? 4000);

// Most-likely small-display resolutions, ordered by rough likelihood.
const CANDIDATES: [number, number][] = [
  [480, 480], [480, 320], [320, 480], [320, 240], [240, 320],
  [640, 480], [854, 480], [400, 400], [320, 320], [360, 360],
];

const PACKET = 512;
const pad = (b: number[] | Buffer) => { const o = Buffer.alloc(PACKET); Buffer.from(b).copy(o); return o; };
const pkt = (body: number[]) => pad([0x43, 0x52, 0x54, 0x00, 0x00, ...body]);
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const rgba = (r: number, g: number, b: number) => ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0;

function bgrOf(w: number, h: number): Buffer {
  const img = new Jimp({ width: w, height: h, color: 0x000000ff });
  const hw = (w / 2) | 0, hh = (h / 2) | 0, bd = Math.max(2, (Math.min(w, h) * 0.05) | 0);
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
  if (ROTATE) img.rotate(ROTATE);
  const bgr = Buffer.alloc(w * h * 3);
  let i = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const px = img.getPixelColor(x, y);
      bgr[i++] = (px >>> 8) & 0xff; bgr[i++] = (px >>> 16) & 0xff; bgr[i++] = (px >>> 24) & 0xff;
    }
  return bgr;
}

async function main() {
  const m = devices().find((d: any) => d.vendorId === 0x5548 && d.productId === 0x1011);
  if (!m?.path) throw new Error("D92 not found");
  const dev = new HID(m.path);
  const send = (buf: Buffer) => dev.write([0x00, ...buf]);

  send(pkt([0x44, 0x49, 0x53])); await sleep(150);     // wake
  send(pkt([0x4c, 0x49, 0x47, 0x00, 0x00, 0xff]));      // brightness max
  console.log("handshake; settle 2.5s");
  send(pad([0x48, 0x41, 0x4e, 0x43])); await sleep(2500); // HANC

  for (const [w, h] of CANDIDATES) {
    const bgr = bgrOf(w, h);
    send(pkt([0x4c, 0x49, 0x47, 0x00, 0x00, 0xff]));    // keep bright
    send(pkt([0x4c, 0x4f, 0x47, ...be32(bgr.length), 0x01])); // LOG header
    for (let off = 0; off < bgr.length; off += PACKET) send(pad(bgr.subarray(off, off + PACKET)));
    send(pkt([0x53, 0x54, 0x50, 0x21, 0x23]));          // STP!#
    console.log(`\n>>> NOW SHOWING  ${w} x ${h}  (${bgr.length} bytes) — hold ${HOLD}ms <<<`);
    await sleep(HOLD);
  }

  dev.close();
  console.log("\nsweep done");
}

main().catch((e) => { console.error(e); process.exit(1); });