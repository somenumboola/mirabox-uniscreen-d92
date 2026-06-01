// Capture what the device REPLIES on the interrupt-IN endpoint (0x82) during the
// connect/version exchange. The reply is likely the challenge/info the host must
// consume to enter display mode. Run with sudo; PASTE THE CONSOLE OUTPUT.
//   sudo npx tsx scripts/probe-readin.ts
import * as usb from "usb";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PKT = 1024;
const padTo = (b: number[]) => { const o = Buffer.alloc(PKT); Buffer.from(b).copy(o); return o; };
const cmd = (body: number[]) => padTo([0x43, 0x52, 0x54, 0x00, 0x00, ...body]);
const S = (s: string) => [...Buffer.from(s, "latin1")];

async function main() {
  const device = usb.findByIds(0x5548, 0x1011);
  if (!device) { console.error("not found"); return; }
  device.open();
  const iface = device.interfaces![0];
  if (iface.isKernelDriverActive()) { try { iface.detachKernelDriver(); } catch {} }
  iface.claim();
  const outEp = iface.endpoints.find((e) => e.direction === "out") as usb.OutEndpoint;
  const inEp = iface.endpoints.find((e) => e.direction === "in") as usb.InEndpoint;
  outEp.transferType = usb.usb.LIBUSB_TRANSFER_TYPE_INTERRUPT;
  inEp.transferType = usb.usb.LIBUSB_TRANSFER_TYPE_INTERRUPT;
  console.log("OUT", outEp.address, "IN", inEp.address);

  let count = 0;
  inEp.on("data", (d: Buffer) => {
    count++;
    const ascii = d.toString("latin1").replace(/[^\x20-\x7e]/g, ".");
    console.log(`IN[${count}] len=${d.length} hex=${d.subarray(0, 40).toString("hex")} ascii="${ascii.slice(0, 48)}"`);
  });
  inEp.on("error", (e) => console.log("IN err", (e as Error).message));
  inEp.startPoll(8, 512);

  const out = (label: string, body: number[]) => { console.log("OUT ->", label); return new Promise<void>((res) => outEp.transfer(padTo([0x43,0x52,0x54,0x00,0x00,...body]), () => res())); };

  await sleep(300);
  await out("DIS (wake)", S("DIS")); await sleep(800);
  await out("CONNECT", S("CONNECT")); await sleep(2500);
  await out("VER", S("VER")); await sleep(2000);
  await out("DIS again", S("DIS")); await sleep(1500);

  console.log(`\nTOTAL replies: ${count}`);
  inEp.stopPoll(() => iface.release(() => device.close()));
}
main().catch((e) => { console.error(e); process.exit(1); });