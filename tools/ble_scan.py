#!/usr/bin/env python3
"""Raw BLE air scan: shows EVERYTHING nearby, including unnamed devices.

Use this when the ANEBILIN doesn't appear in Windows Settings or the
dashboard. It distinguishes three cases:
  - nothing at all        -> this PC's Bluetooth can't see LE traffic
  - unnamed + [FFF0 UUID] -> device is transmitting but its name is missing
  - "Anebilin" listed     -> air side is fine, the app/filter is the problem

    pip install bleak
    python3 tools/ble_scan.py
    python3 tools/ble_scan.py --seconds 20
"""

import argparse
import asyncio
import sys

try:
    from bleak import BleakScanner
except ImportError:
    sys.exit("bleak is required:  pip install bleak")


async def scan(seconds: int):
    print(f"# scanning {seconds}s — hold the device within 1 m of this PC ...")
    seen = {}
    stop = asyncio.Event()

    def on_adv(device, adv):
        uuids = [u.lower() for u in (adv.service_uuids or [])]
        key = device.address
        prev = seen.get(key)
        entry = {
            "name": device.name or adv.local_name or "<unnamed>",
            "rssi": adv.rssi,
            "uuids": uuids,
        }
        # Keep the strongest-RSSI sighting; reprint on improvement or new data.
        if prev is None or adv.rssi > prev["rssi"] or entry["name"] != prev["name"]:
            seen[key] = entry
            hit = "  <-- ANEBILIN" if (
                (entry["name"] or "").lower() == "anebilin"
                or "0000fff0-0000-1000-8000-00805f9b34fb" in uuids
            ) else ""
            print(f"  {device.address}  {entry['name']}  rssi={adv.rssi}"
                  f"  uuids={uuids or '-'}{hit}")

    async with BleakScanner(on_adv):
        await asyncio.sleep(seconds)

    n = len(seen)
    aneb = [a for a, e in seen.items()
            if (e["name"] or "").lower() == "anebilin"
            or "0000fff0-0000-1000-8000-00805f9b34fb" in e["uuids"]]
    print(f"# done: {n} device(s) seen, {len(aneb)} look like ANEBILIN")
    if n and not aneb:
        print("# NOTE: other devices visible but no ANEBILIN/FFF0 — the ESP32's "
              "radio is silent or out of range (firmware TX is -3 dBm, stay close).")
    if not n:
        print("# NOTE: zero advertisements — this PC's Bluetooth stack/driver "
              "isn't delivering LE scans. Toggle Bluetooth off/on and retry.")
    stop.set()


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--seconds", type=int, default=10)
    args = ap.parse_args()
    asyncio.run(scan(args.seconds))


if __name__ == "__main__":
    main()
