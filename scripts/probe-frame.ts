// Full-screen LOG upload with selectable pixel format, to find the D92's wire format.
//   handshake -> LOG(size) -> raw pixel reports -> ULEND -> STP!#
//
// Usage: tsx scripts/probe-frame.ts [W] [H] [format] [rotate] [flag] [solid]
//   format: bgr888 | rgb888 | rgb565le | rgb565be   (default rgb565le)
//   flag:   byte after the size field in the LOG header (default 1)
//   solid:  optional color name (red|green|blue|white) to send a solid fill
//           instead of the diagnostic pattern (easier to judge black vs filled)
import { Jimp } from "jimp";
import { HID, devices } from "node-hid";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const W = Number(process.argv[2] ?? 1920);
const H = Number(process.argv[3] ?? 462);
const FORMAT = (process.argv[4] ?? "rgb565le").toLowerCase();
const ROTATE = Number(process.argv[5] ?? 0);
const FLAG = Number(process.argv[6] ?? 1);
const SOLID = (process.argv[7] ?? "").toLowerCase();

const PACKET = 512;
const pad = (b: number[] | Buffer) => { const o = Buffer.alloc(PACKET); Buffer.from(b).copy(o); return o; };
const pkt = (body: number[]) => pad([0x43, 0x52, 0x54, 0x00, 0x00, ...body]);
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const rgba = (r: number, g: number, b: number) => ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0;

function buildImage(w: number, h: number) {
  const solids: Record<string, number> = {
    red: rgba(255, 0, 0), green: rgba(0, 255, 0), blue: rgba(0, 0, 255), white: rgba(255, 255, 255),
  };
  if (SOLID && solids[SOLID]) return new Jimp({ width: w, height: h, color: solids[SOLID] });
  const img = new Jimp({ width: w, height: h, color: 0x000000ff });
  const hw = (w / 2) | 0, hh = (h / 2) | 0, bd = Math.max(2, (Math.min(w, h) * 0.06) | 0);
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

function encode(img: any, w: number, h: number): Buffer {
  const bpp = FORMAT.startsWith("rgb565") ? 2 : 3;
  const buf = Buffer.alloc(w * h * bpp);
  let i = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const px = img.getPixelColor(x, y); // 0xRRGGBBAA
      const r = (px >>> 24) & 0xff, g = (px >>> 16) & 0xff, b = (px >>> 8) & 0xff;
      if (FORMAT === "bgr888") { buf[i++] = b; buf[i++] = g; buf[i++] = r; }
      else if (FORMAT === "rgb888") { buf[i++] = r; buf[i++] = g; buf[i++] = b; }
      else {
        const v = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
        if (FORMAT === "rgb565be") { buf[i++] = (v >> 8) & 0xff; buf[i++] = v & 0xff; }
        else { buf[i++] = v & 0xff; buf[i++] = (v >> 8) & 0xff; } // le
      }
    }
  return buf;
}

async function main() {
  console.log(`LOG ${W}x${H} format=${FORMAT} rotate=${ROTATE} flag=${FLAG} solid=${SOLID || "none"}`);
  const img = buildImage(W, H);
  if (ROTATE) img.rotate(ROTATE);
  const data = encode(img, ROTATE % 180 === 0 ? W : H, ROTATE % 180 === 0 ? H : W);
  console.log(`payload bytes: ${data.length}`);

  const m = devices().find((d: any) => d.vendorId === 0x5548 && d.productId === 0x1011);
  if (!m?.path) throw new Error("D92 not found");
  const dev = new HID(m.path);
  dev.on("data", (b: Buffer) => console.log("IN <-", b.subarray(0, 16).toString("hex"), `"${b.subarray(0,8).toString("latin1").replace(/[^\x20-\x7e]/g,".")}"`));
  const send = (buf: Buffer) => dev.write([0x00, ...buf]);

  send(pkt([0x44, 0x49, 0x53])); await sleep(150);
  send(pkt([0x4c, 0x49, 0x47, 0x00, 0x00, 0xff]));
  send(pad([0x48, 0x41, 0x4e, 0x43])); await sleep(2500);
  send(pkt([0x4c, 0x49, 0x47, 0x00, 0x00, 0xff]));

  send(pkt([0x4c, 0x4f, 0x47, ...be32(data.length), FLAG]));
  let reports = 0;
  for (let off = 0; off < data.length; off += PACKET) { send(pad(data.subarray(off, off + PACKET))); reports++; }
  send(pkt([0x55, 0x4c, 0x45, 0x4e, 0x44])); // ULEND
  send(pkt([0x53, 0x54, 0x50, 0x21, 0x23])); // STP!#
  console.log(`sent LOG + ${reports} reports + ULEND + STP!#`);

  await sleep(1500);
  dev.close();
  console.log("done");
}

main().catch((e) => { console.error(e); process.exit(1); });