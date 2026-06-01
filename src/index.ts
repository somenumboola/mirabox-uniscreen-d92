// MiraBox D92 demo — exercises the confirmed-working operations over HID (no sudo).
// Image/display is not yet functional; see docs/superpowers/notes/d92-protocol-findings.md.
import { D92 } from "./d92";

async function main() {
  const found = D92.list();
  if (found.length === 0) {
    console.error("No D92 found (VID 0x5548 / PID 0x1011). Detected:", D92.list());
    return;
  }
  console.log("Found D92:", found.map((d) => `${d.product} usage=${d.usage}`).join(", "));

  const d92 = new D92().open();
  d92.on("error", (e) => console.error("device error:", e));

  console.log("firmware:", d92.getFirmwareVersion());

  d92.wakeScreen();
  for (const level of [0x00, 0xff, 0x80]) {
    d92.setBrightness(level);
    console.log("brightness ->", level);
    await new Promise((r) => setTimeout(r, 700));
  }
  d92.clearScreen();

  console.log("done (brightness/wake/clear confirmed; image display pending — see findings doc)");
  d92.close();
}

main().catch(console.error);
