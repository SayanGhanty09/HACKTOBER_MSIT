// Clinical risk-band definitions for the Hemoglobin (anemia) and Bilirubin
// (jaundice) gauges. Thresholds are cutoffs supplied by the clinical owner of
// this project, not derived from the sensor — they only classify a value the
// BiomarkerEngine has already produced.

export type RiskTone = 'success' | 'warn' | 'error';

export interface RiskZone {
  /** Upper bound of this zone (inclusive), in the scale's unit. */
  to: number;
  tone: RiskTone;
  label: string;
}

export interface RiskScale {
  min: number;
  max: number;
  unit: string;
  /** Ascending by `to`; the last zone's `to` must equal `max`. */
  zones: RiskZone[];
}

/**
 * Anemia thresholds (total hemoglobin):
 *   Male:   >= 12.5 g/dL normal, below is anemia.
 *   Female: >= 12.0 g/dL normal, 11.5-12.0 g/dL borderline/mild, below 11.5 anemia.
 * 'Other' defaults to the female range — the more conservative (sensitive) of
 * the two, so borderline cases aren't missed when sex-specific data is absent.
 */
export function getHemoglobinScale(sex: 'Male' | 'Female' | 'Other'): RiskScale {
  if (sex === 'Male') {
    return {
      min: 5, max: 20, unit: 'g/dL',
      zones: [
        { to: 12.5, tone: 'error', label: 'Anemia' },
        { to: 20, tone: 'success', label: 'Normal' },
      ],
    };
  }
  return {
    min: 5, max: 20, unit: 'g/dL',
    zones: [
      { to: 11.5, tone: 'error', label: 'Anemia' },
      { to: 12.0, tone: 'warn', label: 'Mild' },
      { to: 20, tone: 'success', label: 'Normal' },
    ],
  };
}

export function hemoglobinReferenceLabel(sex: 'Male' | 'Female' | 'Other'): string {
  return sex === 'Male' ? 'Male reference range' : sex === 'Female' ? 'Female reference range' : 'Standard adult reference range';
}

/**
 * Jaundice thresholds (total bilirubin):
 *   0.2-1.2 mg/dL normal, 1.2-2.0 mild (borderline — clinical follow-up),
 *   2.0-3.0+ confirmed jaundice.
 */
export const BILIRUBIN_SCALE: RiskScale = {
  min: 0, max: 6, unit: 'mg/dL',
  zones: [
    { to: 1.2, tone: 'success', label: 'Normal' },
    { to: 2.0, tone: 'warn', label: 'Mild' },
    { to: 6, tone: 'error', label: 'Jaundice' },
  ],
};

export function classify(value: number, scale: RiskScale): RiskZone {
  for (const z of scale.zones) if (value <= z.to) return z;
  return scale.zones[scale.zones.length - 1];
}

/**
 * A continuous risk probability (0-100%), for display once a scan completes.
 * The discrete zones (Normal/Mild/Anemia etc.) are a clean read at a glance,
 * but "how close is this to crossing the line" needs a smooth estimate —
 * this is a logistic curve centered on the ambiguous middle ("Mild"/"warn")
 * zone: its own boundaries land at roughly 12% and 88%, so the borderline
 * band reads as genuinely uncertain, saturating toward 0%/100% outside it.
 * Scales with no middle zone (e.g. the male hemoglobin cutoff) anchor on the
 * hard boundary instead, with a default transition width (8% of the scale's
 * domain) standing in for the missing borderline band.
 *
 * This is a modeled estimate for screening display, not a lab-validated
 * probability — always pair it with the disclaimer already shown in the UI.
 */
export function riskProbabilityPercent(value: number, scale: RiskScale): number {
  const { zones, min, max } = scale;
  const successIdx = zones.findIndex((z) => z.tone === 'success');
  const increasingRisk = successIdx === 0; // success zone first => higher value = more risk
  const warnIdx = zones.findIndex((z) => z.tone === 'warn');

  let anchor: number;
  let width: number;
  if (warnIdx >= 0) {
    const from = warnIdx > 0 ? zones[warnIdx - 1].to : min;
    const to = zones[warnIdx].to;
    anchor = (from + to) / 2;
    width = Math.max((to - from) / 2, 1e-6);
  } else {
    anchor = zones[0].to;
    width = (max - min) * 0.08;
  }

  const STEEPNESS = 2; // tuned so the ambiguous zone's own edges land near 12%/88%
  const z = increasingRisk ? ((value - anchor) / width) * STEEPNESS : ((anchor - value) / width) * STEEPNESS;
  const p = 1 / (1 + Math.exp(-z));
  return Math.round(p * 100);
}

export interface ChronicRiskFactor {
  name: string;
  impact: number; // percentage impact contribution (approximate display value)
  type: 'symptom' | 'lifestyle' | 'history' | 'vital' | 'demographic';
}

export type RiskLevel = 'Low' | 'Moderate' | 'Medium' | 'High' | 'Very High';

export interface ChronicRiskResult {
  disease: string;
  score: number; // 0-100%
  riskLevel: RiskLevel;
  factors: ChronicRiskFactor[];
}

export interface IntakeData {
  symptoms: string[];       // e.g. 'polyuria', 'fatigue', 'chest_pain', 'dizziness', 'headaches', 'shortness_of_breath', 'excessive_thirst'
  lifestyle: string[];      // e.g. 'smoking', 'sedentary', 'high_sodium', 'poor_diet'
  familyHistory: string[];  // e.g. 'diabetes', 'hypertension', 'cvd'
}

/**
 * Calculates early-stage risk of chronic diseases from symptoms, lifestyle, history and vitals.
 * Provides a fully explainable list of contributing factors for health workers.
 */
export function calculateChronicRisks(
  biomarkers: Record<string, number | undefined>,
  intake: IntakeData,
  age: number,
  sex: 'Male' | 'Female' | 'Other'
): ChronicRiskResult[] {
  const results: ChronicRiskResult[] = [];

  // ==========================================
  // 1. DIABETES RISK CALCULATOR
  // ==========================================
  let dbScore = 0;
  const dbFactors: ChronicRiskFactor[] = [];

  // Demographic inputs
  if (age > 45) {
    dbScore += 12;
    dbFactors.push({ name: 'Age over 45', impact: 12, type: 'demographic' });
  } else if (age > 35) {
    dbScore += 6;
    dbFactors.push({ name: 'Age over 35', impact: 6, type: 'demographic' });
  }

  // Symptoms
  if (intake.symptoms.includes('polyuria')) {
    dbScore += 18;
    dbFactors.push({ name: 'Frequent Urination (Polyuria)', impact: 18, type: 'symptom' });
  }
  if (intake.symptoms.includes('excessive_thirst')) {
    dbScore += 18;
    dbFactors.push({ name: 'Excessive Thirst (Polydipsia)', impact: 18, type: 'symptom' });
  }
  if (intake.symptoms.includes('fatigue')) {
    dbScore += 8;
    dbFactors.push({ name: 'Unexplained Fatigue', impact: 8, type: 'symptom' });
  }

  // Family History
  if (intake.familyHistory.includes('diabetes')) {
    dbScore += 22;
    dbFactors.push({ name: 'Family History of Diabetes', impact: 22, type: 'history' });
  }

  // Lifestyle
  if (intake.lifestyle.includes('sedentary')) {
    dbScore += 12;
    dbFactors.push({ name: 'Sedentary Lifestyle', impact: 12, type: 'lifestyle' });
  }
  if (intake.lifestyle.includes('poor_diet')) {
    dbScore += 10;
    dbFactors.push({ name: 'High Sugar/Processed Diet', impact: 10, type: 'lifestyle' });
  }

  // Vitals Correlation
  if (biomarkers.sdnn !== undefined && biomarkers.sdnn < 30) {
    dbScore += 15;
    dbFactors.push({ name: 'Reduced Heart Rate Variability (SDNN < 30ms)', impact: 15, type: 'vital' });
  }

  // Normalization & Level Classification
  dbScore = Math.min(Math.max(dbScore, 0), 100);
  results.push({
    disease: 'Diabetes Mellitus',
    score: dbScore,
    riskLevel: dbScore >= 60 ? 'High' : dbScore >= 30 ? 'Medium' : 'Low',
    factors: dbFactors
  });

  // ==========================================
  // 2. HYPERTENSION RISK CALCULATOR
  // ==========================================
  let htScore = 0;
  const htFactors: ChronicRiskFactor[] = [];

  // Vitals inputs (BP is primary)
  const sys = biomarkers.bpSys ?? biomarkers.systolicBP;
  const dia = biomarkers.bpDia ?? biomarkers.diastolicBP;

  if (sys !== undefined && dia !== undefined) {
    if (sys >= 140 || dia >= 90) {
      htScore += 65;
      htFactors.push({ name: `Hypertensive Vitals (${Math.round(sys)}/${Math.round(dia)} mmHg)`, impact: 65, type: 'vital' });
    } else if (sys >= 120 || dia >= 80) {
      htScore += 30;
      htFactors.push({ name: `Elevated Blood Pressure (${Math.round(sys)}/${Math.round(dia)} mmHg)`, impact: 30, type: 'vital' });
    } else {
      htScore += 0; // normal vital baseline
    }
  }

  // Demographic
  if (age > 55) {
    htScore += 15;
    htFactors.push({ name: 'Age over 55', impact: 15, type: 'demographic' });
  } else if (age > 40) {
    htScore += 8;
    htFactors.push({ name: 'Age over 40', impact: 8, type: 'demographic' });
  }

  // Symptoms
  if (intake.symptoms.includes('headaches')) {
    htScore += 10;
    htFactors.push({ name: 'Frequent Headaches', impact: 10, type: 'symptom' });
  }
  if (intake.symptoms.includes('dizziness')) {
    htScore += 10;
    htFactors.push({ name: 'Dizziness or Vertigo', impact: 10, type: 'symptom' });
  }

  // Family History
  if (intake.familyHistory.includes('hypertension')) {
    htScore += 18;
    htFactors.push({ name: 'Family History of Hypertension', impact: 18, type: 'history' });
  }

  // Lifestyle
  if (intake.lifestyle.includes('smoking')) {
    htScore += 15;
    htFactors.push({ name: 'Active Smoker', impact: 15, type: 'lifestyle' });
  }
  if (intake.lifestyle.includes('high_sodium')) {
    htScore += 12;
    htFactors.push({ name: 'High Sodium Intake', impact: 12, type: 'lifestyle' });
  }

  htScore = Math.min(Math.max(htScore, 0), 100);
  results.push({
    disease: 'Hypertension',
    score: htScore,
    riskLevel: htScore >= 60 ? 'High' : htScore >= 30 ? 'Medium' : 'Low',
    factors: htFactors
  });

  // ==========================================
  // 3. CARDIOVASCULAR DISEASE (CVD) RISK
  // ==========================================
  let cvdScore = 0;
  const cvdFactors: ChronicRiskFactor[] = [];

  // Age & Sex
  if (age > 55) {
    cvdScore += 18;
    cvdFactors.push({ name: 'Age over 55', impact: 18, type: 'demographic' });
  } else if (age > 40) {
    cvdScore += 8;
    cvdFactors.push({ name: 'Age over 40', impact: 8, type: 'demographic' });
  }
  if (sex === 'Male') {
    cvdScore += 8;
    cvdFactors.push({ name: 'Male Demographics', impact: 8, type: 'demographic' });
  }

  // Symptoms
  if (intake.symptoms.includes('chest_pain')) {
    cvdScore += 25;
    cvdFactors.push({ name: 'Angina or Chest Discomfort', impact: 25, type: 'symptom' });
  }
  if (intake.symptoms.includes('shortness_of_breath')) {
    cvdScore += 18;
    cvdFactors.push({ name: 'Shortness of Breath (Dyspnea)', impact: 18, type: 'symptom' });
  }

  // Vitals Check
  if (sys !== undefined && (sys >= 140 || (dia !== undefined && dia >= 90))) {
    cvdScore += 20;
    cvdFactors.push({ name: 'Uncontrolled Hypertension', impact: 20, type: 'vital' });
  }
  if (biomarkers.spo2 !== undefined && biomarkers.spo2 < 95) {
    cvdScore += 15;
    cvdFactors.push({ name: `Low Blood Oxygen Saturation (${biomarkers.spo2.toFixed(1)}%)`, impact: 15, type: 'vital' });
  }
  if (biomarkers.sdnn !== undefined && biomarkers.sdnn < 35) {
    cvdScore += 15;
    cvdFactors.push({ name: 'Low Autonomic Regulation (SDNN < 35ms)', impact: 15, type: 'vital' });
  }
  if (biomarkers.hr !== undefined && (biomarkers.hr > 100 || biomarkers.hr < 50)) {
    cvdScore += 10;
    cvdFactors.push({ name: `Irregular Vital Heart Rate (${biomarkers.hr.toFixed(0)} bpm)`, impact: 10, type: 'vital' });
  }

  // Family History
  if (intake.familyHistory.includes('cvd')) {
    cvdScore += 22;
    cvdFactors.push({ name: 'Family History of Heart Attack/CVD', impact: 22, type: 'history' });
  }

  // Lifestyle
  if (intake.lifestyle.includes('smoking')) {
    cvdScore += 22;
    cvdFactors.push({ name: 'Active Tobacco Usage', impact: 22, type: 'lifestyle' });
  }
  if (intake.lifestyle.includes('sedentary')) {
    cvdScore += 8;
    cvdFactors.push({ name: 'Sedentary Lifestyle', impact: 8, type: 'lifestyle' });
  }

  cvdScore = Math.min(Math.max(cvdScore, 0), 100);
  results.push({
    disease: 'Cardiovascular Disease',
    score: cvdScore,
    riskLevel: cvdScore >= 60 ? 'High' : cvdScore >= 30 ? 'Medium' : 'Low',
    factors: cvdFactors
  });

  // ==========================================
  // 4. ANEMIA RISK CALCULATOR (Iron Deficiency / Low Hb)
  // ==========================================
  let anScore = 0;
  const anFactors: ChronicRiskFactor[] = [];

  // Primary vital is Hemoglobin (Hb)
  const hb = biomarkers.hb;
  if (hb !== undefined) {
    const scale = getHemoglobinScale(sex);
    const classification = classify(hb, scale);
    if (classification.tone === 'error') {
      anScore += 75;
      anFactors.push({ name: `Severely Low Hemoglobin (${hb.toFixed(2)} g/dL)`, impact: 75, type: 'vital' });
    } else if (classification.tone === 'warn') {
      anScore += 35;
      anFactors.push({ name: `Borderline Low Hemoglobin (${hb.toFixed(2)} g/dL)`, impact: 35, type: 'vital' });
    }
  }

  // Symptoms
  if (intake.symptoms.includes('fatigue')) {
    anScore += 15;
    anFactors.push({ name: 'Persistent Fatigue', impact: 15, type: 'symptom' });
  }
  if (intake.symptoms.includes('dizziness')) {
    anScore += 10;
    anFactors.push({ name: 'Dizziness or Lightheadedness', impact: 10, type: 'symptom' });
  }
  if (intake.symptoms.includes('shortness_of_breath')) {
    anScore += 10;
    anFactors.push({ name: 'Shortness of Breath on Exertion', impact: 10, type: 'symptom' });
  }

  // Demographic
  if (sex === 'Female') {
    anScore += 10;
    anFactors.push({ name: 'Female Demographics (Elevated Risk)', impact: 10, type: 'demographic' });
  }

  // Lifestyle
  if (intake.lifestyle.includes('poor_diet')) {
    anScore += 12;
    anFactors.push({ name: 'Iron-Deficient Nutritional Intake', impact: 12, type: 'lifestyle' });
  }

  anScore = Math.min(Math.max(anScore, 0), 100);
  results.push({
    disease: 'Chronic Anemia',
    score: anScore,
    riskLevel: anScore >= 60 ? 'High' : anScore >= 30 ? 'Medium' : 'Low',
    factors: anFactors
  });

  return results;
}

