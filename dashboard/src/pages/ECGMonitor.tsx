import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Bluetooth,
  BluetoothOff,
  Play,
  Square,
  Download,
  RefreshCw,
  Trash2,
  HeartPulse,
  Sparkles,
  Save,
  Check,
} from 'lucide-react';
import { useBLE, BLEStatus, EcgState } from '../contexts/BLEContext';
import { Card, Button, Pill, KpiTile, SectionHeader } from '../components/ui';
import ECGWaveform from '../components/ECGWaveform';
import EcgAnalysisCard from '../components/EcgAnalysisCard';
import LocalEcgHistory from '../components/LocalEcgHistory';
import type { ProcessedECGResult } from '../utils/ecgFilter';
import { generateDemoDeviceEcg } from '../utils/demoEcg';
import { analyzeEcg, generateClientSideEcgAnalysis } from '../services/ecgAnalysis';
import type { EcgAnalysisResult } from '../services/ecgAnalysis';
import { rhythmLabel } from '../services/ecgAnalysis';
import {
  saveLocalEcgRecord,
  getLocalEcgRecords,
  deleteLocalEcgRecord,
  clearAllLocalEcgRecords,
} from '../utils/ecgStorage';
import type { StoredEcgRecord } from '../utils/ecgStorage';

type Tone = 'neutral' | 'accent' | 'success' | 'warn' | 'error';

const STATE_META: Record<number, { label: string; tone: Tone }> = {
  [EcgState.IDLE]:         { label: 'Idle',         tone: 'neutral' },
  [EcgState.RECORDING]:    { label: 'Recording',    tone: 'warn' },
  [EcgState.READY]:        { label: 'Ready',        tone: 'success' },
  [EcgState.TRANSFERRING]: { label: 'Transferring', tone: 'accent' },
  [EcgState.ERROR]:        { label: 'Error',        tone: 'error' },
};

const DURATIONS = [10, 30, 60];

const ECGMonitor: React.FC = () => {
  const {
    status, connect, disconnect,
    ecgStatus, ecgWaveform, ecgProgress, ecgBusy,
    ecgStart, ecgStop, ecgClear, ecgFetch,
  } = useBLE();

  const [duration, setDuration] = useState(30);
  const [demoWaveform, setDemoWaveform] = useState<number[] | null>(null);
  const [processedStats, setProcessedStats] = useState<ProcessedECGResult | null>(null);
  const [analysis, setAnalysis] = useState<EcgAnalysisResult | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [savedRecords, setSavedRecords] = useState<StoredEcgRecord[]>([]);
  const [savingRecord, setSavingRecord] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const analyzedKeyRef = useRef('');

  // Load saved records from local IndexedDB on mount
  useEffect(() => {
    getLocalEcgRecords().then(setSavedRecords).catch(console.error);
  }, []);

  const activeWaveform = demoWaveform ?? ecgWaveform;

  const runAnalysis = useCallback(async () => {
    if (activeWaveform.length < 100) return;
    setAnalysisLoading(true);
    setAnalysisError(null);
    try {
      const result = await analyzeEcg(activeWaveform, ecgStatus.fs || 1000);
      setAnalysis(result);
    } catch (e) {
      if (processedStats && processedStats.totalBeats > 0) {
        const clientResult = generateClientSideEcgAnalysis(
          activeWaveform,
          ecgStatus.fs || 1000,
          processedStats
        );
        setAnalysis(clientResult);
      } else {
        setAnalysisError(e instanceof Error ? e.message : 'unknown error');
      }
    } finally {
      setAnalysisLoading(false);
    }
  }, [activeWaveform, ecgStatus.fs, processedStats]);

  // Auto-run once a fresh waveform arrives (guard against re-runs on re-render).
  useEffect(() => {
    if (activeWaveform.length < 100) {
      setAnalysis(null);
      analyzedKeyRef.current = '';
      return;
    }
    const key = `${activeWaveform.length}:${activeWaveform[0]}:${activeWaveform[activeWaveform.length - 1]}`;
    if (key === analyzedKeyRef.current) return;
    analyzedKeyRef.current = key;
    void runAnalysis();
  }, [activeWaveform, runAnalysis]);

  const isConnected =
    status === BLEStatus.CONNECTED ||
    status === BLEStatus.IDLE ||
    status === BLEStatus.SCANNING ||
    status === BLEStatus.SCANNING_BP;
  const isConnecting = status === BLEStatus.CONNECTING;
  const recording = ecgStatus.state === EcgState.RECORDING;
  const ready = ecgStatus.state === EcgState.READY;
  const meta = demoWaveform
    ? { label: 'Sample loaded', tone: 'accent' as Tone }
    : (STATE_META[ecgStatus.state] ?? STATE_META[EcgState.IDLE]);

  // Once a scan finishes, pull the buffered waveform automatically.
  useEffect(() => {
    if (ready && ecgStatus.count > 0 && ecgWaveform.length === 0 && !ecgBusy) {
      setDemoWaveform(null);
      ecgFetch();
    }
  }, [ready, ecgStatus.count, ecgWaveform.length, ecgBusy, ecgFetch]);

  const downloadCsv = () => {
    const fs = ecgStatus.fs || 1000;
    const hasFiltered = processedStats && processedStats.filtered.length > 0;
    const rows = ['time_ms,ecg_clean,ecg_raw,r_peak'];

    if (hasFiltered) {
      const p = processedStats!;
      const rPeakSet = new Set(p.rPeaks);
      for (let i = 0; i < p.filtered.length; i++) {
        const timeMs = Math.round((p.cropStartTimeSec + i / p.fs) * 1000);
        const cleanVal = Math.round(p.filtered[i]);
        const rawVal = Math.round(p.raw[i] ?? 0);
        const isPeak = rPeakSet.has(i) ? 1 : 0;
        rows.push(`${timeMs},${cleanVal},${rawVal},${isPeak}`);
      }
    } else {
      for (let i = 0; i < activeWaveform.length; i++) {
        rows.push(`${Math.round((i * 1000) / fs)},,${activeWaveform[i]},0`);
      }
    }

    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ecg_cleaned_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveLocal = async () => {
    if (activeWaveform.length < 100 || !analysis) return;
    setSavingRecord(true);
    try {
      const newRec = await saveLocalEcgRecord({
        samples: activeWaveform,
        fs: ecgStatus.fs || 1000,
        analysis,
      });
      setSavedRecords((prev) => [newRec, ...prev.filter((r) => r.id !== newRec.id)]);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (err) {
      console.error('Failed to save ECG locally:', err);
    } finally {
      setSavingRecord(false);
    }
  };

  const handleLoadRecord = (rec: StoredEcgRecord) => {
    setDemoWaveform(rec.samples);
    setAnalysis(rec.analysis);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteRecord = async (id: string) => {
    await deleteLocalEcgRecord(id);
    setSavedRecords((prev) => prev.filter((r) => r.id !== id));
  };

  const handleClearAllRecords = async () => {
    if (window.confirm('Delete all saved ECG recordings from this device?')) {
      await clearAllLocalEcgRecords();
      setSavedRecords([]);
    }
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
            Cardiac
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
            Single-lead <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>ECG</em>.
          </h1>
          <p style={{ color: 'var(--ink-3)', maxWidth: '60ch', fontSize: 'var(--text-md)' }}>
            Record an AD8232 waveform on the device, fetch the buffered trace over Bluetooth,
            and view the noise-filtered signal with precision zooming and analysis.
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
            leadingIcon={isConnecting ? undefined : isConnected ? <BluetoothOff size={16} /> : <Bluetooth size={16} />}
          >
            {isConnecting ? 'Connecting' : isConnected ? 'Disconnect' : 'Connect device'}
          </Button>
        </div>
      </header>

      {/* ===================== KPI strip ===================== */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: 'var(--sp-4)',
        }}
      >
        <KpiTile
          label="State"
          value={<Pill tone={meta.tone} dot size="sm">{meta.label}</Pill>}
          accent="var(--accent)"
        />
        <KpiTile
          label="Active duration"
          value={
            processedStats && processedStats.displaySamples.length > 0
              ? processedStats.totalDurationSec.toFixed(1)
              : analysis?.duration_s
              ? analysis.duration_s.toFixed(1)
              : ecgStatus.durationMs
              ? (ecgStatus.durationMs / 1000).toFixed(1)
              : demoWaveform
              ? (demoWaveform.length / 1000).toFixed(1)
              : '--'
          }
          unit="s"
        />
        <KpiTile label="Sample rate" value={ecgStatus.fs || 1000} unit="Hz" />
        <KpiTile
          label="Signal quality"
          value={analysis ? analysis.quality : '--'}
          hint={analysis ? (analysis.model_used ? 'ML model' : 'rule engine') : undefined}
        />
        <KpiTile
          label="Rhythm"
          value={analysis ? rhythmLabel(analysis.rhythm) : '--'}
          hint={analysis ? `${analysis.beats} beats analyzed` : 'run a scan'}
          accent="var(--accent)"
        />
      </div>

      {/* ===================== Body ===================== */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(280px, 320px) minmax(0, 1fr)',
          gap: 'var(--sp-6)',
          alignItems: 'stretch',
        }}
      >
        {/* -------- Controls -------- */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
          <SectionHeader eyebrow="Capture" title="Session" />
          <Card style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Duration
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                {DURATIONS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDuration(d)}
                    disabled={recording || ecgBusy}
                    style={{
                      flex: 1,
                      padding: '8px 0',
                      borderRadius: 'var(--r-2)',
                      border: `1px solid ${duration === d ? 'var(--accent)' : 'var(--hairline-strong)'}`,
                      background: duration === d ? 'var(--accent-soft)' : 'var(--surface)',
                      color: duration === d ? 'var(--accent)' : 'var(--ink-2)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-sm)',
                      cursor: recording || ecgBusy ? 'not-allowed' : 'pointer',
                      opacity: recording || ecgBusy ? 0.6 : 1,
                    }}
                  >
                    {d}s
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Button
                onClick={() => {
                  setDemoWaveform(null);
                  ecgStart(duration);
                }}
                disabled={!isConnected || recording || ecgBusy}
                leadingIcon={<Play size={16} />}
                block
              >
                {recording ? `Scanning… (${duration}s)` : 'Scan ECG'}
              </Button>
              <Button
                onClick={() => ecgStop()}
                disabled={!recording}
                variant="secondary"
                leadingIcon={<Square size={16} />}
                block
              >
                Stop
              </Button>
              <Button
                onClick={() => {
                  setDemoWaveform(null);
                  ecgFetch();
                }}
                disabled={!isConnected || !ready || ecgBusy}
                variant="secondary"
                leadingIcon={<RefreshCw size={16} />}
                loading={ecgBusy}
                block
              >
                Fetch waveform
              </Button>

              {activeWaveform.length < 2 && (
                <Button
                  onClick={() => setDemoWaveform(generateDemoDeviceEcg(ecgStatus.fs || 1000, 30))}
                  variant="secondary"
                  leadingIcon={<Sparkles size={16} />}
                  block
                  title="Load a realistic device waveform (30s) to preview noise filtering, cropping, and zooming"
                >
                  Load sample trace
                </Button>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <Button
                  onClick={downloadCsv}
                  disabled={activeWaveform.length < 2}
                  variant="ghost"
                  leadingIcon={<Download size={16} />}
                  style={{ flex: 1 }}
                  title="Export clean and raw ECG data as CSV"
                >
                  CSV
                </Button>
                <Button
                  onClick={() => {
                    setDemoWaveform(null);
                    ecgClear();
                    setProcessedStats(null);
                  }}
                  disabled={(!isConnected && !demoWaveform) || recording || ecgBusy}
                  variant="danger"
                  leadingIcon={<Trash2 size={16} />}
                  style={{ flex: 1 }}
                >
                  Clear
                </Button>
              </div>

              {activeWaveform.length >= 100 && analysis && (
                <Button
                  onClick={handleSaveLocal}
                  disabled={savingRecord}
                  variant="secondary"
                  leadingIcon={saveSuccess ? <Check size={16} /> : <Save size={16} />}
                  block
                  style={saveSuccess ? { borderColor: 'var(--success)', color: 'var(--success)' } : undefined}
                  title="Store waveform image and analysis locally on this device"
                >
                  {saveSuccess ? 'Saved to Device!' : savingRecord ? 'Saving…' : 'Save to Device (Local)'}
                </Button>
              )}
            </div>

            {(recording || ecgBusy || analysisLoading) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-xs)', color: 'var(--ink-3)' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }} />
                {recording
                  ? 'Recording on device…'
                  : ecgBusy
                  ? `Loading trace ${Math.round(ecgProgress * 100)}%`
                  : 'Running screening model…'}
              </div>
            )}

            {ecgBusy && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)' }}>
                  Fetching {Math.round(ecgProgress * 100)}%
                </span>
                <div style={{ height: 6, background: 'var(--surface-sunken)', borderRadius: 'var(--r-pill)', overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${Math.round(ecgProgress * 100)}%`,
                      height: '100%',
                      background: 'var(--accent)',
                      transition: 'width var(--t-2) var(--ease)',
                    }}
                  />
                </div>
              </div>
            )}
          </Card>

          <Card tone="sunken" style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <HeartPulse size={18} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} />
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', lineHeight: 1.5 }}>
              Single-lead screening trace. Initial settling spike (first 2s) and release
              transients (last 2s) are automatically cropped. 50/60 Hz powerline hum and
              baseline drift are filtered out using zero-phase DSP.
            </p>
          </Card>
        </section>

        {/* -------- Waveform -------- */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
          <SectionHeader
            eyebrow="Trace"
            title="Waveform"
            actions={
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {processedStats && processedStats.cropStartIndex > 0 && (
                  <Pill tone="neutral" size="sm">
                    Cropped 2s edges ({processedStats.cropStartTimeSec.toFixed(1)}s–{(processedStats.cropStartTimeSec + processedStats.totalDurationSec).toFixed(1)}s)
                  </Pill>
                )}
                <Pill tone={activeWaveform.length > 1 ? 'accent' : 'neutral'} size="sm">
                  {activeWaveform.length > 1
                    ? `${processedStats?.displaySamples.length ?? activeWaveform.length} samples`
                    : 'awaiting capture'}
                </Pill>
              </div>
            }
          />
          <Card pad="var(--sp-4)" style={{ flex: 1 }}>
            <ECGWaveform
              rawSamples={activeWaveform}
              fs={ecgStatus.fs || 1000}
              height={360}
              emptyLabel={recording ? 'Recording… waveform available after the scan' : 'No waveform yet'}
              onProcessed={setProcessedStats}
            />
          </Card>
        </section>
      </div>

      {/* ===================== ML analysis ===================== */}
      <EcgAnalysisCard
        result={analysis}
        loading={analysisLoading}
        error={analysisError}
        hasWaveform={activeWaveform.length >= 100}
        onAnalyze={() => void runAnalysis()}
        samples={activeWaveform}
        fs={ecgStatus.fs || 1000}
      />

      {/* ===================== Local Device Storage History ===================== */}
      <LocalEcgHistory
        records={savedRecords}
        onLoadRecord={handleLoadRecord}
        onDeleteRecord={handleDeleteRecord}
        onClearAll={handleClearAllRecords}
      />
    </motion.div>
  );
};

export default ECGMonitor;
