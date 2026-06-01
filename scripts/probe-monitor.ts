// READ-ONLY USB enumeration monitor. No writes, no claim, no sudo — just watches which
// devices appear/disappear (catches what a blinking device cycles as: 5548:1011 app vs
// 33C3:6677 ArtInChip Boot-ROM recovery, or a serial device). Runs ~25s.
import * as usb from "usb";

const WATCH = new Set(["5548:1011", "33c3:6677"]);
const seen = new Map<string, number>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function snapshot() {
  for (const d of usb.getDeviceList()) {
    const v = d.deviceDescriptor.idVendor, p = d.deviceDescriptor.idProduct;
    const key = `${v.toString(16).padStart(4, "0")}:${p.toString(16).padStart(4, "0")}`;
    // Highlight our device family / ArtInChip; also note anything new.
    if (v === 0x5548 || v === 0x33c3 || WATCH.has(key)) {
      const now = Date.now();
      const last = seen.get(key) ?? 0;
      if (now - last > 400) console.log(`[+] ${key}  (vid ${v.toString(16)} pid ${p.toString(16)})`);
      seen.set(key, now);
    }
  }
}

async function main() {
  console.log("Monitoring USB for D92 (5548:1011) and ArtInChip Boot-ROM (33c3:6677) ~25s...");
  console.log("Plug/keep the D92 connected to THIS Mac. Watching for blinks:\n");
  const tEnd = 25000;
  let elapsed = 0;
  while (elapsed < tEnd) {
    snapshot();
    await sleep(120);
    elapsed += 120;
  }
  console.log("\n--- distinct devices of interest seen ---");
  if (seen.size === 0) console.log("(none — D92 not enumerating on this Mac/port at all)");
  for (const k of seen.keys()) console.log("  " + k);
}
main().catch((e) => { console.error(e); process.exit(1); });