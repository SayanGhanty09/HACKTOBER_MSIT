"""ECG analysis engine — single-lead rhythm / HRV / morphology screening.

Pure-numpy so it works without scipy. Used by the FastAPI `/api/v1/ecg/analyze`
endpoint and by `train_ecg.py` for feature extraction.

Screening only — NOT a diagnostic device. Single-lead AD8232 (~0.5-40 Hz
bandwidth) cannot diagnose myocardial infarction or any cardiac condition.

Pipeline:
    raw int16 samples -> bandpass 5-20 Hz -> derivative/square/integrate
    -> R-peak detection -> RR intervals -> HRV + rhythm + morphology features
    -> optional ML beat classifier (ecg_rhythm_model.joblib) -> rule fallback
"""

from __future__ import annotations

import os
from typing import Any

import numpy as np

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, "ecg_rhythm_model.joblib")   # optional
MODEL_NPZ = os.path.join(BASE_DIR, "ecg_rhythm_model.npz")       # portable, numpy-only

AAMI_BEAT_CLASSES = ["N", "S", "V", "F", "Q"]
AAMI_LABELS = {
    "N": "Normal beat",
    "S": "Supraventricular ectopic (PAC)",
    "V": "Ventricular ectopic (PVC)",
    "F": "Fusion beat",
    "Q": "Unclassifiable beat",
}

BEAT_N_WAVE = 24
BEAT_N_SUMMARY = 12
BEAT_N_FEATURES = BEAT_N_SUMMARY + BEAT_N_WAVE

DISCLAIMER = (
    "Screening-grade analysis of a single-lead ECG. Not a diagnostic device. "
    "It cannot detect or rule out a heart attack. Consult a clinician for any "
    "concerning result."
)

_RHYTHM_MODEL = None
_MODEL_LOADED = False


# --------------------------------------------------------------------------
# Filtering / signal helpers
# --------------------------------------------------------------------------

def _rbj_biquad(fs: float, f0: float, kind: str, q: float = 0.7071):
    w0 = 2.0 * np.pi * f0 / fs
    cw, sw = np.cos(w0), np.sin(w0)
    alpha = sw / (2.0 * q)
    if kind == "lp":
        b = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2]
    else:  # hp
        b = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2]
    a = [1 + alpha, -2 * cw, 1 - alpha]
    return (np.array(b) / a[0], np.array(a[1:]) / a[0])


def _iir(x: np.ndarray, b: np.ndarray, a: np.ndarray) -> np.ndarray:
    y = np.zeros_like(x)
    z1 = z2 = 0.0
    for i in range(len(x)):
        xi = x[i]
        yi = b[0] * xi + z1
        z1 = b[1] * xi - a[0] * yi + z2
        z2 = b[2] * xi - a[1] * yi
        y[i] = yi
    return y


def _filtfilt(x: np.ndarray, b: np.ndarray, a: np.ndarray) -> np.ndarray:
    # Use scipy when present (training is ~100x faster). padtype=None keeps
    # pure forward-backward filtering, matching the numpy fallback.
    try:
        from scipy.signal import filtfilt as _sp_filtfilt
        return _sp_filtfilt(b, a, x, padtype=None)
    except Exception:
        pass
    y = _iir(x, b, a)
    y = y[::-1].copy()
    y = _iir(y, b, a)
    return y[::-1].copy()


def bandpass(x: np.ndarray, fs: float, lo: float = 5.0, hi: float = 20.0) -> np.ndarray:
    x = np.asarray(x, dtype=float)
    if len(x) < 16:
        return x - np.mean(x)
    x = x - np.mean(x)
    hp = _filtfilt(x, *_rbj_biquad(fs, lo, "hp"))
    lp = _filtfilt(hp, *_rbj_biquad(fs, hi, "lp"))
    return lp


def _moving_average(x: np.ndarray, win: int) -> np.ndarray:
    if win < 1:
        return x
    c = np.cumsum(np.insert(x, 0, 0.0))
    out = (c[win:] - c[:-win]) / win
    pad = np.full(win - 1, out[0] if len(out) else 0.0)
    return np.concatenate([pad, out])


def _find_peaks(sig: np.ndarray, thr: float, min_dist: int) -> list[int]:
    peaks: list[int] = []
    n = len(sig)
    i = 0
    last = -min_dist
    while i < n:
        if sig[i] > thr:
            j = i
            while j + 1 < n and sig[j + 1] > sig[j]:
                j += 1
            if j - last >= min_dist:
                peaks.append(j)
                last = j
            i = j + 1
        else:
            i += 1
    return peaks


# --------------------------------------------------------------------------
# R-peak detection (Pan-Tompkins style, numpy only)
# --------------------------------------------------------------------------

def detect_r_peaks(samples: np.ndarray, fs: float) -> np.ndarray:
    x = np.asarray(samples, dtype=float)
    if len(x) < int(0.5 * fs):
        return np.array([], dtype=int)

    bp = bandpass(x, fs, 5.0, 20.0)
    d = np.diff(bp, prepend=bp[0])
    integ = _moving_average(d * d, max(1, int(0.120 * fs)))

    ref = np.percentile(integ, 98)
    if ref <= 0:
        return np.array([], dtype=int)
    thr = 0.30 * ref
    min_dist = max(1, int(0.25 * fs))
    peaks = _find_peaks(integ, thr, min_dist)

    lo = max(1, int(0.05 * fs))
    refined = []
    for p in peaks:
        a, b = max(0, p - lo), min(len(bp), p + lo + 1)
        if b > a:
            refined.append(a + int(np.argmax(np.abs(bp[a:b]))))

    # Drop peaks too close together (keep the stronger)
    out: list[int] = []
    for p in refined:
        if out and (p - out[-1]) < min_dist:
            if abs(bp[p]) > abs(bp[out[-1]]):
                out[-1] = p
        else:
            out.append(p)
    return np.array(out, dtype=int)


# --------------------------------------------------------------------------
# HRV
# --------------------------------------------------------------------------

def compute_hrv(rr_ms: np.ndarray) -> dict[str, float]:
    if len(rr_ms) < 2:
        return {"mean_rr": 0.0, "sdnn": 0.0, "rmssd": 0.0, "pnn50": 0.0, "cv": 0.0}
    diffs = np.diff(rr_ms)
    sdnn = float(np.std(rr_ms, ddof=1)) if len(rr_ms) > 1 else 0.0
    rmssd = float(np.sqrt(np.mean(diffs ** 2)))
    pnn50 = float(100.0 * np.mean(np.abs(diffs) > 50.0))
    mean_rr = float(np.mean(rr_ms))
    return {
        "mean_rr": round(mean_rr, 1),
        "sdnn": round(sdnn, 1),
        "rmssd": round(rmssd, 1),
        "pnn50": round(pnn50, 1),
        "cv": round(float(np.std(rr_ms) / mean_rr) if mean_rr else 0.0, 4),
    }


# --------------------------------------------------------------------------
# Beat morphology features (shared with train_ecg.py)
# --------------------------------------------------------------------------

def qrs_width_ms(bp: np.ndarray, r: int, fs: float) -> float:
    lo, hi = max(0, r - int(0.12 * fs)), min(len(bp), r + int(0.12 * fs))
    if hi - lo < 3:
        return 0.0
    seg = np.abs(bp[lo:hi])
    peak = seg.max()
    if peak <= 0:
        return 0.0
    mask = seg > 0.2 * peak
    return float(np.sum(mask) / fs * 1000.0)


def _beat_wave(x: np.ndarray, r: int, fs: float, amp_ref: float,
               n: int = BEAT_N_WAVE) -> np.ndarray:
    """Downsampled, baseline-removed, scale-normalised beat template."""
    a = max(0, r - int(0.10 * fs))
    b = min(len(x), r + int(0.25 * fs))
    if b - a < 4:
        return np.zeros(n)
    seg = x[a:b]
    w0, w1 = max(0, r - int(0.40 * fs)), max(1, r - int(0.25 * fs))
    base = float(np.median(x[w0:w1])) if w1 > w0 else float(x[r])
    seg = (seg - base) / max(amp_ref, 1e-6)
    xi = np.linspace(0, len(seg) - 1, n)
    return np.interp(xi, np.arange(len(seg)), seg)


def beat_feature_vector(bp: np.ndarray, x: np.ndarray, r: int, fs: float,
                        rr_prev: float, rr_med: float, amp_ref: float = 1.0) -> np.ndarray:
    """Fixed-length, scale-invariant features around one R peak (single-lead).

    Amplitudes are normalised by `amp_ref` (a robust R-wave amplitude) so the
    same features work for device ADC counts and dataset millivolts. The
    summary stats are followed by a downsampled beat template.
    """
    def seg(a_ms: float, b_ms: float) -> np.ndarray:
        a, b = max(0, r + int(a_ms * fs / 1000)), min(len(x), r + int(b_ms * fs / 1000))
        return x[a:b] if b > a else np.zeros(1)

    pre = seg(-350, -120)     # P-wave region
    qrs = seg(-60, 60)
    st = seg(80, 120)         # ST segment
    tw = seg(150, 400)        # T wave
    r_amp = float(abs(x[r]))
    baseline = float(np.median(seg(-400, -250)))
    qrs_amp = float(np.max(np.abs(qrs - baseline)))
    ar = max(amp_ref, 1e-6)
    summary = [
        rr_prev / max(rr_med, 1e-6),                       # prematurity ratio
        rr_med / 1000.0,                                   # local rate context
        qrs_width_ms(bp, r, fs) / 100.0,                   # QRS width
        (r_amp - baseline) / ar,                           # R amplitude
        float(np.min(qrs) - baseline) / ar,                # Q depth
        float(np.max(qrs) - baseline) / ar,                # R height
        float(np.max(np.abs(tw - baseline))) / ar,         # T amplitude
        float(np.mean(st) - baseline) / ar,                # ST level
        float(np.max(np.abs(pre - baseline))) / ar,        # P-wave amplitude
        qrs_amp / ar,                                      # QRS energy
        qrs_amp / max(r_amp, 1e-6),                        # QRS/R ratio
        float(np.std(qrs)) / ar,                           # QRS variability
    ]
    wave = _beat_wave(x, r, fs, amp_ref)
    return np.concatenate([np.array(summary, dtype=float), wave])


# --------------------------------------------------------------------------
# Optional ML beat classifier
# --------------------------------------------------------------------------

class PortableForest:
    """Numpy-only inference for a RandomForest exported by train_ecg.py.

    Version-proof: no scikit-learn needed to serve predictions.
    """

    def __init__(self, path: str):
        z = np.load(path, allow_pickle=False)
        self.classes = [str(c) for c in z["classes"]]
        self.n_features = int(z["n_features"])
        self.n_trees = int(z["n_trees"])
        self.trees = []
        for t in range(self.n_trees):
            self.trees.append((z[f"left{t}"], z[f"right{t}"], z[f"feat{t}"],
                               z[f"thr{t}"], z[f"leaf{t}"], z[f"leafval{t}"]))

    def predict(self, X: np.ndarray) -> np.ndarray:
        X = np.asarray(X, dtype=np.float64)
        scores = np.zeros((X.shape[0], len(self.classes)))
        for left, right, feat, thr, leaf, leafval in self.trees:
            for i in range(X.shape[0]):
                node = 0
                while feat[node] >= 0:
                    node = left[node] if X[i, feat[node]] <= thr[node] else right[node]
                scores[i] += leafval[np.searchsorted(leaf, node)]
        return np.array([self.classes[j] for j in np.argmax(scores, axis=1)])


def load_model():
    global _RHYTHM_MODEL, _MODEL_LOADED
    if _MODEL_LOADED:
        return _RHYTHM_MODEL
    _MODEL_LOADED = True
    if os.path.exists(MODEL_NPZ):
        try:
            _RHYTHM_MODEL = PortableForest(MODEL_NPZ)
            return _RHYTHM_MODEL
        except Exception as exc:  # pragma: no cover
            print(f"[ecg] portable model load failed: {exc}")
    if os.path.exists(MODEL_PATH):
        try:
            import joblib
            obj = joblib.load(MODEL_PATH)
            _RHYTHM_MODEL = obj.get("model", obj) if isinstance(obj, dict) else obj
        except Exception as exc:  # pragma: no cover
            print(f"[ecg] model load failed: {exc}")
            _RHYTHM_MODEL = None
    return _RHYTHM_MODEL


# --------------------------------------------------------------------------
# Main analysis
# --------------------------------------------------------------------------

def analyze_ecg(samples: np.ndarray, fs: float, use_model: bool = True) -> dict[str, Any]:
    x = np.asarray(samples, dtype=float).ravel()
    if fs <= 0:
        fs = 1000.0
    duration_s = len(x) / fs
    result: dict[str, Any] = {
        "fs": fs,
        "samples": int(len(x)),
        "duration_s": round(duration_s, 2),
        "disclaimer": DISCLAIMER,
        "model_used": False,
    }

    if len(x) < int(1.5 * fs):
        result.update({"quality": "poor", "rhythm": "insufficient_data",
                       "flags": ["insufficient_data"], "insights": [
                           {"level": "bad", "text": "Recording too short — at least 5-10 s needed."}],
                       "hr_bpm": None, "hrv": None, "beats": 0})
        return result

    p2p = float(np.percentile(x, 99) - np.percentile(x, 1))
    bp = bandpass(x, fs, 5.0, 20.0)
    noise = float(np.std(bp))
    rpeaks = detect_r_peaks(x, fs)

    flags: list[str] = []
    insights: list[dict[str, str]] = []

    if len(rpeaks) < 3:
        result.update({"quality": "poor", "rhythm": "undetectable",
                       "flags": ["poor_signal", "few_beats"],
                       "insights": [{"level": "bad",
                                     "text": "Could not detect a stable pulse. Check electrode contact/placement."}],
                       "hr_bpm": None, "hrv": None, "beats": int(len(rpeaks))})
        return result

    rr = np.diff(rpeaks) / fs * 1000.0
    rr = rr[(rr > 250) & (rr < 2500)]
    if len(rr) < 2:
        rr = np.diff(rpeaks) / fs * 1000.0
    rr_med = float(np.median(rr))
    hr = 60000.0 / rr_med if rr_med > 0 else 0.0
    hrv = compute_hrv(rr)

    # Per-beat features + optional model classification
    amp_ref = float(np.median(np.abs(x[rpeaks] - np.median(x))))
    if amp_ref <= 0:
        amp_ref = float(np.percentile(x, 99) - np.percentile(x, 1)) or 1.0
    feats = []
    for i in range(1, len(rpeaks)):
        prev_rr = (rpeaks[i] - rpeaks[i - 1]) / fs * 1000.0
        feats.append(beat_feature_vector(bp, x, int(rpeaks[i]), fs, prev_rr, rr_med, amp_ref))
    feats = np.array(feats) if feats else np.zeros((0, BEAT_N_FEATURES))

    ectopic_flags = []
    model = load_model() if use_model else None
    pvc_burden = pac_burden = 0.0
    if model is not None and len(feats):
        try:
            pred = np.array([AAMI_BEAT_CLASSES.index(p) if p in AAMI_BEAT_CLASSES else 0
                             for p in model.predict(feats)])
            pvc_burden = float(np.mean(pred == AAMI_BEAT_CLASSES.index("V")))
            pac_burden = float(np.mean(pred == AAMI_BEAT_CLASSES.index("S")))
            result["model_used"] = True
        except Exception:
            model = None

    # Rule-based ectopy fallback: premature + wide complexes
    if len(feats):
        prem = feats[:, 0] < 0.8
        wide = feats[:, 2] > 1.2   # qrs width feature is /100 ms
        ectopic_flags = list(prem & wide)
        if model is None:
            pvc_burden = float(np.mean(prem & wide))

    # ---- Rhythm classification (rules) ----
    cv = hrv["cv"]
    rmssd = hrv["rmssd"]
    quality = "good"
    if noise > 0 and p2p > 0 and noise / p2p > 0.5:
        quality = "fair"
    if p2p < 50:
        quality = "poor"
        flags.append("low_amplitude")

    # Beat-by-beat heart rates & metrics
    instant_bpm = [round(60000.0 / float(r), 1) for r in rr if r > 0]
    min_hr = round(float(np.min(instant_bpm)), 1) if instant_bpm else round(hr, 1)
    max_hr = round(float(np.max(instant_bpm)), 1) if instant_bpm else round(hr, 1)
    total_beats = int(len(rpeaks))

    # Regularity: percentage of RR intervals within ±15% of median interval
    if rr_med > 0 and len(rr) > 0:
        regular_mask = np.abs(rr - rr_med) / rr_med <= 0.15
        regularity_pct = round(float(100.0 * np.mean(regular_mask)), 1)
    else:
        regularity_pct = 100.0

    # Estimated QRS duration (average ventricular activation width)
    qrs_widths = [qrs_width_ms(bp, int(rp), fs) for rp in rpeaks]
    qrs_duration_ms = round(float(np.median(qrs_widths)), 1) if qrs_widths else 0.0

    rhythm = "sinus_rhythm"
    if cv > 0.12 and rmssd > 90 and 40 <= hr <= 180 and len(rr) >= 6:
        rhythm = "possible_afib"
        flags.append("irregular_rhythm")
        insights.append({"level": "warn",
                         "text": "R-R intervals are irregular — possible atrial fibrillation. Confirm with a clinician."})
    elif hr < 50:
        rhythm = "bradycardia"
        flags.append("bradycardia")
        insights.append({"level": "warn", "text": f"Slow heart rate ({hr:.0f} bpm)."})
    elif hr > 100:
        rhythm = "tachycardia"
        flags.append("tachycardia")
        insights.append({"level": "warn", "text": f"Fast heart rate ({hr:.0f} bpm)."})
    else:
        insights.append({"level": "good", "text": f"Regular rhythm at {hr:.0f} bpm."})

    if pvc_burden > 0.10:
        flags.append("frequent_pvc")
        insights.append({"level": "warn",
                         "text": f"Frequent ventricular ectopic beats (~{pvc_burden*100:.0f}% of beats)."})
    elif pvc_burden > 0.02:
        flags.append("occasional_pvc")

    if hrv["sdnn"] and hrv["sdnn"] > 0:
        if hrv["sdnn"] < 20:
            insights.append({"level": "warn", "text": f"Low HRV (SDNN {hrv['sdnn']:.0f} ms)."})
        elif hrv["sdnn"] > 200:
            insights.append({"level": "warn", "text": "Very high HRV — check for artifacts/ectopy."})
        else:
            insights.append({"level": "good", "text": f"HRV within a typical range (SDNN {hrv['sdnn']:.0f} ms)."})

    if quality == "poor":
        insights.append({"level": "bad", "text": "Weak/noisy signal — results may be unreliable."})

    # ---- Detailed Plain-Language (Layman) Summary ----
    if rhythm == "possible_afib":
        headline = "Irregular Rhythm Detected"
        badge = {"label": "Possible Irregularity", "tone": "warn"}
        plain_summary = (
            f"Your heart beat {total_beats} times over {duration_s:.1f} seconds at an average pace of {hr:.0f} BPM. "
            "However, the intervals between beats are uneven or irregular. We recommend sharing this recording "
            "with a doctor or cardiologist for verification."
        )
    elif hr < 50:
        headline = "Relaxed / Slow Heartbeat (Resting Pace)"
        badge = {"label": "Slow Resting Pace", "tone": "warn"}
        plain_summary = (
            f"Your heart is beating at a calm rate of {hr:.0f} BPM ({total_beats} total beats recorded). "
            "A rate under 50-60 BPM is common during sleep, deep rest, or in physically active athletes. "
            "If you feel lightheaded or fatigued, discuss it with a healthcare professional."
        )
    elif hr > 100:
        headline = "Elevated Heartbeat (Fast Pace)"
        badge = {"label": "Elevated Pace", "tone": "warn"}
        plain_summary = (
            f"Your heart rate is currently elevated at {hr:.0f} BPM ({total_beats} total beats recorded). "
            "Higher heart rates can be triggered by caffeine, excitement, recent walking or physical activity, "
            "dehydration, or mild stress."
        )
    else:
        headline = "Normal & Steady Heartbeat"
        badge = {"label": "Normal Resting Pace", "tone": "success"}
        plain_summary = (
            f"Your heart is beating steadily at {hr:.0f} BPM ({total_beats} beats recorded over {duration_s:.1f} seconds). "
            "The rhythm is consistent with a healthy resting heart, and electrical signals show steady pacing."
        )

    # Heart rate category details
    if hr < 60:
        hr_cat = "Lower than typical (<60 BPM)"
        hr_tone = "warn"
        hr_desc = "Common in athletic individuals or during deep relaxation. Check with a doctor if accompanied by dizziness."
    elif hr <= 100:
        hr_cat = "Normal Resting Range (60–100 BPM)"
        hr_tone = "success"
        hr_desc = "Optimal resting heart rate for healthy adults. Indicates standard cardiovascular workload."
    else:
        hr_cat = "Elevated (>100 BPM)"
        hr_tone = "warn"
        hr_desc = "Faster than standard resting baseline. Can be caused by caffeine, recent movement, stress, or excitement."

    # Regularity details
    if regularity_pct >= 90:
        reg_status = "Very Steady"
        reg_tone = "success"
        reg_desc = f"{regularity_pct:.0f}% of your heartbeats had consistent, clockwork spacing."
    elif regularity_pct >= 75:
        reg_status = "Mild Variation"
        reg_tone = "success"
        reg_desc = f"{regularity_pct:.0f}% regular pacing. Minor variations are naturally caused by breathing in and out."
    else:
        reg_status = "Uneven Pacing"
        reg_tone = "warn"
        reg_desc = f"Noticeable variation between beats ({regularity_pct:.0f}% regularity). Worth a check if sustained."

    # Extra beats explanation
    total_ectopy = round((pvc_burden + pac_burden) * 100, 1)
    if total_ectopy < 2.0:
        ectopy_desc = "None detected. Your heart's electrical pathways fired in normal sequence."
    elif total_ectopy < 10.0:
        ectopy_desc = (
            f"A few occasional extra beats (~{total_ectopy:.0f}% of beats). "
            "Occasional extra beats are common 'hiccups' usually linked to caffeine, fatigue, or stress."
        )
    else:
        ectopy_desc = (
            f"Frequent extra or skipped beats detected (~{total_ectopy:.0f}%). "
            "Consider sharing this trace with your physician for a routine check-up."
        )

    # HRV description
    sdnn = hrv.get("sdnn", 0)
    if sdnn > 40:
        hrv_desc = (
            f"Optimal HRV (SDNN {sdnn:.0f} ms). Healthy variation between beats indicates good recovery "
            "and adaptable nervous system balance."
        )
    elif sdnn >= 20:
        hrv_desc = (
            f"Moderate HRV (SDNN {sdnn:.0f} ms). Typical resting range reflecting normal autonomic balance."
        )
    else:
        hrv_desc = (
            f"Lower HRV (SDNN {sdnn:.0f} ms). Often seen during fatigue, physical exertion, illness, or acute stress."
        )

    tips = [
        "Drink plenty of water to keep your blood volume and heart rate steady.",
        "Take 5 minutes for slow, deep breathing to help lower resting cardiac stress.",
        "Ensure consistent 7–8 hours of restorative sleep to recharge your heart.",
        "If you ever experience shortness of breath, unexplained dizziness, or chest tightness, seek immediate medical attention.",
    ]

    layman_summary = {
        "headline": headline,
        "badge": badge,
        "plain_text_summary": plain_summary,
        "total_beats": total_beats,
        "heart_rate": {
            "bpm": round(hr, 1),
            "min_bpm": min_hr,
            "max_bpm": max_hr,
            "category": hr_cat,
            "tone": hr_tone,
            "description": hr_desc,
        },
        "rhythm": {
            "label": "Sinus Rhythm" if rhythm == "sinus_rhythm" else rhythm.replace("_", " ").title(),
            "tone": "success" if rhythm == "sinus_rhythm" else "warn",
            "description": (
                "'Sinus Rhythm' is the clinical term for normal, healthy pacing driven by your heart's natural pacemaker (the SA node)."
                if rhythm == "sinus_rhythm" else
                "An atypical rhythm pattern was noted. Review with a medical professional."
            ),
        },
        "regularity": {
            "percentage": regularity_pct,
            "status": reg_status,
            "tone": reg_tone,
            "description": reg_desc,
        },
        "extra_beats": {
            "burden_pct": total_ectopy,
            "description": ectopy_desc,
        },
        "hrv": {
            "sdnn": sdnn,
            "description": hrv_desc,
        },
        "tips": tips,
    }

    result.update({
        "quality": quality,
        "rhythm": rhythm,
        "hr_bpm": round(hr, 1),
        "min_hr_bpm": min_hr,
        "max_hr_bpm": max_hr,
        "avg_hr_bpm": round(float(np.mean(instant_bpm)), 1) if instant_bpm else round(hr, 1),
        "regularity_pct": regularity_pct,
        "qrs_duration_ms": qrs_duration_ms,
        "hrv": hrv,
        "beats": total_beats,
        "total_beats": total_beats,
        "pvc_burden": round(pvc_burden, 3),
        "pac_burden": round(pac_burden, 3),
        "flags": flags,
        "insights": insights,
        "layman_summary": layman_summary,
    })
    return result


def analyze_i16_le(payload: bytes, fs: float, use_model: bool = True) -> dict[str, Any]:
    samples = np.frombuffer(payload, dtype="<i2").astype(float)
    return analyze_ecg(samples, fs, use_model=use_model)