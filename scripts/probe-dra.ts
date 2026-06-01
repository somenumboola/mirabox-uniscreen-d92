// Live-display "DRA" (draw region) command, reconstructed from
// getSecondaryScreenPicInfo. Header (32 bytes) + image data as one contiguous
// stream, chunked into 512-byte HID reports.
//
// Header layout:
//   [0..7]   "CRT\0\0DRA"
//   [8..11]  BE32(dataLen + 32)
//   [12..13] BE16(flag)
//   [14..15] BE16(x)  [16..17] BE16(y)  [18..19] BE16(w)  [20..21] BE16(h)
//   [22..31] zero pad
//
// Usage: tsx scripts/probe-dra.ts [format] [flag] [rotate] [solid]
//   format: jpeg | rgb565le | bgr888   (default jpeg)
//   flag:   header flag value          (default 0)
//   solid:  red|green|blue|white       (optional solid fill)
import { Jimp } from "jimp";
import { HID, devices } from "node-hid";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const W = 1920, H = 462;
const FORMAT = (process.argv[2] ?? "jpeg").toLowerCase();
const FLAG = Number(process.argv[3] ?? 0);
const ROTATE = Number(process.argv[4] ?? 0);
const SOLID = (process.argv[5] ?? "").toLowerCase();
const MODE = process.argv[6] === undefined ? -1 : Number(process.argv[6]); // CRT MOD <mode> before draw

const PACKET = 512;
const pad = (b: number[] | Buffer) => { const o = Buffer.alloc(PACKET); Buffer.from(b).copy(o); return o; };
const pkt = (body: number[]) => pad([0x43, 0x52, 0x54, 0x00, 0x00, ...body]);
const rgba = (r: number, g: number, b: number) => ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0;

function buildImage() {
  const solids: Record<string, number> = { red: rgba(255,0,0), green: rgba(0,255,0), blue: rgba(0,0,255), white: rgba(255,255,255) };
  if (SOLID && solids[SOLID]) return new Jimp({ width: W, height: H, color: solids[SOLID] });
  const img = new Jimp({ width: W, height: H, color: 0x000000ff });
  const hw = (W/2)|0, hh = (H/2)|0, bd = Math.max(2, (Math.min(W,H)*0.06)|0);
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
    let c:number;
    if (x<bd||y<bd||x>=W-bd||y>=H-bd) c=rgba(255,255,255);
    else if (Math.abs(x-hw)<bd||Math.abs(y-hh)<bd) c=rgba(0,0,0);
    else if (x<hw&&y<hh) c=rgba(255,0,0);
    else if (x>=hw&&y<hh) c=rgba(0,255,0);
    else if (x<hw&&y>=hh) c=rgba(0,0,255);
    else c=rgba(255,255,0);
    img.setPixelColor(c,x,y);
  }
  return img;
}

async function encode(img: any): Promise<Buffer> {
  if (FORMAT === "jpeg") return img.getBuffer("image/jpeg", { quality: 90 });
  const bpp = FORMAT === "rgb565le" ? 2 : 3;
  const buf = Buffer.alloc(W*H*bpp); let i=0;
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
    const px=img.getPixelColor(x,y), r=(px>>>24)&0xff,g=(px>>>16)&0xff,b=(px>>>8)&0xff;
    if (FORMAT==="bgr888"){buf[i++]=b;buf[i++]=g;buf[i++]=r;}
    else {const v=((r>>3)<<11)|((g>>2)<<5)|(b>>3);buf[i++]=v&0xff;buf[i++]=(v>>8)&0xff;}
  }
  return buf;
}

const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

function header(dataLen: number, x: number, y: number, w: number, h: number): Buffer {
  const hd = Buffer.alloc(32);
  Buffer.from([0x43,0x52,0x54,0x00,0x00,0x44,0x52,0x41]).copy(hd, 0); // CRT\0\0DRA
  Buffer.from(be32(dataLen + 32)).copy(hd, 8);
  Buffer.from(be16(FLAG)).copy(hd, 12);
  Buffer.from(be16(x)).copy(hd, 14);
  Buffer.from(be16(y)).copy(hd, 16);
  Buffer.from(be16(w)).copy(hd, 18);
  Buffer.from(be16(h)).copy(hd, 20);
  return hd;
}

async function main() {
  console.log(`DRA ${W}x${H} format=${FORMAT} flag=${FLAG} rotate=${ROTATE} solid=${SOLID||"none"}`);
  const img = buildImage();
  if (ROTATE) img.rotate(ROTATE);
  const data = await encode(img);
  const full = Buffer.concat([header(data.length, 0, 0, W, H), data]);
  console.log(`data=${data.length} total=${full.length}`);

  const m = devices().find((d: any) => d.vendorId === 0x5548 && d.productId === 0x1011);
  if (!m?.path) throw new Error("D92 not found");
  const dev = new HID(m.path);
  dev.on("data", (b: Buffer) => console.log("IN <-", b.subarray(0,16).toString("hex"), `"${b.subarray(0,8).toString("latin1").replace(/[^\x20-\x7e]/g,".")}"`));
  const send = (buf: Buffer) => dev.write([0x00, ...buf]);

  send(pkt([0x44,0x49,0x53])); await sleep(150);            // wake
  send(pkt([0x4c,0x49,0x47,0x00,0x00,0xff]));               // bright
  send(pad([0x48,0x41,0x4e,0x43])); await sleep(2500);      // HANC
  send(pkt([0x4c,0x49,0x47,0x00,0x00,0xff]));
  if (MODE >= 0) { console.log(`MOD ${MODE}`); send(pkt([0x4d,0x4f,0x44,0x00,0x00,MODE])); await sleep(400); } // CRT MOD <mode>

  // Header as its OWN 512-byte report (padded), then image data in following reports.
  const hdr = header(data.length, 0, 0, W, H);
  send(pad(hdr));
  let reports = 0;
  for (let off = 0; off < data.length; off += PACKET) { send(pad(data.subarray(off, off+PACKET))); reports++; }
  console.log(`sent DRA header (own report) + ${reports} data reports`);
  send(pkt([0x55,0x4c,0x45,0x4e,0x44]));                    // ULEND
  send(pkt([0x53,0x54,0x50,0x21,0x23]));                    // STP!#
  await sleep(1500);
  dev.close();
  console.log("done");
}

main().catch((e) => { console.error(e); process.exit(1); });