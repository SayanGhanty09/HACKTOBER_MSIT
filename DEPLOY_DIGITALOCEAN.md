# Deploying Anebilin to DigitalOcean

This guide explains how to deploy the **Anebilin Dashboard** (React 19 + Vite) and the **FastAPI ML & ECG Inference Server** (Python 3.11) to DigitalOcean.

---

> [!IMPORTANT]
> **HTTPS is Required for Medical Telemetry & Bluetooth**  
> Web Bluetooth (connecting to the ESP32-S3 sensor) and Camera access (for OCR vital extraction) **require a secure HTTPS context**.
> DigitalOcean **App Platform** automatically provisions and auto-renews free SSL certificates (`https://...ondigitalocean.app` or your custom domain).

---

## Architecture Overview

1. **Frontend**: React 19 + TypeScript + Vite (`/dashboard`)
   - Pre-rendered static bundle compiled to `dist/`.
   - Talks to Supabase, Google Gemma (Gemini), ElevenLabs TTS, and the local ML backend.
2. **Backend**: Python 3.11 + FastAPI (`/dashboard/ml_server`)
   - Serves ML risk predictions (`/api/v1/predict`) and single-lead ECG signal analysis (`/api/v1/ecg/analyze`).

---

## Method 1: DigitalOcean App Platform (Recommended — 5 Minutes)

App Platform is fully managed, zero-maintenance, includes free automatic SSL, and automatically deploys when you push to GitHub.

### Step 1: Push your code to GitHub
Make sure your GitHub repository (`SayanGhanty09/HACKTOBER_MSIT`) has the latest commits.

### Step 2: Create App on DigitalOcean
1. Log in to [cloud.digitalocean.com](https://cloud.digitalocean.com/).
2. Click **Create** (top right) $\rightarrow$ **Apps**.
3. Select **GitHub** as the source and choose your repository `SayanGhanty09/HACKTOBER_MSIT`.
4. Select the `main` branch and leave **Autodeploy** checked.

### Step 3: Configure Components
DigitalOcean will automatically detect `.do/app.yaml` in this repository, which pre-configures both components:

1. **Static Site (`dashboard`)**:
   - **Source Directory**: `dashboard`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
   - **Routes**: `/`

2. **Web Service (`ml-server`)**:
   - **Source Directory**: `dashboard/ml_server`
   - **Build Command**: `pip install -r requirements.txt`
   - **Run Command**: `uvicorn api_server:app --host 0.0.0.0 --port 8000`
   - **HTTP Port**: `8000`
   - **Health Check Path**: `/health`
   - **Plan**: Basic ($5/mo, 512 MB RAM / 1 vCPU)

### Step 4: Configure Environment Variables
In the App Platform dashboard under **Settings** $\rightarrow$ **App-Level Environment Variables**, add your keys:

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL (`https://....supabase.co`) |
| `VITE_SUPABASE_ANON_KEY` | Supabase Anon public key |
| `VITE_ML_BASE_URL` | Backend URL (e.g. `${ml-server.PUBLIC_URL}`) |
| `VITE_GEMINI_API_KEY` | Google AI Studio key for Gemma 4 visual ECG |
| `VITE_ELEVENLABS_API_KEY` | ElevenLabs API key for voice synthesis |
| `VITE_OPENROUTER_API_KEY` | OpenRouter key (optional) |
| `CORS_ORIGINS` | `*` (or your frontend URL) |

### Step 5: Click Deploy
App Platform will build the React frontend and deploy the Python container. In ~2 minutes, your site will be live with a secure `https://` address!

---

## Method 2: DigitalOcean Droplet (Docker Compose VPS)

If you prefer running on a single $4–$6/month Ubuntu Droplet with Docker:

### Step 1: Create an Ubuntu Droplet
1. Go to **Droplets** $\rightarrow$ **Create Droplet**.
2. Choose **Ubuntu 24.04 LTS**.
3. Choose the **Basic** plan ($4 or $6/mo with 1 GB RAM).
4. Add your SSH key or root password and create the Droplet.

### Step 2: SSH into the Droplet & Install Docker
Open your terminal and connect:
```bash
ssh root@<YOUR_DROPLET_IP>
```

Install Docker and Docker Compose plugin:
```bash
apt update && apt upgrade -y
apt install -y docker.io docker-compose-v2 git
systemctl enable --now docker
```

### Step 3: Clone Repository & Set Environment Variables
```bash
git clone https://github.com/SayanGhanty09/HACKTOBER_MSIT.git /var/www/anebilin
cd /var/www/anebilin
```

Create `dashboard/.env.production` (or `.env.local`):
```bash
cat << 'EOF' > dashboard/.env.production
VITE_SUPABASE_URL=https://ksjzicoilswrbkbqvnia.supabase.co
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_ML_BASE_URL=
VITE_GEMINI_API_KEY=your_gemini_key
VITE_ELEVENLABS_API_KEY=your_elevenlabs_key
EOF
```

### Step 4: Launch Containers with Docker Compose
```bash
docker compose up -d --build
```
This builds:
- `backend` on port `8000` (FastAPI)
- `frontend` on port `80` (Nginx serving React with `/api/` proxying to `backend`)

Verify running status:
```bash
docker compose ps
curl http://localhost/health
```

### Step 5: Enable Free SSL with Certbot (Mandatory for Bluetooth)
If you have a domain pointed to your Droplet IP (e.g. `app.yourdomain.com`):
```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d app.yourdomain.com
```
Certbot will configure HTTPS and auto-renew certificates, giving you full Web Bluetooth and camera support.
