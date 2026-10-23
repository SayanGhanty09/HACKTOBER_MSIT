# ECG Firmware Brief — ANEBILIN (AD8232)

**Audience:** an implementing agent or firmware/website integrator. This is the
authoritative contract for the single-lead ECG feature. If this file and the
code disagree, the code (`lib/ECG/ECGManager.*`, `lib/AnebilModel/BLEManager.*`,
`src/main.cpp`) wins — then fix this file.

---

## 1. Scope

Capture a single-lead ECG waveform from an **AD8232** front-end, buffer it in
device memory during a scan, and retrieve the buffered waveform over the
**existing FFF0 BLE service**. The firmware does **not** interpret the waveform
(no QRS/HR detection yet) — it stores raw ADC samples and serves them in chunks.

The existing FFF1/FFF2/FFF3 biomarker protocol is **unchanged**.

---

## 2. Hardware wiring

| AD8232 pin | ESP32-S3 | Notes |
|---|---|---|
| `OUTPUT` | **ADC1 GPIO1..GPIO10** | Analog waveform. **Must** be an ADC pin. |
| `SDN` | any GPIO output | Active-low shutdown: HIGH = run, LOW = off. |
| `3.3V` / `GND` | 3.3V / GND | Common ground. |
| `LO+` / `LO-` | optional GPIO inputs | Lead-off detection — not implemented yet. |

> **Critical:** the DevKit `TX`/`RX` pins are **GPIO43/GPIO44**, and neither is
> ADC-capable. The AD8232 `OUTPUT` cannot be read there. It must be on an ADC
> pin. Current firmware wiring: **OUTPUT = GPIO8** (ADC1_CH7), **SDN = GPIO17**.
> Both are runtime-configurable with `ecgpin <adc> <sdn>` and persisted in NVS.

The AD8232 output sits near mid-rail (~1.5 V at 3.3 V supply), inside the S3 ADC
range (12-bit, 0–4095). Samples are stored as **int16** raw counts; the client
should subtract its own baseline (e.g. the median) before plotting.

---

## 3. Capture & storage

- **Sample rate:** default **1000 Hz** (`ecgfs`, 100..1000 Hz; `vTaskDelayUntil`
  quantises to 1 ms ticks, so 1000/500/250/100 Hz are exact).
- **Duration:** default **30 s** (`ecg_dur`, 1..600 s).
- **Sampler:** a FreeRTOS task pinned to **core 1**, priority 2, calling
  `analogRead()` at `fs` and appending int16 samples to a preallocated buffer.
- **Buffer:** sized `fs × 60 s`. Prefers **PSRAM**; falls back to internal SRAM
  at 30 s then 10 s if PSRAM is unavailable. At 1000 Hz / 60 s that is
  60,000 samples = **120 KB**.
  - To actually get PSRAM on an N8R8 module, `platformio.ini` needs
    `board_build.arduino.memory_type = qio_opi` and `-DBOARD_HAS_PSRAM`.
    Without it the 30 s default still fits in the internal-SRAM fallback.
- **States** (`EcgState`): `0x00 Idle`, `0x01 Recording`, `0x02 Ready`,
  `0x03 Transferring`, `0x04 Error`.
- **Coexistence:** ECG cannot start while `bio`/`streaming` runs and vice versa.
  Deep sleep is suppressed while `Recording`; the AD8232 `SDN` is driven low
  when idle.

---

## 4. BLE protocol additions (same FFF0 service)

| Char | UUID suffix | Properties | Payload |
|---|---|---|---|
| ECG Control | `fff4` | Write | `cmd` (1 B) + `arg` (uint16 LE, optional) |
| ECG Data | `fff5` | Notify | `seq` (uint16 LE) + `n` (uint16 LE) + `n × int16 LE` |
| ECG Status | `fff6` | Read + Indicate | 16 bytes (below) |

### 4.1 ECG Status (FFF6), 16 bytes

| Offset | Type | Field |
|---|---|---|
| 0 | u8 | state (`EcgState`) |
| 1 | u8 | flags (reserved, 0) |
| 2 | u32 LE | sample rate Hz |
| 6 | u32 LE | sample count |
| 10 | u32 LE | captured duration ms |
| 14 | u16 LE | chunk size in samples (currently **120**) |

Push an Indicate after every state change and on request.

### 4.2 ECG Control (FFF4)

| `cmd` | Name | `arg` | Action |
|---|---|---|---|
| `0x10` | START | duration seconds (0 = stored default) | begin recording |
| `0x11` | STOP | — | stop, keep buffer |
| `0x12` | GET_META | — | firmware indicates FFF6 |
| `0x13` | REQUEST_CHUNK | chunk index (seq) | firmware notifies one FFF5 packet |
| `0x14` | CLEAR | — | discard buffer, state → Idle |
| `0x15` | ABORT | — | same as STOP |

`arg` is little-endian at bytes 1–2; omit for no-arg commands.

### 4.3 ECG Data (FFF5)

```
byte 0-1  uint16 seq        (chunk index, echoes REQUEST_CHUNK arg)
byte 2-3  uint16 n_samples  (<= chunk size from FFF6)
byte 4..  n_samples × int16 little-endian
```

Chunks are **fixed at 120 samples**, so `startSample = seq × 120`. The final
chunk may be short (`n_samples < 120`); `seq` past the end returns nothing.
The packet is clamped to the negotiated ATT MTU (`mtu − 7` bytes of samples), so
the client must read `chunk_samples` from FFF6 rather than assume 120.

---

## 5. Retrieval sequence (client)

1. Subscribe to FFF5 notifications and FFF6 indications.
2. Write FFF4 `0x10` (+ optional duration) → wait for FFF6 `state = Recording`.
3. Poll FFF6 (or wait for the indicate) until `state = Ready`.
4. Read FFF6 → `count`, `fs`, `chunk_samples`.
5. `chunks = ceil(count / chunk_samples)`; for `seq = 0..chunks-1` write FFF4
   `0x13` with `arg = seq`, collect FFF5 packets (re-request any missing `seq`).
6. Reassemble int16 LE samples; `time[i] = i / fs`.
7. Optionally write FFF4 `0x14` to free the buffer for the next scan.

Throughput: 30 s @ 1000 Hz = 30,000 samples = 60 KB ≈ 250 chunks. With MTU 247
and ~20 notifications/s that is ~13 s. Chrome/Web Bluetooth normally negotiates
a large MTU automatically.

---

## 6. Serial CLI (bring-up / fallback)

| Command | Effect |
|---|---|
| `ecg` | start capture (no serial stream) |
| `ecgplot` | start capture + live CSV stream for the Arduino Serial Plotter |
| `ecgs` | stop capture |
| `ecginfo` | state / fs / count / pins / buffer kind |
| `ecgdump` | dump the buffer as `time(ms),adc` CSV over serial |
| `ecgclr` | clear buffer |
| `ecgfs <hz>` | set sample rate (saved) |
| `ecg_dur <s>` | set duration (saved) |
| `ecgpin <adc> <sdn>` | set pins (saved) |

### Serial Plotter format

ECG serial output matches the raw channel stream (`r`): a label line followed
by numeric rows, comma-separated.

```
# time(ms), ECG_ADC
0,2048
1,2051
2,2047
...
# ecg end
```

- `ecgplot` emits this live while capturing, decimated to ~200 Hz
  (`fs / 200`) so 115200 baud is not overwhelmed and sampling timing stays clean.
- `ecgdump` emits the full-resolution stored buffer (all `fs` samples) in the
  same format after the scan.
- The trailing `# ecg end` matches raw mode's `# stopped` and is harmless to the
  plotter.

NVS namespace `ecgset` (magic `0xEC600001`): `fs`, `dur`, `adc`, `sdn`.

---

## 7. Testing checklist

1. `pio run` builds clean; boot prints `# ECG ready — ADC=GPIO.. SDN=GPIO..`.
2. `ecginfo` shows the expected pins and `PSRAM`/`SRAM`.
3. `ecgdump` after a 5 s capture shows ~`fs × 5` rows and a mid-rail baseline
   with a visible QRS (plot the CSV). `ecgplot` shows the same live in the
   Arduino Serial Plotter.
4. `ecgpin` to the wrong pin yields flat/zero data — confirms the ADC caveat.
5. BLE: FFF6 `state` goes Idle → Recording → Ready; `count ≈ fs × duration`.
6. Chunk sweep reassembles `count` samples; last chunk may be short.
7. Starting `bio` during an ECG scan is refused; deep sleep does not fire while
   recording; a fresh BLE connect works after a scan.

---

## 8. Known limitations / next steps

- `analogRead()` at 1 kHz has jitter under BLE/I²C load. If it matters, switch
  the sampler to the ESP32-S3 `adc_continuous` DMA driver (see `AUDIT.md` for
  the register-level style this project expects).
- No lead-off (`LO+`/`LO-`) detection yet.
- No on-device QRS/HR — raw waveform only.
- The existing `website/` is stale and lives elsewhere; it has **not** been
  updated for FFF4/FFF5/FFF6. The firmware is the contract for the other site.
