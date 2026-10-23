#!/usr/bin/env python3
"""Download raw capture CSVs from an ANEBILIN device over serial.

Pairs with the firmware `cap` / `ls` / `get` / `rm` commands. The device stores
raw 6-channel ADC recordings on LittleFS; this tool lists them and pulls each
one off as a CSV file.

    python3 tools/fetch_captures.py
    python3 tools/fetch_captures.py --outdir captures --pattern S01
    python3 tools/fetch_captures.py --delete          # remove from device after pull
"""

import argparse
import os
import sys
import time

try:
    import serial
    from serial.tools import list_ports
except ImportError:
    sys.exit("pyserial is required:  pip install pyserial")


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


def read_line(ser, timeout=5.0):
    ser.timeout = timeout
    raw = ser.readline()
    if not raw:
        return ""
    return raw.decode("utf-8", "ignore").rstrip("\r\n")


def read_exact(ser, n, timeout=60.0):
    buf = bytearray()
    deadline = time.time() + timeout
    while len(buf) < n:
        chunk = ser.read(n - len(buf))
        if chunk:
            buf.extend(chunk)
        elif time.time() > deadline:
            raise TimeoutError(f"received {len(buf)}/{n} bytes")
    return bytes(buf)


def list_files(ser):
    ser.reset_input_buffer()
    ser.write(b"ls\n")
    ser.flush()
    files = []
    deadline = time.time() + 10.0
    while time.time() < deadline:
        line = read_line(ser)
        if not line:
            continue
        if line.startswith("# FILE "):
            parts = line.split()
            if len(parts) >= 4:
                files.append((parts[2], int(parts[3])))
        elif line == "# END LIST":
            return files
    sys.exit("Timed out waiting for file list. Is the device awake and at the CLI?")


def fetch_one(ser, name, outdir):
    ser.reset_input_buffer()
    ser.write(f"get {name}\n".encode())
    ser.flush()

    size = None
    deadline = time.time() + 10.0
    while time.time() < deadline:
        line = read_line(ser)
        if not line:
            continue
        if line.startswith("# GET "):
            size = int(line.split()[-1])
            break
        if line.startswith("# ERR"):
            print(f"  ! {line}")
            return False
    if size is None:
        print(f"  ! no response for {name}")
        return False

    data = read_exact(ser, size)

    while True:
        line = read_line(ser)
        if line == "# END" or line == "":
            break

    outpath = os.path.join(outdir, name)
    with open(outpath, "wb") as fh:
        fh.write(data)
    print(f"  -> {outpath} ({len(data)} bytes)")
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", help="serial port (auto-detected if omitted)")
    ap.add_argument("--baud", type=int, default=115200)
    ap.add_argument("--outdir", default="captures", help="where to save files")
    ap.add_argument("--pattern", default="", help="only fetch names containing this substring")
    ap.add_argument("--delete", action="store_true", help="remove each file from the device after download")
    args = ap.parse_args()

    os.makedirs(args.outdir, exist_ok=True)
    port = pick_port(args.port)
    try:
        ser = serial.Serial(port, args.baud, timeout=0.5)
    except serial.SerialException as e:
        sys.exit(f"Could not open {port}: {e}")

    time.sleep(0.3)

    files = list_files(ser)
    if args.pattern:
        files = [f for f in files if args.pattern in f[0]]
    if not files:
        ser.close()
        sys.exit("No capture files on device.")

    print(f"# {len(files)} file(s) to fetch")
    ok = 0
    for name, size in files:
        print(f"# {name} ({size} bytes)")
        try:
            if fetch_one(ser, name, args.outdir):
                ok += 1
                if args.delete:
                    ser.write(f"rm {name}\n".encode())
                    ser.flush()
                    read_line(ser)
        except TimeoutError as e:
            print(f"  ! {name}: {e}")

    ser.close()
    print(f"# done: {ok}/{len(files)} fetched into {args.outdir}")


if __name__ == "__main__":
    main()
