import type { LiveReportResult, LiveReportFinding } from '../services/exchangeClient';

// ─────────────────────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────────────────────
export interface ReportBiomarkers {
  spo2?: number | null;
  hr?: number | null;
  hb?: number | null;
  bilirubin?: number | null;
  pi?: number | null;
  sqi?: number | null;
  sdnn?: number | null;
  rmssd?: number | null;
  bpSys?: number | null;
  bpDia?: number | null;
  respRate?: number | null;
  pulseRate?: number | null;
}

export interface ReportPatient {
  id: string;
  name: string;
  age: number;
  sex: string;
  city?: string;
  state?: string;
}

export interface ReportOptions {
  patient: ReportPatient;
  biomarkers: ReportBiomarkers;
  analysisResult: LiveReportResult | null;
  hideBPAndRespiration?: boolean;
  reportType?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────
function fmt(v: number | null | undefined, decimals = 1, fallback = '—'): string {
  if (v == null || isNaN(v as number)) return fallback;
  return (v as number).toFixed(decimals);
}

function statusBadge(status: string): string {
  const colours: Record<string, string> = {
    Normal:       '#16a34a',
    Low:          '#d97706',
    High:         '#dc2626',
    Abnormal:     '#dc2626',
    Borderline:   '#f59e0b',
    'Very High':  '#991b1b',
    'Very Low':   '#1e40af',
  };
  const bg = colours[status] ?? '#6b7280';
  return `<span style="display:inline-block;padding:2px 10px;border-radius:99px;font-size:9pt;font-weight:600;color:#fff;background:${bg};letter-spacing:0.5px;">${status}</span>`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Full professional report HTML  (white page, print-ready A4)
// ─────────────────────────────────────────────────────────────────────────────
export function generateReportHTML(opts: ReportOptions): string {
  const { patient, biomarkers, analysisResult, hideBPAndRespiration = false, reportType = 'Non-Invasive Screening Report' } = opts;

  // ── Biomarker measurement rows ───────────────────────────────────────────
  type BioRow = { label: string; value: string; unit: string; range: string; show?: boolean };
  const rows: BioRow[] = [
    { label: 'SpO₂ (Oxygen Saturation)', value: fmt(biomarkers.spo2, 1),   unit: '%',      range: '≥ 95 %' },
    { label: 'Heart Rate',               value: fmt(biomarkers.hr, 0),      unit: 'bpm',    range: '60 – 100 bpm' },
    { label: 'Hemoglobin',               value: fmt(biomarkers.hb, 2),      unit: 'g/dL',   range: '12 – 18 g/dL' },
    { label: 'Bilirubin',                value: fmt(biomarkers.bilirubin,3), unit: 'mg/dL',  range: '0.2 – 1.2 mg/dL' },
    { label: 'Perfusion Index',          value: fmt(biomarkers.pi, 2),       unit: '%',      range: '0.5 – 20 %' },
    { label: 'Signal Quality Index',     value: biomarkers.sqi != null ? fmt(biomarkers.sqi * 100, 0) : '—', unit: '%', range: '≥ 50 %' },
    { label: 'SDNN (HRV)',               value: fmt(biomarkers.sdnn, 1),     unit: 'ms',     range: '50 – 100 ms' },
    { label: 'RMSSD (HRV)',              value: fmt(biomarkers.rmssd, 1),    unit: 'ms',     range: '20 – 60 ms' },
    { label: 'Systolic Blood Pressure',  value: fmt(biomarkers.bpSys, 0),   unit: 'mmHg',   range: '< 120 mmHg', show: !hideBPAndRespiration },
    { label: 'Diastolic Blood Pressure', value: fmt(biomarkers.bpDia, 0),   unit: 'mmHg',   range: '< 80 mmHg',  show: !hideBPAndRespiration },
    { label: 'Respiration Rate',         value: fmt(biomarkers.respRate, 1), unit: 'br/min', range: '12 – 20 br/min', show: !hideBPAndRespiration },
  ].filter((r) => r.show !== false);

  const oddBg  = '#ffffff';
  const evenBg = '#f8fafc';

  const biomarkersTable = rows.map((r, i) => `
    <tr style="background:${i % 2 === 0 ? oddBg : evenBg};">
      <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b;font-size:10.5pt;">${r.label}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;font-weight:700;font-size:11pt;color:#0f172a;text-align:center;">${r.value}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#64748b;font-size:10pt;text-align:center;">${r.unit}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#64748b;font-size:10pt;text-align:center;">${r.range}</td>
    </tr>`).join('');

  // ── Findings ─────────────────────────────────────────────────────────────
  const findingsHTML = analysisResult?.findings?.length
    ? `
    <div style="margin-top:28px;">
      <h2 style="font-size:13pt;font-weight:700;color:#1e293b;border-bottom:2px solid #e2e8f0;padding-bottom:8px;margin:0 0 4px 0;">Clinical Findings</h2>
      <table style="width:100%;border-collapse:collapse;font-family:'Inter','Segoe UI',Arial,sans-serif;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="text-align:left;padding:9px 14px;font-size:9.5pt;font-weight:600;color:#475569;border-bottom:2px solid #e2e8f0;">Parameter</th>
            <th style="text-align:left;padding:9px 14px;font-size:9.5pt;font-weight:600;color:#475569;border-bottom:2px solid #e2e8f0;">Value</th>
            <th style="text-align:left;padding:9px 14px;font-size:9.5pt;font-weight:600;color:#475569;border-bottom:2px solid #e2e8f0;">Status</th>
            <th style="text-align:left;padding:9px 14px;font-size:9.5pt;font-weight:600;color:#475569;border-bottom:2px solid #e2e8f0;">Interpretation</th>
          </tr>
        </thead>
        <tbody>
          ${analysisResult.findings.map((f: LiveReportFinding, fi: number) => `
            <tr style="background:${fi % 2 === 0 ? oddBg : evenBg};">
              <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b;font-size:10pt;font-weight:600;">${f.parameter}</td>
              <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;font-size:10pt;color:#0f172a;">${f.value}</td>
              <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;">${statusBadge(f.status ?? 'Normal')}</td>
              <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#475569;font-size:10pt;">${f.interpretation}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>` : '';

  // ── Recommendations ───────────────────────────────────────────────────────
  const recommendationsHTML = analysisResult?.recommendations?.length
    ? `
    <div style="margin-top:28px;">
      <h2 style="font-size:13pt;font-weight:700;color:#1e293b;border-bottom:2px solid #e2e8f0;padding-bottom:8px;margin:0 0 12px 0;">Recommendations</h2>
      <ul style="margin:0;padding-left:22px;color:#334155;font-size:10.5pt;line-height:1.9;">
        ${analysisResult.recommendations.map((r: string) => `<li style="margin-bottom:4px;">${r}</li>`).join('')}
      </ul>
    </div>` : '';

  // ── Warnings ─────────────────────────────────────────────────────────────
  const warningsHTML = analysisResult?.warnings?.length
    ? `
    <div style="margin-top:28px;background:#fef2f2;border:1px solid #fecaca;border-left:4px solid #dc2626;border-radius:8px;padding:16px 20px;">
      <div style="font-size:11pt;font-weight:700;color:#b91c1c;margin-bottom:8px;">⚠ Clinical Alerts</div>
      <ul style="margin:0;padding-left:20px;color:#7f1d1d;font-size:10.5pt;line-height:1.8;">
        ${analysisResult.warnings.map((w: string) => `<li>${w}</li>`).join('')}
      </ul>
    </div>` : '';

  // ── Health Score ──────────────────────────────────────────────────────────
  const scoreHTML = analysisResult?.healthScore != null
    ? (() => {
        const s = analysisResult.healthScore;
        const barColor = s >= 7 ? '#16a34a' : s >= 5 ? '#f59e0b' : '#dc2626';
        const label    = s >= 7 ? 'Good'   : s >= 5 ? 'Moderate' : 'Needs Attention';
        return `
        <div style="margin-top:28px;">
          <h2 style="font-size:13pt;font-weight:700;color:#1e293b;border-bottom:2px solid #e2e8f0;padding-bottom:8px;margin:0 0 16px 0;">Overall Health Score</h2>
          <div style="display:flex;align-items:center;gap:28px;">
            <div style="font-size:40pt;font-weight:800;color:${barColor};line-height:1;min-width:80px;">${s}<span style="font-size:16pt;font-weight:500;color:#94a3b8;">/10</span></div>
            <div style="flex:1;">
              <div style="background:#e2e8f0;border-radius:99px;height:14px;overflow:hidden;">
                <div style="height:100%;width:${s * 10}%;background:${barColor};border-radius:99px;"></div>
              </div>
              <div style="margin-top:7px;font-size:10.5pt;color:${barColor};font-weight:600;">${label}</div>
            </div>
          </div>
        </div>`;
      })() : '';

  // ── AI Summary ────────────────────────────────────────────────────────────
  const summaryHTML = analysisResult?.summary
    ? `
    <div style="margin-top:28px;">
      <h2 style="font-size:13pt;font-weight:700;color:#1e293b;border-bottom:2px solid #e2e8f0;padding-bottom:8px;margin:0 0 12px 0;">AI Clinical Summary</h2>
      <p style="color:#334155;font-size:10.5pt;line-height:1.8;margin:0;">${analysisResult.summary}</p>
    </div>` : '';

  // ─────────────────────────────────────────────────────────────────────────
  //  Full document
  // ─────────────────────────────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Anebilin Report – ${patient.name}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'Inter','Segoe UI',Arial,sans-serif;background:#fff;color:#1e293b;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
    @page{size:A4 portrait;margin:16mm 14mm;}
    @media print{body{margin:0;}.no-print{display:none!important;}.page-break{page-break-before:always;}}
  </style>
</head>
<body>
<div style="max-width:740px;margin:0 auto;padding:32px 36px;">

  <!-- HEADER -->
  <div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #0f172a;padding-bottom:16px;margin-bottom:20px;">
    <div>
      <div style="font-size:24pt;font-weight:800;color:#0f172a;letter-spacing:-0.5px;line-height:1;">Anebilin</div>
      <div style="font-size:8.5pt;color:#64748b;margin-top:4px;letter-spacing:1.2px;text-transform:uppercase;font-weight:500;">Non-Invasive Biomarker Screening Device</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:12pt;font-weight:700;color:#0f172a;">${reportType}</div>
    </div>
  </div>

  <!-- PATIENT INFO CARD -->
  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px 20px;margin-bottom:24px;">
    <div style="font-size:8pt;font-weight:700;color:#94a3b8;letter-spacing:1.2px;text-transform:uppercase;margin-bottom:12px;">Patient Information</div>
    <div style="display:flex;flex-wrap:wrap;gap:0 32px;">
      <div style="margin-bottom:8px;min-width:150px;">
        <div style="font-size:8.5pt;color:#94a3b8;margin-bottom:2px;">Full Name</div>
        <div style="font-size:12.5pt;font-weight:700;color:#0f172a;">${patient.name}</div>
      </div>
      <div style="margin-bottom:8px;min-width:80px;">
        <div style="font-size:8.5pt;color:#94a3b8;margin-bottom:2px;">Age</div>
        <div style="font-size:12.5pt;font-weight:700;color:#0f172a;">${patient.age} yrs</div>
      </div>
      <div style="margin-bottom:8px;min-width:80px;">
        <div style="font-size:8.5pt;color:#94a3b8;margin-bottom:2px;">Sex</div>
        <div style="font-size:12.5pt;font-weight:700;color:#0f172a;">${patient.sex}</div>
      </div>
      ${(patient.city || patient.state) ? `
      <div style="margin-bottom:8px;min-width:140px;">
        <div style="font-size:8.5pt;color:#94a3b8;margin-bottom:2px;">Location</div>
        <div style="font-size:11pt;font-weight:600;color:#0f172a;">${[patient.city, patient.state].filter(Boolean).join(', ')}</div>
      </div>` : ''}
      <div style="margin-bottom:8px;">
        <div style="font-size:8.5pt;color:#94a3b8;margin-bottom:2px;">Patient ID</div>
        <div style="font-size:8.5pt;font-weight:500;color:#94a3b8;font-family:monospace;">${patient.id}</div>
      </div>
    </div>
  </div>

  <!-- BIOMARKER MEASUREMENTS -->
  <div>
    <h2 style="font-size:13pt;font-weight:700;color:#1e293b;border-bottom:2px solid #e2e8f0;padding-bottom:8px;margin:0 0 0 0;">Biomarker Measurements</h2>
    <table style="width:100%;border-collapse:collapse;font-family:'Inter','Segoe UI',Arial,sans-serif;">
      <thead>
        <tr style="background:#f8fafc;">
          <th style="text-align:left;padding:9px 14px;font-size:9.5pt;font-weight:600;color:#475569;border-bottom:2px solid #e2e8f0;">Biomarker</th>
          <th style="text-align:center;padding:9px 14px;font-size:9.5pt;font-weight:600;color:#475569;border-bottom:2px solid #e2e8f0;">Result</th>
          <th style="text-align:center;padding:9px 14px;font-size:9.5pt;font-weight:600;color:#475569;border-bottom:2px solid #e2e8f0;">Unit</th>
          <th style="text-align:center;padding:9px 14px;font-size:9.5pt;font-weight:600;color:#475569;border-bottom:2px solid #e2e8f0;">Reference Range</th>
        </tr>
      </thead>
      <tbody>${biomarkersTable}</tbody>
    </table>
  </div>

  ${scoreHTML}
  ${summaryHTML}
  ${findingsHTML}
  ${recommendationsHTML}
  ${warningsHTML}

  <!-- DISCLAIMER -->
  <div style="margin-top:36px;border-top:1px solid #e2e8f0;padding-top:14px;">
    <p style="font-size:8pt;color:#94a3b8;line-height:1.65;text-align:center;">
      <strong style="color:#64748b;">DISCLAIMER:</strong> This report is generated by the Anebilin non-invasive screening device for informational purposes only.
      It does not constitute a medical diagnosis or replace professional clinical evaluation.
      Patients are advised to consult a qualified healthcare professional for any medical concerns.
      Results are based on photoplethysmography (PPG) and spectral analysis; accuracy may vary with individual physiology.
    </p>
  </div>

  <!-- FOOTER -->
  <div style="margin-top:18px;display:flex;justify-content:space-between;align-items:center;font-size:8pt;color:#cbd5e1;border-top:1px solid #f1f5f9;padding-top:10px;">
    <span>Anebilin Spectru · Non-Invasive Health Screening</span>
  </div>

</div>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Opens the report in a new window and triggers the browser print dialog
// ─────────────────────────────────────────────────────────────────────────────
export function printReport(opts: ReportOptions): void {
  const html = generateReportHTML(opts);
  const win = window.open('', '_blank', 'width=900,height=1100');
  if (!win) {
    alert('Pop-up blocked. Please allow pop-ups for this site to generate the PDF report.');
    return;
  }
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 700);
}
