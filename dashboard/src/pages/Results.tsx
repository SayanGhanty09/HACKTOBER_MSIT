import { useContext, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { IntakeContext } from "../contexts/IntakeContext";
import { calculateChronicRisks, type RiskLevel } from "../utils/riskThresholds";
import { computeCholesterolRisk } from "../utils/cholesterolRisk";
import RiskCard from "../components/RiskCard";

interface RiskFactor {
  name: string;
  impact: number;
  type: 'symptom' | 'lifestyle' | 'history' | 'vital' | 'demographic';
}

interface RiskResult {
  disease: string;
  score: number;
  riskLevel: RiskLevel;
  factors: RiskFactor[];
}

export default function Results() {
  const { intake } = useContext(IntakeContext);
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [predictions, setPredictions] = useState<RiskResult[]>([]);
  const [predictionMode, setPredictionMode] = useState<"ml" | "fallback">("fallback");

  // Read latest record from localStorage
  const records = JSON.parse(localStorage.getItem("patient_records") || "[]");
  const latestPatient = records[0] || {};

  const patientName = latestPatient.name || "Patient";
  const patientAge = parseInt(latestPatient.age) || 35;
  const patientGender = latestPatient.gender || "Other";
  const patientLocation = latestPatient.location || "";
  const cholesterolLab = latestPatient.cholesterol || {};
  
  const symptoms = latestPatient.symptoms || intake.symptoms || [];
  const lifestyle = latestPatient.lifestyle || intake.lifestyle || [];
  const familyHistory = latestPatient.familyHistory || intake.familyHistory || [];

  const symptomsStr = JSON.stringify(symptoms);
  const lifestyleStr = JSON.stringify(lifestyle);
  const familyHistoryStr = JSON.stringify(familyHistory);

  useEffect(() => {
    async function fetchMLPredictions() {
      setLoading(true);
      try {
        const mlBase = (import.meta.env.VITE_ML_BASE_URL as string | undefined) ?? 'http://localhost:8000';
        const response = await fetch(`${mlBase}/api/v1/predict`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            age: patientAge,
            sex: patientGender,
            symptoms: symptoms,
            lifestyle: lifestyle,
            familyHistory: familyHistory,
            // Cholesterol lab values from intake form
            total_cholesterol: cholesterolLab.totalChol ?? null,
            ldl:               cholesterolLab.ldl          ?? null,
            hdl:               cholesterolLab.hdl          ?? null,
            triglycerides:     cholesterolLab.triglycerides ?? null,
            bmi:               cholesterolLab.bmi          ?? null,
            hba1c:             cholesterolLab.hba1c        ?? null,
          }),
        });

        if (!response.ok) {
          throw new Error("Backend response error");
        }

        const data = await response.json();
        
        const factorsList: RiskFactor[] = [];
        symptoms.forEach((s: string) => factorsList.push({ name: `Symptom: ${s}`, impact: 0, type: 'symptom' }));
        lifestyle.forEach((l: string) => factorsList.push({ name: `Lifestyle: ${l}`, impact: 0, type: 'lifestyle' }));
        familyHistory.forEach((f: string) => factorsList.push({ name: `Family: ${f}`, impact: 0, type: 'history' }));

        // Always compute cholesterol from lab values using our predictor (most accurate)
        const cholResult = computeCholesterolRisk({
          totalChol:     cholesterolLab.totalChol     ?? null,
          ldl:           cholesterolLab.ldl           ?? null,
          hdl:           cholesterolLab.hdl           ?? null,
          triglycerides: cholesterolLab.triglycerides ?? null,
          bmi:           cholesterolLab.bmi           ?? null,
          hba1c:         cholesterolLab.hba1c         ?? null,
        });

        // Map backend predictions — use cholesterol_predictor result for Cholesterol card
        const mapped: RiskResult[] = [
          {
            disease: "Cholesterol",
            score: Math.round(cholResult.risk * 100),
            riskLevel: cholResult.category,
            factors: factorsList,
          },
          {
            disease: "Heart Disease",
            score: Math.round(data.heart_disease_risk * 100),
            riskLevel: data.heart_disease_category,
            factors: factorsList,
          },
          {
            disease: "Chronic Anemia",
            score: Math.round(data.anaemia_risk * 100),
            riskLevel: data.anaemia_category,
            factors: factorsList,
          },
          {
            disease: "Jaundice",
            score: Math.round(data.jaundice_risk * 100),
            riskLevel: data.jaundice_category,
            factors: factorsList,
          },
        ];

        setPredictions(mapped);
        setPredictionMode("ml");
      } catch (err) {
        console.warn("Could not connect to ML backend, falling back to local estimator:", err);
        // Fallback calculations using rules-based engine
        const fallbackRisks = calculateChronicRisks(
          {},
          { symptoms, lifestyle, familyHistory },
          patientAge,
          patientGender === "male" ? "Male" : patientGender === "female" ? "Female" : "Other"
        );

        // Compute cholesterol from lab values even in fallback mode
        const cholFallback = computeCholesterolRisk({
          totalChol:     cholesterolLab.totalChol     ?? null,
          ldl:           cholesterolLab.ldl           ?? null,
          hdl:           cholesterolLab.hdl           ?? null,
          triglycerides: cholesterolLab.triglycerides ?? null,
          bmi:           cholesterolLab.bmi           ?? null,
          hba1c:         cholesterolLab.hba1c         ?? null,
        });

        const cholCard: RiskResult = {
          disease: "Cholesterol",
          score: Math.round(cholFallback.risk * 100),
          riskLevel: cholFallback.category,
          factors: [],
        };

        // Map fallback levels to RiskResult format — put Cholesterol first
        const mappedFallback: RiskResult[] = [
          cholCard,
          ...fallbackRisks.map(r => ({
            disease: r.disease,
            score: r.score,
            riskLevel: r.riskLevel,
            factors: r.factors,
          }))
        ];
        setPredictions(mappedFallback);
        setPredictionMode("fallback");
      } finally {
        setLoading(false);
      }
    }

    fetchMLPredictions();
  }, [patientAge, patientGender, symptomsStr, lifestyleStr, familyHistoryStr, latestPatient.id]);

  const printPDFReport = () => {
    const win = window.open("", "_blank", "width=800,height=1000");
    if (!win) return;
    
    const predictionsHtml = predictions.map(p => `
      <div class="card">
        <div class="card-header">
          <span class="disease">${p.disease}</span>
          <span class="badge ${p.riskLevel.toLowerCase().replace(" ", "-")}">${p.riskLevel}</span>
        </div>
        <div class="score-row">
          <div class="gauge-container">
            <div class="gauge-bar" style="width: ${p.score}%"></div>
          </div>
          <span class="score">${p.score}%</span>
        </div>
      </div>
    `).join("");

    win.document.write(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>Health Risk Assessment Report - ${patientName}</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
          * { margin:0; padding:0; box-sizing:border-box; }
          body { font-family:'Inter',sans-serif; background:#f8fafc; color:#1e293b; padding:40px; }
          .container { max-width:700px; margin:0 auto; background:#fff; border-radius:16px; padding:48px; box-shadow:0 4px 20px rgba(0,0,0,0.06); }
          .header { border-bottom:2px solid #e2e8f0; padding-bottom:24px; margin-bottom:28px; text-align:center; }
          .logo { font-size:26px; font-weight:700; color:#6366f1; letter-spacing:-0.03em; }
          .subtitle { font-size:13px; color:#64748b; margin-top:4px; }
          h1 { font-size:20px; font-weight:700; color:#1e293b; margin:24px 0 16px; }
          .meta-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; background:#f8fafc; padding:20px; border-radius:12px; margin-bottom:28px; font-size:14px; }
          .meta-item { display:flex; justify-content:space-between; border-bottom:1px solid #e2e8f0; padding-bottom:8px; }
          .meta-item:last-child { border-bottom:none; padding-bottom:0; }
          .meta-label { color:#64748b; }
          .meta-val { font-weight:600; color:#1e293b; }
          .card { border:1px solid #e2e8f0; border-radius:12px; padding:20px; margin-bottom:16px; }
          .card-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; }
          .disease { font-size:16px; font-weight:700; color:#1e293b; }
          .badge { font-size:12px; font-weight:600; padding:4px 12px; border-radius:20px; text-transform:capitalize; }
          .badge.low { background:#f0fdf4; color:#16a34a; border:1px solid #bbf7d0; }
          .badge.moderate { background:#fef9c3; color:#ca8a04; border:1px solid #fef08a; }
          .badge.high { background:#fff1f2; color:#df1c1c; border:1px solid #fecdd3; }
          .badge.very-high { background:#faf5ff; color:#7e22ce; border:1px solid #e9d5ff; }
          .score-row { display:flex; align-items:center; gap:16px; }
          .gauge-container { flex:1; height:10px; background:#f1f5f9; border-radius:5px; overflow:hidden; }
          .gauge-bar { height:100%; background:linear-gradient(90deg, #6366f1, #8b5cf6); border-radius:5px; }
          .score { font-size:16px; font-weight:700; color:#1e293b; width:50px; text-align:right; }
          .input-tags { margin-top:28px; border-top:2px solid #e2e8f0; padding-top:24px; }
          .tags-title { font-size:14px; font-weight:700; color:#1e293b; margin-bottom:10px; }
          .tags-list { display:flex; flex-wrap:wrap; gap:8px; font-size:12px; color:#475569; }
          .tag-pill { background:#f1f5f9; padding:4px 10px; border-radius:6px; }
          .footer { margin-top:40px; text-align:center; font-size:11px; color:#94a3b8; border-top:1px solid #e2e8f0; padding-top:16px; }
          @media print { body { background:#fff; padding:0; } .container { box-shadow:none; } }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">🏥 Anebilin Health Risk Assessment</div>
            <div class="subtitle">AI-Powered Patient Predictive Analytics</div>
          </div>
          <h1>Patient Risk Assessment Report</h1>
          
          <div class="meta-grid">
            <div class="meta-item"><span class="meta-label">Patient Name:</span><span class="meta-val">${patientName}</span></div>
            <div class="meta-item"><span class="meta-label">Age:</span><span class="meta-val">${patientAge} yrs</span></div>
            <div class="meta-item"><span class="meta-label">Gender:</span><span class="meta-val">${patientGender}</span></div>
            <div class="meta-item"><span class="meta-label">Location:</span><span class="meta-val">${patientLocation || 'N/A'}</span></div>
            <div class="meta-item"><span class="meta-label">Assessment Date:</span><span class="meta-val">${new Date().toLocaleDateString('en-IN')}</span></div>
            <div class="meta-item"><span class="meta-label">Model Engine:</span><span class="meta-val">${predictionMode === 'ml' ? 'Trained ML Classifiers (XGBoost/LR)' : 'Rule-Based Estimator'}</span></div>
          </div>

          ${predictionsHtml}

          <div class="input-tags">
            <div class="tags-title">Symptoms & Clinical History Analyzed</div>
            <div class="tags-list">
              ${[...symptoms, ...lifestyle, ...familyHistory].map(t => `<span class="tag-pill">${t}</span>`).join("") || '<span class="tag-pill">No tags recorded</span>'}
            </div>
          </div>

          <div class="footer">
            <p>Confidential Medical Record. Generated by Anebilin Health System.</p>
          </div>
        </div>
      </body>
      </html>
    `);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 600);
  };

  return (
    <div style={{ maxWidth: 720, margin: "40px auto", padding: "0 20px" }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 8, color: "var(--ink)" }}>Patient Risk Profile</h1>
        <p style={{ color: "var(--ink-3)", fontSize: 16 }}>
          Analysis for <strong>{patientName}</strong> ({patientAge} yrs, {patientGender}) {patientLocation && `from ${patientLocation}`}.
        </p>
      </header>

      {/* Mode Indicator Banner */}
      {predictionMode === "ml" ? (
        <div style={{ padding: "12px 16px", borderRadius: 10, background: "rgba(99, 102, 241, 0.1)", border: "1px solid rgba(99, 102, 241, 0.3)", color: "#6366f1", marginBottom: 24, fontSize: 14 }}>
          <strong>✨ Machine Learning Mode Active:</strong> Predictions are generated by the 4 optimized ML models trained on your clinical dataset.
        </div>
      ) : (
        <div style={{ padding: "12px 16px", borderRadius: 10, background: "rgba(245, 158, 11, 0.1)", border: "1px solid rgba(245, 158, 11, 0.3)", color: "#d97706", marginBottom: 24, fontSize: 14 }}>
          <strong>⚠️ Offline Rule-Based Fallback:</strong> ML models are offline. Start your FastAPI server on port 8000 (<code>python medical_api_server.py</code>) to get predictions from the trained classifiers.
        </div>
      )}

      {loading ? (
        <div style={{ padding: "40px 0", textAlign: "center", color: "var(--ink-3)" }}>
          <p style={{ fontSize: 18 }}>Calculating risk scores using clinical classifiers...</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {predictions.map((r) => (
            <RiskCard key={r.disease} result={r} />
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 14, marginTop: 32 }}>
        <button
          onClick={() => navigate("/register")}
          style={{
            padding: "12px 28px",
            borderRadius: 10,
            background: "var(--surface)",
            color: "var(--ink-2)",
            border: "1.5px solid var(--hairline)",
            cursor: "pointer",
            fontWeight: 600,
            transition: "all 0.2s ease"
          }}
        >
          ← Re-enter Intake
        </button>

        <button
          onClick={printPDFReport}
          style={{
            padding: "12px 28px",
            borderRadius: 10,
            background: "linear-gradient(135deg, var(--accent), #8b5cf6)",
            color: "#fff",
            border: "none",
            cursor: "pointer",
            fontWeight: 700,
            boxShadow: "var(--shadow-1)",
            flex: 1,
            textAlign: "center"
          }}
        >
          🖨️ Download PDF Report
        </button>
      </div>
    </div>
  );
}

