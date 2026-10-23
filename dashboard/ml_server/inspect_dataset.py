# inspect_dataset.py
import pandas as pd

excel_path = "Unified_AI_Health_4_Disease_Dataset_Continuous_Risk.xlsx"
df = pd.read_excel(excel_path)
print(f"Shape: {df.shape}")
print("\nMissing values:")
missing = df.isnull().sum()
print(missing[missing > 0])

print("\nCategorical columns unique values:")
for col in df.select_dtypes(include=['object']).columns:
    if col != 'Patient_ID':
        print(f"{col}: {df[col].dropna().unique()} (Missing: {df[col].isnull().sum()})")
