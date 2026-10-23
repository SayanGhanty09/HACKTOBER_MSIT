// AS7343.h — ams AS7343 spectral sensor driver for ESP32-S3 (Arduino framework)
//
// Goals:
//   * Full sensor control via function calls (no global state, no hidden cycles).
//   * Fast 6-channel single-chain reads using one I2C burst (12 bytes).
//   * Custom SMUX routing (Method A "RAM" and Method B "Direct Chain" per AN001033).
//   * Programmable internal LED current (4..258 mA, 2 mA steps).
//   * No spurious register-bank toggling (the AS7343 doesn't need it for any reg we use).
//
// Quick start (custom 6-channel for bilirubin + Hb, ~50 ms integration):
//
//   AS7343 sensor;
//   Wire.begin(SDA_PIN, SCL_PIN, 400000);            // 400 kHz I2C
//   sensor.begin(Wire);
//   sensor.setAtime(29); sensor.setAstep(599);       // 50 ms
//   sensor.setGain(AS7343::Gain::X128);
//   sensor.setLed(true, 50);                         // 50 mA internal LED
//
//   AS7343::Chain c;
//   c.route(AS7343::PX_FZ,  0)   // 450 nm → ADC0  bilirubin peak
//    .route(AS7343::PX_F1,  1)   // 405 nm → ADC1
//    .route(AS7343::PX_F3,  2)   // 475 nm → ADC2
//    .route(AS7343::PX_F5,  3)   // 550 nm → ADC3  Hb isosbestic
//    .route(AS7343::PX_F7,  4)   // 690 nm → ADC4  Hb absorption
//    .route(AS7343::PX_NIR, 5);  // 855 nm → ADC5  IR baseline
//   sensor.writeSmuxRam(c);
//   sensor.setChains(AS7343::Chains::ONE);
//
//   uint16_t adc[6];
//   if (sensor.measure6(adc)) { /* use adc[0..5] */ }
//
// Notes:
//   * The internal LED pin (LDR) sinks current — wire an external LED with cathode → LDR.
//   * AS7343 is a 1.8 V I/O part. Use a level shifter (e.g. TXS0108E) to ESP32-S3 3.3 V.
//   * Driver is single-instance / blocking. Wrap in a FreeRTOS task if needed.

#pragma once

#include <Arduino.h>
#include <Wire.h>

class AS7343 {
public:
    static constexpr uint8_t DEFAULT_ADDR = 0x39;
    static constexpr uint8_t DEVICE_ID    = 0x81;

    // CFG1.AGAIN encoding
    enum class Gain : uint8_t {
        X0_5 = 0, X1, X2, X4, X8, X16, X32, X64,
        X128, X256, X512, X1024, X2048
    };

    // CFG20.autorun_smux2 value — how many chains per measurement cycle
    enum class Chains : uint8_t {
        ONE   = 0,   //  6 channels, single integration
        TWO   = 2,   // 12 channels, two integrations
        THREE = 3    // 18 channels, three integrations
    };

    // SMUX pixel IDs (AN001033 Fig. 3 chain map)
    enum Pixel : uint8_t {
        PX_VIS_LB = 0,  PX_FXL    = 1,  PX_F2     = 2,  PX_F7  = 3,
        PX_FZ     = 4,  PX_F1     = 5,  PX_F4     = 6,  PX_F5  = 7,
        PX_VIS_LT = 8,  PX_VIS_RT = 9,  PX_F6     = 10, PX_F8  = 11,
        PX_FY     = 12, PX_F3     = 13, PX_VIS_RB = 14, PX_FD  = 15,
        PX_NIR    = 16, PX_EXT    = 17, PX_DARK   = 18
    };

    struct Status {
        bool dataValid;       // STATUS2.AVALID
        bool spectralIrq;     // STATUS.AINT
        bool fifoIrq;         // STATUS.FINT
        bool systemIrq;       // STATUS.SINT
        bool asat;            // STATUS.ASAT
        bool asatAnalog;      // STATUS2.ASAT_ANALOG
        bool asatDigital;     // STATUS2.ASAT_DIGITAL
        bool overTemp;        // STATUS4.OVTEMP
        Gain appliedGain;     // ASTATUS[3:0]
    };

    // SMUX chain builder. Index = pixel ID. Value = ADC+1 (0 = pixel disabled).
    // Multiple pixels may route to the same ADC; their photocurrents sum.
    class Chain {
    public:
        Chain() { reset(); }
        Chain& reset() {
            for (uint8_t i = 0; i < 19; i++) _pix[i] = 0;
            return *this;
        }
        // adc: 0..5  → corresponds to DATA0..DATA5 in the chain output block
        Chain& route(Pixel pid, uint8_t adc) {
            if ((uint8_t)pid <= PX_DARK && adc <= 5) _pix[pid] = (uint8_t)(adc + 1);
            return *this;
        }
        Chain& disable(Pixel pid) {
            if ((uint8_t)pid <= PX_DARK) _pix[pid] = 0;
            return *this;
        }
        const uint8_t* raw() const { return _pix; }
    private:
        uint8_t _pix[19];
    };

    AS7343();

    // -------- Bring-up --------
    // The TwoWire instance must be initialized (Wire.begin) by the caller.
    bool begin(TwoWire& wire = Wire, uint8_t addr = DEFAULT_ADDR);
    bool reset();              // soft reset via CONTROL.SW_RESET
    bool powerOn();            // ENABLE.PON = 1
    bool powerOff();           // ENABLE = 0x00
    bool getDeviceID(uint8_t& id);

    // -------- Integration time / gain --------
    bool setAtime(uint8_t atime);                       // 0..255
    bool setAstep(uint16_t astep);                      // 1..65534
    // Convenience: picks ATIME/ASTEP to approximate `us`. For full control use setAtime/setAstep.
    bool setIntegrationUs(uint32_t us);
    uint32_t getIntegrationUs() const;                  // computed from cached ATIME/ASTEP
    bool setGain(Gain g);
    bool getAppliedGain(Gain& g);                       // reads ASTATUS
    uint8_t  getAtime() const { return _atime; }
    uint16_t getAstep() const { return _astep; }

    // -------- Wait / cycling --------
    bool setWaitTime(uint8_t wtime);                    // (wtime+1)*2.78 ms
    bool setWaitLong(bool wlong);                       // CFG0.WLONG ×16 multiplier
    bool setWaitEnabled(bool en);                       // ENABLE.WEN

    // -------- Internal LED (LDR pin) --------
    bool setLed(bool on, uint16_t mA = 4);              // mA: 4..258, 2 mA steps
    bool getLed(bool& on, uint16_t& mA);

    // -------- SMUX --------
    // Method A — fast single-chain RAM write. Use this for the 6-channel fast path.
    bool writeSmuxRam(const Chain& chain);
    // Method B — direct write of an individual chain (1..3). Use for 12 or 18 channel modes.
    bool writeSmuxChain(uint8_t chainNum, const Chain& chain);
    // Selects how many chains the engine runs per measurement cycle.
    bool setChains(Chains c);
    // Loads the factory default chain layout (AN001033 §2 / Fig 14).
    bool loadDefaultSmux(Chains c);

    // -------- Measurement --------
    bool startMeasurement();   // ENABLE.SP_EN = 1
    bool stopMeasurement();    // ENABLE.SP_EN = 0
    bool isDataReady();        // STATUS2.AVALID
    bool waitDataReady(uint32_t timeoutMs = 250);

    // Fast 6-ADC read (single 12-byte I2C burst from DATA0_L).
    // out[i] = ADC_i for the *most recent* chain in the cycle.
    bool readChannels6(uint16_t out[6]);
    bool readChannels12(uint16_t out[12]);
    bool readChannels18(uint16_t out[18]);

    // One-shot blocking read: start → wait AVALID → read 6 ADCs → stop.
    // Safe to call back-to-back. Returns false on I2C error or timeout.
    bool measure6(uint16_t out[6], uint32_t timeoutMs = 250);

    // Continuous mode helpers — start once, then loop on readChannels6 + clearDataReady.
    bool clearDataReady();     // writes 1 to STATUS.AINT to allow next AVALID

    // -------- Status / saturation --------
    bool readStatus(Status& s);
    bool clearAllStatus();     // writes 0xFF to STATUS, STATUS2, STATUS3, STATUS4, STATUS5

    // -------- Interrupts (optional) --------
    bool setSpectralThreshold(uint16_t low, uint16_t high, uint8_t whichAdc);
    bool setIrqEnable(bool spectralAlert, bool fifo, bool flickerDone, bool smuxDone);
    bool clearSmuxDone();      // write 1 to STATUS5.SINT_SMUX

    // -------- Low-level escape hatch --------
    bool readReg(uint8_t reg, uint8_t& v);
    bool writeReg(uint8_t reg, uint8_t v);
    bool readRegs(uint8_t reg, uint8_t* buf, size_t len);
    bool writeRegs(uint8_t reg, const uint8_t* buf, size_t len);

private:
    static void _packPixels(const uint8_t pix[19], uint8_t bytes[10]);
    bool _enableBits(uint8_t mask, bool on);
    bool _waitSmuxDone(uint32_t timeoutMs);

    TwoWire* _wire;
    uint8_t  _addr;
    uint8_t  _atime;
    uint16_t _astep;
};
