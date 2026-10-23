"""Train the single-lead ECG beat classifier from the MIT-BIH Arrhythmia DB.

Produces `ecg_rhythm_model.joblib`, consumed by `ecg_analyze.analyze_ecg`.
The classifier predicts AAMI beat classes {N,S,V,F,Q}; `analyze_ecg` aggregates
them into PVC/PAC burden and rhythm insights.

Requires (training only):
    pip install wfdb scikit-learn

MIT-BIH is downloaded automatically (~100 MB) into --data-dir on first run.

Usage:
    python3 train_ecg.py                 # download + train, all 48 records
    python3 train_ecg.py --records 100 101 102 103
    python3 train_ecg.py --list          # list records and exit

IMPORTANT: splits by record, never by beat — beats from one patient must not
appear in both train and test, or the metrics are meaningless.
"""

from __future__ import annotations

import argparse
import os
import sys

import numpy as np

from ecg_analyze import beat_feature_vector, bandpass, MODEL_NPZ

AAMI_MAP = {
    "N": "N", "L": "N", "R": "N", "e": "N", "j": "N",
    "A": "S", "a": "S", "J": "S", "S": "S",
    "V": "V", "E": "V",
    "F": "F",
    "/": "Q", "f": "Q", "Q": "Q", "?": "Q",
}
ALL_RECORDS = [
    "100", "101", "102", "103", "104", "105", "106", "107", "108", "109",
    "111", "112", "113", "114", "115", "116", "117", "118", "119", "121",
    "122", "123", "124", "200", "201", "202", "203", "205", "207", "208",
    "209", "210", "212", "213", "214", "215", "217", "219", "220", "221",
    "222", "223", "228", "230", "231", "232", "233", "234",
]


def load_record_features(data_dir: str, rec: str):
    import wfdb

    path = os.path.join(data_dir, rec)
    record = wfdb.rdrecord(path, channels=[0])
    ann = wfdb.rdann(path, "atr")
    sig = np.asarray(record.p_signal[:, 0], dtype=float)
    fs = float(record.fs)

    beat_idx = [(s, AAMI_MAP[sym]) for s, sym in zip(ann.sample, ann.symbol)
                if sym in AAMI_MAP]
    if len(beat_idx) < 5:
        return None, None

    bp = bandpass(sig, fs, 5.0, 20.0)
    r_samples = np.array([s for s, _ in beat_idx], dtype=int)
    amp_ref = float(np.median(np.abs(sig[r_samples] - np.median(sig))))
    if amp_ref <= 0:
        amp_ref = float(np.percentile(sig, 99) - np.percentile(sig, 1)) or 1.0

    rr = np.diff(r_samples) / fs * 1000.0
    rr = rr[(rr > 250) & (rr < 2500)]
    rr_med = float(np.median(rr)) if len(rr) else 800.0

    feats, labels = [], []
    for i in range(1, len(beat_idx)):
        s, label = beat_idx[i]
        rr_prev = (r_samples[i] - r_samples[i - 1]) / fs * 1000.0
        feats.append(beat_feature_vector(bp, sig, int(s), fs, rr_prev, rr_med, amp_ref))
        labels.append(label)
    return np.array(feats), np.array(labels)


def export_portable(clf, path: str) -> None:
    """Export a RandomForest to a numpy-only .npz (no sklearn at inference)."""
    arrays = {
        "classes": np.array(list(clf.classes_), dtype="U4"),
        "n_features": np.int32(clf.n_features_in_),
        "n_trees": np.int32(len(clf.estimators_)),
    }
    for t, est in enumerate(clf.estimators_):
        tree = est.tree_
        v = tree.value
        if v.ndim == 3:
            v = v[:, 0, :]
        v = v.astype(np.float64)
        s = v.sum(axis=1, keepdims=True)
        s[s == 0] = 1.0
        v = v / s
        left = tree.children_left.astype(np.int32)
        leaf = left == -1
        arrays[f"left{t}"] = left
        arrays[f"right{t}"] = tree.children_right.astype(np.int32)
        arrays[f"feat{t}"] = tree.feature.astype(np.int32)
        arrays[f"thr{t}"] = tree.threshold.astype(np.float32)
        # only leaf rows carry a prediction — halves the file size
        arrays[f"leaf{t}"] = np.flatnonzero(leaf).astype(np.int32)
        arrays[f"leafval{t}"] = v[leaf].astype(np.float32)
    np.savez_compressed(path, **arrays)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", default="ecg_data/mitdb", help="MIT-BIH download dir")
    ap.add_argument("--records", nargs="*", default=ALL_RECORDS)
    ap.add_argument("--out", default=MODEL_NPZ)
    ap.add_argument("--test-frac", type=float, default=0.25, help="fraction of records held out")
    ap.add_argument("--list", action="store_true", help="list records and exit")
    args = ap.parse_args()

    if args.list:
        print("records:", " ".join(args.records))
        return

    try:
        import wfdb  # noqa: F401
    except ImportError:
        sys.exit("wfdb is required for training:  pip install wfdb")
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.metrics import classification_report, confusion_matrix
    import json

    if not os.path.exists(args.data_dir):
        print(f"# downloading MIT-BIH into {args.data_dir} ...")
        wfdb.dl_database("mitdb", dl_dir=args.data_dir)

    # record-level split to avoid patient leakage
    recs = list(args.records)
    rng = np.random.default_rng(42)
    rng.shuffle(recs)
    n_test = max(1, int(len(recs) * args.test_frac))
    test_recs, train_recs = set(recs[:n_test]), set(recs[n_test:])

    Xtr, ytr, Xte, yte = [], [], [], []
    used = 0
    for rec in recs:
        feats, labels = load_record_features(args.data_dir, rec)
        if feats is None or len(feats) == 0:
            print(f"# skip {rec}")
            continue
        used += 1
        if rec in test_recs:
            Xte.append(feats); yte.append(labels)
        else:
            Xtr.append(feats); ytr.append(labels)
        print(f"# {rec}: {len(feats)} beats")

    if used < 3:
        sys.exit("Not enough records loaded. Check --data-dir / network access.")

    Xtr = np.vstack(Xtr); ytr = np.concatenate(ytr)
    Xte = np.vstack(Xte); yte = np.concatenate(yte)
    print(f"# train beats={len(ytr)}  test beats={len(yte)}  records={used}")

    clf = RandomForestClassifier(
        n_estimators=400, max_depth=16, min_samples_leaf=2,
        class_weight="balanced_subsample", n_jobs=-1, random_state=42,
    )
    clf.fit(Xtr, ytr)

    pred = clf.predict(Xte)
    print("\n# held-out (record-split) performance")
    print(classification_report(yte, pred, zero_division=0))
    print("# confusion labels:", list(clf.classes_))
    print(confusion_matrix(yte, pred))

    meta = {
        "classes": list(clf.classes_),
        "n_features": Xtr.shape[1],
        "feature_version": 3,
        "train_records": sorted(r for r in train_recs if r in args.records),
        "test_records": sorted(test_recs),
        "note": "AAMI beat classes {N,S,V,F,Q}; single-lead; screening only.",
    }
    export_portable(clf, args.out)
    with open(os.path.splitext(args.out)[0] + ".json", "w") as fh:
        json.dump(meta, fh, indent=2)

    # Sanity: the numpy-only portable model must match sklearn's predictions.
    from ecg_analyze import PortableForest
    portable = PortableForest(args.out)
    agree = float(np.mean(portable.predict(Xte) == clf.predict(Xte)))
    print(f"# portable/sklearn prediction agreement: {agree*100:.2f}%")
    print(f"# saved {args.out} ({os.path.getsize(args.out)/1e6:.1f} MB)")


if __name__ == "__main__":
    main()