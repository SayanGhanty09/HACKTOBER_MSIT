# AS7343 Low-Level Configuration Audit — ANEBILIN2

Source material reviewed:
- `resources/AS7343_EvalSW_ALS_v2-4-3/Documents/application notes/SMUX/AS7343_SMUX_Configuration_AN001033_1-02.pdf` (authoritative)
- `resources/AS7343_EvalSW_ALS_v2-4-3/SDK/chiplib/` (ams official C driver)
- `resources/7Semi-AS7343/src/7Semi_AS7343.{h,cpp}` (Arduino driver)
- `resources/AS7343_EvalSW_ALS_v2-4-3/Documents/data sheet/AS7343_DS001046_NDA_1_00.pdf` (NDA datasheet)

Target use case: non-invasive bilirubin + haemoglobin via custom-SMUX 6-channel ADC routing for fastest one-shot reads, with controllable internal LED.

---

## 1. Register Map (the registers we actually need)

| Reg | Addr | Bits | Purpose |
|---|---|---|---|
| AUXID | 0x58 | [3:0] | Aux ID (bank-1 area) |
| REVID | 0x59 | [2:0] | Revision |
| ID    | 0x5A | [7:0] | Device ID — must read **0x81** |
| CFG12 | 0x66 | [2:0] | SP_TH_CH (which channel feeds threshold compare) |
| ENABLE | 0x80 | see §2 | PON / SP_EN / WEN / SMUXEN / FDEN |
| ATIME | 0x81 | [7:0] | Integration step count (0..255) |
| WTIME | 0x83 | [7:0] | Wait time between measurements |
| SP_TH_L/H | 0x84-0x87 | 16-bit each | Low / High spectral threshold |
| STATUS2 | 0x90 | AVALID, ASAT_*, FDSAT_* | Validity + saturation flags |
| STATUS3 | 0x91 | AINT_TL/TH | Low/High alert flags |
| STATUS | 0x93 | ASAT/AINT/FINT/SINT | Top-level interrupt status |
| ASTATUS | 0x94 | ASAT_STATUS + AGAIN_STATUS[3:0] | Saturation + current AGC gain |
| DATAx_L/H | 0x95-0xB8 | 16-bit | **CH0..CH5 data per chain × up to 3 chains** (6/12/18 channels) |
| STATUS5 | 0xBB | SINT_FD, SINT_SMUX | Flicker / SMUX-done interrupts |
| STATUS4 | 0xBC | OVTEMP, FIFO_OV, … | Errors |
| CFG0 | 0xBF | bit 4 = REG_BANK, bit 2 = WLONG, bit 5 = LOW_POWER | Bank select |
| CFG1 | 0xC6 | [4:0] = AGAIN | Amplifier gain (0..12 → 0.5x..2048x; chiplib enum goes to 14=5120x) |
| CFG3 | 0xC7 | bit 4 = SAI | Sleep-after-interrupt |
| CFG8 | 0xC9 | [7:6] = FIFO_TH | FIFO threshold level |
| CFG9 | 0xCA | bit 6 = SIEN_FD, **bit 4 = SIEN_SMUX** | "Special" interrupt enables (must set bit 4 to get SMUX-done IRQ) |
| CFG10 | 0x65 | flicker / AGC config | |
| **PCFG2 / LED** | **0xCD** | **bit 7 = LED_ACT, [6:0] = LED_DRIVE** | **Internal LED — see §6** |
| PERS | 0xCF | [3:0] = APERS, [6:4] = FD_PERS | Interrupt persistence |
| ASTEP_L/H | 0xD4/0xD5 | 16-bit (1..65534) | Integration step length |
| CFG20 | 0xD6 | bit 7 = FD_FIFO_8BIT, **[6:5] = autorun_smux2** | **SMUX cycle count (1/2/3 chains)** |
| AGC_GAIN_MAX | 0xD7 | [7:4] AGC max, [3:0] AGC min | AGC range |
| AZ_CONFIG | 0xDE | [7:0] | Auto-zero iteration count |
| FIFO_CFG0 | 0xDF | bit 7 = FIFO_WRITE_FLD | Flicker data into FIFO |
| FD_TIME_1/2 | 0xE0/0xE2 | flicker time + gain | |
| FD_STATUS | 0xE3 | flicker valid/sat/100/120 | |
| **CHAINCMD** | **0xE4** | 0x46 / 0x56 / 0x66 | **Direct-chain target: chain 1 / 2 / 3** |
| **CHAIN_SMUX** | **0xE7** | [7:4]=odd nibble, [3:0]=even nibble (per page write) | **Direct-chain SMUX nibble pair** |
| INTENAB | 0xF9 | ASIEN/SP_IEN/F_IEN/SIEN | Master IRQ enable |
| CONTROL | 0xFA | bit 3 SW_RESET, bit 2 AZ_TRIG, bit 1 FIFO_CLR, bit 0 CLEAR_SAI | |
| FIFO_MAP | 0xFC | per-channel FIFO inclusion | |
| FIFO_LVL | 0xFD | level | |
| FDATA_L/H | 0xFE/0xFF | FIFO read | |

**SMUX RAM (used only by the "comfortable" RAM method, §4a):** I²C addresses **0x00..0x09** — 10 bytes, each packing 2 pixel-ID nibbles. Per AN001033 §3.

---

## 2. ENABLE (0x80) Bitmap

| Bit | Name | Action |
|---|---|---|
| 0 | **PON** | Power on |
| 1 | **SP_EN** | Start spectral measurement |
| 3 | WEN | Wait timer between integrations |
| 4 | **SMUXEN** | Trigger SMUX command (write/read RAM or load RAM→SMUX) |
| 6 | FDEN | Flicker detection engine |

Typical macros:
- `0x01` — PON only (idle)
- `0x03` — PON + SP_EN (run measurement)
- `0x11` — PON + SMUXEN (execute SMUX command set in CFG6)
- `0x0B` — PON + WEN + SP_EN (cyclic)

**Bug to be aware of in 7Semi driver** (`7Semi_AS7343.cpp:46`): the `begin()` writes `ENABLE` bit 6 expecting it to be PON — but bit 6 is **FDEN**, not PON. PON was already set at line 33 via `setPower(POWER_ON)`. Calling `bus->writeBit(AS7343_REG_ENABLE, 6, 1)` effectively enables flicker detection unintentionally. Mention this if reusing the 7Semi class.

---

## 3. CFG0 Bank Switching (the 7Semi-isms)

`CFG0.REG_BANK` (bit 4) of register 0xBF nominally chooses between two register banks for low addresses (0x00..0x7F). For all addresses **0x80..0xFF** (which is essentially everything we touch — ENABLE, ATIME, WTIME, AGAIN, ASTEP, LED, INTENAB, CONTROL, SMUX RAM-method `CFG6/0xF5`, CHAINCMD/CHAIN_SMUX), bank does **not matter** — these are always-accessible. AN001033 examples write to 0x80, 0xCA, 0xF5, 0xF9, 0xE4, 0xE7 with **no bank switch at all**.

The 7Semi driver toggles bank everywhere (`setRegisterBank(true)` before reading ID, `setRegisterBank(true)` before writing ENABLE, etc.). This is *carried over from AS7341 conventions and is unnecessary on AS7343*. It is not harmful, just wasteful (extra I²C writes per call).

**Practical rule:** leave REG_BANK = 0 (default), don't switch.

`CFG0.WLONG` (bit 2) multiplies WTIME ×16 if set. Leave 0 unless you need long sleeps.
`CFG0[5]` LOW_POWER — keep 0 for fastest readings.

---

## 4. SMUX Programming — the meat of the audit

The SMUX maps each of 18 valid photodiode "pixel IDs" (0..18, see §5) to one of 6 ADCs, in 1, 2, or 3 sequential "chains". A chain is a single integration period in which 6 ADCs run in parallel. **Fast 6-channel custom read = 1 chain only.**

Pixel-ID-to-ADC encoding is 3 bits per pixel (4 bits used per nibble; bit3 of each nibble unused):

| Value | Meaning |
|---|---|
| 0 | pixel disconnected (tied to GND) |
| 1 | route to ADC0 (→ DATA0) |
| 2 | route to ADC1 (→ DATA1) |
| 3 | route to ADC2 (→ DATA2) |
| 4 | route to ADC3 (→ DATA3) |
| 5 | route to ADC4 (→ DATA4) |
| 6 | route to ADC5 (→ DATA5, also the flicker ADC) |
| 7 | reserved |

A chain config is a 20-entry nibble array indexed by pixel ID 0..19 (index 19 is unused). The "Chain Map" (AN001033 Fig. 3) — index → filter — is **fixed by silicon** and we map it once:

| idx | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| filter | VIS_LB | XL | F2 | F7 | FZ | F1 | F4 | F5 | VIS_LT | VIS_RT | F6 | F8 | FY | F3 | VIS_RB | FD | NIR | Ext | D | — |

(VIS_xx are the four "clear" diodes at corners; XL = FXL ≈ 600 nm wide; FD = flicker detection pixel; Ext = external pixel; D = dark.)

### 4a. Method A — "Comfortable" RAM Configuration (single-chain only)

Limited to one chain (= ALS6). Good enough for our 6-channel use case.

I²C addresses 0x00..0x09 each hold *two* pixel IDs (low pixel in bits[2:0], high pixel in bits[6:4], bit3 + bit7 unused). Total 20 nibbles = 10 bytes.

| I²C reg | high nibble (bits6:4) | low nibble (bits2:0) |
|---|---|---|
| 0x00 | Pixel 1 (XL) | Pixel 0 (VIS_LB) |
| 0x01 | Pixel 3 (F7) | Pixel 2 (F2) |
| 0x02 | Pixel 5 (F1) | Pixel 4 (FZ) |
| 0x03 | Pixel 7 (F5) | Pixel 6 (F4) |
| 0x04 | Pixel 9 (VIS_RT) | Pixel 8 (VIS_LT) |
| 0x05 | Pixel 11 (F8) | Pixel 10 (F6) |
| 0x06 | Pixel 13 (F3) | Pixel 12 (FY) |
| 0x07 | Pixel 15 (FD) | Pixel 14 (VIS_RB) |
| 0x08 | Pixel 17 (Ext) | Pixel 16 (NIR) |
| 0x09 | — | Pixel 18 (D) |

**Procedure** (AN001033 §3.1, Fig. 8):
```
I2C_write(0x80, 0x01)   // ENABLE: PON=1, SP_EN=0
I2C_write(0xCA, 0x10)   // CFG9: SIEN_SMUX=1 (interrupt when SMUX done)
I2C_write(0xF9, 0x01)   // INTENAB: SIEN=1 (route SINT to pin)
I2C_write(0xF5, 0x10)   // CFG6: SMUX_CMD = 0b01 = write SMUX from RAM
I2C_write(0x00..0x09, <10 bytes>)   // SMUX RAM
I2C_write(0x80, 0x11)   // ENABLE: PON=1 + SMUXEN=1 → executes the SMUX command
// wait SINT or poll STATUS5.SINT_SMUX (bit 2)
I2C_write(0x80, 0x01)   // back to PON only (SMUX self-clears)
// ... now set ATIME/ASTEP/AGAIN/LED ...
I2C_write(0x80, 0x03)   // PON + SP_EN → start integration
// poll STATUS2.AVALID (bit 6) or STATUS.AINT (bit 3) → read DATA0..DATA5
```
CFG6 (0xF5) `SMUX_CMD` field is bits[4:3] (chiplib `bus->writeBits(REG_CFG6, 3, 2, cmd)`): 00=ROM init, 01=read RAM, 10=write RAM (0x10 = bit 4 set = write).

### 4b. Method B — Direct Chain Configuration (up to 3 chains)

For 12- or 18-channel modes you need this. Even for 1 chain it's clean and avoids the RAM round-trip.

Sequence: for each of 20 nibble pairs (packed into a byte: `high<<4 | low`) per chain, write `CHAIN_SMUX (0xE7) = data`, then `CHAINCMD (0xE4) = 0x46 (chain 1)` / `0x56 (chain 2)` / `0x66 (chain 3)`. After 20 byte writes per chain, the chain is loaded. Finally set `CFG20[6:5] = autorun_smux2 = N-1` to select number of chains.

Canonical default chain arrays from AN001033 Fig. 14:
```c
// 20 nibble values, index = pixel ID 0..19
//                    LB  XL  F2  F7  FZ  F1  F4  F5  LT  RT  F6  F8  FY  F3  RB  FD  NIR Ext D   --
uint8_t chain1[20] = {  0,  0,  0,  0,  4,  0,  6,  0,  5,  5,  0,  0,  2,  0,  5,  6,  5,  0,  0, 0 };
uint8_t chain2[20] = {  0,  0,  2,  0,  0,  0,  5,  0,  5,  5,  4,  0,  0,  3,  5,  6,  0,  0,  0, 0 };
uint8_t chain3[20] = {  0,  0,  0,  0,  0,  1,  0,  4,  5,  5,  0,  3,  0,  0,  5,  6,  0,  0,  0, 0 };

// Loader (pseudo-C):
for (i=0; i<20; i+=2) {
    write(0xE7, (chain1[i]<<4) | chain1[i+1]);
    write(0xE4, 0x46);  // commit to chain 1
}
for (i=0; i<20; i+=2) {
    write(0xE7, (chain2[i]<<4) | chain2[i+1]);
    write(0xE4, 0x56);  // commit to chain 2
}
for (i=0; i<20; i+=2) {
    write(0xE7, (chain3[i]<<4) | chain3[i+1]);
    write(0xE4, 0x66);  // commit to chain 3
}
write(0xD6, 0x60);  // CFG20: autorun_smux2 = 0b11 (3 chains, 18 channels)
```
Decoded defaults (matches §3.1 of app note):
- Chain1 ADC layout: ADC0=Z(FZ@450), ADC1=Y(FY@555), ADC2=Xk(FXL@600 — note app note also calls this XL), ADC3=NIR(855), ADC4=VIS_LT+VIS_RB, ADC5=FD(flicker)
- Chain2 ADC layout: ADC0=F2(425), ADC1=F3(475), ADC2=F4(515), ADC3=F6(600w narrow ≈ 635 per app note), ADC4=VIS_LT+VIS_RB, ADC5=FD
- Chain3 ADC layout: ADC0=F1(405), ADC1=F7(690/685), ADC2=F8(745), ADC3=F5(550/546), ADC4=VIS_LT+VIS_RB, ADC5=FD

CFG20 `autorun_smux2`: 0 or 1 = 1 chain, 2 = 2 chains, 3 = 3 chains. After spectral start the engine sequences through chains automatically and dumps each chain's six ADCs to a successive 6-word block of DATA registers (DATA0..5 = chain1, DATA6..11 = chain2, DATA12..17 = chain3).

### 4c. SMUX wait/sync

After SMUX command (bit SMUXEN=1) the device clears SMUXEN itself when done (~1 ms). Two ways to know it's done:
1. **Polling**: read `STATUS5 (0xBB)` bit 2 (`SINT_SMUX`) — set when command finishes; write `0xFF` to clear. Or poll ENABLE.SMUXEN until cleared.
2. **Interrupt**: enable `CFG9 (0xCA) bit 4 = SIEN_SMUX` and `INTENAB (0xF9) bit 0 = SIEN`. Interrupt pin asserts when done.

---

## 5. Photodiode / channel reference

From datasheet + 7Semi annotations (`7Semi_AS7343.h:328-349`):

| Filter | Centre (nm) | Notes |
|---|---|---|
| F1 | 405 | Violet — useful for bilirubin secondary band |
| F2 | 425 | Deep blue — close to bilirubin peak |
| FZ | 450 | Blue — **bilirubin primary peak (~458 nm)** |
| F3 | 475 | Blue — bilirubin reference upper shoulder |
| F4 | 515 | Cyan |
| F5 | 550 | Green — near HbO2/Hb isosbestic (~568) |
| FY | 555 | Green broad |
| FXL | ~600 | Wide-band orange |
| F6 | 600 | Orange (app note sometimes notes 635) |
| F7 | 690 | Red — strong Hb absorption shoulder |
| F8 | 745 | Deep red |
| NIR | 855 | **Only IR channel** |
| VIS_LT/LB/RT/RB | broadband visible | Four "clear" corner diodes, normally LT+RB used as reference |
| FD | — | Flicker-detection diode (100/120 Hz detector) |

**Critical limitation for blood analytes:** AS7343 has no 940 nm photodiode. Standard pulse-oximetry (HbO2 vs Hb) ratiometry assumes 660 nm (Hb) / 940 nm (HbO2). The closest IR we have is **855 nm** — usable as a Hb/HbO2 baseline but not equivalent to 940 nm. Bilirubin (peak ~458 nm) maps perfectly onto FZ + a reference such as F5/FY/F6. If you need SpO2-grade SaO2 you'll likely need an external 940 nm LED + ambient subtraction; the AS7343 alone isn't a drop-in pulse oximeter.

### Suggested 6-channel custom chain for bilirubin + Hb (one-chain fast read)

```
ADC0 (DATA0) ← Pixel  4 (FZ 450)   bilirubin peak
ADC1 (DATA1) ← Pixel  5 (F1 405)   bilirubin/violet
ADC2 (DATA2) ← Pixel 13 (F3 475)   bilirubin upper shoulder
ADC3 (DATA3) ← Pixel  7 (F5 550)   Hb/HbO2 isosbestic ref
ADC4 (DATA4) ← Pixel  3 (F7 690)   Hb absorption
ADC5 (DATA5) ← Pixel 16 (NIR 855)  IR baseline / Hb-vs-HbO2 differentiator
```
Nibble array (index = pixel ID, value = ADC+1 or 0):
```c
//          LB XL F2 F7 FZ F1 F4 F5 LT RT F6 F8 FY F3 RB FD NIR E  D  --
uint8_t bilirubin_hb_chain1[20] =
        {  0, 0, 0, 5, 1, 2, 0, 4, 0, 0, 0, 0, 0, 3, 0, 0, 6, 0, 0, 0 };
```
CFG20 autorun_smux2 = 0 (1 chain) → single integration period → 6 ADCs in parallel → fastest possible reading.

Alternative 6-channel set (visible-only, no IR — for pure bilirubin):
```
ADC0=FZ, ADC1=F1, ADC2=F2, ADC3=F3, ADC4=F4, ADC5=F5
```

---

## 6. LED Control

### Internal LED (driven from AS7343's own LDR pin)

Register **PCFG2 (0xCD)**:
- bit 7 = LED_ACT (1 = LED on)
- bits[6:0] = LDR_DRIVE: current = `(LDR_DRIVE × 2) + 4` mA → range **4 mA to 258 mA** in 2 mA steps (max code = 127 → 258 mA)

Note: per the chiplib `MAX_LED_DRIVING_STRENGTH = 258`. The internal LED requires an external LED wired to the LDR pin to ground; AS7343 sinks the current.

Reference impl. (`7Semi_AS7343.cpp:170-194`):
```c
void setLED(bool on, uint16_t mA) {
    uint8_t code = (mA - 4) / 2;          // 0..127
    uint8_t v = code & 0x7F;
    if (on) v |= 0x80;
    i2c_write(0xCD, v);
}
```

### External LEDs (firmware-managed via chiplib)

The ams chiplib exposes LED_EXT_0..LED_EXT_5 (`as7352_typedefs.h` items 16..21) — these are external LEDs driven by the host MCU, synchronized to measurement cycles via the `LED_PATTERN` item (sequence of `{count, mask}` pairs that the chiplib's FSM toggles before each chain). The bit-masks (`LED_MASK_INTERN=0x01`, `LED_MASK_EXT_0=0x02` …`LED_MASK_EXT_5=0x40`, `LED_MASK_OUTPUT=0x80`) just identify which logical LED to switch in each pattern slot; the actual GPIO routing is implemented in the host glue (i.e. `as7352_osal_chiplib_template.c`). Useful if you decide to add an external 940 nm LED later.

### LED warm-up

`ITEM_ID_LED_WAIT_TIME` (item 13) — microseconds the chiplib waits after enabling LED before starting integration; relevant if your LED needs settling (laser/IR diodes especially).

### GPIO pin (0x6B) — alternative external-LED control

- bit 2 = GPIO_IN_EN
- bit 3 = GPIO_INV
- Can be driven as a binary output via the chiplib (`ITEM_ID_GPIO_*`) for a single external LED on/off if you don't want full LED_PATTERN.

---

## 7. Integration Time (ATIME × ASTEP × AGAIN)

Formula (chiplib `as7352_typedefs.h:268`, datasheet):
```
t_int  = (ATIME + 1) × (ASTEP + 1) × (2000 / 720) µs
       ≈ (ATIME + 1) × (ASTEP + 1) × 2.778 µs
```
ADC full-scale = `(ATIME + 1) × (ASTEP + 1)`, capped at 65535 (16-bit).

Limits:
- ATIME: 0..255
- ASTEP: 1..65534 (registers 0xD4 LSB, 0xD5 MSB)
- MIN_ITIME ≈ 6 µs, MAX_ITIME ≈ 46.6 s
- Defaults: ATIME=29, ASTEP=599 → 30 × 600 × 2.778 µs = **50 ms** integration

For **fast** reads (maximize SNR while staying responsive — fingertip transmission/reflection):
- Short loop: ATIME=0, ASTEP=719 → 720 × 2.778 = **2.0 ms** integration, max ADC = 720
- Balanced: ATIME=9, ASTEP=999 → 10 × 1000 × 2.778 = **27.78 ms**, max ADC = 10000
- Bilirubin (LED-illuminated, low signal): ATIME=29, ASTEP=599 → 50 ms, max ADC 18000 — start here

For 1-chain custom SMUX the *measurement* takes one t_int. For 3-chain auto-SMUX it takes 3 × t_int (sequential).

### AGAIN (CFG1, bits[4:0])

| code | gain |
|---|---|
| 0 | 0.5× |
| 1..12 | 1×, 2×, 4×, 8×, 16×, 32×, 64×, 128×, 256×, 512×, 1024×, 2048× |
| 13..14 | 4096×, 5120× (chiplib enum; 7Semi driver caps at 12) |

Start at **128×** for LED-illuminated tissue and use AGC (`measure_set_auto_gain_als` lower=GAIN_4X, upper=GAIN_2048X) for the first measurements, then lock once stable.

`ASTATUS (0x94)` bits[3:0] return the gain that was actually applied to the last conversion — store this alongside the raw ADC counts for normalization.

---

## 8. WTIME / WLONG (optional)

`WTIME (0x83)`: wait between integration cycles in units of 2.78 ms (i.e. `(WTIME+1) × 2.78 ms`). Enable with ENABLE.WEN. With `CFG0.WLONG=1` the unit becomes ×16. For triggered single-shot reads you can leave WEN=0 and skip this entirely.

---

## 9. Power-Up / Init Sequence (canonical, derived from chiplib `as7352_interface.c:350-449` + AN001033)

```c
1.  Wait ≥ 200 ms after power-up for internal LDO to settle.
2.  Write CONTROL (0xFA) bit 3 = 1   // SW_RESET; wait 1 ms
3.  Read ID (0x5A) — expect 0x81. Abort otherwise.
4.  Write ENABLE (0x80) = 0x01       // PON
5.  Write INTENAB (0xF9) = 0x00      // mask all IRQs while configuring
6.  Configure SMUX (Method A or B from §4) — wait SMUX-done
7.  Write ATIME (0x81), ASTEP_L/H (0xD4/0xD5), CFG1 (0xC6) AGAIN
8.  Write PCFG2 (0xCD)               // LED current + enable, if used
9.  (optional) Auto-zero: ENABLE.SP_EN=0, AZ_CONFIG (0xDE) = N,
       CONTROL.AZ_TRIG (bit 2) = 1, wait until cleared
10. ENABLE (0x80) = 0x03             // PON + SP_EN → start measurement
11. Wait STATUS2 (0x90) bit 6 (AVALID) — or rising edge on INT pin
12. Read ASTATUS (0x94) for applied gain + 12 bytes from DATA0_L (0x95) for 6 ADCs
13. Optional: clear by writing STATUS = 0xFF
```

For continuous fast reads with auto-SMUX you can keep ENABLE=0x03 set and just keep polling AVALID; the engine reruns the configured 1/2/3-chain pattern back to back (or paced by WTIME if WEN=1).

---

## 10. Status / Saturation Decoding

| Source | Bits to check |
|---|---|
| STATUS (0x93) | bit 7 ASAT (any saturation), bit 3 AINT (data ready), bit 2 FINT (FIFO IRQ), bit 0 SINT (special IRQ) |
| STATUS2 (0x90) | bit 6 AVALID, bit 4 ASAT_DIGITAL (count clipped), bit 3 ASAT_ANALOG (PD saturated), bit 1/2 flicker sat |
| STATUS3 (0x91) | bit 5 high alert, bit 4 low alert (threshold compare on CFG12.SP_TH_CH) |
| STATUS4 (0xBC) | bit 7 FIFO_OV, bit 5 OVTEMP, bit 4 FD_TRIG_ERR, bit 2 SP_TRIG_ERR, bit 1 SAI_ACTIVE, bit 0 INIT_BUSY |
| STATUS5 (0xBB) | bit 3 SINT_FD (flicker done), bit 2 SINT_SMUX (SMUX done) |
| ASTATUS (0x94) | bit 7 ASAT_STATUS (saturation latched at conversion), [3:0] AGAIN_STATUS (gain applied) |
| FD_STATUS (0xE3) | bit 5 valid, bit 4 saturate, bit 3 valid120, bit 2 valid100, bit 1 detect120, bit 0 detect100 |

**Always read ASTATUS and the saturation bits with the data** — under LED illumination of tissue, easy to hit ASAT_ANALOG on FZ/F1 while NIR is still mid-range.

---

## 11. Auto-Zero & Calibration

`AZ_CONFIG (0xDE)` (chiplib `as7352_set_autozero`): each N integration cycles the device re-zeros the offsets. Trigger one manually by setting `CONTROL.AZ_TRIG (bit 2) = 1` with SP_EN=0 first (7Semi `setAutoZero` does this dance). Recommended at start of session and after large temperature changes.

For spectrum→XYZ or analyte-concentration calibration ams provides:
- `Documents/application notes/Calibration/AS7343_Spectral Sensor Calibration Methods AN.pdf`
- Excel templates for Spectral→XYZ and Spectral→TCS

For blood analytes you'd build your own forward model (Beer–Lambert with per-channel ε at the centre wavelengths) and calibrate offsets / dark current per device.

---

## 12. What the 7Semi driver gives us vs. what we need

### Already exposed
- `begin()` / `softReset()`, `setPower`, `setSpectralEnable`
- `setGain(Gain)` → CFG1[4:0] (capped at 2048×, which is fine for our use)
- `setIntegrationTime(atime, astep)` → ATIME + ASTEP_L/H
- `setLED(bool, mA)` → PCFG2 (`0xCD`)
- `setAutoSMUX(AUTO_6CH/12CH/18CH)` → CFG20[6:5]
- `setSMUXCommand(SMUX_WRITE_RAM/READ_RAM/INIT)` → CFG6 SMUX_CMD field + SMUXEN
- `setSMUX(bool)` → ENABLE.SMUXEN
- `readSpectralData(...)` → bulk read of all 18 DATA registers

### Missing — needs to be added for our use case
1. **Custom SMUX byte programming** — no way to push 10 RAM bytes to 0x00..0x09 or 20 direct-chain bytes via 0xE7/0xE4. Need helpers:
   - `bool writeSmuxRam(const uint8_t bytes[10])` — Method A
   - `bool writeSmuxChain(uint8_t chain /*1-3*/, const uint8_t nibbles[20])` — Method B
   - `bool waitSmuxDone(uint32_t timeout_ms)` — poll STATUS5 bit 2
2. **Single-chain raw read of just DATA0..5** — `readSpectralData` reads all 36 bytes; we want a `readChain(uint16_t out[6])` that grabs 12 bytes from `0x95` for the fastest path.
3. **Spectral ready polling** — checking STATUS2.AVALID without the full struct readback.
4. **ASTATUS read** to capture applied AGC gain alongside data.
5. **Bug fix**: drop the spurious `bit 6 = true` write in `begin()` (`7Semi_AS7343.cpp:46`) — that bit is FDEN, not a duplicate PON.
6. **Bank-switch elision** — strip the `setRegisterBank(true/false)` calls everywhere; they're vestigial from AS7341 and cost an extra I²C transaction per register access.

### Suggested high-level API for this project
```cpp
bool beginAS7343(uint8_t addr=0x39, uint32_t i2cHz=400000);
bool setIntegration(uint8_t atime, uint16_t astep);
bool setGain(uint8_t code /*0..12*/);
bool setLED(bool on, uint16_t mA);
bool programCustom6Channel(const uint8_t pixelToAdc[19]);  // wraps Method A
bool startMeasurement();                                   // ENABLE = 0x03
bool waitDataReady(uint32_t timeout_ms);                   // poll STATUS2.AVALID
bool readChan6(uint16_t adc[6], uint8_t* gainOut=nullptr); // DATA0..5 + ASTATUS
bool sleep();                                              // ENABLE = 0x01
```

---

## 13. Known quirks & gotchas

- **Datasheet vs. chiplib names**: the chiplib calls the part "AS7352" because the AS7343 is the productized variant of the AS7352 die. The register map is identical.
- **F6 wavelength ambiguity**: 7Semi annotations say F6=640 nm, AN001033 default-chain comments say F6=635 nm, datasheet says ~600. Treat F6 as "wide orange around 600–640 nm" until you measure spectrally.
- **FXL vs XL vs Xk**: same diode; the AN001033 calls it `Xk` in one place — typo for FXL.
- **NDA datasheet**: `AS7343_DS001046_NDA_1_00.pdf` — under ams NDA. Don't paste verbatim into public sources.
- **SMUX RAM method **only programs chain 1** — even if you have `autorun_smux2`=2 or 3 set, the other chains keep whatever (probably default) values they had until you reprogram via the direct method. For pure 6-channel work this doesn't matter.
- **SMUX-done IRQ via CFG9 bit 4**: SIEN_SMUX is required if you want the INT pin to assert on SMUX completion. The CFG9 bit-position used by 7Semi (`enableInterrupt`) for SMUX-done is **bit 4**, matching the app note (`0x10`).
- **Flicker on ADC5**: in all default chains ADC5 is fed the flicker diode (FD), routed to DATA5 of each chain. If you want a normal spectral channel on ADC5 in your custom 6-channel chain, just route any pixel ID to `6` instead of FD.

---

## 14. References (file paths in this repo)

- AN001033 SMUX app note — `resources/AS7343_EvalSW_ALS_v2-4-3/Documents/application notes/SMUX/AS7343_SMUX_Configuration_AN001033_1-02.pdf`
- AGC app note — `…/application notes/Automated Gain/AS7343 Auto Gain AN.pdf`
- Optics app note — `…/application notes/Optic/AS7343 APN-opto-mechanics.pdf`
- Calibration AN — `…/application notes/Calibration/AS7343_Spectral Sensor Calibration Methods AN.pdf`
- Datasheet (NDA) — `…/data sheet/AS7343_DS001046_NDA_1_00.pdf`
- ams chiplib source — `…/SDK/chiplib/src/{as7352_interface.c, as7352_measurement.c, as7352_configuration.c}`
- ams chiplib API — `…/SDK/chiplib/inc/chiplib/{as7352_configuration.h, as7352_measurement.h, as7352_interface.h}`
- ams chiplib enums — `…/SDK/chiplib/inc/as7352_typedefs.h`
- ams sample — `…/SDK/sample_code/as7352_sample_code_chiplib.c`
- 7Semi Arduino driver — `resources/7Semi-AS7343/src/{7Semi_AS7343.cpp, 7Semi_AS7343.h}`
