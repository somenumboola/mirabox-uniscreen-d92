// Stark brightness contrast test: MAX (5s) then MIN (5s), repeated 4x (~40s).
// Makes any backlight change unmistakable and confirms the LIG opcode/range.
import { HidBackend } from "../src/d92/hid-backend";
import { packet, Commands } from "../src/d92/protocol";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MAX = 0xff; // try full; if 0..100 range, 0xff is clamped high anyway
const MIN = 0x00;
const HOLD = 5000;
const CYCLES = 4;

async function main() {
  const be = new HidBackend({ vid: 0x5548, pid: 0x1011 });
  be.on("data", (b: Buffer) => console.log("IN <-", b.subarray(0, 16).toString("hex")));
  be.open();
  console.log("opened; sending wake");
  be.write(packet(Commands.wake()));
  await sleep(500);

  for (let i = 1; i <= CYCLES; i++) {
    console.log(`cycle ${i}/${CYCLES}: MAX (0x${MAX.toString(16)}) — hold 5s`);
    be.write(packet(Commands.brightness(MAX)));
    await sleep(HOLD);
    console.log(`cycle ${i}/${CYCLES}: MIN (0x${MIN.toString(16)}) — hold 5s`);
    be.write(packet(Commands.brightness(MIN)));
    await sleep(HOLD);
  }

  be.close();
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});