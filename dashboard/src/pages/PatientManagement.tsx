import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Search, UserPlus, Trash2, Edit3, Check, X, User,
    FileText, MapPin, Loader2, AlertCircle,
    Map as MapIcon, Locate,
} from 'lucide-react';
import { usePatientStore, type Patient } from '../contexts/PatientStore';
import HeatmapComponent from '../components/HeatmapComponent';
import { reverseGeocode } from '../utils/reverseGeocode';

const inp: React.CSSProperties = {
    padding: '9px 12px',
    borderRadius: 'var(--r-2)',
    border: '1px solid var(--hairline)',
    background: 'var(--surface-sunken)',
    color: 'var(--ink)',
    fontSize: 'var(--text-sm)',
    outline: 'none',
    width: '100%',
};

const Field: React.FC<{ label: string; children: React.ReactNode; style?: React.CSSProperties }> = ({ label, children, style }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, ...style }}>
        <label style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            {label}
        </label>
        {children}
    </div>
);

const initials = (name: string) =>
    name.trim().split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();

const PatientManagement: React.FC = () => {
    const { patients, recordings, addPatient, updatePatient, deletePatient, deleteRecording, loading, error } = usePatientStore();
    const [searchQuery, setSearchQuery] = useState('');
    const [showAddForm, setShowAddForm] = useState(false);
    const [showHeatmap, setShowHeatmap] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isLocatingAdd, setIsLocatingAdd] = useState(false);
    const [isLocatingEdit, setIsLocatingEdit] = useState(false);
    const [isGeocodingAdd, setIsGeocodingAdd] = useState(false);
    const [locationError, setLocationError] = useState<string | null>(null);

    const [newName, setNewName] = useState('');
    const [newAge, setNewAge] = useState('');
    const [newSex, setNewSex] = useState<'Male' | 'Female' | 'Other'>('Male');
    const [newLatitude, setNewLatitude] = useState('');
    const [newLongitude, setNewLongitude] = useState('');
    const [newState, setNewState] = useState('');
    const [newCity, setNewCity] = useState('');

    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [editAge, setEditAge] = useState('');
    const [editSex, setEditSex] = useState<'Male' | 'Female' | 'Other'>('Male');
    const [editLatitude, setEditLatitude] = useState('');
    const [editLongitude, setEditLongitude] = useState('');
    const [editState, setEditState] = useState('');
    const [editCity, setEditCity] = useState('');

    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

    const filteredPatients = useMemo(() =>
        patients.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase())),
        [patients, searchQuery]
    );

    const recordingCountMap = useMemo(() => {
        const m = new Map<string, number>();
        for (const r of recordings) m.set(r.patientId, (m.get(r.patientId) ?? 0) + 1);
        return m;
    }, [recordings]);

    const geocodeCoordinates = async (lat: number, lon: number, target: 'add' | 'edit') => {
        if (target === 'add') setIsGeocodingAdd(true);
        try {
            const result = await reverseGeocode(lat, lon);
            if (result) {
                if (target === 'add') { setNewState(result.state); setNewCity(result.city); }
                else { setEditState(result.state); setEditCity(result.city); }
            }
        } catch (err) {
            console.error('Reverse geocoding failed:', err);
        } finally {
            if (target === 'add') setIsGeocodingAdd(false);
        }
    };

    const requestAccurateLocation = async (target: 'add' | 'edit') => {
        setLocationError(null);
        if (!('geolocation' in navigator)) { setLocationError('Geolocation is not supported by this browser.'); return; }

        if (target === 'add') setIsLocatingAdd(true);
        else setIsLocatingEdit(true);

        try {
            if ('permissions' in navigator && navigator.permissions?.query) {
                const permission = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
                if (permission.state === 'denied') {
                    setLocationError('Location permission is blocked. Please enable location access in browser settings.');
                    return;
                }
            }
            const position = await new Promise<GeolocationPosition>((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
            });
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;
            if (target === 'add') {
                setNewLatitude(lat.toFixed(6)); setNewLongitude(lon.toFixed(6));
                await geocodeCoordinates(lat, lon, 'add');
            } else {
                setEditLatitude(lat.toFixed(6)); setEditLongitude(lon.toFixed(6));
                await geocodeCoordinates(lat, lon, 'edit');
            }
        } catch (err) {
            const g = err as GeolocationPositionError;
            if (g?.code === 1) setLocationError('Location permission denied. Please allow location access to auto-fill coordinates.');
            else if (g?.code === 2) setLocationError('Location unavailable. Make sure GPS/location services are enabled.');
            else if (g?.code === 3) setLocationError('Location request timed out. Try again in an open area.');
            else setLocationError('Unable to fetch location. Please enter coordinates manually.');
        } finally {
            if (target === 'add') setIsLocatingAdd(false);
            else setIsLocatingEdit(false);
        }
    };

    const handleAddPatient = async () => {
        if (!newName.trim()) return;
        setIsSubmitting(true);
        await addPatient({
            name: newName.trim(), age: parseInt(newAge) || 0, sex: newSex,
            latitude: newLatitude ? parseFloat(newLatitude) : undefined,
            longitude: newLongitude ? parseFloat(newLongitude) : undefined,
            state: newState || undefined, city: newCity || undefined,
        });
        setNewName(''); setNewAge(''); setNewSex('Male');
        setNewLatitude(''); setNewLongitude(''); setNewState(''); setNewCity('');
        setShowAddForm(false);
        setIsSubmitting(false);
    };

    const startEdit = (p: Patient) => {
        setEditingId(p.id); setEditName(p.name); setEditAge(String(p.age || ''));
        setEditSex(p.sex); setEditLatitude(p.latitude?.toString() || '');
        setEditLongitude(p.longitude?.toString() || ''); setEditState(p.state || ''); setEditCity(p.city || '');
    };

    const saveEdit = async () => {
        if (!editingId || !editName.trim()) return;
        setIsSubmitting(true);
        await updatePatient(editingId, {
            name: editName.trim(), age: parseInt(editAge) || 0, sex: editSex,
            latitude: editLatitude ? parseFloat(editLatitude) : undefined,
            longitude: editLongitude ? parseFloat(editLongitude) : undefined,
            state: editState || undefined, city: editCity || undefined,
        });
        setEditingId(null);
        setIsSubmitting(false);
    };

    const handleDelete = async (id: string) => {
        setIsSubmitting(true);
        const recs = recordings.filter(r => r.patientId === id);
        for (const r of recs) await deleteRecording(r.id);
        await deletePatient(id);
        setConfirmDeleteId(null);
        setIsSubmitting(false);
    };

    if (loading) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: 12, color: 'var(--ink-3)' }}>
                <Loader2 size={28} strokeWidth={1.5} style={{ animation: 'spin 1s linear infinite' }} />
                <span style={{ fontSize: 'var(--text-sm)' }}>Loading patient data…</span>
            </div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22 }}
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}
        >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                <div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
                        Records
                    </div>
                    <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-2xl)', fontWeight: 400, color: 'var(--ink)', lineHeight: 1.15 }}>
                        Patient Management
                    </h1>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                        onClick={() => setShowHeatmap(v => !v)}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 7,
                            padding: '9px 16px', borderRadius: 'var(--r-2)',
                            border: '1px solid var(--hairline)',
                            background: showHeatmap ? 'var(--accent-soft)' : 'var(--surface)',
                            color: showHeatmap ? 'var(--accent)' : 'var(--ink-2)',
                            fontSize: 'var(--text-sm)', fontWeight: 500, cursor: 'pointer',
                            boxShadow: 'var(--shadow-1)', transition: 'all var(--t-2) var(--ease)',
                        }}
                    >
                        <MapIcon size={15} /> {showHeatmap ? 'Hide Heatmap' : 'View Heatmap'}
                    </button>
                    <button
                        onClick={() => { setShowAddForm(v => !v); setLocationError(null); }}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 7,
                            padding: '9px 16px', borderRadius: 'var(--r-2)',
                            border: 'none', background: 'var(--accent)', color: 'var(--accent-ink)',
                            fontSize: 'var(--text-sm)', fontWeight: 500, cursor: 'pointer',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.18)',
                        }}
                    >
                        <UserPlus size={15} /> Add Patient
                    </button>
                </div>
            </div>

            {/* Error banner */}
            {error && (
                <div style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                    padding: '12px 16px', borderRadius: 'var(--r-2)',
                    background: 'var(--error-soft)', border: '1px solid rgba(179,38,30,0.22)',
                    color: 'var(--error)', fontSize: 'var(--text-sm)',
                }}>
                    <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                    <span>{error}</span>
                </div>
            )}

            {/* Heatmap panel */}
            <AnimatePresence>
                {showHeatmap && (
                    <motion.div
                        key="heatmap"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        style={{ overflow: 'hidden' }}
                    >
                        <div style={{
                            background: 'var(--surface)', border: '1px solid var(--hairline)',
                            borderRadius: 'var(--r-3)', padding: 'var(--sp-5)', boxShadow: 'var(--shadow-2)',
                        }}>
                            <HeatmapComponent />
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Add Patient form */}
            <AnimatePresence>
                {showAddForm && (
                    <motion.div
                        key="add-form"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        style={{ overflow: 'hidden' }}
                    >
                        <div style={{
                            background: 'var(--surface)', border: '1px solid var(--hairline)',
                            borderRadius: 'var(--r-4)', padding: 'var(--sp-6)',
                            boxShadow: 'var(--shadow-2)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)',
                        }}>
                            <div style={{ fontSize: 'var(--text-md)', fontWeight: 600, color: 'var(--ink)' }}>
                                New Patient
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
                                <Field label="Full name *">
                                    <input value={newName} onChange={e => setNewName(e.target.value)}
                                        placeholder="Patient's full name" disabled={isSubmitting}
                                        style={{ ...inp, opacity: isSubmitting ? 0.6 : 1 }} />
                                </Field>
                                <Field label="Age">
                                    <input value={newAge} onChange={e => setNewAge(e.target.value)}
                                        type="number" placeholder="—" disabled={isSubmitting}
                                        style={{ ...inp, opacity: isSubmitting ? 0.6 : 1 }} />
                                </Field>
                                <Field label="Sex">
                                    <select value={newSex} onChange={e => setNewSex(e.target.value as 'Male' | 'Female' | 'Other')}
                                        disabled={isSubmitting}
                                        style={{ ...inp, cursor: 'pointer', opacity: isSubmitting ? 0.6 : 1 }}>
                                        <option value="Male">Male</option>
                                        <option value="Female">Female</option>
                                        <option value="Other">Other</option>
                                    </select>
                                </Field>
                            </div>

                            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                                <Field label="Latitude" style={{ flex: 1, minWidth: 120 }}>
                                    <input value={newLatitude} onChange={e => setNewLatitude(e.target.value)}
                                        type="number" step="0.0001" placeholder="e.g. 28.7041" disabled={isSubmitting}
                                        style={{ ...inp, opacity: isSubmitting ? 0.6 : 1 }} />
                                </Field>
                                <Field label="Longitude" style={{ flex: 1, minWidth: 120 }}>
                                    <input value={newLongitude} onChange={e => setNewLongitude(e.target.value)}
                                        type="number" step="0.0001" placeholder="e.g. 77.1025" disabled={isSubmitting}
                                        style={{ ...inp, opacity: isSubmitting ? 0.6 : 1 }} />
                                </Field>
                                <button
                                    onClick={() => requestAccurateLocation('add')}
                                    disabled={isSubmitting || isLocatingAdd}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 6,
                                        padding: '9px 14px', borderRadius: 'var(--r-2)',
                                        border: '1px solid var(--hairline)',
                                        background: 'var(--surface)', color: 'var(--accent)',
                                        fontSize: 'var(--text-sm)', fontWeight: 500,
                                        cursor: (isSubmitting || isLocatingAdd) ? 'not-allowed' : 'pointer',
                                        opacity: (isSubmitting || isLocatingAdd) ? 0.65 : 1,
                                        whiteSpace: 'nowrap', flexShrink: 0,
                                    }}
                                >
                                    {isLocatingAdd
                                        ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                                        : <MapPin size={14} />}
                                    {isLocatingAdd ? 'Locating…' : 'Use Location'}
                                </button>
                                <button
                                    onClick={() => {
                                        const lat = parseFloat(newLatitude);
                                        const lon = parseFloat(newLongitude);
                                        if (!isNaN(lat) && !isNaN(lon)) geocodeCoordinates(lat, lon, 'add');
                                        else setLocationError('Please enter valid latitude and longitude first.');
                                    }}
                                    disabled={isSubmitting || isGeocodingAdd || !newLatitude || !newLongitude}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 6,
                                        padding: '9px 14px', borderRadius: 'var(--r-2)',
                                        border: '1px solid var(--hairline)',
                                        background: 'var(--surface)', color: 'var(--ink-2)',
                                        fontSize: 'var(--text-sm)', fontWeight: 500,
                                        cursor: (isSubmitting || isGeocodingAdd || !newLatitude || !newLongitude) ? 'not-allowed' : 'pointer',
                                        opacity: (isSubmitting || isGeocodingAdd) ? 0.65 : (!newLatitude || !newLongitude) ? 0.4 : 1,
                                        whiteSpace: 'nowrap', flexShrink: 0,
                                    }}
                                >
                                    {isGeocodingAdd
                                        ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                                        : <Locate size={14} />}
                                    {isGeocodingAdd ? 'Finding…' : 'Find State & City'}
                                </button>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                <Field label="State">
                                    <input value={newState} onChange={e => setNewState(e.target.value)}
                                        placeholder="e.g. Delhi" disabled={isSubmitting}
                                        style={{ ...inp, opacity: isSubmitting ? 0.6 : 1 }} />
                                </Field>
                                <Field label="City">
                                    <input value={newCity} onChange={e => setNewCity(e.target.value)}
                                        placeholder="City name" disabled={isSubmitting}
                                        style={{ ...inp, opacity: isSubmitting ? 0.6 : 1 }} />
                                </Field>
                            </div>

                            {locationError && (
                                <div style={{
                                    display: 'flex', alignItems: 'flex-start', gap: 8,
                                    padding: '10px 14px', borderRadius: 'var(--r-2)',
                                    background: 'var(--error-soft)', border: '1px solid rgba(179,38,30,0.22)',
                                    color: 'var(--error)', fontSize: 'var(--text-sm)',
                                }}>
                                    <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                                    <span>{locationError}</span>
                                </div>
                            )}

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 'var(--sp-3)', borderTop: '1px solid var(--hairline)' }}>
                                <button
                                    onClick={() => { setShowAddForm(false); setLocationError(null); }}
                                    disabled={isSubmitting}
                                    style={{
                                        padding: '9px 18px', borderRadius: 'var(--r-2)',
                                        border: '1px solid var(--hairline)',
                                        background: 'var(--surface)', color: 'var(--ink-2)',
                                        fontSize: 'var(--text-sm)', fontWeight: 500, cursor: 'pointer',
                                    }}
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleAddPatient}
                                    disabled={isSubmitting || !newName.trim()}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 6,
                                        padding: '9px 20px', borderRadius: 'var(--r-2)',
                                        border: 'none', background: 'var(--accent)', color: 'var(--accent-ink)',
                                        fontSize: 'var(--text-sm)', fontWeight: 500,
                                        cursor: (isSubmitting || !newName.trim()) ? 'not-allowed' : 'pointer',
                                        opacity: (isSubmitting || !newName.trim()) ? 0.6 : 1,
                                    }}
                                >
                                    {isSubmitting && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />}
                                    Save Patient
                                </button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Search */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 16px', borderRadius: 'var(--r-2)',
                background: 'var(--surface)', border: '1px solid var(--hairline)',
                boxShadow: 'var(--shadow-1)',
            }}>
                <Search size={16} color="var(--ink-3)" strokeWidth={1.5} />
                <input
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder={`Search ${patients.length} patient${patients.length !== 1 ? 's' : ''}…`}
                    style={{ flex: 1, border: 'none', background: 'transparent', color: 'var(--ink)', outline: 'none', fontSize: 'var(--text-base)' }}
                />
                {searchQuery && (
                    <button onClick={() => setSearchQuery('')}
                        style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', padding: 2, display: 'flex', alignItems: 'center' }}>
                        <X size={14} />
                    </button>
                )}
            </div>

            {/* Patient list */}
            {filteredPatients.length === 0 ? (
                <div style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
                    padding: '64px 24px',
                    background: 'var(--surface)', border: '1px solid var(--hairline)',
                    borderRadius: 'var(--r-4)', color: 'var(--ink-3)', textAlign: 'center',
                }}>
                    <User size={40} strokeWidth={1} style={{ opacity: 0.35 }} />
                    <div>
                        <p style={{ fontWeight: 600, color: 'var(--ink-2)', marginBottom: 4 }}>No patients found</p>
                        <p style={{ fontSize: 'var(--text-sm)' }}>
                            {searchQuery ? 'Try a different search term.' : 'Click "Add Patient" to create one.'}
                        </p>
                    </div>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {filteredPatients.map((p, index) => {
                        const recCount = recordingCountMap.get(p.id) ?? 0;
                        const isEditing = editingId === p.id;

                        return (
                            <motion.div
                                key={p.id}
                                initial={{ opacity: 0, y: 5 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: Math.min(index * 0.03, 0.18), duration: 0.18 }}
                                style={{
                                    background: 'var(--surface)',
                                    border: isEditing ? '1px solid var(--accent)' : '1px solid var(--hairline)',
                                    borderRadius: 'var(--r-3)',
                                    boxShadow: 'var(--shadow-1)',
                                    overflow: 'hidden',
                                    transition: 'border-color var(--t-2)',
                                }}
                            >
                                {isEditing ? (
                                    <div style={{ padding: 'var(--sp-5)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                                        <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--accent)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                            Editing — {p.name}
                                        </div>

                                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
                                            <Field label="Full name">
                                                <input value={editName} onChange={e => setEditName(e.target.value)}
                                                    disabled={isSubmitting}
                                                    style={{ ...inp, opacity: isSubmitting ? 0.6 : 1 }} />
                                            </Field>
                                            <Field label="Age">
                                                <input value={editAge} onChange={e => setEditAge(e.target.value)}
                                                    type="number" disabled={isSubmitting}
                                                    style={{ ...inp, opacity: isSubmitting ? 0.6 : 1 }} />
                                            </Field>
                                            <Field label="Sex">
                                                <select value={editSex} onChange={e => setEditSex(e.target.value as 'Male' | 'Female' | 'Other')}
                                                    disabled={isSubmitting}
                                                    style={{ ...inp, cursor: 'pointer', opacity: isSubmitting ? 0.6 : 1 }}>
                                                    <option value="Male">Male</option>
                                                    <option value="Female">Female</option>
                                                    <option value="Other">Other</option>
                                                </select>
                                            </Field>
                                        </div>

                                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                                            <Field label="Latitude" style={{ flex: 1, minWidth: 110 }}>
                                                <input value={editLatitude} onChange={e => setEditLatitude(e.target.value)}
                                                    type="number" step="0.0001" placeholder="Latitude" disabled={isSubmitting}
                                                    style={{ ...inp, opacity: isSubmitting ? 0.6 : 1 }} />
                                            </Field>
                                            <Field label="Longitude" style={{ flex: 1, minWidth: 110 }}>
                                                <input value={editLongitude} onChange={e => setEditLongitude(e.target.value)}
                                                    type="number" step="0.0001" placeholder="Longitude" disabled={isSubmitting}
                                                    style={{ ...inp, opacity: isSubmitting ? 0.6 : 1 }} />
                                            </Field>
                                            <Field label="State" style={{ flex: 1, minWidth: 100 }}>
                                                <input value={editState} onChange={e => setEditState(e.target.value)}
                                                    placeholder="State" disabled={isSubmitting}
                                                    style={{ ...inp, opacity: isSubmitting ? 0.6 : 1 }} />
                                            </Field>
                                            <Field label="City" style={{ flex: 1, minWidth: 100 }}>
                                                <input value={editCity} onChange={e => setEditCity(e.target.value)}
                                                    placeholder="City" disabled={isSubmitting}
                                                    style={{ ...inp, opacity: isSubmitting ? 0.6 : 1 }} />
                                            </Field>
                                            <button
                                                onClick={() => requestAccurateLocation('edit')}
                                                disabled={isSubmitting || isLocatingEdit}
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: 6,
                                                    padding: '9px 12px', borderRadius: 'var(--r-2)',
                                                    border: '1px solid var(--hairline)',
                                                    background: 'var(--surface)', color: 'var(--accent)',
                                                    fontSize: 'var(--text-xs)', fontWeight: 500,
                                                    cursor: (isSubmitting || isLocatingEdit) ? 'not-allowed' : 'pointer',
                                                    opacity: (isSubmitting || isLocatingEdit) ? 0.65 : 1,
                                                    whiteSpace: 'nowrap', flexShrink: 0,
                                                }}
                                            >
                                                {isLocatingEdit
                                                    ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                                                    : <MapPin size={13} />}
                                                {isLocatingEdit ? 'Locating…' : 'Use Location'}
                                            </button>
                                        </div>

                                        {locationError && (
                                            <div style={{
                                                display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 12px',
                                                borderRadius: 'var(--r-2)', background: 'var(--error-soft)',
                                                border: '1px solid rgba(179,38,30,0.22)', color: 'var(--error)',
                                                fontSize: 'var(--text-xs)',
                                            }}>
                                                <AlertCircle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                                                <span>{locationError}</span>
                                            </div>
                                        )}

                                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 'var(--sp-3)', borderTop: '1px solid var(--hairline)' }}>
                                            <button onClick={() => { setEditingId(null); setLocationError(null); }} disabled={isSubmitting}
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: 5, padding: '8px 14px',
                                                    borderRadius: 'var(--r-2)', border: '1px solid var(--hairline)',
                                                    background: 'var(--surface)', color: 'var(--ink-2)',
                                                    fontSize: 'var(--text-sm)', fontWeight: 500, cursor: 'pointer',
                                                }}>
                                                <X size={14} /> Cancel
                                            </button>
                                            <button onClick={saveEdit} disabled={isSubmitting || !editName.trim()}
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: 5, padding: '8px 16px',
                                                    borderRadius: 'var(--r-2)', border: 'none',
                                                    background: 'var(--accent)', color: 'var(--accent-ink)',
                                                    fontSize: 'var(--text-sm)', fontWeight: 500,
                                                    cursor: (isSubmitting || !editName.trim()) ? 'not-allowed' : 'pointer',
                                                    opacity: (isSubmitting || !editName.trim()) ? 0.6 : 1,
                                                }}>
                                                {isSubmitting
                                                    ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                                                    : <Check size={14} />}
                                                Save Changes
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px var(--sp-5)' }}>
                                        <div style={{
                                            width: 40, height: 40, borderRadius: '50%',
                                            background: 'var(--accent-soft)',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--accent)',
                                            flexShrink: 0, userSelect: 'none',
                                        }}>
                                            {initials(p.name)}
                                        </div>

                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontWeight: 600, fontSize: 'var(--text-md)', color: 'var(--ink)', marginBottom: 3 }}>
                                                {p.name}
                                            </div>
                                            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', color: 'var(--ink-3)', fontSize: 'var(--text-xs)' }}>
                                                {p.age > 0 && (
                                                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                        <User size={11} strokeWidth={1.5} />
                                                        {p.age}y / {p.sex}
                                                    </span>
                                                )}
                                                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                    <FileText size={11} strokeWidth={1.5} />
                                                    {recCount} recording{recCount !== 1 ? 's' : ''}
                                                </span>
                                                {(p.state || p.city) && (
                                                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                        <MapPin size={11} strokeWidth={1.5} />
                                                        {[p.city, p.state].filter(Boolean).join(', ')}
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                            <button
                                                onClick={() => startEdit(p)}
                                                disabled={isSubmitting}
                                                title="Edit patient"
                                                style={{
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    width: 34, height: 34, borderRadius: 'var(--r-2)',
                                                    border: '1px solid var(--hairline)',
                                                    background: 'var(--surface)', color: 'var(--ink-3)',
                                                    cursor: 'pointer', transition: 'all var(--t-1)',
                                                    opacity: isSubmitting ? 0.5 : 1,
                                                }}
                                            >
                                                <Edit3 size={14} />
                                            </button>
                                            {confirmDeleteId === p.id ? (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--error)', fontWeight: 500, marginRight: 2 }}>Delete?</span>
                                                    <button onClick={() => handleDelete(p.id)} disabled={isSubmitting}
                                                        style={{
                                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                            width: 34, height: 34, borderRadius: 'var(--r-2)',
                                                            border: '1px solid rgba(179,38,30,0.3)',
                                                            background: 'var(--error-soft)', color: 'var(--error)',
                                                            cursor: 'pointer', opacity: isSubmitting ? 0.5 : 1,
                                                        }}>
                                                        <Check size={14} />
                                                    </button>
                                                    <button onClick={() => setConfirmDeleteId(null)} disabled={isSubmitting}
                                                        style={{
                                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                            width: 34, height: 34, borderRadius: 'var(--r-2)',
                                                            border: '1px solid var(--hairline)',
                                                            background: 'var(--surface)', color: 'var(--ink-3)',
                                                            cursor: 'pointer',
                                                        }}>
                                                        <X size={14} />
                                                    </button>
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => setConfirmDeleteId(p.id)}
                                                    disabled={isSubmitting}
                                                    title="Delete patient"
                                                    style={{
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        width: 34, height: 34, borderRadius: 'var(--r-2)',
                                                        border: '1px solid var(--hairline)',
                                                        background: 'var(--surface)', color: 'var(--ink-4)',
                                                        cursor: 'pointer', transition: 'all var(--t-1)',
                                                        opacity: isSubmitting ? 0.5 : 1,
                                                    }}
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </motion.div>
                        );
                    })}
                </div>
            )}
        </motion.div>
    );
};

export default PatientManagement;
