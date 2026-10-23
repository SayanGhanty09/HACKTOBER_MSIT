// SignalFilter — DC/AC separator for PPG-style biomarker extraction.
//
// Each channel is split into a slowly-varying DC baseline and a pulsatile AC
// component via a 1st-order IIR low-pass at fc = 0.5 Hz. The cut-off alpha is
// recomputed from the actual sample rate at init() so the filter behaves
// correctly even if the bio loop runs at, say, 25 Hz or 100 Hz.
//
//   alpha = 1 - exp(-2*pi * fc / fs)
//   DC[n] = DC[n-1] + alpha * (x[n] - DC[n-1])
//   AC[n] = x[n] - DC[n]
//
// Six channels are tracked, covering the full SMUX set. Map the AS7343 pixels
// at the call site:
//   f1    ← F1  (405 nm) — melanin / bilirubin edge
//   fz    ← FZ  (450 nm) — bilirubin shoulder
//   fy    ← FY  (555 nm) — Hb isosbestic
//   f6    ← F6  (640 nm) — SpO2 numerator / oxy-Hb
//   f7    ← F7  (690 nm) — deoxy-Hb peak
//   nir   ← NIR (855 nm) — SpO2 / common denominator

#pragma once

#include <math.h>

class SignalFilter {
public:
    float dc_f1 = 0.0f, dc_fz = 0.0f, dc_fy = 0.0f;
    float dc_f6 = 0.0f, dc_f7 = 0.0f, dc_nir = 0.0f;
    float ac_f1 = 0.0f, ac_fz = 0.0f, ac_fy = 0.0f;
    float ac_f6 = 0.0f, ac_f7 = 0.0f, ac_nir = 0.0f;

    // fs: actual sample rate in Hz. fc: DC cut-off (0.5 Hz is standard for PPG).
    void init(float fs = 40.0f, float fc = 0.5f) {
        const float pi = 3.14159265358979f;
        _alpha       = 1.0f - expf(-2.0f * pi * fc / fs);
        _initialized = false;
    }

    void reset() { _initialized = false; }

    void update(float f1, float fz, float fy, float f6, float f7, float nir) {
        if (!_initialized) {
            dc_f1 = f1; dc_fz = fz; dc_fy = fy;
            dc_f6 = f6; dc_f7 = f7; dc_nir = nir;
            _initialized = true;
        }
        dc_f1  += _alpha * (f1  - dc_f1);
        dc_fz  += _alpha * (fz  - dc_fz);
        dc_fy  += _alpha * (fy  - dc_fy);
        dc_f6  += _alpha * (f6  - dc_f6);
        dc_f7  += _alpha * (f7  - dc_f7);
        dc_nir += _alpha * (nir - dc_nir);

        ac_f1  = f1  - dc_f1;
        ac_fz  = fz  - dc_fz;
        ac_fy  = fy  - dc_fy;
        ac_f6  = f6  - dc_f6;
        ac_f7  = f7  - dc_f7;
        ac_nir = nir - dc_nir;
    }

    float alpha() const { return _alpha; }

private:
    float _alpha       = 0.0723f;   // matches fs=40, fc=0.5
    bool  _initialized = false;
};
