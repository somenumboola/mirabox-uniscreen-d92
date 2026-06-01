// Try the REAL D92 handshake: "CRT\0\0CONNECT" (branch B of addHandshakePack for
// non-293 devices), instead of the 293's "HANC". Then draw a frame.
//
// Usage: tsx scripts/probe-connect.ts [path] [format] [flag]
//   path: DRA | LOG   (default DRA)
//   format: rgb565le | jpeg | bgr888  (default rgb565le)
import { Jimp } from "jimp";
import { HID, devices } from "node-hid";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const W = 1920, H = 462, PACKET = 1024;
const PATH = (process.argv[2] ?? "DRA").toUpperCase();
const FORMAT = (process.argv[3] ?? "rgb565le").toLowerCase();
const FLAG = Number(process.argv[4] ?? 0);

const pad = (b: number[] | Buffer) => { const o = Buffer.alloc(PACKET); Buffer.from(b).copy(o); return o; };
const pkt = (body: number[]) => pad([0x43, 0x52, 0x54, 0x00, 0x00, ...body]);
const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const str = (s: string) => [...Buffer.from(s, "latin1")];

async function encode(): Promise<Buffer> {
  const img = new Jimp({ width: W, height: H, color: 0xff0000ff }); // solid RED
  if (FORMAT === "jpeg") return img.getBuffer("image/jpeg", { quality: 90 });
  const bpp = FORMAT.startsWith("rgb565") ? 2 : 3; const buf = Buffer.alloc(W * H * bpp); let i = 0;
  for (let p = 0; p < W * H; p++) {
    const r = 255, g = 0, b = 0;
    if (FORMAT === "bgr888") { buf[i++] = b; buf[i++] = g; buf[i++] = r; }
    else { const v = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3); buf[i++] = v & 0xff; buf[i++] = (v >> 8) & 0xff; }
  }
  return buf;
}

async function main() {
  console.log(`CONNECT handshake + ${PATH} ${FORMAT} flag=${FLAG} (solid RED)`);
  const data = await encode();

  const m = devices().find((d: any) => d.vendorId === 0x5548 && d.productId === 0x1011);
  if (!m?.path) throw new Error("D92 not found");
  const dev = new HID(m.path);
  dev.on("data", (b: Buffer) => console.log("IN <-", b.subarray(0, 16).toString("hex"), `"${b.subarray(0,10).toString("latin1").replace(/[^\x20-\x7e]/g,".")}"`));
  const send = (buf: Buffer) => dev.write([0x00, ...buf]);

  send(pkt(str("DIS"))); await sleep(200);                 // wake
  send(pkt([0x4c, 0x49, 0x47, 0x00, 0x00, 0xff])); await sleep(200); // brightness
  console.log("-> CRT..CONNECT handshake");
  send(pkt(str("CONNECT")));                                // the REAL handshake
  await sleep(2500);
  send(pkt([0x4c, 0x49, 0x47, 0x00, 0x00, 0xff]));

  console.log(`-> ${PATH} frame`);
  if (PATH === "DRA") {
    const hd = Buffer.alloc(32);
    Buffer.from([0x43,0x52,0x54,0x00,0x00,0x44,0x52,0x41]).copy(hd, 0);
    Buffer.from(be32(data.length + 32)).copy(hd, 8);
    Buffer.from(be16(FLAG)).copy(hd, 12);
    Buffer.from(be16(0)).copy(hd, 14); Buffer.from(be16(0)).copy(hd, 16);
    Buffer.from(be16(W)).copy(hd, 18); Buffer.from(be16(H)).copy(hd, 20);
    send(pad(hd));
  } else {
    send(pkt([0x4c, 0x4f, 0x47, ...be32(data.length), 0x01]));
  }
  let reports = 0;
  for (let off = 0; off < data.length; off += PACKET) { send(pad(data.subarray(off, off + PACKET))); reports++; }
  send(pkt(str("ULEND")));
  send(pkt([0x53, 0x54, 0x50, 0x21, 0x23])); // STP!#
  await sleep(300);
  send(pkt([0x4c, 0x49, 0x47, 0x00, 0x00, 0xff]));
  console.log(`sent ${PATH} + ${reports} reports + ULEND + STP!# + brightness`);
  await sleep(1500);
  dev.close();
  console.log("done");
}
main().catch((e) => { console.error(e); process.exit(1); });