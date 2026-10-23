# BLE Firmware Implementation Brief — ANEBILIN

**Audience:** an implementing agent. You are adding BLE connectivity to the ANEBILIN ESP32-S3 firmware so the existing web dashboard (`website/`) can talk to the device. Read this entire file before writing code.

---

## 1. Current state

- **Firmware (`src/main.cpp`, `lib/AS7343/`, `lib/AnebilModel/`)** has **no BLE**. It exposes biomarkers only over the USB serial CLI (`bio`, `c<spo2>,<hb>,<bili>`, etc.). The `BiomarkerEngine` already computes the values the dashboard needs.
- **Website (`website/src/contexts/BLEContext.tsx`)** is wired into every page (`Dashboard`, `LiveRecording`, `Statistics`, `DeviceConsole`, `Settings`, ...) and **expects a specific BLE GATT layout** documented below.
- `platformio.ini` currently has no BLE lib in `lib_deps`.

### ⚠️ Conflicting docs — pick the right one

`website/web_app_ble_integration_guide.md` describes a **different and stale** protocol (5 characteristics FFF1–FFF5, 11-byte waveform stream, 21-byte packed Uint16 biomarker struct). **Ignore it.** It does not match the website code. After you finish, you may delete it or replace it with the spec in §2.

The authoritative protocol comes from `website/src/contexts/BLEContext.tsx`:
- UUIDs: lines 8–11
- Status enum: lines 16–23
- Live-data parsing: lines 149–211
- Status parsing: lines 216–223
- Connect / device-name filter: lines 233–252

---

## 2. Authoritative GATT protocol (must match exactly)

### Advertising
- **Device name:** `Anebilin` (exact match — `BLEContext.tsx:234` uses `filters: [{ name: "Anebilin" }]`)
- Advertise the primary service UUID below in the advertisement payload so the browser scanner finds it.

### Service
- **Service UUID:** `0000fff0-0000-1000-8000-00805f9b34fb`

### Characteristics

| Name | UUID | Properties | Payload |
|---|---|---|---|
| **Status** | `0000fff1-0000-1000-8000-00805f9b34fb` | **Read + Indicate** | 1 byte (see §2.1) |
| **Control** | `0000fff2-0000-1000-8000-00805f9b34fb` | **Write** (with response is fine) | 1 byte (see §2.2) |
| **LiveData** | `0000fff3-0000-1000-8000-00805f9b34fb` | **Notify** | **32 bytes** = 8 × `float32` little-endian (see §2.3) |

ESP32 is little-endian — `memcpy` of an `float[8]` produces the correct byte order. Do **not** scale or pack into integers; the website calls `DataView.getFloat32(offset, true)`.

### 2.1 Status byte (FFF1)
Sent via **Indicate** whenever device state changes, and readable at any time.

| Byte | Meaning |
|---|---|
| `0x00` | IDLE (ready for commands) |
| `0x01` | SCANNING — normal biomarker mode |
| `0x02` | SCANNING_BP — BP / fast mode |

### 2.2 Control byte (FFF2)
Written by the website.

| Byte | Action |
|---|---|
| `0x00` | Stop current scan, return to IDLE |
| `0x01` | Start normal mode (40 Hz biomarker pipeline) |
| `0x02` | Start BP mode (200 Hz fast pipeline) |

After processing a Control write, the firmware must update FFF1 and push an Indicate.

### 2.3 LiveData packet (FFF3)
**Exactly 32 bytes**, 8 little-endian `float32` values. Meaning depends on **current mode**:

**Normal mode (`0x01`) layout:**

| Offset | Field | Source in `BiomarkerEngine::Result` |
|---|---|---|
| 0  | `pi`        | `pi` |
| 4  | `sqi`       | `sqi` |
| 8  | `spo2`      | `spo2` |
| 12 | `hr`        | `hr_bpm_raw` (or `hrCal`-mapped value if `hr_cal_valid`) |
| 16 | `sdnn`      | `hrv_sdnn` |
| 20 | `rmssd`     | `hrv_rmssd` |
| 24 | `hb`        | `hb_g_dl` |
| 28 | `bilirubin` | `bili_mg_dl` |

**BP mode (`0x02`) layout:**

| Offset | Field | Notes |
|---|---|---|
| 0  | `sbp`        | `NaN` if uncalibrated — website handles `isNaN` (`BLEContext.tsx:190-191`) |
| 4  | `dbp`        | `NaN` if uncalibrated |
| 8  | `pulse_rate` | bpm — use HR estimator |
| 12 | `resp_rate`  | bpm (>0 and ≤35 is the valid range the UI accepts) |
| 16–28 | `0.0f` × 4 | reserved, send zeros |

**Cadence:** ~1 Hz is fine. The website does `addLog` per packet and accumulates its own running averages; a fast firehose is unnecessary and wastes BLE airtime. Don't send packets while `IDLE`.

---

## 3. Behavior the website relies on (don't break these)

These come from reading `BLEContext.tsx`:

1. **Device name must be exactly `Anebilin`** — the filter is hard-coded.
2. **FFF1 is Indicate, not Notify.** The website calls `startNotifications()`; in Web Bluetooth that call enables either notify or indicate depending on which the char advertises, so either works at the API level. Use **Indicate** because state is rare/important.
3. **FFF3 packets must be exactly 32 bytes** — the website drops anything else (`BLEContext.tsx:152-155`).
4. **The 30 s scan timer lives client-side.** The website sends `0x01`, waits 30 s, sends `0x00`, optionally sends `0x02`, waits 30 s, sends `0x00`. The firmware does not need to auto-stop after 30 s — just honor whatever Control byte arrives.
5. **`NaN` is a valid value** for SBP/DBP and is the correct signal for "no calibration yet." Don't substitute zero.
6. **Disconnect must be clean** — register a server-disconnect handler so the next `connect()` works without a power cycle.

---

## 4. What's missing from the existing engine

`BiomarkerEngine` (see `lib/AnebilModel/BiomarkerEngine.h`) already produces every field for the **normal** packet. The **BP mode** estimators do not exist yet:

- `sbp`, `dbp` — no algorithm in the codebase. **Initial implementation: send `NaN` for both.** The UI is built for this and will display "uncal". Add a real estimator later.
- `pulse_rate` — reuse the HR pipeline at 200 Hz sampling.
- `resp_rate` — not currently computed. Either implement (e.g., low-pass on baseline wander of the green channel and zero-cross / FFT for rate) or send a value outside the valid range so the UI shows "wait".

Treat BP mode as a **stub that wires the protocol end-to-end** with placeholder math; biomarker accuracy is a follow-up.

---

## 5. Recommended implementation plan

### 5.1 Dependencies
Add to `platformio.ini`:

```ini
lib_deps =
    adafruit/Adafruit SSD1306
    adafruit/Adafruit GFX Library
    adafruit/Adafruit BusIO
    h2zero/NimBLE-Arduino @ ^1.4.1
```

Prefer NimBLE over the bundled `BLEDevice.h` — it's ~half the flash/RAM footprint and the API is similar. The ESP32-S3 has tight headroom once the display + sensor stacks are in.

### 5.2 New module
Create `lib/AnebilModel/BLEManager.h` and `BLEManager.cpp`:

```cpp
// BLEManager.h sketch
class BLEManager {
public:
    enum class Mode : uint8_t { Idle = 0x00, Normal = 0x01, BP = 0x02 };

    void begin(const char* deviceName = "Anebilin");

    // Push a fresh biomarker snapshot. Caller fills the 8 floats per §2.3.
    void publishLive(const float values[8]);

    // Force a state update + indicate.
    void setMode(Mode m);
    Mode mode() const { return _mode; }

    // Polled from loop() to drain pending control writes onto a callback.
    void setOnControl(std::function<void(uint8_t)> cb) { _onControl = cb; }

private:
    Mode _mode = Mode::Idle;
    NimBLECharacteristic* _statusChar = nullptr;
    NimBLECharacteristic* _controlChar = nullptr;
    NimBLECharacteristic* _liveChar = nullptr;
    std::function<void(uint8_t)> _onControl;
    // ...write callback class that forwards to _onControl
};
```

### 5.3 Wire into `main.cpp`

- In `setup()`: `bleMgr.begin();` and `bleMgr.setOnControl([&](uint8_t b){ ... });`
- In the control callback:
  - `0x00` → stop the running biomarker loop, `bleMgr.setMode(Idle)`.
  - `0x01` → start the existing `bio` engine in 40 Hz mode, `bleMgr.setMode(Normal)`.
  - `0x02` → start the engine in 200 Hz mode (new BP path), `bleMgr.setMode(BP)`.
- In `loop()`: once per ~1 s, if mode != Idle, pack 8 floats from `BiomarkerEngine::Result` per §2.3 and call `bleMgr.publishLive(values)`.

Keep the serial CLI working in parallel — calibration (`c<...>` / `cal_fit` / `cal_dump`) still happens over USB. The website has no calibration channel in this protocol version.

### 5.4 Coexistence with the OLED + deep-sleep logic
- Deep sleep currently fires after 30 s of inactivity. **A live BLE connection counts as activity** — reset the inactivity timer on any FFF2 write and while `mode != Idle`. Otherwise the device will sleep mid-scan.
- The display views (`[1/3] estimates`, etc.) can stay as-is. Optionally show a small "BLE" indicator when connected.

---

## 6. Testing checklist

1. Flash firmware. Confirm `Anebilin` appears in `chrome://bluetooth-internals` or in the website's "Connect" button.
2. Click Connect in the website → status pill should transition `CONNECTING` → `CONNECTED`, log shows `[BLE] Ready`.
3. Click "Start scan" (or call `startFullScan`):
   - FFF1 should indicate `0x01`; website status flips to `SCANNING`.
   - FFF3 notifications arrive every ~1 s, 32 bytes each; website logs `[NORMAL] PI=… SQI=… SpO2=… HR=…`.
   - After 30 s the website sends `0x00`; firmware returns to IDLE, FFF1 indicates `0x00`.
   - If BP-capture is enabled in the website's Settings page, it then sends `0x02`; firmware should indicate `0x02` and start streaming BP-layout packets (NaN SBP/DBP is fine).
4. Disconnect from the website → firmware must accept a fresh connection without a power cycle.
5. Verify deep sleep does **not** fire while a scan is running.
6. Verify serial calibration commands still work with BLE active.

---

## 7. Out of scope (do not implement now)

- The `FFF5` calibration write channel from the stale markdown guide. Calibration stays on the serial CLI.
- A real BP/respiration estimator (placeholder NaN/zero is acceptable for this PR — open a follow-up).
- OTA updates over BLE.
- Pairing / bonding / encryption. Web Bluetooth works without LE Secure Connections for this device class; leave the service open.

---

## 8. Files you will likely touch

- `platformio.ini` — add NimBLE dep.
- `lib/AnebilModel/BLEManager.h` *(new)*
- `lib/AnebilModel/BLEManager.cpp` *(new)*
- `src/main.cpp` — include + init + control dispatcher + 1 Hz publish + inactivity-timer guard.
- *(optional)* delete or rewrite `website/web_app_ble_integration_guide.md` so it stops misleading future readers.

Stop and ask if you find that `BiomarkerEngine::Result` no longer exposes one of the normal-mode fields listed in §2.3 — that means the engine API has drifted since this brief was written and the offsets need re-derivation.
