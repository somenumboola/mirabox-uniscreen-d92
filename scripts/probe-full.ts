// Full evidence-based activation: the connect routine sends VER (interrupt-OUT) and
// reads firmware via CONTROL GET_REPORT (device answers "V25.D92.02.012"), retrying;
// only then does it stream frames. Replicate that, then send a frame and hold.
//   sudo npx tsx scripts/probe-full.ts [format] [seconds]
import { Jimp } from "jimp";
import * as usb from "usb";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const W = 1920, H = 462, PKT = 1024;
const FORMAT = (process.argv[2] ?? "rgb565le").toLowerCase();
const SECONDS = Number(process.argv[3] ?? 15);

const padTo = (b: number[] | Buffer, n = PKT) => { const o = Buffer.alloc(n); Buffer.from(b).copy(o); return o; };
const cmd = (body: number[]) => padTo([0x43, 0x52, 0x54, 0x00, 0x00, ...body]);
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
  Buffer.from(be16(0)).copy(hd,12); Buffer.from(be16(0)).copy(hd,14);
  Buffer.from(be16(0)).copy(hd,16); Buffer.from(be16(W)).copy(hd,18); Buffer.from(be16(H)).copy(hd,20);
  return Buffer.concat([hd, data]);
}

async function main() {
  const data = await encode();
  const frame = draFrame(data);
  const device: any = usb.findByIds(0x5548, 0x1011);
  if (!device) { console.error("not found"); return; }
  device.open();
  const iface = device.interfaces![0];
  if (iface.isKernelDriverActive()) { try { iface.detachKernelDriver(); } catch {} }
  iface.claim();
  const outEp = iface.endpoints.find((e: any) => e.direction === "out") as usb.OutEndpoint;
  outEp.transferType = usb.usb.LIBUSB_TRANSFER_TYPE_INTERRUPT;
  const send = (buf: Buffer) => new Promise<void>((res, rej) => outEp.transfer(buf, (e) => e ? rej(e) : res()));
  const readFw = () => new Promise<string>((res) => device.controlTransfer(0xa1, 0x01, 0x0100, 0, 512,
    (err: any, d: Buffer) => res(err ? `ERR ${err.message}` : (d ?? Buffer.alloc(0)).toString("latin1").replace(/\0+$/,""))));

  console.log("wake + brightness");
  await send(cmd(S("DIS"))); await sleep(200);
  await send(cmd([0x4c,0x49,0x47,0x00,0x00,0xff])); await sleep(200);

  if (!process.argv.includes("noconnect")) {
    console.log("CONNECT");
    await send(cmd(S("CONNECT"))); await sleep(3000);
  } else {
    console.log("(skip CONNECT)");
  }

  // Activation handshake loop: VER (interrupt) + firmware read (control), like the app.
  for (let i = 0; i < 3; i++) {
    await send(cmd(S("VER")));
    await sleep(200);
    const fw = await readFw();
    console.log(`  activation ${i}: firmware="${fw}"`);
    await sleep(300);
  }
  await send(cmd([0x4c,0x49,0x47,0x00,0x00,0xff]));

  console.log("send DRA frame (RED)");
  for (let off = 0; off < frame.length; off += PKT) await send(padTo(frame.subarray(off, off + PKT)));
  await send(cmd(S("ULEND")));
  await send(cmd([0x53,0x54,0x50,0x21,0x23])); // STP!#
  await send(cmd([0x4c,0x49,0x47,0x00,0x00,0xff]));

  console.log(`HOLDING ${SECONDS}s — WATCH SCREEN`);
  await sleep(SECONDS * 1000);
  console.log("releasing");
  iface.release(() => device.close());
}
main().catch((e) => { console.error(e); process.exit(1); });