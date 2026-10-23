#!/usr/bin/env python3
"""Run the ECG screening model on a captured single-lead ECG.

Reads a waveform captured by the firmware and prints the rhythm / HRV /
morphology report. Two input modes:

    # analyze a saved ecgdump CSV (time_ms,adc rows)
    python3 tools/analyze_ecg.py --csv ecg.csv

    # pull a fresh dump straight off the device and analyze it
    python3 tools/analyze_ecg.py --port /dev/ttyACM0 --fs 1000

The model is dashboard/ml_server/ecg_rhythm_model.npz; if it is missing the
rule-based engine still runs (HR/HRV/rhythm, no ML PVC/PAC burden).

Screening only — NOT a diagnostic device.
"""

import argparse
import json
import os
import sys

import numpy as np

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "dashboard", "ml_server"))


def parse_ecg_csv(text):
    times, adc = [], []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split(",")
        if len(parts) < 2:
            continue
        try:
            times.append(float(parts[0]))
            adc.append(float(parts[1]))
        except ValueError:
            continue
    return np.array(times), np.array(adc)


def infer_fs(times):
    if len(times) < 3:
        return 1000.0
    dt = np.diff(times)
    dt = dt[dt > 0]
    if len(dt) == 0:
        return 1000.0
    med = float(np.median(dt))
    return 1000.0 / med if med > 0 else 1000.0


def fetch_from_serial(port, baud, fs):
    import serial
    import time
    ser = serial.Serial(port, baud, timeout=0.5)
    time.sleep(0.3)
    ser.reset_input_buffer()
    ser.write(b"ecgdump\n")
    ser.flush()
    lines, deadline = [], time.time() + 60
    while time.time() < deadline:
        raw = ser.readline()
        if not raw:
            continue
        line = raw.decode("utf-8", "ignore").strip()
        if line.startswith("# ecg end"):
            break
        lines.append(line)
    ser.close()
    return parse_ecg_csv("\n".join(lines))


def print_report(r):
    print(f"ECG analysis  ({r['duration_s']}s, {r['samples']} samples, fs={r['fs']:.0f} Hz)")
    print(f"  quality      : {r['quality']}")
    print(f"  rhythm       : {r['rhythm']}")
    print(f"  heart rate   : {r['hr_bpm']} bpm  (beats detected: {r['beats']})")
    if r.get("hrv"):
        h = r["hrv"]
        print(f"  HRV          : SDNN {h['sdnn']} ms, RMSSD {h['rmssd']} ms, "
              f"pNN50 {h['pnn50']} %, CV {h['cv']}")
    print(f"  PVC burden   : {r.get('pvc_burden', 0)}   PAC burden: {r.get('pac_burden', 0)}")
    print(f"  model used   : {r['model_used']}")
    if r.get("flags"):
        print(f"  flags        : {', '.join(r['flags'])}")
    print("  insights:")
    for ins in r.get("insights", []):
        print(f"    [{ins['level']:4s}] {ins['text']}")
    print(f"\n  {r['disclaimer']}")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--csv", help="ecgdump CSV file")
    src.add_argument("--port", help="serial port — fetch a fresh ecgdump")
    ap.add_argument("--fs", type=float, default=None, help="sample rate Hz (default: infer from CSV)")
    ap.add_argument("--baud", type=int, default=115200)
    ap.add_argument("--no-model", action="store_true", help="rule engine only")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    args = ap.parse_args()

    if args.csv:
        with open(args.csv, "r", errors="ignore") as fh:
            times, adc = parse_ecg_csv(fh.read())
    else:
        times, adc = fetch_from_serial(args.port, args.baud, args.fs)

    if len(adc) < 10:
        sys.exit("Not enough samples — capture with `ecg` first, then retry.")
    fs = args.fs or infer_fs(times)

    from ecg_analyze import analyze_ecg
    result = analyze_ecg(adc, fs, use_model=not args.no_model)

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print_report(result)


if __name__ == "__main__":
    main()