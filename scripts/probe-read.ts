// Capture what the D92 sends back. Sends handshake, then reads input reports
// for several seconds, logging every response. Also queries firmware via the
// 293-style sequence to see if the device replies.
import { HID, devices } from "node-hid";

const VID = 0x5548;
const PID = 0x1011;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pad = (b: number[]) => { const o = Buffer.alloc(512); Buffer.from(b).copy(o); return o; };
const pkt = (body: number[]) => pad([0x43, 0x52, 0x54, 0x00, 0x00, ...body]);

async function main() {
  const m = devices().find((d: any) => d.vendorId === VID && d.productId === PID);
  if (!m?.path) throw new Error("D92 not found");
  const dev = new HID(m.path);

  let count = 0;
  dev.on("data", (b: Buffer) => {
    count++;
    const hex = b.toString("hex");
    const ascii = b.toString("latin1").replace(/[^\x20-\x7e]/g, ".");
    console.log(`IN[${count}] len=${b.length} hex=${hex.slice(0, 64)} ascii="${ascii.slice(0, 32)}"`);
  });
  dev.on("error", (e) => console.log("ERR", e));

  const send = (label: string, buf: Buffer) => { console.log("OUT ->", label); dev.write([0x00, ...buf]); };

  await sleep(300);
  send("HANC handshake", pad([0x48, 0x41, 0x4e, 0x43]));
  await sleep(2000);
  send("DIS wake", pkt([0x44, 0x49, 0x53]));
  await sleep(500);
  send("get firmware? (CRT + 'DC')", pkt([0x44, 0x43]));
  await sleep(1000);
  send("CLE clear", pkt([0x43, 0x4c, 0x45, 0x00, 0x00, 0x00, 0xff]));
  await sleep(2000);

  console.log(`total input reports: ${count}`);
  dev.close();
}

main().catch((e) => { console.error(e); process.exit(1); });