#!/usr/bin/env python3
"""Offline trainer for the ANEBILIN onboard Hb / bilirubin model.

Reads raw capture CSVs produced by the firmware `cap` command (or by
tools/capture_raw.py), reconstructs the *exact* AC/DC feature vectors that
BiomarkerEngine builds on-device, joins them with reference labels, fits a
standardized ridge regression with leave-one-out validation, and exports
firmware-compatible weights.

Dependencies: numpy only (no sklearn / pandas).

Labels file (CSV, one row per subject):
    subject,age,sex,hb,bili
    S01,34,M,9.4,2.1
    S02,28,F,13.8,0.6

  - subject must match the capture filename prefix / `# subject=` metadata
  - age / sex are optional but recommended (used for the demographics model)
  - sex accepts M/F/male/female/1/0

Usage:
    # type the reference values in as it runs (prompts once per subject)
    python3 tools/train_offline.py --captures captures --interactive

    # or pass them inline (repeatable)
    python3 tools/train_offline.py --captures captures \
        --label S01,34,M,9.4,2.1 --label S02,28,F,13.8,0.6

    # or from a CSV
    python3 tools/train_offline.py --captures captures --labels labels.csv

    python3 tools/train_offline.py --captures captures --init-labels

Outputs (in --out, default "models/"):
    report.txt              human-readable metrics + predictions
    hb_optical.json         deployable optical-only model (weights + stats)
    bili_optical.json       same for bilirubin
    hb_bili_weights.h       C arrays to paste into firmware
    serial_commands.txt     `cal_wload ...` lines to push weights over serial
"""

import argparse
import csv
import glob
import json
import math
import os
import re
import sys

import numpy as np

# Channel order in every capture CSV.
CH = ["F1_405", "FZ_450", "FY_555", "F6_640", "F7_690", "NIR_855"]
I_F1, I_FZ, I_FY, I_F6, I_F7, I_NIR = range(6)

SETTLE_MS = 2000.0          # discard while the 2 s EMA settles
DC_FLOOR  = 10.0            # matches BiomarkerEngine's DC > 10 guard
LOG_FLOOR = 1e-6
LAMBDA_GRID = [0.01, 0.03, 0.1, 0.3, 1.0, 3.0, 10.0]
TARGETS = {
    "hb":   {"field": "hb",   "lo": 3.0,  "hi": 22.0},
    "bili": {"field": "bili", "lo": 0.0,  "hi": 30.0},
}


# --------------------------------------------------------------------------
# Feature extraction — must mirror BiomarkerEngine.cpp exactly
# --------------------------------------------------------------------------

def safelog(x):
    return math.log(x if x > LOG_FLOOR else LOG_FLOOR)


def estimate_fs(times_ms):
    if len(times_ms) < 3:
        return 10.0
    dt = np.diff(times_ms)
    dt = dt[dt > 0]
    if len(dt) == 0:
        return 10.0
    med = float(np.median(dt))
    return 1000.0 / med if med > 0 else 10.0


def build_features(ema_ac, ema_dc, kind):
    """10-element feature vector, f[0] = 1 bias. Mirrors buildHb/BiliFeatures."""
    def r(ch):
        return (ema_ac[ch] / ema_dc[ch]) if ema_dc[ch] > DC_FLOOR else LOG_FLOOR

    if kind == "hb":
        r_fy, r_f6, r_f7, r_n = r(I_FY), r(I_F6), r(I_F7), r(I_NIR)
        return np.array([
            1.0,
            safelog(r_fy / r_n),
            safelog(r_f6 / r_n),
            safelog(r_f7 / r_n),
            safelog(ema_dc[I_NIR] / ema_dc[I_FY]),
            safelog(ema_dc[I_NIR] / ema_dc[I_F6]),
            safelog(ema_dc[I_F7]  / ema_dc[I_F6]),
            safelog(ema_dc[I_FY]  / ema_dc[I_FZ]),
            safelog(ema_dc[I_FZ]  / ema_dc[I_F1]),
            safelog(ema_dc[I_FY]  / ema_dc[I_F7]),
        ])
    else:  # bili
        r_fz, r_f1, r_f6, r_n = r(I_FZ), r(I_F1), r(I_F6), r(I_NIR)
        return np.array([
            1.0,
            safelog(r_fz / r_n),
            safelog(r_f6 / r_n),
            safelog(r_f1 / r_n),
            safelog(ema_dc[I_NIR] / ema_dc[I_FZ]),
            safelog(ema_dc[I_F1]  / ema_dc[I_FZ]),
            safelog(ema_dc[I_FZ]  / ema_dc[I_FY]),
            safelog(ema_dc[I_FY]  / ema_dc[I_F6]),
            safelog(ema_dc[I_F6]  / ema_dc[I_F7]),
            safelog(ema_dc[I_FY]  / ema_dc[I_F1]),
        ])


def extract_features(times_ms, adc, kind):
    """Run SignalFilter + BiomarkerEngine EMA over the capture, return the
    mean feature vector over the settled window."""
    times_ms = np.asarray(times_ms, dtype=float)
    adc = np.asarray(adc, dtype=float)
    fs = estimate_fs(times_ms)

    alpha_dc  = 1.0 - math.exp(-2.0 * math.pi * 0.5 / fs)   # SignalFilter
    alpha_ema = 1.0 - math.exp(-1.0 / (2.0 * fs))           # BiomarkerEngine

    dc = adc[0].copy()
    ema_ac = np.zeros(6)
    ema_dc = np.zeros(6)

    feats = []
    for i in range(len(times_ms)):
        dc = dc + alpha_dc * (adc[i] - dc)
        ac = adc[i] - dc
        ema_ac += alpha_ema * (np.abs(ac) - ema_ac)
        ema_dc += alpha_ema * (dc - ema_dc)
        if times_ms[i] >= SETTLE_MS:
            feats.append(build_features(ema_ac, ema_dc, kind))

    if not feats:
        feats = [build_features(ema_ac, ema_dc, kind)]
    return np.mean(np.array(feats), axis=0), fs, len(feats)


# --------------------------------------------------------------------------
# Capture / label loading
# --------------------------------------------------------------------------

def subject_from_name(path):
    m = re.search(r"#\s*subject=([^\s]+)", open(path, "r", errors="ignore").read(2048))
    if m:
        return m.group(1)
    base = os.path.basename(path)
    base = re.sub(r"\.csv$", "", base)
    base = re.sub(r"_\d+$", "", base)   # strip _<millis>
    return base


def read_capture(path):
    times, adc = [], []
    with open(path, "r", errors="ignore") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split(",")
            if len(parts) < 7:
                continue
            try:
                t = float(parts[0])
                row = [float(x) for x in parts[1:7]]
            except ValueError:
                continue          # header row
            times.append(t)
            adc.append(row)
    return np.array(times), np.array(adc)


def read_labels(path):
    labels = {}
    with open(path, newline="") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            subj = (row.get("subject") or "").strip()
            if not subj:
                continue
            labels[subj] = {
                "age":  _to_float(row.get("age")),
                "sex":  _sex_code(row.get("sex")),
                "hb":   _to_float(row.get("hb")),
                "bili": _to_float(row.get("bili")),
            }
    return labels


def _to_float(v):
    try:
        return float(str(v).strip())
    except (TypeError, ValueError):
        return None


def _sex_code(v):
    s = str(v).strip().lower()
    if s in ("m", "male", "1"):
        return 1.0
    if s in ("f", "female", "0"):
        return 0.0
    return None


def write_label_template(captures_dir, out_path):
    files = sorted(glob.glob(os.path.join(captures_dir, "*.csv")))
    subjects = []
    for p in files:
        s = subject_from_name(p)
        if s not in subjects:
            subjects.append(s)
    with open(out_path, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["subject", "age", "sex", "hb", "bili"])
        for s in subjects:
            w.writerow([s, "", "", "", ""])
    print(f"# wrote label template with {len(subjects)} subject(s) -> {out_path}")
    print("# fill in age, sex (M/F), hb (g/dL) and bili (mg/dL), then re-run with --labels")


def parse_inline_label(s):
    """--label S01,34,M,9.4,2.1"""
    parts = [p.strip() for p in s.split(",")]
    if len(parts) < 5:
        raise argparse.ArgumentTypeError(f"expected subject,age,sex,hb,bili — got '{s}'")
    return parts[0], {"age": _to_float(parts[1]), "sex": _sex_code(parts[2]),
                      "hb": _to_float(parts[3]), "bili": _to_float(parts[4])}


def _sex_str(code):
    if code == 1.0:
        return "M"
    if code == 0.0:
        return "F"
    return ""


def _prompt(label, default, parser):
    if default is None:
        shown = ""
    elif isinstance(default, float):
        shown = f"{default:g}"
    else:
        shown = str(default)
    try:
        raw = input(f"{label} [{shown}]: ").strip()
    except EOFError:
        raw = ""
    if raw == "":
        return default
    return parser(raw)


def prompt_labels(subjects, path, presets=None):
    """Ask for age/sex/hb/bili for each subject. Blank keeps the previous
    value (from an existing labels file or --label) or leaves it empty."""
    existing = read_labels(path) if os.path.exists(path) else {}
    if presets:
        for s, d in presets.items():
            existing.setdefault(s, {}).update(d)

    print("# Enter reference values. Press Enter to keep the shown default / skip.")
    labels = {}
    for subj in subjects:
        d = existing.get(subj, {})
        print(f"[{subj}]")
        labels[subj] = {
            "age":  _prompt("  age",       d.get("age"),  _to_float),
            "sex":  _prompt("  sex (M/F)", _sex_str(d.get("sex")) or None, _sex_code),
            "hb":   _prompt("  hb  g/dL",  d.get("hb"),   _to_float),
            "bili": _prompt("  bili mg/dL", d.get("bili"), _to_float),
        }

    with open(path, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["subject", "age", "sex", "hb", "bili"])
        for s in subjects:
            d = labels[s]
            w.writerow([
                s,
                "" if d["age"] is None else d["age"],
                _sex_str(d["sex"]),
                "" if d["hb"] is None else d["hb"],
                "" if d["bili"] is None else d["bili"],
            ])
    print(f"# saved labels -> {path}")
    return labels



# --------------------------------------------------------------------------
# Ridge regression (standardized, closed-form) + leave-one-out
# --------------------------------------------------------------------------

def standardize(X):
    mu = X.mean(axis=0)
    sd = X.std(axis=0)
    sd[sd < 1e-9] = 1.0
    return (X - mu) / sd, mu, sd


def ridge_fit(Z, y, lam):
    """Z already standardized (zero mean). Returns (intercept, coef)."""
    n, p = Z.shape
    b0 = float(y.mean())
    yc = y - b0
    A = Z.T @ Z + lam * np.eye(p)
    w = np.linalg.solve(A, Z.T @ yc)
    return b0, w


def loo_cv(Z, y, lam):
    n = len(y)
    preds = np.zeros(n)
    for i in range(n):
        idx = np.arange(n) != i
        b0, w = ridge_fit(Z[idx], y[idx], lam)
        preds[i] = b0 + float(Z[i] @ w)
    return preds


def metrics(y, pred):
    err = y - pred
    rmse = float(np.sqrt(np.mean(err ** 2)))
    mae = float(np.mean(np.abs(err)))
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    r2 = 1.0 - float(np.sum(err ** 2)) / ss_tot if ss_tot > 1e-9 else float("nan")
    return rmse, mae, r2


def choose_lambda(Z, y):
    best, best_rmse = LAMBDA_GRID[0], float("inf")
    for lam in LAMBDA_GRID:
        preds = loo_cv(Z, y, lam)
        rmse, _, _ = metrics(y, preds)
        if rmse < best_rmse:
            best, best_rmse = lam, rmse
    return best


# --------------------------------------------------------------------------
# Export
# --------------------------------------------------------------------------

def export_optical(kind, b0, w, mu, sd, meta, outdir):
    """Fold standardization into raw-space weights the firmware can dot-product.

    Firmware model: y = weights[0]*1 + sum_{j=1..9} weights[j] * x_j
    """
    coef_raw = w / sd
    intercept_raw = b0 - float(np.sum(w * mu / sd))
    weights = np.concatenate([[intercept_raw], coef_raw])

    model = {
        "target": kind,
        "feature_count": 10,
        "feature_order": [
            "bias",
            "log(R_fy/R_nir)", "log(R_f6/R_nir)", "log(R_f7/R_nir)",
            "log(DC_nir/DC_fy)", "log(DC_nir/DC_f6)", "log(DC_f7/DC_f6)",
            "log(DC_fy/DC_fz)", "log(DC_fz/DC_f1)", "log(DC_fy/DC_f7)",
        ] if kind == "hb" else [
            "bias",
            "log(R_fz/R_nir)", "log(R_f6/R_nir)", "log(R_f1/R_nir)",
            "log(DC_nir/DC_fz)", "log(DC_f1/DC_fz)", "log(DC_fz/DC_fy)",
            "log(DC_fy/DC_f6)", "log(DC_f6/DC_f7)", "log(DC_fy/DC_f1)",
        ],
        "weights_raw": [round(float(v), 8) for v in weights],
        "feature_mean": [round(float(v), 8) for v in mu],
        "feature_scale": [round(float(v), 8) for v in sd],
        "lambda": meta["lambda"],
        "n_subjects": meta["n_subjects"],
        "loo_rmse": meta["loo_rmse"],
        "loo_mae": meta["loo_mae"],
        "loo_r2": meta["loo_r2"],
        "baseline_rmse": meta["baseline_rmse"],
        "clamp": TARGETS[kind],
    }
    with open(os.path.join(outdir, f"{kind}_optical.json"), "w") as fh:
        json.dump(model, fh, indent=2)
    return weights, model


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--captures", default="captures", help="directory of capture CSVs")
    ap.add_argument("--labels", default="labels.csv", help="reference labels CSV")
    ap.add_argument("--out", default="models", help="output directory")
    ap.add_argument("--init-labels", action="store_true",
                    help="write a label template from the captures and exit")
    ap.add_argument("-i", "--interactive", action="store_true",
                    help="prompt for age/sex/hb/bili for each subject (saved to --labels)")
    ap.add_argument("--label", action="append", default=[], metavar="SUBJ,AGE,SEX,HB,BILI",
                    help="inline reference for one subject (repeatable), e.g. --label S01,34,M,9.4,2.1")
    ap.add_argument("--targets", nargs="+", default=["hb", "bili"], choices=["hb", "bili"])
    args = ap.parse_args()

    files = sorted(glob.glob(os.path.join(args.captures, "*.csv")))
    if not files:
        sys.exit(f"No capture CSVs in {args.captures}/ — run `cap` on the device first.")

    if args.init_labels:
        write_label_template(args.captures, args.labels)
        return

    subjects_all = []
    for p in files:
        s = subject_from_name(p)
        if s not in subjects_all:
            subjects_all.append(s)

    presets = {}
    for item in args.label:
        subj, data = parse_inline_label(item)
        presets[subj] = data

    if args.interactive:
        if not sys.stdin.isatty():
            sys.exit("--interactive needs a terminal (stdin is not a TTY). Use --label instead.")
        labels = prompt_labels(subjects_all, args.labels, presets)
    else:
        if os.path.exists(args.labels):
            labels = read_labels(args.labels)
        elif presets:
            labels = {}
        else:
            sys.exit(f"Labels file {args.labels} not found. "
                     f"Use --interactive, --init-labels, or --label SUBJ,AGE,SEX,HB,BILI.")
        labels.update(presets)

    os.makedirs(args.out, exist_ok=True)

    # Group captures by subject -> average feature vector per subject.
    by_subject = {}
    for path in files:
        subj = subject_from_name(path)
        if subj not in labels:
            print(f"# skip {os.path.basename(path)} — no label for subject '{subj}'")
            continue
        times, adc = read_capture(path)
        if len(times) < 20:
            print(f"# skip {os.path.basename(path)} — too few samples")
            continue
        by_subject.setdefault(subj, {"paths": [], "times": [], "adc": []})
        by_subject[subj]["paths"].append(path)
        by_subject[subj]["times"].append(times)
        by_subject[subj]["adc"].append(adc)

    if not by_subject:
        sys.exit("No captures matched any label. Check the subject names.")

    subjects = sorted(by_subject.keys())
    print(f"# {len(subjects)} subject(s): {', '.join(subjects)}")

    report = []
    report.append(f"ANEBILIN offline training report")
    report.append(f"subjects: {len(subjects)}")
    report.append("")

    header_lines = ["// Auto-generated by tools/train_offline.py — do not edit by hand.",
                    "#pragma once", ""]
    serial_lines = ["# Push these to the device over the serial CLI", ""]

    for kind in args.targets:
        # Build per-subject averaged feature vectors.
        X, y, ages, sexes, used = [], [], [], [], []
        for subj in subjects:
            feat_acc = []
            for times, adc in zip(by_subject[subj]["times"], by_subject[subj]["adc"]):
                f, fs, n = extract_features(times, adc, kind)
                feat_acc.append(f)
            X.append(np.mean(np.array(feat_acc), axis=0))
            lab = labels[subj]
            y.append(lab[kind])
            ages.append(lab["age"])
            sexes.append(lab["sex"])
            used.append(subj)

        X = np.array(X)
        y = np.array(y, dtype=float)
        mask = ~np.isnan(y)
        X, y = X[mask], y[mask]
        ages = [a for a, m in zip(ages, mask) if m]
        sexes = [s for s, m in zip(sexes, mask) if m]
        used = [u for u, m in zip(used, mask) if m]

        if len(y) < 4:
            report.append(f"[{kind}] only {len(y)} labeled subject(s) — need >= 4, skipping")
            report.append("")
            continue

        # --- optical-only model (deployable to firmware) ---
        Xopt = X[:, 1:]                       # drop bias column
        Z, mu, sd = standardize(Xopt)
        lam = choose_lambda(Z, y)
        b0, w = ridge_fit(Z, y, lam)
        preds = loo_cv(Z, y, lam)
        rmse, mae, r2 = metrics(y, preds)
        base_rmse, _, _ = metrics(y, np.full_like(y, y.mean()))

        meta = {"lambda": lam, "n_subjects": len(y), "loo_rmse": round(rmse, 4),
                "loo_mae": round(mae, 4), "loo_r2": round(r2, 4),
                "baseline_rmse": round(base_rmse, 4)}
        weights, model = export_optical(kind, b0, w, mu, sd, meta, args.out)

        report.append(f"[{kind}] optical-only (deployable)")
        report.append(f"  n={len(y)}  lambda={lam}  LOO RMSE={rmse:.3f}  MAE={mae:.3f}  R2={r2:.3f}")
        report.append(f"  baseline (predict mean) RMSE={base_rmse:.3f}")
        report.append(f"  predictions:")
        for s, a, p in zip(used, y, preds):
            report.append(f"    {s:>10}  actual={a:7.3f}  pred={p:7.3f}  err={p-a:+7.3f}")
        report.append("")

        header_lines.append(f"static const float {kind.upper()}_WEIGHTS[10] = {{")
        header_lines.append("    " + ", ".join(f"{v:.8f}f" for v in weights) + " };")
        header_lines.append("")
        serial_lines.append(f"cal_wload {kind} " + " ".join(f"{v:.6f}" for v in weights))

        # --- optical + age + sex model (dashboard / server only) ---
        demo_idx = [i for i in range(len(y)) if ages[i] is not None and sexes[i] is not None]
        if len(demo_idx) >= 5:
            Xd = np.column_stack([
                X[demo_idx, 1:],
                [ages[i] for i in demo_idx],
                [sexes[i] for i in demo_idx],
            ])
            yd = y[demo_idx]
            Zd, _, _ = standardize(Xd)
            lamd = choose_lambda(Zd, yd)
            b0d, wd = ridge_fit(Zd, yd, lamd)
            predsd = loo_cv(Zd, yd, lamd)
            rmsed, maed, r2d = metrics(yd, predsd)
            report.append(f"[{kind}] optical + age + sex (server only — device has no demographics)")
            report.append(f"  n={len(demo_idx)}  lambda={lamd}  LOO RMSE={rmsed:.3f}  MAE={maed:.3f}  R2={r2d:.3f}")
            report.append("")
            with open(os.path.join(args.out, f"{kind}_demographics.json"), "w") as fh:
                json.dump({"target": kind, "features": ["optical(9)", "age", "sex_male"],
                           "intercept": float(b0d), "coef_std": [float(v) for v in wd],
                           "lambda": lamd, "loo_rmse": rmsed, "loo_r2": r2d}, fh, indent=2)
        else:
            report.append(f"[{kind}] optical + age + sex: need >= 5 subjects with age & sex (have {len(demo_idx)})")
            report.append("")

    with open(os.path.join(args.out, "report.txt"), "w") as fh:
        fh.write("\n".join(report) + "\n")
    with open(os.path.join(args.out, "hb_bili_weights.h"), "w") as fh:
        fh.write("\n".join(header_lines) + "\n")
    with open(os.path.join(args.out, "serial_commands.txt"), "w") as fh:
        fh.write("\n".join(serial_lines) + "\n")

    print("\n".join(report))
    print(f"# wrote {args.out}/report.txt, *_optical.json, hb_bili_weights.h, serial_commands.txt")


if __name__ == "__main__":
    main()
