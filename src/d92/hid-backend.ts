import { HID, devices } from "node-hid";
import { EventEmitter } from "node:events";
import { frame, DEFAULT_REPORT_ID } from "./protocol";

export interface HidMatch {
  path?: string;
  manufacturer?: string;
  product?: string;
  serialNumber?: string;
  usagePage?: number;
  usage?: number;
}

export interface HidBackendOptions {
  vid: number;
  pid: number;
  reportId?: number;
  /** Pick a specific collection when the device exposes multiple usages. */
  usage?: number;
  path?: string;
}

/** Thin node-hid wrapper. Frames every write with the HID report id. */
export class HidBackend extends EventEmitter {
  private dev?: HID;
  private readonly reportId: number;

  constructor(private readonly opts: HidBackendOptions) {
    super();
    this.reportId = opts.reportId ?? DEFAULT_REPORT_ID;
  }

  static list(vid?: number, pid?: number): HidMatch[] {
    return devices()
      .filter((d) => (vid == null || d.vendorId === vid) && (pid == null || d.productId === pid))
      .map((d) => ({
        path: d.path,
        manufacturer: d.manufacturer,
        product: d.product,
        serialNumber: d.serialNumber,
        usagePage: d.usagePage,
        usage: d.usage,
      }));
  }

  open(): void {
    if (this.dev) return;
    let path = this.opts.path;
    if (!path) {
      const matches = HidBackend.list(this.opts.vid, this.opts.pid).filter(
        (m) => this.opts.usage == null || m.usage === this.opts.usage
      );
      path = matches[0]?.path;
    }
    if (!path) {
      throw new Error(
        `D92 not found (vid=${this.opts.vid.toString(16)} pid=${this.opts.pid.toString(16)}). ` +
          `Detected: ${JSON.stringify(HidBackend.list(this.opts.vid, this.opts.pid))}`
      );
    }
    this.dev = new HID(path);
    this.dev.on("data", (buf: Buffer) => this.emit("data", buf));
    this.dev.on("error", (err: Error) => this.emit("error", err));
  }

  /** Write one already-built 512-byte packet (report id is added here). */
  write(packetBuf: Buffer): number {
    if (!this.dev) throw new Error("device not open");
    return this.dev.write([...frame(packetBuf, this.reportId)]);
  }

  /** Blocking read of one input report (default 512 bytes). */
  read(size = 512, timeoutMs = 1000): Buffer {
    if (!this.dev) throw new Error("device not open");
    const data = this.dev.readTimeout(timeoutMs);
    return Buffer.from(data.slice(0, size));
  }

  close(): void {
    this.dev?.close();
    this.dev = undefined;
  }
}