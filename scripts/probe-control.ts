// Try the CONTROL endpoint (HID GET_REPORT / class requests) for the firmware /
// activation exchange — the 293 read firmware via controlTransfer(0xa1,0x01,...).
// Run with sudo; PASTE THE CONSOLE OUTPUT.
//   sudo npx tsx scripts/probe-control.ts
import * as usb from "usb";

const ctrl = (device: any, bmReqType: number, bReq: number, wValue: number, wIndex: number, len: number) =>
  new Promise<Buffer | undefined>((res) => {
    device.controlTransfer(bmReqType, bReq, wValue, wIndex, len, (err: any, data: Buffer) => {
      if (err) { console.log(`  ctrl(0x${bmReqType.toString(16)},0x${bReq.toString(16)},0x${wValue.toString(16)}) ERR: ${err.message}`); res(undefined); }
      else { const a = (data ?? Buffer.alloc(0)).toString("latin1").replace(/[^\x20-\x7e]/g, "."); console.log(`  ctrl(0x${bmReqType.toString(16)},0x${bReq.toString(16)},0x${wValue.toString(16)}) -> len=${data?.length} hex=${data?.subarray(0,32).toString("hex")} ascii="${a.slice(0,40)}"`); res(data); }
    });
  });

async function main() {
  const device: any = usb.findByIds(0x5548, 0x1011);
  if (!device) { console.error("not found"); return; }
  device.open();
  const iface = device.interfaces![0];
  if (iface.isKernelDriverActive()) { try { iface.detachKernelDriver(); } catch {} }
  iface.claim();

  // HID class GET_REPORT (bmRequestType 0xA1, bRequest 0x01).
  // wValue high byte = report type (1=Input,3=Feature), low byte = report id.
  console.log("=== GET_REPORT (Input, various report ids) ===");
  for (const rid of [0x00, 0x01]) await ctrl(device, 0xa1, 0x01, 0x0100 | rid, 0, 512);
  console.log("=== GET_REPORT (Feature) ===");
  for (const rid of [0x00, 0x01]) await ctrl(device, 0xa1, 0x01, 0x0300 | rid, 0, 512);
  console.log("=== standard GET_DESCRIPTOR(string) sanity ===");
  await ctrl(device, 0x80, 0x06, 0x0301, 0x0409, 255);

  iface.release(() => device.close());
  console.log("done");
}
main().catch((e) => { console.error(e); process.exit(1); });