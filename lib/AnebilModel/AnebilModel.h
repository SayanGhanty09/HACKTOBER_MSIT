// AnebilModel — Recursive Least Squares regressor for the AS7343 hybrid
// reflectance + transmission setup.
//
//   Visible channels (F1, FZ, F5, F6, F7) → reflectance mode
//     I_ref captured against a white-paper baseline (cbr command)
//
//   NIR channel (855 nm)                   → transmission mode (through-finger)
//     I_0   captured with the LED beam unobstructed   (cbt command)
//
// Feature vector (15 entries) blends both modes:
//   [0..4]   raw reflectance absorbances        A_F1, A_FZ, A_F5, A_F6, A_F7
//   [5..8]   adjacent reflectance differences   ΔFZ-F1, ΔF5-FZ, ΔF6-F5, ΔF7-F6
//   [9..10]  second derivatives (peak isolators)  F1-2FZ+F5, F5-2F6+F7
//   [11]     spectral slope (melanin proxy)     (A_F7 - A_F1) / Δλ
//   [12..13] transmission features              A_NIR, A_NIR²
//   [14]     bias                                1.0
//
// Auto-rescales the stored baselines when gain / integration / LED current /
// NIR duty differ from the calibration-time settings (raw ADC scales linearly
// with all four), so the user doesn't have to re-calibrate after every knob.

#pragma once

#include <stdint.h>
#include <stddef.h>

struct AnebilSample {
    uint16_t adc[6];
    float    gain;        // AS7343 gain multiplier (0.5..2048)
    float    integ_us;    // integration time
    uint16_t led_ma;      // AS7343 internal LED current (visible illumination)
    uint8_t  nir_duty;    // external 855 nm PWM duty
};

class AnebilModel {
public:
    static constexpr int N_CHANNELS = 6;
    static constexpr int N_FEATURES = 15;
    static constexpr int N_OUTPUTS  = 3;

    // NVS schema version. Bump this whenever the persisted layout changes
    // (feature count, channel order, calibration fields). On boot, any save
    // with a different magic is rejected and the model falls back to defaults.
    // 0xA7EB0002: green channel migrated from F5 (550nm) → FY (555nm) to
    // match spectru's BiomarkerEngine channel map exactly.
    static constexpr uint32_t NVS_MAGIC = 0xA7EB0002;

    // Pixel index in the AnebilSample::adc[] array — must match main.cpp ordering.
    // Slot 2 (IDX_FY) holds the 555 nm "green" channel used by BiomarkerEngine
    // for Hb (spectru-compatible mapping).
    enum ChannelIdx : int {
        IDX_F1  = 0, IDX_FZ = 1, IDX_FY = 2,
        IDX_F6  = 3, IDX_F7 = 4, IDX_NIR = 5
    };

    enum Output : int { OUT_SPO2 = 0, OUT_HB = 1, OUT_BILI = 2 };

    AnebilModel();

    // Reset to bias-only defaults; clears baselines.
    void reset();

    // Reflectance baseline (sensor on white paper, AS7343 LED on, NIR LED off).
    void calibrateReflectance(const AnebilSample& s);

    // Transmission baseline (no finger in beam, NIR LED on, AS7343 LED off).
    void calibrateTransmission(const AnebilSample& s);

    bool hasReflectanceBaseline()  const { return _has_refl; }
    bool hasTransmissionBaseline() const { return _has_trans; }

    // Predict; auto-rescales for current params if they differ from cal.
    void predict(const AnebilSample& s, float out[N_OUTPUTS]) const;

    // RLS update with a labeled sample.
    void update(const AnebilSample& s, const float target[N_OUTPUTS]);

    // Persistence
    bool saveToNVS(const char* ns = "anbml");
    bool loadFromNVS(const char* ns = "anbml");

    // Inspection / tuning
    void  setForgetting(float lambda)              { _lambda = lambda; }
    float getForgetting() const                    { return _lambda; }
    int   getUpdateCount() const                   { return _updates; }
    float getWeight(int o, int f) const            { return _W[o][f]; }
    float getReflRef(int i) const                  { return _refl_ref[i]; }
    float getTransRef() const                      { return _trans_ref; }
    float getReflCalGain() const                   { return _refl_gain; }
    float getReflCalInteg() const                  { return _refl_integ; }
    uint16_t getReflCalLedMa() const               { return _refl_led_ma; }
    float getTransCalGain() const                  { return _trans_gain; }
    float getTransCalInteg() const                 { return _trans_integ; }
    uint8_t getTransCalNirDuty() const             { return _trans_nir_duty; }

    // Compute the 15-feature vector (also used by main.cpp for diagnostics).
    void featurise(const AnebilSample& s, float x[N_FEATURES]) const;

    // Per-channel absorbance (also used by main.cpp for the "absorbance" view).
    float reflAbs(int i, const AnebilSample& s) const;
    float transAbs(const AnebilSample& s)       const;

private:
    float _W[N_OUTPUTS][N_FEATURES];
    float _cov[N_FEATURES][N_FEATURES];
    float _lambda;
    int   _updates;

    // Reflectance baseline
    float    _refl_ref[N_CHANNELS];
    float    _refl_gain;
    float    _refl_integ;
    uint16_t _refl_led_ma;
    bool     _has_refl;

    // Transmission baseline
    float    _trans_ref;
    float    _trans_gain;
    float    _trans_integ;
    uint8_t  _trans_nir_duty;
    bool     _has_trans;
};
