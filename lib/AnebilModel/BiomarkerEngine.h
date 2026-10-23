// BiomarkerEngine — faithful port of spectru's BiomarkerEngine: all four
// biomarkers (SpO2, HR, Hb, Bili) derive from AC/DC ratios + LinearCalibrator.
// Companion to SignalFilter and LinearCalibrator.
//
// Algorithms (matches spectru):
//
//   For each wavelength λ ∈ {blue, green, red, nir}:
//     ema_ac_λ ← EMA(|ac_λ|, alpha=0.1)
//     ema_dc_λ ← EMA( dc_λ,  alpha=0.1)
//     R_λ      = ema_ac_λ / ema_dc_λ                (if ema_dc_λ > 10)
//
//   SpO2 = spo2_A - spo2_B * (R_red / R_nir)        (default fallback)
//        = spo2Cal.predict(R_red / R_nir)            (when fitted)
//
//   Hb_index = (R_green / R_nir) / (R_red / R_nir)
//   Hb_g_dL  = hbCal.predict(Hb_index)              (when fitted)
//
//   Bili_index = (R_blue / R_nir) / (R_red / R_nir)
//   Bili_mg_dL = biliCal.predict(Bili_index)        (when fitted)
//
//   HR:  bandpass-filtered AC_green → adaptive-threshold peak detector
//        → median R-R interval → BPM. Optional hrCal maps to a chest-strap
//        reference BPM.
//
// PI and SQI are computed for diagnostics ONLY — biomarker outputs are
// never gated on them (spectru gated; this port does not).
//
// Clinical reference for 1-10 scoring (WHO ranges):
//   Hb:   7 g/dL = severe anemia (1), 15 g/dL = optimal (10)
//   Bili: 5 mg/dL = clinical jaundice (1), 0.3 mg/dL = normal (10)

#pragma once

#include "SignalFilter.h"
#include "LinearCalibrator.h"
#include "MultiCalibrator.h"

struct Biomarkers {
    // SpO2
    float spo2          = 0.0f;
    float ror           = 0.0f;

    // Diagnostics only — not used for gating
    float pi            = 0.0f;
    float sqi           = 0.0f;

    // Heart rate / HRV
    float heart_rate    = 0.0f;
    float hr_bpm_raw    = 0.0f;
    float hrv_sdnn      = 0.0f;
    float hrv_rmssd     = 0.0f;
    bool  hr_valid      = false;
    bool  hr_cal_valid  = false;

    // Hemoglobin
    float hb_index      = 0.0f;
    float hb_g_dl       = 0.0f;
    float hb_score      = 0.0f;     // 1..10 (anemia → optimal)
    bool  hb_cal_valid  = false;

    // Bilirubin
    float bili_index    = 0.0f;
    float bili_mg_dl    = 0.0f;
    float bili_score    = 0.0f;     // 1..10 (jaundice → normal)
    bool  bili_cal_valid= false;
};

class BiomarkerEngine {
public:
    // Default SpO2 line (used until spo2Cal is fitted)
    float spo2_A = 110.0f;
    float spo2_B = 25.0f;

    // SpO2 and HR work fine with a 1-D ratio (RoR for SpO2, raw BPM for HR).
    LinearCalibrator<20> spo2Cal;
    LinearCalibrator<20> hrCal;

    // Hb / Bili use MULTIVARIATE regression with 6 features each:
    //   index 0: bias (constant 1)
    //   index 1-5: log-ratio features (AC/DC + DC/DC) — see _buildHbFeatures
    //              and _buildBiliFeatures in the .cpp for the exact mix.
    // This lets the fit separate "haemoglobin signal" from "skin tone /
    // tissue density" using extra wavelength information per training point.
    static constexpr int HB_FEATS   = 10;
    static constexpr int BILI_FEATS = 10;
    MultiCalibrator<HB_FEATS,   20> hbCal;
    MultiCalibrator<BILI_FEATS, 20> biliCal;

    // Build the feature vectors externally (e.g. for the c<...> training cmd)
    void buildHbFeatures  (float f[HB_FEATS])   const;
    void buildBiliFeatures(float f[BILI_FEATS]) const;

    void init(float fs);
    void update(const SignalFilter& f, uint32_t timestamp_us);

    void loadCalibration(const char* ns = "spectru");
    void saveCalibration(const char* ns = "spectru");
    void resetCalibration(const char* which);   // "hb" "bili" "spo2" "hr" "all"

    const Biomarkers& results() const { return _out; }

private:
    float _fs = 40.0f;

    // Slow AC envelope EMA — alpha derived from Fs for ~2 s time constant.
    // Spectru used a fixed alpha=0.1 (~250 ms TC at 40 Hz) which let the
    // tracker oscillate at heart-rate frequency; the SQI gate hid the noise.
    // We don't gate, so we stabilise the envelope here instead.
    float _ror_alpha = 0.0124f;     // recomputed in init()

    float _ema_ac_f1  = 0, _ema_dc_f1  = 0;
    float _ema_ac_fz  = 0, _ema_dc_fz  = 0;
    float _ema_ac_fy  = 0, _ema_dc_fy  = 0;
    float _ema_ac_f6  = 0, _ema_dc_f6  = 0;
    float _ema_ac_f7  = 0, _ema_dc_f7  = 0;
    float _ema_ac_nir = 0, _ema_dc_nir = 0;

    // ---- Output median filter (~1 s window) ----
    // The slow AC EMA stabilises envelope amplitude, but the *ratios* still
    // drift because skin/breathing/pressure all vary over seconds. A median
    // filter on the index outputs rejects outliers and gives a stable value
    // the user can actually read off — same effect spectru got from freezing
    // during SQI<0.8, but without needing a quality metric you don't trust.
    static constexpr int MED_WIN = 60;
    float _med_ror[MED_WIN]   = {};
    float _med_hb[MED_WIN]    = {};
    float _med_bili[MED_WIN]  = {};
    int   _med_idx            = 0;
    int   _med_count          = 0;
    static float _median_of(const float* buf, int n);

    // ---- SQI full 6-channel correlation matrix (computed, not gated) ----
    // SQI = min of all C(6,2)=15 pairwise Pearson correlations.
    static constexpr float SQI_ALPHA = 0.05f;
    float _var_f1 = 0, _var_fz = 0, _var_fy = 0;
    float _var_f6 = 0, _var_f7 = 0, _var_nir = 0;
    // 15 covariances — upper triangle of the 6×6 correlation matrix
    float _cov_f1_fz = 0, _cov_f1_fy = 0, _cov_f1_f6 = 0, _cov_f1_f7 = 0, _cov_f1_n = 0;
    float _cov_fz_fy = 0, _cov_fz_f6 = 0, _cov_fz_f7 = 0, _cov_fz_n  = 0;
    float _cov_fy_f6 = 0, _cov_fy_f7 = 0, _cov_fy_n  = 0;
    float _cov_f6_f7 = 0, _cov_f6_n  = 0;
    float _cov_f7_n  = 0;

    // ---- HR peak detector ----
    // spectru uses a 2nd-order Butterworth @ 4 Hz for Fs=40. We compute the
    // coefficients at init() from the actual Fs so detection still works at
    // 25-100 Hz; falls back to spectru's hard-coded coefficients at 40 Hz.
    float _b0 = 0.0675f, _b1 = 0.1349f, _b2 = 0.0675f;
    float _a1 = -1.1430f, _a2 = 0.4128f;
    float _lp_x1 = 0, _lp_x2 = 0, _lp_y1 = 0, _lp_y2 = 0;
    float _lpFilter(float x);

    static constexpr int PEAK_BUF       = 16;
    static constexpr int AC_WIN_MAX     = 200;
    static constexpr float THRESHOLD_K  = 0.5f;
    float    _ac_win[AC_WIN_MAX] = {};
    int      _ac_win_size        = 80;
    int      _ac_win_idx         = 0;
    float    _rr_buf[PEAK_BUF]   = {};
    int      _rr_head            = 0;
    int      _rr_count           = 0;
    bool     _above_thresh       = false;
    uint32_t _last_peak_us       = 0;
    int      _refract_cnt        = 0;
    int      _refract_samples    = 12;

    void  _pushRR(float rr_ms);
    void  _computeHRHRV();
    float _computeThreshold();
    static float _median(float* a, int n);

    Biomarkers _out;
};
