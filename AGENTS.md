# AGENTS.md — ANEBILIN

Onboarding + operating guide for AI agents working in this repository. Read this
first. It is the map; the linked files are the territory.

---

## 1. What this project is

**ANEBILIN** is a non-invasive biomarker screening system with two halves that
talk over Bluetooth Low Energy:

1. **Firmware** — an ESP32-S3 device driving an **ams AS7343** spectral sensor,
   a small SSD1306 OLED, and an external 855 nm NIR LED. It estimates
   **SpO2, heart rate + HRV, hemoglobin, and bilirubin** from reflectance +
   transmission photometry using an AC/DC ratio pipeline. Blood pressure (SBP/DBP)
   is a **stub that emits `NaN`**.
2. **Website** — a React 19 + TypeScript dashboard for clinicians: BLE device
   control, live vital capture, patient records, recording history, and
   population/regional analytics.

The measurement is **screening-grade, not a medical device**. Do not describe it
as diagnostic in code, copy, or docs.

Firmware is a descendant of an earlier project called **spectru**; the reference
source is preserved under `resources/spectru/` and is useful for algorithm
comparison, but it is *not* the build target.

---

## 2. Repository map

```
ANEBILIN2/
├── platformio.ini            # PlatformIO build (env: esp32-s3-devkitc-1, Arduino)
├── src/main.cpp              # Firmware entry: sensor loop, CLI, OLED, touch, power, BLE glue
├── lib/
│   ├── AS7343/               # Custom AS7343 driver (SMUX, LED, 6-channel reads)
│   ├── ECG/                  # AD8232 single-lead ECG capture + buffered chunk fetch
│   │   └── ECGManager.{h,cpp}
│   └── AnebilModel/          # Signal processing + biomarker model + BLE
│       ├── AnebilModel.{h,cpp}      # 15-feature RLS model (legacy diagnostic surface)
│       ├── SignalFilter.h           # 1st-order IIR DC/AC split per channel
│       ├── BiomarkerEngine.{h,cpp}  # SpO2/HR/Hb/Bili AC-DC pipeline (primary)
│       ├── LinearCalibrator.h       # OLS y = m·x + c (SpO2, HR)
│       ├── MultiCalibrator.h        # Ridge multivariate OLS (Hb, Bili)
│       └── BLEManager.{h,cpp}       # NimBLE GATT server (FFF0 service)
├── website/                  # OLD React dashboard (stale — superseded by dashboard/)
├── dashboard/                # Current React + Vite dashboard + FastAPI ML server
│   ├── src/                  # React app (pages, contexts, BLE client, i18n)
│   ├── ml_server/            # FastAPI risk-prediction server + joblib models
│   └── SETUP.md              # Dashboard + ML server run instructions
├── resources/                # Reference material — NOT built by PlatformIO
│   ├── spectru/              # Upstream reference firmware + stale docs + old web app (juhacks/)
│   └── 7Semi-AS7343/         # Third-party Arduino AS7343 driver (reference only)
├── AUDIT.md                  # AS7343 low-level register/SMUX/LED audit (authoritative for sensor)
├── BLE_FIRMWARE_BRIEF.md     # BLE protocol + behavior contract (authoritative for BLE)
├── ECG_BRIEF.md              # AD8232 ECG capture + FFF4/5/6 BLE protocol (authoritative for ECG)
└── AGENTS.md                 # This file
```

Key authoritative docs:
- **BLE protocol / device behavior** → `BLE_FIRMWARE_BRIEF.md` + `dashboard/src/contexts/BLEContext.tsx`.
- **AS7343 registers, SMUX, LED** → `AUDIT.md`.
- **ECG capture + retrieval** → `ECG_BRIEF.md`.
- **Dashboard + ML server setup/run** → `dashboard/SETUP.md`.

---

## 3. Firmware

### 3.1 Build / flash

PlatformIO project (Arduino framework, ESP32-S3):

```bash
pio run                      # build
pio run -t upload            # flash
pio device monitor -b 115200 # serial CLI (monitor_speed = 115200)
```

`platformio.ini` deps: `Adafruit SSD1306`, `Adafruit GFX`, `Adafruit BusIO`,
`h2zero/NimBLE-Arduino @ ^2.0.0`. Build flags set `CORE_DEBUG_LEVEL=3`,
`ARDUINO_USB_MODE=1`, `ARDUINO_USB_CDC_ON_BOOT=1`.

### 3.2 Hardware / pinout (`src/main.cpp`)

| Function | Pins |
|---|---|
| AS7343 I²C (`Wire`) | SDA 41, SCL 40, 400 kHz, addr `0x39` |
| OLED I²C (`Wire1`) | SDA 11, SCL 12, 128×64, addr `0x3C` |
| NIR LED PWM | GPIO 6 + GPIO 48, 5 kHz, 8-bit |
| Touch pad | GPIO 1 (capacitive) |
| AD8232 ECG | OUTPUT → ADC1 GPIO 8, SDN → GPIO 17 (`TX`/GPIO43 is **not** ADC) |

Default sensor config: integration 100 ms, gain X128, internal LED 7 mA (cap 129).
6-channel custom SMUX: `F1_405, FZ_450, FY_555, F6_640, F7_690, NIR_855`
(must match `AnebilModel::ChannelIdx`).

### 3.3 `main.cpp` structure

- **Modes**: idle, `streaming` (CSV over serial), `bioMode` (live AC/DC engine,
  ~100 ms refresh). A BLE control byte can start/stop `bioMode`.
- **OLED views**: `[1/3]` estimates, `[2/3]` raw ADC/absorbance, `[3/3]` cal status.
  Touch tap cycles views.
- **Touch**: short tap = cycle view; hold ≥1 s then release = continuous scan
  (default 90 s); hold ≥5 s = deep sleep; hold ≥2 s on wake to confirm.
- **Power**: 90 s inactivity → deep sleep (`INACTIVITY_TIMEOUT_MS`). A live BLE
  connection / active scan / active advertising / an open USB-CDC port counts
  as activity and keeps it awake (`main.cpp` loop, `noteActivity()`).
- **Persistence**: runtime settings in NVS namespace `anbset` (magic `0xA7EB0101`);
  AnebilModel in `anbml`; biomarker calibration in `spectru`.
- **Serial CLI**: command reference is documented in the header comment of
  `src/main.cpp:1-63` and `printHelp()`. Highlights:
  - Sensor: `r` (alias `start`) stream, `s` (alias `stop`) stop, `o` one-shot,
    `bio` live engine, `R` resync, `g<0-12>` gain, `i<us>` integration,
    `l<mA>` LED, `n<0-255>` NIR duty, `?` I²C scan. Serial accepts CR, LF, or
    CRLF line endings.
  - Calibration: `cbr`/`cbt`/`cbs` baselines; `c<spo2>,<hb>,<bili>` all-in-one
    training; `cal_spo2|cal_hb|cal_bili|cal_hr <val>`; `cal_fit`, `cal_dump`,
    `cal_reset <hb|bili|spo2|hr|all>`.
  - Config: `scan_dur <s>`, `touch_thr <val>`.
  - ECG: `ecg`/`ecgs` start/stop, `ecgplot` (live serial-plotter stream),
    `ecginfo`, `ecgdump` (CSV), `ecgclr`, `ecgfs <hz>`, `ecg_dur <s>`,
    `ecgpin <adc> <sdn>`.

### 3.4 Signal-processing stack

- `SignalFilter` — 1st-order IIR low-pass at 0.5 Hz splits each of 6 channels
  into DC baseline and pulsatile AC. `alpha` recomputed from actual Fs at `init()`.
- `BiomarkerEngine` — primary estimator. For each λ: `R_λ = EMA(AC)/EMA(DC)`;
  `SpO2 = f(R_red/R_nir)`, `Hb_index = (R_green/R_nir)/(R_red/R_nir)`,
  `Bili_index = (R_blue/R_nir)/(R_red/R_nir)`, HR from band-passed AC_green
  peak detection → median R-R. PI/SQI are diagnostics only (not gated).
  `hrCal`/`spo2Cal` are `LinearCalibrator`; `hbCal`/`biliCal` are
  `MultiCalibrator<10,20>`.
- `AnebilModel` — older 15-feature RLS regressor over reflectance + transmission
  absorbances. Kept as a **legacy diagnostic surface**; it is not the primary
  biomarker path anymore.

### 3.5 BLE GATT protocol (authoritative)

Defined by `lib/AnebilModel/BLEManager.{h,cpp}` and consumed by
`website/src/contexts/BLEContext.tsx`. **If the two ever disagree, the website
code is the contract the firmware must satisfy.**

- **Device name (exact)**: `Anebilin` — the web client filters on this string.
- **Service**: `0000fff0-0000-1000-8000-00805f9b34fb`

| Char | UUID suffix | Properties | Payload |
|---|---|---|---|
| Status | `fff1` | Read + **Indicate** | 1 byte: `0x00` Idle, `0x01` Normal, `0x02` BP |
| Control | `fff2` | Write | 1 byte: `0x00` Stop, `0x01` Start normal, `0x02` Start BP |
| LiveData | `fff3` | Notify | **32 bytes** = 8 × `float32` little-endian |
| ECG Control | `fff4` | Write | 1 byte cmd + optional uint16 LE arg |
| ECG Data | `fff5` | Notify | seq(u16) + n(u16) + n × int16 LE |
| ECG Status | `fff6` | Read + Indicate | 16 bytes: state, flags, fs, count, duration, chunk size |

ECG is a separate record-then-fetch path (default 1000 Hz, 30 s, buffered in
PSRAM/SRAM, 120 samples/chunk). Full contract in `ECG_BRIEF.md`. The dashboard
implements the biomarker path (FFF1–3) in `dashboard/src/contexts/BLEContext.tsx`
and the ECG path (FFF4–6) in the same file, surfaced on the `/ecg` page.

**Normal-mode LiveData layout** (offsets): `0 pi`, `4 sqi`, `8 spo2`, `12 hr`,
`16 sdnn`, `20 rmssd`, `24 hb`, `28 bilirubin`.

**BP-mode LiveData layout**: `0 sbp`, `4 dbp`, `8 pulse_rate`, `12 resp_rate`,
`16–28` reserved zeros. SBP/DBP are `NaN` when uncalibrated — this is the agreed
protocol, **do not substitute 0**.

Behavior rules:
- Publish at ~1 Hz, only while mode ≠ Idle and a client is connected.
- After any Control write, update FFF1 and push an Indicate.
- FFF3 packets must be exactly 32 bytes; the web client drops anything else.
- The 30 s scan timing lives client-side; firmware just honors Control bytes.
- Register a disconnect handler so reconnection works without a power cycle.
- The NimBLE host runs on core 0; the publish task is pinned to core 0 and the
  sensor loop runs on core 1. Control bytes cross cores via a lock-free SPSC
  queue drained by `ble.pollControl()` in `loop()`.

---

## 4. Website

### 4.1 Stack & commands

React 19, TypeScript 5.9, Vite 7, React Router 7, Framer Motion, Recharts,
Leaflet + react-leaflet, Three.js/@react-three, Supabase JS, EmailJS,
lucide-react.

```bash
cd website
npm install
npm run dev       # Vite dev server
npm run build     # tsc -b && vite build
npm run lint      # eslint .
npm run preview   # serve dist/
```

Web Bluetooth and geolocation require a **secure context** (HTTPS or `localhost`).

### 4.2 Routes & providers

`src/main.tsx` → `BrowserRouter` → `App.tsx` (`AuthProvider`) → `Shell`
(`BLEProvider` → `PatientStoreProvider`).

| Route | Page | Purpose |
|---|---|---|
| `/` | `Dashboard` | Overview, device card, stats, recent recordings, patient picker |
| `/live` | `LiveRecording` | Core capture; start scan, live vitals, AI report, email export |
| `/patients` | `PatientManagement` | Patient CRUD, heatmap |
| `/regions` | `RegionalAnalytics` | Map + AI regional health reports |
| `/stats` | `Statistics` | Per-patient session history, HRV breakdown, CSV/print |
| `/console` | `DeviceConsole` | Low-level BLE connect + command console |
| `/settings` | `Settings` | BP-capture toggle, OpenRouter key/model, integrations |

Auth gates everything: `AuthContext` restores the Supabase session; with no
`doctor`, `Login` is rendered instead of the routes.

### 4.3 Contexts

- **`AuthContext`** — Supabase email/password auth, `doctor` profile from the
  `doctors` table, 7 s timeouts, session restore + `onAuthStateChange`.
- **`BLEContext`** — the Web Bluetooth client. Device filter name `Anebilin`;
  parses the FFF1/FFF2/FFF3 protocol in §3.5; aggregates samples (SQI-weighted
  for normal mode, simple mean for BP) and drives the client-side 30 s normal +
  optional 30 s BP scan. Exposes `connect`, `disconnect`, `sendCommand`,
  `startFullScan`, `logs`, `scanPhase`, `biomarkers`, `bestNormal`, `bestBP`.
- **`PatientStore`** — patient + recording CRUD scoped to the auth user, with
  Supabase Realtime `postgres_changes` subscriptions and a heatmap helper.

### 4.4 External services

| Service | Where | Notes |
|---|---|---|
| **Supabase** | `services/supabaseClient.ts`, contexts | Auth + Postgres (`doctors`, `patients`, `recordings`) + Realtime + RLS. Schema in `website/supabase_schema.sql`. |
| **OpenRouter** | `utils/openRouterClient.ts`, `components/AIAssistantChat.tsx` | Regional analysis + chat. Key stored in **localStorage**, not env. |
| **Exchange API** | `services/exchangeClient.ts` | Live-recording clinical report. Default base `http://192.168.0.224:8000`; POST `/api/v1/exchange`. Override via localStorage `spectru_exchange_base_url` or `VITE_EXCHANGE_BASE_URL`. |
| **EmailJS** | `services/emailService.ts` | Emails the formatted report. |
| **Leaflet / OSM tiles** | `RegionalAnalytics`, `HeatmapComponent` | Multiple tile providers with fallback. |
| **Nominatim** | `utils/reverseGeocode.ts` | Reverse geocoding lat/lon → city/state. |
| **Spline** | `index.html` script | Loaded globally; background component is unused. |

### 4.5 Environment variables (`website/.env`)

Required (the app throws at import if missing):
```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```
Optional:
```
VITE_EMAILJS_USER_ID=
VITE_EMAILJS_SERVICE_ID=
VITE_EMAILJS_TEMPLATE_ID=
VITE_EXCHANGE_BASE_URL=
```
`website/.env.local` exists and is gitignored — it contains **live secrets**.
Never commit, print, or paste its contents.

---

## 5. Conventions & gotchas

- **No comments unless needed.** Match surrounding style; the firmware and web
  code are already densely (and intentionally) commented in the algorithm-heavy
  spots — don't add narration elsewhere.
- **Stale docs — do not trust blindly:**
  - `resources/spectru/BLE_PROTOCOL.md` describes device name `Spectru` and a
    20 s + 20 s scan. Wrong name, wrong timing. UUIDs/byte layouts happen to match.
  - `resources/spectru/juhacks/web_app_ble_integration_guide.md` describes a
    different protocol (FFF1–FFF5, 11-byte waveform, packed Uint16 structs). Wrong.
  - Trust `BLE_FIRMWARE_BRIEF.md` + `website/src/contexts/BLEContext.tsx` instead.
- **Two independent AI paths**: Live Recording's report goes to the **Exchange
  API**; Regional Analytics and the assistant chat go to **OpenRouter**. The
  `liveRecording` OpenRouter model preference is stored but unused.
- **Known stubs / dead code** (don't assume they work):
  - BP estimators and respiration (firmware sends `NaN`/placeholder).
  - Firmware upload, factory reset, update checks, data-management buttons in
    the web UI.
  - `Statistics` PPG waveform is synthetic (generated from HR/RR math).
  - Unused components: `VitalsScalePanel`, `StarBackground`, `SplineBackground`.
- **`resources/` is reference-only** — PlatformIO's `src_dir`/`lib_dir` point at
  the root `src/` and `lib/`, so nothing under `resources/` is compiled.
- **NVS schema versioning**: bump `AnebilModel::NVS_MAGIC` when the persisted
  layout changes; stored blobs with a different magic are rejected.
- **The AS7343 has no 940 nm photodiode** (closest is 855 nm), so this is not a
  drop-in pulse oximeter — see `AUDIT.md §5`.
- **AD8232 `OUTPUT` is analog** — it must be on an ADC1 pin (GPIO1–10). The
  DevKit `TX`/`RX` pins (GPIO43/44) are **not** ADC-capable; `SDN` is a plain
  output. Pins are runtime-configurable (`ecgpin`) and stored in NVS `ecgset`.

---

## 6. Verification checklist

After firmware changes:
1. `pio run` builds clean.
2. Device boots, OLED shows the ANEBILIN animation, serial prints `# ready`.
3. `?` finds AS7343 at `0x39`; `o` produces a reading; `bio` streams HR/SpO2.
4. Connect from the website → status pill goes CONNECTING → CONNECTED.
5. Start scan → FFF1 indicates `0x01`; FFF3 notifies ~1 Hz at 32 bytes; stop
   returns to Idle; disconnect allows a fresh reconnect without power cycle.
6. Deep sleep does **not** fire while scanning/connected; serial calibration
   still works with BLE active.
7. ECG: `ecg` then `ecgs` then `ecgdump` shows a mid-rail baseline with a QRS;
   FFF6 walks Idle → Recording → Ready and FFF5 chunk sweep reassembles `count`
   samples (`ECG_BRIEF.md §7`).

After website changes:
1. `npm run build` (type-check + bundle) and `npm run lint` pass.
2. `npm run dev` on `localhost` (secure context for BLE/geolocation).
3. Login → routes render; BLE connect + scan works end-to-end.
