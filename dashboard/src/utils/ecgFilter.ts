/**
 * High-performance ECG Digital Signal Processing (DSP) toolkit
 * 
 * Features:
 * 1. Edge Cropping (drops initial settling artifacts and trailing release transients)
 * 2. Zero-phase (forward-backward / filtfilt) IIR filtering:
 *    - High-pass (0.67 Hz): eliminates baseline wander and respiration drift
 *    - Notch (50 Hz / 60 Hz): eliminates powerline mains interference
 *    - Low-pass (40 Hz): eliminates electromyographic (EMG) muscle tremor and high-frequency noise
 * 3. Pan-Tompkins style R-peak detection & Heart Rate (BPM) / RR interval calculation
 */

export interface FilterOptions {
  enableCrop?: boolean;
  cropStartSec?: number;
  cropEndSec?: number;
  enableBaselineRemoval?: boolean;
  baselineCutoffHz?: number;
  enableNotch?: boolean;
  notchFreq?: 50 | 60 | 'both' | 'off';
  notchQ?: number;
  enableLowPass?: boolean;
  lowPassCutoffHz?: number;
}

export const DEFAULT_FILTER_OPTIONS: FilterOptions = {
  enableCrop: true,
  cropStartSec: 2,
  cropEndSec: 2,
  enableBaselineRemoval: true,
  baselineCutoffHz: 0.67,
  enableNotch: true,
  notchFreq: 50,
  notchQ: 15,
  enableLowPass: true,
  lowPassCutoffHz: 40,
};

export interface BeatDetail {
  index: number;
  timeSec: number;
  instantBpm: number | null;
  rrMs: number | null;
}

export interface ProcessedECGResult {
  raw: number[];
  filtered: number[];
  displaySamples: number[];
  fs: number;
  cropStartIndex: number;
  cropEndIndex: number;
  cropStartTimeSec: number;
  totalDurationSec: number;
  rPeaks: number[];          // sample indices relative to displaySamples
  rPeakTimesSec: number[];    // time in seconds relative to start of displaySamples
  totalBeats: number;
  heartRateBpm: number | null;
  minHeartRateBpm: number | null;
  maxHeartRateBpm: number | null;
  meanRrMs: number | null;
  minRrMs: number | null;
  maxRrMs: number | null;
  sdnnMs: number | null;
  regularityPct: number | null;
  beats: BeatDetail[];
}

/**
 * 2nd-order Biquad IIR Filter coefficients:
 * H(z) = (b0 + b1*z^-1 + b2*z^-2) / (a0 + a1*z^-1 + a2*z^-2)
 * Normalized so a0 = 1.
 */
interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/**
 * Design a 2nd-order Butterworth Low-Pass filter
 */
function designButterworthLowPass(fc: number, fs: number): BiquadCoeffs {
  const normFc = Math.min(Math.max(fc / fs, 0.0001), 0.4999);
  const w = Math.tan(Math.PI * normFc);
  const w2 = w * w;
  const sqrt2 = Math.SQRT2;
  const d = 1 + sqrt2 * w + w2;

  return {
    b0: w2 / d,
    b1: (2 * w2) / d,
    b2: w2 / d,
    a1: (2 * (w2 - 1)) / d,
    a2: (1 - sqrt2 * w + w2) / d,
  };
}

/**
 * Design a 2nd-order Butterworth High-Pass filter
 */
function designButterworthHighPass(fc: number, fs: number): BiquadCoeffs {
  const normFc = Math.min(Math.max(fc / fs, 0.0001), 0.4999);
  const w = Math.tan(Math.PI * normFc);
  const w2 = w * w;
  const sqrt2 = Math.SQRT2;
  const d = 1 + sqrt2 * w + w2;

  return {
    b0: 1 / d,
    b1: -2 / d,
    b2: 1 / d,
    a1: (2 * (w2 - 1)) / d,
    a2: (1 - sqrt2 * w + w2) / d,
  };
}

/**
 * Design a 2nd-order IIR Notch filter
 */
function designNotch(f0: number, fs: number, Q: number = 15): BiquadCoeffs {
  const normF0 = Math.min(Math.max(f0 / fs, 0.0001), 0.4999);
  const w0 = 2 * Math.PI * normF0;
  const alpha = Math.sin(w0) / (2 * Q);
  const cosw0 = Math.cos(w0);
  const a0 = 1 + alpha;

  return {
    b0: 1 / a0,
    b1: (-2 * cosw0) / a0,
    b2: 1 / a0,
    a1: (-2 * cosw0) / a0,
    a2: (1 - alpha) / a0,
  };
}

/**
 * Direct Form II Transposed single-pass IIR filtering
 */
function applyBiquadDirect(input: number[], coeffs: { b0: number; b1: number; b2: number; a1: number; a2: number }): number[] {
  const n = input.length;
  if (n === 0) return [];
  const output = new Float64Array(n);
  const { b0, b1, b2, a1, a2 } = coeffs;

  let s1 = 0;
  let s2 = 0;

  // Initialize state with steady-state step response at x[0]
  // For DC input x0: y = x0 * (b0+b1+b2)/(1+a1+a2)
  const dcGain = (b0 + b1 + b2) / (1 + a1 + a2);
  const x0 = input[0];
  const y0 = isFinite(dcGain) ? x0 * dcGain : 0;
  s1 = (b1 - a1 * (y0 / (x0 || 1))) * x0;
  s2 = (b2 - a2 * (y0 / (x0 || 1))) * x0;

  for (let i = 0; i < n; i++) {
    const x = input[i];
    const y = b0 * x + s1;
    s1 = b1 * x - a1 * y + s2;
    s2 = b2 * x - a2 * y;
    output[i] = y;
  }

  return Array.from(output);
}

/**
 * Zero-phase forward-backward filtering (`filtfilt`)
 * Filters forward, reverses, filters again, and reverses back.
 * Guarantees zero phase shift so ECG wave peaks and morphology never lag.
 */
function filtfilt(input: number[], coeffs: BiquadCoeffs): number[] {
  const n = input.length;
  if (n < 6) return input.slice();

  // Edge padding: reflect boundary by padLen to minimize filter warmup transients
  const padLen = Math.min(Math.floor(n / 3), 120);
  const padded = new Float64Array(n + 2 * padLen);

  const firstVal = input[0];
  const lastVal = input[n - 1];

  // Head reflection
  for (let i = 0; i < padLen; i++) {
    padded[i] = 2 * firstVal - input[padLen - i];
  }
  // Data
  for (let i = 0; i < n; i++) {
    padded[padLen + i] = input[i];
  }
  // Tail reflection
  for (let i = 0; i < padLen; i++) {
    padded[padLen + n + i] = 2 * lastVal - input[n - 2 - i];
  }

  // Forward pass
  const forward = applyBiquadDirect(Array.from(padded), coeffs);

  // Reverse
  forward.reverse();

  // Backward pass
  const backward = applyBiquadDirect(forward, coeffs);

  // Reverse back
  backward.reverse();

  // Extract original slice
  return backward.slice(padLen, padLen + n);
}

/**
 * Removes baseline wander using a moving median / running average filter
 * or forward-backward high-pass filter.
 */
export function removeBaselineWander(samples: number[], fs: number, fc: number = 0.67): number[] {
  if (samples.length < 10) return samples.slice();
  const hpCoeffs = designButterworthHighPass(fc, fs);
  return filtfilt(samples, hpCoeffs);
}

/**
 * Applies powerline notch filter at 50Hz or 60Hz or both
 */
export function applyNotchFilter(samples: number[], fs: number, notchFreq: 50 | 60 | 'both' | 'off' = 50, Q: number = 15): number[] {
  if (notchFreq === 'off' || samples.length < 10) return samples.slice();

  let out = samples;
  if (notchFreq === 50 || notchFreq === 'both') {
    if (50 < fs / 2) {
      const c50 = designNotch(50, fs, Q);
      out = filtfilt(out, c50);
    }
  }
  if (notchFreq === 60 || notchFreq === 'both') {
    if (60 < fs / 2) {
      const c60 = designNotch(60, fs, Q);
      out = filtfilt(out, c60);
    }
  }
  return out;
}

/**
 * Applies low-pass filter to remove muscle EMG fuzz / high frequency noise
 */
export function applyLowPassFilter(samples: number[], fs: number, fc: number = 40): number[] {
  if (samples.length < 10 || fc >= fs / 2) return samples.slice();
  const lpCoeffs = designButterworthLowPass(fc, fs);
  return filtfilt(samples, lpCoeffs);
}

/**
 * Detects R-peaks in an ECG waveform and calculates heart rate metrics.
 * Uses adaptive thresholding and derivative energy.
 */
export function detectRPeaks(samples: number[], fs: number): {
  peaks: number[];
  peakTimesSec: number[];
  totalBeats: number;
  bpm: number | null;
  minHeartRateBpm: number | null;
  maxHeartRateBpm: number | null;
  meanRrMs: number | null;
  minRrMs: number | null;
  maxRrMs: number | null;
  sdnnMs: number | null;
  regularityPct: number | null;
  beats: BeatDetail[];
} {
  const n = samples.length;
  if (n < fs) {
    return {
      peaks: [],
      peakTimesSec: [],
      totalBeats: 0,
      bpm: null,
      minHeartRateBpm: null,
      maxHeartRateBpm: null,
      meanRrMs: null,
      minRrMs: null,
      maxRrMs: null,
      sdnnMs: null,
      regularityPct: null,
      beats: [],
    };
  }

  // 1. Calculate approximate derivative & squared energy
  // Energy = (x[i+1] - x[i-1])^2
  const energy = new Float64Array(n);
  for (let i = 2; i < n - 2; i++) {
    const diff = (samples[i + 1] - samples[i - 1]) * 0.5;
    energy[i] = diff * diff;
  }

  // 2. Moving window integration (~150ms window)
  const windowLen = Math.max(3, Math.round(fs * 0.15));
  const integrated = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += energy[i];
    if (i >= windowLen) sum -= energy[i - windowLen];
    integrated[i] = sum / windowLen;
  }

  // Find 98th percentile energy to set dynamic threshold robustly against single artifact spikes
  const energyValues = Array.from(integrated).sort((a, b) => a - b);
  const p98 = energyValues[Math.floor(energyValues.length * 0.98)] || 0;
  const threshold = Math.max(1e-5, p98 * 0.28);

  // Refractory period: standard min RR is ~200ms (up to 300 BPM)
  const minDistance = Math.max(1, Math.round(fs * 0.20));

  const candidatePeaks: number[] = [];
  let lastPeak = -minDistance;

  for (let i = minDistance; i < n - minDistance; i++) {
    if (integrated[i] > threshold && integrated[i] > integrated[i - 1] && integrated[i] >= integrated[i + 1]) {
      if (i - lastPeak >= minDistance) {
        // Search local neighborhood in original signal for true R-wave peak
        const searchHalf = Math.round(fs * 0.08); // 80ms window
        const searchStart = Math.max(0, i - searchHalf);
        const searchEnd = Math.min(n - 1, i + searchHalf);
        let bestIdx = i;
        let bestVal = samples[i];
        for (let j = searchStart; j <= searchEnd; j++) {
          if (samples[j] > bestVal) {
            bestVal = samples[j];
            bestIdx = j;
          }
        }
        candidatePeaks.push(bestIdx);
        lastPeak = i;
      }
    }
  }

  const totalBeats = candidatePeaks.length;

  if (candidatePeaks.length < 2) {
    const singleBeats: BeatDetail[] = candidatePeaks.map((p) => ({
      index: p,
      timeSec: p / fs,
      instantBpm: null,
      rrMs: null,
    }));
    return {
      peaks: candidatePeaks,
      peakTimesSec: candidatePeaks.map(p => p / fs),
      totalBeats,
      bpm: null,
      minHeartRateBpm: null,
      maxHeartRateBpm: null,
      meanRrMs: null,
      minRrMs: null,
      maxRrMs: null,
      sdnnMs: null,
      regularityPct: null,
      beats: singleBeats,
    };
  }

  // Calculate RR intervals in milliseconds and beat-by-beat details
  const rrIntervalsMs: number[] = [];
  const beats: BeatDetail[] = [
    {
      index: candidatePeaks[0],
      timeSec: candidatePeaks[0] / fs,
      instantBpm: null,
      rrMs: null,
    },
  ];

  for (let i = 1; i < candidatePeaks.length; i++) {
    const rr = ((candidatePeaks[i] - candidatePeaks[i - 1]) / fs) * 1000;
    const instantBpm = rr > 0 ? Math.round(60000 / rr) : null;
    beats.push({
      index: candidatePeaks[i],
      timeSec: candidatePeaks[i] / fs,
      instantBpm,
      rrMs: Math.round(rr),
    });
    if (rr >= 250 && rr <= 2500) { // 24 to 240 BPM plausible range
      rrIntervalsMs.push(rr);
    }
  }

  if (rrIntervalsMs.length === 0) {
    return {
      peaks: candidatePeaks,
      peakTimesSec: candidatePeaks.map(p => p / fs),
      totalBeats,
      bpm: null,
      minHeartRateBpm: null,
      maxHeartRateBpm: null,
      meanRrMs: null,
      minRrMs: null,
      maxRrMs: null,
      sdnnMs: null,
      regularityPct: null,
      beats,
    };
  }

  // Median and statistics
  const sorted = [...rrIntervalsMs].sort((a, b) => a - b);
  const medianRr = sorted[Math.floor(sorted.length / 2)];
  const meanRr = rrIntervalsMs.reduce((a, b) => a + b, 0) / rrIntervalsMs.length;
  const bpm = Math.round(60000 / medianRr);

  // Min and Max instantaneous heart rate
  const minHeartRateBpm = Math.round(60000 / sorted[sorted.length - 1]);
  const maxHeartRateBpm = Math.round(60000 / sorted[0]);

  // Regularity percentage: proportion of RR intervals within ±15% of median
  const regularCount = rrIntervalsMs.filter((r) => Math.abs(r - medianRr) / medianRr <= 0.15).length;
  const regularityPct = Math.round((regularCount / rrIntervalsMs.length) * 100);

  const variance = rrIntervalsMs.reduce((sum, val) => sum + Math.pow(val - meanRr, 2), 0) / rrIntervalsMs.length;
  const sdnn = Math.round(Math.sqrt(variance));

  return {
    peaks: candidatePeaks,
    peakTimesSec: candidatePeaks.map(p => p / fs),
    totalBeats,
    bpm,
    minHeartRateBpm,
    maxHeartRateBpm,
    meanRrMs: Math.round(meanRr),
    minRrMs: Math.round(sorted[0]),
    maxRrMs: Math.round(sorted[sorted.length - 1]),
    sdnnMs: sdnn,
    regularityPct,
    beats,
  };
}

/**
 * Master processing pipeline:
 * 1. Cropping 1st & last 2 seconds (if enabled)
 * 2. High-pass baseline wander removal (0.67 Hz)
 * 3. 50/60 Hz Notch filter
 * 4. 40 Hz Low-pass smoothing (EMG noise removal)
 * 5. Peak detection & heart rate calculation
 */
export function processECGWaveform(
  rawSamples: number[],
  fs: number = 1000,
  options: FilterOptions = DEFAULT_FILTER_OPTIONS
): ProcessedECGResult {
  const safeFs = fs > 0 ? fs : 1000;
  const totalCount = rawSamples.length;

  if (totalCount === 0) {
    return {
      raw: [],
      filtered: [],
      displaySamples: [],
      fs: safeFs,
      cropStartIndex: 0,
      cropEndIndex: 0,
      cropStartTimeSec: 0,
      totalDurationSec: 0,
      rPeaks: [],
      rPeakTimesSec: [],
      totalBeats: 0,
      heartRateBpm: null,
      minHeartRateBpm: null,
      maxHeartRateBpm: null,
      meanRrMs: null,
      minRrMs: null,
      maxRrMs: null,
      sdnnMs: null,
      regularityPct: null,
      beats: [],
    };
  }

  // Step 1: Crop 1st and last N seconds
  let startIndex = 0;
  let endIndex = totalCount;
  if (options.enableCrop) {
    const startSamples = Math.round((options.cropStartSec ?? 2) * safeFs);
    const endSamples = Math.round((options.cropEndSec ?? 2) * safeFs);

    // Only crop if there are enough samples left (at least 2 seconds remaining)
    if (totalCount > startSamples + endSamples + safeFs * 2) {
      startIndex = startSamples;
      endIndex = totalCount - endSamples;
    }
  }

  const croppedRaw = rawSamples.slice(startIndex, endIndex);

  // Step 2: Digital Filtering
  let filtered = croppedRaw.slice();

  // Baseline wander removal
  if (options.enableBaselineRemoval) {
    filtered = removeBaselineWander(filtered, safeFs, options.baselineCutoffHz ?? 0.67);
  }

  // Powerline Notch filter (50Hz / 60Hz)
  if (options.enableNotch && options.notchFreq && options.notchFreq !== 'off') {
    filtered = applyNotchFilter(filtered, safeFs, options.notchFreq, options.notchQ ?? 15);
  }

  // Low-pass filter (40Hz)
  if (options.enableLowPass) {
    filtered = applyLowPassFilter(filtered, safeFs, options.lowPassCutoffHz ?? 40);
  }

  // Step 3: Peak detection on filtered signal
  const peakInfo = detectRPeaks(filtered, safeFs);

  return {
    raw: croppedRaw,
    filtered,
    displaySamples: filtered,
    fs: safeFs,
    cropStartIndex: startIndex,
    cropEndIndex: endIndex,
    cropStartTimeSec: startIndex / safeFs,
    totalDurationSec: croppedRaw.length / safeFs,
    rPeaks: peakInfo.peaks,
    rPeakTimesSec: peakInfo.peakTimesSec,
    totalBeats: peakInfo.totalBeats,
    heartRateBpm: peakInfo.bpm,
    minHeartRateBpm: peakInfo.minHeartRateBpm,
    maxHeartRateBpm: peakInfo.maxHeartRateBpm,
    meanRrMs: peakInfo.meanRrMs,
    minRrMs: peakInfo.minRrMs,
    maxRrMs: peakInfo.maxRrMs,
    sdnnMs: peakInfo.sdnnMs,
    regularityPct: peakInfo.regularityPct,
    beats: peakInfo.beats,
  };
}
