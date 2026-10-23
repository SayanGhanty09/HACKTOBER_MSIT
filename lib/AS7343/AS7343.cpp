// AS7343.cpp — see AS7343.h

#include "AS7343.h"

namespace {
// AS7343 register addresses (all live in the 0x80..0xFF I2C plane, plus the
// SMUX RAM at 0x00..0x09 and chain regs at 0xE4/0xE7). No bank switching needed.
constexpr uint8_t REG_ID         = 0x5A;
constexpr uint8_t REG_CFG12      = 0x66;
constexpr uint8_t REG_ENABLE     = 0x80;
constexpr uint8_t REG_ATIME      = 0x81;
constexpr uint8_t REG_WTIME      = 0x83;
constexpr uint8_t REG_SP_TH_L    = 0x84;   // 16-bit
constexpr uint8_t REG_SP_TH_H    = 0x86;   // 16-bit
constexpr uint8_t REG_STATUS2    = 0x90;
constexpr uint8_t REG_STATUS3    = 0x91;
constexpr uint8_t REG_STATUS     = 0x93;
constexpr uint8_t REG_ASTATUS    = 0x94;
constexpr uint8_t REG_DATA0_L    = 0x95;
constexpr uint8_t REG_STATUS5    = 0xBB;
constexpr uint8_t REG_STATUS4    = 0xBC;
constexpr uint8_t REG_CFG0       = 0xBF;
constexpr uint8_t REG_CFG1       = 0xC6;
constexpr uint8_t REG_CFG6       = 0xF5;
constexpr uint8_t REG_CFG9       = 0xCA;
constexpr uint8_t REG_LED        = 0xCD;
constexpr uint8_t REG_ASTEP_L    = 0xD4;
constexpr uint8_t REG_CFG20      = 0xD6;
constexpr uint8_t REG_CHAINCMD   = 0xE4;
constexpr uint8_t REG_CHAIN_SMUX = 0xE7;
constexpr uint8_t REG_INTENAB    = 0xF9;
constexpr uint8_t REG_CONTROL    = 0xFA;

// ENABLE bits
constexpr uint8_t EN_PON    = 1 << 0;
constexpr uint8_t EN_SP_EN  = 1 << 1;
constexpr uint8_t EN_WEN    = 1 << 3;
constexpr uint8_t EN_SMUXEN = 1 << 4;

// CFG6 SMUX_CMD field (bits[4:3]): 00 = ROM init, 01 = read RAM, 10 = write RAM
constexpr uint8_t CFG6_SMUX_WRITE_RAM = 0x10;

constexpr uint32_t STEP_FEMTO = 2777777ULL;   // 2.7777… µs in femto-ms (×1e6) for fixed-point
}

AS7343::AS7343()
    : _wire(nullptr), _addr(DEFAULT_ADDR), _atime(29), _astep(599) {}

// -------- Bring-up --------

bool AS7343::begin(TwoWire& wire, uint8_t addr) {
    _wire = &wire;
    _addr = addr;

    delay(200);                      // power-on settle

    // SW_RESET — ignore result; device may not yet respond
    writeReg(REG_CONTROL, 1 << 3);
    delay(5);

    // ID register 0x5A is in the bank-1 area (CFG0.REG_BANK must be 1 for 0x00..0x7F).
    // Switch bank, read ID, then switch back.
    if (!writeReg(REG_CFG0, 1 << 4)) return false;   // REG_BANK = 1
    uint8_t id = 0;
    bool idOk = getDeviceID(id);
    writeReg(REG_CFG0, 0x00);                         // REG_BANK = 0, WLONG off
    if (!idOk || id != DEVICE_ID) return false;

    if (!powerOn()) return false;
    if (!writeReg(REG_INTENAB, 0x00)) return false;   // mask IRQs by default
    return true;
}

bool AS7343::reset() {
    if (!_wire) return false;
    // CONTROL.SW_RESET = bit 3 — self-clearing.
    return writeReg(REG_CONTROL, 1 << 3);
}

bool AS7343::powerOn()  { return _enableBits(EN_PON, true); }
bool AS7343::powerOff() { return writeReg(REG_ENABLE, 0x00); }

bool AS7343::getDeviceID(uint8_t& id) {
    return readReg(REG_ID, id);
}

// -------- Integration / gain --------

bool AS7343::setAtime(uint8_t atime) {
    // ATIME/ASTEP may only be changed while the spectral engine is idle
    // (SP_EN=0). Force idle here so callers don't have to.
    _enableBits(EN_SP_EN, false);
    if (!writeReg(REG_ATIME, atime)) return false;
    _atime = atime;
    return true;
}

bool AS7343::setAstep(uint16_t astep) {
    _enableBits(EN_SP_EN, false);
    uint8_t buf[2] = { (uint8_t)(astep & 0xFF), (uint8_t)(astep >> 8) };
    if (!writeRegs(REG_ASTEP_L, buf, 2)) return false;
    _astep = astep;
    return true;
}

bool AS7343::setIntegrationUs(uint32_t us) {
    // t = (ATIME+1) * (ASTEP+1) * 2.778 µs.
    //
    // Strategy: keep ASTEP near the AMS reference value of 600 (≈1.67 ms per
    // cycle) and scale the cycle count via ATIME. AS7343 silicon is finicky
    // with ATIME=0 (single-cycle integration) — AVALID can fail to latch,
    // producing all-zero reads — so we always keep ATIME ≥ 1 when possible.
    //
    // After picking (ATIME, ASTEP) we snap ASTEP to a clean quantum (1, 5, or
    // 10 depending on magnitude) so any `i<us>` lands on a well-formed pair.
    uint64_t ticks = ((uint64_t)us * 1000000ULL + (STEP_FEMTO / 2)) / STEP_FEMTO;
    if (ticks < 4) ticks = 4;

    constexpr uint32_t TARGET_STEPS = 600;

    uint32_t atime_count;   // 1..256    (= ATIME register + 1)
    uint32_t astep_count;   // 2..65535  (= ASTEP register + 1)

    if (ticks <= TARGET_STEPS * 2) {
        // Very short — use 2 cycles to keep ATIME ≥ 1
        atime_count = 2;
        astep_count = (uint32_t)((ticks + 1) / 2);
    } else if (ticks <= TARGET_STEPS * 256ULL) {
        // Comfortable range — keep ASTEP near 600 and pick ATIME
        atime_count = (uint32_t)((ticks + (TARGET_STEPS / 2)) / TARGET_STEPS);
        if (atime_count > 256) atime_count = 256;
        astep_count = (uint32_t)((ticks + atime_count / 2) / atime_count);
    } else {
        // Very long — saturate ATIME and let ASTEP soak the rest
        atime_count = 256;
        astep_count = (uint32_t)((ticks + 128) / 256);
        if (astep_count > 65535) astep_count = 65535;
    }

    // Snap ASTEP to a clean quantum so reported integration lands on round values
    uint32_t snap = 10;
    if      (astep_count < 50)   snap = 1;
    else if (astep_count < 200)  snap = 5;
    else if (astep_count < 5000) snap = 10;
    else                          snap = 50;
    astep_count = ((astep_count + snap / 2) / snap) * snap;

    if (astep_count < 2)   astep_count = 2;
    if (astep_count > 65535) astep_count = 65535;
    if (atime_count < 1)   atime_count = 1;
    if (atime_count > 256) atime_count = 256;

    return setAtime((uint8_t)(atime_count - 1)) &&
           setAstep((uint16_t)(astep_count - 1));
}

uint32_t AS7343::getIntegrationUs() const {
    uint64_t n = (uint64_t)(_atime + 1) * (uint64_t)(_astep + 1);
    return (uint32_t)((n * STEP_FEMTO) / 1000000ULL);
}

bool AS7343::setGain(Gain g) {
    uint8_t cfg1;
    if (!readReg(REG_CFG1, cfg1)) return false;
    cfg1 = (cfg1 & ~0x1F) | ((uint8_t)g & 0x1F);
    return writeReg(REG_CFG1, cfg1);
}

bool AS7343::getAppliedGain(Gain& g) {
    uint8_t s;
    if (!readReg(REG_ASTATUS, s)) return false;
    g = (Gain)(s & 0x0F);
    return true;
}

// -------- Wait --------

bool AS7343::setWaitTime(uint8_t wtime) {
    return writeReg(REG_WTIME, wtime);
}

bool AS7343::setWaitLong(bool wlong) {
    uint8_t cfg0;
    if (!readReg(REG_CFG0, cfg0)) return false;
    if (wlong) cfg0 |= (1 << 2); else cfg0 &= ~(1 << 2);
    return writeReg(REG_CFG0, cfg0);
}

bool AS7343::setWaitEnabled(bool en) {
    return _enableBits(EN_WEN, en);
}

// -------- LED --------

bool AS7343::setLed(bool on, uint16_t mA) {
    if (mA < 4)   mA = 4;
    if (mA > 258) mA = 258;
    uint8_t code = (uint8_t)((mA - 4) / 2);          // 0..127
    uint8_t v = (code & 0x7F) | (on ? 0x80 : 0x00);
    return writeReg(REG_LED, v);
}

bool AS7343::getLed(bool& on, uint16_t& mA) {
    uint8_t v;
    if (!readReg(REG_LED, v)) return false;
    on = (v & 0x80) != 0;
    mA = (uint16_t)((v & 0x7F) * 2 + 4);
    return true;
}

// -------- SMUX --------

void AS7343::_packPixels(const uint8_t pix[19], uint8_t bytes[10]) {
    // bytes[k] for k=0..8: bits[6:4] = pix[2k+1], bits[2:0] = pix[2k]
    // bytes[9]:            bits[2:0] = pix[18]  (bits[6:4] = unused pixel 19 = 0)
    for (uint8_t k = 0; k < 9; k++) {
        bytes[k] = (uint8_t)(((pix[2 * k + 1] & 0x07) << 4) | (pix[2 * k] & 0x07));
    }
    bytes[9] = (uint8_t)(pix[18] & 0x07);
}

bool AS7343::writeSmuxRam(const Chain& chain) {
    uint8_t bytes[10];
    _packPixels(chain.raw(), bytes);

    // 1. PON only — SP_EN must be 0 to reconfigure SMUX.
    if (!writeReg(REG_ENABLE, EN_PON)) return false;
    // 2. CFG6.SMUX_CMD = 10 (write RAM → chain 1)
    if (!writeReg(REG_CFG6, CFG6_SMUX_WRITE_RAM)) return false;
    // 3. Burst-write 10 bytes to SMUX RAM at I2C 0x00.
    if (!writeRegs(0x00, bytes, 10)) return false;
    // 4. SMUXEN = 1 → engine copies RAM into chain-1 hardware, then clears SMUXEN.
    if (!writeReg(REG_ENABLE, EN_PON | EN_SMUXEN)) return false;
    if (!_waitSmuxDone(50)) return false;
    return writeReg(REG_ENABLE, EN_PON);
}

bool AS7343::writeSmuxChain(uint8_t chainNum, const Chain& chain) {
    if (chainNum < 1 || chainNum > 3) return false;
    const uint8_t cmd = (uint8_t)(0x46 + 0x10 * (chainNum - 1));   // 0x46 / 0x56 / 0x66
    uint8_t bytes[10];
    _packPixels(chain.raw(), bytes);

    if (!writeReg(REG_ENABLE, EN_PON)) return false;

    // Direct method writes pixels from high ID to low ID — i.e. RAM-packed bytes
    // in reverse order. Each E7 byte is acknowledged by a CHAINCMD write.
    for (int i = 9; i >= 0; i--) {
        if (!writeReg(REG_CHAIN_SMUX, bytes[i])) return false;
        if (!writeReg(REG_CHAINCMD, cmd)) return false;
    }
    return true;
}

bool AS7343::setChains(Chains c) {
    uint8_t cfg20;
    if (!readReg(REG_CFG20, cfg20)) return false;
    cfg20 = (cfg20 & ~0x60) | (((uint8_t)c << 5) & 0x60);
    return writeReg(REG_CFG20, cfg20);
}

bool AS7343::loadDefaultSmux(Chains c) {
    // Default chain layouts from AN001033 §2 / Fig 14.
    // Chain 1: FZ→ADC0, FY→ADC1, FXL→ADC2, NIR→ADC3, VIS(LT+RB)→ADC4, FD→ADC5
    // Chain 2: F2→ADC0, F3→ADC1, F4→ADC2, F6→ADC3,   VIS(LT+RB)→ADC4, FD→ADC5
    // Chain 3: F1→ADC0, F7→ADC1, F8→ADC2, F5→ADC3,   VIS(LT+RB)→ADC4, FD→ADC5
    // Index = pixel ID (0..18). Value = ADC encoding (0 = disabled, 1..6 = ADC0..ADC5).
    //                                    LB XL F2 F7 FZ F1 F4 F5 LT RT F6 F8 FY F3 RB FD NIR EX D
    static const uint8_t chain1[19] = {  0, 3, 0, 0, 1, 0, 0, 0, 5, 0, 0, 0, 2, 0, 5, 6, 4, 0, 0 };
    static const uint8_t chain2[19] = {  0, 0, 1, 0, 0, 0, 3, 0, 5, 0, 4, 0, 0, 2, 5, 6, 0, 0, 0 };
    static const uint8_t chain3[19] = {  0, 0, 0, 2, 0, 1, 0, 4, 5, 0, 0, 3, 0, 0, 5, 6, 0, 0, 0 };

    auto load = [&](const uint8_t* src, uint8_t chainNum) -> bool {
        Chain b;
        for (uint8_t i = 0; i < 19; i++) {
            if (src[i]) b.route((Pixel)i, (uint8_t)(src[i] - 1));
        }
        return writeSmuxChain(chainNum, b);
    };

    if (!load(chain1, 1)) return false;
    if (c == Chains::TWO || c == Chains::THREE) {
        if (!load(chain2, 2)) return false;
    }
    if (c == Chains::THREE) {
        if (!load(chain3, 3)) return false;
    }
    return setChains(c);
}

// -------- Measurement --------

bool AS7343::startMeasurement() { return _enableBits(EN_SP_EN, true); }
bool AS7343::stopMeasurement()  { return _enableBits(EN_SP_EN, false); }

bool AS7343::isDataReady() {
    uint8_t s2;
    if (!readReg(REG_STATUS2, s2)) return false;
    return (s2 & (1 << 6)) != 0;
}

bool AS7343::waitDataReady(uint32_t timeoutMs) {
    const uint32_t deadline = millis() + timeoutMs;
    while ((int32_t)(deadline - millis()) > 0) {
        if (isDataReady()) return true;
        delayMicroseconds(200);
        yield();
    }
    return false;
}

bool AS7343::readChannels6(uint16_t out[6]) {
    uint8_t buf[12];
    if (!readRegs(REG_DATA0_L, buf, 12)) return false;
    for (uint8_t i = 0; i < 6; i++) {
        out[i] = (uint16_t)buf[2 * i] | ((uint16_t)buf[2 * i + 1] << 8);
    }
    return true;
}

bool AS7343::readChannels12(uint16_t out[12]) {
    uint8_t buf[24];
    if (!readRegs(REG_DATA0_L, buf, 24)) return false;
    for (uint8_t i = 0; i < 12; i++) {
        out[i] = (uint16_t)buf[2 * i] | ((uint16_t)buf[2 * i + 1] << 8);
    }
    return true;
}

bool AS7343::readChannels18(uint16_t out[18]) {
    uint8_t buf[36];
    if (!readRegs(REG_DATA0_L, buf, 36)) return false;
    for (uint8_t i = 0; i < 18; i++) {
        out[i] = (uint16_t)buf[2 * i] | ((uint16_t)buf[2 * i + 1] << 8);
    }
    return true;
}

bool AS7343::measure6(uint16_t out[6], uint32_t timeoutMs) {
    if (!clearDataReady()) return false;
    if (!startMeasurement()) return false;
    if (!waitDataReady(timeoutMs)) { stopMeasurement(); return false; }
    bool ok = readChannels6(out);
    stopMeasurement();
    return ok;
}

bool AS7343::clearDataReady() {
    // STATUS bits are clear-on-write-1. Clearing AINT (bit 3) lets the next AVALID latch.
    return writeReg(REG_STATUS, 0x08);
}

// -------- Status --------

bool AS7343::readStatus(Status& s) {
    uint8_t v;

    if (!readReg(REG_STATUS, v)) return false;
    s.asat        = (v & (1 << 7)) != 0;
    s.spectralIrq = (v & (1 << 3)) != 0;
    s.fifoIrq     = (v & (1 << 2)) != 0;
    s.systemIrq   = (v & (1 << 0)) != 0;

    if (!readReg(REG_STATUS2, v)) return false;
    s.dataValid   = (v & (1 << 6)) != 0;
    s.asatDigital = (v & (1 << 4)) != 0;
    s.asatAnalog  = (v & (1 << 3)) != 0;

    if (!readReg(REG_STATUS4, v)) return false;
    s.overTemp    = (v & (1 << 5)) != 0;

    if (!readReg(REG_ASTATUS, v)) return false;
    s.appliedGain = (Gain)(v & 0x0F);
    return true;
}

bool AS7343::clearAllStatus() {
    return writeReg(REG_STATUS,  0xFF) &&
           writeReg(REG_STATUS2, 0xFF) &&
           writeReg(REG_STATUS3, 0xFF) &&
           writeReg(REG_STATUS4, 0xFF) &&
           writeReg(REG_STATUS5, 0xFF);
}

// -------- Interrupts --------

bool AS7343::setSpectralThreshold(uint16_t low, uint16_t high, uint8_t whichAdc) {
    if (whichAdc > 5) return false;
    uint8_t tl[2] = { (uint8_t)(low  & 0xFF),  (uint8_t)(low  >> 8) };
    uint8_t th[2] = { (uint8_t)(high & 0xFF),  (uint8_t)(high >> 8) };
    if (!writeRegs(REG_SP_TH_L, tl, 2)) return false;
    if (!writeRegs(REG_SP_TH_H, th, 2)) return false;
    uint8_t cfg12;
    if (!readReg(REG_CFG12, cfg12)) return false;
    cfg12 = (cfg12 & ~0x07) | (whichAdc & 0x07);
    return writeReg(REG_CFG12, cfg12);
}

bool AS7343::setIrqEnable(bool spectralAlert, bool fifo, bool flickerDone, bool smuxDone) {
    // INTENAB: ASIEN(7), SP_IEN(3), F_IEN(2), SIEN(0)
    uint8_t intenab = 0;
    if (spectralAlert) intenab |= (1 << 3);
    if (fifo)          intenab |= (1 << 2);
    if (flickerDone || smuxDone) intenab |= (1 << 0);
    if (!writeReg(REG_INTENAB, intenab)) return false;

    // CFG9: SIEN_FD(6), SIEN_SMUX(4)
    uint8_t cfg9;
    if (!readReg(REG_CFG9, cfg9)) return false;
    cfg9 &= ~((1 << 6) | (1 << 4));
    if (flickerDone) cfg9 |= (1 << 6);
    if (smuxDone)    cfg9 |= (1 << 4);
    return writeReg(REG_CFG9, cfg9);
}

bool AS7343::clearSmuxDone() {
    return writeReg(REG_STATUS5, 1 << 2);
}

// -------- Low-level I2C --------

bool AS7343::readReg(uint8_t reg, uint8_t& v) {
    if (!_wire) return false;
    _wire->beginTransmission(_addr);
    _wire->write(reg);
    if (_wire->endTransmission(false) != 0) return false;
    if (_wire->requestFrom((int)_addr, 1) != 1) return false;
    v = (uint8_t)_wire->read();
    return true;
}

bool AS7343::writeReg(uint8_t reg, uint8_t v) {
    if (!_wire) return false;
    _wire->beginTransmission(_addr);
    _wire->write(reg);
    _wire->write(v);
    return _wire->endTransmission() == 0;
}

bool AS7343::readRegs(uint8_t reg, uint8_t* buf, size_t len) {
    if (!_wire || !buf || len == 0) return false;
    _wire->beginTransmission(_addr);
    _wire->write(reg);
    if (_wire->endTransmission(false) != 0) return false;
    size_t got = _wire->requestFrom((int)_addr, (int)len);
    if (got != len) return false;
    for (size_t i = 0; i < len; i++) buf[i] = (uint8_t)_wire->read();
    return true;
}

bool AS7343::writeRegs(uint8_t reg, const uint8_t* buf, size_t len) {
    if (!_wire || !buf || len == 0) return false;
    _wire->beginTransmission(_addr);
    _wire->write(reg);
    for (size_t i = 0; i < len; i++) _wire->write(buf[i]);
    return _wire->endTransmission() == 0;
}

// -------- Internal helpers --------

bool AS7343::_enableBits(uint8_t mask, bool on) {
    uint8_t v;
    if (!readReg(REG_ENABLE, v)) return false;
    if (on) v |= mask; else v &= ~mask;
    return writeReg(REG_ENABLE, v);
}

bool AS7343::_waitSmuxDone(uint32_t timeoutMs) {
    const uint32_t deadline = millis() + timeoutMs;
    while ((int32_t)(deadline - millis()) > 0) {
        uint8_t en;
        if (!readReg(REG_ENABLE, en)) return false;
        if ((en & EN_SMUXEN) == 0) {
            writeReg(REG_STATUS5, 1 << 2);   // clear SINT_SMUX latch
            return true;
        }
        delayMicroseconds(200);
        yield();
    }
    return false;
}
