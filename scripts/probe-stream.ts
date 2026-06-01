// Stream frames continuously over interrupt-OUT (the app uses ~10 fps), in case the
// live display only shows content while actively driven. CONNECT once, then loop the
// DRA frame for the hold duration. Run with sudo.
//   sudo npx tsx scripts/probe-stream.ts [format] [fps] [seconds] [noconnect]
import { Jimp } from "jimp";
import * as usb from "usb";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const W = 1920, H = 462, PKT = 1024;
const FORMAT = (process.argv[2] ?? "rgb565le").toLowerCase();
const FPS = Number(process.argv[3] ?? 5);
const SECONDS = Number(process.argv[4] ?? 15);
const NOCONNECT = process.argv.includes("noconnect");

const padTo = (b: number[] | Buffer, n: number) => { const o = Buffer.alloc(n); Buffer.from(b).copy(o); return o; };
const cmd = (body: number[]) => padTo([0x43, 0x52, 0x54, 0x00, 0x00, ...body], PKT);
const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const S = (s: string) => [...Buffer.from(s, "latin1")];

async function encode(): Promise<Buffer> {
  const img = new Jimp({ width: W, height: H, color: 0xff0000ff }); // RED
  if (FORMAT === "jpeg") return img.getBuffer("image/jpeg", { quality: 90 });
  const bpp = FORMAT.startsWith("rgb565") ? 2 : 3; const buf = Buffer.alloc(W * H * bpp); let i = 0;
  for (let p = 0; p < W * H; p++) { const r=255,g=0,b=0;
    if (FORMAT === "bgr888") { buf[i++]=b; buf[i++]=g; buf[i++]=r; }
    else { const v=((r>>3)<<11)|((g>>2)<<5)|(b>>3); buf[i++]=v&0xff; buf[i++]=(v>>8)&0xff; } }
  return buf;
}

function draFrame(data: Buffer): Buffer {
  const hd = Buffer.alloc(32);
  Buffer.from([0x43,0x52,0x54,0x00,0x00,0x44,0x52,0x41]).copy(hd,0);
  Buffer.from(be32(data.length+32)).copy(hd,8);
  Buffer.from(be16(0)).copy(hd,12);
  Buffer.from(be16(0)).copy(hd,14); Buffer.from(be16(0)).copy(hd,16);
  Buffer.from(be16(W)).copy(hd,18); Buffer.from(be16(H)).copy(hd,20);
  return Buffer.concat([hd, data]);
}

async function main() {
  console.log(`STREAM ${FORMAT} @ ${FPS}fps for ${SECONDS}s, connect=${!NOCONNECT}`);
  const data = await encode();
  const frame = draFrame(data);

  const device = usb.findByIds(0x5548, 0x1011);
  if (!device) { console.error("not found"); return; }
  device.open();
  const iface = device.interfaces![0];
  if (iface.isKernelDriverActive()) { try { iface.detachKernelDriver(); } catch {} }
  iface.claim();
  const outEp = iface.endpoints.find((e) => e.direction === "out") as usb.OutEndpoint;
  outEp.transferType = usb.usb.LIBUSB_TRANSFER_TYPE_INTERRUPT;
  const send = (buf: Buffer) => new Promise<void>((res, rej) => outEp.transfer(buf, (e) => e ? rej(e) : res()));

  await send(cmd(S("DIS"))); await sleep(200);
  await send(cmd([0x4c,0x49,0x47,0x00,0x00,0xff])); await sleep(200);
  if (!NOCONNECT) { console.log("CONNECT (wait 4.5s)"); await send(cmd(S("CONNECT"))); await sleep(4500); await send(cmd([0x4c,0x49,0x47,0x00,0x00,0xff])); }

  const interval = Math.max(1, Math.floor(1000 / FPS));
  const frames = FPS * SECONDS;
  console.log(`streaming ${frames} frames... WATCH NOW`);
  for (let n = 0; n < frames; n++) {
    for (let off = 0; off < frame.length; off += PKT) await send(padTo(frame.subarray(off, off + PKT), PKT));
    await send(cmd([0x53,0x54,0x50,0x21,0x23])); // STP!# each frame
    if (n % FPS === 0) process.stdout.write(`  ${n / FPS}s`);
    await sleep(interval);
  }
  console.log("\nstream done, releasing");
  iface.release(() => device.close());
}
main().catch((e) => { console.error(e); process.exit(1); });