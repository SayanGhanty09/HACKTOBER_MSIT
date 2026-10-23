import React, { createContext, useContext, useState, useRef, useCallback } from 'react';
import { getHideBPAndRespiration } from '../utils/preferences';

// ========================================================================
// BLE UUIDs — must match firmware BLEManager.h
// ========================================================================
export const SERVICE_UUID       = "0000fff0-0000-1000-8000-00805f9b34fb";
export const STATUS_CHAR_UUID   = "0000fff1-0000-1000-8000-00805f9b34fb"; // Read+Indicate (1 byte)
export const CONTROL_CHAR_UUID  = "0000fff2-0000-1000-8000-00805f9b34fb"; // Write         (1 byte)
export const LIVEDATA_CHAR_UUID = "0000fff3-0000-1000-8000-00805f9b34fb"; // Notify        (32 bytes)
export const ECG_CTRL_CHAR_UUID = "0000fff4-0000-1000-8000-00805f9b34fb"; // Write         (cmd + u16 LE)
export const ECG_DATA_CHAR_UUID = "0000fff5-0000-1000-8000-00805f9b34fb"; // Notify        (seq + n + int16[])
export const ECG_STAT_CHAR_UUID = "0000fff6-0000-1000-8000-00805f9b34fb"; // Read+Indicate (16 bytes)

// ECG control commands (FFF4) — see ECG_BRIEF.md
export const ECG_CMD = {
    START:   0x10,
    STOP:    0x11,
    GET_META:0x12,
    GET_CHUNK:0x13,
    CLEAR:   0x14,
    ABORT:   0x15,
} as const;

// ECG device state (FFF6 byte 0) — mirrors firmware EcgState
export const EcgState = {
    IDLE:         0,
    RECORDING:    1,
    READY:        2,
    TRANSFERRING: 3,
    ERROR:        4,
} as const;

export type EcgStateType = (typeof EcgState)[keyof typeof EcgState];

export interface EcgStatus {
    state:        EcgStateType;
    fs:           number;
    count:        number;
    durationMs:   number;
    chunkSamples: number;
}

const ECG_IDLE_STATUS: EcgStatus = {
    state: EcgState.IDLE, fs: 0, count: 0, durationMs: 0, chunkSamples: 0,
};

// ========================================================================
// Status enum — mirrors firmware DeviceState
// ========================================================================
export const BLEStatus = {
    DISCONNECTED: -1,
    CONNECTING:   -2,
    CONNECTED:    -3,
    IDLE:          0,
    SCANNING:      1,   // normal biomarker mode
    SCANNING_BP:   2,   // BP mode (200 Hz)
} as const;

export type BLEStatusType = (typeof BLEStatus)[keyof typeof BLEStatus];

// ========================================================================
// Data types
// ========================================================================
export interface Biomarkers {
    pi?:        number;
    sqi?:       number;
    spo2?:      number;
    hr?:        number;
    sdnn?:      number;
    rmssd?:     number;
    hb?:        number;
    bilirubin?: number;
    bpSys?:     number;
    bpDia?:     number;
    pulseRate?: number;
    respRate?:  number;
}

export type ScanPhase = 'idle' | 'normal' | 'bp' | 'done';

interface BLEContextType {
    status:        BLEStatusType;
    device:        BluetoothDevice | null;
    biomarkers:    Biomarkers;
    bestNormal:    Biomarkers;
    bestBP:        Biomarkers;
    scanPhase:     ScanPhase;
    scanSeconds:   number;
    logs:          string[];
    connect:       (acceptAll?: boolean) => Promise<void>;
    disconnect:    () => void;
    sendCommand:   (cmd: number) => Promise<void>;
    startFullScan: () => void;
    clearLogs:     () => void;

    // ---- ECG (FFF4/FFF5/FFF6) ----
    ecgStatus:     EcgStatus;
    ecgWaveform:   number[];
    ecgProgress:   number;   // 0..1 during fetch
    ecgBusy:       boolean;  // true while sweeping chunks
    ecgStart:      (durationSec?: number) => Promise<void>;
    ecgStop:       () => Promise<void>;
    ecgClear:      () => Promise<void>;
    ecgFetch:      () => Promise<void>;
}

const BLEContext = createContext<BLEContextType | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export const useBLE = () => {
    const ctx = useContext(BLEContext);
    if (!ctx) throw new Error("useBLE must be used within a BLEProvider");
    return ctx;
};

// ========================================================================
// Provider
// ========================================================================
export const BLEProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [device, setDevice]           = useState<BluetoothDevice | null>(null);
    const [status, setStatus]           = useState<BLEStatusType>(BLEStatus.DISCONNECTED);
    const [biomarkers, setBiomarkers]   = useState<Biomarkers>({});
    const [bestNormal, setBestNormal]   = useState<Biomarkers>({});
    const [bestBP, setBestBP]           = useState<Biomarkers>({});
    const [scanPhase, setScanPhase]     = useState<ScanPhase>('idle');
    const [scanSeconds, setScanSeconds] = useState(0);
    const [logs, setLogs]               = useState<string[]>(["[SYSTEM] BLE initialized"]);
    const [ecgStatus, setEcgStatus]     = useState<EcgStatus>(ECG_IDLE_STATUS);
    const [ecgWaveform, setEcgWaveform] = useState<number[]>([]);
    const [ecgProgress, setEcgProgress] = useState(0);
    const [ecgBusy, setEcgBusy]         = useState(false);

    const controlCharRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
    const serverRef      = useRef<BluetoothRemoteGATTServer | null>(null);
    const phaseRef       = useRef<ScanPhase>('idle');
    const bestNormalRef  = useRef<Biomarkers>({});
    const bestBPRef      = useRef<Biomarkers>({});
    const scanTimerRef   = useRef<ReturnType<typeof setInterval> | null>(null);

    // ECG refs — status mirror (for chunk math) + one in-flight chunk waiter.
    const ecgCtrlCharRef   = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
    const ecgStatusRef     = useRef<EcgStatus>(ECG_IDLE_STATUS);
    const ecgWaiterRef     = useRef<{ resolve: (s: number[]) => void } | null>(null);

    // Accumulate all valid readings for weighted averaging
    const normalSamplesRef = useRef<Biomarkers[]>([]);
    const bpSamplesRef     = useRef<Biomarkers[]>([]);

    /** Compute SQI-weighted average of accumulated normal samples */
    const computeWeightedNormal = (): Biomarkers => {
        const samples = normalSamplesRef.current;
        if (samples.length === 0) return {};
        const keys: (keyof Biomarkers)[] = ['pi', 'sqi', 'spo2', 'hr', 'sdnn', 'rmssd', 'hb', 'bilirubin'];
        let totalWeight = 0;
        const sums: Record<string, number> = {};
        for (const s of samples) {
            const w = Math.max(s.sqi ?? 1, 1); // SQI as weight, min 1
            totalWeight += w;
            for (const k of keys) {
                if (s[k] !== undefined && !isNaN(s[k]!)) {
                    sums[k] = (sums[k] ?? 0) + s[k]! * w;
                }
            }
        }
        const result: Biomarkers = {};
        for (const k of keys) {
            if (sums[k] !== undefined) (result as Record<string, number>)[k] = sums[k] / totalWeight;
        }
        return result;
    };

    /** Compute simple average of accumulated BP samples */
    const computeAverageBP = (): Biomarkers => {
        const samples = bpSamplesRef.current;
        if (samples.length === 0) return {};
        const keys: (keyof Biomarkers)[] = ['bpSys', 'bpDia', 'pulseRate', 'respRate'];
        const sums: Record<string, { total: number; count: number }> = {};
        for (const s of samples) {
            for (const k of keys) {
                if (s[k] !== undefined && !isNaN(s[k]!)) {
                    if (!sums[k]) sums[k] = { total: 0, count: 0 };
                    sums[k].total += s[k]!;
                    sums[k].count++;
                }
            }
        }
        const result: Biomarkers = {};
        for (const k of keys) {
            if (sums[k]) (result as Record<string, number>)[k] = sums[k].total / sums[k].count;
        }
        return result;
    };

    const addLog = useCallback((msg: string) => {
        setLogs(prev => [...prev.slice(-199), `[${new Date().toLocaleTimeString()}] ${msg}`]);
    }, []);

    // ----------------------------------------------------------------
    // FFF3 — Live Data (32 bytes = 8 × float32 LE)
    // Normal: [pi, sqi, spo2, hr, sdnn, rmssd, hb, bili]
    // BP:     [sbp, dbp, pulse_rate, resp_rate, 0, 0, 0, 0]
    // ----------------------------------------------------------------
    const handleLiveData = useCallback((event: Event) => {
        const target = event.target as BluetoothRemoteGATTCharacteristic;
        const dv: DataView = target.value!;
        if (dv.byteLength !== 32) {
            addLog(`[DATA] Invalid packet (${dv.byteLength}b, expected 32)`);
            return;
        }

        const phase = phaseRef.current;

        if (phase === 'normal') {
            const pi    = dv.getFloat32(0,  true);
            const sqi   = dv.getFloat32(4,  true);
            const spo2  = dv.getFloat32(8,  true);
            const hr    = dv.getFloat32(12, true);
            const sdnn  = dv.getFloat32(16, true);
            const rmssd = dv.getFloat32(20, true);
            const hb    = dv.getFloat32(24, true);
            const bili  = dv.getFloat32(28, true);

            const pkt: Biomarkers = { pi, sqi, spo2, hr, sdnn, rmssd, hb, bilirubin: bili };
            setBiomarkers(pkt);

            // Accumulate valid readings and update weighted average
            if (hr > 30 && hr < 250) {
                normalSamplesRef.current.push(pkt);
                const avg = computeWeightedNormal();
                bestNormalRef.current = avg;
                setBestNormal(avg);
            }

            addLog(`[NORMAL] PI=${pi.toFixed(2)} SQI=${sqi.toFixed(2)} SpO2=${spo2.toFixed(1)} HR=${hr.toFixed(0)}`);

        } else if (phase === 'bp') {
            const sbp = dv.getFloat32(0,  true);
            const dbp = dv.getFloat32(4,  true);
            const pr  = dv.getFloat32(8,  true);
            const rr  = dv.getFloat32(12, true);

            // NaN means device has no calibration yet — omit those fields
            const pkt: Biomarkers = {
                bpSys:     isNaN(sbp) ? undefined : sbp,
                bpDia:     isNaN(dbp) ? undefined : dbp,
                pulseRate: pr,
                respRate:  (rr > 0 && rr <= 35) ? rr : undefined,
            };
            // Merge into existing biomarkers so normal readings (HR, SpO2, SDNN…) stay visible
            setBiomarkers(prev => ({ ...prev, ...Object.fromEntries(Object.entries(pkt).filter(([, v]) => v !== undefined)) }));

            // Accumulate valid BP readings and update running average
            if (pr > 30 && pr < 250) {
                bpSamplesRef.current.push(pkt);
                const avg = computeAverageBP();
                bestBPRef.current = avg;
                setBestBP(avg);
            }

            const sbpStr = isNaN(sbp) ? 'uncal' : sbp.toFixed(1);
            const dbpStr = isNaN(dbp) ? 'uncal' : dbp.toFixed(1);
            const rrStr  = (rr > 0 && rr <= 35) ? rr.toFixed(1) : 'wait';
            addLog(`[BP] SBP=${sbpStr} DBP=${dbpStr} PR=${pr.toFixed(0)} RR=${rrStr}`);
        }
    }, [addLog]);

    // ----------------------------------------------------------------
    // FFF1 — Status Indicate (1 byte)
    // ----------------------------------------------------------------
    const handleStatus = useCallback((event: Event) => {
        const target = event.target as BluetoothRemoteGATTCharacteristic;
        const s = target.value!.getUint8(0);
        if (s === 0x00) setStatus(BLEStatus.IDLE);
        else if (s === 0x01) setStatus(BLEStatus.SCANNING);
        else if (s === 0x02) setStatus(BLEStatus.SCANNING_BP);
        addLog(`[STATUS] Device → 0x${s.toString(16).padStart(2, '0')}`);
    }, [addLog]);

    // ----------------------------------------------------------------
    // FFF6 — ECG Status Indicate (16 bytes)
    // [state, flags, fs u32, count u32, duration_ms u32, chunk u16]
    // ----------------------------------------------------------------
    const handleEcgStatus = useCallback((event: Event) => {
        const target = event.target as BluetoothRemoteGATTCharacteristic;
        const dv = target.value;
        if (!dv || dv.byteLength < 16) {
            addLog(`[ECG] Invalid status (${dv?.byteLength ?? 0}b, expected 16)`);
            return;
        }
        const next: EcgStatus = {
            state:        dv.getUint8(0) as EcgStateType,
            fs:           dv.getUint32(2, true),
            count:        dv.getUint32(6, true),
            durationMs:   dv.getUint32(10, true),
            chunkSamples: dv.getUint16(14, true),
        };
        ecgStatusRef.current = next;
        setEcgStatus(next);
        addLog(`[ECG] state=${next.state} fs=${next.fs} samples=${next.count}`);
    }, [addLog]);

    // ----------------------------------------------------------------
    // FFF5 — ECG Data Notify (seq u16 + n u16 + n × int16 LE)
    // ----------------------------------------------------------------
    const handleEcgData = useCallback((event: Event) => {
        const target = event.target as BluetoothRemoteGATTCharacteristic;
        const dv = target.value;
        if (!dv || dv.byteLength < 4) return;
        const n = dv.getUint16(2, true);
        const samples: number[] = new Array(n);
        for (let i = 0; i < n; i++) samples[i] = dv.getInt16(4 + i * 2, true);
        const waiter = ecgWaiterRef.current;
        if (waiter) {
            ecgWaiterRef.current = null;
            waiter.resolve(samples);
        }
    }, []);

    const writeEcgControl = useCallback(async (cmd: number, arg?: number) => {
        const ch = ecgCtrlCharRef.current;
        if (!ch) { addLog('[ECG] Not connected'); return; }
        const buf = new Uint8Array(arg === undefined ? 1 : 3);
        buf[0] = cmd;
        if (arg !== undefined) {
            buf[1] = arg & 0xff;
            buf[2] = (arg >> 8) & 0xff;
        }
        try {
            await ch.writeValue(buf);
            addLog(`[ECG] cmd 0x${cmd.toString(16).padStart(2, '0')}${arg !== undefined ? ` arg=${arg}` : ''}`);
        } catch (error: unknown) {
            addLog(`[ECG] cmd error: ${error instanceof Error ? error.message : String(error)}`);
        }
    }, [addLog]);

    const ecgStart = useCallback(async (durationSec?: number) => {
        setEcgWaveform([]);
        setEcgProgress(0);
        await writeEcgControl(ECG_CMD.START, durationSec ?? 0);
    }, [writeEcgControl]);

    const ecgStop = useCallback(async () => {
        await writeEcgControl(ECG_CMD.STOP);
    }, [writeEcgControl]);

    const ecgClear = useCallback(async () => {
        setEcgWaveform([]);
        setEcgProgress(0);
        await writeEcgControl(ECG_CMD.CLEAR);
    }, [writeEcgControl]);

    // Request one FFF5 chunk and wait for the matching notify (or timeout).
    const requestEcgChunk = useCallback((seq: number): Promise<number[]> =>
        new Promise((resolve) => {
            const ch = ecgCtrlCharRef.current;
            if (!ch) { resolve([]); return; }
            const waiter = { resolve };
            ecgWaiterRef.current = waiter;
            ch.writeValue(new Uint8Array([ECG_CMD.GET_CHUNK, seq & 0xff, (seq >> 8) & 0xff]))
              .catch(() => {
                  if (ecgWaiterRef.current === waiter) { ecgWaiterRef.current = null; resolve([]); }
              });
            setTimeout(() => {
                if (ecgWaiterRef.current === waiter) { ecgWaiterRef.current = null; resolve([]); }
            }, 2500);
        }), []);

    // Sweep all chunks sequentially and reassemble the int16 waveform.
    const ecgFetch = useCallback(async () => {
        const st = ecgStatusRef.current;
        if (!ecgCtrlCharRef.current || st.count === 0) { addLog('[ECG] Nothing to fetch'); return; }
        const chunk = st.chunkSamples || 120;
        const total = Math.ceil(st.count / chunk);
        setEcgBusy(true);
        setEcgProgress(0);
        const out: number[] = [];
        for (let seq = 0; seq < total; seq++) {
            const part = await requestEcgChunk(seq);
            if (part.length === 0) { addLog(`[ECG] chunk ${seq}/${total} timed out`); break; }
            for (let i = 0; i < part.length; i++) out.push(part[i]);
            setEcgProgress((seq + 1) / total);
        }
        setEcgWaveform(out);
        setEcgBusy(false);
        addLog(`[ECG] Fetched ${out.length}/${st.count} samples`);
    }, [addLog, requestEcgChunk]);

    // ----------------------------------------------------------------
    // Connect
    // ----------------------------------------------------------------
    const connect = async (acceptAll: boolean = false) => {
        try {
            if (typeof navigator === 'undefined' || !navigator.bluetooth) {
                alert("Web Bluetooth is not supported in this browser. Please use Google Chrome, Microsoft Edge, or a Chromium-based browser.");
                addLog("[BLE] Web Bluetooth API not supported in this browser");
                return;
            }

            addLog(acceptAll ? "[BLE] Scanning for all Bluetooth devices..." : "[BLE] Requesting Anebilin device...");
            setStatus(BLEStatus.CONNECTING);

            const requestOptions: RequestDeviceOptions = acceptAll
                ? {
                    acceptAllDevices: true,
                    optionalServices: [SERVICE_UUID],
                }
                : {
                    filters: [
                        { name: "Anebilin" },
                        { namePrefix: "Anebilin" },
                        { namePrefix: "Anebil" },
                        { namePrefix: "Spectru" },
                        { namePrefix: "ESP" },
                        { services: [SERVICE_UUID] },
                    ],
                    optionalServices: [SERVICE_UUID],
                };

            const dev = await navigator.bluetooth.requestDevice(requestOptions);

            addLog(`[BLE] Connecting to ${dev.name || 'Anebilin'}...`);
            const server = await dev.gatt!.connect();
            serverRef.current = server;

            const service = await server.getPrimaryService(SERVICE_UUID);

            controlCharRef.current = await service.getCharacteristic(CONTROL_CHAR_UUID);

            const liveChar = await service.getCharacteristic(LIVEDATA_CHAR_UUID);
            await liveChar.startNotifications();
            liveChar.addEventListener('characteristicvaluechanged', handleLiveData);

            const statusChar = await service.getCharacteristic(STATUS_CHAR_UUID);
            await statusChar.startNotifications();
            statusChar.addEventListener('characteristicvaluechanged', handleStatus);

            // ECG (FFF4 control / FFF5 data / FFF6 status) — optional: tolerate
            // firmware without the ECG service so biomarker scans still work.
            try {
                ecgCtrlCharRef.current = await service.getCharacteristic(ECG_CTRL_CHAR_UUID);

                const ecgDataChar = await service.getCharacteristic(ECG_DATA_CHAR_UUID);
                await ecgDataChar.startNotifications();
                ecgDataChar.addEventListener('characteristicvaluechanged', handleEcgData);

                const ecgStatChar = await service.getCharacteristic(ECG_STAT_CHAR_UUID);
                await ecgStatChar.startNotifications();
                ecgStatChar.addEventListener('characteristicvaluechanged', handleEcgStatus);
                addLog("[ECG] Ready");
            } catch {
                ecgCtrlCharRef.current = null;
                addLog("[ECG] Not available on this device");
            }

            dev.addEventListener('gattserverdisconnected', () => {
                addLog("[BLE] Device disconnected");
                setStatus(BLEStatus.DISCONNECTED);
                setDevice(null);
                cleanupScan();
                ecgCtrlCharRef.current = null;
                ecgStatusRef.current = ECG_IDLE_STATUS;
                setEcgStatus(ECG_IDLE_STATUS);
                setEcgWaveform([]);
                setEcgProgress(0);
                setEcgBusy(false);
            });

            setDevice(dev);
            setStatus(BLEStatus.CONNECTED);
            addLog("[BLE] Connected & Ready");
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            if (error instanceof Error && error.name === 'NotFoundError') {
                addLog("[BLE] Pairing cancelled or device not found.");
                addLog("[BLE] ⚠️ Important: If the device is connected in Atomic Serial Monitor, disconnect it first!");
            } else if (msg.includes('GATT') || msg.includes('NetworkError') || msg.includes('Connection failed') || msg.includes('failed')) {
                addLog(`[BLE] Connection failed: ${msg}`);
                addLog("[BLE] ⚠️ Is the device still connected in Atomic Serial Monitor? BLE allows only 1 connection at a time.");
                addLog("[BLE] Try: 1. Disconnect Atomic Serial Monitor 2. Reset ESP32 (RST button) 3. Click Connect.");
            } else {
                addLog(`[BLE] Error: ${msg}`);
            }
            setStatus(BLEStatus.DISCONNECTED);
        }
    };

    const disconnect = () => {
        cleanupScan();
        try {
            if (serverRef.current?.connected) {
                serverRef.current.disconnect();
            } else if (device?.gatt?.connected) {
                device.gatt.disconnect();
            }
        } catch (e) {
            console.warn("Disconnect error:", e);
        }
        setStatus(BLEStatus.DISCONNECTED);
        setDevice(null);
        addLog("[BLE] Disconnected");
    };

    // ----------------------------------------------------------------
    // Send raw command to FFF2
    // ----------------------------------------------------------------
    const sendCommand = async (cmd: number) => {
        if (!controlCharRef.current) { addLog("[CMD] Not connected"); return; }
        try {
            await controlCharRef.current.writeValue(new Uint8Array([cmd]));
            addLog(`[CMD] Sent 0x${cmd.toString(16).padStart(2, '0')}`);
        } catch (error: unknown) {
            addLog(`[CMD] Error: ${error instanceof Error ? error.message : String(error)}`);
        }
    };

    // ----------------------------------------------------------------
    // Cleanup
    // ----------------------------------------------------------------
    const cleanupScan = () => {
        if (scanTimerRef.current) { clearInterval(scanTimerRef.current); scanTimerRef.current = null; }
        phaseRef.current = 'idle';
        setScanPhase('idle');
        setScanSeconds(0);
    };

    // ----------------------------------------------------------------
    // Full Scan: 30 s normal -> optional 30 s BP -> done
    // ----------------------------------------------------------------
    const startFullScan = () => {
        if (!controlCharRef.current) { addLog("[SCAN] Not connected"); return; }

        bestNormalRef.current = {};
        bestBPRef.current = {};
        normalSamplesRef.current = [];
        bpSamplesRef.current = [];
        setBestNormal({});
        setBestBP({});
        setBiomarkers({});

        let elapsed = 0;
        const NORMAL_DUR = 30;
        const BP_DUR = 30;

        phaseRef.current = 'normal';
        setScanPhase('normal');
        setScanSeconds(NORMAL_DUR);
        sendCommand(0x01);
        addLog("[SCAN] Phase 1/2: Normal mode (30 s)");

        scanTimerRef.current = setInterval(async () => {
            elapsed++;

            if (elapsed <= NORMAL_DUR) {
                setScanSeconds(NORMAL_DUR - elapsed);
            } else if (elapsed === NORMAL_DUR + 1) {
                await sendCommand(0x00);

                if (getHideBPAndRespiration()) {
                    addLog("[SCAN] Complete! (BP scan skipped)");
                    phaseRef.current = 'idle';
                    setScanPhase('done');
                    setScanSeconds(0);
                    if (scanTimerRef.current) { clearInterval(scanTimerRef.current); scanTimerRef.current = null; }
                } else {
                    addLog("[SCAN] Normal complete. Starting BP...");
                    setTimeout(async () => {
                        phaseRef.current = 'bp';
                        setScanPhase('bp');
                        setScanSeconds(BP_DUR);
                        await sendCommand(0x02);
                        addLog("[SCAN] Phase 2/2: BP mode (30 s)");
                    }, 500);
                }
            } else if (elapsed <= NORMAL_DUR + 1 + BP_DUR) {
                setScanSeconds(NORMAL_DUR + 1 + BP_DUR - elapsed);
            } else {
                await sendCommand(0x00);
                addLog("[SCAN] Complete!");
                phaseRef.current = 'idle';
                setScanPhase('done');
                setScanSeconds(0);
                if (scanTimerRef.current) { clearInterval(scanTimerRef.current); scanTimerRef.current = null; }
            }
        }, 1000);
    };

    const clearLogs = () => setLogs([]);

    return (
        <BLEContext.Provider value={{
            status, device, biomarkers, bestNormal, bestBP,
            scanPhase, scanSeconds, logs,
            connect, disconnect, sendCommand, startFullScan, clearLogs,
            ecgStatus, ecgWaveform, ecgProgress, ecgBusy,
            ecgStart, ecgStop, ecgClear, ecgFetch,
        }}>
            {children}
        </BLEContext.Provider>
    );
};
