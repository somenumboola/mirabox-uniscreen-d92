# D92 Firmware Recovery Guide (un-brick the connect/disconnect loop)

If the D92 enters a **connect/disconnect (blink) loop** — reproducible across machines — its
flash/boot image is corrupted and it crash-loops on boot. It still enumerates, and the
ArtInChip SoC has a Boot-ROM USB recovery mode, so it is **reflashable**.

Derived from the official tooling in `MiraBoxCraft/FirmwareUpdate/` (UpDateToolV3.exe,
IAP_Programmer.exe / aicupg, DFU/BurnTool.exe) and its update logs.

## How the official recovery works
1. Installs the ArtInChip driver `Artinchip_SoC.inf` (device-in-recovery = **`VID_33C3 / PID_6677`**,
   libusbK driver; or a serial COM port @ 115200 baud).
2. Detects the device by name, downloads a JSON, and fetches the firmware image from:
   `https://cdn1.key123.vip/StreamDock/firmware/download/V3.<MODEL>.<ver>.img`
   (this unit reports firmware `V25.D92.02.012` via control GET_REPORT, so it pulls the D92 image).
3. Sends an "enter upgrade" command → device reboots into **Boot-ROM USB upgrade mode** (stable;
   the crashing app firmware does not run → blinking stops).
4. `aicupg`/BurnTool burns the ~10 MB image (~25 s, in 1 MB blocks over USB, or UART @115200),
   then issues an HID reset → device reboots on fresh firmware.
   - aicupg even has `continue` = "Boot ROM exit USB loop and try to boot again" and
     `gotobl` = "Run to bootloader upgrade mode from boot rom upgrade mode".

## Steps (physical Windows PC recommended; needs internet)
1. Use the **physical Windows machine** (avoid VM/USB-passthrough for recovery). Connect internet.
2. Install/open **MiraBox Craft**; run **as Administrator** (to install the ArtInChip driver).
3. Plug in the D92 (looping is OK). Start **Firmware Update / 固件升级** (or run
   `FirmwareUpdate\UpDateToolV3.exe` directly). **Leave it running** — it polls and catches the
   device in a connect window, then flips it to the stable upgrade mode.
4. If Windows shows an unknown `USB\VID_33C3&PID_6677` device, install `FirmwareUpdate\Artinchip_SoC.inf`
   (right-click → Install). The tool usually auto-installs it.
5. Let it download + flash (~25–30 s). Device reboots with stock firmware; loop gone.

## If the tool can't catch the looping device
- Look for a **recovery button / test pad / pinhole** on the D92; **hold it while plugging in USB**
  to force Boot-ROM USB mode (`33C3:6677`) directly, then run the tool.
- Or contact **MiraBox support** for the exact D92 recovery trigger and stock firmware.

## Diagnosis update (2026-06-01) — device is alive, not hard-bricked

- Board: **D92-VIP3-V25-20251202**; firmware (read live): **V25.D92.02.012**; SoC ArtInChip.
- On **macOS the device is STABLE** and firmware-readable (control GET_REPORT returns
  `V25.D92.02.012` every time, same USB path, no blinking). So the app firmware boots and runs.
- It **only ever enumerates as `5548:1011`**, never the Boot-ROM `33c3:6677` — the bootloader is
  intact and keeps launching the (display-corrupt) app firmware, so there is **no software
  window into Boot-ROM recovery**. Forcing Boot-ROM mode needs a **hardware boot pad** at
  power-on (one of the `NC` test pads near the SoC) or the vendor's recovery step.
- The **connect/disconnect loop is induced by the Windows firmware tool actively poking the
  device**; left alone (macOS) it is stable. Damage is effectively limited to the boot
  logo / display state.
- ACTION: contact MiraBox support for the hardware recovery trigger + recovery firmware (draft
  in `mirabox-support-message.md`). Do NOT poke the device further meanwhile — it's stable.

## Root cause (for our own notes)
The blink loop was almost certainly caused by our `LOG`-path writes corrupting the persistent
boot image in flash during reverse-engineering. The `LOG` opcode writes the stored boot/background
image; sending it invalid/misaligned data left a boot image the firmware crashes on. Lesson for
future probing on this device: never exercise the `LOG`/flash-write path speculatively.