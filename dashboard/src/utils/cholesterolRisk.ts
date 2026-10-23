export interface CholesterolRiskInput {
  totalChol: number | string | null | undefined;
  ldl: number | string | null | undefined;
  hdl: number | string | null | undefined;
  triglycerides: number | string | null | undefined;
  bmi: number | string | null | undefined;
  hba1c: number | string | null | undefined;
}

export interface CholesterolRiskResult {
  risk: number;
  category: 'Low' | 'Moderate' | 'High' | 'Very High';
}

const REFERENCE_ROWS = [
  [158, 82, 62, 92, 21.8, 5.1, 0.05], [172, 95, 58, 108, 22.7, 5.2, 0.08],
  [181, 105, 54, 120, 23.5, 5.3, 0.12], [190, 112, 51, 135, 24.2, 5.4, 0.18],
  [198, 120, 48, 145, 25.1, 5.5, 0.25], [207, 128, 45, 158, 26.0, 5.6, 0.32],
  [215, 135, 44, 170, 26.8, 5.7, 0.39], [222, 142, 42, 182, 27.4, 5.8, 0.46],
  [230, 150, 40, 195, 28.1, 5.9, 0.54], [235, 155, 39, 205, 28.7, 6.0, 0.61],
  [242, 160, 38, 215, 29.2, 6.1, 0.68], [248, 168, 37, 225, 29.8, 6.2, 0.74],
  [255, 175, 36, 235, 30.4, 6.3, 0.79], [262, 182, 35, 245, 30.9, 6.4, 0.83],
  [270, 190, 34, 255, 31.5, 6.5, 0.87], [278, 198, 33, 275, 32.1, 6.6, 0.90],
  [285, 205, 32, 290, 32.8, 6.7, 0.93], [295, 218, 30, 310, 33.5, 6.9, 0.96],
  [305, 230, 28, 335, 34.2, 7.1, 0.98], [320, 245, 26, 365, 35.0, 7.4, 0.99],
] as const;

const RANGES = {
  totalChol: [158, 320], ldl: [82, 245], hdl: [26, 62],
  triglycerides: [92, 365], bmi: [21.8, 35.0], hba1c: [5.1, 7.4],
} as const;

const WEIGHTS = { totalChol: 0.20, ldl: 0.25, hdl: 0.20, triglycerides: 0.15, bmi: 0.10, hba1c: 0.10 } as const;

const toNumber = (value: number | string | null | undefined) =>
  typeof value === 'number' ? value : Number(value);

const normalize = (value: number, [low, high]: readonly [number, number], inverse = false) => {
  const normalized = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return inverse ? 1 - normalized : normalized;
};

const compositeScore = (values: number[]) =>
  WEIGHTS.totalChol * normalize(values[0], RANGES.totalChol) +
  WEIGHTS.ldl * normalize(values[1], RANGES.ldl) +
  WEIGHTS.hdl * normalize(values[2], RANGES.hdl, true) +
  WEIGHTS.triglycerides * normalize(values[3], RANGES.triglycerides) +
  WEIGHTS.bmi * normalize(values[4], RANGES.bmi) +
  WEIGHTS.hba1c * normalize(values[5], RANGES.hba1c);

export function computeCholesterolRisk(input: CholesterolRiskInput): CholesterolRiskResult {
  const values = [input.totalChol, input.ldl, input.hdl, input.triglycerides, input.bmi, input.hba1c].map(toNumber);
  const risk = values.every(Number.isFinite) ? interpolateRisk(compositeScore(values)) : 0.1;
  const category = risk < 0.30 ? 'Low' : risk < 0.60 ? 'Moderate' : risk < 0.84 ? 'High' : 'Very High';
  return { risk, category };
}

function interpolateRisk(inputScore: number): number {
  const sorted = REFERENCE_ROWS.map((row) => ({ score: compositeScore(row.slice(0, 6)), risk: row[6] }))
    .sort((a, b) => a.score - b.score);

  if (inputScore <= sorted[0].score) return sorted[0].risk;
  if (inputScore >= sorted[sorted.length - 1].score) return sorted[sorted.length - 1].risk;

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const lower = sorted[index];
    const upper = sorted[index + 1];
    if (inputScore <= upper.score) {
      const ratio = (inputScore - lower.score) / (upper.score - lower.score);
      return Number((lower.risk + ratio * (upper.risk - lower.risk)).toFixed(2));
    }
  }

  return sorted[sorted.length - 1].risk;
}