/**
 * Generates a realistic AD8232 single-lead ECG recording (1000 Hz, 30s)
 * mirroring the exact hardware profile from the device:
 * - Large initial settling transient drop (0-1.8s) from high-pass capacitor charge
 * - 50 Hz mains interference (powerline hum)
 * - Baseline wander from respiration (0.2 Hz)
 * - High-frequency muscle tremor noise
 * - Normal sinus rhythm P-QRS-T complexes (~72 BPM)
 * - Trailing edge release artifact (28.5s - 30s)
 */
export function generateDemoDeviceEcg(fs = 1000, durationSec = 30): number[] {
  const N = fs * durationSec;
  const samples = new Array(N);

  const baselineMid = 2048; // 12-bit ADC mid-rail (~1.65V)
  const bpm = 72;
  const rrSec = 60 / bpm; // ~0.833s

  for (let i = 0; i < N; i++) {
    const t = i / fs;

    // 1. Nominal baseline with slow wander (respiration ~0.25 Hz)
    let val = baselineMid + Math.sin(2 * Math.PI * 0.25 * t) * 120 + Math.sin(2 * Math.PI * 0.08 * t) * 80;

    // 2. Initial settling transient (first 1.8 seconds)
    // Plunges down steeply then rebounds into an overshoot before settling
    if (t < 1.8) {
      const drop = Math.exp(-t * 3.5) * -1600;
      const rebound = Math.sin(t * Math.PI / 1.8) * 450;
      val += drop + rebound;
    }

    // 3. Trailing release artifact (last 1.5 seconds)
    if (t > durationSec - 1.5) {
      const trem = (t - (durationSec - 1.5)) / 1.5;
      val += (Math.random() - 0.5) * 300 * trem + Math.sin(t * 12) * 200 * trem;
    }

    // 4. Cardiac P-QRS-T morphology
    const beatPhase = (t % rrSec) / rrSec;
    const beatTimeMs = beatPhase * rrSec * 1000;

    // P-wave (at ~160ms, duration 80ms)
    if (beatTimeMs >= 120 && beatTimeMs < 200) {
      const pPhase = (beatTimeMs - 160) / 40;
      val += 140 * Math.exp(-pPhase * pPhase * 2);
    }
    // Q-wave (at ~230ms, slight downward dip)
    else if (beatTimeMs >= 210 && beatTimeMs < 240) {
      const qPhase = (beatTimeMs - 230) / 10;
      val -= 180 * Math.exp(-qPhase * qPhase * 2);
    }
    // R-wave (at ~250ms, tall sharp positive spike)
    else if (beatTimeMs >= 240 && beatTimeMs < 280) {
      const rPhase = (beatTimeMs - 258) / 10;
      val += 1550 * Math.exp(-rPhase * rPhase * 2.5);
    }
    // S-wave (at ~285ms, sharp downward dip)
    else if (beatTimeMs >= 280 && beatTimeMs < 310) {
      const sPhase = (beatTimeMs - 292) / 10;
      val -= 320 * Math.exp(-sPhase * sPhase * 2);
    }
    // T-wave (at ~420ms, smooth rounded wave)
    else if (beatTimeMs >= 350 && beatTimeMs < 500) {
      const tPhase = (beatTimeMs - 425) / 50;
      val += 320 * Math.exp(-tPhase * tPhase * 2);
    }

    // 5. 50 Hz powerline mains hum (mains interference)
    val += Math.sin(2 * Math.PI * 50 * t) * 110;

    // 6. High-frequency muscle tremor (EMG fuzz)
    val += (Math.random() - 0.5) * 85;

    // Clamp to 12-bit ADC range (0..4095)
    samples[i] = Math.max(0, Math.min(4095, Math.round(val)));
  }

  return samples;
}
