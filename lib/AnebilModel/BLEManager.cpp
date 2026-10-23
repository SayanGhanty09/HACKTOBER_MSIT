#include "BLEManager.h"

#include <Arduino.h>
#include <string.h>

namespace {
constexpr const char* SERVICE_UUID  = "0000fff0-0000-1000-8000-00805f9b34fb";
constexpr const char* STATUS_UUID   = "0000fff1-0000-1000-8000-00805f9b34fb";
constexpr const char* CONTROL_UUID  = "0000fff2-0000-1000-8000-00805f9b34fb";
constexpr const char* LIVE_UUID     = "0000fff3-0000-1000-8000-00805f9b34fb";
constexpr const char* ECG_CTRL_UUID = "0000fff4-0000-1000-8000-00805f9b34fb";
constexpr const char* ECG_DATA_UUID = "0000fff5-0000-1000-8000-00805f9b34fb";
constexpr const char* ECG_STAT_UUID = "0000fff6-0000-1000-8000-00805f9b34fb";
// Advertise indefinitely (0 = BLE_HS_FOREVER). A fixed window made the device
// vanish from scans ~60 s after boot.
constexpr uint32_t    ADV_DURATION_MS = 0;
// Samples per FFF5 packet. Must match ECGManager::CHUNK_SAMPLES.
constexpr uint16_t    ECG_CHUNK_SAMPLES = 120;
}

// ---------------------------------------------------------------------------
// Callback adapters
// ---------------------------------------------------------------------------

// NimBLE-Arduino v2.x callback API: connect/disconnect/write now carry a
// NimBLEConnInfo reference, and getValue() returns NimBLEAttValue (which is
// vector<uint8_t>-like — operator[] and length() both work).

class BLEManager::ServerCallbacks : public NimBLEServerCallbacks {
public:
    explicit ServerCallbacks(BLEManager* mgr) : _mgr(mgr) {}

    void onConnect(NimBLEServer* /*server*/, NimBLEConnInfo& /*info*/) override {
        _mgr->_connected = true;
        Serial.println(F("# BLE: client connected"));
    }
    void onDisconnect(NimBLEServer* /*server*/, NimBLEConnInfo& /*info*/, int reason) override {
        _mgr->_connected = false;
        Serial.printf("# BLE: client disconnected (reason=0x%02X) — re-advertising\n", reason);
        NimBLEDevice::startAdvertising(ADV_DURATION_MS);
    }

private:
    BLEManager* _mgr;
};

class BLEManager::ControlCallbacks : public NimBLECharacteristicCallbacks {
public:
    explicit ControlCallbacks(BLEManager* mgr) : _mgr(mgr) {}

    void onWrite(NimBLECharacteristic* chr, NimBLEConnInfo& /*info*/) override {
        NimBLEAttValue v = chr->getValue();
        if (v.length() == 0) return;
        _mgr->pushControl(v[0]);
    }

private:
    BLEManager* _mgr;
};

class BLEManager::EcgControlCallbacks : public NimBLECharacteristicCallbacks {
public:
    explicit EcgControlCallbacks(BLEManager* mgr) : _mgr(mgr) {}

    void onWrite(NimBLECharacteristic* chr, NimBLEConnInfo& /*info*/) override {
        NimBLEAttValue v = chr->getValue();
        if (v.length() == 0) return;
        uint16_t arg = 0;
        if (v.length() >= 3) arg = (uint16_t)v[1] | ((uint16_t)v[2] << 8);
        _mgr->pushEcgControl(v[0], arg);
    }

private:
    BLEManager* _mgr;
};

// ---------------------------------------------------------------------------
// BLEManager public API
// ---------------------------------------------------------------------------

void BLEManager::begin(const char* deviceName) {
    Serial.println(F("# BLE: init starting"));
    NimBLEDevice::init(deviceName);
    // Prefer a 247-byte MTU so ECG chunks carry 120 samples in one packet.
    NimBLEDevice::setMTU(247);
    // Lower TX power than default — reduces radio current spike at startup.
    // NimBLE-Arduino v2.x takes dBm directly (int8_t), not the IDF enum.
    NimBLEDevice::setPower(-3);

    _server = NimBLEDevice::createServer();
    if (!_server) {
        Serial.println(F("# BLE: createServer FAILED — BLE disabled, firmware continues"));
        return;
    }
    _server->setCallbacks(new ServerCallbacks(this));

    NimBLEService* svc = _server->createService(SERVICE_UUID);
    if (!svc) {
        Serial.println(F("# BLE: createService FAILED — BLE disabled"));
        return;
    }

    _statusChar = svc->createCharacteristic(
        STATUS_UUID,
        NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::INDICATE);
    if (!_statusChar) { Serial.println(F("# BLE: statusChar FAILED")); return; }
    uint8_t initStatus = (uint8_t)_mode;
    _statusChar->setValue(&initStatus, 1);

    _controlChar = svc->createCharacteristic(
        CONTROL_UUID,
        NIMBLE_PROPERTY::WRITE);
    if (!_controlChar) { Serial.println(F("# BLE: controlChar FAILED")); return; }
    _controlChar->setCallbacks(new ControlCallbacks(this));

    _liveChar = svc->createCharacteristic(
        LIVE_UUID,
        NIMBLE_PROPERTY::NOTIFY);
    if (!_liveChar) { Serial.println(F("# BLE: liveChar FAILED")); return; }
    uint8_t zeroPayload[32] = {};
    _liveChar->setValue(zeroPayload, 32);

    _ecgCtrlChar = svc->createCharacteristic(
        ECG_CTRL_UUID,
        NIMBLE_PROPERTY::WRITE);
    if (!_ecgCtrlChar) { Serial.println(F("# BLE: ecgCtrlChar FAILED")); return; }
    _ecgCtrlChar->setCallbacks(new EcgControlCallbacks(this));

    _ecgDataChar = svc->createCharacteristic(
        ECG_DATA_UUID,
        NIMBLE_PROPERTY::NOTIFY);
    if (!_ecgDataChar) { Serial.println(F("# BLE: ecgDataChar FAILED")); return; }
    uint8_t zeroEcg[4] = {};
    _ecgDataChar->setValue(zeroEcg, 4);

    _ecgStatChar = svc->createCharacteristic(
        ECG_STAT_UUID,
        NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::INDICATE);
    if (!_ecgStatChar) { Serial.println(F("# BLE: ecgStatChar FAILED")); return; }
    uint8_t initEcgStat[16] = {};
    _ecgStatChar->setValue(initEcgStat, 16);

    NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
    adv->setName(deviceName);
    adv->addServiceUUID(SERVICE_UUID);
    // NOTE: do NOT enableScanResponse — NimBLE then moves the device name
    // into the scan-response packet only, so passive scanners never see
    // "Anebilin" and name-filtered clients (Web Bluetooth) can't find us.
    // v2.x advertising defaults are sensible; skip the deprecated
    // setMin/MaxPreferred — connection interval is auto-negotiated.
    if (!NimBLEDevice::startAdvertising(ADV_DURATION_MS)) {
        Serial.println(F("# BLE: startAdvertising FAILED"));
        return;
    }

    Serial.printf("# BLE ready — advertising as \"%s\"\n", deviceName);
}

void BLEManager::publishLive(const float values[8]) {
    if (!_liveChar)      return;
    if (!_connected)     return;     // don't waste airtime if no listener
    if (_mode == Mode::Idle) return; // brief says: no packets while idle

    // ESP32 is little-endian; memcpy of float[8] yields the exact wire format
    // the website parses with DataView.getFloat32(offset, /*LE=*/true).
    uint8_t buf[32];
    memcpy(buf, values, sizeof(buf));
    _liveChar->setValue(buf, 32);
    _liveChar->notify();
}

void BLEManager::setMode(Mode m) {
    if (m == _mode) return;
    _mode = m;
    if (_statusChar) {
        uint8_t b = (uint8_t)m;
        _statusChar->setValue(&b, 1);
        _statusChar->indicate();
    }
    Serial.printf("# BLE: mode → 0x%02X\n", (uint8_t)m);
}

BLEManager::Mode BLEManager::mode() const { return _mode; }

bool BLEManager::isAdvertising() const {
    NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
    return adv && adv->isAdvertising();
}

void BLEManager::restartAdvertising() {
    NimBLEDevice::startAdvertising(ADV_DURATION_MS);
}

void BLEManager::stopAdvertising() {
    NimBLEDevice::stopAdvertising();
}

void BLEManager::pushControl(uint8_t b) {
    // SPSC ring — producer = BLE host task, consumer = main loop.
    uint8_t next = (_ctrlHead + 1) % CTRL_Q_SIZE;
    if (next == _ctrlTail) return;   // queue full — drop oldest-policy is "drop new"
    _ctrlQueue[_ctrlHead] = b;
    _ctrlHead = next;
}

void BLEManager::pollControl(const std::function<void(uint8_t)>& cb) {
    while (_ctrlTail != _ctrlHead) {
        const uint8_t b = _ctrlQueue[_ctrlTail];
        _ctrlTail = (_ctrlTail + 1) % CTRL_Q_SIZE;
        if (cb) cb(b);
    }
}

void BLEManager::pushEcgControl(uint8_t cmd, uint16_t arg) {
    uint8_t next = (_ecgHead + 1) % ECG_Q_SIZE;
    if (next == _ecgTail) return;   // queue full — drop new
    _ecgCmdQueue[_ecgHead] = cmd;
    _ecgArgQueue[_ecgHead] = arg;
    _ecgHead = next;
}

void BLEManager::pollEcgControl(const std::function<void(const EcgControlMsg&)>& cb) {
    while (_ecgTail != _ecgHead) {
        EcgControlMsg m;
        m.cmd = _ecgCmdQueue[_ecgTail];
        m.arg = _ecgArgQueue[_ecgTail];
        _ecgTail = (_ecgTail + 1) % ECG_Q_SIZE;
        if (cb) cb(m);
    }
}

void BLEManager::setEcgStatus(uint8_t state, uint32_t fs, uint32_t count,
                              uint32_t durationMs) {
    if (!_ecgStatChar) return;
    uint8_t b[16] = {};
    b[0] = state;
    b[1] = 0;                       // flags (lead-off, etc.) — reserved
    memcpy(&b[2],  &fs,         4);
    memcpy(&b[6],  &count,      4);
    memcpy(&b[10], &durationMs, 4);
    uint16_t chunk = ecgChunkSamples();
    memcpy(&b[14], &chunk,      2);
    _ecgStatChar->setValue(b, 16);
    if (_connected) _ecgStatChar->indicate();
}

uint16_t BLEManager::ecgChunkSamples() const {
    uint16_t maxSamples = ECG_CHUNK_SAMPLES;
    uint16_t mtu = NimBLEDevice::getMTU();
    if (mtu > 7) {
        uint16_t m = (mtu - 7) / 2;      // ATT header + our 4-byte header
        if (m < maxSamples) maxSamples = m;
    }
    return maxSamples;
}

void BLEManager::publishEcgChunk(uint16_t seq, const int16_t* samples, uint16_t n) {
    if (!_ecgDataChar || !_connected) return;

    uint16_t maxSamples = ecgChunkSamples();
    if (n > maxSamples) n = maxSamples;

    uint8_t buf[4 + 240];
    buf[0] = (uint8_t)(seq & 0xFF);
    buf[1] = (uint8_t)(seq >> 8);
    buf[2] = (uint8_t)(n & 0xFF);
    buf[3] = (uint8_t)(n >> 8);
    memcpy(buf + 4, samples, (size_t)n * sizeof(int16_t));
    _ecgDataChar->setValue(buf, 4 + n * 2);
    _ecgDataChar->notify();
}
