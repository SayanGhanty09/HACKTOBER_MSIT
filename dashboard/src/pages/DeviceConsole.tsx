import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
    Terminal,
    Send,
    Trash2,
    Upload,
    RefreshCw,
    AlertTriangle,
    Bluetooth,
    BluetoothOff,
} from 'lucide-react';
import { useBLE, BLEStatus } from '../contexts/BLEContext';
import { Card, Button, Pill, SectionHeader } from '../components/ui';

const DeviceConsole: React.FC = () => {
    const { status, logs, connect, disconnect, sendCommand, clearLogs } = useBLE();
    const [input, setInput] = useState('');
    const [isUpdating, setIsUpdating] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    const isConnected =
        status === BLEStatus.CONNECTED ||
        status === BLEStatus.IDLE ||
        status === BLEStatus.SCANNING ||
        status === BLEStatus.SCANNING_BP;

    const isConnecting = status === BLEStatus.CONNECTING;

    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [logs]);

    const handleSend = async () => {
        if (!input || !isConnected) return;
        const cmdMap: Record<string, number> = {
            START: 0x01,
            START_NORMAL: 0x01,
            START_BP: 0x02,
            STOP: 0x00,
        };
        const cmd = cmdMap[input.toUpperCase()] ?? parseInt(input, 16);
        if (!isNaN(cmd)) {
            await sendCommand(cmd);
            setInput('');
        }
    };

    const handleUpdate = () => {
        setIsUpdating(true);
        setTimeout(() => setIsUpdating(false), 3000);
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)' }}
        >
            {/* ===================== Header ===================== */}
            <header
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) auto',
                    alignItems: 'flex-end',
                    gap: 'var(--sp-6)',
                }}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <span
                        style={{
                            fontSize: 'var(--text-xs)',
                            color: 'var(--ink-3)',
                            textTransform: 'uppercase',
                            letterSpacing: '0.16em',
                            fontWeight: 500,
                        }}
                    >
                        Device console
                    </span>
                    <h1
                        style={{
                            fontFamily: 'var(--font-display)',
                            fontSize: 'clamp(36px, 4vw, 56px)',
                            lineHeight: 1.04,
                            letterSpacing: '-0.022em',
                            fontWeight: 400,
                        }}
                    >
                        Hardware &amp; <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>diagnostics</em>.
                    </h1>
                    <p style={{ color: 'var(--ink-3)', maxWidth: '60ch', fontSize: 'var(--text-md)' }}>
                        Low-level command bus, firmware metadata, and live serial trace.
                    </p>
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {!isConnected && (
                        <Button
                            onClick={() => connect(true)}
                            loading={isConnecting}
                            variant="secondary"
                            size="lg"
                            title="Show all nearby Bluetooth devices (use if Anebilin doesn't show in filtered list)"
                        >
                            Scan all devices
                        </Button>
                    )}
                    <Button
                        onClick={isConnected ? disconnect : () => connect(false)}
                        loading={isConnecting}
                        variant={isConnected ? 'danger' : 'primary'}
                        size="lg"
                        leadingIcon={
                            isConnecting ? undefined : isConnected ? <BluetoothOff size={16} /> : <Bluetooth size={16} />
                        }
                    >
                        {isConnecting ? 'Connecting' : isConnected ? 'Disconnect' : 'Connect device'}
                    </Button>
                </div>
            </header>

            {/* ===================== Body ===================== */}
            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(320px, 380px) minmax(0, 1fr)',
                    gap: 'var(--sp-6)',
                    alignItems: 'stretch',
                }}
            >
                {/* -------- Left rail: firmware + danger zone -------- */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
                    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                        <SectionHeader eyebrow="Firmware" title="Device" />
                        <Card pad="0">
                            <DataRow label="Connection">
                                <Pill tone={isConnected ? 'success' : 'neutral'} dot size="sm">
                                    {isConnected ? 'Online' : 'Offline'}
                                </Pill>
                            </DataRow>
                            <DataRow label="Firmware">
                                <span className="num">v1.2.0</span>
                            </DataRow>
                            <DataRow label="Build">
                                <span className="num">2024-05-15</span>
                            </DataRow>
                            <DataRow label="Model">
                                <span className="num" style={{ fontSize: 'var(--text-sm)' }}>ESP32-S3-WROOM-1</span>
                            </DataRow>

                            <div style={{ padding: 'var(--sp-4) var(--sp-5)', borderTop: '1px solid var(--hairline)' }}>
                                <div
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 8,
                                        padding: '10px 12px',
                                        background: 'var(--success-soft)',
                                        border: '1px solid color-mix(in oklab, var(--success) 22%, transparent)',
                                        borderRadius: 'var(--r-2)',
                                        color: 'var(--success)',
                                        fontSize: 'var(--text-sm)',
                                        fontWeight: 500,
                                    }}
                                >
                                    <RefreshCw size={14} strokeWidth={1.8} />
                                    System up to date
                                </div>
                            </div>

                            <div
                                style={{
                                    padding: 'var(--sp-4) var(--sp-5)',
                                    borderTop: '1px solid var(--hairline)',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 8,
                                }}
                            >
                                <Button
                                    variant="primary"
                                    size="md"
                                    block
                                    onClick={handleUpdate}
                                    loading={isUpdating}
                                    disabled={!isConnected}
                                    leadingIcon={!isUpdating && <Upload size={14} />}
                                >
                                    Upload firmware (.bin)
                                </Button>
                                <Button variant="secondary" size="md" block disabled={!isConnected}>
                                    Check for updates
                                </Button>
                            </div>
                        </Card>
                    </section>

                    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                        <SectionHeader eyebrow="Danger" title="Advanced" />
                        <Card>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
                                <AlertTriangle size={16} strokeWidth={1.8} color="var(--warn)" style={{ flexShrink: 0, marginTop: 2 }} />
                                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-3)', lineHeight: 1.5 }}>
                                    Factory reset clears all stored calibration. The device will need to be re-paired.
                                </p>
                            </div>
                            <Button variant="danger" size="md" block disabled={!isConnected}>
                                Factory reset device
                            </Button>
                        </Card>
                    </section>
                </div>

                {/* -------- Right: terminal -------- */}
                <Card
                    pad="0"
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden',
                        minHeight: 560,
                        background: 'var(--ink)',
                        color: 'var(--paper)',
                        borderColor: 'var(--ink)',
                    }}
                >
                    {/* Terminal head */}
                    <div
                        style={{
                            padding: '12px 18px',
                            borderBottom: '1px solid color-mix(in oklab, var(--paper) 12%, transparent)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <Terminal size={14} strokeWidth={1.8} color="color-mix(in oklab, var(--paper) 70%, transparent)" />
                            <span
                                style={{
                                    fontSize: 'var(--text-xs)',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.18em',
                                    color: 'color-mix(in oklab, var(--paper) 60%, transparent)',
                                    fontWeight: 500,
                                }}
                            >
                                Serial trace
                            </span>
                            <span className="num" style={{ fontSize: 'var(--text-xs)', color: 'color-mix(in oklab, var(--paper) 40%, transparent)' }}>
                                {logs.length} lines
                            </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <button
                                onClick={clearLogs}
                                aria-label="Clear logs"
                                title="Clear logs"
                                style={{
                                    width: 28, height: 28,
                                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                    background: 'transparent',
                                    color: 'color-mix(in oklab, var(--paper) 60%, transparent)',
                                    border: '1px solid color-mix(in oklab, var(--paper) 12%, transparent)',
                                    borderRadius: 'var(--r-2)',
                                    cursor: 'pointer',
                                    transition: 'background-color var(--t-2) var(--ease), color var(--t-2) var(--ease)',
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = 'color-mix(in oklab, var(--paper) 8%, transparent)'; e.currentTarget.style.color = 'var(--paper)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'color-mix(in oklab, var(--paper) 60%, transparent)'; }}
                            >
                                <Trash2 size={13} strokeWidth={1.6} />
                            </button>
                            <span
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    fontSize: 'var(--text-xs)',
                                    color: isConnected ? '#86efac' : '#fda4af',
                                    fontWeight: 500,
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.12em',
                                }}
                            >
                                <span
                                    style={{
                                        width: 6, height: 6, borderRadius: '50%',
                                        background: isConnected ? '#86efac' : '#fda4af',
                                    }}
                                />
                                {isConnected ? 'Active' : 'Idle'}
                            </span>
                        </div>
                    </div>

                    {/* Log stream */}
                    <div
                        ref={scrollRef}
                        style={{
                            flex: 1,
                            padding: 'var(--sp-4) var(--sp-5)',
                            fontFamily: 'var(--font-mono)',
                            fontSize: 'var(--text-sm)',
                            color: 'color-mix(in oklab, var(--paper) 88%, transparent)',
                            overflowY: 'auto',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 2,
                            lineHeight: 1.6,
                        }}
                    >
                        {logs.length === 0 ? (
                            <div style={{ color: 'color-mix(in oklab, var(--paper) 38%, transparent)', fontStyle: 'italic' }}>
                                Awaiting trace…
                            </div>
                        ) : (
                            logs.map((log, idx) => {
                                const color = log.startsWith('>')
                                    ? '#7dd3fc'
                                    : log.includes('[ERROR]')
                                    ? '#fda4af'
                                    : log.includes('[SUCCESS]')
                                    ? '#86efac'
                                    : log.includes('[BLE]')
                                    ? '#c4b5fd'
                                    : log.includes('[STATUS]')
                                    ? '#fcd34d'
                                    : 'inherit';
                                return (
                                    <div key={idx} style={{ display: 'flex', gap: 14, alignItems: 'baseline' }}>
                                        <span style={{ opacity: 0.32, fontSize: 'var(--text-xs)' }}>
                                            {idx.toString().padStart(4, '0')}
                                        </span>
                                        <span style={{ color, wordBreak: 'break-word', flex: 1 }}>{log}</span>
                                    </div>
                                );
                            })
                        )}
                    </div>

                    {/* Input */}
                    <div
                        style={{
                            padding: 'var(--sp-4) var(--sp-5)',
                            borderTop: '1px solid color-mix(in oklab, var(--paper) 12%, transparent)',
                            display: 'flex',
                            gap: 10,
                            background: 'color-mix(in oklab, var(--paper) 4%, transparent)',
                        }}
                    >
                        <input
                            type="text"
                            placeholder={isConnected ? 'START · START_BP · STOP · 0x01 · 0x02' : 'Connect device to send commands'}
                            value={input}
                            disabled={!isConnected}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                            style={{
                                flex: 1,
                                fontFamily: 'var(--font-mono)',
                                fontSize: 'var(--text-base)',
                                background: 'color-mix(in oklab, var(--paper) 6%, transparent)',
                                border: '1px solid color-mix(in oklab, var(--paper) 12%, transparent)',
                                color: 'var(--paper)',
                                borderRadius: 'var(--r-2)',
                                padding: '10px 14px',
                            }}
                        />
                        <button
                            onClick={handleSend}
                            disabled={!isConnected || !input}
                            aria-label="Send command"
                            style={{
                                width: 44, height: 44,
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                background: 'var(--paper)',
                                color: 'var(--ink)',
                                border: 'none',
                                borderRadius: 'var(--r-2)',
                                cursor: (!isConnected || !input) ? 'not-allowed' : 'pointer',
                                opacity: (!isConnected || !input) ? 0.4 : 1,
                                transition: 'transform var(--t-1) var(--ease)',
                            }}
                        >
                            <Send size={16} strokeWidth={1.8} />
                        </button>
                    </div>
                </Card>
            </div>

        </motion.div>
    );
};

const DataRow: React.FC<React.PropsWithChildren<{ label: string }>> = ({ label, children }) => (
    <div
        style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 'var(--sp-4)',
            padding: '12px var(--sp-5)',
            borderTop: '1px solid var(--hairline)',
        }}
    >
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-3)' }}>{label}</span>
        <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{children}</span>
    </div>
);

export default DeviceConsole;
