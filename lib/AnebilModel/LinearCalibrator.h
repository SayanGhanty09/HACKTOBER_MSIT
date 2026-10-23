// LinearCalibrator — closed-form OLS fit of y = slope*x + intercept, used to
// map a physics-normalised optical ratio (e.g. AC/DC RoR) to a clinical unit
// (e.g. SpO2 %, Hb g/dL). Stores up to MAX_POINTS (x, y) pairs in a FIFO ring
// and recomputes the fit on demand. With AC/DC features that already cancel
// person-specific variation, 5+ subjects spanning the biomarker range is
// usually enough to get a usable model.

#pragma once

#include <Arduino.h>
#include <math.h>
#include <Preferences.h>

template <uint8_t MAX_POINTS = 20>
class LinearCalibrator {
public:
    float slope     = 1.0f;
    float intercept = 0.0f;
    float r_squared = 0.0f;

    uint8_t addPoint(float x, float y) {
        _x[_head] = x;
        _y[_head] = y;
        _head = (_head + 1) % MAX_POINTS;
        if (_count < MAX_POINTS) _count++;
        return _count;
    }

    // Returns true if the fit succeeded (need >= 2 distinct x values).
    bool fit() {
        if (_count < 2) return false;

        float sum_x = 0, sum_y = 0, sum_xx = 0, sum_xy = 0;
        const float n = (float)_count;
        for (uint8_t i = 0; i < _count; i++) {
            sum_x  += _x[i];
            sum_y  += _y[i];
            sum_xx += _x[i] * _x[i];
            sum_xy += _x[i] * _y[i];
        }
        const float denom = n * sum_xx - sum_x * sum_x;
        if (fabsf(denom) < 1e-9f) return false;

        slope     = (n * sum_xy - sum_x * sum_y) / denom;
        intercept = (sum_y - slope * sum_x) / n;
        _fitted   = true;

        const float mean_y = sum_y / n;
        float ss_tot = 0, ss_res = 0;
        for (uint8_t i = 0; i < _count; i++) {
            const float pred = slope * _x[i] + intercept;
            const float dy   = _y[i] - mean_y;
            ss_tot += dy * dy;
            ss_res += (_y[i] - pred) * (_y[i] - pred);
        }
        r_squared = (ss_tot > 1e-9f) ? (1.0f - ss_res / ss_tot) : 1.0f;
        return true;
    }

    float predict(float x) const {
        return _fitted ? (slope * x + intercept) : NAN;
    }

    bool    isFitted()  const { return _fitted; }
    uint8_t pointCount() const { return _count; }

    void reset() {
        _count = 0; _head = 0; _fitted = false;
        slope = 1.0f; intercept = 0.0f; r_squared = 0.0f;
    }

    void dump(const char* label) const {
        Serial.printf("[%s] %u points", label, _count);
        if (_fitted)
            Serial.printf("  y = %.4f*x + %.4f  R^2=%.3f", slope, intercept, r_squared);
        Serial.println();
        for (uint8_t i = 0; i < _count; i++) {
            uint8_t idx = (_head + MAX_POINTS - _count + i) % MAX_POINTS;
            Serial.printf("  [%2u] x=%.4f  y=%.4f\n", i + 1, _x[idx], _y[idx]);
        }
    }

    void save(Preferences& pref, const char* key) const {
        pref.putBytes(key, this, sizeof(*this));
    }
    bool load(Preferences& pref, const char* key) {
        if (!pref.isKey(key))                              return false;
        if (pref.getBytesLength(key) != sizeof(*this))     return false;
        pref.getBytes(key, this, sizeof(*this));
        if (_head  >= MAX_POINTS) _head  = 0;
        if (_count >  MAX_POINTS) _count = 0;
        return true;
    }

private:
    float   _x[MAX_POINTS] = {};
    float   _y[MAX_POINTS] = {};
    uint8_t _head   = 0;
    uint8_t _count  = 0;
    bool    _fitted = false;
};
