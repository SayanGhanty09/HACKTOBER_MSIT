# train_models.py
import os
import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import StandardScaler, OneHotEncoder
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, roc_auc_score, average_precision_score
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from xgboost import XGBClassifier
import joblib

# 1. Load dataset
excel_path = os.path.join(os.path.dirname(__file__), "Unified_AI_Health_4_Disease_Dataset_Continuous_Risk.xlsx")
print(f"Reading dataset from {excel_path}...")
df = pd.read_excel(excel_path)
print(f"Loaded dataset of shape: {df.shape}")

# 2. Define targets and leakage columns to drop
targets = {
    'cholesterol': 'Cholesterol',
    'heart_disease': 'Heart_Disease',
    'anaemia': 'Anaemia',
    'jaundice': 'Jaundice'
}

leakage_cols = [
    'Patient_ID',
    'Cholesterol_Risk_Factor_Score', 'Heart_Disease_Risk_Factor_Score', 'Anaemia_Risk_Factor_Score', 'Jaundice_Risk_Factor_Score',
    'High_Cholesterol', 'Heart_Disease', 'Anaemia', 'Jaundice',
    'Cholesterol_Risk_Probability', 'Cholesterol_Risk_Risk_Percent',
    'Heart_Disease_Risk_Probability', 'Heart_Disease_Risk_Risk_Percent',
    'Anaemia_Risk_Probability', 'Anaemia_Risk_Risk_Percent',
    'Jaundice_Risk_Probability', 'Jaundice_Risk_Risk_Percent'
]

# Features X (drop target and leakage columns)
X = df.drop(columns=[col for col in leakage_cols if col in df.columns])

# Identify feature types
numeric_cols = X.select_dtypes(include=['int64', 'float64']).columns.tolist()
categorical_cols = X.select_dtypes(include=['object']).columns.tolist()

print(f"\nFeature count: {X.shape[1]}")
print(f"Numerical features ({len(numeric_cols)}): {numeric_cols}")
print(f"Categorical features ({len(categorical_cols)}): {categorical_cols}")

# Preprocessing pipelines
preprocessor = ColumnTransformer(
    transformers=[
        ('num', Pipeline([
            ('imputer', SimpleImputer(strategy='median')),
            ('scaler', StandardScaler())
        ]), numeric_cols),
        ('cat', Pipeline([
            ('imputer', SimpleImputer(strategy='constant', fill_value='None')),
            ('onehot', OneHotEncoder(handle_unknown='ignore'))
        ]), categorical_cols)
    ]
)

# Models to evaluate
classifiers = {
    'Logistic Regression': LogisticRegression(max_iter=1000, random_state=42),
    'Random Forest': RandomForestClassifier(random_state=42, n_estimators=100),
    'XGBoost': XGBClassifier(random_state=42, use_label_encoder=False, eval_metric='logloss', n_estimators=100)
}

best_models = {}
metrics_report = []

# Train and evaluate models for each disease
for disease_key, target_col in targets.items():
    print(f"\n==================================================")
    print(f"TRAINING MODELS FOR: {target_col}")
    print(f"==================================================")
    
    y = df[target_col]
    
    # 80/20 Stratified train-test split
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.20, stratify=y, random_state=42
    )
    
    # Determine if we are training Jaundice model for special handling
    is_jaundice = disease_key == 'jaundice'
    
    disease_results = {}
    best_roc_auc = -1
    best_clf_name = None
    best_pipeline = None
    
    for clf_name, clf in classifiers.items():
        # Apply class weighting / hyperparameter tweaks for Jaundice
        if is_jaundice:
            if clf_name == 'Logistic Regression':
                # Balanced class weights
                clf = LogisticRegression(max_iter=1000, random_state=42, class_weight='balanced')
            elif clf_name == 'Random Forest':
                # Increase trees and balanced class weight
                clf = RandomForestClassifier(random_state=42, n_estimators=200, class_weight='balanced')
            elif clf_name == 'XGBoost':
                # Compute scale_pos_weight based on training data distribution
                pos = sum(y_train == 1)
                neg = sum(y_train == 0)
                scale_pos_weight = (neg / pos) if pos > 0 else 1
                clf = XGBClassifier(random_state=42, use_label_encoder=False, eval_metric='logloss', n_estimators=200, scale_pos_weight=scale_pos_weight)
        
        print(f"Evaluating {clf_name}...")
        
        # Create pipeline
        pipeline = Pipeline([
            ('preprocessor', preprocessor),
            ('classifier', clf)
        ])
        
        # Fit model
        pipeline.fit(X_train, y_train)
        
        # Predict
        y_pred = pipeline.predict(X_test)
        y_prob = pipeline.predict_proba(X_test)[:, 1]
        
        # Calculate metrics
        acc = accuracy_score(y_test, y_pred)
        prec = precision_score(y_test, y_pred, zero_division=0)
        rec = recall_score(y_test, y_pred, zero_division=0)
        f1 = f1_score(y_test, y_pred, zero_division=0)
        roc_auc = roc_auc_score(y_test, y_prob)
        pr_auc = average_precision_score(y_test, y_prob)
        
        print(f" -> Accuracy: {acc:.4f} | Precision: {prec:.4f} | Recall: {rec:.4f} | F1: {f1:.4f} | ROC-AUC: {roc_auc:.4f} | PR-AUC: {pr_auc:.4f}")
        
        metrics_report.append({
            'Disease': target_col,
            'Model': clf_name,
            'Accuracy': acc,
            'Precision': prec,
            'Recall': rec,
            'F1': f1,
            'ROC-AUC': roc_auc,
            'PR-AUC': pr_auc
        })
        
        # Select best model based on ROC-AUC
        if roc_auc > best_roc_auc:
            best_roc_auc = roc_auc
            best_clf_name = clf_name
            best_pipeline = pipeline
            
    print(f"\nBest model for {target_col}: {best_clf_name} (ROC-AUC: {best_roc_auc:.4f})")
    best_models[disease_key] = best_pipeline
    
    # Save the best model
    model_filename = f"{disease_key}_model.joblib"
    joblib.dump(best_pipeline, model_filename)
    print(f"Saved best model to {model_filename}")

# Print final comparison table
report_df = pd.DataFrame(metrics_report)
print("\n==================================================")
print("FINAL MODEL COMPARISON SUMMARY")
print("==================================================")
print(report_df.to_string(index=False))

# Create predict.py code contents
predict_py_content = """# predict.py
import os
import joblib
import pandas as pd

# Load models on module import
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS = {}
DISEASE_KEYS = ['cholesterol', 'heart_disease', 'anaemia', 'jaundice']

for key in DISEASE_KEYS:
    model_path = os.path.join(BASE_DIR, f"{key}_model.joblib")
    if os.path.exists(model_path):
        MODELS[key] = joblib.load(model_path)
    else:
        print(f"Warning: Model file not found at {model_path}")

def get_risk_category(prob):
    \"\"\"
    Assign risk categories based on continuous probability:
    0.00-0.29 = Low
    0.30-0.59 = Moderate
    0.60-0.79 = High
    0.80-1.00 = Very High
    \"\"\"
    if prob <= 0.29:
        return "Low"
    elif prob <= 0.59:
        return "Moderate"
    elif prob <= 0.79:
        return "High"
    else:
        return "Very High"

def predict_health_risks(patient_data):
    \"\"\"
    Predicts continuous risks and categorical ranges for:
    High Cholesterol, Heart Disease, Anaemia, Jaundice.
    
    patient_data can be a dictionary of features or a list of dictionaries.
    \"\"\"
    if isinstance(patient_data, dict):
        df = pd.DataFrame([patient_data])
    else:
        df = pd.DataFrame(patient_data)
        
    results = {}
    
    # Run predictions
    for key in DISEASE_KEYS:
        model = MODELS.get(key)
        if model:
            # Predict probability
            prob = float(model.predict_proba(df)[0, 1])
            results[f"{key}_risk"] = round(prob, 2)
            results[f"{key}_category"] = get_risk_category(prob)
        else:
            results[f"{key}_risk"] = None
            results[f"{key}_category"] = "Unknown"
            
    return results
"""

with open("predict.py", "w") as f:
    f.write(predict_py_content)
print("\nGenerated predict.py file.")
