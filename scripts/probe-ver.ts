// Capture device replies to HANC and VER (firmware version) via the async
// event channel. The firmware string likely reveals the device model needed
// for the real handshake identifier ("StreamDock[<model>]").
import { HID, devices } from "node-hid";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pad = (b: number[]) => { const o = Buffer.alloc(1024); Buffer.from(b).copy(o); return o; };
const pkt = (body: number[]) => pad([0x43, 0x52, 0x54, 0x00, 0x00, ...body]);

async function main() {
  const m = devices().find((d: any) => d.vendorId === 0x5548 && d.productId === 0x1011);
  if (!m?.path) throw new Error("D92 not found");
  const dev = new HID(m.path);

  dev.on("data", (b: Buffer) => {
    const ascii = b.toString("latin1").replace(/[^\x20-\x7e]/g, ".");
    console.log(`IN[${b.length}] hex=${b.subarray(0, 32).toString("hex")}  ascii="${ascii.slice(0, 40)}"`);
  });
  dev.on("error", (e) => console.log("ERR", e));
  const send = (label: string, buf: Buffer) => { console.log("OUT ->", label); dev.write([0x00, ...buf]); };

  await sleep(300);
  send("HANC", pad([0x48, 0x41, 0x4e, 0x43]));
  await sleep(1500);
  send("VER (CRT..VER)", pkt([0x56, 0x45, 0x52]));
  await sleep(1500);
  // try a couple of other query opcodes that might return device info
  send("DC (CRT..DC)", pkt([0x44, 0x43]));
  await sleep(1000);
  send("VER again", pkt([0x56, 0x45, 0x52]));
  await sleep(1500);

  console.log("closing");
  dev.close();
}
main().catch((e) => { console.error(e); process.exit(1); });