// Dump the D92 HID report descriptor and per-collection info, to find whether
// usage 1 vs usage 2 use different report IDs / output report sizes.
import { HID, devices } from "node-hid";

const VID = 0x5548, PID = 0x1011;

function parseReportIds(desc: Buffer) {
  // Walk HID report descriptor items, track Report ID (0x85) and
  // Input(0x81)/Output(0x91)/Feature(0xb1) main items + Usage Page/Usage.
  const ids: string[] = [];
  let i = 0, reportId = 0, usagePage = 0, usage = 0, reportSize = 0, reportCount = 0;
  const collections: string[] = [];
  while (i < desc.length) {
    const b = desc[i++];
    const type = (b >> 2) & 0x3, tag = (b >> 4) & 0xf, size = b & 0x3;
    const len = size === 3 ? 4 : size;
    let val = 0;
    for (let k = 0; k < len; k++) val |= desc[i + k] << (8 * k);
    i += len;
    if (type === 1 && tag === 0x0) usagePage = val;            // Usage Page (global)
    else if (type === 2 && tag === 0x0) usage = val;           // Usage (local)
    else if (type === 1 && tag === 0x7) reportSize = val;      // Report Size
    else if (type === 1 && tag === 0x9) reportCount = val;     // Report Count
    else if (type === 1 && tag === 0x8) { reportId = val; ids.push(`ReportID=0x${val.toString(16)}`); }
    else if (type === 0 && tag === 0xa) collections.push(`Collection usagePage=0x${usagePage.toString(16)} usage=0x${usage.toString(16)}`);
    else if (type === 0 && (tag === 0x8 || tag === 0x9 || tag === 0xb)) {
      const kind = tag === 0x8 ? "INPUT" : tag === 0x9 ? "OUTPUT" : "FEATURE";
      const bits = reportSize * reportCount;
      collections.push(`  ${kind} reportId=0x${reportId.toString(16)} size=${reportSize} count=${reportCount} => ${bits / 8} bytes`);
    }
  }
  return { ids, collections };
}

function main() {
  const matches = devices().filter((d: any) => d.vendorId === VID && d.productId === PID);
  console.log("D92 HID entries:");
  for (const d of matches) console.log(`  path=${d.path} usagePage=0x${d.usagePage?.toString(16)} usage=${d.usage}`);

  const m = matches[0];
  if (!m?.path) throw new Error("not found");
  const dev = new HID(m.path);
  let desc: Buffer | undefined;
  try { desc = (dev as any).getReportDescriptor?.(); } catch (e) { console.log("getReportDescriptor failed:", (e as Error).message); }
  if (desc) {
    console.log(`\nReport descriptor (${desc.length} bytes):`);
    console.log(desc.toString("hex").replace(/(.{2})/g, "$1 ").trim());
    const p = parseReportIds(desc);
    console.log("\nReport IDs seen:", p.ids.length ? p.ids.join(", ") : "(none → unnumbered, report id 0)");
    console.log("Main items:");
    p.collections.forEach((c) => console.log(c));
  } else {
    console.log("No report descriptor available from node-hid; will read via ioreg instead.");
  }
  dev.close();
}

main();