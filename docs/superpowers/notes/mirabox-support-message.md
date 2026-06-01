# Draft message to MiraBox support

Subject: D92 stuck in USB connect/disconnect loop — need firmware recovery procedure

Hello,

My MiraBox **D92** has stopped working correctly and I need help recovering it.

**Symptoms**
- On Windows it continuously **connects and disconnects** (blinks in Device Manager); the
  Firmware Update tool / MiraBox Craft can't hold a connection long enough to update it.
- The **boot/welcome screen is black** (no MiraBox logo); the screen shows nothing.
- On macOS it is **stable** and still reports its firmware version when queried, so the
  device is powered and partially alive — it just won't display or stay connected on Windows.

**Device details**
- Model: **D92**
- Board marking: **D92-VIP3-V25-20251202**
- Firmware version (read from the device): **V25.D92.02.012**
- SoC: ArtInChip (the device only ever enumerates as its normal HID device,
  VID 5548 / PID 1011 — it never appears in the ArtInChip Boot-ROM upgrade mode
  VID 33C3 / PID 6677, so the updater can't put it into download mode on its own).

**What I need**
Could you please provide the **firmware recovery procedure** for the D92? Specifically:
1. How to force the device into **Boot-ROM / USB upgrade (DFU) mode** — is there a
   recovery **button or test pad** on the board to hold while plugging in USB, or a
   specific key/cable sequence?
2. The correct **recovery firmware image** and the tool/steps to flash it (UpDateToolV3 /
   IAP / BurnTool), if different from the standard update.

If it can't be recovered this way, please advise on **RMA / replacement** options.

Thank you very much for your help.