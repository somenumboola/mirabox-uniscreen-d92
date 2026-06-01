// Send via libusb INTERRUPT-OUT endpoint (like the original 293 code / like Windows),
// bypassing macOS hidapi's control-endpoint report routing. Tests whether large
// frames were being dropped by macOS SET_REPORT routing.
//
// Requires elevated access on macOS:  sudo npx tsx scripts/probe-libusb.ts [path] [format] [pkt]
//   path: DRA | LOG   (default DRA)
//   format: rgb565le | bgr888 | jpeg  (default rgb565le)
//   pkt: 512 | 1024   (default 512)   raw interrupt transfer size
import { Jimp } from "jimp";
import * as usb from "usb";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const W = 1920, H = 462;
const PATH = (process.argv[2] ?? "DRA").toUpperCase(); // DRA | LOG | NONE (connect-only health check)
const FORMAT = (process.argv[3] ?? "rgb565le").toLowerCase();
const PKT = Number(process.argv[4] ?? 1024); // raw interrupt transfer size (device OUTPUT report = 1024)
const VID = 0x5548, PID = 0x1011;

const padTo = (b: number[] | Buffer, n: number) => { const o = Buffer.alloc(n); Buffer.from(b).copy(o); return o; };
const cmd = (body: number[]) => padTo([0x43, 0x52, 0x54, 0x00, 0x00, ...body], PKT); // CRT\0\0 + body
const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const S = (s: string) => [...Buffer.from(s, "latin1")];

async function encode(): Promise<Buffer> {
  const img = new Jimp({ width: W, height: H, color: 0xff0000ff }); // solid RED
  if (FORMAT === "jpeg") return img.getBuffer("image/jpeg", { quality: 90 });
  const bpp = FORMAT.startsWith("rgb565") ? 2 : 3; const buf = Buffer.alloc(W * H * bpp); let i = 0;
  for (let p = 0; p < W * H; p++) { const r=255,g=0,b=0;
    if (FORMAT === "bgr888") { buf[i++]=b; buf[i++]=g; buf[i++]=r; }
    else { const v=((r>>3)<<11)|((g>>2)<<5)|(b>>3); buf[i++]=v&0xff; buf[i++]=(v>>8)&0xff; } }
  return buf;
}

async function main() {
  console.log(`libusb interrupt-OUT: ${PATH} ${FORMAT} pkt=${PKT} (solid RED)`);
  const data = await encode();

  const device = usb.findByIds(VID, PID);
  if (!device) { console.error("Device not found"); return; }
  device.open();
  const iface = device.interfaces?.[0];
  if (!iface) { console.error("No interface"); return; }
  if (iface.isKernelDriverActive()) { try { iface.detachKernelDriver(); } catch (e) { console.error("detach failed:", (e as Error).message); } }
  iface.claim();
  console.log("interface claimed");

  const outEp = iface.endpoints.find((e) => e.direction === "out") as usb.OutEndpoint;
  const inEp = iface.endpoints.find((e) => e.direction === "in") as usb.InEndpoint;
  console.log("OUT endpoint:", outEp?.address, "IN endpoint:", inEp?.address);
  if (!outEp) { console.error("no OUT endpoint"); return; }
  outEp.transferType = usb.usb.LIBUSB_TRANSFER_TYPE_INTERRUPT;

  const send = (buf: Buffer) => new Promise<void>((res, rej) => outEp.transfer(buf, (e) => e ? rej(e) : res()));

  // read any replies
  if (inEp) {
    inEp.transferType = usb.usb.LIBUSB_TRANSFER_TYPE_INTERRUPT;
    inEp.on("data", (d: Buffer) => console.log("IN <-", d.subarray(0,16).toString("hex"), `"${d.subarray(0,8).toString("latin1").replace(/[^\x20-\x7e]/g,".")}"`));
    inEp.on("error", () => {});
    try { inEp.startPoll(4, 512); } catch {}
  }

  const NOCONNECT = process.argv.includes("noconnect");
  await send(cmd(S("DIS"))); await sleep(200);                 // wake
  await send(cmd([0x4c,0x49,0x47,0x00,0x00,0xff])); await sleep(200); // brightness
  if (!NOCONNECT) {
    console.log("-> CONNECT handshake");
    await send(cmd(S("CONNECT"))); await sleep(2500);
    await send(cmd([0x4c,0x49,0x47,0x00,0x00,0xff]));
  } else {
    console.log("-> (skipping CONNECT)");
  }

  if (PATH === "NONE") {
    console.log("connect-only health check (no frame sent)");
    await sleep(1500);
    try { if (inEp) inEp.stopPoll(); } catch {}
    iface.release(() => device.close());
    console.log("done (connect-only)");
    return;
  }

  console.log(`-> ${PATH} frame`);
  let payload: Buffer;
  if (PATH === "DRA") {
    // 32-byte header CONCATENATED with data as one continuous stream (size field = dataLen+32).
    const hd = Buffer.alloc(32);
    Buffer.from([0x43,0x52,0x54,0x00,0x00,0x44,0x52,0x41]).copy(hd,0);
    Buffer.from(be32(data.length+32)).copy(hd,8);
    Buffer.from(be16(0)).copy(hd,12);
    Buffer.from(be16(0)).copy(hd,14); Buffer.from(be16(0)).copy(hd,16);
    Buffer.from(be16(W)).copy(hd,18); Buffer.from(be16(H)).copy(hd,20);
    payload = Buffer.concat([hd, data]);
  } else {
    // LOG: header is a separate CRT command, then raw data.
    await send(cmd([0x4c,0x4f,0x47, ...be32(data.length), 0x01]));
    payload = data;
  }
  let reports = 0;
  for (let off = 0; off < payload.length; off += PKT) { await send(padTo(payload.subarray(off, off+PKT), PKT)); reports++; }
  if (!process.argv.includes("noulend")) { await send(cmd(S("ULEND"))); console.log("  + ULEND"); }
  if (!process.argv.includes("nostp")) { await send(cmd([0x53,0x54,0x50,0x21,0x23])); console.log("  + STP!#"); } // STP!#
  await sleep(300);
  await send(cmd([0x4c,0x49,0x47,0x00,0x00,0xff]));
  const HOLD = Number(process.env.HOLD ?? 15000);
  console.log(`sent ${PATH} + ${reports} reports + ULEND + STP!# + brightness`);
  console.log(`HOLDING connection for ${HOLD}ms — WATCH THE SCREEN NOW (release happens after)`);
  await sleep(HOLD);
  console.log("releasing (this may reset the device)...");
  try { if (inEp) inEp.stopPoll(); } catch {}
  iface.release(() => device.close());
  console.log("done");
}
main().catch((e) => { console.error(e); process.exit(1); });