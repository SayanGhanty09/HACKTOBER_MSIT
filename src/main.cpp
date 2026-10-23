// ANEBILIN — AS7343 hybrid reflectance + transmission spectrometer
// with online RLS chromophore model for SpO2 / Hb / Bilirubin.
//
// SENSOR COMMANDS
//   r | start  start streaming           (visible + NIR LEDs on)
//   s | stop   stop streaming or bio     (all LEDs off)
//   o          single one-shot read
//   bio        live HR + SpO2 + Hb + Bili, 100ms refresh; c<...> trains inline
//   g0..g12    set gain (0.5x..2048x)
//   i<us>      set integration time in µs (picks ATIME/ASTEP automatically)
//   a<0-255>   set ATIME register directly
//   A<2-65535> set ASTEP step count directly (writes ASTEP-1 to register)
//   l<mA>      set AS7343 internal LED current (4..258)
//   L<mA>      set AS7343 LED current cap      (default 129 mA = 50%)
//   n<0-255>   set external NIR LED PWM duty
//   t          dump 10 touch readings for threshold calibration
//   status     show current gain / integration / LED / NIR / storage config
//   nir [on|off|<0-255>]  toggle external NIR LEDs for a visual test (not saved)
//   nirsweep   ramp NIR PWM duty and print LEDC readback (verify the timer runs)
//   R          resync sensor (reload SMUX + clear status — escape hatch)
//   ?          scan both I2C buses
//   h          help
//
// BIOMARKER ENGINE — full AC/DC ratio pipeline (faithful port of spectru):
//   SpO2 = f(R_red / R_nir)                          where R_λ = AC_λ/DC_λ
//   Hb   = f((R_green / R_nir) / (R_red / R_nir))    green-vs-red over NIR
//   Bili = f((R_blue  / R_nir) / (R_red / R_nir))    blue-vs-red over NIR
//   HR   = peak-detect on bandpass-filtered AC_green → median R-R → BPM
// Each maps through its own LinearCalibrator (OLS, up to 20 (x,y) points).
// PI/SQI are computed but NOT used to gate outputs.
//
// CALIBRATION COMMANDS
//   cbr               capture reflectance baseline (optional diagnostic only)
//   cbt               capture transmission baseline (optional diagnostic only)
//   cbs               show baseline + cal-time params
//   c<spo2>,<hb>,<b>  one-shot — adds points to spo2Cal, hbCal, biliCal
//   cal_spo2 <%>      add single SpO2 point (uses current R_red/R_nir)
//   cal_hb   <g/dL>   add single Hb point   (uses current hb_index)
//   cal_bili <mg/dL>  add single Bili point (uses current bili_index)
//   cal_hr   <bpm>    add single HR ref point (uses current raw BPM)
//   cal_fit           recompute OLS on all four calibrators
//   cal_dump          print every stored (x,y) pair + fit stats
//   cal_reset <which> hb | bili | spo2 | hr | all
//   cal_wload <hb|bili> <w0..w9>  load raw-space weights from the offline trainer
//
// LIVE TRAINING WORKFLOW
//   1) bio            start AC/DC engine (finger on sensor, 100ms refresh)
//   2) wait ~5 s      for AC/DC EMAs to settle on the pulse
//   3) c98,14.2,0.8   feed ground-truth label — trains all three at once
//   4) repeat across ≥5 subjects spanning the value range
//   5) auto-saves to NVS on every train.
//
// CAPTURE COMMANDS (raw ADC -> LittleFS, for offline training):
//   cap <s> [subject]  record raw 6-channel ADC CSV to /captures/<subject>_<ms>.csv
//   ls                 list stored capture files
//   get <file>         stream a file over serial ("# GET <name> <size>" + bytes + "# END")
//   rm <file|all>      delete one capture or all captures
//
// ECG COMMANDS (AD8232 single-lead):
//   ecg                start a capture (default duration from ecg_dur)
//   ecgplot            start a capture and live-stream decimated samples to the
//                      serial plotter in the raw-mode CSV format (time(ms),adc)
//   ecgs               stop capture, keep the buffer
//   ecginfo            print state / fs / sample count / pins
//   ecgdump            dump the buffer as CSV over serial
//   ecgclr             discard the buffer
//   ecgfs <hz>         sample rate (100..1000, default 1000)
//   ecg_dur <s>        capture length in seconds (1..600, default 30)
//   ecgpin <adc> <sdn> ADC input pin (must be ADC1: GPIO1..10) + SDN output pin
//
// TOUCH (GPIO 1 capacitive pad):
//   short tap (<1 s)   → cycle through the 3 display views
//   long press (≥1 s)  → trigger a 20-second continuous scan; results page
//                        shows averaged biomarker estimates at the end
//   hold 5 s in sleep  → wake from deep sleep
//
// POWER MANAGEMENT:
//   After 30 s with no serial in/out and no touch, the device shows an
//   ANEBILIN splash then enters deep sleep. Touch the pad and hold for 5 s
//   to wake; release early and it goes back to sleep.
//
// DISPLAY VIEWS:
//   [1/3] estimates     SpO2, Hb, Bilirubin + LED/trained status
//   [2/3] channels      raw ADC + absorbances per wavelength
//   [3/3] cal status    baseline coverage, gain/integ at cal time

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Fonts/FreeSansBold9pt7b.h>
#include "esp_sleep.h"
#include <Preferences.h>
#include <LittleFS.h>
#include <vector>

// esp_brownout_disable() is compiled into libesp_hw_support.a in IDF 5.x but
// is not in any public Arduino-ESP32 header — declare it directly.
extern "C" void esp_brownout_disable(void);
#include "AS7343.h"
#include "AnebilModel.h"
#include "SignalFilter.h"
#include "BiomarkerEngine.h"
#include "BLEManager.h"
#include "ECGManager.h"

// ===== Pinout =====
constexpr int      I2C_SDA     = 41;
constexpr int      I2C_SCL     = 40;
constexpr uint32_t I2C_HZ      = 400000;
constexpr uint8_t  AS7343_ADDR = 0x39;

constexpr int     OLED_SDA  = 11;
constexpr int     OLED_SCL  = 12;
constexpr uint8_t OLED_ADDR = 0x3C;
constexpr int     OLED_W    = 128;
constexpr int     OLED_H    = 64;

constexpr int      TOUCH_PIN           = 1;
uint32_t           touchThreshold       = 33000;
constexpr uint32_t TOUCH_DEBOUNCE_MS   = 50;
constexpr uint32_t TOUCH_LONG_PRESS_MS  = 1000;   // hold ≥1s then release → 20s scan
constexpr uint32_t TOUCH_SLEEP_PRESS_MS = 5000;   // hold ≥5s (still held) → deep sleep

// Power management
constexpr uint32_t INACTIVITY_TIMEOUT_MS = 90000;   // 90s idle → deep sleep
constexpr uint32_t WAKE_HOLD_MS          = 2000;    // 2s touch hold to wake
constexpr uint32_t SCAN_DURATION_DEFAULT = 90000;   // default scan length (90s)

constexpr int      NIR_PIN_A    = 6;
constexpr int      NIR_PIN_B    = 48;
constexpr uint32_t NIR_PWM_HZ   = 5000;
constexpr uint8_t  NIR_PWM_BITS = 8;
constexpr uint8_t  NIR_AUTO_DUTY = 40;   // auto-on PWM whenever a reading is active

// ===== ECG (AD8232) =====
// OUTPUT must be an ADC-capable pin — ESP32-S3 ADC1 is GPIO1..GPIO10. The
// DevKit "TX"/"RX" pins (GPIO43/44) are NOT ADC-capable, so the analog OUTPUT
// must be on ADC1. SDN is a plain output (active-low shutdown).
// Both are runtime-overridable with `ecgpin <adc> <sdn>` and persisted in NVS.
constexpr int ECG_ADC_PIN = 8;    // AD8232 OUTPUT  (ADC1_CH7)
constexpr int ECG_SDN_PIN = 17;   // AD8232 SDN     (plain output)

// ===== Defaults =====
// 100 ms integration → max count ~36000, X128 gain. Empirically the best
// SNR window for hybrid reflectance + NIR transmission through skin.
// LED 7 mA — soft default so the AS7343 onboard LED isn't blindingly bright;
// quantizes to 6 mA in hardware (2 mA DAC step). Raise with `l<mA>`.
constexpr uint32_t     INTEGRATION_US  = 100000;
constexpr AS7343::Gain DEFAULT_GAIN    = AS7343::Gain::X128;
constexpr uint16_t     LED_DEFAULT_MA  = 7;
constexpr uint16_t     LED_DEFAULT_CAP = 129;

// NVS namespace + magic for the live runtime settings (gain / integration /
// LED / NIR duty). Bump the magic when this layout changes.
constexpr const char*  SETTINGS_NS    = "anbset";
constexpr uint32_t     SETTINGS_MAGIC = 0xA7EB0101;

// ===== Globals =====
AS7343           sensor;
Adafruit_SSD1306 oled(OLED_W, OLED_H, &Wire1, -1);
AnebilModel      model;            // RLS — kept as legacy diagnostic surface
SignalFilter     signalFilter;     // AC/DC splitter per channel
BiomarkerEngine  bioEngine;        // SpO2 / HR / Hb / Bili (AC/DC ratios)
BLEManager       ble;              // NimBLE GATT for the web dashboard
ECGManager       ecg;              // AD8232 ECG capture + BLE chunk fetch
bool             oledOk = false;

// Shared biomarker snapshot for BLE — written by the sensor core, read by the
// BLE publish task. 32 bytes = the exact FFF3 payload (8 × float32).
static portMUX_TYPE      g_snapMux = portMUX_INITIALIZER_UNLOCKED;
static float             g_snap[8] = {};       // packed per current BLE mode
static volatile bool     g_snapFresh = false;  // set by sensor, cleared by publisher
static volatile uint32_t g_snapStaleMs = 0;    // last sensor update time
// Set by Stop handler so the publish task sends one final packet after Idle transition.
static volatile bool     g_pendingFinalPublish = false;

static void packNormalSnapshot(const Biomarkers& b, float out[8]) {
    out[0] = b.pi;
    out[1] = b.sqi;
    out[2] = b.spo2;
    out[3] = b.hr_valid ? (b.hr_cal_valid ? b.heart_rate : b.hr_bpm_raw) : NAN;
    out[4] = b.hr_valid ? b.hrv_sdnn  : NAN;
    out[5] = b.hr_valid ? b.hrv_rmssd : NAN;
    out[6] = b.hb_cal_valid   ? b.hb_g_dl    : NAN;
    out[7] = b.bili_cal_valid ? b.bili_mg_dl : NAN;
}

static void packBpSnapshot(const Biomarkers& b, float out[8]) {
    // No real SBP/DBP yet — NaN is the agreed protocol for "uncalibrated".
    out[0] = NAN;                                                // sbp
    out[1] = NAN;                                                // dbp
    out[2] = b.hr_cal_valid ? b.heart_rate : b.hr_bpm_raw;        // pulse_rate
    out[3] = 0.0f;                                               // resp_rate (placeholder)
    out[4] = out[5] = out[6] = out[7] = 0.0f;                    // reserved
}

static void publishCurrentSnapshot() {
    float local[8];
    bool  fresh;
    portENTER_CRITICAL(&g_snapMux);
    memcpy(local, (const void*)g_snap, sizeof(local));
    fresh = g_snapFresh;
    g_snapFresh = false;
    portEXIT_CRITICAL(&g_snapMux);
    if (fresh) ble.publishLive(local);
}

uint32_t     scanDurationMs = SCAN_DURATION_DEFAULT;
bool         streaming    = false;
uint32_t     streamT0     = 0;
uint16_t     ledCurrentMA = LED_DEFAULT_MA;
uint16_t     ledCapMA     = LED_DEFAULT_CAP;
uint8_t      nirDuty      = 0;
AS7343::Gain currentGain  = DEFAULT_GAIN;
uint16_t     lastAdc[6]   = {};
float        lastEst[3]   = { 98.0f, 14.0f, 1.0f };
bool         hasReading   = false;
uint8_t      displayTick  = 0;

bool     touchActive       = false;
uint32_t touchPressStartMs = 0;
uint32_t touchReleaseMs    = 0;
bool     touchSleepFired   = false;  // true once the 5s sleep threshold fires

uint32_t lastActivityMs    = 0;

static inline void noteActivity() { lastActivityMs = millis(); }

bool     bioMode          = false;
uint32_t bioLastDisplayMs = 0;
uint32_t bioLastSerialMs  = 0;

// True while a BLE-initiated scan is active (Normal or BP mode). Used by the
// inactivity watchdog so deep sleep doesn't fire while the dashboard streams.
volatile bool bleScanActive = false;

// True while the NIR LEDs are held on by the manual `nir` test command.
bool nirTestOn = false;

// Tracks ECG state transitions so the loop can push an FFF6 indicate.
static EcgState lastEcgState = EcgState::Idle;

enum DisplayMode : uint8_t {
    DM_ESTIMATES = 0,
    DM_CHANNELS  = 1,
    DM_STATUS    = 2,
    DM_COUNT     = 3
};
DisplayMode displayMode = DM_ESTIMATES;

// 6-channel custom SMUX — physics-optimal for SpO2 / Hb / Bilirubin / melanin.
// MUST match AnebilModel::ChannelIdx ordering.
static const struct {
    AS7343::Pixel pid;
    const char*   label;
    const char*   shortLabel;
} CHANNELS[6] = {
    { AS7343::PX_F1,  "F1_405",  "F1 " },
    { AS7343::PX_FZ,  "FZ_450",  "FZ " },
    { AS7343::PX_FY,  "FY_555",  "FY " },
    { AS7343::PX_F6,  "F6_640",  "F6 " },
    { AS7343::PX_F7,  "F7_690",  "F7 " },
    { AS7343::PX_NIR, "NIR_855", "NIR" },
};

// ===== Helpers =====

static uint16_t cappedLedMA() {
    return (ledCurrentMA > ledCapMA) ? ledCapMA : ledCurrentMA;
}

// NIR duty when a measurement turns the LEDs on. Respects a manually-set
// nirDuty if the user has bumped it higher; otherwise auto-on at NIR_AUTO_DUTY.
static uint8_t measurementNirDuty() {
    return nirDuty > 0 ? nirDuty : NIR_AUTO_DUTY;
}

static void setNirLeds(uint8_t duty) {
    ledcWrite(NIR_PIN_A, duty);
    ledcWrite(NIR_PIN_B, duty);
}

// Read back the actual LEDC state (0 Hz = not attached). Use this to confirm
// the PWM is really being generated, independent of the LED hardware.
static void printNirPwm() {
    const uint32_t fa = ledcReadFreq(NIR_PIN_A);
    const uint32_t fb = ledcReadFreq(NIR_PIN_B);
    Serial.printf("# NIR PWM: GPIO%d freq=%lu Hz duty=%lu | GPIO%d freq=%lu Hz duty=%lu\n",
                  NIR_PIN_A, (unsigned long)fa, (unsigned long)ledcRead(NIR_PIN_A),
                  NIR_PIN_B, (unsigned long)fb, (unsigned long)ledcRead(NIR_PIN_B));
    if (fa == 0 || fb == 0)
        Serial.println(F("# WARN: NIR PWM not attached on at least one pin"));
}

static float gainMultiplier(AS7343::Gain g) {
    uint8_t idx = (uint8_t)g;
    if (idx == 0) return 0.5f;
    return (float)(1u << (idx - 1));
}

static void gainStr(AS7343::Gain g, char* buf, size_t len) {
    uint8_t idx = (uint8_t)g;
    if (idx == 0) snprintf(buf, len, "0.5");
    else          snprintf(buf, len, "%u", 1u << (idx - 1));
}

static AnebilSample buildSample(const uint16_t adc[6]) {
    AnebilSample s;
    for (int i = 0; i < 6; i++) s.adc[i] = adc[i];
    s.gain     = gainMultiplier(currentGain);
    s.integ_us = (float)sensor.getIntegrationUs();
    s.led_ma   = cappedLedMA();
    s.nir_duty = nirDuty;
    return s;
}

static void runModel(const uint16_t adc[6]) {
    AnebilSample s = buildSample(adc);
    model.predict(s, lastEst);
}

// Persist every live runtime setting to NVS. Called the instant the user
// changes anything via serial — gain, integration, LED, NIR — so a power
// cycle restores the exact configuration last in use.
static void saveSettings() {
    Preferences pref;
    if (!pref.begin(SETTINGS_NS, false)) return;
    pref.putUInt  ("MAGIC",   SETTINGS_MAGIC);
    pref.putUChar ("Gain",    (uint8_t)currentGain);
    pref.putUChar ("ATIME",   sensor.getAtime());
    pref.putUShort("ASTEP",   sensor.getAstep());
    pref.putUShort("LedMA",   ledCurrentMA);
    pref.putUShort("LedCap",  ledCapMA);
    pref.putUChar ("NirDuty", nirDuty);
    pref.putUInt  ("ScanMs",  scanDurationMs);
    pref.putUInt  ("TouchThr", touchThreshold);
    pref.end();
}

// Restore any previously-saved runtime settings. Returns true if a valid
// settings blob was loaded; false means defaults are still in effect.
static bool loadSettings() {
    Preferences pref;
    if (!pref.begin(SETTINGS_NS, true)) return false;
    if (pref.getUInt("MAGIC", 0) != SETTINGS_MAGIC) { pref.end(); return false; }

    uint8_t  g     = pref.getUChar ("Gain",   (uint8_t)DEFAULT_GAIN);
    uint8_t  at    = pref.getUChar ("ATIME",  0xFF);
    uint16_t as    = pref.getUShort("ASTEP",  0);
    ledCurrentMA   = pref.getUShort("LedMA",   LED_DEFAULT_MA);
    ledCapMA       = pref.getUShort("LedCap",  LED_DEFAULT_CAP);
    nirDuty        = pref.getUChar ("NirDuty", 0);
    scanDurationMs = pref.getUInt  ("ScanMs",  SCAN_DURATION_DEFAULT);
    touchThreshold = pref.getUInt  ("TouchThr", 33000);
    pref.end();

    currentGain = (AS7343::Gain)g;
    sensor.setGain(currentGain);
    if (at != 0xFF) {
        sensor.setAtime(at);
        sensor.setAstep(as);
    }
    return true;
}

// ===== OLED rendering =====

static void drawHeader() {
    oled.setTextSize(1);
    oled.setTextColor(SSD1306_WHITE);
    oled.setCursor(0, 0);
    oled.print(F("ANEBILIN"));
    oled.setCursor(72, 0);
    if (bioMode)        oled.print(F("[BIO]   "));
    else if (streaming) oled.print(F("[STREAM]"));
    else                oled.print(F("[IDLE]  "));
}

static void drawEstimatesView() {
    char buf[24];
    const Biomarkers& b = bioEngine.results();

    drawHeader();
    oled.drawFastHLine(0, 9, 128, SSD1306_WHITE);

    if (hasReading) {
        oled.setCursor(0, 12);
        if (b.hr_valid) snprintf(buf, sizeof(buf), "HR:  %4.0f bpm", b.heart_rate);
        else            snprintf(buf, sizeof(buf), "HR:  --   bpm");
        oled.print(buf);

        oled.setCursor(0, 23);
        snprintf(buf, sizeof(buf), "SpO2:%5.1f %%", b.spo2);
        oled.print(buf);

        oled.setCursor(0, 34);
        if (b.hb_cal_valid) snprintf(buf, sizeof(buf), "Hb:  %5.1f g/dL", b.hb_g_dl);
        else                snprintf(buf, sizeof(buf), "Hb:  --   g/dL");
        oled.print(buf);

        oled.setCursor(0, 45);
        if (b.bili_cal_valid) snprintf(buf, sizeof(buf), "Bili:%5.2f mg/dL", b.bili_mg_dl);
        else                  snprintf(buf, sizeof(buf), "Bili: -- mg/dL");
        oled.print(buf);

        oled.setCursor(0, 56);
        if (b.hr_valid)
            snprintf(buf, sizeof(buf), "HRV:%3.0f/%3.0f ms", b.hrv_sdnn, b.hrv_rmssd);
        else
            snprintf(buf, sizeof(buf), "HRV:--/-- ms");
        oled.print(buf);
    } else {
        oled.setCursor(14, 30);
        oled.print(F("no reading yet"));
    }

    oled.setCursor(110, 56);
    oled.print(F("1/3"));
}

static void drawBioView() {
    char buf[24];
    const Biomarkers& b = bioEngine.results();

    drawHeader();
    oled.drawFastHLine(0, 9, 128, SSD1306_WHITE);

    oled.setCursor(0, 12);
    if (b.hr_valid) snprintf(buf, sizeof(buf), "HR:   %4.0f bpm", b.heart_rate);
    else            snprintf(buf, sizeof(buf), "HR:   --   bpm");
    oled.print(buf);

    oled.setCursor(0, 23);
    snprintf(buf, sizeof(buf), "SpO2: %5.1f %%", b.spo2);
    oled.print(buf);

    oled.setCursor(0, 34);
    if (b.hb_cal_valid) snprintf(buf, sizeof(buf), "Hb:   %5.1f g/dL", b.hb_g_dl);
    else                snprintf(buf, sizeof(buf), "Hb:   -- (no cal)");
    oled.print(buf);

    oled.setCursor(0, 45);
    if (b.bili_cal_valid) snprintf(buf, sizeof(buf), "Bili: %5.2f mg/dL", b.bili_mg_dl);
    else                  snprintf(buf, sizeof(buf), "Bili: -- (no cal)");
    oled.print(buf);

    oled.setCursor(0, 56);
    if (b.hr_valid)
        snprintf(buf, sizeof(buf), "HRV: %3.0f/%3.0f ms",
                 b.hrv_sdnn, b.hrv_rmssd);
    else
        snprintf(buf, sizeof(buf), "HRV: --/-- ms");
    oled.print(buf);
}

static void drawChannelsView() {
    char buf[24];
    drawHeader();

    oled.setCursor(0, 10);
    oled.print(F("ADC counts:"));

    if (hasReading) {
        for (int i = 0; i < 3; i++) {
            oled.setCursor(0, 20 + i * 9);
            snprintf(buf, sizeof(buf), "%s%5u  %s%5u",
                     CHANNELS[i * 2].shortLabel,     lastAdc[i * 2],
                     CHANNELS[i * 2 + 1].shortLabel, lastAdc[i * 2 + 1]);
            oled.print(buf);
        }

        // Bottom-row absorbance preview for the two most diagnostic wavelengths
        AnebilSample s = buildSample(lastAdc);
        float a_fz  = model.reflAbs(AnebilModel::IDX_FZ,  s);
        float a_nir = model.transAbs(s);
        oled.setCursor(0, 48);
        snprintf(buf, sizeof(buf), "A_FZ:%4.2f A_NIR:%4.2f", a_fz, a_nir);
        oled.print(buf);
    } else {
        oled.setCursor(14, 35);
        oled.print(F("no reading yet"));
    }

    oled.setCursor(104, 56);
    oled.print(F("2/3"));
}

static void drawStatusView() {
    char buf[24];
    drawHeader();

    oled.setCursor(0, 10);
    oled.print(F("Cal status:"));

    oled.setCursor(0, 20);
    snprintf(buf, sizeof(buf), "Refl:  %s @G%.0f I%lums",
             model.hasReflectanceBaseline() ? "OK" : "--",
             model.getReflCalGain(),
             (unsigned long)(model.getReflCalInteg() / 1000));
    oled.print(buf);

    oled.setCursor(0, 30);
    snprintf(buf, sizeof(buf), "Trans: %s @G%.0f I%lums",
             model.hasTransmissionBaseline() ? "OK" : "--",
             model.getTransCalGain(),
             (unsigned long)(model.getTransCalInteg() / 1000));
    oled.print(buf);

    oled.setCursor(0, 40);
    snprintf(buf, sizeof(buf), "Trained:  %d   lam:%.2f",
             model.getUpdateCount(), model.getForgetting());
    oled.print(buf);

    oled.setCursor(0, 50);
    snprintf(buf, sizeof(buf), "LED:%umA  NIR:%u",
             cappedLedMA(), nirDuty);
    oled.print(buf);

    oled.setCursor(104, 56);
    oled.print(F("3/3"));
}

static void updateDisplay() {
    if (!oledOk) return;
    oled.clearDisplay();
    switch (displayMode) {
        case DM_CHANNELS:  drawChannelsView();  break;
        case DM_STATUS:    drawStatusView();    break;
        default:           drawEstimatesView(); break;
    }
    oled.display();
}

static void displayFlash(const __FlashStringHelper* line1, const __FlashStringHelper* line2) {
    if (!oledOk) return;
    oled.clearDisplay();
    oled.setTextColor(SSD1306_WHITE);
    oled.setTextSize(2);
    oled.setCursor(8, 12);
    oled.print(line1);
    if (line2) {
        oled.setCursor(8, 36);
        oled.print(line2);
    }
    oled.display();
}

// ===== Serial output =====

static void printHelp() {
    Serial.println(F("# Sensor:  r|start  s|stop  o  R  bio  g<0-12>  i<us>  a<atime>  A<astep>  l<mA>  L<mA>  n<0-255>  t  ?  h"));
    Serial.println(F("# Info:    status | cfg     (current gain / integ / LED / NIR / storage)"));
    Serial.println(F("#          nir [on|off|<0-255>]   (test NIR LEDs — not saved to NVS)"));
    Serial.println(F("#          nirsweep                (ramp NIR PWM 0->255->0 with readback)"));
    Serial.println(F("# Scan:    scan_dur <s>           (set long-press scan duration, default 90s)"));
    Serial.println(F("# Touch:   touch_thr <val>        (set touch threshold, default 33000)"));
    Serial.println(F("# Cal:     cbr   cbt   cbs                  (illumination baselines)"));
    Serial.println(F("# Train:   c<spo2>,<hb>,<bili>              (all-in-one: adds points to spo2/hb/bili cals)"));
    Serial.println(F("#          cal_spo2 <%> | cal_hb <g/dL> | cal_bili <mg/dL> | cal_hr <bpm>"));
    Serial.println(F("#          cal_fit | cal_dump | cal_reset <hb|bili|spo2|hr|all>"));
    Serial.println(F("#          cal_wload <hb|bili> <10 weights>   (offline-trained model)"));
    Serial.println(F("# Capture: cap <s> [subject] | ls | get <file> | rm <file|all>"));
    Serial.println(F("# BLE:     ble | ble adv | ble stop    (BLE status / advertising control)"));
    Serial.println(F("# Engine:  AC/DC ratio for all four — SpO2(RoR), Hb(green/red), Bili(blue/red), HR(peak-det)"));
    Serial.println(F("# ECG:     ecg | ecgplot | ecgs | ecginfo | ecgdump | ecgclr | ecgfs <hz> | ecg_dur <s> | ecgpin <adc> <sdn>"));
}

static void emitHeader() {
    Serial.print(F("# time(ms)"));
    for (auto& ch : CHANNELS) {
        Serial.print(F(", "));
        Serial.print(ch.label);
    }
    Serial.println(F(", SpO2_%, Hb_g_dL, Bili_mg_dL"));
}

static void emitSample(uint32_t tMs, const uint16_t adc[6]) {
    Serial.print(tMs);
    for (uint8_t i = 0; i < 6; i++) {
        Serial.print(F(", "));
        Serial.print(adc[i]);
    }
    Serial.printf(", %.2f, %.2f, %.3f\n", lastEst[0], lastEst[1], lastEst[2]);
}

// ===== Sensor control =====

static bool configureSmux() {
    AS7343::Chain c;
    for (uint8_t adc = 0; adc < 6; adc++) {
        c.route(CHANNELS[adc].pid, adc);
    }
    if (!sensor.writeSmuxRam(c)) return false;
    return sensor.setChains(AS7343::Chains::ONE);
}

// Force the AS7343 back to a known-good state (used by the 'R' command
// and after any timing change that might have stranded the engine).
static void resyncSensor() {
    sensor.stopMeasurement();
    sensor.clearAllStatus();
    sensor.setGain(currentGain);
    if (!configureSmux()) {
        Serial.println(F("# WARN: SMUX reload failed"));
    }
}

static void stopBio();   // defined below startBio

static void startStreaming() {
    if (streaming) return;
    if (bioMode) stopBio();          // don't leave bio holding the loop
    if (ecg.state() == EcgState::Recording) {
        Serial.println(F("# ERR: ECG running — 'ecgs' first"));
        return;
    }
    if (!sensor.setLed(true, cappedLedMA())) {
        Serial.println(F("# ERR: LED on failed"));
        return;
    }
    setNirLeds(measurementNirDuty());
    delay(2);
    // Init BioEngine for current Fs so streaming CSV columns are real bio values
    const float integ_s = (float)sensor.getIntegrationUs() / 1e6f;
    const float fs      = 1.0f / (integ_s + 0.002f);
    signalFilter.init(fs, 0.5f);
    bioEngine.init(fs);
    bioEngine.loadCalibration();
    streamT0  = millis();
    streaming = true;
    emitHeader();
    updateDisplay();
}

static void stopStreaming() {
    if (!streaming) return;
    streaming = false;
    sensor.setLed(false, cappedLedMA());
    setNirLeds(0);
    Serial.println(F("# stopped"));
    updateDisplay();
}

static void startBio() {
    if (bioMode) return;
    if (ecg.state() == EcgState::Recording) {
        Serial.println(F("# ERR: ECG running — 'ecgs' first"));
        return;
    }
    if (streaming) stopStreaming();
    if (!sensor.setLed(true, cappedLedMA())) {
        Serial.println(F("# ERR: LED on failed"));
        return;
    }
    setNirLeds(measurementNirDuty());
    delay(2);

    // Estimate actual sample rate from integration time. measure6 adds a few
    // ms of I2C / SP_EN overhead so the practical Fs is a touch lower than
    // 1/integration, but for the IIR alpha this is close enough.
    const float integ_s = (float)sensor.getIntegrationUs() / 1e6f;
    const float fs      = 1.0f / (integ_s + 0.002f);
    signalFilter.init(fs, 0.5f);
    bioEngine.init(fs);
    bioEngine.loadCalibration();

    bioMode          = true;
    bioLastDisplayMs = 0;
    bioLastSerialMs  = millis();

    if (fs < 20.0f) {
        Serial.printf("# bio: WARN Fs ≈ %.1f Hz — HR/SpO2 reliability degraded; try i25000\n", fs);
    }
    Serial.printf("# bio on — Fs ≈ %.1f Hz. AC/DC engine for HR/SpO2/Hb/Bili.\n", fs);
    Serial.println(F("#   c<spo2>,<hb>,<bili> trains all in one. 'bio' or 's' to stop."));
}

static void stopBio() {
    if (!bioMode) return;
    bioMode = false;
    sensor.setLed(false, cappedLedMA());
    setNirLeds(0);
    Serial.println(F("# bio off"));
    updateDisplay();
}

static void oneShot() {
    sensor.setLed(true, cappedLedMA());
    setNirLeds(measurementNirDuty());
    delay(2);
    uint16_t v[6];
    if (sensor.measure6(v)) {
        memcpy(lastAdc, v, sizeof(lastAdc));
        hasReading = true;
        runModel(v);
        emitHeader();
        emitSample(0, v);
    } else {
        Serial.println(F("# ERR: measure6 timeout"));
    }
    sensor.setLed(false, cappedLedMA());
    setNirLeds(0);
    updateDisplay();
}

// ===== Baseline calibration =====

static void calibrateReflectance() {
    Serial.println(F("# REFL CAL: AS7343 LED on, NIR off — capturing baseline..."));
    displayFlash(F("REFL"), F("CAL..."));

    uint8_t savedDuty = nirDuty;
    setNirLeds(0);
    sensor.setLed(true, cappedLedMA());
    delay(100);                                  // LED settle

    uint16_t v[6];
    bool ok = sensor.measure6(v, 500);

    sensor.setLed(false, cappedLedMA());
    setNirLeds(savedDuty);

    if (!ok) {
        Serial.println(F("# ERR: measure failed"));
        updateDisplay();
        return;
    }

    AnebilSample s = buildSample(v);
    s.nir_duty = 0;                              // NIR was off during cal
    model.calibrateReflectance(s);
    bool saved = model.saveToNVS();

    Serial.printf("# Refl baseline: gain=%.1fx integ=%lums LED=%umA %s\n",
                  s.gain, (unsigned long)(s.integ_us / 1000), s.led_ma,
                  saved ? "(saved)" : "(SAVE FAILED)");
    Serial.print(F("# I_ref ="));
    for (int i = 0; i < 6; i++) Serial.printf(" %u", v[i]);
    Serial.println();

    updateDisplay();
}

static void calibrateTransmission() {
    Serial.println(F("# TRANS CAL: NIR on, AS7343 LED off — capturing baseline..."));
    displayFlash(F("TRANS"), F("CAL..."));

    uint8_t useDuty = nirDuty > 0 ? nirDuty : 128;   // need some light on
    sensor.setLed(false, cappedLedMA());
    setNirLeds(useDuty);
    delay(100);

    uint16_t v[6];
    bool ok = sensor.measure6(v, 500);

    setNirLeds(nirDuty);                              // restore

    if (!ok) {
        Serial.println(F("# ERR: measure failed"));
        updateDisplay();
        return;
    }

    AnebilSample s = buildSample(v);
    s.nir_duty = useDuty;
    model.calibrateTransmission(s);
    bool saved = model.saveToNVS();

    Serial.printf("# Trans baseline: gain=%.1fx integ=%lums duty=%u  I_0_NIR=%u %s\n",
                  s.gain, (unsigned long)(s.integ_us / 1000), s.nir_duty,
                  v[AnebilModel::IDX_NIR],
                  saved ? "(saved)" : "(SAVE FAILED)");

    updateDisplay();
}

static void showBaselineStatus() {
    Serial.printf("# Refl  cal: %s   gain=%.1fx integ=%lums LED=%umA\n",
                  model.hasReflectanceBaseline() ? "YES" : "NO",
                  model.getReflCalGain(),
                  (unsigned long)(model.getReflCalInteg() / 1000),
                  model.getReflCalLedMa());
    Serial.printf("# Trans cal: %s   gain=%.1fx integ=%lums duty=%u\n",
                  model.hasTransmissionBaseline() ? "YES" : "NO",
                  model.getTransCalGain(),
                  (unsigned long)(model.getTransCalInteg() / 1000),
                  model.getTransCalNirDuty());
    Serial.printf("# Model: %d updates, lambda=%.3f\n",
                  model.getUpdateCount(), model.getForgetting());
}

// ===== Command handling =====

static void runFileCapture(uint32_t durationMs, const String& subject);
static void listCaptureFiles();
static void sendCaptureFile(const String& name);
static void removeCaptureFiles(const String& name);

static void handleCommand(const String& line) {
    if (line.length() == 0) return;

    // Multi-character commands take priority
    if (line == "bio") {
        if (bioMode) stopBio();
        else         startBio();
        return;
    }
    // spectru-style aliases — USB users often type these instead of r/s.
    if (line == "start") { startStreaming(); return; }
    if (line == "stop") {
        if (bioMode)   stopBio();
        if (streaming) stopStreaming();
        return;
    }
    if (line == "ecg") {
        if (bioMode || streaming) {
            Serial.println(F("# ECG: stop bio/stream first"));
            return;
        }
        ecg.setSerialStream(false);
        if (ecg.start(0)) {
            Serial.printf("# ECG scan started — fs=%lu Hz, max %lums\n",
                          (unsigned long)ecg.sampleRate(),
                          (unsigned long)ecg.durationSettingMs());
        } else {
            Serial.println(F("# ECG: start failed (busy or no buffer)"));
        }
        return;
    }
    if (line == "ecgplot") {
        if (bioMode || streaming) {
            Serial.println(F("# ECG: stop bio/stream first"));
            return;
        }
        ecg.setSerialStream(true);
        ecg.printStreamHeader();      // label line first, then live samples
        if (!ecg.start(0)) {
            Serial.println(F("# ECG: start failed (busy or no buffer)"));
            ecg.setSerialStream(false);
        }
        return;
    }
    if (line == "ecgs") {
        ecg.stop();
        ecg.setSerialStream(false);
        Serial.printf("# ECG stopped — %lu samples (%lums)\n",
                      (unsigned long)ecg.sampleCount(),
                      (unsigned long)ecg.capturedDurationMs());
        return;
    }
    if (line == "ecginfo") {
        ecg.printInfo();
        return;
    }
    if (line == "ecgdump") {
        ecg.dumpCsv();
        return;
    }
    if (line == "ecgclr") {
        ecg.clear();
        Serial.println(F("# ECG buffer cleared"));
        return;
    }
    if (line.startsWith("ecgfs")) {
        int sp = line.indexOf(' ');
        if (sp < 0) {
            Serial.printf("# ecgfs = %lu Hz\n", (unsigned long)ecg.sampleRate());
            return;
        }
        long hz = line.substring(sp + 1).toInt();
        if (hz < 100 || hz > 1000) { Serial.println(F("# ERR: ecgfs 100..1000")); return; }
        if (!ecg.setSampleRate((uint32_t)hz)) {
            Serial.println(F("# ERR: ecgfs failed (recording?)"));
            return;
        }
        Serial.printf("# ecgfs = %ld Hz (saved)\n", hz);
        return;
    }
    if (line.startsWith("ecg_dur")) {
        int sp = line.indexOf(' ');
        if (sp < 0) {
            Serial.printf("# ecg_dur = %lu s\n", (unsigned long)(ecg.durationSettingMs() / 1000));
            return;
        }
        long s = line.substring(sp + 1).toInt();
        if (s < 1 || s > 600) { Serial.println(F("# ERR: ecg_dur 1..600 seconds")); return; }
        ecg.setDurationMs((uint32_t)s * 1000);
        ecg.saveSettings();
        Serial.printf("# ecg_dur = %ld s (saved)\n", s);
        return;
    }
    if (line.startsWith("ecgpin")) {
        int sp = line.indexOf(' ');
        if (sp < 0) {
            Serial.printf("# ecgpin adc=GPIO%d sdn=GPIO%d\n", ecg.adcPin(), ecg.sdnPin());
            return;
        }
        int sp2 = line.indexOf(' ', sp + 1);
        if (sp2 < 0) { Serial.println(F("# ERR: ecgpin <adcPin> <sdnPin>")); return; }
        int adc = line.substring(sp + 1, sp2).toInt();
        int sdn = line.substring(sp2 + 1).toInt();
        if (adc < 0 || adc > 48 || sdn < 0 || sdn > 48) {
            Serial.println(F("# ERR: pins 0..48"));
            return;
        }
        ecg.setPins(adc, sdn);
        Serial.printf("# ecgpin adc=GPIO%d sdn=GPIO%d (saved)\n", adc, sdn);
        return;
    }
    if (line.startsWith("touch_thr")) {
        int sp = line.indexOf(' ');
        if (sp < 0) {
            Serial.printf("# touch_thr = %lu\n", (unsigned long)touchThreshold);
            return;
        }
        long v = line.substring(sp + 1).toInt();
        if (v < 1000 || v > 100000) { Serial.println(F("# ERR: touch_thr 1000..100000")); return; }
        touchThreshold = (uint32_t)v;
        saveSettings();
        Serial.printf("# touch_thr = %lu (saved)\n", (unsigned long)v);
        return;
    }
    if (line.startsWith("scan_dur")) {
        int sp = line.indexOf(' ');
        if (sp < 0) {
            Serial.printf("# scan_dur = %lu s\n", (unsigned long)(scanDurationMs / 1000));
            return;
        }
        long s = line.substring(sp + 1).toInt();
        if (s < 5 || s > 600) { Serial.println(F("# ERR: scan_dur 5..600 seconds")); return; }
        scanDurationMs = (uint32_t)s * 1000;
        saveSettings();
        Serial.printf("# scan_dur = %lu s (saved)\n", (unsigned long)s);
        return;
    }
    // ---- Current runtime config ----
    if (line == "status" || line == "cfg") {
        char gbuf[8];
        gainStr(currentGain, gbuf, sizeof(gbuf));
        Serial.printf("# gain=X%s (idx %u)\n", gbuf, (unsigned)currentGain);
        Serial.printf("# integ=%lu us  ATIME=%u ASTEP=%u\n",
                      (unsigned long)sensor.getIntegrationUs(),
                      (unsigned)sensor.getAtime(), (unsigned)sensor.getAstep());
        Serial.printf("# LED=%u mA (cap %u)  NIR duty=%u (auto %u)\n",
                      ledCurrentMA, ledCapMA, nirDuty, NIR_AUTO_DUTY);
        Serial.printf("# scan_dur=%lu s  touch_thr=%lu\n",
                      (unsigned long)(scanDurationMs / 1000), (unsigned long)touchThreshold);
        if (LittleFS.begin(false)) {
            Serial.printf("# LittleFS: %u/%u bytes used\n",
                          (unsigned)LittleFS.usedBytes(), (unsigned)LittleFS.totalBytes());
        }
        Serial.printf("# BLE: connected=%d advertising=%d mode=0x%02X\n",
                      ble.isConnected(), ble.isAdvertising(),
                      (unsigned)(uint8_t)ble.mode());
        printNirPwm();
        return;
    }

    // ---- BLE status / advertising control ----
    if (line == "ble" || line.startsWith("ble ")) {
        String arg = line.substring(3);
        arg.trim();
        if (arg == "adv" || arg == "start") {
            ble.restartAdvertising();
            Serial.println(F("# BLE: advertising restarted (indefinite)"));
        } else if (arg == "stop") {
            ble.stopAdvertising();
            Serial.println(F("# BLE: advertising stopped"));
        } else {
            Serial.printf("# BLE: name=\"Anebilin\" connected=%d advertising=%d mode=0x%02X\n",
                          ble.isConnected(), ble.isAdvertising(),
                          (unsigned)(uint8_t)ble.mode());
        }
        return;
    }

    // ---- NIR PWM sweep (verifies the timer actually runs, 0->255->0) ----
    if (line == "nirsweep") {
        Serial.println(F("# NIR PWM sweep 0->255->0"));
        for (int d = 0; d <= 255; d += 15) {
            setNirLeds((uint8_t)d);
            Serial.printf("# set=%3d  readback: A=%lu B=%lu\n", d,
                          (unsigned long)ledcRead(NIR_PIN_A),
                          (unsigned long)ledcRead(NIR_PIN_B));
            delay(150);
        }
        for (int d = 255; d >= 0; d -= 15) {
            setNirLeds((uint8_t)d);
            Serial.printf("# set=%3d  readback: A=%lu B=%lu\n", d,
                          (unsigned long)ledcRead(NIR_PIN_A),
                          (unsigned long)ledcRead(NIR_PIN_B));
            delay(150);
        }
        setNirLeds(0);
        nirTestOn = false;
        Serial.println(F("# sweep done — NIR off"));
        return;
    }

    // ---- Manual NIR LED test (does not change the saved nirDuty) ----
    if (line == "nir" || line.startsWith("nir ")) {
        String arg = line.substring(3);
        arg.trim();
        if (arg == "on" || (arg.length() == 0 && !nirTestOn)) {
            uint8_t d = measurementNirDuty();
            setNirLeds(d);
            nirTestOn = true;
            Serial.printf("# NIR LEDs ON (duty %u, test override — 'nir off' to stop)\n", d);
        } else if (arg == "off" || (arg.length() == 0 && nirTestOn)) {
            setNirLeds(0);
            nirTestOn = false;
            Serial.println(F("# NIR LEDs OFF"));
        } else {
            long d = arg.toInt();
            if (d < 0 || d > 255) { Serial.println(F("# ERR: nir [on|off|<0-255>]")); return; }
            setNirLeds((uint8_t)d);
            nirTestOn = (d > 0);
            Serial.printf("# NIR LEDs duty %ld (test override)\n", d);
        }
        printNirPwm();
        return;
    }

    // ---- On-device capture storage (LittleFS) ----
    if (line.startsWith("cap")) {
        String rest = line.substring(3);
        rest.trim();
        float  secs = 30.0f;
        String subj;
        if (rest.length()) {
            int sp = rest.indexOf(' ');
            if (sp < 0) {
                secs = rest.toFloat();
            } else {
                secs = rest.substring(0, sp).toFloat();
                subj = rest.substring(sp + 1);
                subj.trim();
            }
        }
        if (!(secs > 0.0f)) secs = 30.0f;
        if (secs > 600.0f)  secs = 600.0f;
        runFileCapture((uint32_t)(secs * 1000.0f), subj);
        return;
    }
    if (line == "ls") { listCaptureFiles(); return; }
    if (line.startsWith("get")) {
        String name = line.substring(3);
        name.trim();
        if (!name.length()) { Serial.println(F("# ERR: get <file>")); return; }
        sendCaptureFile(name);
        return;
    }
    if (line.startsWith("rm")) {
        String name = line.substring(2);
        name.trim();
        if (!name.length()) { Serial.println(F("# ERR: rm <file|all>")); return; }
        removeCaptureFiles(name);
        return;
    }

    if (line.startsWith("cal_")) {
        const Biomarkers& b = bioEngine.results();
        if (line.startsWith("cal_wload")) {
            // cal_wload <hb|bili> <w0..w9> — inject weights from
            // tools/train_offline.py (already in raw feature space).
            String rest = line.substring(9);
            rest.trim();
            int sp = rest.indexOf(' ');
            if (sp < 0) { Serial.println(F("# ERR: cal_wload <hb|bili> <10 weights>")); return; }
            String which = rest.substring(0, sp);
            String nums  = rest.substring(sp + 1);
            float w[10];
            int n = 0;
            char* p = (char*)nums.c_str();
            while (n < 10) {
                char* end = nullptr;
                float v = strtof(p, &end);
                if (end == p) break;
                w[n++] = v;
                p = end;
            }
            if (n != 10) { Serial.printf("# ERR: need 10 weights, got %d\n", n); return; }
            if      (which == "hb")   bioEngine.hbCal.setWeights(w);
            else if (which == "bili") bioEngine.biliCal.setWeights(w);
            else { Serial.println(F("# ERR: target must be hb|bili")); return; }
            bioEngine.saveCalibration();
            Serial.printf("# %s weights loaded (10D, offline-trained, saved)\n", which.c_str());
            return;
        }
        if (line == "cal_fit") {
            bool s = bioEngine.spo2Cal.fit();
            bool h = bioEngine.hbCal.fit(0.1f);
            bool bi= bioEngine.biliCal.fit(0.1f);
            bool r = bioEngine.hrCal.fit();
            bioEngine.saveCalibration();
            Serial.printf("# fit: spo2=%s hb=%s bili=%s hr=%s (saved)\n",
                          s ? "ok" : "--", h ? "ok" : "--",
                          bi ? "ok" : "--", r ? "ok" : "--");
            return;
        }
        if (line == "cal_dump") {
            bioEngine.spo2Cal.dump("spo2");
            bioEngine.hbCal.dump("hb");
            bioEngine.biliCal.dump("bili");
            bioEngine.hrCal.dump("hr");
            return;
        }
        if (line.startsWith("cal_reset")) {
            String which = line.substring(9);
            which.trim();
            if (which.length() == 0) which = "all";
            bioEngine.resetCalibration(which.c_str());
            bioEngine.saveCalibration();
            Serial.printf("# cal reset: %s\n", which.c_str());
            return;
        }
        int sp = line.indexOf(' ');
        if (sp < 0) { Serial.println(F("# ERR: cal_<name> <value>")); return; }
        String name = line.substring(0, sp);
        float val   = line.substring(sp + 1).toFloat();
        if (name == "cal_spo2") {
            if (b.ror <= 0.001f) { Serial.println(F("# ERR: no RoR — run bio first")); return; }
            bioEngine.spo2Cal.addPoint(b.ror, val);
            bioEngine.spo2Cal.fit();
            bioEngine.saveCalibration();
            Serial.printf("# spo2: +pt(RoR=%.3f, %.1f%%) N=%u R^2=%.2f\n",
                          b.ror, val, bioEngine.spo2Cal.pointCount(), bioEngine.spo2Cal.r_squared);
            return;
        }
        if (name == "cal_hb") {
            if (b.hb_index <= 0.001f) { Serial.println(F("# ERR: no hb_index — run bio first")); return; }
            float hbF[BiomarkerEngine::HB_FEATS];
            bioEngine.buildHbFeatures(hbF);
            bioEngine.hbCal.addPoint(hbF, val);
            bioEngine.hbCal.fit(0.1f);
            bioEngine.saveCalibration();
            Serial.printf("# hb: +pt(idx=%.3f, %.1f g/dL) N=%u R^2=%.2f (multivariate %dD)\n",
                          b.hb_index, val, bioEngine.hbCal.pointCount(),
                          bioEngine.hbCal.r_squared, BiomarkerEngine::HB_FEATS);
            return;
        }
        if (name == "cal_bili") {
            if (b.bili_index <= 0.001f) { Serial.println(F("# ERR: no bili_index — run bio first")); return; }
            float biF[BiomarkerEngine::BILI_FEATS];
            bioEngine.buildBiliFeatures(biF);
            bioEngine.biliCal.addPoint(biF, val);
            bioEngine.biliCal.fit(0.1f);
            bioEngine.saveCalibration();
            Serial.printf("# bili: +pt(idx=%.3f, %.2f mg/dL) N=%u R^2=%.2f (multivariate %dD)\n",
                          b.bili_index, val, bioEngine.biliCal.pointCount(),
                          bioEngine.biliCal.r_squared, BiomarkerEngine::BILI_FEATS);
            return;
        }
        if (name == "cal_hr") {
            if (!b.hr_valid) { Serial.println(F("# ERR: no raw HR — run bio first")); return; }
            bioEngine.hrCal.addPoint(b.hr_bpm_raw, val);
            bioEngine.hrCal.fit();
            bioEngine.saveCalibration();
            Serial.printf("# hr: +pt(raw=%.0f, ref=%.0f) N=%u R^2=%.2f\n",
                          b.hr_bpm_raw, val, bioEngine.hrCal.pointCount(), bioEngine.hrCal.r_squared);
            return;
        }
        Serial.println(F("# ERR: unknown cal_ command"));
        return;
    }

    char c = line.charAt(0);

    switch (c) {
        case 'r': startStreaming(); break;
        case 's':
            if (bioMode)   stopBio();
            if (streaming) stopStreaming();
            break;
        case 'o': oneShot();        break;
        case 'h': printHelp();      break;

        case 'g': {
            long g = line.substring(1).toInt();
            if (g < 0 || g > 12) { Serial.println(F("# ERR: gain 0..12")); break; }
            if (!sensor.setGain((AS7343::Gain)g)) Serial.println(F("# ERR: setGain failed"));
            else {
                currentGain = (AS7343::Gain)g;
                saveSettings();
                Serial.printf("# gain=%ld (saved)\n", g);
                updateDisplay();
            }
            break;
        }
        case 'i': {
            long us = line.substring(1).toInt();
            if (us <= 0) { Serial.println(F("# ERR: i<us> required")); break; }
            if (!sensor.setIntegrationUs((uint32_t)us)) {
                Serial.println(F("# ERR: setIntegrationUs failed"));
            } else {
                resyncSensor();
                saveSettings();
                uint8_t  atime    = sensor.getAtime();
                uint16_t astep    = sensor.getAstep();
                uint32_t actual   = sensor.getIntegrationUs();
                uint32_t maxCount = (uint32_t)(atime + 1) * (uint32_t)(astep + 1);
                if (maxCount > 65535) maxCount = 65535;
                Serial.printf("# i=%ld us -> ATIME=%u ASTEP=%u  integ=%lu us  max=%lu (saved)\n",
                              us, (unsigned)atime, (unsigned)astep,
                              (unsigned long)actual, (unsigned long)maxCount);
                updateDisplay();
            }
            break;
        }
        case 'a': {
            long v = line.substring(1).toInt();
            if (v < 0 || v > 255) { Serial.println(F("# ERR: a<0-255>")); break; }
            if (!sensor.setAtime((uint8_t)v)) {
                Serial.println(F("# ERR: setAtime failed"));
            } else {
                resyncSensor();
                saveSettings();
                Serial.printf("# ATIME=%ld  integration=%lu us (saved)\n",
                              v, (unsigned long)sensor.getIntegrationUs());
                updateDisplay();
            }
            break;
        }
        case 'A': {
            long v = line.substring(1).toInt();
            if (v < 2 || v > 65535) { Serial.println(F("# ERR: A<2-65535>")); break; }
            if (!sensor.setAstep((uint16_t)(v - 1))) {
                Serial.println(F("# ERR: setAstep failed"));
            } else {
                resyncSensor();
                saveSettings();
                Serial.printf("# ASTEP=%ld steps  integration=%lu us (saved)\n",
                              v, (unsigned long)sensor.getIntegrationUs());
                updateDisplay();
            }
            break;
        }
        case 'R': {
            resyncSensor();
            Serial.println(F("# sensor resynced (SMUX reloaded, status cleared)"));
            updateDisplay();
            break;
        }
        case 'l': {
            long mA = line.substring(1).toInt();
            if (mA < 4 || mA > 258) { Serial.println(F("# ERR: l<mA> 4..258")); break; }
            ledCurrentMA = (uint16_t)mA;
            saveSettings();
            Serial.printf("# LED=%u mA  cap=%u  applied=%u (saved)\n",
                          ledCurrentMA, ledCapMA, cappedLedMA());
            updateDisplay();
            break;
        }
        case 'L': {
            long mA = line.substring(1).toInt();
            if (mA < 4 || mA > 258) { Serial.println(F("# ERR: L<mA> 4..258")); break; }
            ledCapMA = (uint16_t)mA;
            saveSettings();
            Serial.printf("# LED cap=%u  applied=%u (saved)\n", ledCapMA, cappedLedMA());
            updateDisplay();
            break;
        }
        case 'n': {
            long d = line.substring(1).toInt();
            if (d < 0 || d > 255) { Serial.println(F("# ERR: n<0-255>")); break; }
            nirDuty = (uint8_t)d;
            setNirLeds(nirDuty);
            saveSettings();
            Serial.printf("# NIR duty=%u (saved)\n", nirDuty);
            updateDisplay();
            break;
        }
        case 't': {
            Serial.print(F("# touch: "));
            for (int i = 0; i < 10; i++) {
                Serial.printf("%u ", touchRead(TOUCH_PIN));
                delay(20);
            }
            Serial.printf("\n# threshold: %lu\n", (unsigned long)touchThreshold);
            break;
        }
        case '?': {
            auto scanBus = [](TwoWire& bus, const char* name, int sda, int scl) {
                Serial.printf("# Bus %s (SDA=%d SCL=%d):\n", name, sda, scl);
                bool found = false;
                for (uint8_t a = 1; a < 127; a++) {
                    bus.beginTransmission(a);
                    if (bus.endTransmission() == 0) {
                        Serial.printf("#   0x%02X\n", a);
                        found = true;
                    }
                }
                if (!found) Serial.println(F("#   (none)"));
            };
            scanBus(Wire,  "0 AS7343", I2C_SDA,  I2C_SCL);
            scanBus(Wire1, "1 OLED",   OLED_SDA, OLED_SCL);
            break;
        }

        case 'c': {
            if (line.length() >= 2) {
                char sub = line.charAt(1);

                // Model maintenance subcommands
                if (sub == 'r') { model.reset(); Serial.println(F("# model reset")); updateDisplay(); break; }
                if (sub == 's') {
                    Serial.println(model.saveToNVS() ? F("# saved") : F("# ERR: save"));
                    break;
                }
                if (sub == 'L') {
                    Serial.println(model.loadFromNVS() ? F("# loaded") : F("# ERR: load"));
                    updateDisplay();
                    break;
                }
                if (sub == 'w') {
                    Serial.printf("# updates=%d  lambda=%.3f\n",
                                  model.getUpdateCount(), model.getForgetting());
                    const char* names[3]  = { "SpO2", "Hb  ", "Bili" };
                    const char* feats[15] = {
                        "A_F1","A_FZ","A_F5","A_F6","A_F7",
                        "dFZ-F1","dF5-FZ","dF6-F5","dF7-F6",
                        "dd_bili","dd_HbR","slope","A_NIR","A_NIR^2","bias"
                    };
                    for (int k = 0; k < 3; k++) {
                        Serial.printf("# W[%s] = ", names[k]);
                        for (int j = 0; j < 15; j++)
                            Serial.printf("%s:%.3f ", feats[j], model.getWeight(k, j));
                        Serial.println();
                    }
                    break;
                }

                // Baseline subcommands
                if (sub == 'b') {
                    if (line.length() < 3) {
                        Serial.println(F("# ERR: cbr | cbt | cbs"));
                        break;
                    }
                    char sub2 = line.charAt(2);
                    if (sub2 == 'r')      calibrateReflectance();
                    else if (sub2 == 't') calibrateTransmission();
                    else if (sub2 == 's') showBaselineStatus();
                    else                  Serial.println(F("# ERR: cbr | cbt | cbs"));
                    break;
                }
            }

            // Numeric form: c<spo2>,<hb>,<bili>
            if (!hasReading) {
                Serial.println(F("# ERR: no sample — run 'o', 'r' or 'bio' first"));
                break;
            }
            float spo2, hb, bili;
            if (sscanf(line.c_str() + 1, "%f,%f,%f", &spo2, &hb, &bili) != 3) {
                Serial.println(F("# ERR: usage  c<spo2>,<hb>,<bili>  e.g. c98.5,13.8,0.6"));
                break;
            }
            const Biomarkers& b = bioEngine.results();
            int added = 0;

            if (b.ror > 0.001f) {
                bioEngine.spo2Cal.addPoint(b.ror, spo2);
                bioEngine.spo2Cal.fit();
                added++;
            } else {
                Serial.println(F("# WARN: no valid RoR — SpO2 point skipped (run bio first)"));
            }

            if (b.hb_index > 0.001f) {
                float hbF[BiomarkerEngine::HB_FEATS];
                bioEngine.buildHbFeatures(hbF);
                bioEngine.hbCal.addPoint(hbF, hb);
                bioEngine.hbCal.fit(0.1f);
                added++;
            } else {
                Serial.println(F("# WARN: no valid hb_index — Hb point skipped (run bio first)"));
            }

            if (b.bili_index > 0.001f) {
                float biF[BiomarkerEngine::BILI_FEATS];
                bioEngine.buildBiliFeatures(biF);
                bioEngine.biliCal.addPoint(biF, bili);
                bioEngine.biliCal.fit(0.1f);
                added++;
            } else {
                Serial.println(F("# WARN: no valid bili_index — Bili point skipped (run bio first)"));
            }

            if (added > 0) bioEngine.saveCalibration();

            Serial.printf("# trained: spo2 N=%u R^2=%.2f | hb N=%u R^2=%.2f | bili N=%u R^2=%.2f\n",
                          bioEngine.spo2Cal.pointCount(), bioEngine.spo2Cal.r_squared,
                          bioEngine.hbCal.pointCount(),   bioEngine.hbCal.r_squared,
                          bioEngine.biliCal.pointCount(), bioEngine.biliCal.r_squared);
            Serial.printf("# now: spo2=%.2f hb=%.2f bili=%.3f\n",
                          b.spo2,
                          b.hb_cal_valid   ? b.hb_g_dl   : NAN,
                          b.bili_cal_valid ? b.bili_mg_dl : NAN);
            updateDisplay();
            break;
        }

        default:
            Serial.println(F("# ERR: unknown command — h for help"));
            break;
    }
}

// ===== Power management =====

// Helper — centre "ANEBILIN" using the FreeSansBold9pt7b font. Returns the
// cursor (baseline) coordinates so the same string can be redrawn later.
static void anebilinTextOrigin(int& cx, int& cy, int16_t& bx, int16_t& by,
                                uint16_t& tw, uint16_t& th) {
    oled.setFont(&FreeSansBold9pt7b);
    oled.setTextSize(1);
    oled.setTextColor(SSD1306_WHITE);
    oled.getTextBounds("ANEBILIN", 0, 0, &bx, &by, &tw, &th);
    // FreeFont cursor is the baseline; offset so bbox is centred on the screen
    cx = (OLED_W - (int)tw) / 2 - bx;
    cy = (OLED_H - (int)th) / 2 - by;
}

// Cinematic intro — pixels of the word "ANEBILIN" start scattered across the
// screen and drift to their target positions with an ease-out cubic curve.
// The final frame is a clean text redraw so the result is crisp bitmap glyphs,
// not the scattered-pixel approximation from the last animation step.
static void bootAnimation() {
    if (!oledOk) return;

    constexpr int MAX_PX = 512;
    struct Px { int16_t sx, sy, tx, ty; };
    static Px pixels[MAX_PX];
    int count = 0;

    int cx, cy;
    int16_t bx, by;
    uint16_t tw, th;
    anebilinTextOrigin(cx, cy, bx, by, tw, th);

    // Render once to capture the lit-pixel set
    oled.clearDisplay();
    oled.setCursor(cx, cy);
    oled.print(F("ANEBILIN"));

    int boxX0 = cx + bx;
    int boxY0 = cy + by;
    int boxX1 = boxX0 + (int)tw;
    int boxY1 = boxY0 + (int)th;
    if (boxX0 < 0)       boxX0 = 0;
    if (boxY0 < 0)       boxY0 = 0;
    if (boxX1 > OLED_W)  boxX1 = OLED_W;
    if (boxY1 > OLED_H)  boxY1 = OLED_H;

    randomSeed(micros());
    for (int y = boxY0; y < boxY1 && count < MAX_PX; y++) {
        for (int x = boxX0; x < boxX1 && count < MAX_PX; x++) {
            if (oled.getPixel(x, y)) {
                pixels[count].tx = x;
                pixels[count].ty = y;
                pixels[count].sx = random(0, OLED_W);
                pixels[count].sy = random(0, OLED_H);
                count++;
            }
        }
    }

    // Run to f==FRAMES (inclusive) so the last iteration has t=1.0, e=1.0
    // and every pixel lands on its exact integer target — identical to the
    // clean text frame that follows, making the transition invisible.
    constexpr int FRAMES = 90;
    for (int f = 0; f <= FRAMES; f++) {
        float t   = (float)f / (float)FRAMES;
        float inv = 1.0f - t;
        float e   = 1.0f - inv * inv * inv;   // ease-out cubic

        oled.clearDisplay();
        for (int i = 0; i < count; i++) {
            int x = pixels[i].sx + (int)lroundf((float)(pixels[i].tx - pixels[i].sx) * e);
            int y = pixels[i].sy + (int)lroundf((float)(pixels[i].ty - pixels[i].sy) * e);
            oled.drawPixel(x, y, SSD1306_WHITE);
        }
        oled.display();
        delay(20);
    }

    // Final frame: clean bitmap text. The last animation frame already has
    // every pixel at its exact target so this is a zero-visible-change swap.
    oled.clearDisplay();
    oled.setCursor(cx, cy);
    oled.print(F("ANEBILIN"));
    oled.display();
    delay(900);

    oled.setFont(nullptr);   // restore default font for the rest of the UI
}

static void enterDeepSleep() {
    Serial.println(F("# 90s idle — entering deep sleep (hold touch 2s to wake)"));
    Serial.flush();

    if (streaming) stopStreaming();
    ecg.stop();
    sensor.setLed(false, cappedLedMA());
    setNirLeds(0);

    // Tear down BLE — deep sleep would lose the radio anyway, but explicit
    // deinit avoids a leaky disconnect from the dashboard's perspective.
    NimBLEDevice::deinit(true);

    if (oledOk) {
        oled.clearDisplay();
        int cx, cy; int16_t bx, by; uint16_t tw, th;
        anebilinTextOrigin(cx, cy, bx, by, tw, th);
        oled.setCursor(cx, cy);
        oled.print(F("ANEBILIN"));
        oled.display();
        delay(900);
        oled.setFont(nullptr);
        oled.ssd1306_command(SSD1306_DISPLAYOFF);
    }

    touchSleepWakeUpEnable(TOUCH_PIN, touchThreshold);
    esp_deep_sleep_start();
}

// After a touchpad wake event, the user must keep the pad held for 5 seconds
// before normal init proceeds. Releasing early sends the device back to sleep.
static void confirmWakeHold() {
    if (esp_sleep_get_wakeup_cause() != ESP_SLEEP_WAKEUP_TOUCHPAD) return;

    uint32_t holdStart = millis();
    while (true) {
        bool isTouched = (touchRead(TOUCH_PIN) > touchThreshold);
        uint32_t held  = millis() - holdStart;

        if (!isTouched) {
            if (oledOk) {
                oled.clearDisplay();
                oled.display();
                oled.ssd1306_command(SSD1306_DISPLAYOFF);
            }
            touchSleepWakeUpEnable(TOUCH_PIN, touchThreshold);
            esp_deep_sleep_start();
        }
        if (held >= WAKE_HOLD_MS) break;

        if (oledOk) {
            oled.clearDisplay();
            oled.setTextSize(1);
            oled.setTextColor(SSD1306_WHITE);
            oled.setCursor(22, 14);
            oled.print(F("HOLD TO WAKE"));
            int bar = (int)((held * 108) / WAKE_HOLD_MS);
            oled.drawRect(10, 34, 108, 10, SSD1306_WHITE);
            oled.fillRect(10, 34, bar, 10, SSD1306_WHITE);
            uint32_t remaining = (WAKE_HOLD_MS - held + 999) / 1000;
            char buf[8];
            snprintf(buf, sizeof(buf), "%lus", (unsigned long)remaining);
            oled.setCursor(56, 50);
            oled.print(buf);
            oled.display();
        }
        delay(30);
    }
}

// 20-second continuous scan, accumulates ADC + prediction averages.
// Live progress on OLED; results page at the end with the averaged biomarkers.
static void runContinuousScan() {
    sensor.setLed(true, cappedLedMA());
    setNirLeds(measurementNirDuty());
    delay(2);

    // Spin up the AC/DC engine so HR/SpO2/Hb from the BiomarkerEngine get
    // included in the result page averages.
    const float integ_s = (float)sensor.getIntegrationUs() / 1e6f;
    const float fs      = 1.0f / (integ_s + 0.002f);
    signalFilter.init(fs, 0.5f);
    bioEngine.init(fs);
    bioEngine.loadCalibration();

    double   biliSum  = 0.0;
    double   spo2Sum  = 0.0;
    double   hbSum    = 0.0;
    double   hrSum    = 0.0;
    uint32_t spo2N    = 0, hbN = 0, biliN = 0, hrN = 0;
    uint64_t adcSum[6] = { 0, 0, 0, 0, 0, 0 };
    uint32_t samples   = 0;
    uint32_t startMs   = millis();
    uint32_t lastDraw  = 0;

    Serial.printf("# scan start — %lums continuous read (Fs ≈ %.1f Hz)\n",
                  (unsigned long)scanDurationMs, fs);

    while (true) {
        uint32_t elapsed = millis() - startMs;
        if (elapsed >= scanDurationMs) break;

        uint16_t v[6];
        if (!sensor.measure6(v, 500)) {
            Serial.println(F("# WARN: measure6 timeout in scan"));
            continue;
        }
        for (int i = 0; i < 6; i++) adcSum[i] += v[i];
        memcpy(lastAdc, v, sizeof(lastAdc));

        signalFilter.update(
            (float)v[AnebilModel::IDX_F1],
            (float)v[AnebilModel::IDX_FZ],
            (float)v[AnebilModel::IDX_FY],
            (float)v[AnebilModel::IDX_F6],
            (float)v[AnebilModel::IDX_F7],
            (float)v[AnebilModel::IDX_NIR]);
        bioEngine.update(signalFilter, micros());

        const Biomarkers& b = bioEngine.results();
        // Skip the first 2 s while the AC EMA settles
        const uint32_t settle_samples = (uint32_t)(2.0f * fs);
        if (samples >= settle_samples && b.ror > 0.0f) {
            spo2Sum += b.spo2; spo2N++;
            if (b.hb_cal_valid)   { hbSum   += b.hb_g_dl;   hbN++; }
            if (b.bili_cal_valid) { biliSum += b.bili_mg_dl; biliN++; }
        }
        if (b.hr_valid) { hrSum += b.heart_rate; hrN++; }

        samples++;
        hasReading = true;
        noteActivity();

        if (oledOk && millis() - lastDraw > 250) {
            lastDraw = millis();
            float spo2 = spo2N ? (float)(spo2Sum / spo2N) : 0.0f;
            float hb   = hbN   ? (float)(hbSum   / hbN)   : NAN;
            float bili = biliN ? (float)(biliSum / biliN) : NAN;
            float hr   = hrN   ? (float)(hrSum   / hrN)   : 0.0f;

            oled.clearDisplay();
            oled.setTextSize(1);
            oled.setTextColor(SSD1306_WHITE);
            oled.setCursor(0, 0);
            oled.print(F("SCANNING"));
            uint32_t remS = (scanDurationMs - elapsed + 999) / 1000;
            oled.setCursor(80, 0);
            oled.printf("%2lus N%lu", (unsigned long)remS, (unsigned long)samples);

            int bar = (int)((elapsed * 120) / scanDurationMs);
            oled.drawRect(4, 10, 120, 5, SSD1306_WHITE);
            oled.fillRect(4, 10, bar, 5, SSD1306_WHITE);

            oled.setCursor(0, 18);
            if (hrN) oled.printf("HR:  %4.0f bpm",   hr);
            else     oled.print(F("HR:  --  bpm"));
            oled.setCursor(0, 30);
            if (spo2N) oled.printf("SpO2:%5.1f %%",  spo2);
            else       oled.print(F("SpO2: --"));
            oled.setCursor(0, 42);
            if (hbN) oled.printf("Hb:  %5.1f g/dL", hb);
            else     oled.print(F("Hb:  --"));
            oled.setCursor(0, 54);
            if (biliN) oled.printf("Bili:%5.2f mg/dL", bili);
            else       oled.print(F("Bili: --"));
            oled.display();
        }
    }

    sensor.setLed(false, cappedLedMA());
    setNirLeds(0);

    if (samples == 0) {
        Serial.println(F("# scan: no valid samples"));
        return;
    }

    float spo2 = spo2N ? (float)(spo2Sum / spo2N) : 0.0f;
    float hb   = hbN   ? (float)(hbSum   / hbN)   : NAN;
    float bili = biliN ? (float)(biliSum / biliN) : NAN;
    float hr   = hrN   ? (float)(hrSum   / hrN)   : 0.0f;
    lastEst[0] = spo2;
    lastEst[1] = hb;
    lastEst[2] = bili;
    for (int i = 0; i < 6; i++) lastAdc[i] = (uint16_t)(adcSum[i] / samples);

    Serial.printf("# scan done  N=%lu  HR=%.0f(N=%lu)  SpO2=%.2f(N=%lu)  Hb=%.2f(N=%lu)  Bili=%.2f(N=%lu)\n",
                  (unsigned long)samples,
                  hr,   (unsigned long)hrN,
                  spo2, (unsigned long)spo2N,
                  hb,   (unsigned long)hbN,
                  bili, (unsigned long)biliN);

    if (oledOk) {
        oled.clearDisplay();
        oled.setTextSize(1);
        oled.setTextColor(SSD1306_WHITE);
        oled.setCursor(40, 0);
        oled.print(F("RESULTS"));
        oled.drawFastHLine(0, 10, 128, SSD1306_WHITE);
        oled.setCursor(0, 14);
        if (hrN) oled.printf("HR:   %4.0f bpm", hr);
        else     oled.print(F("HR:   --  bpm"));
        oled.setCursor(0, 26);
        if (spo2N) oled.printf("SpO2: %5.1f %%",  spo2);
        else       oled.print(F("SpO2: --"));
        oled.setCursor(0, 38);
        if (hbN) oled.printf("Hb:   %5.1f g/dL", hb);
        else     oled.print(F("Hb:   --  g/dL"));
        oled.setCursor(0, 50);
        if (biliN) oled.printf("Bili: %5.2f mg/dL", bili);
        else       oled.print(F("Bili: --  (need cal)"));
        oled.display();
    }
    noteActivity();
}

// ===== On-device capture storage (LittleFS) =====
//
// `cap <seconds> [subject]` streams raw 6-channel ADC to /captures/<name>.csv.
// Metadata comment lines carry the capture config so recordings stay
// comparable offline. Pull files with `ls` + `get <file>`, or the host tool
// tools/fetch_captures.py.

static String capturePath(const String& name) {
    if (name.startsWith("/")) return name;
    return String("/captures/") + name;
}

static bool ensureCaptureFs() {
    if (!LittleFS.begin(true)) {
        Serial.println(F("# ERR: LittleFS mount failed"));
        return false;
    }
    if (!LittleFS.exists("/captures")) LittleFS.mkdir("/captures");
    return true;
}

static void runFileCapture(uint32_t durationMs, const String& subject) {
    if (streaming || bioMode) {
        Serial.println(F("# ERR: stop stream/bio first ('s')"));
        return;
    }
    if (ecg.state() == EcgState::Recording) {
        Serial.println(F("# ERR: ECG running — 'ecgs' first"));
        return;
    }
    if (!ensureCaptureFs()) return;

    String subj = subject.length() ? subject : String("capture");
    String safe;
    for (size_t i = 0; i < subj.length(); i++) {
        char ch = subj[i];
        if (isalnum((unsigned char)ch) || ch == '-' || ch == '_') safe += ch;
        else safe += '_';
    }
    subj = safe.length() ? safe : String("capture");
    String path = String("/captures/") + subj + "_" + String(millis()) + ".csv";

    File f = LittleFS.open(path, FILE_WRITE);
    if (!f) {
        Serial.printf("# ERR: cannot create %s\n", path.c_str());
        return;
    }

    sensor.setLed(true, cappedLedMA());
    setNirLeds(measurementNirDuty());
    delay(2);

    const float integ_s = (float)sensor.getIntegrationUs() / 1e6f;
    const float fs      = 1.0f / (integ_s + 0.002f);

    f.printf("# subject=%s\n", subj.c_str());
    f.printf("# gain=%u\n", (unsigned)currentGain);
    f.printf("# integ_us=%lu\n", (unsigned long)sensor.getIntegrationUs());
    f.printf("# led_ma=%u\n", (unsigned)cappedLedMA());
    f.printf("# nir_duty=%u\n", (unsigned)measurementNirDuty());
    f.printf("# fs_hz=%.2f\n", fs);
    f.println(F("time_ms,F1_405,FZ_450,FY_555,F6_640,F7_690,NIR_855"));

    Serial.printf("# capture -> %s  (%lums, Fs~%.1f Hz)\n",
                  path.c_str(), (unsigned long)durationMs, fs);

    uint32_t startMs   = millis();
    uint32_t lastFlush = startMs;
    uint32_t lastDraw  = 0;
    uint32_t samples   = 0;

    while (true) {
        uint32_t elapsed = millis() - startMs;
        if (elapsed >= durationMs) break;

        uint16_t v[6];
        if (!sensor.measure6(v, 500)) {
            Serial.println(F("# WARN: measure6 timeout"));
            continue;
        }
        memcpy(lastAdc, v, sizeof(lastAdc));
        hasReading = true;
        f.printf("%lu,%u,%u,%u,%u,%u,%u\n",
                 (unsigned long)elapsed,
                 v[0], v[1], v[2], v[3], v[4], v[5]);
        samples++;

        if (millis() - lastFlush > 1000) { lastFlush = millis(); f.flush(); }

        if (oledOk && millis() - lastDraw > 500) {
            lastDraw = millis();
            oled.clearDisplay();
            oled.setTextSize(1);
            oled.setTextColor(SSD1306_WHITE);
            oled.setCursor(0, 0);  oled.print(F("CAPTURING"));
            oled.setCursor(0, 16); oled.print(subj);
            oled.setCursor(0, 32); oled.printf("N=%lu", (unsigned long)samples);
            oled.setCursor(0, 48);
            oled.printf("%lus left", (unsigned long)((durationMs - elapsed + 999) / 1000));
            oled.display();
        }
        noteActivity();
    }

    f.flush();
    size_t sz = f.size();
    f.close();

    sensor.setLed(false, cappedLedMA());
    setNirLeds(0);

    Serial.printf("# capture done: %lu samples, %u bytes -> %s\n",
                  (unsigned long)samples, (unsigned)sz, path.c_str());
    updateDisplay();
}

static void listCaptureFiles() {
    if (!ensureCaptureFs()) return;
    File dir = LittleFS.open("/captures");
    if (!dir || !dir.isDirectory()) {
        Serial.println(F("# no captures"));
        Serial.println(F("# END LIST"));
        return;
    }
    uint32_t n     = 0;
    size_t   total = 0;
    File f = dir.openNextFile();
    while (f) {
        if (!f.isDirectory()) {
            Serial.printf("# FILE %s %u\n", f.name(), (unsigned)f.size());
            total += f.size();
            n++;
        }
        f = dir.openNextFile();
    }
    dir.close();
    Serial.printf("# %lu file(s), %u bytes\n", (unsigned long)n, (unsigned)total);
    Serial.println(F("# END LIST"));
}

// Wire format: "# GET <name> <size>\n" <size raw bytes> "\n# END\n"
static void sendCaptureFile(const String& name) {
    if (!ensureCaptureFs()) return;
    String path = capturePath(name);
    File f = LittleFS.open(path, FILE_READ);
    if (!f) {
        Serial.printf("# ERR: no such file %s\n", path.c_str());
        return;
    }
    size_t sz = f.size();
    Serial.printf("# GET %s %u\n", name.c_str(), (unsigned)sz);
    Serial.flush();

    uint8_t buf[256];
    while (f.available()) {
        size_t n = f.read(buf, sizeof(buf));
        if (!n) break;
        Serial.write(buf, n);
        Serial.flush();
    }
    f.close();
    Serial.print(F("\n# END\n"));
    Serial.flush();
}

static void removeCaptureFiles(const String& name) {
    if (!ensureCaptureFs()) return;
    if (name == "all") {
        std::vector<String> paths;
        File dir = LittleFS.open("/captures");
        if (dir && dir.isDirectory()) {
            File f = dir.openNextFile();
            while (f) {
                if (!f.isDirectory()) paths.push_back(String(f.path()));
                f = dir.openNextFile();
            }
            dir.close();
        }
        uint32_t n = 0;
        for (auto& p : paths) if (LittleFS.remove(p)) n++;
        Serial.printf("# removed %lu file(s)\n", (unsigned long)n);
        return;
    }
    String path = capturePath(name);
    if (LittleFS.remove(path)) Serial.printf("# removed %s\n", path.c_str());
    else                       Serial.printf("# ERR: no such file %s\n", path.c_str());
}

// ===== BLE integration =====

static void updateBleSnapshot();   // defined below blePublishTask

// Drives the bio engine from a BLE control byte. Runs on core 1 (loop thread)
// so it can touch sensor/SMUX state safely. NimBLE callback queues the byte;
// pollControl() in loop() drains it here.
static void handleBleControl(uint8_t cmd) {
    Serial.printf("# BLE ctrl: 0x%02X\n", cmd);
    noteActivity();

    switch (cmd) {
        case 0x00:                            // Stop
            if (bioMode) stopBio();
            bleScanActive = false;
            updateBleSnapshot();              // capture settled values before Idle
            g_pendingFinalPublish = true;     // blePublishTask sends one final packet
            ble.setMode(BLEManager::Mode::Idle);
            break;

        case 0x01:                            // Start Normal (40 Hz biomarker pipeline)
            // Recommend i25000 (40 Hz) but honour whatever the user has set.
            if (!bioMode) startBio();
            bleScanActive = true;
            ble.setMode(BLEManager::Mode::Normal);
            break;

        case 0x02:                            // Start BP (200 Hz fast pipeline)
            // BP is a stub for now — uses the same bio pipeline.
            // TODO: switch integration to i5000 (200 Hz) and implement BP/resp.
            if (!bioMode) startBio();
            bleScanActive = true;
            ble.setMode(BLEManager::Mode::BP);
            Serial.println(F("# BP mode: stub (SBP/DBP send NaN; cal in follow-up)"));
            break;

        default:
            Serial.printf("# BLE: unknown ctrl byte 0x%02X — ignored\n", cmd);
            break;
    }
}

// Push the current ECG state to FFF6 so the client can drive the chunk sweep.
static void ecgPushStatus() {
    ble.setEcgStatus((uint8_t)ecg.state(), ecg.sampleRate(),
                     ecg.sampleCount(), ecg.capturedDurationMs());
}

// Dispatch an FFF4 ECG control message. Runs on core 1 via pollEcgControl so it
// can touch the sampler state safely.
static void handleEcgControl(const BLEManager::EcgControlMsg& m) {
    noteActivity();
    switch (m.cmd) {
        case 0x10: {                                   // start scan
            if (bioMode || streaming) {
                Serial.println(F("# ECG ctrl: busy — stop bio/stream"));
                return;
            }
            ecg.setSerialStream(false);                // BLE scans don't stream
            uint32_t dur = m.arg ? (uint32_t)m.arg * 1000u : 0;
            if (ecg.start(dur)) {
                Serial.printf("# ECG ctrl: start (dur=%lums)\n", (unsigned long)dur);
            } else {
                Serial.println(F("# ECG ctrl: start failed"));
            }
            ecgPushStatus();
            break;
        }
        case 0x11:                                     // stop
        case 0x15:                                     // abort (same effect)
            ecg.stop();
            Serial.println(F("# ECG ctrl: stop"));
            ecgPushStatus();
            break;
        case 0x12:                                     // get meta/status
            ecgPushStatus();
            break;
        case 0x13: {                                   // request chunk (arg = seq)
            uint16_t cs = ble.ecgChunkSamples();
            static int16_t chunk[ECGManager::CHUNK_SAMPLES];
            uint32_t start = (uint32_t)m.arg * cs;
            uint32_t n = ecg.getChunk(start, chunk, cs);
            if (n) {
                ble.publishEcgChunk(m.arg, chunk, (uint16_t)n);
            }
            break;
        }
        case 0x14:                                     // clear buffer
            ecg.clear();
            Serial.println(F("# ECG ctrl: cleared"));
            ecgPushStatus();
            break;
        default:
            Serial.printf("# ECG ctrl: unknown 0x%02X\n", m.cmd);
            break;
    }
}

// FreeRTOS task on core 0 — pinned away from the sensor loop so BLE airtime
// timing isn't disturbed by 100 ms measure6 calls. Publishes the current
// snapshot at ~1 Hz when in Normal/BP mode and a client is connected.
static void blePublishTask(void* /*arg*/) {
    const TickType_t period = pdMS_TO_TICKS(1000);
    TickType_t lastWake = xTaskGetTickCount();
    for (;;) {
        if (ble.mode() != BLEManager::Mode::Idle && ble.isConnected()) {
            publishCurrentSnapshot();
        } else if (g_pendingFinalPublish && ble.isConnected()) {
            g_pendingFinalPublish = false;
            publishCurrentSnapshot();
        }
        vTaskDelayUntil(&lastWake, period);
    }
}

// Update the shared snapshot from the latest BiomarkerEngine result. Called
// every sample by the bio loop on core 1.
static void updateBleSnapshot() {
    const Biomarkers& b = bioEngine.results();
    float local[8];
    if (ble.mode() == BLEManager::Mode::BP) packBpSnapshot(b, local);
    else                                    packNormalSnapshot(b, local);

    portENTER_CRITICAL(&g_snapMux);
    memcpy((void*)g_snap, local, sizeof(local));
    g_snapFresh   = true;
    g_snapStaleMs = millis();
    portEXIT_CRITICAL(&g_snapMux);
}

// ===== Arduino entry points =====

void setup() {
    Serial.begin(115200);
    delay(300);

    if (!ledcAttach(NIR_PIN_A, NIR_PWM_HZ, NIR_PWM_BITS))
        Serial.printf("# WARN: ledcAttach failed for NIR GPIO%d\n", NIR_PIN_A);
    if (!ledcAttach(NIR_PIN_B, NIR_PWM_HZ, NIR_PWM_BITS))
        Serial.printf("# WARN: ledcAttach failed for NIR GPIO%d\n", NIR_PIN_B);
    setNirLeds(0);

    // OLED first so wake-confirm UI + boot animation can run before AS7343 init
    Wire1.begin(OLED_SDA, OLED_SCL);
    Wire1.setClock(400000);
    if (oled.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
        oledOk = true;
        oled.setRotation(2);
        oled.clearDisplay();
        oled.display();
    } else {
        Serial.println(F("# WARN: OLED not found at 0x3C"));
    }

    // If we just woke from deep sleep, require a 5-second hold before booting
    confirmWakeHold();

    // Cinematic intro
    bootAnimation();

    Wire.begin(I2C_SDA, I2C_SCL, I2C_HZ);
    Serial.println(F("# ANEBILIN — AS7343 hybrid spectrometer"));

    if (!sensor.begin(Wire, AS7343_ADDR)) {
        uint8_t id = 0;
        sensor.getDeviceID(id);
        Serial.printf("# FATAL: AS7343 ID=0x%02X (want 0x81)\n", id);
        if (oledOk) {
            oled.clearDisplay();
            oled.setCursor(0, 0);
            oled.println(F("AS7343 FATAL"));
            oled.printf("ID=0x%02X want 0x81", id);
            oled.display();
        }
        while (true) { delay(1000); }
    }

    sensor.setIntegrationUs(INTEGRATION_US);
    sensor.setGain(DEFAULT_GAIN);
    currentGain = DEFAULT_GAIN;

    if (!configureSmux()) {
        Serial.println(F("# FATAL: SMUX program failed"));
        while (true) { delay(1000); }
    }

    sensor.clearAllStatus();

    // Restore any settings the user changed via serial in a previous session.
    // Falls back to defaults silently if no valid NVS blob.
    if (loadSettings())
        Serial.println(F("# settings restored from NVS"));

    if (model.loadFromNVS())
        Serial.printf("# model: loaded (%d updates, refl=%d, trans=%d)\n",
                      model.getUpdateCount(),
                      model.hasReflectanceBaseline(),
                      model.hasTransmissionBaseline());
    else
        Serial.println(F("# model: starting fresh — run cbr & cbt to calibrate"));

    // Biomarker engine — preload AC/DC calibrators from NVS so SpO2/HR/Hb
    // stay calibrated across reboots. Engine is re-init()'d at each `bio` so
    // Fs matches current integration.
    bioEngine.init(40.0f);
    bioEngine.loadCalibration();
    Serial.printf("# bio cal: spo2_pts=%u(fit=%d) hb_pts=%u(fit=%d) hr_pts=%u(fit=%d)\n",
                  bioEngine.spo2Cal.pointCount(), bioEngine.spo2Cal.isFitted(),
                  bioEngine.hbCal.pointCount(),   bioEngine.hbCal.isFitted(),
                  bioEngine.hrCal.pointCount(),   bioEngine.hrCal.isFitted());

    // LittleFS holds raw capture CSVs for offline model training. Uses the
    // default "spiffs" data partition; formats it on first boot if blank.
    if (LittleFS.begin(true)) {
        Serial.printf("# LittleFS: %u/%u bytes used\n",
                      (unsigned)LittleFS.usedBytes(), (unsigned)LittleFS.totalBytes());
    } else {
        Serial.println(F("# WARN: LittleFS mount failed — on-device capture disabled"));
    }

    char gbuf[8];
    gainStr(currentGain, gbuf, sizeof(gbuf));
    Serial.printf("# ready — gain=X%s integ=%lu us LED=%u/%u mA  NIR=%u\n",
                  gbuf,
                  (unsigned long)sensor.getIntegrationUs(),
                  ledCurrentMA, ledCapMA, nirDuty);

    // ---- BLE bring-up (NimBLE host pins itself to core 0) ----
    // Disable brownout detector before NimBLE init — BLE radio startup
    // pulls a ~140 mA current spike that trips the BOD on USB-powered boards.
    // WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG,0) is ESP32 only; on ESP32-S3
    // the BOD lives in the LP_ANA domain and the correct API is below.
    esp_brownout_disable();
    Serial.flush();
    delay(100);
    ble.begin("Anebilin");
    xTaskCreatePinnedToCore(
        blePublishTask,    // task fn
        "blePub",          // name
        8192,              // stack (bumped from 4 KB to absorb NimBLE alloc)
        nullptr,           // arg
        1,                 // prio
        nullptr,           // handle
        0                  // pin to core 0 (same core as NimBLE host)
    );

    // ---- ECG bring-up (AD8232) ----
    if (!ecg.begin(ECG_ADC_PIN, ECG_SDN_PIN, ECGManager::DEFAULT_FS)) {
        Serial.println(F("# WARN: ECG init failed — ECG disabled"));
    }

    printHelp();
    updateDisplay();
    noteActivity();
}

void loop() {
    // --- Touch ---
    //   tap  < 1s              → cycle display view
    //   hold ≥ 1s, then release → 20s continuous scan
    //   hold ≥ 5s (still held)  → deep sleep immediately
    {
        uint32_t now = millis();
        bool isTouched = (touchRead(TOUCH_PIN) > touchThreshold);

        if (isTouched) {
            noteActivity();
            if (!touchActive && (now - touchReleaseMs > TOUCH_DEBOUNCE_MS)) {
                touchActive       = true;
                touchPressStartMs = now;
                touchSleepFired   = false;
            }
            // 5s hold → sleep (fires while still held, before release)
            if (touchActive && !touchSleepFired &&
                (now - touchPressStartMs >= TOUCH_SLEEP_PRESS_MS)) {
                touchSleepFired = true;
                Serial.println(F("# 5s hold → deep sleep"));
                enterDeepSleep();
            }
        } else {
            if (touchActive) {
                uint32_t held  = now - touchPressStartMs;
                touchActive    = false;
                touchReleaseMs = now;
                noteActivity();
                if (!touchSleepFired) {
                    if (held >= TOUCH_LONG_PRESS_MS) {
                        // released after ≥1s but before 5s → trigger scan
                        if (streaming || bioMode || ecg.state() == EcgState::Recording) {
                            Serial.println(F("# long-press ignored (measurement running)"));
                        } else {
                            Serial.printf("# long-press → %lus scan\n", (unsigned long)(scanDurationMs / 1000));
                            runContinuousScan();
                        }
                    } else {
                        // short tap → cycle view
                        displayMode = (DisplayMode)((displayMode + 1) % DM_COUNT);
                        updateDisplay();
                    }
                }
            }
        }
    }

    // --- Serial command parsing ---
    // Accept CR, LF, or CRLF — some monitors/scripts send CR only. Backspace
    // edits the line. (spectru's SerialManager did the same.)
    static String rxBuf;
    while (Serial.available()) {
        noteActivity();
        char c = (char)Serial.read();
        if (c == '\r' || c == '\n') {
            if (rxBuf.length() > 0) {
                rxBuf.trim();
                handleCommand(rxBuf);
                rxBuf = "";
            }
        } else if (c == '\b' || c == 0x7F) {
            if (rxBuf.length() > 0) rxBuf.remove(rxBuf.length() - 1);
        } else {
            rxBuf += c;
            if (rxBuf.length() > 64) rxBuf = "";
        }
    }

    // --- Bio live mode (full AC/DC engine, 100 ms display refresh) ---
    if (bioMode) {
        uint16_t v[6];
        if (sensor.measure6(v, 500)) {
            memcpy(lastAdc, v, sizeof(lastAdc));
            hasReading = true;

            signalFilter.update(
                (float)v[AnebilModel::IDX_F1],
                (float)v[AnebilModel::IDX_FZ],
                (float)v[AnebilModel::IDX_FY],
                (float)v[AnebilModel::IDX_F6],
                (float)v[AnebilModel::IDX_F7],
                (float)v[AnebilModel::IDX_NIR]);
            bioEngine.update(signalFilter, micros());

            const Biomarkers& b = bioEngine.results();
            const uint32_t nowMs = millis();

            if (nowMs - bioLastSerialMs >= 250) {
                bioLastSerialMs = nowMs;
                Serial.printf("bio %lu, hr=%.0f, sdnn=%.0f, rmssd=%.0f, spo2=%.2f, ror=%.3f, hb_idx=%.3f, hb=%.2f, bili_idx=%.3f, bili=%.2f\n",
                              (unsigned long)nowMs,
                              b.hr_valid ? b.heart_rate : 0.0f,
                              b.hr_valid ? b.hrv_sdnn   : 0.0f,
                              b.hr_valid ? b.hrv_rmssd  : 0.0f,
                              b.spo2, b.ror,
                              b.hb_index,
                              b.hb_cal_valid ? b.hb_g_dl : NAN,
                              b.bili_index,
                              b.bili_cal_valid ? b.bili_mg_dl : NAN);
            }

            if (oledOk && (nowMs - bioLastDisplayMs >= 100)) {
                bioLastDisplayMs = nowMs;
                oled.clearDisplay();
                drawBioView();
                oled.display();
            }

            updateBleSnapshot();   // hand fresh values off to the BLE task
            noteActivity();
        } else {
            Serial.println(F("# WARN: bio measure6 timeout"));
        }
    }
    // --- Streaming (also drives BiomarkerEngine for consistent estimates) ---
    else if (streaming) {
        uint16_t v[6];
        if (sensor.measure6(v, 250)) {
            memcpy(lastAdc, v, sizeof(lastAdc));
            hasReading = true;

            signalFilter.update(
                (float)v[AnebilModel::IDX_F1],
                (float)v[AnebilModel::IDX_FZ],
                (float)v[AnebilModel::IDX_FY],
                (float)v[AnebilModel::IDX_F6],
                (float)v[AnebilModel::IDX_F7],
                (float)v[AnebilModel::IDX_NIR]);
            bioEngine.update(signalFilter, micros());

            const Biomarkers& b = bioEngine.results();
            lastEst[0] = b.spo2;
            lastEst[1] = b.hb_cal_valid   ? b.hb_g_dl    : NAN;
            lastEst[2] = b.bili_cal_valid ? b.bili_mg_dl : NAN;

            emitSample(millis() - streamT0, v);
            if (++displayTick >= 10) {
                displayTick = 0;
                updateDisplay();
            }
            updateBleSnapshot();
            noteActivity();
        } else {
            Serial.println(F("# WARN: measure6 timeout"));
        }
    } else {
        delay(2);
    }

    // --- BLE control byte drain (NimBLE callbacks queue, we dispatch here) ---
    ble.pollControl(handleBleControl);
    ble.pollEcgControl(handleEcgControl);

    // Push an FFF6 indicate whenever the ECG state changes (e.g. Recording→Ready).
    if (ecg.state() != lastEcgState) {
        lastEcgState = ecg.state();
        ecgPushStatus();
    }

    // --- Inactivity → deep sleep ---
    // Keep awake while advertising (discoverable), connected, mid-scan, or
    // while a host has the USB-CDC port open (so USB commands keep working).
    // Without the isAdvertising() check the 30s timer fires and the device
    // goes back to sleep before a client ever has a chance to connect.
    if (Serial) noteActivity();
    if (bleScanActive || ecg.state() == EcgState::Recording ||
        ble.isConnected() || ble.isAdvertising()) noteActivity();
    if (millis() - lastActivityMs > INACTIVITY_TIMEOUT_MS) {
        enterDeepSleep();
    }
}
