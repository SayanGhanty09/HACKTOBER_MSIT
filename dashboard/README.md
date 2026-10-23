## AI Health Prediction System
YOUTUBE VIDEO LINK: https://youtu.be/SbHb0g1E7Z4?si=yUlEdUGTuoo_Ddxl

## 🩺 Why We Are Building Anibilin

**Anibilin is a non-invasive blood scanner designed to bring basic health screening closer to the people who need it most.**

In rural and semi-urban India, timely diagnostic testing is often limited by distance, cost, overloaded Primary Health Centres, and lack of accessible digital tools. As a result, conditions such as **anaemia, diabetes, hypertension, and cardiovascular problems** may remain undetected until symptoms become serious.

We are building Anibilin to enable **fast, accessible, and non-invasive preliminary screening**, helping frontline healthcare workers identify potential health risks earlier and make better-informed decisions.

> **Our vision: Detect earlier. Reach farther. Save more lives.**


## 💻 Hardware AI — On-Device Biomarker Estimation

The hardware component of **Anibilin** is powered by an **ESP32-S3** and is designed to estimate important health biomarkers directly on the device.

Instead of sending raw sensor data to a cloud server, the system processes the optical signals locally and performs lightweight machine-learning calculations on the ESP32-S3.

### 🩺 Biomarkers Estimated

The hardware currently focuses on:

* 🫁 **SpO₂**
* ❤️ **Heart Rate**
* 🩸 **Hemoglobin (Hb)**
* 🟡 **Bilirubin**

---

## ⚙️ How It Works

The device uses a **multispectral optical sensing system** to collect information from different wavelengths of light.

The general pipeline is:

```text
Optical Sensor
      ↓
Raw Signal Acquisition
      ↓
Signal Processing
      ↓
Feature Extraction
      ↓
On-Device ML Models
      ↓
Biomarker Estimation
```

The important part is that the ML inference happens **directly on the ESP32-S3**, allowing the device to operate without depending on cloud-based computation.

---

## 🧠 On-Device Machine Learning

Different biomarkers require different levels of mathematical processing.

### 1. Simple Calibration Models

For measurements such as **SpO₂ and Heart Rate**, the system uses lightweight calibration models based on key characteristics extracted from the optical signal.

These models are computationally inexpensive and suitable for real-time execution on the ESP32-S3.

### 2. Multispectral Regression Models

For more complex biomarkers such as **Hemoglobin and Bilirubin**, the system uses multiple optical features obtained from different wavelengths.

A regression-based ML approach combines these features to estimate the corresponding biomarker value.

This helps the system account for variations caused by factors such as:

* Skin pigmentation
* Tissue properties
* Optical scattering
* Sensor conditions
* Individual physiological differences

The exact feature engineering, wavelength combinations, calibration parameters, and trained coefficients are part of our **proprietary implementation** and are not disclosed in this repository.

---

## 🚀 Edge AI Architecture

```text
              Multispectral Sensor
                       │
                       ▼
               ESP32-S3 Processor
                       │
              ┌────────┴────────┐
              │                 │
       Signal Processing   Feature Extraction
              │                 │
              └────────┬────────┘
                       ▼
                 ML Inference
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
        SpO₂       Hemoglobin    Bilirubin
          │            │            │
          └────────────┴────────────┘
                       │
                       ▼
               Local Health Data
```

---

## ⭐ Why On-Device AI?

Running the ML models directly on the ESP32-S3 provides several advantages:

* ⚡ Real-time processing
* 🔒 Reduced dependency on cloud services
* 📡 Can operate with limited connectivity
* 💾 Low computational and memory requirements
* 🔋 Suitable for portable devices
* 🧠 Edge-based AI inference

---

## 🔬 Our Approach

The key idea behind Anibilin is to combine:

**Multispectral sensing + Signal Processing + Edge AI**

to create a compact system capable of estimating multiple biomarkers from optical measurements.

Rather than relying on a single sensor reading, the system analyzes information across multiple optical channels and uses trained models to obtain more meaningful estimations.

> 🔐 **Implementation Note:** The detailed optical feature engineering, sensor configuration, calibration methodology, regression coefficients, and model parameters are intentionally not published to protect the project's intellectual property.

---

## ⚠️ Research Disclaimer

Anibilin is currently a **research and engineering prototype**. The estimated biomarker values are not intended to replace laboratory blood tests, professional medical evaluation, or clinically validated diagnostic equipment.
##
##
##

## 💻 Software 
The software component of the project uses a **machine-learning based health risk prediction system** to estimate the risk of four major health conditions:

* 🧪 **High Cholesterol**
* ❤️ **Heart Disease**
* 🩸 **Anaemia**
* 🟡 **Jaundice**

The system processes patient demographic information, lifestyle factors, symptoms, family history, vital signs, and laboratory measurements through a customized ML preprocessing pipeline.

---

### 🧠 Input Feature Space

The ML pipeline uses **48 input features**, divided into numerical and categorical features.

#### 📊 Numerical Features — 37

**Demographics & Vital Signs**

```text
Age
BMI
Sleep_Hours
Systolic_BP_mmHg
Diastolic_BP_mmHg
Resting_Heart_Rate_bpm
```

**Symptoms**

```text
Chest_Pain
Shortness_of_Breath
Fatigue
Palpitations
Dizziness
Exercise_Induced_Angina
Abdominal_Pain
Nausea
Dark_Urine
Pale_Stool
Yellow_Eyes_or_Skin
Pale_Skin
```

**Underlying Conditions & Risk Factors**

```text
Hypertension
Diabetes
Pregnancy
Chronic_Illness
Bleeding_Risk
Previous_Liver_Disease
Hepatitis_Risk_Indicator
```

**Biomarkers & Laboratory Measurements**

```text
Total_Cholesterol_mg_dL
LDL_mg_dL
HDL_mg_dL
Triglycerides_mg_dL
Hemoglobin_g_dL
MCV_fL
Ferritin_ng_mL
Vitamin_B12_pg_mL
Total_Bilirubin_mg_dL
AST_U_L
ALT_U_L
ALP_U_L
```

#### 🔤 Categorical Features — 11

**Lifestyle & Demographics**

```text
Sex
Smoking_Status
Physical_Activity
Diet_Quality
Alcohol_Use
Iron_Diet
Menstruation
```

**Family History**

```text
Family_History_High_Cholesterol
Family_History_Heart_Disease
Family_History_Anaemia
Family_History_Liver_Disease
```

---

### ⚙️ Data Preprocessing

Each model uses a customized `ColumnTransformer` pipeline.

**Numerical Features**

* Missing values → Median Imputation
* Feature scaling → `StandardScaler`

**Categorical Features**

* Missing values → `"None"` / most-frequent imputation
* Encoding → `OneHotEncoder`

This ensures that raw patient data can be directly passed through the same preprocessing pipeline used during training.

---

### 🤖 ML Model Architecture

Four independent models are used for the four health conditions:

| Health Condition | ML Model             | Configuration                                    |
| ---------------- | -------------------- | ------------------------------------------------ |
| 🧪 Cholesterol   | `LogisticRegression` | `C=1.0`, `solver=lbfgs`                          |
| ❤️ Heart Disease | `LogisticRegression` | `C=1.0`, `solver=lbfgs`                          |
| 🩸 Anaemia       | `XGBClassifier`      | `n_estimators=100`                               |
| 🟡 Jaundice      | `LogisticRegression` | `C=1.0`, `solver=lbfgs`, `class_weight=balanced` |

All models use:

```text
random_state = 42
```

The models were selected after comparing candidate architectures using stratified evaluation.

---

### 📈 Risk Prediction

Instead of returning only a binary `0` or `1`, the system generates a **continuous risk probability between 0 and 1** using model probability prediction.

Example:

```text
Cholesterol Risk     → 0.82
Heart Disease Risk   → 0.64
Anaemia Risk         → 0.21
Jaundice Risk        → 0.08
```

#### Risk Classification

| Risk Probability | Category     |
| ---------------: | ------------ |
|    `0.00 – 0.29` | 🟢 Low       |
|    `0.30 – 0.59` | 🟡 Moderate  |
|    `0.60 – 0.79` | 🟠 High      |
|    `0.80 – 1.00` | 🔴 Very High |

---

### 🔄 Software Pipeline

```text
                    Patient Data
                         │
                         ▼
                ┌─────────────────┐
                │ Data Preprocess  │
                └────────┬────────┘
                         │
              ┌──────────┴──────────┐
              │                     │
        Numerical Data        Categorical Data
              │                     │
       Median + Scaling       Imputation + Encoding
              │                     │
              └──────────┬──────────┘
                         ▼
                  Feature Pipeline
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
     Cholesterol       Heart         Anaemia
       Model           Model          Model
          │              │              │
          └──────────────┼──────────────┘
                         ▼
                    Jaundice Model
                         │
                         ▼
                  Risk Probability
                       0 → 1
                         │
                         ▼
                   Risk Category
```

---

### 🛠️ Software Technologies

```text
Python
Scikit-learn
XGBoost
Pandas
NumPy
OpenPyXL
Joblib
FastAPI
```

### ⚠️ Disclaimer

> **This AI system is a software prototype designed for research and educational purposes. The generated risk scores are model-based estimates and should not be considered medical diagnoses or a replacement for professional medical consultation.**
