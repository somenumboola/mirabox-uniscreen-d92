import { EventEmitter } from "node:events";
import { HidBackend } from "./hid-backend";
import {
  VID, PID, SCREEN_WIDTH, SCREEN_HEIGHT, OUTPUT_REPORT_SIZE,
  packet, chunk, drawHeader, Commands,
} from "./protocol";

export interface D92Options {
  vid?: number;
  pid?: number;
  path?: string;
}

/**
 * High-level MiraBox D92 driver (HID transport via node-hid).
 *
 * CONFIRMED working over this transport (no sudo):
 *   - open/close, getFirmwareVersion, setBrightness, wakeScreen, clearScreen, connect
 *
 * IMAGE/DISPLAY (setImage) is NOT yet functional: see
 * docs/superpowers/notes/d92-protocol-findings.md. Two unsolved pieces:
 *   1. macOS hidapi routes large output reports via the control endpoint and DROPS them;
 *      bulk frames must go over the interrupt-OUT endpoint (proven with libusb + sudo).
 *   2. The device gates on-screen *presentation* behind a stateful activation sequence
 *      not yet reverse-engineered (a USB capture of the official app is the path to it).
 * The frame-building helpers (drawHeader / Commands.logo / Commands.keyImage) are correct
 * and unit-tested; only the transport+present wiring is pending.
 *
 * Emits: "data" (input reports), "error".
 */
export class D92 extends EventEmitter {
  static readonly WIDTH = SCREEN_WIDTH;
  static readonly HEIGHT = SCREEN_HEIGHT;

  private readonly backend: HidBackend;

  constructor(opts: D92Options = {}) {
    super();
    this.backend = new HidBackend({ vid: opts.vid ?? VID, pid: opts.pid ?? PID, path: opts.path });
    this.backend.on("data", (b) => this.emit("data", b));
    this.backend.on("error", (e) => this.emit("error", e));
  }

  /** List connected D92 devices (one entry per HID usage collection). */
  static list() {
    return HidBackend.list(VID, PID);
  }

  open(): this {
    this.backend.open();
    return this;
  }

  close(): void {
    this.backend.close();
  }

  // --- info ---

  /** Read the hardware/firmware version, e.g. "V25.D92.02.012". */
  getFirmwareVersion(): string {
    // Feature report id 1 returns the 15-byte version string (no report-id prefix).
    const buf = this.backend.getFeatureReport(0x01, 64);
    return buf.toString("latin1").replace(/\0+$/, "").trim();
  }

  // --- session / control (confirmed) ---

  /** D92 handshake. Note: resets the device's display (it re-initializes). */
  connect(): void {
    this.backend.write(packet(Commands.connect()));
  }

  wakeScreen(): void {
    this.backend.write(packet(Commands.wake()));
  }

  /** Set screen brightness (0..255; device range is narrow but functional). */
  setBrightness(value: number): void {
    const v = Math.max(0, Math.min(0xff, Math.round(value)));
    this.backend.write(packet(Commands.brightness(v)));
  }

  /** Clear the screen (target 0xff = all). */
  clearScreen(): void {
    this.backend.write(packet(Commands.clear(0xff)));
  }

  /** Commit/refresh ("STP!#"). */
  refresh(): void {
    this.backend.write(packet(Commands.finish()));
  }

  // --- image (EXPERIMENTAL — see class docs; not yet presenting on macOS) ---

  /**
   * Build and send a full-screen frame via the DRA region path. The framing is correct,
   * but on macOS the bulk data is dropped by hidapi's control routing and the device's
   * presentation is gated by an unsolved activation step. Kept for completeness / for use
   * once the present sequence is captured. `raw` must be the 1920x462 frame data.
   */
  sendFrameExperimental(raw: Buffer, rect = { x: 0, y: 0, w: SCREEN_WIDTH, h: SCREEN_HEIGHT, flag: 0 }): void {
    const stream = Buffer.concat([drawHeader(raw.length, rect), raw]);
    for (const c of chunk(stream, OUTPUT_REPORT_SIZE)) this.backend.write(c);
    this.backend.write(packet(Commands.uploadFinished()));
    this.backend.write(packet(Commands.finish()));
  }
}