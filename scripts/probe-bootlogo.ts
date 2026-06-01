// Set the BOOT LOGO using the actual vendor JPEG via the LOG path, as JPEG
// (not raw), with correct 1024-byte output reports. Verify by power-cycling.
//   wake -> HANC -> LOG(jpegLen)+01 -> jpeg in 1024B reports -> ULEND -> STP!#
import { readFileSync } from "node:fs";
import { HID, devices } from "node-hid";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const JPG = process.argv[2] ?? "/Volumes/Home/MIRA/MiraBoxCraft/CoreConfiguration/logoCrossD92.jpg";
const FLAG = Number(process.argv[3] ?? 1);

const PACKET = 1024; // device OUTPUT report size
const pad = (b: number[] | Buffer) => { const o = Buffer.alloc(PACKET); Buffer.from(b).copy(o); return o; };
const pkt = (body: number[]) => pad([0x43, 0x52, 0x54, 0x00, 0x00, ...body]);
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

async function main() {
  const jpeg = readFileSync(JPG);
  console.log(`boot logo JPEG ${JPG}: ${jpeg.length} bytes, flag=${FLAG}`);

  const m = devices().find((d: any) => d.vendorId === 0x5548 && d.productId === 0x1011);
  if (!m?.path) throw new Error("D92 not found");
  const dev = new HID(m.path);
  dev.on("data", (b: Buffer) => console.log("IN <-", b.subarray(0, 16).toString("hex"), `"${b.subarray(0,8).toString("latin1").replace(/[^\x20-\x7e]/g,".")}"`));
  const send = (buf: Buffer) => dev.write([0x00, ...buf]);

  send(pkt([0x44, 0x49, 0x53])); await sleep(150);            // wake
  send(pkt([0x4c, 0x49, 0x47, 0x00, 0x00, 0xff]));            // bright
  send(pad([0x48, 0x41, 0x4e, 0x43])); await sleep(2500);     // HANC
  send(pkt([0x4c, 0x49, 0x47, 0x00, 0x00, 0xff]));

  send(pkt([0x4c, 0x4f, 0x47, ...be32(jpeg.length), FLAG]));  // LOG + jpegLen + flag
  let reports = 0;
  for (let off = 0; off < jpeg.length; off += PACKET) { send(pad(jpeg.subarray(off, off + PACKET))); reports++; }
  send(pkt([0x55, 0x4c, 0x45, 0x4e, 0x44]));                  // ULEND
  send(pkt([0x53, 0x54, 0x50, 0x21, 0x23]));                  // STP!#
  console.log(`sent LOG(jpeg) + ${reports} reports + ULEND + STP!#`);

  await sleep(1500);
  dev.close();
  console.log("done — now POWER-CYCLE the device to check the boot logo");
}

main().catch((e) => { console.error(e); process.exit(1); });