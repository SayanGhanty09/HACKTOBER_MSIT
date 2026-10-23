import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
    Play,
    History as HistoryIcon,
    Cpu,
    CheckCircle2,
    AlertCircle,
    UserPlus,
    X,
    MapPin,
    Locate,
    ArrowUpRight,
    ChevronRight,
    Activity,
    Users as UsersIcon,
    Bluetooth,
    BluetoothOff,
    Map as MapIcon,
} from 'lucide-react';
import { useBLE, BLEStatus } from '../contexts/BLEContext';
import { usePatientStore } from '../contexts/PatientStore';
import type { Patient } from '../contexts/PatientStore';
import { useAuth } from '../contexts/AuthContext';
import { reverseGeocode } from '../utils/reverseGeocode';
import { Card, Button, Pill, SectionHeader, IconButton } from '../components/ui';

const Dashboard: React.FC = () => {
    const navigate = useNavigate();
    const { status, device } = useBLE();
    const { patients, recordings, addPatient, setActivePatient, activePatientName, error } = usePatientStore();
    const { doctor } = useAuth();

    const isDeviceConnected =
        status !== BLEStatus.DISCONNECTED && status !== BLEStatus.CONNECTING && device !== null;

    // Patient picker state
    const [showPicker, setShowPicker] = useState(false);
    const [newName, setNewName] = useState('');
    const [newAge, setNewAge] = useState('');
    const [newSex, setNewSex] = useState<'Male' | 'Female' | 'Other'>('Male');
    const [newLatitude, setNewLatitude] = useState('');
    const [newLongitude, setNewLongitude] = useState('');
    const [newState, setNewState] = useState('');
    const [newCity, setNewCity] = useState('');
    const [isLocating, setIsLocating] = useState(false);
    const [isGeocoding, setIsGeocoding] = useState(false);
    const [locationError, setLocationError] = useState<string | null>(null);
    const [pickerError, setPickerError] = useState<string | null>(null);

    const handleStartRecording = () => {
        setPickerError(null);
        setLocationError(null);
        setNewLatitude('');
        setNewLongitude('');
        setNewState('');
        setNewCity('');
        setShowPicker(true);
    };

    const launchWithPatient = (patient: Patient) => {
        setActivePatient(patient.id, patient.name);
        setShowPicker(false);
        navigate('/live', { state: { autoStartPatientId: patient.id, autoStartPatientName: patient.name } });
    };

    const requestAccurateLocation = async () => {
        setLocationError(null);
        if (!('geolocation' in navigator)) {
            setLocationError('Geolocation is not supported by this browser.');
            return;
        }
        setIsLocating(true);
        try {
            if ('permissions' in navigator && navigator.permissions?.query) {
                const permission = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
                if (permission.state === 'denied') {
                    setLocationError('Location permission is blocked. Please enable location access in browser settings.');
                    return;
                }
            }
            const position = await new Promise<GeolocationPosition>((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: true,
                    maximumAge: 0,
                    timeout: 15000,
                });
            });
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;
            setNewLatitude(lat.toFixed(6));
            setNewLongitude(lon.toFixed(6));
            await geocodeCoordinates(lat, lon);
        } catch (err) {
            const geoError = err as GeolocationPositionError;
            if (geoError?.code === 1) setLocationError('Location permission denied. Please allow location access.');
            else if (geoError?.code === 2) setLocationError('Location unavailable. Make sure GPS is enabled.');
            else if (geoError?.code === 3) setLocationError('Location request timed out. Try again.');
            else setLocationError('Unable to fetch location. Please enter manually.');
        } finally {
            setIsLocating(false);
        }
    };

    const geocodeCoordinates = async (lat: number, lon: number) => {
        setIsGeocoding(true);
        try {
            const result = await reverseGeocode(lat, lon);
            if (result) {
                setNewState(result.state);
                setNewCity(result.city);
            }
        } catch (err) {
            console.error('Reverse geocoding failed:', err);
        } finally {
            setIsGeocoding(false);
        }
    };

    const handleAddAndLaunch = async () => {
        if (!newName.trim() || !newAge.trim()) return;
        const p = await addPatient({
            name: newName.trim(),
            age: parseInt(newAge),
            sex: newSex,
            latitude: newLatitude ? parseFloat(newLatitude) : undefined,
            longitude: newLongitude ? parseFloat(newLongitude) : undefined,
            state: newState || undefined,
            city: newCity || undefined,
        });
        if (!p) {
            setPickerError(error || 'Could not create patient. Please try again.');
            return;
        }
        setNewName('');
        setNewAge('');
        setNewSex('Male');
        setNewLatitude('');
        setNewLongitude('');
        setNewState('');
        setNewCity('');
        setLocationError(null);
        setPickerError(null);
        launchWithPatient(p);
    };

    // ---------- derived ----------
    const recentActivity = recordings.slice(0, 6).map((r) => ({
        id: r.id,
        patient: r.patientName,
        duration: r.biomarkers.hr ? 'Completed' : 'Partial',
        ok: !!r.biomarkers.hr,
    }));

    const sidebarLinks = [
        { icon: Activity, label: 'Live recording',     to: '/live' },
        { icon: UsersIcon, label: 'Patients',          to: '/patients' },
        { icon: MapIcon,  label: 'Regional analytics', to: '/regions' },
        { icon: HistoryIcon, label: 'Statistics',      to: '/stats' },
        { icon: Cpu,      label: 'Device console',     to: '/console' },
    ];

    const stats: Array<{ label: string; value: React.ReactNode; mono?: boolean; tone?: 'success' | 'muted' | undefined }> = [
        { label: 'Patients on file', value: patients.length },
        { label: 'Total sessions',   value: recordings.length },
        { label: 'Completed',        value: recordings.filter((r) => !!r.biomarkers.hr).length },
    ];

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-8)' }}
        >
            {/* ============================ HERO ============================ */}
            <header
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1.25fr) minmax(360px, 1fr)',
                    gap: 'var(--sp-8)',
                    alignItems: 'stretch',
                }}
            >
                {/* Greeting */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)', justifyContent: 'center' }}>
                    <span
                        style={{
                            fontSize: 'var(--text-xs)',
                            color: 'var(--ink-3)',
                            textTransform: 'uppercase',
                            letterSpacing: '0.18em',
                            fontWeight: 500,
                        }}
                    >
                        Dashboard
                    </span>
                    <h1
                        style={{
                            fontFamily: 'var(--font-display)',
                            fontSize: 'clamp(40px, 5vw, 64px)',
                            lineHeight: 1.02,
                            letterSpacing: '-0.025em',
                            color: 'var(--ink)',
                            fontWeight: 400,
                        }}
                    >
                        Welcome back,{' '}
                        <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>
                            {doctor?.name?.split(' ')[0] ?? 'Doctor'}
                        </em>
                        .
                    </h1>
                    <p
                        style={{
                            color: 'var(--ink-3)',
                            fontSize: 'var(--text-md)',
                            maxWidth: '52ch',
                            lineHeight: 1.55,
                        }}
                    >
                        {patients.length === 0
                            ? 'No patients on file yet. Register one to start your first recording session.'
                            : `${patients.length} patient${patients.length === 1 ? '' : 's'} on file. ${recordings.length} session${recordings.length === 1 ? '' : 's'} recorded.`}
                    </p>
                </div>

                {/* Device console panel — the priority surface */}
                <Card
                    pad="0"
                    style={{
                        background: 'var(--ink)',
                        color: 'var(--paper)',
                        border: '1px solid var(--ink)',
                        boxShadow: 'var(--shadow-3)',
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden',
                    }}
                >
                    <div
                        style={{
                            padding: 'var(--sp-5) var(--sp-6)',
                            borderBottom: '1px solid color-mix(in oklab, var(--paper) 14%, transparent)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                        }}
                    >
                        <span
                            style={{
                                fontSize: 'var(--text-xs)',
                                textTransform: 'uppercase',
                                letterSpacing: '0.18em',
                                color: 'color-mix(in oklab, var(--paper) 60%, transparent)',
                                fontWeight: 500,
                            }}
                        >
                            Device console
                        </span>
                        <span
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                                padding: '3px 9px',
                                borderRadius: 'var(--r-pill)',
                                fontSize: 'var(--text-xs)',
                                fontWeight: 500,
                                background: isDeviceConnected
                                    ? 'color-mix(in oklab, #6ee7b7 20%, transparent)'
                                    : 'color-mix(in oklab, #fda4af 14%, transparent)',
                                color: isDeviceConnected ? '#86efac' : '#fda4af',
                                border: `1px solid ${isDeviceConnected ? 'color-mix(in oklab, #6ee7b7 32%, transparent)' : 'color-mix(in oklab, #fda4af 32%, transparent)'}`,
                            }}
                        >
                            <span
                                style={{
                                    width: 6,
                                    height: 6,
                                    borderRadius: '50%',
                                    background: isDeviceConnected ? '#86efac' : '#fda4af',
                                }}
                            />
                            {isDeviceConnected ? 'Online' : 'Offline'}
                        </span>
                    </div>

                    <div
                        style={{
                            padding: 'var(--sp-6)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 'var(--sp-5)',
                            flex: 1,
                        }}
                    >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <span
                                style={{
                                    fontSize: 'var(--text-xs)',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.14em',
                                    color: 'color-mix(in oklab, var(--paper) 50%, transparent)',
                                    fontWeight: 500,
                                }}
                            >
                                Active patient
                            </span>
                            <span
                                style={{
                                    fontFamily: 'var(--font-display)',
                                    fontSize: 'var(--text-2xl)',
                                    letterSpacing: '-0.018em',
                                    color: activePatientName ? 'var(--paper)' : '#fda4af',
                                    lineHeight: 1.15,
                                }}
                            >
                                {activePatientName || 'None selected'}
                            </span>
                        </div>

                        <div
                            style={{
                                display: 'flex',
                                gap: 18,
                                paddingTop: 12,
                                borderTop: '1px solid color-mix(in oklab, var(--paper) 10%, transparent)',
                            }}
                        >
                            <Telemetry label="Status" value={isDeviceConnected ? 'Idle / Ready' : 'Disconnected'} />
                            <Telemetry label="Sessions" value={String(recordings.length)} mono />
                        </div>

                        <div
                            style={{
                                marginTop: 'auto',
                                display: 'flex',
                                gap: 'var(--sp-3)',
                                paddingTop: 'var(--sp-3)',
                            }}
                        >
                            <button
                                onClick={handleStartRecording}
                                style={{
                                    flex: 1,
                                    padding: '14px 18px',
                                    background: 'var(--paper)',
                                    color: 'var(--ink)',
                                    border: 'none',
                                    borderRadius: 'var(--r-2)',
                                    cursor: 'pointer',
                                    fontWeight: 600,
                                    fontSize: 'var(--text-md)',
                                    letterSpacing: '-0.01em',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: 10,
                                    transition: 'background-color var(--t-2) var(--ease), transform var(--t-1) var(--ease)',
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = '#fff')}
                                onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--paper)')}
                            >
                                <Play size={16} strokeWidth={2} />
                                Start recording
                            </button>
                            <button
                                onClick={() => navigate('/console')}
                                aria-label="Open device console"
                                title="Device console"
                                style={{
                                    width: 48,
                                    padding: 0,
                                    background: 'transparent',
                                    color: 'var(--paper)',
                                    border: '1px solid color-mix(in oklab, var(--paper) 24%, transparent)',
                                    borderRadius: 'var(--r-2)',
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    transition: 'background-color var(--t-2) var(--ease)',
                                }}
                                onMouseEnter={(e) =>
                                    (e.currentTarget.style.background =
                                        'color-mix(in oklab, var(--paper) 8%, transparent)')
                                }
                                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                            >
                                <Cpu size={16} strokeWidth={1.6} />
                            </button>
                        </div>
                    </div>
                </Card>
            </header>

            {/* ============================ STATS STRIP ============================ */}
            <Card pad="0">
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: `repeat(${stats.length}, 1fr)`,
                    }}
                >
                    {stats.map((s, i) => (
                        <div
                            key={s.label}
                            style={{
                                padding: 'var(--sp-5) var(--sp-6)',
                                borderLeft: i === 0 ? 'none' : '1px solid var(--hairline)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 8,
                                minHeight: 96,
                                justifyContent: 'center',
                            }}
                        >
                            <span
                                style={{
                                    fontSize: 'var(--text-xs)',
                                    color: 'var(--ink-3)',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.14em',
                                    fontWeight: 500,
                                }}
                            >
                                {s.label}
                            </span>
                            <span
                                style={{
                                    fontFamily: s.mono === false ? 'var(--font-sans)' : 'var(--font-mono)',
                                    fontSize: 'var(--text-3xl)',
                                    fontWeight: 500,
                                    letterSpacing: '-0.025em',
                                    lineHeight: 1,
                                    color: s.tone === 'muted' ? 'var(--ink-3)' : 'var(--ink)',
                                }}
                            >
                                {s.value}
                            </span>
                        </div>
                    ))}
                </div>
            </Card>

            {/* ============================ MAIN GRID ============================ */}
            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)',
                    gap: 'var(--sp-6)',
                    alignItems: 'start',
                }}
            >
                {/* Recordings */}
                <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
                    <SectionHeader
                        eyebrow="History"
                        title="Recent recordings"
                        actions={
                            <Button
                                variant="ghost"
                                size="sm"
                                trailingIcon={<ChevronRight size={14} />}
                                onClick={() => navigate('/stats')}
                            >
                                View all
                            </Button>
                        }
                    />
                    <Card pad="0">
                        {recentActivity.length === 0 ? (
                            <EmptyRecordings />
                        ) : (
                            <ul style={{ listStyle: 'none' }}>
                                {recentActivity.map((log, i) => (
                                    <li
                                        key={log.id}
                                        style={{
                                            display: 'grid',
                                            gridTemplateColumns: '28px minmax(0, 1fr) auto auto',
                                            alignItems: 'center',
                                            gap: 'var(--sp-4)',
                                            padding: 'var(--sp-4) var(--sp-5)',
                                            borderTop: i === 0 ? 'none' : '1px solid var(--hairline)',
                                            transition: 'background-color var(--t-2) var(--ease)',
                                            cursor: 'pointer',
                                        }}
                                        onClick={() => navigate('/stats')}
                                        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-tint)')}
                                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                                    >
                                        <div
                                            style={{
                                                width: 24,
                                                height: 24,
                                                borderRadius: '50%',
                                                background: log.ok ? 'var(--success-soft)' : 'var(--warn-soft)',
                                                color: log.ok ? 'var(--success)' : 'var(--warn)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                            }}
                                        >
                                            {log.ok ? (
                                                <CheckCircle2 size={14} strokeWidth={1.8} />
                                            ) : (
                                                <AlertCircle size={14} strokeWidth={1.8} />
                                            )}
                                        </div>
                                        <div
                                            style={{
                                                fontWeight: 600,
                                                fontSize: 'var(--text-md)',
                                                color: 'var(--ink)',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                                letterSpacing: '-0.005em',
                                            }}
                                        >
                                            {log.patient}
                                        </div>
                                        <Pill tone={log.ok ? 'success' : 'warn'} size="sm">
                                            {log.duration}
                                        </Pill>
                                        <ChevronRight size={14} strokeWidth={1.6} color="var(--ink-4)" />
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Card>
                </section>

                {/* Right rail */}
                <aside style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)', position: 'sticky', top: 88 }}>
                    {/* Workspace */}
                    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                        <SectionEyebrow>Workspace</SectionEyebrow>
                        <Card pad="0">
                            <ul style={{ listStyle: 'none' }}>
                                {sidebarLinks.map((l, i) => (
                                    <li
                                        key={l.to}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 12,
                                            padding: '12px 16px',
                                            borderTop: i === 0 ? 'none' : '1px solid var(--hairline)',
                                            cursor: 'pointer',
                                            color: 'var(--ink-2)',
                                            transition: 'background-color var(--t-2) var(--ease), color var(--t-2) var(--ease)',
                                        }}
                                        onClick={() => navigate(l.to)}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.background = 'var(--surface-tint)';
                                            e.currentTarget.style.color = 'var(--ink)';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.background = 'transparent';
                                            e.currentTarget.style.color = 'var(--ink-2)';
                                        }}
                                    >
                                        <l.icon size={16} strokeWidth={1.6} color="var(--ink-3)" />
                                        <span style={{ flex: 1, fontWeight: 500, fontSize: 'var(--text-base)' }}>{l.label}</span>
                                        <ArrowUpRight size={14} strokeWidth={1.6} color="var(--ink-4)" />
                                    </li>
                                ))}
                            </ul>
                        </Card>
                    </section>

                    {/* Device status detail */}
                    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                        <SectionEyebrow>Device</SectionEyebrow>
                        <Card>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <div
                                    style={{
                                        width: 38,
                                        height: 38,
                                        borderRadius: 'var(--r-2)',
                                        background: isDeviceConnected ? 'var(--success-soft)' : 'var(--surface-tint)',
                                        color: isDeviceConnected ? 'var(--success)' : 'var(--ink-3)',
                                        border: '1px solid var(--hairline)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}
                                >
                                    {isDeviceConnected ? (
                                        <Bluetooth size={16} strokeWidth={1.8} />
                                    ) : (
                                        <BluetoothOff size={16} strokeWidth={1.8} />
                                    )}
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                    <span
                                        style={{
                                            fontWeight: 600,
                                            color: 'var(--ink)',
                                            fontSize: 'var(--text-md)',
                                            letterSpacing: '-0.005em',
                                        }}
                                    >
                                        {isDeviceConnected ? 'Anebilin ready' : 'No device connected'}
                                    </span>
                                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-3)' }}>
                                        {isDeviceConnected
                                            ? 'Idle — awaiting a scan command'
                                            : 'Use the connect button in the top bar'}
                                    </span>
                                </div>
                            </div>
                        </Card>
                    </section>
                </aside>
            </div>

            {/* ============================ PATIENT PICKER ============================ */}
            {showPicker && (
                <div
                    style={{
                        position: 'fixed',
                        inset: 0,
                        zIndex: 9999,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'rgba(11, 11, 12, 0.42)',
                        backdropFilter: 'blur(2px)',
                        padding: 'var(--sp-4)',
                    }}
                    onClick={() => setShowPicker(false)}
                >
                    <motion.div
                        initial={{ opacity: 0, y: 8, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            width: '100%',
                            maxWidth: 560,
                            maxHeight: '88vh',
                            background: 'var(--surface)',
                            border: '1px solid var(--hairline)',
                            borderRadius: 'var(--r-3)',
                            boxShadow: 'var(--shadow-pop)',
                            display: 'flex',
                            flexDirection: 'column',
                        }}
                    >
                        <div
                            style={{
                                padding: 'var(--sp-5) var(--sp-6)',
                                borderBottom: '1px solid var(--hairline)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                            }}
                        >
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <span
                                    style={{
                                        fontSize: 'var(--text-xs)',
                                        color: 'var(--ink-3)',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.14em',
                                        fontWeight: 500,
                                    }}
                                >
                                    Select patient
                                </span>
                                <h3
                                    style={{
                                        fontFamily: 'var(--font-display)',
                                        fontSize: 'var(--text-xl)',
                                        letterSpacing: '-0.02em',
                                        fontWeight: 400,
                                    }}
                                >
                                    Who are we recording?
                                </h3>
                            </div>
                            <IconButton onClick={() => setShowPicker(false)} aria-label="Close">
                                <X size={16} strokeWidth={1.6} />
                            </IconButton>
                        </div>

                        <div
                            style={{
                                padding: 'var(--sp-5) var(--sp-6)',
                                overflowY: 'auto',
                                flex: 1,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 'var(--sp-5)',
                            }}
                        >
                            {patients.length > 0 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                                    <SectionEyebrow>Existing patients</SectionEyebrow>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                        {patients.map((p) => (
                                            <button
                                                key={p.id}
                                                onClick={() => launchWithPatient(p)}
                                                style={{
                                                    width: '100%',
                                                    padding: '12px 16px',
                                                    borderRadius: 'var(--r-2)',
                                                    cursor: 'pointer',
                                                    background: 'var(--surface)',
                                                    border: '1px solid var(--hairline)',
                                                    color: 'var(--ink)',
                                                    fontFamily: 'inherit',
                                                    textAlign: 'left',
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'center',
                                                    transition: 'background-color var(--t-2) var(--ease), border-color var(--t-2) var(--ease)',
                                                }}
                                                onMouseEnter={(e) => {
                                                    e.currentTarget.style.background = 'var(--accent-soft)';
                                                    e.currentTarget.style.borderColor = 'var(--accent-soft-2)';
                                                }}
                                                onMouseLeave={(e) => {
                                                    e.currentTarget.style.background = 'var(--surface)';
                                                    e.currentTarget.style.borderColor = 'var(--hairline)';
                                                }}
                                            >
                                                <span style={{ fontWeight: 600 }}>{p.name}</span>
                                                <span className="num" style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-3)' }}>
                                                    {p.age > 0 ? `${p.age}y · ${p.sex}` : ''}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '6px 0 2px' }}>
                                        <div style={{ flex: 1, height: 1, background: 'var(--hairline)' }} />
                                        <span
                                            style={{
                                                fontSize: 'var(--text-xs)',
                                                color: 'var(--ink-3)',
                                                textTransform: 'uppercase',
                                                letterSpacing: '0.14em',
                                                fontWeight: 500,
                                            }}
                                        >
                                            Or add new
                                        </span>
                                        <div style={{ flex: 1, height: 1, background: 'var(--hairline)' }} />
                                    </div>
                                </div>
                            )}

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Full name" />
                                <div style={{ display: 'flex', gap: 10 }}>
                                    <input value={newAge} onChange={(e) => setNewAge(e.target.value)} placeholder="Age" type="number" />
                                    <select value={newSex} onChange={(e) => setNewSex(e.target.value as 'Male' | 'Female' | 'Other')}>
                                        <option value="Male">Male</option>
                                        <option value="Female">Female</option>
                                        <option value="Other">Other</option>
                                    </select>
                                </div>

                                <div style={{ display: 'flex', gap: 10 }}>
                                    <input value={newLatitude} onChange={(e) => setNewLatitude(e.target.value)} type="number" step="0.0001" placeholder="Latitude" />
                                    <input value={newLongitude} onChange={(e) => setNewLongitude(e.target.value)} type="number" step="0.0001" placeholder="Longitude" />
                                </div>

                                <div style={{ display: 'flex', gap: 8 }}>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={requestAccurateLocation}
                                        loading={isLocating}
                                        leadingIcon={!isLocating ? <MapPin size={14} /> : undefined}
                                    >
                                        {isLocating ? 'Locating' : 'Use current location'}
                                    </Button>
                                    {newLatitude && newLongitude && (
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            onClick={async () => {
                                                const lat = parseFloat(newLatitude);
                                                const lon = parseFloat(newLongitude);
                                                if (!isNaN(lat) && !isNaN(lon)) await geocodeCoordinates(lat, lon);
                                            }}
                                            loading={isGeocoding}
                                            leadingIcon={!isGeocoding ? <Locate size={14} /> : undefined}
                                        >
                                            {isGeocoding ? 'Finding' : 'Find state & city'}
                                        </Button>
                                    )}
                                </div>

                                {(newState || newCity) && (
                                    <div style={{ display: 'flex', gap: 10 }}>
                                        <input value={newState} onChange={(e) => setNewState(e.target.value)} placeholder="State" />
                                        <input value={newCity} onChange={(e) => setNewCity(e.target.value)} placeholder="City" />
                                    </div>
                                )}

                                {locationError && (
                                    <div
                                        style={{
                                            padding: '10px 14px',
                                            borderRadius: 'var(--r-2)',
                                            background: 'var(--error-soft)',
                                            border: '1px solid color-mix(in oklab, var(--error) 22%, transparent)',
                                            color: 'var(--error)',
                                            fontSize: 'var(--text-sm)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 8,
                                        }}
                                    >
                                        <AlertCircle size={14} strokeWidth={1.8} />
                                        <span>{locationError}</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div
                            style={{
                                padding: 'var(--sp-4) var(--sp-6)',
                                borderTop: '1px solid var(--hairline)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 'var(--sp-3)',
                                background: 'var(--surface-tint)',
                            }}
                        >
                            {pickerError && (
                                <div
                                    style={{
                                        padding: '10px 14px',
                                        borderRadius: 'var(--r-2)',
                                        border: '1px solid color-mix(in oklab, var(--error) 22%, transparent)',
                                        background: 'var(--error-soft)',
                                        color: 'var(--error)',
                                        fontSize: 'var(--text-sm)',
                                    }}
                                >
                                    {pickerError}
                                </div>
                            )}
                            <div style={{ display: 'flex', gap: 'var(--sp-3)' }}>
                                <Button variant="ghost" onClick={() => setShowPicker(false)} block>
                                    Cancel
                                </Button>
                                <Button
                                    variant="primary"
                                    onClick={handleAddAndLaunch}
                                    disabled={!newName.trim() || !newAge.trim()}
                                    leadingIcon={!(!newName.trim() || !newAge.trim()) && <UserPlus size={15} />}
                                    block
                                >
                                    Add &amp; start
                                </Button>
                            </div>
                        </div>
                    </motion.div>
                </div>
            )}
        </motion.div>
    );
};

// ---------- small in-file helpers ----------

const SectionEyebrow: React.FC<React.PropsWithChildren> = ({ children }) => (
    <span
        style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--ink-3)',
            textTransform: 'uppercase',
            letterSpacing: '0.14em',
            fontWeight: 500,
        }}
    >
        {children}
    </span>
);

const Telemetry: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span
            style={{
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: '0.14em',
                color: 'color-mix(in oklab, var(--paper) 48%, transparent)',
                fontWeight: 500,
            }}
        >
            {label}
        </span>
        <span
            style={{
                fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
                fontWeight: 500,
                fontSize: 'var(--text-md)',
                color: 'var(--paper)',
                letterSpacing: '-0.005em',
            }}
        >
            {value}
        </span>
    </div>
);

const EmptyRecordings: React.FC = () => (
    <div
        style={{
            padding: 'var(--sp-9) var(--sp-6)',
            textAlign: 'center',
            color: 'var(--ink-3)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            alignItems: 'center',
        }}
    >
        <div
            style={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                background: 'var(--surface-tint)',
                border: '1px solid var(--hairline)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--ink-3)',
            }}
        >
            <HistoryIcon size={16} strokeWidth={1.6} />
        </div>
        <div style={{ fontSize: 'var(--text-md)', color: 'var(--ink-2)' }}>No recordings yet.</div>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-4)' }}>
            Sessions you save will appear here.
        </div>
    </div>
);

export default Dashboard;
