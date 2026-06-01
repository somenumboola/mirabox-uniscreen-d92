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
| Screen resolution | TBD | Task 6 | pending |
| Handshake bytes | TBD | Task 9 | pending |

## Notes
(append observations here, newest first)

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