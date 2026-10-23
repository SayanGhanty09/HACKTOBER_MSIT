// AnebilModel.cpp — see header for math + design notes.

#include "AnebilModel.h"
#include <math.h>
#include <string.h>
#include <Preferences.h>

namespace {
constexpr float DEFAULT_LAMBDA = 0.995f;
constexpr float P0             = 1000.0f;

constexpr float DEFAULT_SPO2 = 98.0f;
constexpr float DEFAULT_HB   = 14.0f;
constexpr float DEFAULT_BILI = 1.0f;
}

AnebilModel::AnebilModel() { reset(); }

void AnebilModel::reset() {
    for (int i = 0; i < N_OUTPUTS; i++)
        for (int j = 0; j < N_FEATURES; j++)
            _W[i][j] = 0.0f;

    _W[OUT_SPO2][N_FEATURES - 1] = DEFAULT_SPO2;
    _W[OUT_HB  ][N_FEATURES - 1] = DEFAULT_HB;
    _W[OUT_BILI][N_FEATURES - 1] = DEFAULT_BILI;

    for (int i = 0; i < N_FEATURES; i++)
        for (int j = 0; j < N_FEATURES; j++)
            _cov[i][j] = (i == j) ? P0 : 0.0f;

    _lambda  = DEFAULT_LAMBDA;
    _updates = 0;

    for (int i = 0; i < N_CHANNELS; i++) _refl_ref[i] = 0.0f;
    _refl_gain   = 1.0f;
    _refl_integ  = 1000.0f;
    _refl_led_ma = 50;
    _has_refl    = false;

    _trans_ref      = 0.0f;
    _trans_gain     = 1.0f;
    _trans_integ    = 1000.0f;
    _trans_nir_duty = 128;
    _has_trans      = false;
}

void AnebilModel::calibrateReflectance(const AnebilSample& s) {
    for (int i = 0; i < N_CHANNELS; i++) _refl_ref[i] = (float)s.adc[i];
    _refl_gain   = s.gain;
    _refl_integ  = s.integ_us;
    _refl_led_ma = s.led_ma;
    _has_refl    = true;
}

void AnebilModel::calibrateTransmission(const AnebilSample& s) {
    _trans_ref      = (float)s.adc[IDX_NIR];
    _trans_gain     = s.gain;
    _trans_integ    = s.integ_us;
    _trans_nir_duty = s.nir_duty == 0 ? 1 : s.nir_duty;   // guard
    _has_trans      = true;
}

float AnebilModel::reflAbs(int i, const AnebilSample& s) const {
    if (!_has_refl || _refl_ref[i] < 1.0f) {
        // Fallback: log-normalised raw count
        return logf((float)s.adc[i] + 1.0f) / 11.0902f;   // log(65536)
    }
    // Rescale current ADC into the cal-time parameter space.
    // ADC ∝ gain · integ · led, so we project the live reading onto cal axes.
    const float k = (_refl_gain * _refl_integ * (float)_refl_led_ma) /
                    (s.gain     * s.integ_us  * (float)(s.led_ma > 0 ? s.led_ma : 1));
    float scaled = (float)s.adc[i] * k;
    if (scaled < 1.0f) scaled = 1.0f;
    return log10f(_refl_ref[i] / scaled);
}

float AnebilModel::transAbs(const AnebilSample& s) const {
    if (!_has_trans || _trans_ref < 1.0f) {
        return logf((float)s.adc[IDX_NIR] + 1.0f) / 11.0902f;
    }
    const float duty_now = s.nir_duty == 0 ? 1.0f : (float)s.nir_duty;
    const float k = (_trans_gain * _trans_integ * (float)_trans_nir_duty) /
                    (s.gain      * s.integ_us   * duty_now);
    float scaled = (float)s.adc[IDX_NIR] * k;
    if (scaled < 1.0f) scaled = 1.0f;
    return log10f(_trans_ref / scaled);
}

void AnebilModel::featurise(const AnebilSample& s, float x[N_FEATURES]) const {
    const float a_f1  = reflAbs(IDX_F1, s);
    const float a_fz  = reflAbs(IDX_FZ, s);
    const float a_fy  = reflAbs(IDX_FY, s);
    const float a_f6  = reflAbs(IDX_F6, s);
    const float a_f7  = reflAbs(IDX_F7, s);
    const float a_nir = transAbs(s);

    // raw reflectance absorbances
    x[0] = a_f1;
    x[1] = a_fz;
    x[2] = a_fy;
    x[3] = a_f6;
    x[4] = a_f7;

    // adjacent differences (cancel surface specular + smooth scattering)
    x[5] = a_fz - a_f1;                              // bili shoulder
    x[6] = a_fy - a_fz;                              // bili peak vs Hb isosbestic
    x[7] = a_f6 - a_fy;                              // Hb mid-red
    x[8] = a_f7 - a_f6;                              // red-region gradient

    // second derivatives (isolate chromophore peaks from scattering baseline)
    x[9]  = a_f1 - 2.0f * a_fz + a_fy;               // bilirubin peak (450 nm)
    x[10] = a_fy - 2.0f * a_f6 + a_f7;               // Hb red-region (640 nm)

    // spectral slope across reflectance band (melanin power-law proxy)
    x[11] = (a_f7 - a_f1) / 285.0f;                  // / (690 - 405)

    // transmission features (clean Beer–Lambert through finger)
    x[12] = a_nir;
    x[13] = a_nir * a_nir;

    x[14] = 1.0f;
}

void AnebilModel::predict(const AnebilSample& s, float out[N_OUTPUTS]) const {
    float x[N_FEATURES];
    featurise(s, x);
    for (int k = 0; k < N_OUTPUTS; k++) {
        float acc = 0.0f;
        for (int j = 0; j < N_FEATURES; j++) acc += _W[k][j] * x[j];
        out[k] = acc;
    }
}

void AnebilModel::update(const AnebilSample& s, const float target[N_OUTPUTS]) {
    float x[N_FEATURES];
    featurise(s, x);

    // Px = P · x
    float Px[N_FEATURES];
    for (int i = 0; i < N_FEATURES; i++) {
        float sum = 0.0f;
        for (int j = 0; j < N_FEATURES; j++) sum += _cov[i][j] * x[j];
        Px[i] = sum;
    }

    float xPx = 0.0f;
    for (int i = 0; i < N_FEATURES; i++) xPx += x[i] * Px[i];
    const float denom = _lambda + xPx;
    if (denom < 1e-9f) return;

    float gain[N_FEATURES];
    for (int i = 0; i < N_FEATURES; i++) gain[i] = Px[i] / denom;

    for (int k = 0; k < N_OUTPUTS; k++) {
        float pred = 0.0f;
        for (int j = 0; j < N_FEATURES; j++) pred += _W[k][j] * x[j];
        const float err = target[k] - pred;
        for (int j = 0; j < N_FEATURES; j++) _W[k][j] += gain[j] * err;
    }

    const float inv_l = 1.0f / _lambda;
    for (int i = 0; i < N_FEATURES; i++)
        for (int j = 0; j < N_FEATURES; j++)
            _cov[i][j] = (_cov[i][j] - gain[i] * Px[j]) * inv_l;

    _updates++;
}

bool AnebilModel::saveToNVS(const char* ns) {
    Preferences pref;
    if (!pref.begin(ns, false)) return false;
    pref.putUInt ("MAGIC", NVS_MAGIC);
    pref.putBytes("W",  _W, sizeof(_W));
    pref.putBytes("P",  _cov, sizeof(_cov));
    pref.putFloat("L",  _lambda);
    pref.putInt  ("U",  _updates);

    pref.putBytes ("RR", _refl_ref, sizeof(_refl_ref));
    pref.putFloat ("RG", _refl_gain);
    pref.putFloat ("RI", _refl_integ);
    pref.putUShort("RM", _refl_led_ma);
    pref.putBool  ("RH", _has_refl);

    pref.putFloat("TR", _trans_ref);
    pref.putFloat("TG", _trans_gain);
    pref.putFloat("TI", _trans_integ);
    pref.putUChar("TD", _trans_nir_duty);
    pref.putBool ("TH", _has_trans);

    pref.end();
    return true;
}

bool AnebilModel::loadFromNVS(const char* ns) {
    Preferences pref;
    if (!pref.begin(ns, true)) return false;
    if (pref.getUInt("MAGIC", 0) != NVS_MAGIC) { pref.end(); return false; }
    if (pref.getBytesLength("W") != sizeof(_W)) { pref.end(); return false; }

    pref.getBytes("W", _W, sizeof(_W));
    pref.getBytes("P", _cov, sizeof(_cov));
    _lambda  = pref.getFloat("L", DEFAULT_LAMBDA);
    _updates = pref.getInt  ("U", 0);

    if (pref.getBytesLength("RR") == sizeof(_refl_ref))
        pref.getBytes("RR", _refl_ref, sizeof(_refl_ref));
    _refl_gain   = pref.getFloat ("RG", 1.0f);
    _refl_integ  = pref.getFloat ("RI", 1000.0f);
    _refl_led_ma = pref.getUShort("RM", 50);
    _has_refl    = pref.getBool  ("RH", false);

    _trans_ref      = pref.getFloat("TR", 0.0f);
    _trans_gain     = pref.getFloat("TG", 1.0f);
    _trans_integ    = pref.getFloat("TI", 1000.0f);
    _trans_nir_duty = pref.getUChar("TD", 128);
    _has_trans      = pref.getBool ("TH", false);

    pref.end();
    return true;
}
