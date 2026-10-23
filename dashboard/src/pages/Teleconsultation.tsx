// Phase 3: Teleconsultation – fully enhanced
import { useState, useEffect } from "react";
import { nearestPHC, type PHC } from "../utils/haversine";
import { useTranslation } from "../utils/useTranslation";

// ─── Types ───────────────────────────────────────────────────────────────────
interface Doctor {
  name: string;
  specialization: string;
  avatar: string;
  available: boolean;
  availableDays: string[];
  availableHours: string;
}

interface PHCWithMeta extends PHC {
  distanceKm: number;
  isOpen: boolean;
  doctors: Doctor[];
}

interface Appointment {
  id: string;
  phc: string;
  date: string;
  time: string;
  doctor: string;
  notes: string;
  mode: "in-person" | "video";
  meetLink?: string;
  patientName?: string;
}

interface PatientRecord {
  id: string;
  name: string;
  age: string;
  gender: string;
  location: string;
  symptoms: string[];
  lifestyle: string[];
  familyHistory: string[];
  timestamp: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────
const TIME_SLOTS = [
  "09:00", "10:00", "11:00", "12:00",
  "14:00", "15:00", "16:00", "17:00"
];

const STORAGE_KEY = "anebilin_appointments";

const HOSPITAL_DOCTORS: Record<string, Doctor[]> = {
  "Kolkata Care Health Centre": [
    { name: "Dr. A. K. Banerjee", specialization: "Cardiologist", avatar: "AB", available: true, availableDays: ["Mon", "Wed", "Fri"], availableHours: "10:00 AM - 01:00 PM" },
    { name: "Dr. S. N. Mukherjee", specialization: "General Physician", avatar: "SM", available: true, availableDays: ["Tue", "Thu", "Sat"], availableHours: "02:00 PM - 05:00 PM" }
  ],
  "Hooghly River Community Clinic": [
    { name: "Dr. P. C. Sen", specialization: "Hematologist", avatar: "PS", available: true, availableDays: ["Mon", "Tue", "Wed"], availableHours: "09:00 AM - 12:00 PM" },
    { name: "Dr. K. K. Bose", specialization: "Gastroenterologist", avatar: "KB", available: true, availableDays: ["Thu", "Fri", "Sat"], availableHours: "01:00 PM - 04:00 PM" }
  ],
  "Salt Lake Medical Outpost": [
    { name: "Dr. A. P. Roy", specialization: "General Physician", avatar: "AR", available: true, availableDays: ["Mon", "Wed", "Fri"], availableHours: "11:00 AM - 02:00 PM" },
    { name: "Dr. M. D. Dutta", specialization: "Cardiologist", avatar: "MD", available: true, availableDays: ["Tue", "Thu"], availableHours: "03:00 PM - 06:00 PM" }
  ],
  "Howrah Bridge Wellness Centre": [
    { name: "Dr. J. S. Mitra", specialization: "Gastroenterologist", avatar: "JM", available: true, availableDays: ["Wed", "Thu", "Fri"], availableHours: "10:00 AM - 01:00 PM" },
    { name: "Dr. S. K. Das", specialization: "Hematologist", avatar: "SD", available: true, availableDays: ["Mon", "Tue", "Sat"], availableHours: "02:00 PM - 05:00 PM" }
  ],
  "Victoria Memorial Clinic": [
    { name: "Dr. D. N. Ghosh", specialization: "General Physician", avatar: "DG", available: true, availableDays: ["Mon", "Thu"], availableHours: "09:00 AM - 12:00 PM" },
    { name: "Dr. R. M. Pal", specialization: "Cardiologist", avatar: "RP", available: true, availableDays: ["Tue", "Fri"], availableHours: "01:00 PM - 04:00 PM" }
  ]
};

function loadAppointments(): Appointment[] {
  try {
    const raw: Appointment[] = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    // Ensure all video appointments have the hardcoded Google Meet link
    return raw.map(appt =>
      appt.mode === "video" ? { ...appt, meetLink: generateMeetLink() } : appt
    );
  } catch {
    return [];
  }
}

function generateMeetLink(): string {
  return "https://meet.google.com/ngc-zuxa-eyb";
}

function printAppointment(appt: Appointment) {
  const win = window.open("", "_blank", "width=700,height=900");
  if (!win) return;
  win.document.write(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <title>Appointment Letter - Anebilin</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
        * { margin:0; padding:0; box-sizing:border-box; }
        body { font-family:'Inter',sans-serif; background:#f8fafc; color:#1e293b; padding:40px; }
        .card { background:#fff; border-radius:16px; padding:48px; max-width:600px; margin:0 auto; box-shadow:0 4px 24px rgba(0,0,0,0.08); }
        .header { border-bottom:2px solid #e2e8f0; padding-bottom:24px; margin-bottom:28px; text-align:center; }
        .logo { font-size:28px; font-weight:700; color:#6366f1; letter-spacing:-0.03em; }
        .subtitle { font-size:13px; color:#64748b; margin-top:4px; }
        .badge { display:inline-block; padding:4px 14px; border-radius:20px; font-size:12px; font-weight:600;
                 background:${appt.mode === 'video' ? '#eef2ff' : '#f0fdf4'};
                 color:${appt.mode === 'video' ? '#6366f1' : '#16a34a'};
                 border:1px solid ${appt.mode === 'video' ? '#c7d2fe' : '#86efac'};
                 margin-top:12px; }
        h1 { font-size:22px; font-weight:700; color:#1e293b; margin:24px 0 6px; }
        .row { display:flex; justify-content:space-between; padding:12px 0; border-bottom:1px solid #f1f5f9; font-size:14px; }
        .row span:first-child { color:#64748b; }
        .row span:last-child { font-weight:600; color:#1e293b; }
        .notes { margin-top:20px; background:#f8fafc; border-radius:10px; padding:16px; font-size:13px; color:#475569; line-height:1.6; }
        .notes strong { display:block; margin-bottom:6px; color:#1e293b; }
        .meet { margin-top:20px; padding:14px; background:#eef2ff; border-radius:10px; text-align:center; font-size:13px; color:#6366f1; }
        .meet a { color:#6366f1; font-weight:600; }
        .footer { margin-top:40px; text-align:center; font-size:11px; color:#94a3b8; border-top:1px solid #e2e8f0; padding-top:16px; }
        .seal { width:60px; height:60px; border-radius:50%; background:linear-gradient(135deg,#6366f1,#8b5cf6); display:flex; align-items:center; justify-content:center; font-size:26px; margin:0 auto 12px; }
        @media print { body { background:#fff; padding:0; } .card { box-shadow:none; } }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <div class="seal">🏥</div>
          <div class="logo">Anebilin Health</div>
          <div class="subtitle">AI-Powered Rural Patient Management System</div>
          <div class="badge">${appt.mode === 'video' ? '💻 Video Consultation' : '🏥 In-Person Visit'}</div>
        </div>
        <h1>Appointment Confirmation Letter</h1>
        <p style="font-size:13px;color:#64748b;margin-bottom:24px;">Please bring a copy of this letter to your appointment.</p>

        <div class="row"><span>Health Centre</span><span>${appt.phc}</span></div>
        <div class="row"><span>Doctor</span><span>${appt.doctor}</span></div>
        <div class="row"><span>Date</span><span>${appt.date}</span></div>
        <div class="row"><span>Time</span><span>${appt.time}</span></div>
        <div class="row"><span>Consultation Type</span><span>${appt.mode === 'video' ? 'Video Consultation' : 'In-Person Visit'}</span></div>
        <div class="row"><span>Appointment ID</span><span style="font-family:monospace;">#${appt.id.slice(0, 8).toUpperCase()}</span></div>

        ${appt.notes ? `<div class="notes"><strong>Clinical Notes</strong>${appt.notes.replace(/\n/g, '<br/>')}</div>` : ''}
        ${appt.meetLink ? `<div class="meet">📹 Video Call Link: <a href="${appt.meetLink}" target="_blank">${appt.meetLink}</a></div>` : ''}

        <div class="footer">
          <p>This is a computer-generated document. No signature required.</p>
          <p style="margin-top:4px;">Generated by Anebilin Health Platform · ${new Date().toLocaleDateString('en-IN', {day:'2-digit',month:'long',year:'numeric'})}</p>
        </div>
      </div>
    </body>
    </html>
  `);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 600);
}

function generateICS(appt: Appointment): string {
  const start = new Date(`${appt.date}T${appt.time}:00`);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const fmt = (d: Date) =>
    d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Anebilin//EN",
    "BEGIN:VEVENT",
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:Teleconsultation at ${appt.phc}`,
    `DESCRIPTION:Doctor: ${appt.doctor}${appt.notes ? "\\nNotes: " + appt.notes : ""}${appt.meetLink ? "\\nJoin: " + appt.meetLink : ""}`,
    `LOCATION:${appt.phc}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

function downloadICS(appt: Appointment) {
  const blob = new Blob([generateICS(appt)], { type: "text/calendar" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `appointment-${appt.id.slice(0, 6)}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function Teleconsultation() {
  const { t } = useTranslation();
  const [phcs, setPhcs] = useState<PHCWithMeta[]>([]);
  const [selectedPHC, setSelectedPHC] = useState<PHCWithMeta | null>(null);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedTime, setSelectedTime] = useState("");
  const [selectedDoctor, setSelectedDoctor] = useState("");
  const [notes, setNotes] = useState("");
  const [mode, setMode] = useState<"in-person" | "video">("in-person");
  const [appointments, setAppointments] = useState<Appointment[]>(loadAppointments);
  const [msg, setMsg] = useState("");
  const [locErr, setLocErr] = useState("");
  const [patientRecords, setPatientRecords] = useState<PatientRecord[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string>("");

  // Load all patient records from intake
  useEffect(() => {
    try {
      const records: PatientRecord[] = JSON.parse(localStorage.getItem("patient_records") || "[]");
      setPatientRecords(records);
      // Auto-fill with the most recent patient on first load
      if (records.length > 0) {
        setSelectedPatientId(records[0].id);
        setNotes(buildNotesFromRecord(records[0]));
      }
    } catch (_) {}
  }, []);

  function buildNotesFromRecord(rec: PatientRecord): string {
    const parts: string[] = [];
    if (rec.name)                    parts.push(`Patient: ${rec.name}`);
    if (rec.age)                     parts.push(`Age: ${rec.age}`);
    if (rec.gender)                  parts.push(`Gender: ${rec.gender}`);
    if (rec.location)                parts.push(`Location: ${rec.location}`);
    if (rec.symptoms?.length)        parts.push(`Symptoms: ${rec.symptoms.join(", ")}`);
    if (rec.lifestyle?.length)       parts.push(`Lifestyle: ${rec.lifestyle.join(", ")}`);
    if (rec.familyHistory?.length)   parts.push(`Family History: ${rec.familyHistory.join(", ")}`);
    return parts.join("\n");
  }

  // Geolocation → sorted PHC list
  useEffect(() => {
    const enrich = (lat: number, lon: number) =>
      nearestPHC(lat, lon).map(p => ({
        ...p,
        isOpen: p.name === "Kolkata Care Health Centre" || p.name === "Salt Lake Medical Outpost" || p.name === "Victoria Memorial Clinic",
        doctors: HOSPITAL_DOCTORS[p.name] || [],
      }));

    navigator.geolocation?.getCurrentPosition(
      pos => setPhcs(enrich(pos.coords.latitude, pos.coords.longitude)),
      () => {
        setLocErr("Location unavailable — showing Kolkata hospitals by default.");
        setPhcs(enrich(22.5726, 88.3639));
      }
    );
  }, []);

  const todayStr = new Date().toISOString().split("T")[0];

  const book = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPHC || !selectedDate || !selectedTime || !selectedDoctor) {
      setMsg("Please complete all required fields.");
      return;
    }
    const appt: Appointment = {
      id: crypto.randomUUID(),
      phc: selectedPHC.name,
      date: selectedDate,
      time: selectedTime,
      doctor: selectedDoctor,
      notes,
      mode,
      meetLink: mode === "video" ? generateMeetLink() : undefined,
    };
    const updated = [appt, ...appointments];
    setAppointments(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    setMsg(`✅ Appointment confirmed at ${selectedPHC.name} on ${selectedDate} at ${selectedTime}`);
    // Reset form
    setSelectedPHC(null);
    setSelectedDate("");
    setSelectedTime("");
    setSelectedDoctor("");
    setNotes("");
    setMode("in-person");
  };

  const cancel = (id: string) => {
    const updated = appointments.filter(a => a.id !== id);
    setAppointments(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  };

  return (
    <div style={{ maxWidth: 860, margin: "32px auto", padding: "0 20px", display: "flex", flexDirection: "column", gap: 28 }}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{
        background: "linear-gradient(135deg, rgba(99,102,241,0.05), rgba(139,92,246,0.05))",
        border: "1px solid var(--hairline)", borderRadius: 16, padding: "28px 32px",
        boxShadow: "var(--shadow-pop)", backdropFilter: "blur(8px)"
      }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 34, fontWeight: 600, margin: "0 0 8px", letterSpacing: "-0.022em" }}>
          📅 {t("teleconsultation") ?? "Teleconsultation"}
        </h1>
        <p style={{ color: "var(--ink-3)", fontSize: 15, margin: 0, maxWidth: "60ch" }}>
          Book in-person appointments at nearby PHCs or start a video consultation from anywhere. Your latest clinical intake is auto-filled.
        </p>
      </div>

      {locErr && (
        <div style={{ background: "#fef9c3", border: "1px solid #fde047", borderRadius: 10, padding: "12px 16px", fontSize: 13, color: "#854d0e" }}>
          ⚠️ {locErr}
        </div>
      )}

      {/* ── PHC Selection Cards ────────────────────────────────────────── */}
      <section>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 14, color: "var(--ink)" }}>
          🏥 Select a Health Centre
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 14 }}>
          {phcs.map(phc => {
            const isSel = selectedPHC?.name === phc.name;
            return (
              <div
                key={phc.name}
                onClick={() => { setSelectedPHC(phc); setSelectedDoctor(""); }}
                style={{
                  border: isSel ? "2px solid var(--accent)" : "1px solid var(--hairline)",
                  borderRadius: 14, padding: "16px 18px", cursor: "pointer", background: isSel ? "var(--accent-soft)" : "var(--paper)",
                  boxShadow: isSel ? "0 0 0 3px var(--accent-soft)" : "var(--shadow-pop)",
                  transition: "all 0.2s ease", display: "flex", flexDirection: "column", gap: 8
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: "var(--ink)", lineHeight: 1.3 }}>{phc.name}</span>
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10,
                    background: phc.isOpen ? "#f0fdf4" : "#fff1f2",
                    color: phc.isOpen ? "#16a34a" : "#dc2626",
                    border: phc.isOpen ? "1px solid #86efac" : "1px solid #fca5a5",
                    whiteSpace: "nowrap"
                  }}>
                    {phc.isOpen ? "🟢 Open Now" : "🔴 Closed"}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-3)", display: "flex", alignItems: "center", gap: 6 }}>
                  📍 <strong>{phc.distanceKm} km</strong> away
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-3)" }}>📞 {phc.phone}</div>
                {isSel && (
                  <div style={{ marginTop: 4, fontSize: 11, fontWeight: 600, color: "var(--accent)" }}>✓ Selected</div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Doctor Directory ───────────────────────────────────────────── */}
      {selectedPHC && (
        <section>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 14, color: "var(--ink)" }}>
            👨‍⚕️ Choose a Doctor at {selectedPHC.name}
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
            {selectedPHC.doctors.map(doc => {
              const isSel = selectedDoctor === doc.name;
              return (
                <div
                  key={doc.name}
                  onClick={() => doc.available && setSelectedDoctor(doc.name)}
                  style={{
                    border: isSel ? "2px solid var(--accent)" : "1px solid var(--hairline)",
                    borderRadius: 14, padding: "14px 16px", cursor: doc.available ? "pointer" : "not-allowed",
                    background: !doc.available ? "var(--surface-sunken)" : isSel ? "var(--accent-soft)" : "var(--paper)",
                    opacity: doc.available ? 1 : 0.55,
                    transition: "all 0.2s ease", display: "flex", flexDirection: "column", gap: 8
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: "50%",
                      background: isSel ? "var(--accent)" : "linear-gradient(135deg, #6366f1, #8b5cf6)",
                      color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 13, fontWeight: 700, flexShrink: 0
                    }}>
                      {doc.avatar}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13, color: "var(--ink)" }}>{doc.name}</div>
                      <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{doc.specialization}</div>
                    </div>
                  </div>
                  
                  {/* Doctor Availability schedule */}
                  <div style={{ fontSize: 11, color: "var(--ink-3)", borderTop: "1px dashed var(--hairline)", paddingTop: 8, marginTop: 4, display: "flex", flexDirection: "column", gap: 3 }}>
                    <div>📅 {doc.availableDays.join(", ")}</div>
                    <div>⏰ {doc.availableHours}</div>
                  </div>

                  <span style={{
                    fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 10, alignSelf: "flex-start",
                    background: doc.available ? "#f0fdf4" : "#f1f5f9",
                    color: doc.available ? "#16a34a" : "#94a3b8",
                    border: doc.available ? "1px solid #86efac" : "1px solid #e2e8f0",
                  }}>
                    {doc.available ? "✓ Available" : "Unavailable"}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Booking Form ───────────────────────────────────────────────── */}
      <section style={{
        background: "var(--paper)", border: "1px solid var(--hairline)",
        borderRadius: 16, padding: "28px 32px", boxShadow: "var(--shadow-pop)"
      }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20, color: "var(--ink)" }}>
          {t("bookAppointment") ?? "📋 Book Appointment"}
        </h2>
        <form onSubmit={book} style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Consultation Mode Toggle */}
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 8, color: "var(--ink-2)" }}>
              Consultation Mode *
            </label>
            <div style={{ display: "flex", gap: 10 }}>
              {(["in-person", "video"] as const).map(m => (
                <button
                  type="button" key={m}
                  onClick={() => setMode(m)}
                  style={{
                    flex: 1, padding: "12px 16px", borderRadius: 10, cursor: "pointer",
                    border: mode === m ? "2px solid var(--accent)" : "1.5px solid var(--hairline)",
                    background: mode === m ? "var(--accent-soft)" : "var(--surface)",
                    color: mode === m ? "var(--accent)" : "var(--ink-2)",
                    fontWeight: 600, fontSize: 14, transition: "all 0.2s ease",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8
                  }}
                >
                  {m === "in-person" ? "🏥 In-Person Visit" : "💻 Video Consultation"}
                </button>
              ))}
            </div>
          </div>

          {/* Date */}
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6, color: "var(--ink-2)" }}>Date *</label>
            <input
              type="date" required min={todayStr}
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              style={{ width: "100%", padding: "11px 14px", borderRadius: 8, border: "1.5px solid var(--hairline)", fontSize: 14, background: "var(--surface)", color: "var(--ink)", boxSizing: "border-box" }}
            />
          </div>

          {/* Time Slot Chips */}
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 8, color: "var(--ink-2)" }}>Time Slot *</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {TIME_SLOTS.map(slot => {
                const isSel = selectedTime === slot;
                return (
                  <button
                    type="button" key={slot}
                    onClick={() => setSelectedTime(slot)}
                    style={{
                      padding: "8px 16px", borderRadius: 20, cursor: "pointer",
                      border: isSel ? "2px solid var(--accent)" : "1.5px solid var(--hairline)",
                      background: isSel ? "var(--accent)" : "var(--surface)",
                      color: isSel ? "#fff" : "var(--ink-2)",
                      fontWeight: isSel ? 700 : 500, fontSize: 13,
                      transition: "all 0.15s ease"
                    }}
                  >
                    {slot}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Patient Selector → Auto-fill Clinical Notes */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <label style={{ fontSize: 13, fontWeight: 600, display: "block", color: "var(--ink-2)" }}>
              Clinical Notes
              <span style={{ fontWeight: 400, color: "var(--ink-3)", fontSize: 11, marginLeft: 6 }}>(auto-filled from intake)</span>
            </label>

            {/* Patient picker */}
            {patientRecords.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 500 }}>Select patient to auto-fill:</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {patientRecords.map(rec => {
                    const isSel = selectedPatientId === rec.id;
                    return (
                      <button
                        key={rec.id}
                        type="button"
                        onClick={() => {
                          setSelectedPatientId(rec.id);
                          setNotes(buildNotesFromRecord(rec));
                        }}
                        style={{
                          padding: "8px 14px", borderRadius: 20, cursor: "pointer",
                          border: isSel ? "2px solid var(--accent)" : "1.5px solid var(--hairline)",
                          background: isSel ? "var(--accent)" : "var(--surface)",
                          color: isSel ? "#fff" : "var(--ink-2)",
                          fontWeight: isSel ? 700 : 500, fontSize: 13,
                          transition: "all 0.15s ease",
                          display: "flex", alignItems: "center", gap: 6
                        }}
                      >
                        <span style={{
                          width: 22, height: 22, borderRadius: "50%",
                          background: isSel ? "rgba(255,255,255,0.3)" : "linear-gradient(135deg,#6366f1,#8b5cf6)",
                          color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center",
                          fontSize: 10, fontWeight: 700, flexShrink: 0
                        }}>
                          {rec.name?.charAt(0)?.toUpperCase() ?? "?"}
                        </span>
                        {rec.name || "Unknown"}
                        <span style={{ fontSize: 10, opacity: 0.7 }}>{rec.age ? `, ${rec.age}y` : ""}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Auto-filled preview badge */}
                {selectedPatientId && (() => {
                  const rec = patientRecords.find(r => r.id === selectedPatientId);
                  if (!rec) return null;
                  return (
                    <div style={{
                      background: "var(--accent-soft)", border: "1px solid var(--accent-soft-2)",
                      borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "var(--ink-2)",
                      display: "flex", flexWrap: "wrap", gap: 6
                    }}>
                      <span style={{ fontWeight: 700, color: "var(--accent)", marginRight: 4 }}>✓ Auto-filled from:</span>
                      <strong>{rec.name}</strong>
                      {rec.age && <span>· Age {rec.age}</span>}
                      {rec.gender && <span>· {rec.gender}</span>}
                      {rec.location && <span>· {rec.location}</span>}
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div style={{
                padding: "10px 14px", borderRadius: 8, background: "#fef9c3",
                border: "1px solid #fde047", fontSize: 12, color: "#854d0e"
              }}>
                ⚠️ No patient intake records found.{" "}
                <a href="/register" style={{ color: "#6366f1", fontWeight: 600 }}>Register a patient first →</a>
              </div>
            )}

            {/* Editable notes textarea */}
            <textarea
              rows={4}
              style={{
                width: "100%", padding: "11px 14px", borderRadius: 8,
                border: "1.5px solid var(--hairline)", fontSize: 13,
                background: "var(--surface)", color: "var(--ink)",
                boxSizing: "border-box", resize: "vertical", fontFamily: "inherit", lineHeight: 1.6
              }}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Clinical notes will auto-fill when a patient is selected. You can also edit manually."
            />
          </div>

          {/* Summary preview */}
          {selectedPHC && selectedDate && selectedTime && selectedDoctor && (
            <div style={{
              padding: "14px 18px", borderRadius: 10, background: "var(--accent-soft)",
              border: "1px solid var(--accent-soft-2)", fontSize: 13, display: "flex", flexDirection: "column", gap: 6
            }}>
              <div style={{ fontWeight: 700, color: "var(--accent)", marginBottom: 4 }}>📋 Booking Summary</div>
              <div>🏥 <strong>{selectedPHC.name}</strong></div>
              <div>👨‍⚕️ <strong>{selectedDoctor}</strong></div>
              <div>📅 <strong>{selectedDate}</strong> at <strong>{selectedTime}</strong></div>
              <div>{mode === "video" ? "💻 Video Consultation — a link will be generated" : "🏥 In-Person Visit"}</div>
            </div>
          )}

          <button
            type="submit"
            disabled={!selectedPHC || !selectedDate || !selectedTime || !selectedDoctor}
            style={{
              padding: "14px", borderRadius: 10,
              background: (!selectedPHC || !selectedDate || !selectedTime || !selectedDoctor)
                ? "#e2e8f0"
                : "linear-gradient(135deg, var(--accent), #8b5cf6)",
              color: (!selectedPHC || !selectedDate || !selectedTime || !selectedDoctor) ? "#94a3b8" : "#fff",
              border: "none", fontSize: 15, fontWeight: 700, cursor: (!selectedPHC || !selectedDate || !selectedTime || !selectedDoctor) ? "not-allowed" : "pointer",
              transition: "all 0.2s ease"
            }}
          >
            Confirm Appointment
          </button>
        </form>

        {msg && (
          <div style={{
            marginTop: 16, padding: "12px 16px", borderRadius: 10,
            background: msg.startsWith("✅") ? "#f0fdf4" : "#fff1f2",
            border: msg.startsWith("✅") ? "1px solid #86efac" : "1px solid #fca5a5",
            color: msg.startsWith("✅") ? "#16a34a" : "#dc2626",
            fontWeight: 600, fontSize: 14
          }}>
            {msg}
          </div>
        )}
      </section>

      {/* ── Appointment Log ────────────────────────────────────────────── */}
      {appointments.length > 0 && (
        <section style={{
          background: "var(--paper)", border: "1px solid var(--hairline)",
          borderRadius: 16, padding: "28px 32px", boxShadow: "var(--shadow-pop)"
        }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 18, color: "var(--ink)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>My Appointments</span>
            <span style={{ fontSize: 12, fontWeight: 500, padding: "4px 10px", background: "var(--surface-sunken)", borderRadius: 12, color: "var(--ink-3)" }}>
              {appointments.length} booked
            </span>
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {appointments.map(appt => (
              <div
                key={appt.id}
                style={{
                  border: "1px solid var(--hairline)", borderRadius: 12, padding: "16px 20px",
                  background: "var(--surface)", display: "flex", justifyContent: "space-between",
                  alignItems: "flex-start", gap: 12, flexWrap: "wrap"
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <strong style={{ fontSize: 15, color: "var(--ink)" }}>{appt.phc}</strong>
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10,
                      background: appt.mode === "video" ? "rgba(99,102,241,0.1)" : "#f0fdf4",
                      color: appt.mode === "video" ? "var(--accent)" : "#16a34a",
                      border: appt.mode === "video" ? "1px solid var(--accent-soft-2)" : "1px solid #86efac"
                    }}>
                      {appt.mode === "video" ? "💻 Video" : "🏥 In-Person"}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: "var(--ink-3)" }}>
                    👨‍⚕️ {appt.doctor} · 📅 {appt.date} at {appt.time}
                  </div>
                  {appt.notes && (
                    <div style={{ fontSize: 12, color: "var(--ink-4)", maxWidth: "48ch" }}>
                      📝 {appt.notes.split("\n")[0]}{appt.notes.includes("\n") ? "…" : ""}
                    </div>
                  )}
                  {appt.meetLink && (
                    <a
                      href={appt.meetLink} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 12, color: "var(--accent)", fontWeight: 600, textDecoration: "underline" }}
                    >
                      🔗 Join Video Call
                    </a>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
                  <button
                    onClick={() => downloadICS(appt)}
                    style={{
                      padding: "6px 12px", borderRadius: 8, border: "1px solid var(--hairline)",
                      background: "var(--paper)", color: "var(--ink-2)", cursor: "pointer",
                      fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 4
                    }}
                  >
                    📅 Add to Calendar
                  </button>
                  <button
                    onClick={() => printAppointment(appt)}
                    style={{
                      padding: "6px 12px", borderRadius: 8, border: "1px solid #c7d2fe",
                      background: "#eef2ff", color: "#6366f1", cursor: "pointer",
                      fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 4
                    }}
                  >
                    🖨️ Print Letter
                  </button>
                  <button
                    onClick={() => cancel(appt.id)}
                    style={{
                      padding: "6px 12px", borderRadius: 8, border: "1px solid #fca5a5",
                      background: "#fff1f2", color: "#dc2626", cursor: "pointer",
                      fontSize: 12, fontWeight: 600
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
