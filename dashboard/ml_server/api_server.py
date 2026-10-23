import os
from typing import Any

from fastapi import FastAPI, Request, Query
from fastapi.middleware.cors import CORSMiddleware

from predict import predict_health_risks
from ecg_analyze import analyze_ecg, analyze_i16_le


app = FastAPI(title="Anebilin ML API")

# Allow CORS for local dev and cloud deployments
cors_origins_env = os.environ.get("CORS_ORIGINS", "*")
allowed_origins = [o.strip() for o in cors_origins_env.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins if "*" not in allowed_origins else ["*"],
    allow_credentials=True if "*" not in allowed_origins else False,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"status": "ok", "service": "anebilin-ml"}


FEATURE_DEFAULTS: dict[str, Any] = {
    "Age": 30, "Sex": "Other", "BMI": 22.0, "Smoking_Status": "Unknown",
    "Physical_Activity": "Unknown", "Diet_Quality": "Unknown", "Alcohol_Use": "Unknown",
    "Sleep_Hours": 7.0, "Family_History_High_Cholesterol": 0,
    "Family_History_Heart_Disease": 0, "Family_History_Anaemia": 0,
    "Family_History_Liver_Disease": 0, "Total_Cholesterol_mg_dL": 0.0,
    "LDL_mg_dL": 0.0, "HDL_mg_dL": 0.0, "Triglycerides_mg_dL": 0.0,
    "Systolic_BP_mmHg": 0.0, "Diastolic_BP_mmHg": 0.0, "Hypertension": 0,
    "Diabetes": 0, "Resting_Heart_Rate_bpm": 0.0, "Chest_Pain": 0,
    "Shortness_of_Breath": 0, "Fatigue": 0, "Palpitations": 0, "Dizziness": 0,
    "Exercise_Induced_Angina": 0, "Iron_Diet": 0, "Menstruation": 0, "Pregnancy": 0,
    "Chronic_Illness": 0, "Bleeding_Risk": 0, "Pale_Skin": 0, "Hemoglobin_g_dL": 0.0,
    "MCV_fL": 0.0, "Ferritin_ng_mL": 0.0, "Vitamin_B12_pg_mL": 0.0,
    "Previous_Liver_Disease": 0, "Hepatitis_Risk_Indicator": 0, "Abdominal_Pain": 0,
    "Nausea": 0, "Dark_Urine": 0, "Pale_Stool": 0, "Yellow_Eyes_or_Skin": 0,
    "Total_Bilirubin_mg_dL": 0.0, "AST_U_L": 0.0, "ALT_U_L": 0.0, "ALP_U_L": 0.0,
}


def has_term(values: list[str], *terms: str) -> int:
    text = " ".join(values).lower().replace("_", " ")
    return int(any(term in text for term in terms))


def to_model_features(payload: dict[str, Any]) -> dict[str, Any]:
    symptoms = [str(value) for value in payload.get("symptoms", [])]
    lifestyle = [str(value) for value in payload.get("lifestyle", [])]
    family_history = [str(value) for value in payload.get("familyHistory", [])]
    features = FEATURE_DEFAULTS.copy()
    features.update({
        "Age": payload.get("age", 30),
        "Sex": payload.get("sex", "Other"),
        "BMI": payload.get("bmi") or 22.0,
        "Total_Cholesterol_mg_dL": payload.get("total_cholesterol") or 0.0,
        "LDL_mg_dL": payload.get("ldl") or 0.0,
        "HDL_mg_dL": payload.get("hdl") or 0.0,
        "Triglycerides_mg_dL": payload.get("triglycerides") or 0.0,
        "Chest_Pain": has_term(symptoms, "chest pain"),
        "Shortness_of_Breath": has_term(symptoms, "shortness of breath"),
        "Fatigue": has_term(symptoms, "fatigue", "weak"),
        "Dizziness": has_term(symptoms, "dizziness"),
        "Yellow_Eyes_or_Skin": has_term(symptoms, "yellow"),
        "Smoking_Status": "Smoker" if has_term(lifestyle, "smoking", "smoker") else "Non-smoker",
        "Family_History_Heart_Disease": has_term(family_history, "heart", "cardiac", "cvd"),
        "Family_History_Anaemia": has_term(family_history, "anaemia", "anemia"),
        "Family_History_Liver_Disease": has_term(family_history, "liver", "jaundice"),
    })
    return features


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/v1/predict")
def predict(payload: dict[str, Any]) -> dict[str, Any]:
    return predict_health_risks(to_model_features(payload))


@app.post("/api/v1/ecg/analyze")
def ecg_analyze(payload: dict[str, Any]) -> dict[str, Any]:
    """Analyze a single-lead ECG waveform sent as JSON.

    Body: {"fs": 1000, "samples": [int16, ...], "use_model": true}
    Screening-grade rhythm/HRV/morphology only — see the response disclaimer.
    """
    fs = float(payload.get("fs", 1000))
    samples = payload.get("samples") or []
    if not samples:
        return {"error": "no samples provided"}
    import numpy as np
    return analyze_ecg(np.asarray(samples, dtype=float), fs,
                       use_model=bool(payload.get("use_model", True)))


@app.post("/api/v1/ecg/analyze/raw")
async def ecg_analyze_raw(request: Request,
                          fs: float = Query(1000.0),
                          use_model: bool = Query(True)) -> dict[str, Any]:
    """Same as /ecg/analyze but the body is raw little-endian int16 samples."""
    body = await request.body()
    return analyze_i16_le(body, fs, use_model=use_model)


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("api_server:app", host="0.0.0.0", port=port, reload=False)