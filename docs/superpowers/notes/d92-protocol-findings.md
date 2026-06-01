# D92 Protocol Findings (living log)

Confirmed facts discovered while probing/disassembling. Update as we learn.

| Item | Value | Source | Status |
|------|-------|--------|--------|
| VID / PID | 0x5548 / 0x1011 | enumeration | confirmed |
| Input report size | 512 | IOHID | confirmed |
| HID report ID | 0x00 | Task 2 | assumed |
| Output report size / chunk | 512 (assumed, matches input) | Task 2 | assumed |
| Screen resolution | TBD | Task 6 | pending |
| Handshake bytes | TBD | Task 9 | pending |

## Notes
(append observations here, newest first)

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