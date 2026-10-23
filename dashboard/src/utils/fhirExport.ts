// Phase 2: FHIR R4-compatible JSON Bundle export
import type { LocalPatient } from "./patientStore";

function obs(patientId: string, code: string, display: string, value: number, unit: string, ts: string) {
  return {
    resourceType: "Observation",
    status: "final",
    subject: { reference: `Patient/${patientId}` },
    effectiveDateTime: ts,
    code: { coding: [{ system: "http://loinc.org", code, display }] },
    valueQuantity: { value, unit, system: "http://unitsofmeasure.org", code: unit },
  };
}

export function exportToFHIR(patient: LocalPatient): string {
  const ts = new Date(patient.timestamp).toISOString();
  const entries: object[] = [
    {
      resourceType: "Patient",
      id: patient.id,
      name: [{ text: patient.name }],
      gender: patient.sex === "Male" ? "male" : patient.sex === "Female" ? "female" : "unknown",
      birthDate: String(new Date().getFullYear() - patient.age),
    },
  ];

  const vitals = patient.vitals ?? {};
  if (vitals.hr       != null) entries.push(obs(patient.id,"8867-4","Heart Rate", vitals.hr!,"bpm",ts));
  if (vitals.spo2     != null) entries.push(obs(patient.id,"59408-5","SpO2",     vitals.spo2!,"%",ts));
  if (vitals.hb       != null) entries.push(obs(patient.id,"718-7","Hemoglobin", vitals.hb!,"g/dL",ts));
  if (vitals.bilirubin!= null) entries.push(obs(patient.id,"1971-1","Bilirubin", vitals.bilirubin!,"mg/dL",ts));

  const bundle = {
    resourceType: "Bundle",
    type: "collection",
    timestamp: ts,
    entry: entries.map(r => ({ resource: r })),
  };
  return JSON.stringify(bundle, null, 2);
}

export function downloadFHIR(patient: LocalPatient) {
  const json = exportToFHIR(patient);
  const blob = new Blob([json], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `patient_${patient.id}_fhir.json`;
  a.click();
}
