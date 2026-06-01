import HID from "node-hid";

const VID = 0x5548;
const PID = 0x1011;

const all = HID.devices();
const matches = all.filter((d) => d.vendorId === VID && d.productId === PID);

console.log(`Total HID devices: ${all.length}`);
console.log(`D92 matches: ${matches.length}\n`);

for (const d of matches) {
  console.log({
    path: d.path,
    manufacturer: d.manufacturer,
    product: d.product,
    serialNumber: d.serialNumber,
    interface: d.interface,
    usagePage: d.usagePage?.toString(16),
    usage: d.usage,
  });
}

// Try to open the first match and report what works.
const target = matches[0];
if (!target?.path) {
  console.error("No openable D92 path found.");
  process.exit(1);
}
try {
  const dev = new HID.HID(target.path);
  console.log("\nOpened OK via path.");
  dev.close();
} catch (e) {
  console.error("Open failed:", (e as Error).message);
}