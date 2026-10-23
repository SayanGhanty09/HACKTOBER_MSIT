/**
 * exchangeClient.ts
 * Generates a structured clinical report by calling OpenRouter directly.
 * No separate exchange/backend server is required.
 */

import { getOpenRouterKey, getOpenRouterModel } from '../utils/aiPreferences';

// ─── Payload types ────────────────────────────────────────────────────────────

export interface ExchangePatientPayload {
  id: string;
  name: string;
  age: number;
  sex: string;
}

export interface ExchangeBiomarkersPayload {
  spo2: number | null;
  heartRate: number | null;
  perfusionIndex: number | null;
  signalQuality: number | null;
  sdnn: number | null;
  rmssd: number | null;
  hemoglobin: number | null;
  bilirubin: number | null;
  systolicBP: number | null;
  diastolicBP: number | null;
  pulseRate: number | null;
  respirationRate: number | null;
}

export interface ExchangeRequestPayload {
  deviceName: string;
  patient: ExchangePatientPayload;
  timestamp: string;
  biomarkers: ExchangeBiomarkersPayload;
}

// ─── Report types ─────────────────────────────────────────────────────────────

export interface LiveReportFinding {
  parameter: string;
  value: string;
  status: 'normal' | 'borderline' | 'abnormal';
  interpretation: string;
}

export interface LiveReportResult {
  healthScore: number;
  summary: string;
  findings: LiveReportFinding[];
  recommendations: string[];
  warnings: string[];
  disclaimer: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseStatus(value: unknown): 'normal' | 'borderline' | 'abnormal' {
  const lower = String(value ?? '').toLowerCase();
  if (lower === 'normal' || lower === 'borderline' || lower === 'abnormal') return lower;
  return 'normal';
}

function normalizeFindings(value: unknown): LiveReportFinding[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const r = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {};
    return {
      parameter: String(r.parameter ?? 'PARAMETER'),
      value: String(r.value ?? '--'),
      status: parseStatus(r.status),
      interpretation: String(r.interpretation ?? ''),
    };
  });
}

export function normalizeMedicalReport(rawReport: unknown, fallbackSummary = ''): LiveReportResult {
  const report =
    typeof rawReport === 'object' && rawReport !== null
      ? (rawReport as Record<string, unknown>)
      : {};
  return {
    healthScore: Number(report.healthScore ?? 5),
    summary: String(report.summary ?? fallbackSummary),
    findings: normalizeFindings(report.findings),
    recommendations: Array.isArray(report.recommendations)
      ? report.recommendations.map((i) => String(i))
      : [],
    warnings: Array.isArray(report.warnings)
      ? report.warnings.map((i) => String(i))
      : [],
    disclaimer: String(
      report.disclaimer ??
        'This report is for screening purposes only and does not replace professional medical evaluation.'
    ),
  };
}

// ─── Rule-Based Screening Fallback ────────────────────────────────────────────

export function generateRuleBasedReport(
  payload: ExchangeRequestPayload,
  notice?: string
): LiveReportResult {
  const b = payload.biomarkers;
  const findings: LiveReportFinding[] = [];
  const recommendations: string[] = [];
  const warnings: string[] = [];
  let scoreDeduction = 0;

  // 1. Heart Rate
  if (b.heartRate != null) {
    const hr = b.heartRate;
    let status: 'normal' | 'borderline' | 'abnormal' = 'normal';
    let interp = 'Resting heart rate within normal physiological limits (60-100 bpm).';

    if (hr < 50) {
      status = 'abnormal';
      interp = 'Marked bradycardia (<50 bpm). Correlate with athletic history or conduction abnormality.';
      recommendations.push('Evaluate marked resting bradycardia; assess for dizziness or fatigue.');
      warnings.push('Resting heart rate below 50 bpm (Bradycardia).');
      scoreDeduction += 2.0;
    } else if (hr < 60) {
      status = 'borderline';
      interp = 'Low-normal resting heart rate (50-59 bpm). Commonly seen in fit individuals.';
      scoreDeduction += 0.8;
    } else if (hr > 110) {
      status = 'abnormal';
      interp = 'Tachycardia detected (>110 bpm). May reflect systemic stress, anxiety, or arrhythmia.';
      recommendations.push('Resting tachycardia observed; consider 12-lead ECG and repeat vital check after rest.');
      warnings.push('Elevated heart rate above 110 bpm (Tachycardia).');
      scoreDeduction += 2.0;
    } else if (hr > 100) {
      status = 'borderline';
      interp = 'Borderline elevated resting heart rate (100-110 bpm).';
      scoreDeduction += 0.8;
    }

    findings.push({
      parameter: 'Heart Rate',
      value: `${hr.toFixed(1)} bpm`,
      status,
      interpretation: interp,
    });
  }

  // 2. SpO2
  if (b.spo2 != null) {
    const spo2 = b.spo2;
    let status: 'normal' | 'borderline' | 'abnormal' = 'normal';
    let interp = 'Adequate peripheral arterial oxygen saturation (≥95%).';

    if (spo2 < 90) {
      status = 'abnormal';
      interp = 'Significant hypoxemia (<90%). Immediate clinical evaluation and supplementary O2 assessment warranted.';
      recommendations.push('Urgent: Clinical oxygen saturation assessment and respiratory examination.');
      warnings.push('Critically low oxygen saturation (<90%).');
      scoreDeduction += 3.0;
    } else if (spo2 < 95) {
      status = 'borderline';
      interp = 'Borderline peripheral oxygen saturation (90-94%). Monitor closely and assess respiratory symptoms.';
      recommendations.push('Recheck SpO2 with warm extremities; monitor breathing effort.');
      scoreDeduction += 1.2;
    }

    findings.push({
      parameter: 'SpO2',
      value: `${spo2.toFixed(1)}%`,
      status,
      interpretation: interp,
    });
  }

  // 3. Hemoglobin
  if (b.hemoglobin != null) {
    const hb = b.hemoglobin;
    const isFemale = String(payload.patient.sex || '').toLowerCase().startsWith('f');
    const lower = isFemale ? 12.0 : 13.5;
    const upper = isFemale ? 15.5 : 17.5;
    let status: 'normal' | 'borderline' | 'abnormal' = 'normal';
    let interp = `Hemoglobin within standard ${isFemale ? 'female' : 'male'} reference interval (${lower}-${upper} g/dL).`;

    if (hb < lower - 2.0) {
      status = 'abnormal';
      interp = `Moderate to severe anemia indicated (${hb.toFixed(2)} g/dL). Correlate with CBC and iron studies.`;
      recommendations.push('Laboratory complete blood count (CBC) recommended to confirm hemoglobin level.');
      warnings.push('Sub-normal hemoglobin screening value.');
      scoreDeduction += 2.0;
    } else if (hb < lower) {
      status = 'borderline';
      interp = `Mildly reduced hemoglobin (${hb.toFixed(2)} g/dL). Suggests potential mild anemia.`;
      recommendations.push('Dietary assessment for iron and vitamin B12 intake; routine primary care follow-up.');
      scoreDeduction += 1.0;
    } else if (hb > upper) {
      status = 'borderline';
      interp = `Elevated hemoglobin (${hb.toFixed(2)} g/dL). Check hydration status or chronic hypoxemia.`;
      scoreDeduction += 0.8;
    }

    findings.push({
      parameter: 'Hemoglobin',
      value: `${hb.toFixed(2)} g/dL`,
      status,
      interpretation: interp,
    });
  }

  // 4. Bilirubin
  if (b.bilirubin != null) {
    const bili = b.bilirubin;
    let status: 'normal' | 'borderline' | 'abnormal' = 'normal';
    let interp = 'Bilirubin concentration within standard physiological range (<1.2 mg/dL).';

    if (bili > 3.0) {
      status = 'abnormal';
      interp = `Elevated bilirubin (${bili.toFixed(2)} mg/dL). Clinical jaundice risk; hepatic/biliary screening indicated.`;
      recommendations.push('Liver function panel (LFT) and clinical assessment for scleral icterus recommended.');
      warnings.push('Elevated total bilirubin screening value (>3.0 mg/dL).');
      scoreDeduction += 2.0;
    } else if (bili >= 1.2) {
      status = 'borderline';
      interp = `Borderline bilirubin (${bili.toFixed(2)} mg/dL). May indicate mild hemolysis, Gilbert's, or fasting state.`;
      scoreDeduction += 0.8;
    }

    findings.push({
      parameter: 'Bilirubin',
      value: `${bili.toFixed(2)} mg/dL`,
      status,
      interpretation: interp,
    });
  }

  // 5. HRV (SDNN / RMSSD)
  if (b.sdnn != null) {
    const sdnn = b.sdnn;
    let status: 'normal' | 'borderline' | 'abnormal' = 'normal';
    let interp = 'Robust autonomic nervous system tone and heart rate variability (>50 ms).';

    if (sdnn < 30) {
      status = 'abnormal';
      interp = 'Significantly reduced HRV (<30 ms). May reflect autonomic dysfunction, acute stress, or cardiovascular strain.';
      scoreDeduction += 1.5;
    } else if (sdnn < 50) {
      status = 'borderline';
      interp = 'Moderate HRV reduction (30-50 ms). Often associated with fatigue, dehydration, or mild stress.';
      scoreDeduction += 0.5;
    }

    findings.push({
      parameter: 'HRV SDNN',
      value: `${sdnn.toFixed(1)} ms`,
      status,
      interpretation: interp,
    });
  }

  // 6. Blood Pressure
  if (b.systolicBP != null && !isNaN(b.systolicBP) && b.systolicBP > 0) {
    const sbp = b.systolicBP;
    const dbp = b.diastolicBP ?? 0;
    let status: 'normal' | 'borderline' | 'abnormal' = 'normal';
    let interp = 'Normotensive blood pressure readings.';

    if (sbp >= 140 || dbp >= 90) {
      status = 'abnormal';
      interp = `Hypertension stage 1/2 criteria met (${sbp.toFixed(0)}/${dbp > 0 ? dbp.toFixed(0) : '?'} mmHg).`;
      recommendations.push('Repeat seated blood pressure with calibrated sphygmomanometer; review cardiovascular risk.');
      warnings.push('Elevated blood pressure observed.');
      scoreDeduction += 1.5;
    } else if (sbp >= 120 || dbp >= 80) {
      status = 'borderline';
      interp = `Pre-hypertension / elevated BP range (${sbp.toFixed(0)}/${dbp > 0 ? dbp.toFixed(0) : '?'} mmHg).`;
      scoreDeduction += 0.5;
    }

    findings.push({
      parameter: 'Blood Pressure',
      value: `${sbp.toFixed(0)}/${dbp > 0 ? dbp.toFixed(0) : '--'} mmHg`,
      status,
      interpretation: interp,
    });
  }

  // Default recommendations if none triggered
  if (recommendations.length === 0) {
    recommendations.push('Maintain regular hydration, balanced nutrition, and standard physical activity.');
    recommendations.push('Schedule routine preventative health screenings in accordance with age guidelines.');
  }

  if (notice) {
    warnings.unshift(notice);
  }

  const rawScore = Math.max(1.0, Math.min(10.0, 10.0 - scoreDeduction));
  const healthScore = Math.round(rawScore * 10) / 10;

  let summary = `Non-invasive biomarker screening completed for ${payload.patient.age}y ${payload.patient.sex}. Overall physiological indices are predominantly stable.`;
  if (scoreDeduction > 2.5) {
    summary = `Screening screening identified one or more out-of-range parameters requiring clinical review for ${payload.patient.age}y ${payload.patient.sex}. Correlate with standard diagnostic assays.`;
  }

  return {
    healthScore,
    summary,
    findings,
    recommendations,
    warnings,
    disclaimer:
      'This report is for screening purposes only and does not replace professional medical diagnosis or evaluation.',
  };
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Generate a clinical report by calling OpenRouter directly.
 * If OpenRouter fails (e.g. invalid key 401, network offline, quota 402),
 * automatically falls back to local clinical rule-engine so the clinician's workflow is never halted.
 */
export async function requestLiveRecordingReport(payload: ExchangeRequestPayload): Promise<{
  requestId: string;
  report: LiveReportResult;
  fallbackUsed?: boolean;
  fallbackReason?: string;
}> {
  const apiKey = getOpenRouterKey();
  const b = payload.biomarkers;

  // If no API key configured at all, gracefully use local clinical engine
  if (!apiKey) {
    const notice = 'Generated via local clinical rule engine (OpenRouter API key not configured in Settings).';
    const report = generateRuleBasedReport(payload, notice);
    return {
      requestId: `local-${Date.now()}`,
      report,
      fallbackUsed: true,
      fallbackReason: 'No OpenRouter API key configured.',
    };
  }

  const model = getOpenRouterModel('liveRecording');

  // Build a human-readable biomarker summary for the prompt
  const lines: string[] = [];
  if (b.heartRate != null)      lines.push(`Heart Rate: ${b.heartRate.toFixed(1)} bpm`);
  if (b.spo2 != null)           lines.push(`SpO₂: ${b.spo2.toFixed(1)}%`);
  if (b.hemoglobin != null)     lines.push(`Hemoglobin: ${b.hemoglobin.toFixed(2)} g/dL`);
  if (b.bilirubin != null)      lines.push(`Bilirubin: ${b.bilirubin.toFixed(2)} mg/dL`);
  if (b.sdnn != null)           lines.push(`HRV SDNN: ${b.sdnn.toFixed(1)} ms`);
  if (b.rmssd != null)          lines.push(`HRV RMSSD: ${b.rmssd.toFixed(1)} ms`);
  if (b.systolicBP != null && !isNaN(b.systolicBP)) lines.push(`Blood Pressure: ${b.systolicBP.toFixed(0)}/${b.diastolicBP?.toFixed(0) ?? '?'} mmHg`);
  if (b.respirationRate != null && !isNaN(b.respirationRate)) lines.push(`Respiration Rate: ${b.respirationRate.toFixed(1)} br/min`);
  if (b.perfusionIndex != null) lines.push(`Perfusion Index: ${b.perfusionIndex.toFixed(2)}%`);
  if (b.signalQuality != null)  lines.push(`Signal Quality: ${b.signalQuality}%`);

  const biomarkerText = lines.length > 0 ? lines.join('\n') : 'No biomarker data provided.';

  const systemPrompt = `You are a clinical AI assistant for the Anebilin non-invasive screening device.
Generate a structured medical screening report from the provided biomarker readings.

Return ONLY valid JSON (no markdown, no extra text) in this exact structure:
{
  "healthScore": <number 0-10>,
  "summary": "<2-3 sentence clinical overview>",
  "findings": [
    {
      "parameter": "<parameter name>",
      "value": "<value with unit>",
      "status": "<normal|borderline|abnormal>",
      "interpretation": "<brief clinical interpretation>"
    }
  ],
  "recommendations": ["<actionable recommendation>", ...],
  "warnings": ["<clinical warning if any>", ...],
  "disclaimer": "This report is for screening purposes only and does not replace professional medical evaluation."
}

Clinical reference ranges:
- Heart Rate: 60-100 bpm (normal), 50-60 or 100-110 (borderline), <50 or >110 (abnormal)
- SpO₂: ≥95% (normal), 90-94% (borderline), <90% (abnormal)
- Hemoglobin: Male 13.5-17.5 g/dL, Female 12.0-15.5 g/dL (adjust by sex)
- Bilirubin: <1.2 mg/dL (normal), 1.2-3.0 (borderline), >3.0 (abnormal)
- HRV SDNN: >50ms (normal), 30-50ms (borderline), <30ms (abnormal)
- Blood Pressure: <120/80 (normal), 120-139/80-89 (borderline/elevated), ≥140/90 (abnormal)
- Respiration Rate: 12-20 br/min (normal), 10-12 or 20-24 (borderline), <10 or >24 (abnormal)

Only include findings for parameters that have data. Be clinically precise but accessible.`;

  const userPrompt = `Patient: ${payload.patient.age} year old ${payload.patient.sex}
Device: ${payload.deviceName}
Timestamp: ${payload.timestamp}

Biomarker Readings:
${biomarkerText}

Generate a comprehensive screening report.`;

  const candidateModels = Array.from(new Set([
    model,
    'openai/gpt-4o-mini',
    'nex-agi/nex-n2.5-mini:free',
    'deepseek/deepseek-v4-flash-0731:free',
  ]));

  let lastErrorReason = '';

  for (const candidate of candidateModels) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': window.location.origin,
          'X-Title': 'Anebilin Spectru',
        },
        body: JSON.stringify({
          model: candidate,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.2,
          max_tokens: 1500,
          reasoning: { effort: 'none' },
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        let rawMsg = `HTTP ${response.status}`;
        try {
          const errObj = JSON.parse(errorText);
          if (errObj?.error?.message) rawMsg = errObj.error.message;
        } catch {}

        lastErrorReason = `OpenRouter error (${response.status}: ${rawMsg})`;
        // If 401 (auth issue), do not try other models with same invalid key
        if (response.status === 401) {
          lastErrorReason = `Invalid or expired OpenRouter key (401: ${rawMsg}). Update your key in Settings.`;
          break;
        }
        // If 402/429/404, try the next candidate model
        console.warn(`Model ${candidate} returned ${response.status} (${rawMsg}), trying next model...`);
        continue;
      }

      const data = await response.json();
      const rawContent: unknown = data.choices?.[0]?.message?.content;
      const content =
        Array.isArray(rawContent)
          ? rawContent.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('\n')
          : typeof rawContent === 'string'
          ? rawContent
          : '';

      if (!content || !content.trim()) continue;

      let cleanStr = content.trim();
      if (cleanStr.startsWith('```')) {
        cleanStr = cleanStr.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      }

      const jsonMatch = cleanStr.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn(`No JSON match found in response from ${candidate}`);
        continue;
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const report = normalizeMedicalReport(parsed);
      const requestId = `openrouter-${Date.now()}`;

      return { requestId, report };
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      lastErrorReason = err instanceof Error ? err.message : String(err);
      console.warn(`Candidate model ${candidate} failed: ${lastErrorReason}`);
    }
  }

  // If all candidate models fail or rate limit, fall back gracefully to local rule engine
  console.warn(`All AI candidates failed (${lastErrorReason}). Generating report via local clinical engine.`);
  const report = generateRuleBasedReport(
    payload,
    `Generated via local clinical rule engine (${lastErrorReason}).`
  );
  return {
    requestId: `local-${Date.now()}`,
    report,
    fallbackUsed: true,
    fallbackReason: lastErrorReason,
  };
}
