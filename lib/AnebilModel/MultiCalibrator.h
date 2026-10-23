// MultiCalibrator — multivariate linear regression with ridge regularization.
//
// Predicts y = w · x where x is an N-dimensional feature vector. Uses closed-
// form OLS:  w = (X^T X + λI)^-1 X^T y
//
// The ridge term λI stabilises the solution when N points < N features (under-
// determined) and reduces overfit when training samples are noisy. Set ridge
// small (1e-3 default) — large enough to prevent matrix-singularity blow-ups,
// small enough to leave the OLS slope mostly intact.
//
// Why multivariate?
//   The simple ratio LinearCalibrator (y = m·x + c) can only resolve one
//   biomarker axis. Two subjects with different skin tone can share the same
//   hb_index but actually have different Hb — only by including additional
//   features (DC absorbance ratios, RoR cross-talk, etc.) can the model
//   separate "this is melanin" from "this is haemoglobin".
//
// Usage:
//   MultiCalibrator<6, 20> hbCal;
//   float feats[6] = { 1.0f, log(R_FY/R_NIR), log(R_red/R_nir), ... };
//   hbCal.addPoint(feats, 14.2f);   // ground-truth Hb in g/dL
//   hbCal.fit();
//   float hb = hbCal.predict(feats);

#pragma once

#include <Arduino.h>
#include <math.h>
#include <string.h>
#include <Preferences.h>

template <int NFEATS, int MAX_POINTS = 20>
class MultiCalibrator {
public:
    float weights[NFEATS] = {};
    float r_squared       = 0.0f;

    uint8_t addPoint(const float x[NFEATS], float y) {
        for (int i = 0; i < NFEATS; i++) _x[_head][i] = x[i];
        _y[_head] = y;
        _head = (_head + 1) % MAX_POINTS;
        if (_count < MAX_POINTS) _count++;
        return _count;
    }

    // Closed-form ridge OLS:  (X^T X + ridge*I) w = X^T y
    // Returns true on success. Need >= 2 points to attempt a fit.
    bool fit(float ridge = 1e-3f) {
        if (_count < 2) return false;

        // Build A = X^T X + ridge*I  (NFEATS × NFEATS)
        // Build b = X^T y            (NFEATS)
        float A[NFEATS][NFEATS] = {};
        float b[NFEATS]         = {};
        for (uint8_t p = 0; p < _count; p++) {
            for (int i = 0; i < NFEATS; i++) {
                b[i] += _x[p][i] * _y[p];
                for (int j = 0; j < NFEATS; j++) {
                    A[i][j] += _x[p][i] * _x[p][j];
                }
            }
        }
        for (int i = 0; i < NFEATS; i++) A[i][i] += ridge;

        // Solve A w = b via Gauss-Jordan with partial pivoting
        float w[NFEATS];
        if (!_gaussSolve(A, b, w)) return false;
        for (int i = 0; i < NFEATS; i++) weights[i] = w[i];
        _fitted = true;

        // R² (coefficient of determination)
        float mean_y = 0;
        for (uint8_t p = 0; p < _count; p++) mean_y += _y[p];
        mean_y /= _count;
        float ss_tot = 0, ss_res = 0;
        for (uint8_t p = 0; p < _count; p++) {
            float pred = 0;
            for (int i = 0; i < NFEATS; i++) pred += weights[i] * _x[p][i];
            float dy = _y[p] - mean_y;
            ss_tot += dy * dy;
            ss_res += (_y[p] - pred) * (_y[p] - pred);
        }
        r_squared = (ss_tot > 1e-9f) ? (1.0f - ss_res / ss_tot) : 1.0f;
        return true;
    }

    float predict(const float x[NFEATS]) const {
        if (!_fitted) return NAN;
        float sum = 0.0f;
        for (int i = 0; i < NFEATS; i++) sum += weights[i] * x[i];
        return sum;
    }

    bool    isFitted()   const { return _fitted; }
    uint8_t pointCount() const { return _count; }

    // Inject weights produced offline (e.g. tools/train_offline.py). The
    // weights are already in raw feature space, so predict() stays a plain
    // dot product. Marks the model fitted.
    void setWeights(const float w[NFEATS]) {
        for (int i = 0; i < NFEATS; i++) weights[i] = w[i];
        _fitted = true;
    }

    void reset() {
        _count = 0; _head = 0; _fitted = false;
        for (int i = 0; i < NFEATS; i++) weights[i] = 0;
        r_squared = 0;
    }

    void dump(const char* label) const {
        Serial.printf("[%s] %u points, NFEATS=%d", label, _count, NFEATS);
        if (_fitted) Serial.printf("  R^2=%.3f", r_squared);
        Serial.println();
        if (_fitted) {
            Serial.print("  weights:");
            for (int i = 0; i < NFEATS; i++) Serial.printf(" %.4f", weights[i]);
            Serial.println();
        }
        for (uint8_t p = 0; p < _count; p++) {
            uint8_t idx = (_head + MAX_POINTS - _count + p) % MAX_POINTS;
            Serial.printf("  [%2u] y=%.4f  x=[", p + 1, _y[idx]);
            for (int i = 0; i < NFEATS; i++) Serial.printf("%s%.3f", i ? "," : "", _x[idx][i]);
            Serial.println("]");
        }
    }

    void save(Preferences& pref, const char* key) const {
        pref.putBytes(key, this, sizeof(*this));
    }
    bool load(Preferences& pref, const char* key) {
        if (!pref.isKey(key))                          return false;
        if (pref.getBytesLength(key) != sizeof(*this)) return false;
        pref.getBytes(key, this, sizeof(*this));
        if (_head  >= MAX_POINTS) _head  = 0;
        if (_count >  MAX_POINTS) _count = 0;
        return true;
    }

private:
    float   _x[MAX_POINTS][NFEATS] = {};
    float   _y[MAX_POINTS]         = {};
    uint8_t _head   = 0;
    uint8_t _count  = 0;
    bool    _fitted = false;

    // Gauss-Jordan elimination with partial pivoting.
    // Solves A·w = b (in place). Returns false on singular matrix.
    static bool _gaussSolve(float A[NFEATS][NFEATS], float b[NFEATS], float w[NFEATS]) {
        for (int i = 0; i < NFEATS; i++) {
            // Find pivot
            int   piv  = i;
            float pmax = fabsf(A[i][i]);
            for (int r = i + 1; r < NFEATS; r++) {
                if (fabsf(A[r][i]) > pmax) { pmax = fabsf(A[r][i]); piv = r; }
            }
            if (pmax < 1e-12f) return false;
            if (piv != i) {
                for (int c = 0; c < NFEATS; c++) {
                    float t = A[i][c]; A[i][c] = A[piv][c]; A[piv][c] = t;
                }
                float t = b[i]; b[i] = b[piv]; b[piv] = t;
            }
            // Normalise pivot row
            const float p = A[i][i];
            for (int c = 0; c < NFEATS; c++) A[i][c] /= p;
            b[i] /= p;
            // Eliminate other rows
            for (int r = 0; r < NFEATS; r++) {
                if (r == i) continue;
                const float f = A[r][i];
                if (fabsf(f) < 1e-20f) continue;
                for (int c = 0; c < NFEATS; c++) A[r][c] -= f * A[i][c];
                b[r] -= f * b[i];
            }
        }
        for (int i = 0; i < NFEATS; i++) w[i] = b[i];
        return true;
    }
};
