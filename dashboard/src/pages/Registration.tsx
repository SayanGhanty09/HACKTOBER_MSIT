// src/pages/Registration.tsx
import React, { useState, useEffect, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { IntakeContext } from "../contexts/IntakeContext";
import { useTranslation } from "../utils/useTranslation";
import { TagInput } from "../components/TagInput";
import { Trash2, FolderOpen, User, Calendar, MapPin, Activity } from "lucide-react";

export default function Registration() {
  const { t } = useTranslation();
  const { setIntake } = useContext(IntakeContext);
  const navigate = useNavigate();

  // Basic patient information
  const [name, setName] = useState<string>("");
  const [age, setAge] = useState<string>("");
  const [gender, setGender] = useState<string>("");
  const [location, setLocation] = useState<string>("");

  // Dynamic intake fields
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [lifestyle, setLifestyle] = useState<string[]>([]);
  const [familyHistory, setFamilyHistory] = useState<string[]>([]);

  // Cholesterol lab values (passed to ML model on submit)
  const [cholFields, setCholFields] = useState({ totalChol: '', ldl: '', hdl: '', triglycerides: '', bmi: '', hba1c: '' });

  // History of submitted records (loaded from localStorage)
  const [history, setHistory] = useState<Array<any>>([]);

  // Load any existing history on component mount
  useEffect(() => {
    const saved = localStorage.getItem("patient_records");
    if (saved) {
      try {
        setHistory(JSON.parse(saved));
      } catch (_) {}
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const record = { 
      id: Date.now().toString(),
      name: name.trim(), 
      age: age.trim(), 
      gender, 
      location: location.trim(), 
      symptoms, 
      lifestyle, 
      familyHistory,
      // Cholesterol lab values — forwarded to ML model on Results page
      cholesterol: {
        totalChol:     cholFields.totalChol     ? parseFloat(cholFields.totalChol)     : null,
        ldl:           cholFields.ldl           ? parseFloat(cholFields.ldl)           : null,
        hdl:           cholFields.hdl           ? parseFloat(cholFields.hdl)           : null,
        triglycerides: cholFields.triglycerides ? parseFloat(cholFields.triglycerides) : null,
        bmi:           cholFields.bmi           ? parseFloat(cholFields.bmi)           : null,
        hba1c:         cholFields.hba1c         ? parseFloat(cholFields.hba1c)         : null,
      },
      timestamp: new Date().toLocaleDateString()
    };
    
    // Update intake context
    setIntake({ symptoms, lifestyle, familyHistory });
    
    // Persist the new record at the front of the history array
    const updated = [record, ...history];
    localStorage.setItem("patient_records", JSON.stringify(updated));
    setHistory(updated);
    
    // Reset form fields for next entry
    setName("");
    setAge("");
    setGender("");
    setLocation("");
    setSymptoms([]);
    setLifestyle([]);
    setFamilyHistory([]);
    setCholFields({ totalChol: '', ldl: '', hdl: '', triglycerides: '', bmi: '', hba1c: '' });
    
    // Navigate to results page
    navigate("/results");
  };

  const handleDeleteRecord = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm("Are you sure you want to delete this patient record?")) {
      const updated = history.filter(rec => rec.id !== id);
      localStorage.setItem("patient_records", JSON.stringify(updated));
      setHistory(updated);
    }
  };

  const handleLoadRecord = (rec: any) => {
    setName(rec.name);
    setAge(rec.age);
    setGender(rec.gender);
    setLocation(rec.location);
    setSymptoms(rec.symptoms || []);
    setLifestyle(rec.lifestyle || []);
    setFamilyHistory(rec.familyHistory || []);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const downloadPatientHistory = () => {
    if (history.length === 0) return;
    const win = window.open("", "_blank", "width=800,height=1000");
    if (!win) return;
    const rows = history.map(rec => `
      <tr>
        <td class="row"><span class="avatar">${rec.name ? rec.name.charAt(0).toUpperCase() : '?'}</span> <strong>${rec.name || '—'}</strong></td>
        <td class="row">${rec.age || '—'}</td>
        <td class="row">${rec.gender || '—'}</td>
        <td class="row">${rec.location || '—'}</td>
        <td class="row">${rec.symptoms?.join(", ") || 'None'}</td>
        <td class="row">${rec.lifestyle?.join(", ") || 'None'}</td>
        <td class="row">${rec.familyHistory?.join(", ") || 'None'}</td>
        <td class="row">${rec.timestamp || '—'}</td>
      </tr>
    `).join("");
    win.document.write(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>Patient History Report - Anebilin</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
          * { margin:0; padding:0; box-sizing:border-box; }
          body { font-family:'Inter',sans-serif; background:#f8fafc; color:#1e293b; padding:32px; }
          .header { text-align:center; margin-bottom:36px; padding-bottom:24px; border-bottom:2px solid #e2e8f0; }
          .logo { font-size:26px; font-weight:700; color:#6366f1; letter-spacing:-0.03em; margin-bottom:4px; }
          .subtitle { font-size:13px; color:#64748b; }
          h1 { font-size:20px; font-weight:700; color:#1e293b; margin-bottom:6px; }
          .meta { font-size:12px; color:#94a3b8; margin-bottom:24px; }
          table { width:100%; border-collapse:collapse; font-size:12px; background:#fff; border-radius:10px; overflow:hidden; box-shadow:0 1px 8px rgba(0,0,0,0.06); }
          th { background:linear-gradient(135deg,#6366f1,#8b5cf6); color:#fff; padding:12px 14px; text-align:left; font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:0.05em; }
          td.row { padding:11px 14px; border-bottom:1px solid #f1f5f9; vertical-align:top; color:#334155; }
          tr:last-child td.row { border-bottom:none; }
          tr:nth-child(even) { background:#f8fafc; }
          .avatar { display:inline-flex; width:22px; height:22px; border-radius:50%; background:linear-gradient(135deg,#6366f1,#8b5cf6); color:#fff; align-items:center; justify-content:center; font-size:10px; font-weight:700; margin-right:6px; vertical-align:middle; }
          .footer { margin-top:32px; text-align:center; font-size:11px; color:#94a3b8; }
          @media print { body { background:#fff; padding:16px; } table { box-shadow:none; } }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="logo">🏥 Anebilin Health</div>
          <div class="subtitle">AI-Powered Rural Patient Management System</div>
        </div>
        <h1>Patient History Report</h1>
        <div class="meta">Total Records: ${history.length} &nbsp;·&nbsp; Generated: ${new Date().toLocaleDateString('en-IN', {day:'2-digit',month:'long',year:'numeric'})}</div>
        <table>
          <thead>
            <tr>
              <th>Patient Name</th>
              <th>Age</th>
              <th>Gender</th>
              <th>Location</th>
              <th>Symptoms</th>
              <th>Lifestyle</th>
              <th>Family History</th>
              <th>Recorded On</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="footer">
          <p>Confidential medical record — for authorised healthcare personnel only.</p>
          <p style="margin-top:4px;">© ${new Date().getFullYear()} Anebilin Health Platform</p>
        </div>
      </body>
      </html>
    `);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 600);
  };

  // Keywords suggestions matching backend feature mapping keys
  const symptomsSuggestions = [
    "chest_pain", "fatigue", "dizziness", "shortness_of_breath", 
    "abdominal_pain", "nausea", "pale_skin", "yellow_eyes", 
    "dark_urine", "pale_stool"
  ];
  const lifestyleSuggestions = ["smoking", "alcohol", "sedentary", "poor_diet", "low_iron"];
  const familySuggestions = [
    "high_cholesterol", "heart_disease", "anaemia", 
    "jaundice", "diabetes", "hypertension"
  ];

  return (
    <div style={{ maxWidth: 840, margin: "40px auto", padding: "0 20px", fontFamily: "inherit" }}>
      {/* Header card */}
      <div style={{ 
        background: "linear-gradient(135deg, rgba(99, 102, 241, 0.05), rgba(139, 92, 246, 0.05))", 
        border: "1px solid var(--hairline)", 
        borderRadius: "var(--r-3)", 
        padding: "32px", 
        marginBottom: "32px",
        boxShadow: "var(--shadow-pop)",
        backdropFilter: "blur(8px)"
      }}>
        <h1 style={{ 
          fontFamily: "var(--font-display)", 
          fontSize: "36px", 
          fontWeight: 600, 
          letterSpacing: "-0.022em", 
          marginBottom: "12px", 
          color: "var(--ink)" 
        }}>
          {t('patientIntake') ?? 'Patient Intake'}
        </h1>
        <p style={{ color: "var(--ink-3)", fontSize: "16px", maxWidth: "60ch", lineHeight: 1.6 }}>
          Register a new patient or load an existing profile to analyze chronic health risk factors with our trained ML classifiers.
        </p>
      </div>

      {/* Main Intake Form */}
      <div style={{ 
        background: "var(--paper)", 
        border: "1px solid var(--hairline)", 
        borderRadius: "var(--r-3)", 
        padding: "32px", 
        boxShadow: "var(--shadow-pop)",
        marginBottom: "40px"
      }}>
        <form onSubmit={handleSubmit}>
          <h2 style={{ fontSize: "20px", fontWeight: 600, marginBottom: "20px", color: "var(--ink)", display: "flex", alignItems: "center", gap: 8 }}>
            <User size={18} color="var(--accent)" /> Demographics
          </h2>
          
          {/* Basic demographic fields */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 32 }}>
            <div style={{ position: "relative" }}>
              <input 
                type="text" 
                placeholder="Name" 
                value={name} 
                onChange={(e) => setName(e.target.value)} 
                required 
                style={{ 
                  width: "100%",
                  padding: "12px 14px", 
                  borderRadius: 8, 
                  border: "1px solid var(--hairline)", 
                  background: "var(--surface)",
                  color: "var(--ink)",
                  boxSizing: "border-box",
                  outline: "none",
                  fontSize: "16px"
                }} 
              />
            </div>
            
            <div style={{ position: "relative" }}>
              <input 
                type="number" 
                placeholder="Age" 
                value={age} 
                onChange={(e) => setAge(e.target.value)} 
                required 
                style={{ 
                  width: "100%",
                  padding: "12px 14px", 
                  borderRadius: 8, 
                  border: "1px solid var(--hairline)", 
                  background: "var(--surface)",
                  color: "var(--ink)",
                  boxSizing: "border-box",
                  outline: "none",
                  fontSize: "16px"
                }} 
              />
            </div>

            <div style={{ position: "relative" }}>
              <select 
                value={gender} 
                onChange={(e) => setGender(e.target.value)} 
                required 
                style={{ 
                  width: "100%",
                  padding: "12px 14px", 
                  borderRadius: 8, 
                  border: "1px solid var(--hairline)", 
                  background: "var(--surface)",
                  color: "var(--ink)",
                  boxSizing: "border-box",
                  outline: "none",
                  fontSize: "16px",
                  cursor: "pointer"
                }}
              >
                <option value="">Gender</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div style={{ position: "relative" }}>
              <input 
                type="text" 
                placeholder="Location" 
                value={location} 
                onChange={(e) => setLocation(e.target.value)} 
                required 
                style={{ 
                  width: "100%",
                  padding: "12px 14px", 
                  borderRadius: 8, 
                  border: "1px solid var(--hairline)", 
                  background: "var(--surface)",
                  color: "var(--ink)",
                  boxSizing: "border-box",
                  outline: "none",
                  fontSize: "16px"
                }} 
              />
            </div>
          </div>

          <h2 style={{ fontSize: "20px", fontWeight: 600, marginBottom: "20px", color: "var(--ink)", display: "flex", alignItems: "center", gap: 8, borderTop: "1px solid var(--hairline)", paddingTop: "24px" }}>
            <Activity size={18} color="var(--accent)" /> Clinical Indicators
          </h2>

          {/* Tag based dynamic inputs with keyword preset suggestions */}
          <TagInput 
            label={t('symptoms') ?? 'Symptoms'} 
            placeholder="Type symptoms and press Enter" 
            values={symptoms} 
            setValues={setSymptoms} 
            presetSuggestions={symptomsSuggestions}
          />
          
          <TagInput 
            label={t('lifestyle') ?? 'Lifestyle Factors'} 
            placeholder="Type lifestyle habits and press Enter" 
            values={lifestyle} 
            setValues={setLifestyle} 
            presetSuggestions={lifestyleSuggestions}
          />
          
          <TagInput 
            label={t('familyHistory') ?? 'Family Clinical History'} 
            placeholder="Type hereditary history and press Enter" 
            values={familyHistory} 
            setValues={setFamilyHistory} 
            presetSuggestions={familySuggestions}
          />

          {/* ── Cholesterol Lab Values ── */}
          <div style={{ marginTop: 8 }}>
            <h3 style={{
              fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginBottom: 6,
              display: 'flex', alignItems: 'center', gap: 8
            }}>
              <span style={{
                background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
                borderRadius: 6, padding: '2px 8px', fontSize: 11,
                color: '#fff', fontWeight: 700, letterSpacing: '0.05em'
              }}>LAB</span>
              Cholesterol Lab Values
              <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--ink-3)', marginLeft: 4 }}>(optional — used for risk prediction)</span>
            </h3>
            
            <div style={{ 
              fontSize: '13px', 
              color: 'var(--ink-3)', 
              background: 'rgba(99, 102, 241, 0.05)', 
              borderLeft: '3px solid var(--accent)', 
              padding: '8px 12px', 
              borderRadius: '0 6px 6px 0',
              marginBottom: '14px',
              fontWeight: 500
            }}>
              <strong>Note:</strong> Entered readings must be obtained from an authorized laboratory.
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: 12,
            }}>
              {([
                { key: 'totalChol',     label: 'Total Cholesterol', unit: 'mg/dL' },
                { key: 'ldl',           label: 'LDL',               unit: 'mg/dL' },
                { key: 'hdl',           label: 'HDL',               unit: 'mg/dL' },
                { key: 'triglycerides', label: 'Triglycerides',     unit: 'mg/dL' },
                { key: 'bmi',           label: 'BMI',               unit: 'kg/m²' },
                { key: 'hba1c',         label: 'HbA1c',             unit: '%'     },
              ] as const).map(({ key, label, unit }) => (
                <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label style={{
                    fontSize: 12, fontWeight: 650, color: 'var(--ink-3)',
                    textTransform: 'uppercase', letterSpacing: '0.06em'
                  }}>{label}</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      placeholder="—"
                      value={cholFields[key]}
                      onChange={e => setCholFields(prev => ({ ...prev, [key]: e.target.value }))}
                      style={{
                        width: '100%',
                        padding: '9px 40px 9px 10px',
                        borderRadius: 8,
                        border: '1.5px solid var(--hairline)',
                        background: 'var(--surface)',
                        color: 'var(--ink)',
                        fontSize: 15,
                        fontWeight: 600,
                        outline: 'none',
                        boxSizing: 'border-box',
                        transition: 'border-color 0.2s',
                      }}
                      onFocus={e => (e.target.style.borderColor = '#6366f1')}
                      onBlur={e  => (e.target.style.borderColor = 'var(--hairline)')}
                    />
                    <span style={{
                      position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                      fontSize: 11, color: 'var(--ink-3)', fontWeight: 550, pointerEvents: 'none'
                    }}>{unit}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button 
            type="submit" 
            style={{ 
              marginTop: 12, 
              width: "100%", 
              padding: "14px", 
              borderRadius: 10, 
              background: "linear-gradient(135deg, var(--accent), #8b5cf6)", 
              color: "#fff", 
              border: "none", 
              fontSize: "16px", 
              fontWeight: 600, 
              cursor: "pointer", 
              boxShadow: "var(--shadow-pop)",
              transition: "transform 0.15s ease, opacity 0.15s ease"
            }}
            onMouseEnter={(e) => e.currentTarget.style.opacity = "0.9"}
            onMouseLeave={(e) => e.currentTarget.style.opacity = "1"}
          >
            {t('calculateRisk', 'Calculate Risk')}
          </button>
        </form>
      </div>

      {/* History Database */}
      <section style={{ 
        background: "var(--paper)", 
        border: "1px solid var(--hairline)", 
        borderRadius: "var(--r-3)", 
        padding: "32px", 
        boxShadow: "var(--shadow-pop)" 
      }}>
        <h2 style={{ 
          fontSize: "22px", 
          fontWeight: 600, 
          marginBottom: "20px", 
          color: "var(--ink)",
          display: "flex", 
          justifyContent: "space-between", 
          alignItems: "center" 
        }}>
          <span>Patient Records Database</span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {history.length > 0 && (
              <button
                onClick={downloadPatientHistory}
                style={{
                  padding: "6px 12px", borderRadius: 8, border: "1px solid #c7d2fe",
                  background: "#eef2ff", color: "#6366f1", cursor: "pointer",
                  fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 5
                }}
              >
                🖨️ Download History
              </button>
            )}
            <span style={{ fontSize: "12px", padding: "4px 10px", background: "var(--surface-sunken)", borderRadius: 12, color: "var(--ink-3)", fontWeight: 500 }}>
              {history.length} {history.length === 1 ? 'record' : 'records'} saved
            </span>
          </div>
        </h2>
        
        {history.length === 0 ? (
          <div style={{ padding: "40px 0", textAlign: "center", color: "var(--ink-3)", border: "1px dashed var(--hairline)", borderRadius: 12 }}>
            <p style={{ margin: 0, fontSize: "15px" }}>No patient records stored in this database yet.</p>
          </div>
        ) : (
          <div style={{ display: "grid", gap: "16px" }}>
            {history.map((rec) => (
              <div 
                key={rec.id} 
                style={{ 
                  padding: "20px", 
                  borderRadius: "12px", 
                  border: "1px solid var(--hairline)", 
                  background: "var(--surface)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  position: "relative",
                  transition: "box-shadow 0.2s ease, border-color 0.2s ease"
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow = "var(--shadow-pop)";
                  e.currentTarget.style.borderColor = "var(--accent-soft-2)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = "none";
                  e.currentTarget.style.borderColor = "var(--hairline)";
                }}
              >
                {/* Profile Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
                  <div>
                    <h3 style={{ margin: "0 0 4px 0", fontSize: "16px", fontWeight: 600, color: "var(--ink)" }}>{rec.name}</h3>
                    <div style={{ display: "flex", gap: "14px", flexWrap: "wrap", fontSize: "13px", color: "var(--ink-3)" }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Calendar size={13} /> {rec.age} years</span>
                      <span style={{ display: "flex", alignItems: "center", gap: 4 }}><User size={13} /> {rec.gender.toUpperCase()}</span>
                      <span style={{ display: "flex", alignItems: "center", gap: 4 }}><MapPin size={13} /> {rec.location}</span>
                    </div>
                  </div>
                  
                  {/* Action buttons */}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button 
                      onClick={() => handleLoadRecord(rec)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "6px 12px",
                        borderRadius: 6,
                        border: "1px solid var(--hairline)",
                        background: "var(--paper)",
                        color: "var(--accent)",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor: "pointer",
                        transition: "all 0.15s ease"
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "var(--accent-soft)";
                        e.currentTarget.style.borderColor = "var(--accent-soft-2)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "var(--paper)";
                        e.currentTarget.style.borderColor = "var(--hairline)";
                      }}
                    >
                      <FolderOpen size={13} /> Load
                    </button>
                    <button 
                      onClick={(e) => handleDeleteRecord(rec.id, e)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "6px 12px",
                        borderRadius: 6,
                        border: "1px solid rgba(239, 68, 68, 0.2)",
                        background: "var(--paper)",
                        color: "var(--error)",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor: "pointer",
                        transition: "all 0.15s ease"
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "var(--error-soft)";
                        e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.3)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "var(--paper)";
                        e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.2)";
                      }}
                    >
                      <Trash2 size={13} /> Delete
                    </button>
                  </div>
                </div>
                
                {/* Profile Details Tag list */}
                <div style={{ 
                  display: "grid", 
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", 
                  gap: 12,
                  borderTop: "1px solid var(--hairline)",
                  paddingTop: 12,
                  fontSize: "13px"
                }}>
                  <div>
                    <span style={{ fontWeight: 600, color: "var(--ink-2)" }}>{t('symptoms') ?? 'Symptoms'}:</span>{" "}
                    <span style={{ color: "var(--ink-3)" }}>
                      {rec.symptoms && rec.symptoms.length > 0 ? rec.symptoms.join(", ") : "None reported"}
                    </span>
                  </div>
                  <div>
                    <span style={{ fontWeight: 600, color: "var(--ink-2)" }}>{t('lifestyle') ?? 'Lifestyle'}:</span>{" "}
                    <span style={{ color: "var(--ink-3)" }}>
                      {rec.lifestyle && rec.lifestyle.length > 0 ? rec.lifestyle.join(", ") : "None reported"}
                    </span>
                  </div>
                  <div>
                    <span style={{ fontWeight: 600, color: "var(--ink-2)" }}>{t('familyHistory') ?? 'Family History'}:</span>{" "}
                    <span style={{ color: "var(--ink-3)" }}>
                      {rec.familyHistory && rec.familyHistory.length > 0 ? rec.familyHistory.join(", ") : "None reported"}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
