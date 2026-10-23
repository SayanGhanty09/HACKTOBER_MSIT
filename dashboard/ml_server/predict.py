# predict.py
import os
import joblib
import pandas as pd

# Load models on module import
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS = {}
DISEASE_KEYS = ['cholesterol', 'heart_disease', 'anaemia', 'jaundice']

for key in DISEASE_KEYS:
    model_path = os.path.join(BASE_DIR, f"{key}_model.joblib")
    if not os.path.exists(model_path):
        print(f"Warning: Model file not found at {model_path}")
        continue
    try:
        MODELS[key] = joblib.load(model_path)
    except Exception as exc:
        # e.g. an XGBoost model when xgboost isn't installed. Don't let one
        # missing dependency take down the whole API (the ECG analyzer still runs).
        print(f"Warning: could not load {key} model ({exc}); using rule-based fallback")

def get_risk_category(prob):
    """
    Assign risk categories based on continuous probability:
    0.00-0.29 = Low
    0.30-0.59 = Moderate
    0.60-0.79 = High
    0.80-1.00 = Very High
    """
    if prob <= 0.29:
        return "Low"
    elif prob <= 0.59:
        return "Moderate"
    elif prob <= 0.79:
        return "High"
    else:
        return "Very High"

def predict_health_risks(patient_data):
    """
    Predicts continuous risks and categorical ranges for:
    High Cholesterol, Heart Disease, Anaemia, Jaundice.
    
    patient_data can be a dictionary of features or a list of dictionaries.
    """
    if isinstance(patient_data, dict):
        df = pd.DataFrame([patient_data])
    else:
        df = pd.DataFrame(patient_data)
        
    results = {}
    
    # Run predictions
    for key in DISEASE_KEYS:
        model = MODELS.get(key)
        if model:
            try:
                # Predict probability
                prob = float(model.predict_proba(df)[0, 1])
                results[f"{key}_risk"] = round(prob, 2)
                results[f"{key}_category"] = get_risk_category(prob)
            except Exception:
                model = None # trigger fallback
        
        if not model:
            # Offline rule-based fallback
            prob = 0.1
            age = df.get('age', pd.Series([30])).iloc[0]
            symptoms = str(df.get('symptoms', pd.Series([''])).iloc[0]).lower()
            
            if key == 'heart_disease':
                if age > 50: prob += 0.3
                if 'chest pain' in symptoms: prob += 0.4
            elif key == 'anaemia':
                if 'fatigue' in symptoms or 'weak' in symptoms: prob += 0.4
            elif key == 'jaundice':
                if 'yellow' in symptoms: prob += 0.6
                
            prob = min(prob, 0.99)
            results[f"{key}_risk"] = round(prob, 2)
            results[f"{key}_category"] = get_risk_category(prob)
            
    return results
