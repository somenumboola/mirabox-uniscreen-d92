import { HidBackend } from "../src/d92/hid-backend";
import { packet, Commands } from "../src/d92/protocol";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const be = new HidBackend({ vid: 0x5548, pid: 0x1011 });
  be.on("data", (b: Buffer) => console.log("IN <-", b.subarray(0, 16).toString("hex")));
  be.open();
  console.log("opened");

  console.log("wake");
  be.write(packet(Commands.wake()));
  await sleep(500);

  for (const level of [0x05, 0x32, 0x64]) {
    console.log("brightness", level);
    be.write(packet(Commands.brightness(level)));
    await sleep(800);
  }

  console.log("clear all");
  be.write(packet(Commands.clear(0xff)));
  await sleep(500);

  console.log("refresh");
  be.write(packet(Commands.refresh()));
  await sleep(500);

  be.close();
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});