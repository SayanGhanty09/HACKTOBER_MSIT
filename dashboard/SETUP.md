# Dashboard — setup & run

The clinician dashboard (React + Vite) and its FastAPI ML risk server. Extracted
from the hackathon `IEMHACKS4.0-main` dump into this clean folder.

```
dashboard/
├── src/            # React app (pages, contexts, BLE client, i18n)
├── public/         # static assets + service worker
├── ml_server/      # FastAPI risk-prediction server + joblib models
├── .env.example    # required frontend env vars
└── supabase_schema.sql
```

---

## 1. Frontend

Requires **Node 20.19+** (or 22.12+). Vite 7 warns on older Node.

```bash
cd dashboard
npm install
cp .env.example .env.local     # then fill in the values
npm run dev                    # http://localhost:5173
npm run build                  # tsc -b && vite build
npm run lint                   # eslint .
npm run preview                # serve dist/
```

`.env.local` (gitignored) needs:

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_EMAILJS_USER_ID=
VITE_EMAILJS_SERVICE_ID=
VITE_EMAILJS_TEMPLATE_ID=
```

Web Bluetooth and geolocation require a **secure context** (localhost is fine).

---

## 2. ML server

The Results page POSTs to `http://localhost:8000/api/v1/predict`. Models were
trained with **scikit-learn 1.8.0**, which needs **Python ≥ 3.11**.

With [`uv`](https://docs.astral.sh/uv/) (recommended — it can provision 3.11):

```bash
cd dashboard/ml_server
uv venv --python 3.11 .venv
uv pip install -r requirements.txt
.venv/bin/python -m uvicorn api_server:app --host 0.0.0.0 --port 8000
```

Or with a system Python 3.11+:

```bash
cd dashboard/ml_server
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn api_server:app --host 0.0.0.0 --port 8000
```

Endpoints:

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | liveness → `{"status":"ok"}` |
| POST | `/api/v1/predict` | body `{age, sex, symptoms[], lifestyle[], familyHistory[], ...labs}` → 4 risk probabilities + categories |

CORS is restricted to `http://localhost:5173` / `http://127.0.0.1:5173`.

Quick check:

```bash
curl -s http://localhost:8000/health
curl -s -X POST http://localhost:8000/api/v1/predict \
  -H 'Content-Type: application/json' \
  -d '{"age":52,"sex":"Male","symptoms":["chest pain"],"lifestyle":["smoking"],"familyHistory":["heart"]}'
```

---

## 3. Notes

- `ml_server/` also contains `train_models.py`, `inspect_dataset.py`, and the
  training dataset (`Unified_AI_Health_4_Disease_Dataset_Continuous_Risk.xlsx`).
- `supabase_schema.sql` sets up the `doctors` / `patients` / `recordings` tables.
- Lint has pre-existing issues from the hackathon code; the production build
  (`npm run build`) passes.
