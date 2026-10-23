// BLEManager — NimBLE service for the ANEBILIN web dashboard.
//
// GATT layout:
//
//   Device name:      "Anebilin"
//   Service UUID:     0000fff0-0000-1000-8000-00805f9b34fb
//
//   FFF1  Status     read + indicate   1 byte   (Idle 0x00 / Normal 0x01 / BP 0x02)
//   FFF2  Control    write             1 byte   (Stop 0x00 / Start 0x01 / Start BP 0x02)
//   FFF3  LiveData   notify            32 bytes (8 × float32 little-endian)
//
//   FFF4  ECG Ctrl   write             1 + 2 bytes (cmd, uint16 LE arg)
//   FFF5  ECG Data   notify            4 + n×int16 LE (seq, n_samples, samples)
//   FFF6  ECG Status read + indicate   16 bytes (state, flags, fs, count, dur, chunk)
//
// Lifecycle:
//   begin()          — NimBLEDevice init, advertise the service, pin host to core 0
//   setMode(m)       — updates FFF1, pushes Indicate
//   publishLive(v8)  — packs 8 floats into FFF3 and pushes Notify (caller dictates payload)
//   pollControl(cb)  — drains the queue of received control bytes onto the callback
//                      (call this from the sensor/loop core so dispatch doesn't run
//                      from the BLE-stack callback context)
//   pollEcgControl(cb) — same pattern for FFF4 ECG control messages
//   setEcgStatus(...)  — updates FFF6 + indicates
//   publishEcgChunk(...)— packs seq + int16 samples into FFF5 + notifies

#pragma once

#include <stdint.h>
#include <functional>

#include <NimBLEDevice.h>

class BLEManager {
public:
    enum class Mode : uint8_t {
        Idle   = 0x00,
        Normal = 0x01,
        BP     = 0x02,
    };

    // FFF4 payload, decoded by the BLE-stack callback and queued for the loop.
    struct EcgControlMsg {
        uint8_t  cmd;
        uint16_t arg;
    };

    void begin(const char* deviceName = "Anebilin");

    // Push a fresh 8-float biomarker snapshot. Caller fills per §2.3 of the
    // brief — meaning depends on current mode.
    void publishLive(const float values[8]);

    // Force a state update + indicate. Idempotent.
    void setMode(Mode m);
    Mode mode() const;

    bool isConnected() const { return _connected; }

    // Advertising state / control (used by the serial `ble` command).
    bool isAdvertising() const;
    void restartAdvertising();
    void stopAdvertising();

    // Drain pending control bytes (received in NimBLE thread → queue here).
    // Pass a callback that handles each byte. Safe to call from the main loop.
    void pollControl(const std::function<void(uint8_t)>& cb);

    // Drain pending FFF4 ECG control messages. Same cross-core pattern.
    void pollEcgControl(const std::function<void(const EcgControlMsg&)>& cb);

    // FFF6 status: state (EcgState), fs Hz, sample count, captured duration,
    // and the firmware's fixed chunk size (samples per FFF5 packet).
    void setEcgStatus(uint8_t state, uint32_t fs, uint32_t count,
                      uint32_t durationMs);

    // FFF5 notify: header (seq, n_samples) + n int16 LE samples. Clamped to
    // the negotiated MTU; the client must read chunk size from FFF6.
    void publishEcgChunk(uint16_t seq, const int16_t* samples, uint16_t n);

    // Effective samples-per-chunk given the negotiated MTU. The FFF6 status and
    // the client's chunk indexing must both use this value.
    uint16_t ecgChunkSamples() const;

private:
    NimBLECharacteristic* _statusChar  = nullptr;
    NimBLECharacteristic* _controlChar = nullptr;
    NimBLECharacteristic* _liveChar    = nullptr;
    NimBLECharacteristic* _ecgCtrlChar = nullptr;
    NimBLECharacteristic* _ecgDataChar = nullptr;
    NimBLECharacteristic* _ecgStatChar = nullptr;
    NimBLEServer*         _server      = nullptr;

    volatile Mode _mode      = Mode::Idle;
    volatile bool _connected = false;

    // Tiny lock-free SPSC queue for control bytes. NimBLE callbacks fire on
    // the host task (core 0); pollControl runs from loop() (core 1).
    static constexpr int CTRL_Q_SIZE = 16;
    volatile uint8_t      _ctrlQueue[CTRL_Q_SIZE] = {};
    volatile uint8_t      _ctrlHead = 0;     // producer (BLE callback)
    volatile uint8_t      _ctrlTail = 0;     // consumer (main loop)

    // Separate SPSC queue for decoded FFF4 ECG control messages. Stored as two
    // scalar arrays rather than a struct array so volatile access stays valid.
    static constexpr int ECG_Q_SIZE = 16;
    volatile uint8_t  _ecgCmdQueue[ECG_Q_SIZE] = {};
    volatile uint16_t _ecgArgQueue[ECG_Q_SIZE] = {};
    volatile uint8_t  _ecgHead = 0;
    volatile uint8_t  _ecgTail = 0;

    void pushControl(uint8_t b);
    void pushEcgControl(uint8_t cmd, uint16_t arg);

    // Callback wrappers — defined in the .cpp
    class ServerCallbacks;
    class ControlCallbacks;
    class EcgControlCallbacks;
    friend class ControlCallbacks;
    friend class EcgControlCallbacks;
};
