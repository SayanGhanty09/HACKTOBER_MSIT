// Phase 5: Email alerts via EmailJS (configured in .env.local)
const SERVICE_ID  = import.meta.env.VITE_EMAILJS_SERVICE_ID  ?? "";
const TEMPLATE_ID = import.meta.env.VITE_EMAILJS_TEMPLATE_ID ?? "";
const USER_ID     = import.meta.env.VITE_EMAILJS_USER_ID     ?? "";

export interface AlertPayload {
  to_email: string;
  patient_name: string;
  disease: string;
  risk_level: "High" | "Medium" | "Low";
  score: number;
  factors: string;
  timestamp: string;
}

/**
 * Send an alert email to a PHC contact via EmailJS.
 * Requires VITE_EMAILJS_* keys set in .env.local.
 */
export async function sendAlert(payload: AlertPayload): Promise<{ ok: boolean; message: string }> {
  if (!SERVICE_ID || !TEMPLATE_ID || !USER_ID) {
    console.warn("[emailAlert] EmailJS env vars not set — alert not sent.");
    return { ok: false, message: "EmailJS not configured." };
  }
  try {
    const emailjs = await import("@emailjs/browser");
    await emailjs.send(SERVICE_ID, TEMPLATE_ID, payload as any, USER_ID);
    return { ok: true, message: "Alert sent." };
  } catch (err: any) {
    return { ok: false, message: err?.text ?? err?.message ?? "Unknown error" };
  }
}

/**
 * Check risk results and fire alerts for any High-risk diseases.
 */
export async function alertIfHighRisk(
  patientName: string,
  phcEmail: string,
  risks: { disease: string; score: number; riskLevel: string; factors: { name: string }[] }[]
) {
  const highRisks = risks.filter(r => r.riskLevel === "High");
  for (const r of highRisks) {
    await sendAlert({
      to_email: phcEmail,
      patient_name: patientName,
      disease: r.disease,
      risk_level: "High",
      score: r.score,
      factors: r.factors.map(f => f.name).join(", "),
      timestamp: new Date().toLocaleString("en-IN"),
    });
  }
}
