// Determine whether the HANC handshake causes the D92 to re-enumerate on USB.
// Sends HANC, then polls the HID device list for ~8s, logging when the D92
// disappears and reappears (and whether its path changes).
import { HID, devices } from "node-hid";

const VID = 0x5548;
const PID = 0x1011;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const list = () => devices().filter((d: any) => d.vendorId === VID && d.productId === PID);
const snap = () => list().map((d: any) => `${d.path}|usage=${d.usage}`).sort().join(",");

async function main() {
  const before = snap();
  console.log("BEFORE handshake:", before || "(none)");
  const m = list()[0];
  if (!m?.path) throw new Error("D92 not found");

  const dev = new HID(m.path);
  console.log("opened; sending HANC handshake");
  dev.write([0x00, 0x48, 0x41, 0x4e, 0x43, ...new Array(508).fill(0)]);
  // Close our handle right away so it doesn't mask a re-enumeration.
  try { dev.close(); } catch {}

  let last = before;
  for (let i = 0; i < 32; i++) {
    await sleep(250);
    const now = snap();
    if (now !== last) {
      console.log(`t+${((i + 1) * 250)}ms CHANGE:`, now || "(GONE)");
      last = now;
    }
  }
  console.log("AFTER 8s:", snap() || "(none)");
  console.log(before === snap() ? "RESULT: path set UNCHANGED" : "RESULT: device set CHANGED at some point");
}

main().catch((e) => { console.error(e); process.exit(1); });