#include "ECGManager.h"

#include <esp_heap_caps.h>
#include <string.h>

namespace {
constexpr const char* NVS_NS = "ecgset";
}

bool ECGManager::allocate(uint32_t fs) {
    release();
    _cap = fs * MAX_SECONDS;

    size_t bytes = (size_t)_cap * sizeof(int16_t);
    _buf = (int16_t*)heap_caps_malloc(bytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    _psram = (_buf != nullptr);

    // Internal SRAM fallback — keep the window shorter so we don't starve NimBLE.
    if (!_buf) {
        _cap = fs * 30;
        bytes = (size_t)_cap * sizeof(int16_t);
        _buf = (int16_t*)heap_caps_malloc(bytes, MALLOC_CAP_8BIT);
    }
    if (!_buf) {
        _cap = fs * 10;
        bytes = (size_t)_cap * sizeof(int16_t);
        _buf = (int16_t*)heap_caps_malloc(bytes, MALLOC_CAP_8BIT);
    }
    if (!_buf) {
        _cap = 0;
        _state = EcgState::Error;
        return false;
    }
    _count = 0;
    return true;
}

void ECGManager::release() {
    if (_buf) {
        free(_buf);
        _buf = nullptr;
    }
    _cap = 0;
    _count = 0;
}

bool ECGManager::begin(int adcPin, int sdnPin, uint32_t fs) {
    _adcPin = adcPin;
    _sdnPin = sdnPin;
    _fs     = fs ? fs : DEFAULT_FS;

    pinMode(_sdnPin, OUTPUT);
    digitalWrite(_sdnPin, LOW);        // keep AD8232 shut down until a scan

    if (_adcPin < 1 || _adcPin > 20) {
        Serial.printf("# ECG WARN: GPIO%d is NOT ADC-capable — rewire OUTPUT to "
                      "an ADC pin (GPIO1..20; ADC1 1..10 preferred)\n", _adcPin);
    }

    if (!allocate(_fs)) {
        Serial.println(F("# ECG: buffer allocation FAILED"));
        return false;
    }

    loadSettings();

    BaseType_t ok = xTaskCreatePinnedToCore(
        taskEntry, "ecg", 4096, this, 2, &_task, 1);
    if (ok != pdPASS) {
        Serial.println(F("# ECG: sampler task FAILED"));
        _state = EcgState::Error;
        return false;
    }

    Serial.printf("# ECG ready — ADC=GPIO%d SDN=GPIO%d fs=%lu Hz cap=%lu samples (%s)\n",
                  _adcPin, _sdnPin, (unsigned long)_fs, (unsigned long)_cap,
                  _psram ? "PSRAM" : "SRAM");
    return true;
}

void ECGManager::end() {
    stop();
    if (_task) {
        vTaskDelete(_task);
        _task = nullptr;
    }
    digitalWrite(_sdnPin, LOW);
    release();
}

void ECGManager::setPins(int adcPin, int sdnPin) {
    _adcPin = adcPin;
    _sdnPin = sdnPin;
    pinMode(_sdnPin, OUTPUT);
    digitalWrite(_sdnPin, LOW);
    saveSettings();
}

bool ECGManager::setSampleRate(uint32_t fs) {
    if (_state == EcgState::Recording) return false;
    if (!fs) return false;
    if (fs < 100)  fs = 100;
    if (fs > 1000) fs = 1000;      // vTaskDelayUntil quantises to 1 ms ticks
    _fs = fs;
    if (!allocate(_fs)) {
        _fs = DEFAULT_FS;
        allocate(_fs);
        return false;
    }
    saveSettings();
    return true;
}

bool ECGManager::start(uint32_t durationMs) {
    if (_state == EcgState::Recording) return false;
    if (!_buf) return false;
    _durationMs = durationMs ? durationMs : _durationMs;
    _count = 0;
    _state = EcgState::Recording;      // sampler task observes and starts
    return true;
}

void ECGManager::stop() {
    if (_state == EcgState::Recording) {
        _state = (_count > 0) ? EcgState::Ready : EcgState::Idle;
    }
}

const char* ECGManager::stateName() const {
    switch (_state) {
        case EcgState::Idle:         return "idle";
        case EcgState::Recording:    return "recording";
        case EcgState::Ready:        return "ready";
        case EcgState::Transferring: return "transferring";
        default:                     return "error";
    }
}

uint32_t ECGManager::getChunk(uint32_t startIndex, int16_t* out, uint32_t maxSamples) const {
    if (!_buf || !out || startIndex >= _count) return 0;
    uint32_t n = _count - startIndex;
    if (n > maxSamples) n = maxSamples;
    memcpy(out, _buf + startIndex, n * sizeof(int16_t));
    return n;
}

void ECGManager::clear() {
    if (_state == EcgState::Recording) return;
    _count = 0;
    _state = EcgState::Idle;
}

void ECGManager::sampleLoop() {
    digitalWrite(_sdnPin, HIGH);
    vTaskDelay(pdMS_TO_TICKS(3));      // AD8232 settle after wake

    uint32_t want = (_durationMs * _fs) / 1000u;
    uint32_t target = (want == 0 || want > _cap) ? _cap : want;

    TickType_t period = pdMS_TO_TICKS(1000u / _fs);
    if (period == 0) period = 1;

    TickType_t last = xTaskGetTickCount();
    while (_state == EcgState::Recording && _count < target) {
        int16_t v = (int16_t)analogRead(_adcPin);
        _buf[_count++] = v;
        if (_serialStream && (_streamDiv <= 1 || ((_count - 1) % _streamDiv) == 0)) {
            uint32_t tms = (uint32_t)(((uint64_t)(_count - 1) * 1000u) / _fs);
            Serial.printf("%lu,%d\n", (unsigned long)tms, (int)v);
        }
        vTaskDelayUntil(&last, period);
    }

    digitalWrite(_sdnPin, LOW);
    if (_state == EcgState::Recording) _state = EcgState::Ready;
    if (_serialStream) Serial.println(F("# ecg end"));
}

void ECGManager::taskEntry(void* arg) {
    ECGManager* self = static_cast<ECGManager*>(arg);
    for (;;) {
        if (self->_state == EcgState::Recording) self->sampleLoop();
        else                                     vTaskDelay(pdMS_TO_TICKS(10));
    }
}

void ECGManager::loadSettings() {
    Preferences p;
    if (!p.begin(NVS_NS, true)) return;
    if (p.getUInt("MAGIC", 0) != MAGIC) { p.end(); return; }

    uint32_t fs  = p.getUInt("fs",  _fs);
    _durationMs  = p.getUInt("dur", _durationMs);
    int adc      = p.getInt ("adc", _adcPin);
    int sdn      = p.getInt ("sdn", _sdnPin);
    p.end();

    if (adc != _adcPin || sdn != _sdnPin) setPins(adc, sdn);
    if (fs != _fs) setSampleRate(fs);
}

void ECGManager::saveSettings() {
    Preferences p;
    if (!p.begin(NVS_NS, false)) return;
    p.putUInt("MAGIC", MAGIC);
    p.putUInt("fs",    _fs);
    p.putUInt("dur",   _durationMs);
    p.putInt ("adc",   _adcPin);
    p.putInt ("sdn",   _sdnPin);
    p.end();
}

void ECGManager::printInfo() const {
    Serial.printf("# ECG: state=%s fs=%lu Hz count=%lu cap=%lu dur=%lums buf=%s\n",
                  stateName(), (unsigned long)_fs, (unsigned long)_count,
                  (unsigned long)_cap, (unsigned long)capturedDurationMs(),
                  _psram ? "PSRAM" : "SRAM");
    Serial.printf("# ECG: ADC=GPIO%d SDN=GPIO%d chunk=%d samples\n",
                  _adcPin, _sdnPin, CHUNK_SAMPLES);
}

void ECGManager::setSerialStream(bool on) {
    _serialStream = on;
    _streamDiv = _fs / 200u;      // cap the live stream at ~200 Hz
    if (_streamDiv == 0) _streamDiv = 1;
}

void ECGManager::printStreamHeader() const {
    Serial.println(F("# time(ms), ECG_ADC"));
}

void ECGManager::dumpCsv() const {
    printStreamHeader();
    for (uint32_t i = 0; i < _count; i++) {
        uint32_t tms = (uint32_t)(((uint64_t)i * 1000u) / _fs);
        Serial.printf("%lu,%d\n", (unsigned long)tms, (int)_buf[i]);
    }
    Serial.println(F("# ecg end"));
}
