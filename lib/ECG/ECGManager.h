// ECGManager — AD8232 single-lead ECG capture into PSRAM/SRAM.
//
// Hardware:
//   AD8232 OUTPUT -> an ADC-capable GPIO (ESP32-S3 ADC1: GPIO1..GPIO10).
//                    NOTE: the DevKit "TX"/"RX" pins (GPIO43/44) are NOT ADC
//                    capable — the analog OUTPUT must be rewired to ADC1.
//   AD8232 SDN    -> any GPIO output. Active-low shutdown: HIGH = run, LOW = off.
//
// Capture:
//   A FreeRTOS task pinned to the sensor core samples analogRead() at fs and
//   stores 12-bit values as int16 into a preallocated buffer. The buffer is
//   sized for MAX_SECONDS; PSRAM is preferred, internal SRAM is the fallback.
//   After a scan the buffer is fetched in fixed-size chunks over BLE.
//
// This is a first-pass sampler: analogRead() at 1 kHz is adequate for a
// screening waveform, but if sample jitter matters later, swap the loop for
// the adc_continuous DMA driver (see AUDIT-style notes in ECG_BRIEF.md).

#pragma once

#include <Arduino.h>
#include <Preferences.h>

enum class EcgState : uint8_t {
    Idle         = 0x00,
    Recording    = 0x01,
    Ready        = 0x02,
    Transferring = 0x03,
    Error        = 0x04,
};

class ECGManager {
public:
    static constexpr uint32_t MAGIC              = 0xEC600001;
    static constexpr uint32_t DEFAULT_FS         = 1000;
    static constexpr uint32_t DEFAULT_DURATION_MS = 30000;
    static constexpr uint32_t MAX_SECONDS        = 60;
    static constexpr int      CHUNK_SAMPLES      = 120;

    // adcPin must be ADC-capable; sdnPin is any output.
    bool begin(int adcPin, int sdnPin, uint32_t fs = DEFAULT_FS);
    void end();

    void setPins(int adcPin, int sdnPin);
    int  adcPin() const { return _adcPin; }
    int  sdnPin() const { return _sdnPin; }

    // Reallocates the buffer — only valid while Idle.
    bool setSampleRate(uint32_t fs);
    uint32_t sampleRate() const { return _fs; }

    void setDurationMs(uint32_t ms) { _durationMs = ms; }
    uint32_t durationSettingMs() const { return _durationMs; }

    bool start(uint32_t durationMs = 0);   // 0 = use stored setting
    void stop();

    EcgState state() const { return _state; }
    const char* stateName() const;
    uint32_t sampleCount() const { return _count; }
    uint32_t capacity() const { return _cap; }
    uint32_t capturedDurationMs() const {
        return _fs ? (_count * 1000u / _fs) : 0;
    }
    bool usingPsram() const { return _psram; }

    // Copy up to maxSamples int16 samples starting at startIndex.
    uint32_t getChunk(uint32_t startIndex, int16_t* out, uint32_t maxSamples) const;
    const int16_t* buffer() const { return _buf; }

    void clear();

    void loadSettings();
    void saveSettings();
    void printInfo() const;
    void dumpCsv() const;

    // Live serial plot. When on, the sampler emits `time(ms),adc` rows at a
    // decimated rate (~200 Hz) in the same CSV style as the raw `r` stream.
    void setSerialStream(bool on);
    bool serialStream() const { return _serialStream; }
    void printStreamHeader() const;

private:
    static void taskEntry(void* arg);
    void sampleLoop();
    bool allocate(uint32_t fs);
    void release();

    int16_t* _buf        = nullptr;
    uint32_t _cap        = 0;
    uint32_t _count      = 0;
    uint32_t _fs         = DEFAULT_FS;
    uint32_t _durationMs = DEFAULT_DURATION_MS;
    int      _adcPin     = 8;      // AD8232 OUTPUT (ADC1)
    int      _sdnPin     = 17;     // AD8232 SDN (plain output)
    bool     _psram      = false;
    volatile EcgState _state = EcgState::Idle;
    volatile bool _serialStream = false;
    uint32_t _streamDiv  = 1;
    TaskHandle_t _task   = nullptr;
};
