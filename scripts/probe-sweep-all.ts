// Systematic sweep WITH the activation handshake, correct 1920x462 + 1024B reports.
// Handshakes once, then tries each combo with a DISTINCT SOLID COLOR so you can
// identify which combo renders by the color you see. Announces each before sending.
//
// Combos: path (LOG/BAT/DRA) x format (jpeg/rgb565le/rgb565be/bgr888) x flag/mode.
import { Jimp } from "jimp";
import { HID, devices } from "node-hid";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const W = 1920, H = 462, PACKET = 1024;
const HOLD = Number(process.argv[2] ?? 5000);

const pad = (b: number[] | Buffer) => { const o = Buffer.alloc(PACKET); Buffer.from(b).copy(o); return o; };
const pkt = (body: number[]) => pad([0x43, 0x52, 0x54, 0x00, 0x00, ...body]);
const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const rgba = (r: number, g: number, b: number) => ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0;

const COLORS: Record<string, [number, number, number]> = {
  RED: [255, 0, 0], GREEN: [0, 255, 0], BLUE: [0, 0, 255], YELLOW: [255, 255, 0],
  CYAN: [0, 255, 255], MAGENTA: [255, 0, 255], WHITE: [255, 255, 255], ORANGE: [255, 140, 0],
  PURPLE: [150, 0, 255], PINK: [255, 105, 180], LIME: [180, 255, 0], TEAL: [0, 180, 180],
};

async function encode(format: string, color: [number, number, number]): Promise<Buffer> {
  const img = new Jimp({ width: W, height: H, color: rgba(...color) });
  if (format === "jpeg") return img.getBuffer("image/jpeg", { quality: 90 });
  const bpp = format.startsWith("rgb565") ? 2 : 3;
  const buf = Buffer.alloc(W * H * bpp); let i = 0;
  const [r, g, b] = color;
  for (let p = 0; p < W * H; p++) {
    if (format === "bgr888") { buf[i++] = b; buf[i++] = g; buf[i++] = r; }
    else if (format === "rgb888") { buf[i++] = r; buf[i++] = g; buf[i++] = b; }
    else { const v = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
      if (format === "rgb565be") { buf[i++] = (v >> 8) & 0xff; buf[i++] = v & 0xff; }
      else { buf[i++] = v & 0xff; buf[i++] = (v >> 8) & 0xff; } }
  }
  return buf;
}

// path: "LOG" | "BAT" | "DRA"
async function sendUpload(send: (b: Buffer) => void, path: string, format: string, flag: number, data: Buffer) {
  if (path === "DRA") {
    const hd = Buffer.alloc(32);
    Buffer.from([0x43,0x52,0x54,0x00,0x00,0x44,0x52,0x41]).copy(hd, 0);
    Buffer.from(be32(data.length + 32)).copy(hd, 8);
    Buffer.from(be16(flag)).copy(hd, 12);
    Buffer.from(be16(0)).copy(hd, 14); Buffer.from(be16(0)).copy(hd, 16);
    Buffer.from(be16(W)).copy(hd, 18); Buffer.from(be16(H)).copy(hd, 20);
    send(pad(hd));
  } else if (path === "LOG") {
    send(pkt([0x4c, 0x4f, 0x47, ...be32(data.length), flag || 1]));
  } else { // BAT
    send(pkt([0x42, 0x41, 0x54, ...be32(data.length), flag])); // flag as index
  }
  for (let off = 0; off < data.length; off += PACKET) send(pad(data.subarray(off, off + PACKET)));
  send(pkt([0x55, 0x4c, 0x45, 0x4e, 0x44]));     // ULEND
  send(pkt([0x53, 0x54, 0x50, 0x21, 0x23]));     // STP!#
  send(pkt([0x4c, 0x49, 0x47, 0x00, 0x00, 0xff])); // brightness
}

interface Combo { path: string; format: string; flag: number; mode: number; color: string; }
const COMBOS: Combo[] = [
  { path: "DRA", format: "rgb565le", flag: 0,   mode: -1, color: "RED" },
  { path: "DRA", format: "rgb565le", flag: 255, mode: -1, color: "GREEN" },
  { path: "DRA", format: "jpeg",     flag: 0,   mode: -1, color: "BLUE" },
  { path: "DRA", format: "bgr888",   flag: 0,   mode: -1, color: "YELLOW" },
  { path: "DRA", format: "rgb565le", flag: 0,   mode: 1,  color: "CYAN" },
  { path: "DRA", format: "jpeg",     flag: 0,   mode: 1,  color: "MAGENTA" },
  { path: "BAT", format: "jpeg",     flag: 0,   mode: -1, color: "WHITE" },
  { path: "BAT", format: "rgb565le", flag: 0,   mode: -1, color: "ORANGE" },
  { path: "LOG", format: "jpeg",     flag: 1,   mode: -1, color: "PURPLE" },
  { path: "LOG", format: "rgb565le", flag: 1,   mode: -1, color: "PINK" },
  { path: "LOG", format: "bgr888",   flag: 1,   mode: -1, color: "LIME" },
];

async function main() {
  const m = devices().find((d: any) => d.vendorId === 0x5548 && d.productId === 0x1011);
  if (!m?.path) throw new Error("D92 not found");
  const dev = new HID(m.path);
  dev.on("data", (b: Buffer) => console.log("   IN <-", b.subarray(0, 12).toString("hex"), `"${b.subarray(0,8).toString("latin1").replace(/[^\x20-\x7e]/g,".")}"`));
  const send = (buf: Buffer) => dev.write([0x00, ...buf]);

  // ---- ACTIVATION handshake (once) ----
  console.log("ACTIVATE: wake + brightness + HANC + VER");
  send(pkt([0x44, 0x49, 0x53])); await sleep(200);
  send(pkt([0x4c, 0x49, 0x47, 0x00, 0x00, 0xff])); await sleep(200);
  send(pad([0x48, 0x41, 0x4e, 0x43])); await sleep(3000);     // HANC, settle
  send(pkt([0x56, 0x45, 0x52])); await sleep(500);            // VER firmware query
  send(pkt([0x4c, 0x49, 0x47, 0x00, 0x00, 0xff]));

  let n = 0;
  for (const c of COMBOS) {
    n++;
    if (c.mode >= 0) send(pkt([0x4d, 0x4f, 0x44, 0x00, 0x00, c.mode]));
    const data = await encode(c.format, COLORS[c.color]);
    console.log(`\n>>> COMBO ${n}/${COMBOS.length}: ${c.path} ${c.format} flag=${c.flag} mode=${c.mode} => expect ${c.color} (${data.length}B) <<<`);
    await sendUpload(send, c.path, c.format, c.flag, data);
    await sleep(HOLD);
  }

  dev.close();
  console.log("\nsweep done");
}
main().catch((e) => { console.error(e); process.exit(1); });