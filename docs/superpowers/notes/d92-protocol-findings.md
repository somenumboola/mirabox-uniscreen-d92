# D92 Protocol Findings (living log)

Confirmed facts discovered while probing/disassembling. Update as we learn.

| Item | Value | Source | Status |
|------|-------|--------|--------|
| VID / PID | 0x5548 / 0x1011 | enumeration | confirmed |
| Input report size | 512 | IOHID | confirmed |
| HID report ID | 0x00 | Task 5 | confirmed (commands take effect) |
| Output report size / chunk | 512 | Task 5 | confirmed (writes accepted) |
| Transport / framing | node-hid write of [0x00][CRT...512] | Task 5 | confirmed |
| Brightness (LIG) | CRT + [4c 49 47 00 00, value] | Task 5 | confirmed working |
| Wake (DIS) / Clear (CLE) / Refresh (STP) | inherited 293 opcodes | Task 5 | accepted; device reacts |
| Screen resolution | 1920 × 462 (wide bar, RGB565 likely) | manufacturer spec + binary analysis | confirmed (manufacturer) |
| Handshake bytes | TBD | Task 9 | pending |

## Notes
(append observations here, newest first)

### 2026-06-01 — Task 7: LOG = boot logo (persistent); live path = "DRA" (secondary screen)

- **Solid WHITE via LOG → still black live.** White is white in any RGB format, so the
  black is NOT a pixel-format issue: **`LOG` does not render to the live display.**
- **Power-cycle test:** after our LOG uploads, the device now BOOTS to black (no MiraBox
  logo) — i.e. `LOG` **overwrote the persistent boot/background image** in flash. So
  `LOG` = boot logo / stored full-screen image (shown at power-on), ACK'd but not live.
  (The last LOG write — solid white — should appear as the boot screen next power-on.)
- **Live-display command found:** `getSecondaryScreenPicInfo` (RVA 0x1e2f0) builds a packet
  with opcode `CRT` + **`DRA`** ("draw") followed by integer params; `sendSecondaryScreenPicInfo`
  signature is `(int size, byte flag, int x, int y, int w, int h)` — a **region blit**. This
  is the live telemetry-screen update path, not LOG.
- UNKNOWNS to finish the live path: coordinate int width/endianness, pixel format for the
  region data (JPEG vs raw 565/888), data framing, and whether `addModeChangedCommand`
  (RVA 0x19b80) must switch the device into live mode first.
- DECISION POINT: either (a) keep disassembling `sendSecondaryScreenPicInfo` to reconstruct
  the exact DRA byte layout, or (b) capture the official Windows app pushing one frame
  (Approach C) to read the live sequence definitively.

### 2026-06-01 — Task 7: Image upload at 1920×462 — device ACKs LOG, but screen black

Resolution 1920×462 (manufacturer). Findings from live probing:
- **`LOG` full-screen upload returns `"ACK\0\0OK"`** (hex `41434b00004f4b00...`) from the
  device — it ACCEPTS the LOG upload. Tested raw **BGR888** (2,661,120 B) and **RGB565-LE**
  (1,774,080 B); both ACK. Screen: backlight lights "as if about to show," then stays BLACK.
- **`BAT`+JPEG** upload at 1920×462 returns **no ACK**; screen stays black/logo.
- Sequence used: wake → HANC handshake (2.5s settle) → LOG(size)+flag01 → raw reports →
  ULEND → STP!#.
- HANC handshake causes a visible display reset (fade black → re-init → boot logo), but
  NO USB re-enumeration (HID path stable, verified by probe-handshake).
- HYPOTHESES for black-after-ACK: (a) `LOG` writes the **boot logo to flash** (shown only
  after power-cycle), and the *live* display uses a different path; (b) a **render/commit
  or mode-switch** command is still missing; (c) pixel format/flag still wrong.
- Probes added: probe-logo, probe-frame (bgr888/rgb888/rgb565le/rgb565be), probe-res-sweep,
  probe-handshake, probe-read. Resolution sweep (squares) showed only brief flashes.
- NEXT: power-cycle test (does a LOG upload appear as boot logo?); if LOG=boot-logo,
  find the live-display path; strong candidate to settle remaining unknowns = a USB capture
  of the official Windows app pushing one frame (Approach C).

### 2026-06-01 — Task 7/9: Real command opcodes extracted from DLL

Disassembled the SDDevice command builders (image base 0x180000000). Each builds a
QByteArray initialized to zeros and only writes the non-zero command chars, so the
`CRT\0\0` prefix is implicit (positions 3,4 left zero) — consistent with our working
CMD_PREFIX. Opcodes (ASCII, after the `CRT\0\0` prefix unless noted):

| Builder | RVA | Bytes (non-zero) | Interpreted command |
|---------|-----|------------------|---------------------|
| addHandshakePack | 0x184b0 | H A N C | `HANC` (NO CRT prefix; + a 15-len QString arg, maybe UUID/version) |
| addWakeUpScreenPack | 0x1a270 | C R T D I S | `CRT..DIS` (wake) ✓ |
| addFinishCommand | 0x18220 | C R T S T P ! # | `CRT..STP!#` (finish — note the `!#` = 0x21 0x23 suffix) |
| getFinishCommand | 0x1d320 | C R T S T P ! # " | `CRT..STP!#"` (0x22 trailing) |
| getUploadFinishedCommand | 0x1e6d0 | C R T U L E N D | `CRT..ULEND` (finalize upload) |
| getClearAllCommand | 0x1cf90 | C R T C L E (x2) | `CRT..CLE` (clear) ✓ |
| sendPicSizeCommand | 0x23f50 | C R T B A T + size(BE32) + index | `CRT..BAT` pic header ✓ |

**Why the 480x480 image upload showed nothing:** our sequence sent `BAT`+data then a
bare `STP` (no `!#`) and never sent `ULEND`. Correct upload sequence is:
  wake → [handshake HANC] → BAT(size,index) → raw JPEG reports → **ULEND** → **STP!#**.

TODO: confirm handshake necessity, exact STP suffix (`!#` vs `!#"`), index byte, resolution.

### 2026-06-01 — Task 6: Resolution (static analysis inconclusive → empirical)

- Resolution is **not hardcoded** in `SDLibrary1.dll`. Disassembly of `getLogoSizeCommand`
  (RVA 0x146f40) shows it builds the ASCII command `CRT` + `LOG` and takes the image
  **size as a parameter** (`int, uchar`); `sendPicSizeCommand` (RVA 0x23f50) builds
  `CRT` + `BAT`, also size-parameterized. Dimensions come from the app layer.
- The app ("Craft" DownLoadTool) fetches device packs from `https://cdn1.key123.vip/Craft/release/`.
  `app-version-check-Windows.json` is **AES-encrypted** (matches `QtAESHandler`/`aes_secret_key_`
  in the DLL). Guessed device-list URLs 404. Static path abandoned.
- Image opcodes confirmed for D92 family: **`CRT BAT`** (pic, size+index) and **`CRT LOG`** (logo, size+flag).
- DECISION: determine resolution empirically via the image-upload probe (Task 7) by
  sweeping candidate resolutions and observing which renders 1:1. Image base for the DLL
  in objdump is `0x180000000` (note: 7z reported 0x140000000; use 0x180000000 for VA math).

### 2026-06-01 — Task 6: Screen resolution (CONFIRMED by manufacturer)

**Resolution: 1920 × 462 pixels** — confirmed by manufacturer specification.

**Physical form factor:** Wide horizontal bar display — full HD width (1920 px) at ~462 px tall. Aspect ratio ≈ 4.16:1. This is consistent with a USB secondary/status strip screen rather than a square or 16:9 panel.

**Buffer sizes at this resolution:**
- RGB565 (likely wire format): 1,774,080 bytes (~1.7 MB per frame)
- RGB888: 2,661,120 bytes (~2.6 MB)
- ARGB32: 3,548,160 bytes (~3.5 MB)

**Binary analysis findings (partial evidence, superseded by manufacturer spec):**

During disassembly of `/tmp/SDLibrary1.dll` (SDLibrary1, Qt 5.15.2, PE32+ x86-64):

1. **sendTransparentBackground** (`SDDevice::sendTransparentBackground`, RVA `0x25470`) at instruction `0x1800254ec` hardcodes `movl $0x1e0, %edx` (480) and copies it to `%r8d` (same value), then calls what appears to be `QImage(width=480, height=480, Format_ARGB32)`. This 480-based code applies to the DEFAULT/non-StreamDock[296] path. **Reconciliation**: this likely covers a *different* device class (e.g., a separate square-screen N1 variant), or the 480 represents the key-image height while the full frame is stitched from tiles at the host side.

2. **Device struct layout** confirmed: `+0x48` = VID, `+0x4c` = PID, `+0x58` = screen_width, `+0x5c` = screen_height. These fields start as `−1` (set in `openHidDevice` simple path) and are updated at runtime from firmware response / downloaded config (dimensions are NOT hardcoded in the DLL as `movl $imm` instructions to these offsets).

3. **14 embedded 490×490 PNG images** found in the DLL data — likely per-key background images with a ~5 px padding border around a 480-px rendering area. These are NOT the full-screen resolution.

4. **No 1920 or 462 literals** were found as `movl $imm, offset(%reg)` instructions. Dimensions arrive at runtime (firmware string → model-name detection → downloaded config from `cdn1.key123.vip`).

5. **Model detection chain**: DLL contains a large function (near `0x180041xxx`) that checks if the firmware version string `contains()` any of: `MBox-N1`, `SS-553`, `ajazzN1`, `ControllerDeviceS1`, `SY1`, `Flux2`, `SD16N1V25`, `MBox-N1E`, `ajazzN1R`, `ajazzN1E`, etc. The D92 (VID `0x5548`, PID `0x1011`, manufacturer "HOTSPOTEKUSB") falls into the **N1 series** — the UI string "The current device is not N1 series or not connected" confirms this.

6. **Candidate resolutions investigated and ruled out:** 800×480, 960×540, 480×480, 320×240 — none appeared as hardcoded frame-dimension constants in the `.text` section.

**Action items for image upload (Task 7):**
- Frame size: 1920 × 462 × 2 = 1,774,080 bytes (if RGB565) or × 3 = 2,661,120 (RGB888)
- The `sendPicSizeCommand` / `getLogoSizeCommand` take the width as an `int` parameter — caller must pass `1920`
- The `sendTransparentBackground` 480-hardcode likely needs to be overridden/bypassed for D92 (it may target a different N1 sub-model)
- Probe: send a single-color 1920×462 RGB565 frame and observe whether the full screen fills

### 2026-06-01 — Task 5: First light (CONFIRMED)

- **The D92 responds to CRT commands over HID with report ID `0x00`, no sudo.** First light achieved.
- **Brightness (`LIG`, opcode `0x4c 0x49 0x47 0x00 0x00 <value>`) confirmed working** via a stark MAX(0xff)/MIN(0x00) contrast test (5s holds, 4 cycles). The backlight visibly changes; the perceptible range is somewhat narrow but real. Value range appears to tolerate 0x00..0xff.
- During the initial mixed probe (wake → brightness sweep → clear → refresh) the user observed a clear non-brightness reaction too (consistent with `clear`/`refresh` taking effect), then brightness was isolated and confirmed separately.
- No input reports were received back during any brightness/clear probe (device does not auto-report for these commands).
- Confirmed: transport stack (enumerate → open by path → write framed 512-byte packet) is correct end-to-end.

### 2026-06-01 — Task 2: HID enumeration probe

**Raw probe output (verbatim):**
```
Total HID devices: 42
D92 matches: 2

{
  path: 'DevSrvsID:4295803462',
  manufacturer: 'HOTSPOTEKUSB',
  product: 'HOTSPOTEKUSB HID DEMO',
  serialNumber: 'C511D3784329',
  interface: 0,
  usagePage: 'ffa0',
  usage: 1
}
{
  path: 'DevSrvsID:4295803462',
  manufacturer: 'HOTSPOTEKUSB',
  product: 'HOTSPOTEKUSB HID DEMO',
  serialNumber: 'C511D3784329',
  interface: 0,
  usagePage: 'ffa0',
  usage: 2
}

Opened OK via path.
```

**Findings:**
- Two HID entries for the D92, both sharing the same path (`DevSrvsID:4295803462`) and interface (`0`), distinguished only by `usage`: `1` and `2`. Both are on usagePage `0xFFA0` (vendor-defined), consistent with known device facts.
- The first match (usage `1`) opened successfully via `path` **without sudo**. `dev.close()` completed cleanly.
- `node-hid` `.devices()` does not expose output report size; treating as 512 (matches `MaxInputReportSize`).
- No explicit numbered report IDs seen in the descriptor via this API; treating report ID as `0x00` (no-numbered-reports default).
- sudo was **not tried**, per instructions. Open succeeded without elevated privileges.