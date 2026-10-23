# 🩺 ANEBILIN — Non-Invasive Biomarker & Multimodal ECG Screening System

[![DigitalOcean App Platform](https://img.shields.io/badge/Deploy-DigitalOcean-blue?logo=digitalocean)](DEPLOY_DIGITALOCEAN.md)
[![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688?logo=fastapi)](dashboard/ml_server)
[![React 19](https://img.shields.io/badge/Frontend-React%2019-61DAFB?logo=react)](dashboard)
[![Google Gemini / Gemma](https://img.shields.io/badge/Vision%20AI-Gemma%20%2F%20Gemini%203.8-4285F4?logo=google)](dashboard/src/utils/gemmaClient.ts)
[![ElevenLabs TTS](https://img.shields.io/badge/Voice%20AI-ElevenLabs%20TTS-black)](dashboard/src/utils/elevenLabsClient.ts)

**ANEBILIN** is an end-to-end non-invasive biometric and cardiac screening platform designed for point-of-care diagnostics, combining custom ESP32-S3 firmware, multimodal visual AI waveform analysis, neural text-to-speech feedback, and cloud deployment.

---

## 🚀 Key Features

### 1. 🫀 Multimodal Visual ECG Analysis (Google Gemma & Gemini 3.8 Flash)
- **Computer Vision Waveform Morphology**: Direct visual waveform evaluation from Lead I snapshots to identify P-wave presence, QRS sharpness, isoelectric baseline drift, and ectopic beats.
- **Pictorial Component Breakdown**: Visual diagnostic status cards for Atrial P-Wave, Ventricular QRS, T-Wave/ST Segment, and Isoelectric Baseline with color-coded safety indicators.
- **High-Speed Inference**: Sub-second multimodal assessment with intelligent caching and telemetry fallback.

### 2. 🗣️ ElevenLabs Neural Voice Synthesis
- **Clinical Audio Readouts**: High-fidelity text-to-speech for ECG summary assessments, AI Assistant chat, OCR vital extractions, and live screening reports.
- **Voice Profiles**: Choose between Rachel (Medical Default), Adam, Antoni, Bella, or Callum in Settings with instant audio testing.
- **Resilient Fallback**: Seamless automatic handover to browser Web Speech Synthesis if an API key is restricted or offline.

### 3. 🔬 Photometric Biomarker & ECG Hardware (ESP32-S3)
- **Multi-Wavelength Photometry**: AMS AS7343 spectral sensor driving SpO2, Heart Rate, HRV, Hemoglobin (Hb), and Bilirubin estimation via an AC/DC photometric ratio pipeline.
- **Single-Lead ECG Capture**: AD8232 analog front-end capturing up to 1000 Hz diagnostic ECG telemetry.
- **Bluetooth Low Energy (BLE)**: Custom GATT protocol (FFF0 service) transmitting 32-byte real-time packets and buffered chunk streams.

### 4. 🌐 Modern Clinician Dashboard
- **React 19 + TypeScript + Vite**: Responsive interface for telemetry monitoring, patient CRUD, historical recording review, and regional population analytics.
- **Vital OCR Capture**: Camera-based extraction of vitals from physical monitors and lab sheets.
- **Audio Assistant**: Multilingual AI chat assistant with speech recognition and speech output.

### 5. ☁️ DigitalOcean Deployment
- **1-Click App Platform**: Pre-configured [`.do/app.yaml`](.do/app.yaml) for automated zero-downtime deployment with free SSL (mandatory for Web Bluetooth).
- **Docker Compose Stack**: Turnkey [`docker-compose.yml`](docker-compose.yml) running production Nginx and FastAPI containers.
- Step-by-step guide: [DEPLOY_DIGITALOCEAN.md](DEPLOY_DIGITALOCEAN.md).

---

## 📁 Repository Structure

```
ANEBILIN/
├── .do/app.yaml              # DigitalOcean App Platform specification
├── docker-compose.yml        # Production Docker orchestration
├── DEPLOY_DIGITALOCEAN.md    # DigitalOcean deployment guide
├── platformio.ini            # ESP32-S3 PlatformIO firmware configuration
├── src/main.cpp              # Firmware entry (sensor loop, OLED, BLE)
├── lib/                      # Firmware drivers (AS7343, AD8232 ECG, AnebilModel)
└── dashboard/                # Clinician Web Application & ML Server
    ├── src/                  # React 19 frontend
    ├── ml_server/            # Python FastAPI inference server
    ├── Dockerfile            # Production Nginx multi-stage build
    └── nginx.conf            # SPA routing & API reverse proxy
```

---

## 🛠️ Quick Start

### 1. Web Dashboard & ML Server
```bash
# Terminal 1: Start ML Server
cd dashboard/ml_server
pip install -r requirements.txt
python api_server.py

# Terminal 2: Start React Frontend
cd dashboard
npm install
npm run dev
```
Open [http://localhost:5173](http://localhost:5173).

### 2. DigitalOcean Deployment
See the full guide in [DEPLOY_DIGITALOCEAN.md](DEPLOY_DIGITALOCEAN.md).
