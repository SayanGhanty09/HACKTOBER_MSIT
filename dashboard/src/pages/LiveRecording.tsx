import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Heart,
  Wind,
  Activity as ActivityIcon,
  Droplets,
  FlaskConical,
  Brain,
  FileText,
  Mail,
  Send,
  Play,
  AlertTriangle,
  UserPlus,
  MapPin,
  AlertCircle,
  Locate,
  X,
  CheckCircle2,
  Square,
} from 'lucide-react';

import { useBLE, BLEStatus } from '../contexts/BLEContext';
import { usePatientStore } from '../contexts/PatientStore';
import type { Patient } from '../contexts/PatientStore';
import { reverseGeocode } from '../utils/reverseGeocode';
import { useHideBPAndRespiration } from '../utils/preferences';
import AIAssistantChat from '../components/AIAssistantChat';
import { requestLiveRecordingReport } from '../services/exchangeClient';
import type { LiveReportResult, LiveReportFinding } from '../services/exchangeClient';
import { getOpenRouterKey } from '../utils/aiPreferences';
import { sendReportEmail } from '../services/emailService';
import { generateReportHTML, printReport } from '../utils/reportTemplate';
import { Card, Button, Pill, SectionHeader, IconButton, KpiTile, SpeechButton } from '../components/ui';
import RiskGaugeCard from '../components/dashboard/RiskGaugeCard';
import VoiceInput from '../components/VoiceInput';
import OCRCapture from '../components/OCRCapture';
import { downloadFHIR } from '../utils/fhirExport';
import { useTranslation } from '../utils/useTranslation';
import {
  getHemoglobinScale,
  hemoglobinReferenceLabel,
  BILIRUBIN_SCALE,
  riskProbabilityPercent,
  calculateChronicRisks
} from '../utils/riskThresholds';

function formatFindingLabel(label: string): string {
  return label
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toUpperCase();
}

const LiveRecording: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const {
    status, biomarkers, bestNormal, bestBP,
    scanPhase, scanSeconds, startFullScan,
  } = useBLE();
  const hideBPAndRespiration = useHideBPAndRespiration();
  const {
    patients,
    addPatient,
    saveRecording,
    updateRecording,
    activePatientId,
    activePatientName,
    setActivePatient,
  } = usePatientStore();

  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [lifestyle, setLifestyle] = useState<string[]>([]);
  const [familyHistory, setFamilyHistory] = useState<string[]>([]);
  const [currentRecordingId, setCurrentRecordingId] = useState<string | null>(null);
  const [expandedRiskId, setExpandedRiskId] = useState<string | null>(null);
  const [manualBiomarkers, setManualBiomarkers] = useState<any>(null);

  // Cholesterol risk calculator state
  const [cholFields, setCholFields] = useState({
    totalChol: '', ldl: '', hdl: '', triglycerides: '', bmi: '', hba1c: ''
  });
  const [cholResult, setCholResult] = useState<{ risk: number; category: string } | null>(null);

  const computeCholesterolRisk = () => {
    const tc   = parseFloat(cholFields.totalChol);
    const ldl  = parseFloat(cholFields.ldl);
    const hdl  = parseFloat(cholFields.hdl);
    const trig = parseFloat(cholFields.triglycerides);
    const bmi  = parseFloat(cholFields.bmi);
    const hba1c= parseFloat(cholFields.hba1c);
    if ([tc, ldl, hdl, trig, bmi, hba1c].some(isNaN)) return;

    // Reference table data
    const REF = [
      [158,82,62,92,21.8,5.1,0.05],[172,95,58,108,22.7,5.2,0.08],
      [181,105,54,120,23.5,5.3,0.12],[190,112,51,135,24.2,5.4,0.18],
      [198,120,48,145,25.1,5.5,0.25],[207,128,45,158,26.0,5.6,0.32],
      [215,135,44,170,26.8,5.7,0.39],[222,142,42,182,27.4,5.8,0.46],
      [230,150,40,195,28.1,5.9,0.54],[235,155,39,205,28.7,6.0,0.61],
      [242,160,38,215,29.2,6.1,0.68],[248,168,37,225,29.8,6.2,0.74],
      [255,175,36,235,30.4,6.3,0.79],[262,182,35,245,30.9,6.4,0.83],
      [270,190,34,255,31.5,6.5,0.87],[278,198,33,275,32.1,6.6,0.90],
      [285,205,32,290,32.8,6.7,0.93],[295,218,30,310,33.5,6.9,0.96],
      [305,230,28,335,34.2,7.1,0.98],[320,245,26,365,35.0,7.4,0.99],
    ];
    const RANGES = { tc:[158,320], ldl:[82,245], hdl:[26,62], trig:[92,365], bmi:[21.8,35.0], hba1c:[5.1,7.4] };
    const W = { tc:0.20, ldl:0.25, hdl:0.20, trig:0.15, bmi:0.10, hba1c:0.10 };
    const norm = (v: number, [lo, hi]: number[], inv = false) => {
      const n = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
      return inv ? 1 - n : n;
    };
    const composite = (tc2: number, l: number, h: number, tr: number, b: number, a: number) =>
      W.tc * norm(tc2, RANGES.tc) + W.ldl * norm(l, RANGES.ldl) + W.hdl * norm(h, RANGES.hdl, true)
      + W.trig * norm(tr, RANGES.trig) + W.bmi * norm(b, RANGES.bmi) + W.hba1c * norm(a, RANGES.hba1c);
    const input_c = composite(tc, ldl, hdl, trig, bmi, hba1c);
    const sorted = REF.map(r => ({ c: composite(r[0],r[1],r[2],r[3],r[4],r[5]), risk: r[6] }))
      .sort((a, b) => a.c - b.c);
    let risk = sorted[sorted.length - 1].risk;
    if (input_c <= sorted[0].c) risk = sorted[0].risk;
    else {
      for (let i = 0; i < sorted.length - 1; i++) {
        if (sorted[i].c <= input_c && input_c <= sorted[i+1].c) {
          const t = (input_c - sorted[i].c) / (sorted[i+1].c - sorted[i].c);
          risk = parseFloat((sorted[i].risk + t * (sorted[i+1].risk - sorted[i].risk)).toFixed(2));
          break;
        }
      }
    }
    const cat = risk < 0.30 ? 'Low' : risk < 0.60 ? 'Moderate' : risk < 0.84 ? 'High' : 'Very High';
    setCholResult({ risk, category: cat });
  };

  const isConnected =
    status === BLEStatus.CONNECTED ||
    status === BLEStatus.IDLE ||
    status === BLEStatus.SCANNING ||
    status === BLEStatus.SCANNING_BP;

  const isScanning = scanPhase === 'normal' || scanPhase === 'bp';

  // Patient picker popup
  const [showPatientPicker, setShowPatientPicker] = useState(false);
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

  // Auto-save recording when scan finishes
  const savedRef = useRef(false);
  useEffect(() => {
    if (scanPhase === 'done' && activePatientId && !savedRef.current) {
      savedRef.current = true;
      const bpDefined = Object.fromEntries(Object.entries(bestBP).filter(([, v]) => v !== undefined));
      const final = {
        ...bestNormal,
        ...bpDefined,
        symptoms,
        lifestyle,
        familyHistory
      };
      if (hideBPAndRespiration) {
        delete final.bpSys;
        delete final.bpDia;
        delete final.respRate;
      }
      saveRecording(activePatientId, final).then((created) => {
        if (created) {
          setCurrentRecordingId(created.id);
        }
      });

      const patient = patients.find((p) => p.id === activePatientId);
      const lastReading = {
        deviceName: 'Anebilin',
        patient: patient ? { id: patient.id, name: patient.name, age: patient.age, sex: patient.sex } : null,
        timestamp: new Date().toISOString(),
        biomarkers: {
          spo2: final.spo2 ?? null,
          heartRate: final.hr ?? null,
          perfusionIndex: final.pi ?? null,
          signalQuality: final.sqi != null ? Math.round(final.sqi * 100) : null,
          sdnn: final.sdnn ?? null,
          rmssd: final.rmssd ?? null,
          hemoglobin: final.hb ?? null,
          bilirubin: final.bilirubin ?? null,
          systolicBP: hideBPAndRespiration ? null : (final.bpSys ?? null),
          diastolicBP: hideBPAndRespiration ? null : (final.bpDia ?? null),
          pulseRate: final.pulseRate ?? null,
          respirationRate: hideBPAndRespiration ? null : (final.respRate ?? null),
          symptoms,
          lifestyle,
          familyHistory
        },
      };
      localStorage.setItem('spectru_last_reading', JSON.stringify(lastReading));
    }
    if (scanPhase === 'idle') {
      savedRef.current = false;
      setCurrentRecordingId(null);
      setSymptoms([]);
      setLifestyle([]);
      setFamilyHistory([]);
    }
  }, [scanPhase, activePatientId, bestNormal, bestBP, saveRecording, patients, hideBPAndRespiration]);

  // Auto-start from Dashboard navigation
  const autoStartedRef = useRef(false);
  useEffect(() => {
    const state = location.state as { autoStartPatientId?: string; autoStartPatientName?: string } | null;
    if (state?.autoStartPatientId && !autoStartedRef.current) {
      autoStartedRef.current = true;
      setActivePatient(state.autoStartPatientId, state.autoStartPatientName ?? 'Unknown');
      savedRef.current = false;
      if (isConnected && scanPhase === 'idle') {
        startFullScan();
      }
      window.history.replaceState({}, '');
    }
  }, [location.state, isConnected, scanPhase, setActivePatient, startFullScan]);

  const handleMeasureClick = () => {
    if (!isConnected || isScanning) return;
    setShowPatientPicker(true);
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
          enableHighAccuracy: true, maximumAge: 0, timeout: 15000,
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

  const startScanWithPatient = (patient: Patient) => {
    setActivePatient(patient.id, patient.name);
    savedRef.current = false;
    setShowPatientPicker(false);
    startFullScan();
  };

  const handleAddAndStart = async () => {
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
    if (!p) return;
    setNewName(''); setNewAge(''); setNewSex('Male');
    setNewLatitude(''); setNewLongitude(''); setNewState(''); setNewCity('');
    setLocationError(null);
    startScanWithPatient(p);
  };

  const [analysisResult, setAnalysisResult] = useState<LiveReportResult | null>(null);
  const [reportFallbackNotice, setReportFallbackNotice] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [isSendingEmail, setIsSendingEmail] = useState(false);

  const displayData = useMemo(() => {
    if (manualBiomarkers) return manualBiomarkers;
    if (scanPhase === 'done') {
      const bpDefined = Object.fromEntries(Object.entries(bestBP).filter(([, v]) => v !== undefined));
      return { ...bestNormal, ...bpDefined };
    }
    return biomarkers;
  }, [scanPhase, bestNormal, bestBP, biomarkers, manualBiomarkers]);

  const handleIntakeChange = (
    type: 'symptoms' | 'lifestyle' | 'familyHistory',
    value: string,
    checked: boolean
  ) => {
    let updatedSymptoms = symptoms;
    let updatedLifestyle = lifestyle;
    let updatedFamilyHistory = familyHistory;

    if (type === 'symptoms') {
      updatedSymptoms = checked ? [...symptoms, value] : symptoms.filter((s) => s !== value);
      setSymptoms(updatedSymptoms);
    } else if (type === 'lifestyle') {
      updatedLifestyle = checked ? [...lifestyle, value] : lifestyle.filter((l) => l !== value);
      setLifestyle(updatedLifestyle);
    } else if (type === 'familyHistory') {
      updatedFamilyHistory = checked ? [...familyHistory, value] : familyHistory.filter((f) => f !== value);
      setFamilyHistory(updatedFamilyHistory);
    }

    // If recording was already created, update it in Supabase
    if (currentRecordingId) {
      const bpDefined = Object.fromEntries(Object.entries(bestBP).filter(([, v]) => v !== undefined));
      const final = {
        ...bestNormal,
        ...bpDefined,
        symptoms: updatedSymptoms,
        lifestyle: updatedLifestyle,
        familyHistory: updatedFamilyHistory
      };
      if (hideBPAndRespiration) {
        delete final.bpSys;
        delete final.bpDia;
        delete final.respRate;
      }
      updateRecording(currentRecordingId, final);
    }
  };

  const chronicRisks = useMemo(() => {
    const activePatient = patients.find((p) => p.id === activePatientId);
    const age = activePatient?.age ?? 30;
    const sex = activePatient?.sex ?? 'Female';
    return calculateChronicRisks(
      displayData as Record<string, number | undefined>,
      { symptoms, lifestyle, familyHistory },
      age,
      sex
    );
  }, [displayData, symptoms, lifestyle, familyHistory, patients, activePatientId]);

  const livePi  = scanPhase === 'normal' ? biomarkers.pi  : undefined;
  const liveSqi = scanPhase === 'normal' ? biomarkers.sqi : undefined;

  // Sex-specific anemia reference range for the active patient. Defaults to
  // the more conservative female range when no patient/sex is known yet.
  const activePatientSex = useMemo(() => {
    return patients.find((p) => p.id === activePatientId)?.sex ?? 'Female';
  }, [patients, activePatientId]);
  const hemoglobinScale = useMemo(() => getHemoglobinScale(activePatientSex), [activePatientSex]);

  const isVitalsDataStable = scanPhase === 'done' || manualBiomarkers != null;
  const hbProbability = isVitalsDataStable && displayData?.hb != null
    ? riskProbabilityPercent(displayData.hb, hemoglobinScale)
    : undefined;
  const biliProbability = isVitalsDataStable && displayData?.bilirubin != null
    ? riskProbabilityPercent(displayData.bilirubin, BILIRUBIN_SCALE)
    : undefined;

  const fingerGuidance = useMemo(() => {
    if (scanPhase !== 'normal') return null;
    if (livePi === undefined || livePi < 0.05) return { text: 'Place finger firmly on sensor', tone: 'error' as const };
    if (liveSqi !== undefined && liveSqi < 0.3) return { text: 'Hold still — signal quality low', tone: 'warn' as const };
    if (liveSqi !== undefined && liveSqi < 0.6) return { text: 'Getting signal — keep steady', tone: 'warn' as const };
    return { text: 'Strong signal — measuring', tone: 'success' as const };
  }, [scanPhase, livePi, liveSqi]);

  const phaseLabel =
    scanPhase === 'normal' ? 'Normal scan' :
    scanPhase === 'bp' ? 'BP scan' :
    scanPhase === 'done' ? 'Scan complete' : '';

  // Vital tiles
  type Vital = { label: string; value: string; unit: string; icon: React.ElementType; accent: string };
  const vitalCards: Vital[] = useMemo(() => {
    const d = displayData;
    // Blood pressure value: show "sys/dia" when both are available, or "—" when awaiting BP scan
    const bpValue = d?.bpSys != null
      ? `${d.bpSys.toFixed(0)}/${d.bpDia != null ? d.bpDia.toFixed(0) : '—'}`
      : '—';
    // Respiration value
    const rrValue = d?.respRate != null ? d.respRate.toFixed(1) : '—';

    const cards: Vital[] = [
      { label: 'Heart rate',     value: d?.hr       != null ? d.hr.toFixed(1)       : '—', unit: 'bpm',    icon: Heart,         accent: '#b3261e' },
      { label: 'SpO₂',           value: d?.spo2     != null ? d.spo2.toFixed(1)     : '—', unit: '%',      icon: Droplets,      accent: '#1f6fb3' },
    ];

    if (!hideBPAndRespiration) {
      cards.push(
        { label: 'Blood pressure', value: bpValue,                                             unit: 'mmHg',   icon: ActivityIcon,  accent: '#b46d11' },
        { label: 'Respiration',    value: rrValue,                                             unit: 'br/min', icon: Wind,          accent: '#1f7a4d' }
      );
    }

    cards.push(
      { label: 'Hemoglobin',     value: d?.hb       != null ? d.hb.toFixed(2)       : '—', unit: 'g/dL',   icon: FlaskConical,  accent: '#7c4a82' },
      { label: 'Bilirubin',      value: d?.bilirubin!= null ? d.bilirubin.toFixed(2): '—', unit: 'mg/dL',  icon: ActivityIcon,  accent: '#b46d11' },
      { label: 'HRV SDNN',      value: d?.sdnn     != null ? d.sdnn.toFixed(1)     : '—', unit: 'ms',     icon: Brain,         accent: '#1f7a4d' }
    );

    return cards;
  }, [displayData, hideBPAndRespiration]);

  const generateAIReport = async () => {
    if (!displayData?.hr) return;
    const patient = patients.find((p) => p.id === activePatientId);
    if (!patient) {
      alert('Please select a patient before generating a report.');
      return;
    }
    setIsAnalyzing(true);
    try {
      const readingPayload = {
        deviceName: 'Anebilin',
        patient: { id: patient.id, name: patient.name, age: patient.age, sex: patient.sex },
        timestamp: new Date().toISOString(),
        biomarkers: {
          spo2: displayData.spo2 ?? null,
          heartRate: displayData.hr ?? null,
          perfusionIndex: displayData.pi ?? null,
          signalQuality: displayData.sqi != null ? Math.round(displayData.sqi * 100) : null,
          sdnn: displayData.sdnn ?? null,
          rmssd: displayData.rmssd ?? null,
          hemoglobin: displayData.hb ?? null,
          bilirubin: displayData.bilirubin ?? null,
          systolicBP: hideBPAndRespiration ? null : (displayData.bpSys ?? null),
          diastolicBP: hideBPAndRespiration ? null : (displayData.bpDia ?? null),
          pulseRate: displayData.pulseRate ?? null,
          respirationRate: hideBPAndRespiration ? null : (displayData.respRate ?? null),
        },
      };
      const { requestId, report, fallbackUsed, fallbackReason } = await requestLiveRecordingReport(readingPayload);
      setAnalysisResult(report);
      setReportFallbackNotice(fallbackUsed ? (fallbackReason || 'Generated via local clinical rule engine.') : null);
      localStorage.setItem('spectru_last_exchange_request_id', requestId);
      localStorage.setItem('spectru_last_exchange_payload', JSON.stringify(readingPayload));
      localStorage.setItem('spectru_last_exchange_report', JSON.stringify(report));
    } catch (e: unknown) {
      console.error(e);
      alert('AI report failed: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setIsAnalyzing(false);
    }
  };

  const triggerPdfEmail = async () => {
    if (!recipientEmail) { alert('Please enter an email address.'); return; }
    if (!analysisResult) { alert('Please generate a report first.'); return; }
    const patient = patients.find((p) => p.id === activePatientId);
    if (!patient) { alert('No patient selected.'); return; }

    setIsSendingEmail(true);
    try {
      const reportHTML = generateReportHTML({
        patient: {
          id: patient.id,
          name: patient.name,
          age: patient.age,
          sex: patient.sex,
          city: patient.city,
          state: patient.state,
        },
        biomarkers: displayData,
        analysisResult,
        hideBPAndRespiration,
      });

      await sendReportEmail({
        patientName: patient.name,
        patientAge: patient.age,
        recipientEmail,
        reportContent: reportHTML,
      });

      alert('Report sent to ghantysayan8@gmail.com');
      setIsModalOpen(false);
      setRecipientEmail('');
    } catch (e) {
      console.error(e);
      alert('Error sending email: ' + (e instanceof Error ? e.message : 'Unknown error'));
    }
    setIsSendingEmail(false);
  };

  const handlePrintReport = () => {
    if (!analysisResult) { alert('Please generate a report first.'); return; }
    const patient = patients.find((p) => p.id === activePatientId);
    if (!patient) { alert('No patient selected.'); return; }
    printReport({
      patient: {
        id: patient.id,
        name: patient.name,
        age: patient.age,
        sex: patient.sex,
        city: patient.city,
        state: patient.state,
      },
      biomarkers: displayData,
      analysisResult,
      hideBPAndRespiration,
    });
  };

  const exportJSON = () => {
    const raw = localStorage.getItem('spectru_last_reading');
    if (!raw) return;
    const blob = new Blob([raw], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `anebilin-reading-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFHIRExport = () => {
    const patient = patients.find((p) => p.id === activePatientId);
    if (!patient) {
      alert("No active patient selected.");
      return;
    }
    const localPatient = {
      id: patient.id,
      name: patient.name,
      age: patient.age,
      sex: patient.sex,
      intake: { symptoms, lifestyle, familyHistory },
      vitals: displayData,
      timestamp: Date.now(),
      synced: false
    };
    downloadFHIR(localPatient);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-7)' }}
    >
      {/* ============ HEADER ============ */}
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
              fontSize: 'var(--text-xs)', color: 'var(--ink-3)',
              textTransform: 'uppercase', letterSpacing: '0.16em', fontWeight: 500,
            }}
          >
            {t('liveMonitoring')}
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
            {t('captureVitalsSub')}
          </h1>
          <p style={{ color: 'var(--ink-3)', maxWidth: '60ch', fontSize: 'var(--text-md)' }}>
            Place a finger on the sensor, hold still, and let the device run a normal and BP pass.
          </p>
        </div>
        <Pill tone={activePatientName ? 'accent' : 'neutral'} dot size="md">
          {activePatientName ? `${t('activePatient')}: ${activePatientName}` : t('noneSelected')}
        </Pill>
      </header>

      {/* ============ CONTROL ROW ============ */}
      <Card pad="var(--sp-5)">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--sp-5)',
            flexWrap: 'wrap',
          }}
        >
          <Button
            onClick={handleMeasureClick}
            disabled={!isConnected || isScanning}
            variant="primary"
            size="lg"
            loading={isScanning}
            leadingIcon={!isScanning ? <Play size={16} strokeWidth={2} /> : undefined}
          >
            {isScanning ? t('measuring') : scanPhase === 'done' ? t('measureAgain') : t('measureVitals')}
          </Button>

          {(scanPhase === 'done' || manualBiomarkers != null) && (
            <>
              <Button variant="secondary" size="md" onClick={exportJSON} leadingIcon={<FileText size={14} />}>
                {t('exportJson')}
              </Button>
              <Button variant="secondary" size="md" onClick={handleFHIRExport} leadingIcon={<FileText size={14} />}>
                {t('exportFhir')}
              </Button>
            </>
          )}

          {isScanning && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 12,
                padding: '8px 14px',
                background: 'var(--accent-soft)',
                border: '1px solid var(--accent-soft-2)',
                borderRadius: 'var(--r-pill)',
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }} />
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--accent)', fontWeight: 600 }}>
                {phaseLabel}
              </span>
              <span
                className="num"
                style={{
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--accent)',
                  fontWeight: 500,
                  fontSize: 'var(--text-md)',
                }}
              >
                {String(scanSeconds).padStart(2, '0')}s
              </span>
            </div>
          )}

          {fingerGuidance && (
            <Pill
              tone={fingerGuidance.tone === 'success' ? 'success' : fingerGuidance.tone === 'error' ? 'error' : 'warn'}
              leadingIcon={<AlertTriangle size={12} strokeWidth={1.8} />}
            >
              {fingerGuidance.text}
            </Pill>
          )}

          {scanPhase === 'normal' && livePi !== undefined && (
            <div className="num" style={{ display: 'flex', gap: 18, fontSize: 'var(--text-sm)', color: 'var(--ink-3)' }}>
              <span>PI <strong style={{ color: 'var(--ink)' }}>{livePi.toFixed(2)}%</strong></span>
              <span>SQI <strong style={{ color: 'var(--ink)' }}>{((liveSqi ?? 0) * 100).toFixed(0)}%</strong></span>
            </div>
          )}

          {scanPhase === 'bp' && biomarkers.pulseRate !== undefined && biomarkers.pulseRate > 0 && (
            <div className="num" style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-3)' }}>
              PR <strong style={{ color: 'var(--ink)' }}>{biomarkers.pulseRate.toFixed(0)} bpm</strong>
            </div>
          )}

          {!isConnected && (
            <span
              style={{
                fontSize: 'var(--text-sm)',
                color: 'var(--error)',
                fontWeight: 500,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                marginLeft: 'auto',
              }}
            >
              <AlertCircle size={14} strokeWidth={1.8} />
              {t('connectDevice')}
            </span>
          )}
        </div>
      </Card>

      {/* ============ MANUAL VITAL ENTRY (VOICE/OCR) ============ */}
      {activePatientId && (
        <Card pad="var(--sp-5)">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
            <div>
              <span style={{
                fontSize: 'var(--text-xs)', color: 'var(--ink-3)',
                textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600
              }}>
                {t('manualInputOptions')}
              </span>
              <h3 style={{ fontSize: 'var(--text-md)', fontWeight: 600, color: 'var(--ink)', margin: '4px 0 0 0' }}>
                {t('logVitalsVoiceOcr')}
              </h3>
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 'var(--sp-4)'
            }}>
              <VoiceInput onVitals={(v) => {
                setManualBiomarkers((prev: any) => ({ ...prev, ...v }));
              }} />
              <OCRCapture onExtracted={(text) => {
                const parsed: any = {};
                const hr = text.match(/(?:Heart Rate|Pulse)[^\d]*(\d+)/i);
                if (hr) parsed.hr = parseInt(hr[1]);
                const spo2 = text.match(/(?:SpO2|Oxygen)[^\d]*(\d+)/i);
                if (spo2) parsed.spo2 = parseInt(spo2[1]);
                const bp = text.match(/(?:Blood Pressure)[^\d]*(\d+)\s*\/\s*(\d+)/i);
                if (bp) { parsed.bpSys = parseInt(bp[1]); parsed.bpDia = parseInt(bp[2]); }
                const hb = text.match(/(?:Hemoglobin)[^\d]*([\d.]+)/i);
                if (hb) parsed.hb = parseFloat(hb[1]);
                const bilirubin = text.match(/(?:Bilirubin)[^\d]*([\d.]+)/i);
                if (bilirubin) parsed.bilirubin = parseFloat(bilirubin[1]);
                setManualBiomarkers((prev: any) => ({ ...prev, ...parsed }));
              }} />
            </div>
            {manualBiomarkers && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
                <Button size="md" onClick={() => {
                  saveRecording(activePatientId, manualBiomarkers).then((created) => {
                    if (created) {
                      setCurrentRecordingId(created.id);
                      alert("Manual recording saved successfully!");
                    }
                  });
                }}>
                  {t('saveManualRecording')}
                </Button>
                <Button size="md" variant="secondary" onClick={() => {
                  setManualBiomarkers(null);
                }}>
                  {t('clearManualOverride')}
                </Button>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* ============ VITAL TILES ============ */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
        <SectionHeader
          eyebrow={t('readings')}
          title={scanPhase === 'done' ? t('bestOfSession') : isScanning ? t('liveReadings') : t('vitalSigns')}
          description={scanPhase === 'done' ? 'Aggregated from the last 30-second pass.' : isScanning ? 'Streaming from the device — values stabilise as the pass completes.' : undefined}
        />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 'var(--sp-3)',
          }}
        >
          {vitalCards.map((card) => (
            <KpiTile
              key={card.label}
              label={card.label}
              value={card.value}
              unit={card.unit}
              accent={card.accent}
              leadingIcon={<card.icon size={14} strokeWidth={1.6} color="var(--ink-3)" />}
            />
          ))}
        </div>
      </section>

      {/* ============ CLINICAL INTAKE (Only when a patient is selected) ============ */}
      {activePatientId && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          <SectionHeader
            eyebrow={t('clinicalIntake')}
            title={t('symptomsAndHistory')}
            description="Log the patient's current symptoms, lifestyle factors, and clinical family history."
          />
          <Card pad="var(--sp-6)">
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: 'var(--sp-6)'
            }}>
              {/* Symptoms Group */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {t('symptoms')}
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[
                    { id: 'fatigue', label: 'Persistent Fatigue' },
                    { id: 'dizziness', label: 'Dizziness / Lightheadedness' },
                    { id: 'chest_pain', label: 'Chest Pain / Angina' },
                    { id: 'shortness_of_breath', label: 'Shortness of Breath' },
                    { id: 'polyuria', label: 'Frequent Urination (Polyuria)' },
                    { id: 'excessive_thirst', label: 'Excessive Thirst (Polydipsia)' },
                    { id: 'headaches', label: 'Frequent Headaches' }
                  ].map((item) => (
                    <label key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 'var(--text-sm)' }}>
                      <input
                        type="checkbox"
                        checked={symptoms.includes(item.id)}
                        onChange={(e) => handleIntakeChange('symptoms', item.id, e.target.checked)}
                        style={{ width: 16, height: 16, cursor: 'pointer' }}
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Lifestyle Group */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {t('lifestyle')}
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[
                    { id: 'smoking', label: 'Active Tobacco Usage' },
                    { id: 'sedentary', label: 'Sedentary Lifestyle' },
                    { id: 'high_sodium', label: 'High Sodium Intake' },
                    { id: 'poor_diet', label: 'Poor / Low Iron Diet' }
                  ].map((item) => (
                    <label key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 'var(--text-sm)' }}>
                      <input
                        type="checkbox"
                        checked={lifestyle.includes(item.id)}
                        onChange={(e) => handleIntakeChange('lifestyle', item.id, e.target.checked)}
                        style={{ width: 16, height: 16, cursor: 'pointer' }}
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Family History Group */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {t('familyHistory')}
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[
                    { id: 'diabetes', label: 'Family History of Diabetes' },
                    { id: 'hypertension', label: 'Family History of Hypertension' },
                    { id: 'cvd', label: 'Family History of CVD / Heart Stroke' }
                  ].map((item) => (
                    <label key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 'var(--text-sm)' }}>
                      <input
                        type="checkbox"
                        checked={familyHistory.includes(item.id)}
                        onChange={(e) => handleIntakeChange('familyHistory', item.id, e.target.checked)}
                        style={{ width: 16, height: 16, cursor: 'pointer' }}
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        </section>
      )}

      {/* ============ CHOLESTEROL RISK CALCULATOR ============ */}
      {activePatientId && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          <SectionHeader
            eyebrow="Lab Values"
            title="Cholesterol Risk Calculator"
            description="Enter lab-measured values to estimate the patient's cholesterol risk level."
          />
          <Card pad="var(--sp-6)">
            {/* Input grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 'var(--sp-4)',
              marginBottom: 'var(--sp-5)'
            }}>
              {([
                { key: 'totalChol',    label: 'Total Cholesterol', unit: 'mg/dL' },
                { key: 'ldl',          label: 'LDL',               unit: 'mg/dL' },
                { key: 'hdl',          label: 'HDL',               unit: 'mg/dL' },
                { key: 'triglycerides',label: 'Triglycerides',     unit: 'mg/dL' },
                { key: 'bmi',          label: 'BMI',               unit: 'kg/m²' },
                { key: 'hba1c',        label: 'HbA1c',             unit: '%'     },
              ] as const).map(({ key, label, unit }) => (
                <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
                  <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {label}
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      placeholder="—"
                      value={cholFields[key]}
                      onChange={e => setCholFields(prev => ({ ...prev, [key]: e.target.value }))}
                      style={{
                        width: '100%',
                        padding: '10px 44px 10px 12px',
                        borderRadius: 8,
                        border: '1.5px solid var(--hairline)',
                        background: 'var(--surface)',
                        color: 'var(--ink)',
                        fontSize: 'var(--text-sm)',
                        fontWeight: 600,
                        outline: 'none',
                        boxSizing: 'border-box',
                        transition: 'border-color 0.2s',
                      }}
                      onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
                      onBlur={e => (e.target.style.borderColor = 'var(--hairline)')}
                    />
                    <span style={{
                      position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                      fontSize: 11, color: 'var(--ink-3)', fontWeight: 500, pointerEvents: 'none'
                    }}>{unit}</span>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={computeCholesterolRisk}
              style={{
                padding: '11px 28px',
                borderRadius: 8,
                background: 'linear-gradient(135deg, var(--accent), #8b5cf6)',
                color: '#fff',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: 'var(--text-sm)',
                boxShadow: 'var(--shadow-1)',
                transition: 'opacity 0.2s',
                marginBottom: cholResult ? 'var(--sp-5)' : 0,
              }}
              onMouseEnter={e => ((e.target as HTMLButtonElement).style.opacity = '0.88')}
              onMouseLeave={e => ((e.target as HTMLButtonElement).style.opacity = '1')}
            >
              Calculate Cholesterol Risk
            </button>

            {/* Result panel */}
            {cholResult && (() => {
              const pct = Math.round(cholResult.risk * 100);
              const colorMap: Record<string, string> = {
                Low: '#16a34a', Moderate: '#ca8a04', High: '#dc2626', 'Very High': '#7e22ce'
              };
              const bgMap: Record<string, string> = {
                Low: 'rgba(22,163,74,0.08)', Moderate: 'rgba(202,138,4,0.08)',
                High: 'rgba(220,38,38,0.08)', 'Very High': 'rgba(126,34,206,0.08)'
              };
              const barColorMap: Record<string, string> = {
                Low: '#16a34a', Moderate: '#eab308', High: '#ef4444', 'Very High': '#a855f7'
              };
              const color = colorMap[cholResult.category] || '#6366f1';
              const bg    = bgMap[cholResult.category]    || 'rgba(99,102,241,0.08)';
              const barClr= barColorMap[cholResult.category] || '#6366f1';
              return (
                <div style={{
                  padding: '20px 24px',
                  borderRadius: 12,
                  background: bg,
                  border: `1.5px solid ${color}33`,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--sp-3)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--ink)' }}>Cholesterol Risk Score</span>
                    <span style={{
                      padding: '4px 14px',
                      borderRadius: 20,
                      fontSize: 12,
                      fontWeight: 700,
                      color,
                      background: `${color}18`,
                      border: `1px solid ${color}44`,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em'
                    }}>{cholResult.category}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
                    <div style={{ flex: 1, height: 10, borderRadius: 5, background: 'var(--hairline)', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        width: `${pct}%`,
                        background: `linear-gradient(90deg, ${barClr}aa, ${barClr})`,
                        borderRadius: 5,
                        transition: 'width 0.6s ease'
                      }} />
                    </div>
                    <span style={{ fontSize: 22, fontWeight: 800, color, minWidth: 52, textAlign: 'right' }}>{pct}%</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-3)' }}>
                    Risk probability: <strong>{cholResult.risk.toFixed(2)}</strong> &nbsp;|&nbsp;
                    Estimated from Total Cholesterol, LDL, HDL, Triglycerides, BMI, and HbA1c.
                  </p>
                </div>
              );
            })()}
          </Card>
        </section>
      )}

      {/* ============ RISK GAUGES ============ */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
        <SectionHeader
          eyebrow={t('screening')}
          title={t('anemiaJaundiceRisk')}
          description={
            scanPhase === 'done'
              ? 'Best-of-session reading, with an estimated risk probability.'
              : 'Where this reading sits against clinical reference ranges. Complete a scan to see the risk probability.'
          }
        />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 'var(--sp-4)',
          }}
        >
          <RiskGaugeCard
            title="Hemoglobin"
            subtitle={hemoglobinReferenceLabel(activePatientSex)}
            value={displayData?.hb}
            scale={hemoglobinScale}
            riskName="anemia"
            probability={hbProbability}
          />
          <RiskGaugeCard
            title="Bilirubin"
            subtitle="Total bilirubin reference range"
            value={displayData?.bilirubin}
            scale={BILIRUBIN_SCALE}
            riskName="jaundice"
            probability={biliProbability}
          />
        </div>
      </section>

      {/* ============ CHRONIC DISEASE RISK SCREENING ============ */}
      {activePatientId && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          <SectionHeader
            eyebrow={t('triage')}
            title={t('chronicDiseaseRisk')}
            description="Rule-based explainable risk scores computed from vitals and clinical intake parameters."
          />
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 'var(--sp-4)'
          }}>
            {chronicRisks.map((risk) => {
              const isExpanded = expandedRiskId === risk.disease;
              const levelTone =
                risk.riskLevel === 'High' ? 'error' :
                risk.riskLevel === 'Medium' ? 'warn' : 'success';
              const badgeColors = {
                success: { bg: 'var(--success-soft)', fg: 'var(--success)', border: 'rgba(34, 197, 94, 0.2)' },
                warn:    { bg: 'var(--warn-soft)',    fg: 'var(--warn)',    border: 'rgba(245, 158, 11, 0.2)' },
                error:   { bg: 'var(--error-soft)',   fg: 'var(--error)',   border: 'rgba(239, 68, 68, 0.2)' }
              }[levelTone];

              return (
                <Card key={risk.disease} pad="var(--sp-5)" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <h3 style={{ fontSize: 'var(--text-md)', fontWeight: 600, color: 'var(--ink)', margin: 0 }}>
                      {risk.disease}
                    </h3>
                    <span style={{
                      padding: '3px 8px',
                      borderRadius: 'var(--r-pill)',
                      fontSize: 'var(--text-xs)',
                      fontWeight: 600,
                      background: badgeColors.bg,
                      color: badgeColors.fg,
                      border: `1px solid ${badgeColors.border}`
                    }}>
                      {risk.riskLevel === 'High' ? t('high') : risk.riskLevel === 'Medium' ? t('medium') : t('low')}
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)', color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>
                      <span>{t('riskScore')}</span>
                      <span>{risk.score}%</span>
                    </div>
                    {/* Progress Bar */}
                    <div style={{ height: 6, background: 'var(--surface-sunken)', borderRadius: 'var(--r-pill)', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        width: `${risk.score}%`,
                        background: risk.riskLevel === 'High' ? 'var(--error)' : risk.riskLevel === 'Medium' ? 'var(--warn)' : 'var(--success)',
                        borderRadius: 'var(--r-pill)',
                        transition: 'width 0.4s ease'
                      }} />
                    </div>
                  </div>

                  {/* Factor breakdown trigger */}
                  <div style={{ marginTop: 'auto', borderTop: '1px solid var(--hairline)', paddingTop: 10 }}>
                    <button
                      onClick={() => setExpandedRiskId(isExpanded ? null : risk.disease)}
                      style={{
                        background: 'none', border: 'none', padding: 0,
                        color: 'var(--accent)', cursor: 'pointer',
                        fontSize: 'var(--text-xs)', fontWeight: 600,
                        display: 'flex', alignItems: 'center', gap: 4,
                        fontFamily: 'inherit'
                      }}
                    >
                      {isExpanded ? t('hideRiskFactors') : t('explainRiskFactors')}
                    </button>

                    {isExpanded && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                        {risk.factors.length === 0 ? (
                          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', fontStyle: 'italic' }}>
                            No risk factors present.
                          </span>
                        ) : (
                          risk.factors.map((f, idx) => {
                            const typeColors = {
                              demographic: '#1f6fb3',
                              symptom: '#b46d11',
                              lifestyle: '#1f7a4d',
                              history: '#7c4a82',
                              vital: '#b3261e'
                            }[f.type];
                            return (
                              <div
                                key={idx}
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  padding: '4px 8px',
                                  background: 'var(--surface-sunken)',
                                  borderRadius: 'var(--r-1)',
                                  fontSize: 'var(--text-xs)'
                                }}
                              >
                                <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ink-2)' }}>
                                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: typeColors }} />
                                  {f.name}
                                </span>
                                <span className="num" style={{ fontWeight: 500, color: 'var(--ink)' }}>
                                  +{f.impact}%
                                </span>
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {/* ============ AI report CTA ============ */}
      <Card pad="var(--sp-5)" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-5)', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: '60ch' }}>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-xl)', letterSpacing: '-0.018em', color: 'var(--ink)' }}>
            Clinical analysis
          </span>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-3)' }}>
            Generate a structured report and recommendations from this session's readings.
            {!getOpenRouterKey() && (
              <span style={{ display: 'block', marginTop: 3, fontSize: 'var(--text-xs)', color: 'var(--ink-4)' }}>
                ℹ️ No OpenRouter key configured. Reports will generate using the local clinical rule engine (or add key in{' '}
                <Link to="/settings" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
                  Settings
                </Link>
                ).
              </span>
            )}
          </span>
        </div>
        <Button
          variant="primary"
          size="lg"
          onClick={generateAIReport}
          disabled={isAnalyzing || !displayData?.hr}
          loading={isAnalyzing}
          leadingIcon={!isAnalyzing ? <FileText size={14} /> : undefined}
        >
          {isAnalyzing ? 'Analysing' : 'Generate report'}
        </Button>
      </Card>

      {/* ============ AI report panel ============ */}
      {analysisResult && (
        <Card pad="var(--sp-6)">
          {reportFallbackNotice && (
            <div
              style={{
                padding: 'var(--sp-4)',
                borderRadius: 'var(--r-2)',
                background: 'var(--warn-soft)',
                border: '1px solid color-mix(in oklab, var(--warn) 25%, transparent)',
                color: 'var(--warn)',
                fontSize: 'var(--text-sm)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                marginBottom: 'var(--sp-4)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <AlertCircle size={18} strokeWidth={1.8} style={{ flexShrink: 0 }} />
                <span>
                  <strong>Clinical Screening Engine:</strong> {reportFallbackNotice}
                </span>
              </div>
              <Link
                to="/settings"
                style={{
                  color: 'var(--accent)',
                  fontWeight: 600,
                  fontSize: 'var(--text-xs)',
                  textDecoration: 'underline',
                  whiteSpace: 'nowrap',
                }}
              >
                Open Settings →
              </Link>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 'var(--sp-4)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <SectionHeader eyebrow="Report" title="Clinical analysis" />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="secondary" size="md" onClick={handlePrintReport} leadingIcon={<FileText size={14} />}>
                Print PDF
              </Button>
              <Button variant="secondary" size="md" onClick={() => setIsModalOpen(true)} leadingIcon={<Mail size={14} />}>
                Email PDF
              </Button>
            </div>
          </div>

          <div
            style={{
              padding: 'var(--sp-4)',
              borderRadius: 'var(--r-2)',
              background: 'var(--warn-soft)',
              border: '1px solid color-mix(in oklab, var(--warn) 22%, transparent)',
              color: 'var(--warn)',
              fontSize: 'var(--text-sm)',
              display: 'flex',
              gap: 10,
              marginBottom: 'var(--sp-5)',
            }}
          >
            <AlertTriangle size={16} strokeWidth={1.8} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              <strong>Screening only.</strong> This device does not replace professional medical evaluation. Use to inform, not to diagnose.
            </span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '160px minmax(0, 1fr)',
              gap: 'var(--sp-5)',
              alignItems: 'center',
              padding: 'var(--sp-5)',
              borderRadius: 'var(--r-3)',
              background: 'var(--surface-tint)',
              border: '1px solid var(--hairline)',
              marginBottom: 'var(--sp-5)',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--ink-3)', fontWeight: 500 }}>
                Health score
              </span>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span
                  className="num"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 500,
                    fontSize: 56,
                    letterSpacing: '-0.04em',
                    color: analysisResult.healthScore >= 7.5 ? 'var(--success)' : 'var(--warn)',
                    lineHeight: 1,
                  }}
                >
                  {analysisResult.healthScore}
                </span>
                <span className="num" style={{ color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>/10</span>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
                  Clinical Evaluation
                </span>
                <SpeechButton
                  text={`Clinical health report: Overall health score is ${analysisResult.healthScore} out of 10. ${analysisResult.summary}. Recommendations include: ${analysisResult.recommendations?.join('. ')}`}
                  label="Listen to Report"
                  size="sm"
                />
              </div>
              <div style={{ fontSize: 'var(--text-md)', color: 'var(--ink-2)', lineHeight: 1.6 }}>
                {analysisResult.summary}
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
            {analysisResult.findings?.length > 0 && (
              <ReportBlock title="Findings">
                <div style={{ display: 'grid', gap: 8 }}>
                  {analysisResult.findings.map((f: LiveReportFinding, i: number) => {
                    const tone = f.status === 'abnormal' ? 'error' : f.status === 'borderline' ? 'warn' : 'success';
                    const colors = {
                      success: { bg: 'var(--success-soft)', fg: 'var(--success)' },
                      warn:    { bg: 'var(--warn-soft)',    fg: 'var(--warn)' },
                      error:   { bg: 'var(--error-soft)',   fg: 'var(--error)' },
                    }[tone];
                    return (
                      <div
                        key={i}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '140px 120px minmax(0, 1fr)',
                          gap: 12,
                          alignItems: 'center',
                          padding: '10px 14px',
                          borderRadius: 'var(--r-2)',
                          background: colors.bg,
                          border: `1px solid color-mix(in oklab, ${colors.fg} 22%, transparent)`,
                        }}
                      >
                        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: colors.fg, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                          {formatFindingLabel(String(f.parameter ?? 'PARAMETER'))}
                        </span>
                        <span className="num" style={{ color: 'var(--ink)' }}>{f.value}</span>
                        <span style={{ color: 'var(--ink-2)', fontSize: 'var(--text-sm)' }}>{f.interpretation}</span>
                      </div>
                    );
                  })}
                </div>
              </ReportBlock>
            )}

            {analysisResult.recommendations?.length > 0 && (
              <ReportBlock title="Recommendations" tone="success">
                <ul style={{ paddingLeft: 20, color: 'var(--ink-2)', lineHeight: 1.7, display: 'grid', gap: 4 }}>
                  {analysisResult.recommendations.map((r: string, i: number) => <li key={i}>{r}</li>)}
                </ul>
              </ReportBlock>
            )}

            {analysisResult.warnings?.length > 0 && (
              <ReportBlock title="Warnings" tone="error">
                <ul style={{ paddingLeft: 20, color: 'var(--error)', lineHeight: 1.7, display: 'grid', gap: 4 }}>
                  {analysisResult.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}
                </ul>
              </ReportBlock>
            )}

            {analysisResult.disclaimer && (
              <p style={{ color: 'var(--ink-3)', fontSize: 'var(--text-sm)', fontStyle: 'italic', marginTop: 4 }}>
                {analysisResult.disclaimer}
              </p>
            )}
          </div>
        </Card>
      )}

      {/* ============ Chat ============ */}
      <AIAssistantChat
        biomarkerData={displayData as Record<string, unknown>}
        patient={activePatientId ? (() => {
          const p = patients.find((pt) => pt.id === activePatientId);
          return p ? { name: p.name, age: p.age, sex: p.sex } : null;
        })() : null}
      />

      {/* ============ Email modal ============ */}
      {isModalOpen && (() => {
        const patient = patients.find((p) => p.id === activePatientId);
        return (
          <ModalShell onClose={() => setIsModalOpen(false)}>
            <ModalHead eyebrow="Send report" title="Email PDF report" onClose={() => setIsModalOpen(false)} />
            <div style={{ padding: 'var(--sp-5) var(--sp-6)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
              <Card pad="var(--sp-4)" tone="sunken" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <Row label="Patient" value={patient?.name ?? 'N/A'} />
                <Row label="Age" value={String(patient?.age ?? 'N/A')} />
              </Card>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 600 }}>
                  Recipient email
                </span>
                <input
                  type="email"
                  placeholder="doctor@clinic.com"
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  autoFocus
                />
              </label>
            </div>
            <ModalFoot>
              <Button variant="ghost" onClick={() => { setIsModalOpen(false); setRecipientEmail(''); }} disabled={isSendingEmail} block>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={triggerPdfEmail}
                disabled={isSendingEmail || !recipientEmail}
                loading={isSendingEmail}
                leadingIcon={!isSendingEmail && <Send size={14} />}
                block
              >
                {isSendingEmail ? 'Sending' : 'Send PDF'}
              </Button>
            </ModalFoot>
          </ModalShell>
        );
      })()}

      {/* ============ Patient picker modal ============ */}
      {showPatientPicker && (
        <ModalShell onClose={() => setShowPatientPicker(false)}>
          <ModalHead eyebrow="Select patient" title="Who are we recording?" onClose={() => setShowPatientPicker(false)} />
          <div style={{ padding: 'var(--sp-5) var(--sp-6)', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
            {patients.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                <Eyebrow>Existing patients</Eyebrow>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {patients.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => startScanWithPatient(p)}
                      style={{
                        width: '100%', padding: '12px 16px', borderRadius: 'var(--r-2)', cursor: 'pointer',
                        background: 'var(--surface)', border: '1px solid var(--hairline)',
                        color: 'var(--ink)', textAlign: 'left',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        fontFamily: 'inherit',
                        transition: 'background-color var(--t-2) var(--ease), border-color var(--t-2) var(--ease)',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-soft)'; e.currentTarget.style.borderColor = 'var(--accent-soft-2)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface)'; e.currentTarget.style.borderColor = 'var(--hairline)'; }}
                    >
                      <span style={{ fontWeight: 600 }}>{p.name}</span>
                      <span className="num" style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-3)' }}>
                        {p.age}y · {p.sex}
                      </span>
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0' }}>
                  <div style={{ flex: 1, height: 1, background: 'var(--hairline)' }} />
                  <Eyebrow>Or add new</Eyebrow>
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
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button variant="secondary" size="sm" onClick={requestAccurateLocation} loading={isLocating} leadingIcon={!isLocating && <MapPin size={14} />}>
                  {isLocating ? 'Locating' : 'Use current location'}
                </Button>
                {newLatitude && newLongitude && (
                  <Button
                    variant="secondary" size="sm"
                    onClick={async () => {
                      const lat = parseFloat(newLatitude); const lon = parseFloat(newLongitude);
                      if (!isNaN(lat) && !isNaN(lon)) await geocodeCoordinates(lat, lon);
                    }}
                    loading={isGeocoding}
                    leadingIcon={!isGeocoding && <Locate size={14} />}
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
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}
                >
                  <AlertCircle size={14} strokeWidth={1.8} />
                  <span>{locationError}</span>
                </div>
              )}
            </div>
          </div>
          <ModalFoot>
            <Button variant="ghost" onClick={() => setShowPatientPicker(false)} block>Cancel</Button>
            <Button
              variant="primary"
              onClick={handleAddAndStart}
              disabled={!newName.trim() || !newAge.trim()}
              leadingIcon={!(!newName.trim() || !newAge.trim()) && <UserPlus size={15} />}
              block
            >
              Add &amp; start
            </Button>
          </ModalFoot>
        </ModalShell>
      )}

      {/* unused-import guard for kept lucide icons */}
      <span style={{ display: 'none' }}>
        <CheckCircle2 /><Square />
      </span>
    </motion.div>
  );
};

// ---------------- helpers ----------------

const Eyebrow: React.FC<React.PropsWithChildren> = ({ children }) => (
  <span
    style={{
      fontSize: 'var(--text-xs)', color: 'var(--ink-3)',
      textTransform: 'uppercase', letterSpacing: '0.14em', fontWeight: 500,
    }}
  >
    {children}
  </span>
);

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-3)' }}>{label}</span>
    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink)', fontWeight: 500 }}>{value}</span>
  </div>
);

const ReportBlock: React.FC<React.PropsWithChildren<{ title: string; tone?: 'success' | 'error' }>> = ({
  title, tone, children,
}) => {
  const bg = tone === 'success' ? 'var(--success-soft)' :
             tone === 'error'   ? 'var(--error-soft)'   :
             'var(--surface-tint)';
  const ring = tone === 'success' ? 'color-mix(in oklab, var(--success) 22%, transparent)' :
               tone === 'error'   ? 'color-mix(in oklab, var(--error) 22%, transparent)'   :
               'var(--hairline)';
  const fg = tone === 'success' ? 'var(--success)' :
             tone === 'error'   ? 'var(--error)'   :
             'var(--ink)';
  return (
    <div style={{ background: bg, border: `1px solid ${ring}`, borderRadius: 'var(--r-3)', padding: 'var(--sp-4) var(--sp-5)' }}>
      <div style={{ fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 600, color: fg, marginBottom: 10 }}>
        {title}
      </div>
      {children}
    </div>
  );
};

// Modal primitives (local to keep file self-contained)
const ModalShell: React.FC<React.PropsWithChildren<{ onClose: () => void }>> = ({ onClose, children }) => (
  <div
    style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(11, 11, 12, 0.42)',
      backdropFilter: 'blur(2px)',
      padding: 'var(--sp-4)',
    }}
    onClick={onClose}
  >
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      onClick={(e) => e.stopPropagation()}
      style={{
        width: '100%', maxWidth: 560, maxHeight: '88vh',
        background: 'var(--surface)',
        border: '1px solid var(--hairline)',
        borderRadius: 'var(--r-3)',
        boxShadow: 'var(--shadow-pop)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      {children}
    </motion.div>
  </div>
);

const ModalHead: React.FC<{ eyebrow: string; title: string; onClose: () => void }> = ({ eyebrow, title, onClose }) => (
  <div
    style={{
      padding: 'var(--sp-5) var(--sp-6)',
      borderBottom: '1px solid var(--hairline)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}
  >
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.14em', fontWeight: 500 }}>
        {eyebrow}
      </span>
      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-xl)', letterSpacing: '-0.018em', fontWeight: 400 }}>
        {title}
      </h3>
    </div>
    <IconButton onClick={onClose} aria-label="Close">
      <X size={16} strokeWidth={1.6} />
    </IconButton>
  </div>
);

const ModalFoot: React.FC<React.PropsWithChildren> = ({ children }) => (
  <div
    style={{
      padding: 'var(--sp-4) var(--sp-6)',
      borderTop: '1px solid var(--hairline)',
      background: 'var(--surface-tint)',
      display: 'flex',
      gap: 'var(--sp-3)',
    }}
  >
    {children}
  </div>
);

export default LiveRecording;
