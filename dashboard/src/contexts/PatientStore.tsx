import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { supabase } from '../services/supabaseClient';
import { savePatient as saveLocalPatient, getPatients as getLocalPatients } from '../utils/patientStore';

// ========================================================================
// Patient & Recording History — now persisted in Supabase
// ========================================================================

export interface Patient {
    id: string;
    userId: string;
    name: string;
    age: number;
    sex: 'Male' | 'Female' | 'Other';
    latitude?: number;
    longitude?: number;
    state?: string;
    city?: string;
    createdAt: string;
}

export interface RecordingEntry {
    id: string;
    patientId: string;
    userId: string;
    patientName: string;
    timestamp: string;
    biomarkers: Record<string, any>;
}

interface DbPatientRow {
    id: string;
    userid?: string;
    userId?: string;
    name: string;
    age: number;
    sex: 'Male' | 'Female' | 'Other';
    latitude?: number;
    longitude?: number;
    state?: string;
    city?: string;
    createdat?: string;
    createdAt?: string;
}

interface DbRecordingRow {
    id: string;
    patientid?: string;
    patientId?: string;
    userid?: string;
    userId?: string;
    patientname?: string;
    patientName?: string;
    timestamp: string;
    biomarkers: Record<string, any>;
}

interface PatientStoreContextType {
    patients: Patient[];
    recordings: RecordingEntry[];
    loading: boolean;
    error: string | null;
    activePatientId: string | null;
    activePatientName: string | null;
    setActivePatient: (id: string | null, name: string | null) => void;
    addPatient: (p: Omit<Patient, 'id' | 'userId' | 'createdAt'>) => Promise<Patient | null>;
    updatePatient: (id: string, data: Partial<Omit<Patient, 'id' | 'userId' | 'createdAt'>>) => Promise<void>;
    saveRecording: (patientId: string, biomarkers: Record<string, any>) => Promise<RecordingEntry | null>;
    updateRecording: (id: string, biomarkers: Record<string, any>) => Promise<void>;
    getRecordingsForPatient: (patientId: string) => RecordingEntry[];
    deletePatient: (id: string) => Promise<void>;
    deleteRecording: (id: string) => Promise<void>;
    getHeatmapData: () => Array<{ latitude: number; longitude: number; intensity: number }>;
}

const PatientStoreContext = createContext<PatientStoreContextType | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export const usePatientStore = () => {
    const ctx = useContext(PatientStoreContext);
    if (!ctx) throw new Error('usePatientStore must be inside PatientStoreProvider');
    return ctx;
};

export const PatientStoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [patients, setPatients] = useState<Patient[]>([]);
    const [recordings, setRecordings] = useState<RecordingEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [activePatientId, setActivePatientId] = useState<string | null>(null);
    const [activePatientName, setActivePatientName] = useState<string | null>(null);

    const setActivePatient = useCallback((id: string | null, name: string | null) => {
        setActivePatientId(id);
        setActivePatientName(name);
    }, []);

    const mapPatientRow = (row: DbPatientRow): Patient => ({
        id: row.id,
        userId: row.userid ?? row.userId ?? '',
        name: row.name,
        age: row.age,
        sex: row.sex,
        latitude: row.latitude,
        longitude: row.longitude,
        state: row.state,
        city: row.city,
        createdAt: row.createdat ?? row.createdAt ?? new Date().toISOString(),
    });

    const mapRecordingRow = (row: DbRecordingRow): RecordingEntry => ({
        id: row.id,
        patientId: row.patientid ?? row.patientId ?? '',
        userId: row.userid ?? row.userId ?? '',
        patientName: row.patientname ?? row.patientName ?? 'Unknown',
        timestamp: row.timestamp,
        biomarkers: row.biomarkers ?? {},
    });

    // Initialize user session
    useEffect(() => {
        const initializeUser = async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                if (session?.user?.id) {
                    setCurrentUserId(session.user.id);
                }
            } catch (err) {
                console.error('Failed to get session:', err);
            }
        };

        initializeUser();

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setCurrentUserId(session?.user?.id ?? null);
        });

        return () => subscription?.unsubscribe();
    }, []);

    // Load patients and recordings when user changes
    useEffect(() => {
        if (!currentUserId) {
            setPatients([]);
            setRecordings([]);
            setLoading(false);
            return;
        }

        const loadData = async () => {
            try {
                setLoading(true);
                setError(null);

                // Fetch patients
                const { data: patientData, error: patientError } = await supabase
                    .from('patients')
                    .select('*')
                    .eq('userid', currentUserId)
                    .order('createdat', { ascending: false });

                if (patientError) throw patientError;
                const mappedPatients = (patientData as DbPatientRow[] | null)?.map(mapPatientRow) || [];
                setPatients(mappedPatients);

                // Fetch recordings
                const { data: recordingData, error: recordingError } = await supabase
                    .from('recordings')
                    .select('*')
                    .eq('userid', currentUserId)
                    .order('timestamp', { ascending: false });

                if (recordingError) throw recordingError;
                const mappedRecordings = (recordingData as DbRecordingRow[] | null)?.map(mapRecordingRow) || [];
                setRecordings(mappedRecordings);

                // Save to local cache (IndexedDB)
                for (const p of mappedPatients) {
                    const patientRecordings = mappedRecordings.filter(r => r.patientId === p.id);
                    const lastRec = patientRecordings[0];
                    await saveLocalPatient({
                        id: p.id,
                        name: p.name,
                        age: p.age,
                        sex: p.sex,
                        intake: {
                            symptoms: lastRec?.biomarkers?.symptoms ?? [],
                            lifestyle: lastRec?.biomarkers?.lifestyle ?? [],
                            familyHistory: lastRec?.biomarkers?.familyHistory ?? [],
                        },
                        vitals: lastRec?.biomarkers ?? {},
                        timestamp: new Date(p.createdAt).getTime(),
                        synced: true
                    }).catch(() => {});
                }
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : 'Failed to load data';
                console.warn('Supabase fetch failed, trying offline cache:', err);
                
                // Fallback to IndexedDB
                try {
                    const localPatients = await getLocalPatients();
                    setPatients(localPatients.map(lp => ({
                        id: lp.id,
                        userId: currentUserId || '',
                        name: lp.name,
                        age: lp.age,
                        sex: lp.sex,
                        createdAt: new Date(lp.timestamp).toISOString()
                    })));
                } catch (localErr) {
                    setError(errorMessage);
                }
            } finally {
                setLoading(false);
            }
        };

        loadData();

        // Subscribe to real-time changes
        const patientSubscription = supabase
            .channel(`patients-${currentUserId}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'patients', filter: `userid=eq.${currentUserId}` },
                () => loadData()
            )
            .subscribe();

        const recordingSubscription = supabase
            .channel(`recordings-${currentUserId}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'recordings', filter: `userid=eq.${currentUserId}` },
                () => loadData()
            )
            .subscribe();

        return () => {
            patientSubscription.unsubscribe();
            recordingSubscription.unsubscribe();
        };
    }, [currentUserId]);

    const addPatient = useCallback(async (p: Omit<Patient, 'id' | 'userId' | 'createdAt'>): Promise<Patient | null> => {
        let effectiveUserId = currentUserId;
        if (!effectiveUserId) {
            const { data: { session } } = await supabase.auth.getSession();
            effectiveUserId = session?.user?.id ?? null;
            if (effectiveUserId) setCurrentUserId(effectiveUserId);
        }

        if (!effectiveUserId) {
            setError('User not authenticated. Please login again and retry.');
            return null;
        }

        try {
            setError(null);

            const newPatient = {
                name: p.name,
                age: p.age,
                sex: p.sex,
                latitude: p.latitude,
                longitude: p.longitude,
                state: p.state,
                city: p.city,
                userid: effectiveUserId,
                createdat: new Date().toISOString(),
            };

            const { data, error: insertError } = await supabase
                .from('patients')
                .insert([newPatient])
                .select()
                .single();

            if (insertError) throw insertError;
            const created = mapPatientRow(data as DbPatientRow);
            setPatients(prev => [created, ...prev.filter(x => x.id !== created.id)]);
            return created;
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to add patient';
            setError(errorMessage);
            console.error('Error adding patient:', err);
            return null;
        }
    }, [currentUserId]);

    const updatePatient = useCallback(async (id: string, data: Partial<Omit<Patient, 'id' | 'userId' | 'createdAt'>>) => {
        try {
            const { error: updateError } = await supabase
                .from('patients')
                .update(data)
                .eq('id', id)
                .eq('userid', currentUserId || '');

            if (updateError) throw updateError;
            setPatients(prev => prev.map(p => p.id === id ? { ...p, ...data } : p));
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to update patient';
            setError(errorMessage);
            console.error('Error updating patient:', err);
        }
    }, [currentUserId]);

    const saveRecording = useCallback(async (patientId: string, biomarkers: Record<string, any>): Promise<RecordingEntry | null> => {
        let effectiveUserId = currentUserId;
        if (!effectiveUserId) {
            const { data: { session } } = await supabase.auth.getSession();
            effectiveUserId = session?.user?.id ?? null;
            if (effectiveUserId) setCurrentUserId(effectiveUserId);
        }

        if (!effectiveUserId) {
            setError('User not authenticated. Please login again and retry.');
            return null;
        }

        try {
            const patient = patients.find(p => p.id === patientId);
            const entry = {
                patientid: patientId,
                userid: effectiveUserId,
                patientname: patient?.name ?? 'Unknown',
                timestamp: new Date().toISOString(),
                biomarkers,
            };

            const { data, error: insertError } = await supabase
                .from('recordings')
                .insert([entry])
                .select()
                .single();

            if (insertError) throw insertError;

            // Update local state immediately so history/tables refresh without waiting for realtime events.
            const created = mapRecordingRow(data as DbRecordingRow);
            setRecordings(prev => [created, ...prev.filter(r => r.id !== created.id)]);
            setError(null);
            return created;
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to save recording';
            setError(errorMessage);
            console.error('Error saving recording:', err);
            return null;
        }
    }, [currentUserId, patients]);

    const updateRecording = useCallback(async (id: string, biomarkers: Record<string, any>) => {
        try {
            const { error: updateError } = await supabase
                .from('recordings')
                .update({ biomarkers })
                .eq('id', id)
                .eq('userid', currentUserId || '');

            if (updateError) throw updateError;
            setRecordings(prev => prev.map(r => r.id === id ? { ...r, biomarkers } : r));
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to update recording';
            setError(errorMessage);
            console.error('Error updating recording:', err);
        }
    }, [currentUserId]);

    const getRecordingsForPatient = useCallback((patientId: string) => {
        return recordings.filter(r => r.patientId === patientId);
    }, [recordings]);

    const deletePatient = useCallback(async (id: string) => {
        try {
            // Delete recordings first (due to foreign key constraint)
            const { error: recordingError } = await supabase
                .from('recordings')
                .delete()
                .eq('patientid', id)
                .eq('userid', currentUserId || '');

            if (recordingError) throw recordingError;

            // Then delete patient
            const { error: patientError } = await supabase
                .from('patients')
                .delete()
                .eq('id', id)
                .eq('userid', currentUserId || '');

            if (patientError) throw patientError;
            setPatients(prev => prev.filter(p => p.id !== id));
            setRecordings(prev => prev.filter(r => r.patientId !== id));
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to delete patient';
            setError(errorMessage);
            console.error('Error deleting patient:', err);
        }
    }, [currentUserId]);

    const deleteRecording = useCallback(async (id: string) => {
        try {
            const { error: deleteError } = await supabase
                .from('recordings')
                .delete()
                .eq('id', id)
                .eq('userid', currentUserId || '');

            if (deleteError) throw deleteError;
            setRecordings(prev => prev.filter(r => r.id !== id));
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to delete recording';
            setError(errorMessage);
            console.error('Error deleting recording:', err);
        }
    }, [currentUserId]);

    const getHeatmapData = useCallback(() => {
        return patients
            .filter(p => p.latitude !== undefined && p.longitude !== undefined)
            .map(p => ({
                latitude: p.latitude!,
                longitude: p.longitude!,
                intensity: recordings.filter(r => r.patientId === p.id).length,
            }));
    }, [patients, recordings]);

    return (
        <PatientStoreContext.Provider
            value={{
                patients,
                recordings,
                loading,
                error,
                activePatientId,
                activePatientName,
                setActivePatient,
                addPatient,
                updatePatient,
                saveRecording,
                updateRecording,
                getRecordingsForPatient,
                deletePatient,
                deleteRecording,
                getHeatmapData,
            }}
        >
            {children}
        </PatientStoreContext.Provider>
    );
};
