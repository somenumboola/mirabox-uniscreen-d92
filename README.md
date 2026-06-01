# MiraBox D92 (UNI screen) — macOS reverse-engineering

> This fork adds a macOS/Node driver for the **MiraBox D92** USB telemetry screen
> (VID `0x5548` / PID `0x1011`, a 1920×462 wide-bar display), reverse-engineered from
> the Windows-only "MiraBox Craft" app. The original StreamDock notes follow below.

## D92 status

**Working now** (over HID, no `sudo`) — see `src/d92/` and run `npm start`:

- `getFirmwareVersion()` → e.g. `V25.D92.02.012`
- `setBrightness(0..255)`, `wakeScreen()`, `clearScreen()`, `connect()` (handshake), `refresh()`

```ts
import { D92 } from "./src/d92";
const d = new D92().open();
console.log(d.getFirmwareVersion());
d.wakeScreen();
d.setBrightness(0xff);
d.clearScreen();
d.close();
```

**Not yet working: on-screen image/telemetry display.** Two pieces remain (details in
`docs/superpowers/notes/d92-protocol-findings.md`):

1. **Transport (solved, needs wiring):** macOS hidapi routes large output reports through
   the control endpoint and *drops* them. Bulk frames must go over the **interrupt-OUT
   endpoint (0x01) at 1024-byte alignment** — proven with libusb (`scripts/probe-libusb.ts`,
   needs `sudo`), but libusb's claim/release resets the device on macOS.
2. **Presentation (open):** the device acknowledges frames but gates actual display behind a
   stateful activation/connect sequence not yet reverse-engineered. The remaining step is a
   short **USB capture** of the official app pushing one frame — see
   `docs/superpowers/specs/` and the findings doc. The full command vocabulary, resolution,
   pixel formats, and `DRA`/`LOG`/`BAT` framing are already known and unit-tested
   (`src/d92/protocol.ts`, `npm test`).

The `scripts/probe-*.ts` files are the reverse-engineering probes used to get here.

---

# MiraBox StreamDock reverse-engineer

The MiraBox StreamDock has semi-oss drivers that have the USB HID logic inside a pre-compiled library. Out of curiousity, I reverse engineered the USB packets and wrote this demo to show how one might control the device directly without the official drivers.

![MiraBox StreamDock running this demo](https://github.com/user-attachments/assets/f2c56dfb-0cb7-40cc-9816-999c73a06d31)

This is just an experiment, and possibly has some bugs, and potential for improvements.

## Supported Functions

- read firmware version
- wake screen
- clear screen
- refresh
- set brightness
- set key image
- set boot image
- receive key presses

> **Note:** Only tested on **MiraBox 293**.

## API

```ts
import { StreamDock, USBBackend } from "./streamdock";

interface USBBackend {
  send(data: Buffer): Promise<void>;
  receive(byteSize?: number): Promise<Buffer>;
  controlTransfer(
    bmRequestType: number,
    bRequest: number,
    wValue: number,
    wIndex: number,
    wLength: number
  ): Promise<Buffer | number | undefined>;
}

const backend: USBBackend;
const sd = new StreamDock(backend);

console.log(await sd.getFirmwareVersion());
await sd.wakeScreen();
await sd.clearScreen();
await sd.setBrightness(0x19);
await sd.setKeyImage(i, path.join(process.cwd(), "test1.png"));
await sd.setBootImage(path.join(process.cwd(), "logo.jpg"));

while (true) {
  const { keyId, state } = await sd.receiveKeyPress();
  console.log("Key", keyId, "state", state);
}
```

See [Main Demo](./src/index.ts) for a concrete example.

## Run the repo

1. clone
1. `npm install`
1. `npm start`

> **Note**: on macos, I need to run `sudo npm start` to be able to access the usb HID device.
