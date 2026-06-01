// Replicate the official ACTIVATION handshake before drawing:
//   wake -> HANC -> VER (firmware query) + READ reply -> [MOD] -> DRA frame -> ULEND -> STP!# -> brightness
// The firmware-version exchange (CRT\0\0VER) + reading the reply may be what
// puts the device into host-display mode.
//
// Usage: tsx scripts/probe-activate.ts [format] [flag] [mode]
//   format: rgb565le | jpeg | bgr888   (default rgb565le)
//   flag:   DRA header flag             (default 0)
//   mode:   MOD value, or -1 to skip    (default -1)
import { Jimp } from "jimp";
import { HID, devices } from "node-hid";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const W = 1920, H = 462;
const FORMAT = (process.argv[2] ?? "rgb565le").toLowerCase();
const FLAG = Number(process.argv[3] ?? 0);
const MODE = process.argv[4] === undefined ? -1 : Number(process.argv[4]);

const PACKET = 1024;
const pad = (b: number[] | Buffer) => { const o = Buffer.alloc(PACKET); Buffer.from(b).copy(o); return o; };
const pkt = (body: number[]) => pad([0x43, 0x52, 0x54, 0x00, 0x00, ...body]);
const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const rgba = (r: number, g: number, b: number) => ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0;

function diag() {
  const img = new Jimp({ width: W, height: H, color: 0x000000ff });
  const hw = (W/2)|0, hh = (H/2)|0, bd = (Math.min(W,H)*0.06)|0;
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
    let c:number;
    if (x<bd||y<bd||x>=W-bd||y>=H-bd) c=rgba(255,255,255);
    else if (x<hw&&y<hh) c=rgba(255,0,0); else if (x>=hw&&y<hh) c=rgba(0,255,0);
    else if (x<hw&&y>=hh) c=rgba(0,0,255); else c=rgba(255,255,0);
    img.setPixelColor(c,x,y);
  }
  return img;
}
async function encode(img: any): Promise<Buffer> {
  if (FORMAT === "jpeg") return img.getBuffer("image/jpeg", { quality: 90 });
  const bpp = FORMAT === "rgb565le" ? 2 : 3; const buf = Buffer.alloc(W*H*bpp); let i=0;
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
    const px=img.getPixelColor(x,y), r=(px>>>24)&0xff,g=(px>>>16)&0xff,b=(px>>>8)&0xff;
    if (FORMAT==="bgr888"){buf[i++]=b;buf[i++]=g;buf[i++]=r;}
    else {const v=((r>>3)<<11)|((g>>2)<<5)|(b>>3);buf[i++]=v&0xff;buf[i++]=(v>>8)&0xff;}
  }
  return buf;
}
function draHeader(dataLen: number): Buffer {
  const hd = Buffer.alloc(32);
  Buffer.from([0x43,0x52,0x54,0x00,0x00,0x44,0x52,0x41]).copy(hd,0);
  Buffer.from(be32(dataLen+32)).copy(hd,8);
  Buffer.from(be16(FLAG)).copy(hd,12);
  Buffer.from(be16(0)).copy(hd,14); Buffer.from(be16(0)).copy(hd,16);
  Buffer.from(be16(W)).copy(hd,18); Buffer.from(be16(H)).copy(hd,20);
  return hd;
}

function readReplies(dev: any, label: string, tries = 4) {
  for (let i=0;i<tries;i++) {
    try { const r = dev.readTimeout(400); if (r && r.length) {
      const b = Buffer.from(r);
      console.log(`  ${label} reply[${i}]:`, b.subarray(0,20).toString("hex"), `"${b.subarray(0,12).toString("latin1").replace(/[^\x20-\x7e]/g,".")}"`);
    } } catch {}
  }
}

async function main() {
  console.log(`ACTIVATE+DRA format=${FORMAT} flag=${FLAG} mode=${MODE}`);
  const img = diag();
  const data = await encode(img);

  const m = devices().find((d: any) => d.vendorId === 0x5548 && d.productId === 0x1011);
  if (!m?.path) throw new Error("D92 not found");
  const dev = new HID(m.path);
  const send = (buf: Buffer) => dev.write([0x00, ...buf]);

  send(pkt([0x44,0x49,0x53])); await sleep(200);          // wake
  send(pkt([0x4c,0x49,0x47,0x00,0x00,0xff])); await sleep(200); // brightness
  console.log("HANC handshake");
  send(pad([0x48,0x41,0x4e,0x43])); await sleep(800);
  readReplies(dev, "HANC");
  console.log("VER firmware query");
  send(pkt([0x56,0x45,0x52]));                            // CRT\0\0VER
  readReplies(dev, "VER");
  await sleep(500);
  if (MODE >= 0) { console.log(`MOD ${MODE}`); send(pkt([0x4d,0x4f,0x44,0x00,0x00,MODE])); await sleep(400); }

  console.log("DRA frame");
  send(pad(draHeader(data.length)));
  let reports = 0;
  for (let off=0; off<data.length; off+=PACKET) { send(pad(data.subarray(off,off+PACKET))); reports++; }
  send(pkt([0x55,0x4c,0x45,0x4e,0x44]));                  // ULEND
  send(pkt([0x53,0x54,0x50,0x21,0x23]));                  // STP!#
  await sleep(300);
  send(pkt([0x4c,0x49,0x47,0x00,0x00,0xff]));             // brightness again
  console.log(`sent DRA + ${reports} reports + ULEND + STP!# + brightness`);
  readReplies(dev, "post-draw");
  await sleep(1200);
  dev.close();
  console.log("done");
}
main().catch((e) => { console.error(e); process.exit(1); });