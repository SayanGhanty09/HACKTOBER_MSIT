#include "BiomarkerEngine.h"
#include <math.h>
#include <string.h>
#include <Preferences.h>

// ---------------------------------------------------------------------------
// Clinical reference ranges for 1-10 scoring (matches spectru / WHO)
// ---------------------------------------------------------------------------
static constexpr float HB_WORST   = 7.0f;
static constexpr float HB_BEST    = 15.0f;
static constexpr float BILI_WORST = 5.0f;
static constexpr float BILI_BEST  = 0.3f;

static float scoreMap(float value, float ref_low, float ref_high) {
    if (fabsf(ref_high - ref_low) < 1e-9f) return 5.0f;
    float s = 1.0f + 9.0f * (value - ref_low) / (ref_high - ref_low);
    if (s < 1.0f)  s = 1.0f;
    if (s > 10.0f) s = 10.0f;
    return s;
}

// ---------------------------------------------------------------------------
// Butterworth 2nd-order LP coefficients designed at runtime for cutoff 4 Hz
// and the actual sample rate. Bilinear-transform of the standard analogue
// prototype. At Fs=40 the coefficients match spectru's pre-computed values.
// ---------------------------------------------------------------------------
static void designButterworth(float fs, float fc,
                              float& b0, float& b1, float& b2,
                              float& a1, float& a2) {
    const float pi = 3.14159265358979f;
    const float wd = 2.0f * pi * fc;
    const float wa = 2.0f * fs * tanf(wd / (2.0f * fs));    // pre-warp
    const float wa2 = wa * wa;
    const float sqrt2 = 1.41421356237f;
    const float k  = 4.0f * fs * fs + 2.0f * sqrt2 * fs * wa + wa2;
    b0 = wa2 / k;
    b1 = 2.0f * wa2 / k;
    b2 = wa2 / k;
    a1 = (2.0f * wa2 - 8.0f * fs * fs) / k;
    a2 = (4.0f * fs * fs - 2.0f * sqrt2 * fs * wa + wa2) / k;
}

void BiomarkerEngine::init(float fs) {
    _fs = (fs > 1.0f) ? fs : 40.0f;

    // AC envelope smoothing — 2 s time constant, Fs-adaptive.
    // alpha = 1 - exp(-1 / (Ts * Fs)) with Ts = 2 s.
    _ror_alpha = 1.0f - expf(-1.0f / (2.0f * _fs));

    designButterworth(_fs, 4.0f, _b0, _b1, _b2, _a1, _a2);

    _ac_win_size = (int)(2.0f * _fs);
    if (_ac_win_size < 20)         _ac_win_size = 20;
    if (_ac_win_size > AC_WIN_MAX) _ac_win_size = AC_WIN_MAX;
    memset(_ac_win, 0, sizeof(_ac_win));

    _refract_samples = (int)(0.3f * _fs);
    if (_refract_samples < 3) _refract_samples = 3;

    memset(_rr_buf, 0, sizeof(_rr_buf));
    _rr_head = _rr_count = 0;
    _above_thresh = false;
    _last_peak_us = 0;
    _refract_cnt  = 0;
    _ac_win_idx   = 0;
    _lp_x1 = _lp_x2 = _lp_y1 = _lp_y2 = 0;

    _ema_ac_f1 = _ema_dc_f1 = 0;
    _ema_ac_fz = _ema_dc_fz = 0;
    _ema_ac_fy = _ema_dc_fy = 0;
    _ema_ac_f6 = _ema_dc_f6 = 0;
    _ema_ac_f7 = _ema_dc_f7 = 0;
    _ema_ac_nir = _ema_dc_nir = 0;
    _var_f1 = _var_fz = _var_fy = _var_f6 = _var_f7 = _var_nir = 0;
    _cov_f1_fz = _cov_f1_fy = _cov_f1_f6 = _cov_f1_f7 = _cov_f1_n  = 0;
    _cov_fz_fy = _cov_fz_f6 = _cov_fz_f7 = _cov_fz_n  = 0;
    _cov_fy_f6 = _cov_fy_f7 = _cov_fy_n  = 0;
    _cov_f6_f7 = _cov_f6_n  = 0;
    _cov_f7_n  = 0;

    memset(_med_ror,  0, sizeof(_med_ror));
    memset(_med_hb,   0, sizeof(_med_hb));
    memset(_med_bili, 0, sizeof(_med_bili));
    _med_idx = 0;
    _med_count = 0;

    _out = Biomarkers{};
}

float BiomarkerEngine::_median_of(const float* buf, int n) {
    if (n <= 0) return 0.0f;
    if (n == 1) return buf[0];
    // Insertion sort on a stack copy — N is small (≤ MED_WIN = 60)
    float tmp[MED_WIN];
    for (int i = 0; i < n; i++) tmp[i] = buf[i];
    for (int i = 1; i < n; i++) {
        const float key = tmp[i];
        int j = i - 1;
        while (j >= 0 && tmp[j] > key) { tmp[j + 1] = tmp[j]; j--; }
        tmp[j + 1] = key;
    }
    if (n & 1) return tmp[n / 2];
    return 0.5f * (tmp[n / 2 - 1] + tmp[n / 2]);
}

void BiomarkerEngine::update(const SignalFilter& f, uint32_t timestamp_us) {
    // ---- 1) AC/DC EMA tracker per channel (slow envelope, ~2 s TC) ----
    _ema_ac_f1  += _ror_alpha * (fabsf(f.ac_f1)  - _ema_ac_f1);
    _ema_dc_f1  += _ror_alpha * (f.dc_f1         - _ema_dc_f1);
    _ema_ac_fz  += _ror_alpha * (fabsf(f.ac_fz)  - _ema_ac_fz);
    _ema_dc_fz  += _ror_alpha * (f.dc_fz         - _ema_dc_fz);
    _ema_ac_fy  += _ror_alpha * (fabsf(f.ac_fy)  - _ema_ac_fy);
    _ema_dc_fy  += _ror_alpha * (f.dc_fy         - _ema_dc_fy);
    _ema_ac_f6  += _ror_alpha * (fabsf(f.ac_f6)  - _ema_ac_f6);
    _ema_dc_f6  += _ror_alpha * (f.dc_f6         - _ema_dc_f6);
    _ema_ac_f7  += _ror_alpha * (fabsf(f.ac_f7)  - _ema_ac_f7);
    _ema_dc_f7  += _ror_alpha * (f.dc_f7         - _ema_dc_f7);
    _ema_ac_nir += _ror_alpha * (fabsf(f.ac_nir) - _ema_ac_nir);
    _ema_dc_nir += _ror_alpha * (f.dc_nir        - _ema_dc_nir);

    const float R_nir = (_ema_dc_nir > 10.0f) ? (_ema_ac_nir / _ema_dc_nir) : 0.0f;
    const float R_f1  = (_ema_dc_f1  > 10.0f) ? (_ema_ac_f1  / _ema_dc_f1)  : 0.0f;
    const float R_fz  = (_ema_dc_fz  > 10.0f) ? (_ema_ac_fz  / _ema_dc_fz)  : 0.0f;
    const float R_fy  = (_ema_dc_fy  > 10.0f) ? (_ema_ac_fy  / _ema_dc_fy)  : 0.0f;
    const float R_f6  = (_ema_dc_f6  > 10.0f) ? (_ema_ac_f6  / _ema_dc_f6)  : 0.0f;
    const float R_f7  = (_ema_dc_f7  > 10.0f) ? (_ema_ac_f7  / _ema_dc_f7)  : 0.0f;

    // ---- 2) Diagnostics: PI + Pearson SQI (computed, not gated) ----
    _out.pi = (_ema_dc_nir > 10.0f)
        ? (_ema_ac_nir * 3.14159265f / _ema_dc_nir) * 100.0f
        : 0.0f;

    // ---- 2) SQI — full 6-channel correlation matrix, min of C(6,2)=15 pairs ----
    _var_f1  += SQI_ALPHA * (f.ac_f1  * f.ac_f1  - _var_f1);
    _var_fz  += SQI_ALPHA * (f.ac_fz  * f.ac_fz  - _var_fz);
    _var_fy  += SQI_ALPHA * (f.ac_fy  * f.ac_fy  - _var_fy);
    _var_f6  += SQI_ALPHA * (f.ac_f6  * f.ac_f6  - _var_f6);
    _var_f7  += SQI_ALPHA * (f.ac_f7  * f.ac_f7  - _var_f7);
    _var_nir += SQI_ALPHA * (f.ac_nir * f.ac_nir - _var_nir);

    _cov_f1_fz += SQI_ALPHA * (f.ac_f1 * f.ac_fz  - _cov_f1_fz);
    _cov_f1_fy += SQI_ALPHA * (f.ac_f1 * f.ac_fy  - _cov_f1_fy);
    _cov_f1_f6 += SQI_ALPHA * (f.ac_f1 * f.ac_f6  - _cov_f1_f6);
    _cov_f1_f7 += SQI_ALPHA * (f.ac_f1 * f.ac_f7  - _cov_f1_f7);
    _cov_f1_n  += SQI_ALPHA * (f.ac_f1 * f.ac_nir - _cov_f1_n);
    _cov_fz_fy += SQI_ALPHA * (f.ac_fz * f.ac_fy  - _cov_fz_fy);
    _cov_fz_f6 += SQI_ALPHA * (f.ac_fz * f.ac_f6  - _cov_fz_f6);
    _cov_fz_f7 += SQI_ALPHA * (f.ac_fz * f.ac_f7  - _cov_fz_f7);
    _cov_fz_n  += SQI_ALPHA * (f.ac_fz * f.ac_nir - _cov_fz_n);
    _cov_fy_f6 += SQI_ALPHA * (f.ac_fy * f.ac_f6  - _cov_fy_f6);
    _cov_fy_f7 += SQI_ALPHA * (f.ac_fy * f.ac_f7  - _cov_fy_f7);
    _cov_fy_n  += SQI_ALPHA * (f.ac_fy * f.ac_nir - _cov_fy_n);
    _cov_f6_f7 += SQI_ALPHA * (f.ac_f6 * f.ac_f7  - _cov_f6_f7);
    _cov_f6_n  += SQI_ALPHA * (f.ac_f6 * f.ac_nir - _cov_f6_n);
    _cov_f7_n  += SQI_ALPHA * (f.ac_f7 * f.ac_nir - _cov_f7_n);

    auto pairCorr = [](float cov, float va, float vb) -> float {
        if (va < 1e-4f || vb < 1e-4f) return 0.0f;
        float c = cov / sqrtf(va * vb);
        return c < 0.0f ? 0.0f : (c > 1.0f ? 1.0f : c);
    };
    float sqi = pairCorr(_cov_f1_fz, _var_f1, _var_fz);
    const float pairs[14] = {
        pairCorr(_cov_f1_fy, _var_f1, _var_fy),
        pairCorr(_cov_f1_f6, _var_f1, _var_f6),
        pairCorr(_cov_f1_f7, _var_f1, _var_f7),
        pairCorr(_cov_f1_n,  _var_f1, _var_nir),
        pairCorr(_cov_fz_fy, _var_fz, _var_fy),
        pairCorr(_cov_fz_f6, _var_fz, _var_f6),
        pairCorr(_cov_fz_f7, _var_fz, _var_f7),
        pairCorr(_cov_fz_n,  _var_fz, _var_nir),
        pairCorr(_cov_fy_f6, _var_fy, _var_f6),
        pairCorr(_cov_fy_f7, _var_fy, _var_f7),
        pairCorr(_cov_fy_n,  _var_fy, _var_nir),
        pairCorr(_cov_f6_f7, _var_f6, _var_f7),
        pairCorr(_cov_f6_n,  _var_f6, _var_nir),
        pairCorr(_cov_f7_n,  _var_f7, _var_nir),
    };
    for (int i = 0; i < 14; i++) if (pairs[i] < sqi) sqi = pairs[i];
    _out.sqi = sqi;

    // ---- Sanity floor on denominators ----
    constexpr float RATIO_FLOOR = 1e-4f;
    if (R_nir > RATIO_FLOOR && R_f6 > RATIO_FLOOR &&
        R_fy > RATIO_FLOOR && R_fz > RATIO_FLOOR &&
        _ema_dc_nir > 10.0f && _ema_dc_f6 > 10.0f &&
        _ema_dc_fy  > 10.0f && _ema_dc_fz > 10.0f) {

        // Display indices (1-D diagnostics, fed through median filter for stability)
        const float inst_ror  = R_f6 / R_nir;
        const float inst_hb   = (R_fy / R_nir) / inst_ror;
        const float inst_bili = (R_fz / R_nir) / inst_ror;

        _med_ror [_med_idx] = inst_ror;
        _med_hb  [_med_idx] = inst_hb;
        _med_bili[_med_idx] = inst_bili;
        _med_idx = (_med_idx + 1) % MED_WIN;
        if (_med_count < MED_WIN) _med_count++;

        _out.ror        = _median_of(_med_ror,  _med_count);
        _out.hb_index   = _median_of(_med_hb,   _med_count);
        _out.bili_index = _median_of(_med_bili, _med_count);

        // SpO2 — 1-D calibrator on RoR (works cross-subject for SpO2)
        if (spo2Cal.isFitted()) _out.spo2 = spo2Cal.predict(_out.ror);
        else                    _out.spo2 = spo2_A - spo2_B * _out.ror;
        if (_out.spo2 > 100.0f) _out.spo2 = 100.0f;
        if (_out.spo2 <  70.0f) _out.spo2 =  70.0f;

        // Hb — MULTIVARIATE: uses 6 features so the fit can disambiguate
        // skin-tone / tissue confounders that a 1-D ratio can't separate.
        if (hbCal.isFitted()) {
            float hbF[HB_FEATS]; buildHbFeatures(hbF);
            float v = hbCal.predict(hbF);
            if (v < 3.0f)  v = 3.0f;
            if (v > 22.0f) v = 22.0f;
            _out.hb_g_dl      = v;
            _out.hb_score     = scoreMap(v, HB_WORST, HB_BEST);
            _out.hb_cal_valid = true;
        } else {
            _out.hb_g_dl      = NAN;
            _out.hb_score     = 0.0f;
            _out.hb_cal_valid = false;
        }

        // Bili — MULTIVARIATE for the same reason
        if (biliCal.isFitted()) {
            float biF[BILI_FEATS]; buildBiliFeatures(biF);
            float v = biliCal.predict(biF);
            if (v < 0.0f)  v = 0.0f;
            if (v > 30.0f) v = 30.0f;
            _out.bili_mg_dl     = v;
            _out.bili_score     = scoreMap(v, BILI_WORST, BILI_BEST);
            _out.bili_cal_valid = true;
        } else {
            _out.bili_mg_dl     = NAN;
            _out.bili_score     = 0.0f;
            _out.bili_cal_valid = false;
        }
    }

    // ---- 6) HR peak detection on bandpass-filtered AC_green ----
    const float ac_filt = _lpFilter(f.ac_fy);
    _ac_win[_ac_win_idx] = ac_filt;
    _ac_win_idx = (_ac_win_idx + 1) % _ac_win_size;

    if (_refract_cnt > 0) {
        _refract_cnt--;
    } else {
        const float threshold = _computeThreshold();
        if (!_above_thresh && ac_filt > threshold) {
            _above_thresh = true;
        } else if (_above_thresh && ac_filt <= threshold) {
            _above_thresh = false;
            _refract_cnt  = _refract_samples;

            if (_last_peak_us == 0) {
                _last_peak_us = timestamp_us;
            } else {
                const float rr_ms = (float)(timestamp_us - _last_peak_us) / 1000.0f;
                if (rr_ms > 300.0f && rr_ms < 2000.0f) {
                    _pushRR(rr_ms);
                    _computeHRHRV();
                    _last_peak_us = timestamp_us;
                } else if (rr_ms >= 2000.0f) {
                    _last_peak_us = timestamp_us;
                }
            }
        }
    }
}

void BiomarkerEngine::_pushRR(float rr_ms) {
    _rr_buf[_rr_head] = rr_ms;
    _rr_head = (_rr_head + 1) % PEAK_BUF;
    if (_rr_count < PEAK_BUF) _rr_count++;
}

float BiomarkerEngine::_computeThreshold() {
    float sum = 0.0f;
    for (int i = 0; i < _ac_win_size; i++) sum += _ac_win[i];
    const float mean = sum / _ac_win_size;
    float var = 0.0f;
    for (int i = 0; i < _ac_win_size; i++) {
        const float d = _ac_win[i] - mean;
        var += d * d;
    }
    return mean + THRESHOLD_K * sqrtf(var / _ac_win_size);
}

void BiomarkerEngine::_computeHRHRV() {
    if (_rr_count < 8) { _out.hr_valid = false; return; }
    _out.hr_valid = true;

    float rr[PEAK_BUF];
    const int n = _rr_count;
    for (int i = 0; i < n; i++)
        rr[i] = _rr_buf[(_rr_head + PEAK_BUF - n + i) % PEAK_BUF];

    const int hr_n = (n < 8) ? n : 8;
    float hr_rr[8];
    for (int i = 0; i < hr_n; i++) hr_rr[i] = rr[n - hr_n + i];
    const float med_rr = _median(hr_rr, hr_n);
    _out.hr_bpm_raw = 60000.0f / med_rr;

    if (hrCal.isFitted()) {
        _out.heart_rate   = hrCal.predict(_out.hr_bpm_raw);
        _out.hr_cal_valid = true;
    } else {
        _out.heart_rate   = _out.hr_bpm_raw;
        _out.hr_cal_valid = false;
    }

    float sum = 0.0f;
    for (int i = 0; i < n; i++) sum += rr[i];
    const float mean_rr = sum / n;
    float var = 0.0f;
    for (int i = 0; i < n; i++) {
        const float d = rr[i] - mean_rr;
        var += d * d;
    }
    _out.hrv_sdnn = sqrtf(var / n);

    if (n < 2) { _out.hrv_rmssd = 0.0f; return; }
    float sq = 0.0f;
    for (int i = 1; i < n; i++) {
        const float d = rr[i] - rr[i - 1];
        sq += d * d;
    }
    _out.hrv_rmssd = sqrtf(sq / (n - 1));
}

float BiomarkerEngine::_lpFilter(float x) {
    const float y = _b0 * x + _b1 * _lp_x1 + _b2 * _lp_x2
                  - _a1 * _lp_y1 - _a2 * _lp_y2;
    _lp_x2 = _lp_x1; _lp_x1 = x;
    _lp_y2 = _lp_y1; _lp_y1 = y;
    return y;
}

float BiomarkerEngine::_median(float* a, int n) {
    for (int i = 1; i < n; i++) {
        const float key = a[i];
        int j = i - 1;
        while (j >= 0 && a[j] > key) { a[j + 1] = a[j]; j--; }
        a[j + 1] = key;
    }
    if (n & 1) return a[n / 2];
    return 0.5f * (a[n / 2 - 1] + a[n / 2]);
}

void BiomarkerEngine::loadCalibration(const char* ns) {
    Preferences pref;
    if (!pref.begin(ns, true)) return;
    spo2Cal.load(pref, "spo2");
    hbCal.load(pref, "hb");
    biliCal.load(pref, "bili");
    hrCal.load(pref, "hr");
    pref.end();
}

void BiomarkerEngine::saveCalibration(const char* ns) {
    Preferences pref;
    if (!pref.begin(ns, false)) return;
    spo2Cal.save(pref, "spo2");
    hbCal.save(pref, "hb");
    biliCal.save(pref, "bili");
    hrCal.save(pref, "hr");
    pref.end();
}

void BiomarkerEngine::resetCalibration(const char* which) {
    if      (!strcmp(which, "hb"))   hbCal.reset();
    else if (!strcmp(which, "bili")) biliCal.reset();
    else if (!strcmp(which, "spo2")) spo2Cal.reset();
    else if (!strcmp(which, "hr"))   hrCal.reset();
    else if (!strcmp(which, "all"))  {
        hbCal.reset(); biliCal.reset(); spo2Cal.reset(); hrCal.reset();
    }
}

// safelog: bounded log() so feature values don't explode if a channel dips
static inline float safelog(float x) {
    if (x < 1e-6f) x = 1e-6f;
    return logf(x);
}

// Hb feature vector — 10 features across all 6 channels.
// Pulsatile features (R_λ/R_nir) capture blood-borne signal; static DC ratios
// capture tissue/melanin/scattering so the OLS fit can separate them.
//
//   f[0] = 1                              bias
//   f[1] = log(R_fy  / R_nir)            pulsatile Hb isosbestic (green/NIR)
//   f[2] = log(R_f6  / R_nir)            pulsatile oxy-Hb (red/NIR)
//   f[3] = log(R_f7  / R_nir)            pulsatile deoxy-Hb (deep-red/NIR)
//   f[4] = log(DC_nir / DC_fy)           static Hb absorbance at isosbestic
//   f[5] = log(DC_nir / DC_f6)           static oxy-Hb absorbance
//   f[6] = log(DC_f7  / DC_f6)           deoxy/oxy ratio (SpO2 proxy)
//   f[7] = log(DC_fy  / DC_fz)           green/blue — Hb above melanin baseline
//   f[8] = log(DC_fz  / DC_f1)           blue/violet — melanin Mie slope
//   f[9] = log(DC_fy  / DC_f7)           green/deep-red — total Hb weight
void BiomarkerEngine::buildHbFeatures(float f[HB_FEATS]) const {
    const float r_fy = (_ema_dc_fy  > 10.0f) ? (_ema_ac_fy  / _ema_dc_fy)  : 1e-6f;
    const float r_f6 = (_ema_dc_f6  > 10.0f) ? (_ema_ac_f6  / _ema_dc_f6)  : 1e-6f;
    const float r_f7 = (_ema_dc_f7  > 10.0f) ? (_ema_ac_f7  / _ema_dc_f7)  : 1e-6f;
    const float r_n  = (_ema_dc_nir > 10.0f) ? (_ema_ac_nir / _ema_dc_nir) : 1e-6f;

    f[0] = 1.0f;
    f[1] = safelog(r_fy / r_n);
    f[2] = safelog(r_f6 / r_n);
    f[3] = safelog(r_f7 / r_n);
    f[4] = safelog(_ema_dc_nir / _ema_dc_fy);
    f[5] = safelog(_ema_dc_nir / _ema_dc_f6);
    f[6] = safelog(_ema_dc_f7  / _ema_dc_f6);
    f[7] = safelog(_ema_dc_fy  / _ema_dc_fz);
    f[8] = safelog(_ema_dc_fz  / _ema_dc_f1);
    f[9] = safelog(_ema_dc_fy  / _ema_dc_f7);
}

// Bili feature vector — 10 features across all 6 channels.
// Key discriminator: f[5] = log(DC_f1/DC_fz) separates bilirubin from melanin
// because bilirubin absorbs more at 450 nm (FZ) than 405 nm (F1), while melanin
// has the opposite slope — same raw bili index, different spectral signature.
//
//   f[0] = 1                              bias
//   f[1] = log(R_fz  / R_nir)            pulsatile bili signal (blue/NIR)
//   f[2] = log(R_f6  / R_nir)            pulsatile RoR cross-talk
//   f[3] = log(R_f1  / R_nir)            pulsatile violet (bili + melanin)
//   f[4] = log(DC_nir / DC_fz)           static blue absorbance (bilirubin peak)
//   f[5] = log(DC_f1  / DC_fz)           violet/blue — melanin-bilirubin discriminator
//   f[6] = log(DC_fz  / DC_fy)           blue/green gradient (melanin slope)
//   f[7] = log(DC_fy  / DC_f6)           green/red (skin-tone proxy)
//   f[8] = log(DC_f6  / DC_f7)           red/deep-red (deoxy cross-talk correction)
//   f[9] = log(DC_fy  / DC_f1)           green/violet (broad melanin slope)
void BiomarkerEngine::buildBiliFeatures(float f[BILI_FEATS]) const {
    const float r_fz = (_ema_dc_fz  > 10.0f) ? (_ema_ac_fz  / _ema_dc_fz)  : 1e-6f;
    const float r_f1 = (_ema_dc_f1  > 10.0f) ? (_ema_ac_f1  / _ema_dc_f1)  : 1e-6f;
    const float r_f6 = (_ema_dc_f6  > 10.0f) ? (_ema_ac_f6  / _ema_dc_f6)  : 1e-6f;
    const float r_n  = (_ema_dc_nir > 10.0f) ? (_ema_ac_nir / _ema_dc_nir) : 1e-6f;

    f[0] = 1.0f;
    f[1] = safelog(r_fz / r_n);
    f[2] = safelog(r_f6 / r_n);
    f[3] = safelog(r_f1 / r_n);
    f[4] = safelog(_ema_dc_nir / _ema_dc_fz);
    f[5] = safelog(_ema_dc_f1  / _ema_dc_fz);
    f[6] = safelog(_ema_dc_fz  / _ema_dc_fy);
    f[7] = safelog(_ema_dc_fy  / _ema_dc_f6);
    f[8] = safelog(_ema_dc_f6  / _ema_dc_f7);
    f[9] = safelog(_ema_dc_fy  / _ema_dc_f1);
}
