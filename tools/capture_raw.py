#!/usr/bin/env python3
"""Capture raw AS7343 CSV from an ANEBILIN device over serial.

The firmware's `r` command streams one CSV row per sample:

    time_ms, F1_405, FZ_450, FY_555, F6_640, F7_690, NIR_855, SpO2_pct, Hb_g_dL, Bili_mg_dL

This tool opens the port, starts streaming, and writes the rows to a
timestamped file whose name/metadata carry the subject's reference values, so
recordings can be joined with ground-truth labels offline.

Examples:
    # 45 s capture, tag with a reference blood test
    python3 tools/capture_raw.py --subject S01 --hb 9.4 --bili 2.1

    # interactive: Ctrl-C to stop
    python3 tools/capture_raw.py --subject S02 --hb 14.2 --bili 0.6 --outdir data
"""

import argparse
import csv
import datetime as dt
import os
import sys
import time

try:
    import serial
    from serial.tools import list_ports
except ImportError:
    sys.exit("pyserial is required:  pip install pyserial")

COLUMNS = [
    "time_ms", "F1_405", "FZ_450", "FY_555", "F6_640", "F7_690", "NIR_855",
    "SpO2_pct", "Hb_g_dL", "Bili_mg_dL",
]


def pick_port(explicit):
    if explicit:
        return explicit
    ports = list(list_ports.comports())
    preferred = [p for p in ports if p.device.startswith(("/dev/ttyACM", "/dev/ttyUSB", "COM"))]
    if not preferred:
        if not ports:
            sys.exit("No serial ports found. Pass --port /dev/ttyACM0")
        preferred = ports
    print(f"# using port {preferred[0].device} ({preferred[0].description})")
    return preferred[0].device


def parse_row(line):
    parts = [p.strip() for p in line.split(",")]
    if len(parts) != len(COLUMNS):
        return None
    try:
        return [float(p) for p in parts]
    except ValueError:
        return None


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", help="serial port (auto-detected if omitted)")
    ap.add_argument("--baud", type=int, default=115200)
    ap.add_argument("--subject", default="unknown", help="subject/patient id")
    ap.add_argument("--hb", type=float, default=None, help="reference Hb (g/dL)")
    ap.add_argument("--bili", type=float, default=None, help="reference bilirubin (mg/dL)")
    ap.add_argument("--spo2", type=float, default=None, help="reference SpO2 (%%)")
    ap.add_argument("--note", default="", help="free-text note stored in metadata")
    ap.add_argument("--duration", type=float, default=None,
                    help="seconds to capture (default: until Ctrl-C)")
    ap.add_argument("--settle", type=float, default=2.0,
                    help="seconds to discard after streaming starts (default 2)")
    ap.add_argument("--outdir", default="captures", help="output directory")
    args = ap.parse_args()

    os.makedirs(args.outdir, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    outpath = os.path.join(args.outdir, f"{args.subject}_{stamp}.csv")

    port = pick_port(args.port)
    try:
        ser = serial.Serial(port, args.baud, timeout=0.2)
    except serial.SerialException as e:
        sys.exit(f"Could not open {port}: {e}")

    time.sleep(0.3)
    ser.reset_input_buffer()
    ser.write(b"r\n")
    ser.flush()

    print(f"# streaming 'r' -> {outpath}")
    print("# waiting for samples (press Ctrl-C to stop)")

    started = dt.datetime.now().isoformat(timespec="seconds")
    t0 = time.time()
    rows = 0
    discarded = 0
    last_status = 0.0

    with open(outpath, "w", newline="") as fh:
        fh.write(f"# subject={args.subject}\n")
        fh.write(f"# hb_ref_g_dL={args.hb if args.hb is not None else ''}\n")
        fh.write(f"# bili_ref_mg_dL={args.bili if args.bili is not None else ''}\n")
        fh.write(f"# spo2_ref_pct={args.spo2 if args.spo2 is not None else ''}\n")
        fh.write(f"# note={args.note}\n")
        fh.write(f"# port={port}\n")
        fh.write(f"# started={started}\n")
        writer = csv.writer(fh)
        writer.writerow(COLUMNS)

        try:
            while True:
                if args.duration is not None and (time.time() - t0) >= args.duration:
                    break
                raw = ser.readline()
                if not raw:
                    continue
                line = raw.decode("utf-8", "ignore").strip()
                if not line:
                    continue
                if line.startswith("#"):
                    print(line)
                    continue

                row = parse_row(line)
                if row is None:
                    continue
                if (time.time() - t0) < args.settle:
                    discarded += 1
                    continue
                writer.writerow(row)
                rows += 1

                now = time.time()
                if now - last_status >= 1.0:
                    last_status = now
                    print(f"\r# {rows} rows ({discarded} settling)", end="", flush=True)
        except KeyboardInterrupt:
            print("\n# interrupted")
        finally:
            ser.write(b"s\n")
            ser.flush()
            time.sleep(0.2)
            ser.close()

    print(f"\n# wrote {rows} rows to {outpath}")
    if rows == 0:
        sys.exit("No samples captured — check the device is running and not asleep.")


if __name__ == "__main__":
    main()
