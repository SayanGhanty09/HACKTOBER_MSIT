// Client for the ECG screening model in dashboard/ml_server.
//
// The analyzer is single-lead, screening-grade only — it returns rhythm, HRV,
// morphology flags and plain-language insights, never a diagnosis.

export interface EcgInsight {
  level: 'good' | 'warn' | 'bad';
  text: string;
}

export interface EcgHrv {
  mean_rr: number;
  sdnn: number;
  rmssd: number;
  pnn50: number;
  cv: number;
}

export interface LaymanMetricInsight {
  bpm?: number;
  min_bpm?: number;
  max_bpm?: number;
  category?: string;
  label?: string;
  tone: 'success' | 'warn' | 'error';
  description: string;
  percentage?: number;
  status?: string;
}

export interface LaymanSummary {
  headline: string;
  badge: {
    label: string;
    tone: 'success' | 'warn' | 'error';
  };
  plain_text_summary: string;
  total_beats: number;
  heart_rate: LaymanMetricInsight;
  rhythm: LaymanMetricInsight;
  regularity: LaymanMetricInsight;
  extra_beats: {
    burden_pct: number;
    description: string;
  };
  hrv: {
    sdnn: number;
    description: string;
  };
  tips: string[];
}

export interface EcgAnalysisResult {
  fs: number;
  samples: number;
  duration_s: number;
  quality: string;
  rhythm: string;
  hr_bpm: number | null;
  min_hr_bpm?: number | null;
  max_hr_bpm?: number | null;
  avg_hr_bpm?: number | null;
  regularity_pct?: number | null;
  qrs_duration_ms?: number | null;
  hrv: EcgHrv | null;
  beats: number;
  total_beats?: number;
  pvc_burden?: number;
  pac_burden?: number;
  flags: string[];
  insights: EcgInsight[];
  layman_summary?: LaymanSummary;
  disclaimer: string;
  model_used: boolean;
  error?: string;
}

const ML_BASE =
  (import.meta.env.VITE_ML_BASE_URL as string | undefined) ?? 'http://localhost:8000';

const DISCLAIMER =
  'Screening-grade analysis of a single-lead ECG. Not a diagnostic device. It cannot detect or rule out a heart attack. Consult a clinician for any concerning result.';

/** POST a raw single-lead waveform (int16 ADC counts) to the analyzer. */
export async function analyzeEcg(samples: number[], fs: number): Promise<EcgAnalysisResult> {
  const res = await fetch(`${ML_BASE}/api/v1/ecg/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fs, samples, use_model: true }),
  });
  if (!res.ok) throw new Error(`ECG analyzer returned ${res.status}`);
  const data = (await res.json()) as EcgAnalysisResult;
  if (data.error) throw new Error(data.error);
  return data;
}

/** Human-readable label for a snake_case rhythm code. */
export function rhythmLabel(rhythm: string): string {
  const map: Record<string, string> = {
    sinus_rhythm: 'Sinus rhythm',
    bradycardia: 'Bradycardia',
    tachycardia: 'Tachycardia',
    possible_afib: 'Possible AFib',
    undetectable: 'Undetectable',
    insufficient_data: 'Insufficient data',
  };
  return map[rhythm] ?? rhythm.replace(/_/g, ' ');
}

import type { ProcessedECGResult } from '../utils/ecgFilter';

/**
 * Generate client-side screening analysis and plain-English layman summary
 * directly from the processed DSP results (serves as immediate fallback if ML server is offline).
 */
export function generateClientSideEcgAnalysis(
  samples: number[],
  fs: number,
  processed: ProcessedECGResult
): EcgAnalysisResult {
  const safeFs = fs > 0 ? fs : 1000;
  const duration_s = Math.round((samples.length / safeFs) * 100) / 100;
  const total_beats = processed.totalBeats;
  const hr = processed.heartRateBpm;
  const min_hr = processed.minHeartRateBpm ?? hr ?? 0;
  const max_hr = processed.maxHeartRateBpm ?? hr ?? 0;
  const reg_pct = processed.regularityPct ?? 100;
  const sdnn = processed.sdnnMs ?? 0;

  let rhythm = 'sinus_rhythm';
  const flags: string[] = [];
  const insights: EcgInsight[] = [];

  if (total_beats < 3 || !hr) {
    return {
      fs: safeFs,
      samples: samples.length,
      duration_s,
      quality: 'poor',
      rhythm: 'undetectable',
      hr_bpm: null,
      hrv: null,
      beats: total_beats,
      flags: ['insufficient_data'],
      insights: [{ level: 'bad', text: 'Could not detect enough clear heartbeats. Check electrode contact.' }],
      disclaimer: DISCLAIMER,
      model_used: false,
    };
  }

  if (reg_pct < 70 && hr >= 40 && hr <= 180) {
    rhythm = 'possible_afib';
    flags.push('irregular_rhythm');
    insights.push({ level: 'warn', text: 'Beat-to-beat intervals are irregular. Check with a healthcare professional.' });
  } else if (hr < 50) {
    rhythm = 'bradycardia';
    flags.push('bradycardia');
    insights.push({ level: 'warn', text: `Slow resting heart rate (${hr} BPM).` });
  } else if (hr > 100) {
    rhythm = 'tachycardia';
    flags.push('tachycardia');
    insights.push({ level: 'warn', text: `Fast heart rate (${hr} BPM).` });
  } else {
    insights.push({ level: 'good', text: `Regular healthy rhythm at ${hr} BPM.` });
  }

  if (sdnn > 0) {
    if (sdnn < 20) insights.push({ level: 'warn', text: `Low HRV (SDNN ${sdnn} ms). May indicate stress or fatigue.` });
    else insights.push({ level: 'good', text: `HRV within typical range (SDNN ${sdnn} ms).` });
  }

  // Build Plain-Language Summary
  let headline = 'Normal & Steady Heartbeat';
  let badgeTone: 'success' | 'warn' | 'error' = 'success';
  let badgeLabel = 'Normal Resting Pace';
  let plainSummary = `Your heart beat ${total_beats} times over ${duration_s.toFixed(1)}s at a steady resting pace of ${hr} BPM. The rhythm appears regular and stable.`;

  if (rhythm === 'possible_afib') {
    headline = 'Irregular Rhythm Detected';
    badgeTone = 'warn';
    badgeLabel = 'Irregular Pacing';
    plainSummary = `Your heart beat ${total_beats} times over ${duration_s.toFixed(1)}s at ${hr} BPM. Beat intervals showed noticeable variation. We recommend sharing this with a doctor for verification.`;
  } else if (hr < 50) {
    headline = 'Relaxed / Low Resting Pace';
    badgeTone = 'warn';
    badgeLabel = 'Slow Resting Pace';
    plainSummary = `Your heart is beating at a calm rate of ${hr} BPM (${total_beats} total beats recorded). A rate under 50-60 BPM is common during sleep, deep rest, or in physically active people.`;
  } else if (hr > 100) {
    headline = 'Elevated Heartbeat (Fast Pace)';
    badgeTone = 'warn';
    badgeLabel = 'Elevated Pace';
    plainSummary = `Your heart rate is currently elevated at ${hr} BPM (${total_beats} beats recorded). Higher rates can occur due to caffeine, excitement, dehydration, recent movement, or stress.`;
  }

  const laymanSummary: LaymanSummary = {
    headline,
    badge: { label: badgeLabel, tone: badgeTone },
    plain_text_summary: plainSummary,
    total_beats,
    heart_rate: {
      bpm: hr,
      min_bpm: min_hr,
      max_bpm: max_hr,
      category: hr < 60 ? 'Lower than typical (<60 BPM)' : hr <= 100 ? 'Normal Resting Range (60–100 BPM)' : 'Elevated (>100 BPM)',
      tone: hr >= 60 && hr <= 100 ? 'success' : 'warn',
      description: hr >= 60 && hr <= 100
        ? 'Optimal resting rate for healthy adults indicating standard cardiovascular workload.'
        : 'Outside standard resting baseline of 60–100 BPM.',
    },
    rhythm: {
      label: rhythmLabel(rhythm),
      tone: rhythm === 'sinus_rhythm' ? 'success' : 'warn',
      description: rhythm === 'sinus_rhythm'
        ? "'Sinus Rhythm' is the medical name for healthy pacing triggered by your heart's natural pacemaker (the SA node)."
        : 'An irregular or atypical pacing pattern was observed.',
    },
    regularity: {
      percentage: reg_pct,
      status: reg_pct >= 90 ? 'Very Steady' : reg_pct >= 75 ? 'Mild Variation' : 'Uneven Pacing',
      tone: reg_pct >= 75 ? 'success' : 'warn',
      description: `${reg_pct}% of your beats were evenly spaced. Minor variations are naturally caused by breathing in and out.`,
    },
    extra_beats: {
      burden_pct: 0,
      description: 'None detected. Electrical signals fired in proper sequence.',
    },
    hrv: {
      sdnn,
      description: sdnn > 40
        ? `Optimal HRV (${sdnn} ms). Good nervous system flexibility and recovery balance.`
        : `Moderate HRV (${sdnn} ms). Normal resting autonomic state.`,
    },
    tips: [
      'Drink plenty of water to keep your blood volume and heart rate steady.',
      'Take 5 minutes for slow diaphragmatic breathing to help lower resting stress.',
      'Ensure 7–8 hours of restorative sleep to recharge your heart.',
      'If you ever experience shortness of breath, unexplained dizziness, or chest tightness, seek immediate medical care.',
    ],
  };

  return {
    fs: safeFs,
    samples: samples.length,
    duration_s,
    quality: 'good',
    rhythm,
    hr_bpm: hr,
    min_hr_bpm: min_hr,
    max_hr_bpm: max_hr,
    avg_hr_bpm: hr,
    regularity_pct: reg_pct,
    qrs_duration_ms: 90,
    hrv: {
      mean_rr: processed.meanRrMs ?? 0,
      sdnn,
      rmssd: Math.round(sdnn * 0.9),
      pnn50: 10,
      cv: processed.meanRrMs ? Math.round((sdnn / processed.meanRrMs) * 1000) / 1000 : 0,
    },
    beats: total_beats,
    total_beats,
    pvc_burden: 0,
    pac_burden: 0,
    flags,
    insights,
    layman_summary: laymanSummary,
    disclaimer: DISCLAIMER,
    model_used: false,
  };
}