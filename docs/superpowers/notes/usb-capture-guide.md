# USB Capture Guide — finishing the D92 live-display path

**Goal:** capture the official "MiraBox Craft" app connecting to the D92 and pushing **one
frame**, so we can read the exact **connect → activate → present** sequence we couldn't
derive blind. We already know transport, vocabulary, resolution, and framing — the capture
only needs to reveal the *order/timing* and the *present trigger*.

## What we already know (so the capture is fast to read)
- Transport: **interrupt-OUT endpoint 0x01**, 1024-byte reports. Interrupt-IN 0x82.
- Report frame: `"CRT\0\0" + <opcode>` padded to 1024. Opcodes: `DIS LIG CLE STP!# ULEND
  BAT LOG DRA MOD VER CONNECT`.
- Firmware via control GET_REPORT `(0xa1,0x01,0x0100,0,len)` → `"V25.D92.02.012"`.
- Screen 1920×462; images JPEG (and raw on LOG). `DRA` header = `CRT\0\0DRA` + BE32(len+32)
  + BE16(flag,x,y,w,h).

## Option A — Windows + Wireshark + USBPcap (recommended)
1. On the Windows PC with MiraBox Craft installed, install **Wireshark** (bundles **USBPcap**).
2. Plug in the D92. Open Wireshark → start capture on the **USBPcap** interface that shows the
   device (try each; filter helps — see step 4).
3. Start MiraBox Craft, let it connect to the D92, and **set/refresh one image** on the screen.
   Keep it short (a few seconds) to keep the capture small.
4. Stop capture. Filter to the device, e.g.:
   `usb.idVendor == 0x5548 || usb.device_address == <addr>` (find `<addr>` from a "GET DESCRIPTOR
   DEVICE" packet showing VID 5548/PID 1011).
5. **Export** as `.pcapng` and share it. Or `File → Export Packet Dissections → As JSON`.

What to look for (and capture): the first ~50 OUT transfers after connect (the activation),
any control transfers (GET/SET_REPORT), and the OUT transfers carrying the JPEG/raw frame
(large bursts on endpoint 0x01) plus whatever command immediately precedes the screen update.

## Option B — Hardware USB analyzer
Any cheap USB 2.0 protocol analyzer (e.g. an inline sniffer) capturing the same "connect +
one frame" session works; export and share the trace.

## Option C — macOS (harder)
macOS USB capturing requires the **Additional Tools for Xcode** "USB" instrument or a
`PacketLogger`/`tcpdump -i` on an enabled USB interface; generally more setup than Option A,
and you'd still need the Windows app to drive the device. Prefer A.

## After the capture
Share the trace (or the relevant OUT/control transfers) and I will:
1. Diff the activation handshake against our `CONNECT`/`VER`/firmware-read attempts.
2. Identify the exact present/refresh trigger and frame framing.
3. Wire it into `src/d92/device.ts` (`setImage`) over the interrupt-OUT transport, and
   add the telemetry-rendering layer (Task 11) on top.
