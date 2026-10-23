import React, { useState, useMemo } from 'react';
import { useBLE } from '../contexts/BLEContext';
import { usePatientStore } from '../contexts/PatientStore';
import type { RecordingEntry, Patient } from '../contexts/PatientStore';
import { useHideBPAndRespiration } from '../utils/preferences';
import { motion } from 'framer-motion';
import {
    FileDown,
    Activity,
    Download,
    Trash2,
    Wind,
    Users as UsersIcon,
    AlertCircle,
} from 'lucide-react';
import {
    ResponsiveContainer,
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
} from 'recharts';
import AIAssistantChat from '../components/AIAssistantChat';
import { Card, Button, Pill, SectionHeader } from '../components/ui';

const Statistics: React.FC = () => {
    const hideBPAndRespiration = useHideBPAndRespiration();
    const { biomarkers } = useBLE();
    const { patients, recordings, deleteRecording } = usePatientStore();

    const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
    const [selectedRecordingId, setSelectedRecordingId] = useState<string | null>(null);

    const patientMap = useMemo(() => {
        const m = new Map<string, { patient: Patient; records: RecordingEntry[] }>();
        for (const p of patients) m.set(p.id, { patient: p, records: [] });
        for (const r of recordings) {
            const entry = m.get(r.patientId);
            if (entry) entry.records.push(r);
            else m.set(r.patientId, {
                patient: { id: r.patientId, userId: '', name: r.patientName, age: 0, sex: 'Other', createdAt: '' },
                records: [r],
            });
        }
        return m;
    }, [patients, recordings]);

    const selectedData = useMemo(() => {
        if (selectedRecordingId) {
            const rec = recordings.find((r) => r.id === selectedRecordingId);
            return rec?.biomarkers ?? null;
        }
        return null;
    }, [selectedRecordingId, recordings]);

    const displayBio = selectedData ?? biomarkers;

    const waveformData = useMemo(() => {
        const hr = displayBio?.hr ?? 72;
        const rr = displayBio?.respRate ?? 16;
        const points = 240;
        const duration = 4;
        const data: { time: string; ppg: number }[] = [];
        for (let i = 0; i < points; i++) {
            const t = (i / points) * duration;
            const phase = (t * hr / 60) % 1;
            let cardiac = 0;
            if (phase < 0.1) cardiac = Math.sin(phase / 0.1 * Math.PI) * 80;
            else if (phase < 0.15) cardiac = Math.sin((phase - 0.1) / 0.05 * Math.PI) * -15;
            else if (phase < 0.25) cardiac = Math.sin((phase - 0.15) / 0.1 * Math.PI) * 30;
            else cardiac = -5 * Math.exp(-8 * (phase - 0.25));
            const respMod = 1 + 0.12 * Math.sin(2 * Math.PI * rr / 60 * t);
            data.push({ time: t.toFixed(2), ppg: parseFloat((cardiac * respMod).toFixed(2)) });
        }
        return data;
    }, [displayBio?.hr, displayBio?.respRate]);

    const metrics = [
        { label: 'Heart rate',  value: displayBio?.hr ? displayBio.hr.toFixed(1) : '—',           unit: 'bpm' },
        { label: 'SpO₂',        value: displayBio?.spo2 ? displayBio.spo2.toFixed(1) : '—',       unit: '%' },
        { label: 'Hemoglobin',  value: displayBio?.hb ? displayBio.hb.toFixed(2) : '—',           unit: 'g/dL' },
        { label: 'Bilirubin',   value: displayBio?.bilirubin ? displayBio.bilirubin.toFixed(2) : '—', unit: 'mg/dL' },
        ...(!hideBPAndRespiration ? [
            { label: 'Blood pressure', value: displayBio?.bpSys ? `${displayBio.bpSys.toFixed(0)}/${displayBio.bpDia?.toFixed(0) ?? '—'}` : '—', unit: 'mmHg' },
            { label: 'Respiration',    value: displayBio?.respRate ? displayBio.respRate.toFixed(1) : '—', unit: 'br/min' },
        ] : []),
    ];

    const hrvMetrics = [
        { label: 'SDNN',  value: displayBio?.sdnn ? displayBio.sdnn.toFixed(1) : '—', unit: 'ms', pct: Math.min(100, ((displayBio?.sdnn ?? 0) / 100) * 100) },
        { label: 'RMSSD', value: displayBio?.rmssd ? displayBio.rmssd.toFixed(1) : '—', unit: 'ms', pct: Math.min(100, ((displayBio?.rmssd ?? 0) / 80) * 100) },
        { label: 'PI',    value: displayBio?.pi ? displayBio.pi.toFixed(2) : '—', unit: '%',  pct: Math.min(100, ((displayBio?.pi ?? 0) / 5) * 100) },
        { label: 'SQI',   value: displayBio?.sqi !== undefined ? (displayBio.sqi * 100).toFixed(0) : '—', unit: '/100', pct: (displayBio?.sqi ?? 0) * 100 },
        { label: 'Hb',    value: displayBio?.hb ? displayBio.hb.toFixed(2) : '—', unit: 'g/dL', pct: Math.min(100, Math.max(0, ((displayBio?.hb ?? 0) - 8) / 10 * 100)) },
    ];

    const clinicalSummary = useMemo(() => {
        if (!displayBio) return 'No scan data available. Connect your device and run a scan to populate this section.';
        const flags: string[] = [];
        if (displayBio.spo2 && displayBio.spo2 < 95) flags.push(`low SpO₂ (${displayBio.spo2.toFixed(1)}%)`);
        if (displayBio.hb && displayBio.hb < 12) flags.push(`low Hb (${displayBio.hb.toFixed(2)} g/dL)`);
        if (displayBio.bilirubin && displayBio.bilirubin > 2.0) flags.push(`elevated bilirubin (${displayBio.bilirubin.toFixed(2)} mg/dL)`);
        if (displayBio.hr && (displayBio.hr > 100 || displayBio.hr < 50)) flags.push(`abnormal HR (${displayBio.hr.toFixed(0)} bpm)`);
        if (flags.length > 0) return `Attention — ${flags.join('; ')}. Clinical review recommended.`;
        return 'All indices remain within normal ranges. No significant autonomic dysfunction or haematological abnormalities detected.';
    }, [displayBio]);

    const flagged = useMemo(() => {
        if (!displayBio) return false;
        return (
            (displayBio.spo2 !== undefined && displayBio.spo2 < 95) ||
            (displayBio.hb !== undefined && displayBio.hb < 12) ||
            (displayBio.bilirubin !== undefined && displayBio.bilirubin > 2.0) ||
            (displayBio.hr !== undefined && (displayBio.hr > 100 || displayBio.hr < 50))
        );
    }, [displayBio]);

    const exportToCSV = () => {
        const headers = ['Parameter', 'Value', 'Unit'];
        const rows = metrics.map((m) => [m.label, m.value, m.unit]);
        const extra = [
            ['PI', displayBio?.pi ? displayBio.pi.toFixed(2) : '—', '%'],
            ['SQI', displayBio?.sqi !== undefined ? (displayBio.sqi * 100).toFixed(0) : '—', '/100'],
            ['SDNN', displayBio?.sdnn ? displayBio.sdnn.toFixed(2) : '—', 'ms'],
            ['RMSSD', displayBio?.rmssd ? displayBio.rmssd.toFixed(2) : '—', 'ms'],
        ];
        const csv = 'data:text/csv;charset=utf-8,' +
            headers.join(',') + '\n' +
            [...rows, ...extra].map((e) => e.join(',')).join('\n');
        const link = document.createElement('a');
        link.setAttribute('href', encodeURI(csv));
        link.setAttribute('download', `statistics_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const selectedPatientRecords = selectedPatientId ? (patientMap.get(selectedPatientId)?.records ?? []) : [];
    const selectedPatient = selectedPatientId ? patientMap.get(selectedPatientId)?.patient ?? null : null;

    return (
        <>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
                className="no-print"
                style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-7)' }}
            >
                {/* ============ Header ============ */}
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
                            History
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
                            Statistics &amp; <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>recordings</em>.
                        </h1>
                        <p style={{ color: 'var(--ink-3)', maxWidth: '60ch', fontSize: 'var(--text-md)' }}>
                            Browse prior sessions by patient, review biomarkers, export a CSV or print a PDF report.
                        </p>
                    </div>

                    <div style={{ display: 'flex', gap: 10 }}>
                        <Button variant="secondary" size="md" leadingIcon={<Download size={14} />} onClick={exportToCSV}>
                            Export CSV
                        </Button>
                        <Button variant="primary" size="md" leadingIcon={<FileDown size={14} />} onClick={() => window.print()}>
                            Generate PDF
                        </Button>
                    </div>
                </header>

                {/* ============ Layout ============ */}
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(280px, 320px) minmax(0, 1fr)',
                        gap: 'var(--sp-6)',
                        alignItems: 'start',
                    }}
                >
                    {/* ---- Patient sidebar ---- */}
                    <aside style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', position: 'sticky', top: 88 }}>
                        <SectionHeader eyebrow="Ledger" title="Patients" />
                        <Card pad="0" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                            {patients.length === 0 ? (
                                <div style={{ padding: 'var(--sp-7) var(--sp-5)', textAlign: 'center', color: 'var(--ink-3)', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
                                    <UsersIcon size={18} strokeWidth={1.6} />
                                    <span style={{ fontSize: 'var(--text-sm)' }}>No patients yet</span>
                                </div>
                            ) : (
                                <ul style={{ listStyle: 'none' }}>
                                    {[...patientMap.entries()].map(([pid, { patient, records: recs }], i) => {
                                        const active = selectedPatientId === pid;
                                        return (
                                            <li
                                                key={pid}
                                                onClick={() => { setSelectedPatientId(pid); setSelectedRecordingId(null); }}
                                                style={{
                                                    padding: 'var(--sp-4) var(--sp-5)',
                                                    borderTop: i === 0 ? 'none' : '1px solid var(--hairline)',
                                                    cursor: 'pointer',
                                                    background: active ? 'var(--accent-soft)' : 'transparent',
                                                    transition: 'background-color var(--t-2) var(--ease)',
                                                    position: 'relative',
                                                }}
                                                onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--surface-tint)'; }}
                                                onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                                            >
                                                {active && (
                                                    <span aria-hidden style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 2, background: 'var(--accent)' }} />
                                                )}
                                                <div style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 'var(--text-md)' }}>{patient.name}</div>
                                                <div className="num" style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-3)', marginTop: 2 }}>
                                                    {patient.age > 0 ? `${patient.age}y · ${patient.sex} · ` : ''}{recs.length} session{recs.length !== 1 ? 's' : ''}
                                                </div>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </Card>
                    </aside>

                    {/* ---- Main column ---- */}
                    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)', minWidth: 0 }}>
                        {selectedPatient ? (
                            <>
                                {/* Patient banner */}
                                <Card pad="var(--sp-5)" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                                        <span style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-xl)', color: 'var(--ink)', letterSpacing: '-0.018em' }}>
                                            {selectedPatient.name}
                                        </span>
                                        <span className="num" style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-3)' }}>
                                            {selectedPatient.age > 0 ? `${selectedPatient.age}y · ${selectedPatient.sex}` : 'unspecified'}
                                        </span>
                                    </div>
                                    <Pill tone="neutral">{selectedPatientRecords.length} session{selectedPatientRecords.length !== 1 ? 's' : ''}</Pill>
                                </Card>

                                {selectedPatientRecords.length === 0 && (
                                    <Card pad="var(--sp-8)" style={{ textAlign: 'center' }}>
                                        <p style={{ color: 'var(--ink-3)', fontSize: 'var(--text-sm)' }}>
                                            No recordings yet for this patient. Run a live recording to populate this view.
                                        </p>
                                    </Card>
                                )}

                                {selectedPatientRecords.length > 0 && (
                                    <Card pad="0">
                                        <div style={{ padding: 'var(--sp-4) var(--sp-5)', borderBottom: '1px solid var(--hairline)' }}>
                                            <span
                                                style={{
                                                    fontSize: 'var(--text-xs)',
                                                    textTransform: 'uppercase',
                                                    letterSpacing: '0.14em',
                                                    color: 'var(--ink-3)',
                                                    fontWeight: 500,
                                                }}
                                            >
                                                Sessions
                                            </span>
                                        </div>
                                        <ul style={{ listStyle: 'none', maxHeight: selectedRecordingId ? 220 : 360, overflowY: 'auto' }}>
                                            {selectedPatientRecords.map((rec, i) => {
                                                const active = selectedRecordingId === rec.id;
                                                return (
                                                    <li
                                                        key={rec.id}
                                                        onClick={() => setSelectedRecordingId(active ? null : rec.id)}
                                                        style={{
                                                            padding: 'var(--sp-4) var(--sp-5)',
                                                            borderTop: i === 0 ? 'none' : '1px solid var(--hairline)',
                                                            background: active ? 'var(--accent-soft)' : 'transparent',
                                                            cursor: 'pointer',
                                                            display: 'grid',
                                                            gridTemplateColumns: 'minmax(0, 1fr) auto',
                                                            alignItems: 'center',
                                                            gap: 12,
                                                            transition: 'background-color var(--t-2) var(--ease)',
                                                        }}
                                                        onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--surface-tint)'; }}
                                                        onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                                                    >
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                                                            <span className="num" style={{ color: 'var(--ink)', fontWeight: 500 }}>
                                                                Session {selectedPatientRecords.length - i}
                                                            </span>
                                                            <span className="num" style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-3)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                                                                <span>HR {rec.biomarkers.hr ? Number(rec.biomarkers.hr).toFixed(0) : '—'}</span>
                                                                <span>SpO₂ {rec.biomarkers.spo2 ? Number(rec.biomarkers.spo2).toFixed(1) : '—'}%</span>
                                                                {rec.biomarkers.bpSys && !hideBPAndRespiration && (
                                                                    <span>BP {Number(rec.biomarkers.bpSys).toFixed(0)}/{Number(rec.biomarkers.bpDia).toFixed(0)}</span>
                                                                )}
                                                            </span>
                                                        </div>
                                                        <button
                                                            aria-label="Delete recording"
                                                            title="Delete recording"
                                                            onClick={(e) => { e.stopPropagation(); deleteRecording(rec.id); }}
                                                            style={{
                                                                width: 30, height: 30,
                                                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                                                background: 'transparent',
                                                                border: '1px solid transparent',
                                                                borderRadius: 'var(--r-2)',
                                                                color: 'var(--ink-3)',
                                                                cursor: 'pointer',
                                                                transition: 'background-color var(--t-2) var(--ease), color var(--t-2) var(--ease)',
                                                            }}
                                                            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--error-soft)'; e.currentTarget.style.color = 'var(--error)'; }}
                                                            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-3)'; }}
                                                        >
                                                            <Trash2 size={14} strokeWidth={1.6} />
                                                        </button>
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    </Card>
                                )}

                                {selectedData && (
                                    <>
                                        {/* KPI grid */}
                                        <div
                                            style={{
                                                display: 'grid',
                                                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                                                gap: 'var(--sp-3)',
                                            }}
                                        >
                                            {metrics.map((m) => (
                                                <Card key={m.label} pad="var(--sp-4) var(--sp-5)" style={{ minHeight: 96, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6 }}>
                                                    <span style={{ fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--ink-3)', fontWeight: 500 }}>
                                                        {m.label}
                                                    </span>
                                                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                                                        <span className="num" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xl)', fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
                                                            {m.value}
                                                        </span>
                                                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-3)' }}>{m.unit}</span>
                                                    </div>
                                                </Card>
                                            ))}
                                        </div>

                                        <div
                                            style={{
                                                display: 'grid',
                                                gridTemplateColumns: 'minmax(240px, 1fr) minmax(0, 1.6fr)',
                                                gap: 'var(--sp-5)',
                                            }}
                                        >
                                            {/* HRV panel */}
                                            <Card pad="var(--sp-5)">
                                                <SectionHeader eyebrow="Analysis" title="HRV breakdown" />
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)', marginTop: 'var(--sp-4)' }}>
                                                    {hrvMetrics.map((h) => (
                                                        <div key={h.label} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                                                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-3)' }}>{h.label}</span>
                                                                <span className="num" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-md)', fontWeight: 500, color: 'var(--ink)' }}>
                                                                    {h.value}
                                                                    <span style={{ color: 'var(--ink-3)', fontSize: 'var(--text-xs)', marginLeft: 4 }}>{h.unit}</span>
                                                                </span>
                                                            </div>
                                                            <div style={{ width: '100%', height: 4, borderRadius: 2, background: 'var(--surface-sunken)', overflow: 'hidden' }}>
                                                                <div style={{ width: `${h.pct}%`, height: '100%', background: 'var(--accent)', borderRadius: 2, transition: 'width var(--t-3) var(--ease)' }} />
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                                <div
                                                    style={{
                                                        marginTop: 'var(--sp-5)',
                                                        padding: 'var(--sp-4)',
                                                        borderRadius: 'var(--r-2)',
                                                        background: flagged ? 'var(--warn-soft)' : 'var(--success-soft)',
                                                        border: `1px solid ${flagged ? 'color-mix(in oklab, var(--warn) 22%, transparent)' : 'color-mix(in oklab, var(--success) 22%, transparent)'}`,
                                                    }}
                                                >
                                                    <div
                                                        style={{
                                                            fontSize: 'var(--text-xs)',
                                                            textTransform: 'uppercase',
                                                            letterSpacing: '0.14em',
                                                            fontWeight: 600,
                                                            color: flagged ? 'var(--warn)' : 'var(--success)',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: 6,
                                                            marginBottom: 6,
                                                        }}
                                                    >
                                                        {flagged ? <AlertCircle size={12} /> : <Activity size={12} />}
                                                        Clinical summary
                                                    </div>
                                                    <p style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-2)', lineHeight: 1.55, margin: 0 }}>
                                                        {clinicalSummary}
                                                    </p>
                                                </div>
                                            </Card>

                                            {/* PPG waveform */}
                                            <Card pad="var(--sp-5)" style={{ minHeight: 320, display: 'flex', flexDirection: 'column' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--sp-4)' }}>
                                                    <SectionHeader eyebrow="Trace" title="Synthetic PPG" />
                                                    <span className="num" style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-3)' }}>
                                                        HR {displayBio?.hr ? displayBio.hr.toFixed(0) : '72'}{!hideBPAndRespiration ? ` · RR ${displayBio?.respRate ? displayBio.respRate.toFixed(0) : '16'}` : ''}
                                                    </span>
                                                </div>
                                                <div style={{ height: 280, marginLeft: -8 }}>
                                                    <ResponsiveContainer width="100%" height="100%">
                                                        <LineChart data={waveformData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                                                            <CartesianGrid strokeDasharray="2 4" stroke="var(--hairline)" vertical={false} />
                                                            <XAxis dataKey="time" hide />
                                                            <YAxis
                                                                stroke="var(--ink-3)"
                                                                fontSize={11}
                                                                tick={{ fontFamily: 'var(--font-mono)', fill: 'var(--ink-3)' }}
                                                                axisLine={false}
                                                                tickLine={false}
                                                                width={32}
                                                            />
                                                            <Tooltip
                                                                contentStyle={{
                                                                    background: 'var(--ink)',
                                                                    color: 'var(--paper)',
                                                                    border: '1px solid var(--ink)',
                                                                    borderRadius: 'var(--r-2)',
                                                                    fontFamily: 'var(--font-mono)',
                                                                    fontSize: 11,
                                                                }}
                                                                itemStyle={{ color: 'var(--paper)', fontSize: 11 }}
                                                                labelStyle={{ color: 'color-mix(in oklab, var(--paper) 60%, transparent)' }}
                                                                cursor={{ stroke: 'var(--hairline-strong)', strokeWidth: 1 }}
                                                            />
                                                            <Line type="monotone" dataKey="ppg" stroke="var(--accent)" strokeWidth={1.6} dot={false} isAnimationActive={false} name="PPG" />
                                                        </LineChart>
                                                    </ResponsiveContainer>
                                                </div>
                                            </Card>
                                        </div>

                                        {/* AI chat */}
                                        <AIAssistantChat
                                            biomarkerData={selectedData as Record<string, unknown> | null}
                                            patient={selectedPatient ? { name: selectedPatient.name, age: selectedPatient.age, sex: selectedPatient.sex } : null}
                                        />
                                    </>
                                )}
                            </>
                        ) : (
                            <Card pad="var(--sp-9)">
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
                                    <div
                                        style={{
                                            width: 44, height: 44, borderRadius: '50%',
                                            background: 'var(--surface-tint)', border: '1px solid var(--hairline)',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            color: 'var(--ink-3)',
                                        }}
                                    >
                                        <Wind size={18} strokeWidth={1.6} />
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                        <span style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-xl)', color: 'var(--ink)', letterSpacing: '-0.018em' }}>
                                            Select a patient
                                        </span>
                                        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-3)' }}>
                                            Pick someone from the ledger on the left to view their session history.
                                        </span>
                                    </div>
                                </div>
                            </Card>
                        )}
                    </section>
                </div>
            </motion.div>

            {/* Print template (unchanged, only renders on print) */}
            <div className="prescription-only" style={{ fontFamily: 'Arial, sans-serif' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid black', paddingBottom: '20px', marginBottom: '30px' }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '5px' }}>
                            <span style={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-1px' }}>Anebilin</span>
                        </div>
                        <p style={{ margin: '5px 0' }}>Electronic Digital Health Record</p>
                        <p style={{ margin: 0, fontSize: '10pt', color: '#444' }}>Session data &amp; vital report</p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                        <p style={{ margin: 0 }}>Patient: {selectedPatient?.name ?? 'N/A'}</p>
                    </div>
                </div>

                <div style={{ marginBottom: '40px', background: '#f5f5f5', padding: '20px', borderRadius: '4px' }}>
                    <h2 style={{ fontSize: '14pt', borderBottom: '1px solid #ccc', paddingBottom: '5px', marginBottom: '15px' }}>PATIENT INFORMATION</h2>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                        <div><strong>Name:</strong> {selectedPatient?.name ?? 'N/A'}</div>
                        <div><strong>Patient ID:</strong> {selectedPatient?.id ?? 'N/A'}</div>
                        <div><strong>Age / Sex:</strong> {selectedPatient ? `${selectedPatient.age} / ${selectedPatient.sex}` : 'N/A'}</div>
                        <div><strong>Report Type:</strong> Session Statistics</div>
                    </div>
                </div>

                <div style={{ marginBottom: '40px' }}>
                    <h2 style={{ fontSize: '14pt', borderBottom: '1px solid #ccc', paddingBottom: '5px', marginBottom: '15px' }}>VITAL READINGS</h2>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ background: '#f0f0f0' }}>
                                <th style={{ padding: '10px', textAlign: 'left', border: '1px solid #ccc' }}>Parameter</th>
                                <th style={{ padding: '10px', textAlign: 'left', border: '1px solid #ccc' }}>Value</th>
                                <th style={{ padding: '10px', textAlign: 'left', border: '1px solid #ccc' }}>Unit</th>
                            </tr>
                        </thead>
                        <tbody>
                            {metrics.map((m, i) => (
                                <tr key={i}>
                                    <td style={{ padding: '10px', border: '1px solid #ccc' }}>{m.label}</td>
                                    <td style={{ padding: '10px', border: '1px solid #ccc', fontWeight: 700 }}>{m.value}</td>
                                    <td style={{ padding: '10px', border: '1px solid #ccc' }}>{m.unit}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div style={{ marginTop: '60px', textAlign: 'center', borderTop: '2px solid #ccc', paddingTop: '20px' }}>
                    <p style={{ fontSize: '10pt', color: '#555', margin: 0, lineHeight: 1.6 }}>
                        Screening device — not for diagnosis without professional medical evaluation.
                    </p>
                    <p style={{ fontSize: '8pt', color: '#999', marginTop: '12px' }}>
                        &copy; Anebilin
                    </p>
                </div>
            </div>
        </>
    );
};

export default Statistics;
