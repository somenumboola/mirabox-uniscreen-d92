# MiraBox D92 macOS Driver — Design

**Date:** 2026-06-01
**Status:** Approved (design); pending implementation plan
**Author:** Alexander Glushchenko (with Claude)

## Goal

Build a minimal macOS driver/library that can drive a **MiraBox D92** USB telemetry
screen: open it, handshake, set brightness, wake/clear, and display an arbitrary
image at the screen's native resolution. Secondary goal: get the existing edited
repo (`src/`, with the D92 VID/PID) actually working against the device. Stretch
goal: gather macOS system telemetry (CPU/GPU/RAM) and render it to the screen like
the official Windows app.

The official software is **Windows-only** (Qt5 app, internally `DownLoadTool`,
"MiraBox Craft" / "Mirabox Space", version 2025.07.09). This project reverse-engineers
the device protocol for macOS.

## Device facts (confirmed)

- Enumerates as `HOTSPOTEKUSB HID DEMO`, **VID `0x5548` / PID `0x1011`**, serial
  `C511D3784329`, USB full-speed (480 Mb/s).
- **HID device**, vendor-defined: `UsagePage = 0xFFA0`, Usages 1 & 2.
- `MaxInputReportSize = 512`; `MaxFeatureReportSize = 0` (no feature reports).
- Same vendor family as the StreamDock 293 that the base repo targeted.

## Protocol facts (from `SDLibrary1.dll`, extracted from the installer)

The installer (`MiraBox_Craft-Installer_Window.exe`) is a Qt5 "DownLoadTool" that
bundles the app as numbered PE resources under `DOWNLOADTOOLPACK/`. Resource `123`
is **`SDLibrary1.dll`** — the unstripped C++ HID-protocol library (PDB path
`F:\STreamDock\Gitee\...\release\5.15.2\SDLibrary1.pdb`, Qt 5.15.2). Copied to
`/tmp/SDLibrary1.dll` for analysis (also app exes at `/tmp/app102.exe`, `/tmp/app139.exe`).

Key structure:

- **Two device families** in the library:
  - `SDDeviceWinUSB` / `SDWinUSB` — older WinUSB transport (the 293).
  - `SDGeneralDevice` / `SDGeneralReadThread` / `SDGeneralWriteThread` — **generic
    HID transport** (operates on `hid_device_` handles, i.e. hidapi). **The D92 uses
    this path** (it enumerates as HID).
- `SDDevice` builds command payloads (shared across transports): `addHandshakePack`,
  `addWakeUpScreenPack`, `addScreenOffPack`, `addAdjustBrightnessPack`,
  `addClearAllCommand`, `addClearCommand`, `addFinishCommand`, `addHeartbeatPack`,
  `appendSendData(ImageStruct)` (image push), `getLogoSizeCommand`,
  `getUploadFinishedCommand`, `getSecondaryScreenPicInfo`.
- `SDGeneralDevice` HID API: `openDevice(...)`, `appendData(QByteArray, SDGeneralHidReport, bool)`,
  `sendFeatureReport`, `getInputReport`, `devicePID`/`deviceVID`/`deviceReportID`,
  `setMaxOutputPacket`/`setMaxFeaturePacket`/`setMaxPacket`.
- **Command family is the same CRT protocol** as the 293 (`CRT` prefix; markers
  `LIG`/`CLE`/`DIS`/`STP`/`BAT`/`LOG`; `ACK`/`OK` responses), shipped over HID
  writes instead of libusb interrupt transfers.
- **Image format: JPEG** (app accepts jpg/jpeg/png; device receives JPEG). 512-byte
  packet model.

### Reference: the existing 293 CRT protocol (`src/streamdock.ts`)

- `CMD_PREFIX = [0x43,0x52,0x54,0x00,0x00]` (`CRT\0\0`)
- `LIG` (brightness), `CLE` (clear, target byte), `DIS` (wake), `STP` (refresh/stop),
  `BAT` (key image: 4-byte size + keyId), `LOG` (boot/full image).
- Packets padded to 512 bytes; images chunked at 512.

## Reverse-engineering approach

- **A — Live probing (primary).** Device is connected to this Mac. Use `node-hid`,
  adapt the 293 CRT commands to HID, observe the screen. Library symbols guide the
  command set; bytes confirmed empirically.
- **B — Static disassembly (fallback).** If probing stalls, install radare2/Ghidra
  and decompile `SDDevice::addHandshakePack`, `getLogoSizeCommand`, brightness/clear
  builders to read exact bytes + native resolution. (`objdump`/`otool`/`nm` already
  present for raw disassembly.)
- **C — Live USB capture from the Windows app (last resort).** Most ground-truth but
  requires sourcing a Windows machine to run the app — time-consuming; only if A and
  B both fail.

## Architecture

Switch transport from libusb (`usb`) to **`node-hid`** (hidapi), matching the official
library's `SDGeneralDevice` path. Benefits: native macOS support; typically no `sudo`
(improvement over the current libusb path).

- `src/hid-backend.ts` — open device by VID/PID `0x5548`/`0x1011`; `write()` output
  reports (handling the leading report-ID byte); `read()` 512-byte input reports.
  One clear job: move bytes to/from the HID device.
- `src/d92.ts` — `D92` device class: `handshake()`, `wakeScreen()`, `setBrightness()`,
  `clearScreen()`, `refresh()`/`finish()`, `setImage(image)` (resize → JPEG at native
  resolution), `heartbeat()`. Modeled on `SDDevice`'s command builders and the
  existing `streamdock.ts`. Depends only on the HID backend interface + Jimp.
- `src/streamdock.ts` — kept unchanged as reference.
- `src/index.ts` — demo wiring: enumerate, open, handshake, wake, brightness, clear,
  push a test image. Replaces the libusb setup.
- Image processing: reuse **Jimp** (already a dependency).
- Dependency change: add `node-hid`; `usb` may remain for reference but is no longer
  required by the D92 path.

## Data flow

```
index.ts → D92 (d92.ts) → builds CRT command QByteArray-equivalent Buffer
        → HID backend (hid-backend.ts) → node-hid write (output report, 512-byte chunks)
        → D92 screen

D92 screen → node-hid read (512-byte input report) → HID backend → D92 (ack/keypress n/a) → index.ts
```

## Milestones

1. Enumerate + open the D92 over node-hid; confirm read/write round-trip.
2. Handshake; read firmware/ack response.
3. Wake + brightness + clear → first visible "it's alive" reaction on the screen.
4. Determine native resolution (probe, or disassemble `getLogoSizeCommand`); push a
   full-screen JPEG and see it render.
5. *(Stretch)* macOS telemetry (CPU/GPU/RAM) rendered to the screen.

## Open questions / unknowns to resolve during implementation

- **Report-ID prefix byte:** node-hid/hidapi requires the first written byte to be the
  report ID (`0x00` if the device uses report ID 0). Confirm via `deviceReportID` logic
  and empirically.
- **Native screen resolution:** not conclusively found in strings (the 293 used
  800×480 full / 100×100 keys). Resolve by probing or disassembling `getLogoSizeCommand`.
- **Handshake bytes:** confirm whether D92's `addHandshakePack` differs from the 293.
- **HID chunk size:** 512 vs the device's actual output-report size.
- **Output report availability:** confirm the device exposes a writable output report
  (MaxFeatureReportSize is 0; writes go via output reports).

## Error handling

- Device-not-found: clear message listing detected HID devices (VID/PID).
- Open/permission failure: surface the OS error; note macOS HID permission caveats.
- Write/read failures: reject with the underlying error; no silent failures.
- Image too large / wrong dimensions: resize to native resolution before sending.

## Testing

- Manual/empirical against the connected device is the primary signal (visible screen
  state) given this is hardware reverse-engineering.
- Unit-test pure logic where it pays off: command-byte builders (assert exact bytes),
  image-packetization/chunking, report-ID prefixing.

## Out of scope (YAGNI)

- Key-press handling (the D92 has no keys).
- WinUSB / the 293 device path (kept only as reference).
- A GUI / layout editor like the official app.
- Windows/Linux support.