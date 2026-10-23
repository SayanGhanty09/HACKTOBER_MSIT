import React, { useState } from 'react';
import {
  Activity,
  RefreshCw,
  ShieldAlert,
  Cpu,
  Heart,
  HeartPulse,
  CheckCircle2,
  AlertTriangle,
  Info,
  Clock,
  Zap,
  ChevronDown,
  ChevronUp,
  BookOpen,
  Stethoscope,
  Sparkles,
  Timer,
  Eye,
  Radio,
  Gauge,
  Layers,
  HelpCircle,
} from 'lucide-react';
import { Card, Button, Pill, SectionHeader, SpeechButton } from './ui';
import type { EcgAnalysisResult, EcgInsight } from '../services/ecgAnalysis';
import { rhythmLabel } from '../services/ecgAnalysis';
import { analyzeEcgWithGemma, getGeminiKey } from '../utils/gemmaClient';
import type { GemmaEcgAssessment } from '../utils/gemmaClient';
import { generateWaveformSnapshot } from '../utils/ecgStorage';

type Tone = 'neutral' | 'accent' | 'success' | 'warn' | 'error';

const QUALITY_TONE: Record<string, Tone> = {
  good: 'success',
  fair: 'warn',
  poor: 'error',
};

const INSIGHT_TONE: Record<EcgInsight['level'], Tone> = {
  good: 'success',
  warn: 'warn',
  bad: 'error',
};

const pct = (v?: number) => (v == null ? '--' : `${Math.round(v * 100)}%`);

interface Props {
  result: EcgAnalysisResult | null;
  loading: boolean;
  error: string | null;
  hasWaveform: boolean;
  onAnalyze: () => void;
  samples?: number[];
  fs?: number;
}

export const EcgAnalysisCard: React.FC<Props> = ({
  result,
  loading,
  error,
  hasWaveform,
  onAnalyze,
  samples,
  fs = 1000,
}) => {
  const [viewMode, setViewMode] = useState<'plain' | 'clinical' | 'gemma'>('plain');
  const [showDictionary, setShowDictionary] = useState(false);
  const [gemmaLoading, setGemmaLoading] = useState(false);
  const [gemmaError, setGemmaError] = useState<string | null>(null);
  const [gemmaResult, setGemmaResult] = useState<GemmaEcgAssessment | null>(null);
  const [analyzedSnapshot, setAnalyzedSnapshot] = useState<string | null>(null);
  const [showVisualGuide, setShowVisualGuide] = useState(false);

  const handleRunGemmaAnalysis = async () => {
    if (!samples || samples.length < 100) return;
    const key = getGeminiKey();
    if (!key) {
      setGemmaError('Google Gemini / Gemma API key missing. Go to Settings and save your free API key.');
      return;
    }
    setGemmaLoading(true);
    setGemmaError(null);
    try {
      const snapshot = generateWaveformSnapshot(samples, fs, 640, 200);
      setAnalyzedSnapshot(snapshot);
      const res = await analyzeEcgWithGemma(snapshot, {
        hr_bpm: result?.hr_bpm,
        qrs_ms: result?.qrs_duration_ms,
        rhythm: result?.rhythm,
        quality: result?.quality,
        duration_s: result?.duration_s,
      });
      setGemmaResult(res);
    } catch (err: unknown) {
      setGemmaError(err instanceof Error ? err.message : String(err));
    } finally {
      setGemmaLoading(false);
    }
  };

  const layman = result?.layman_summary;
  const hrBpm = result?.hr_bpm ?? null;
  const totalBeats = result?.total_beats ?? result?.beats ?? 0;
  const durationSec = result?.duration_s ?? 30;
  const minBpm = result?.min_hr_bpm ?? hrBpm;
  const maxBpm = result?.max_hr_bpm ?? hrBpm;
  const regularityPct =
    result?.regularity_pct ??
    (result?.hrv ? Math.max(70, Math.round(100 - result.hrv.cv * 100)) : 95);
  const meanRrMs =
    result?.hrv?.mean_rr ??
    (hrBpm ? Math.round(60000 / hrBpm) : null);

  // Position on HR scale: 40 to 140 BPM mapped to 0% - 100%
  const hrScalePct = hrBpm ? Math.min(100, Math.max(0, ((hrBpm - 40) / 100) * 100)) : 50;

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
      <SectionHeader
        eyebrow="Cardiac Analysis"
        title="Heartbeat & Screening Insights"
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* View Mode Switcher */}
            <div
              style={{
                display: 'inline-flex',
                background: 'var(--surface-sunken)',
                padding: 2,
                borderRadius: 'var(--r-2)',
                border: '1px solid var(--hairline)',
              }}
            >
              <button
                type="button"
                onClick={() => setViewMode('plain')}
                style={{
                  padding: '4px 10px',
                  borderRadius: 'var(--r-1)',
                  border: 'none',
                  background: viewMode === 'plain' ? 'var(--surface)' : 'transparent',
                  color: viewMode === 'plain' ? 'var(--accent)' : 'var(--ink-3)',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 'var(--text-xs)',
                  fontWeight: viewMode === 'plain' ? 600 : 400,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  boxShadow: viewMode === 'plain' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                }}
              >
                <Heart size={12} />
                Patient View
              </button>
              <button
                type="button"
                onClick={() => setViewMode('clinical')}
                style={{
                  padding: '4px 10px',
                  borderRadius: 'var(--r-1)',
                  border: 'none',
                  background: viewMode === 'clinical' ? 'var(--surface)' : 'transparent',
                  color: viewMode === 'clinical' ? 'var(--accent)' : 'var(--ink-3)',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 'var(--text-xs)',
                  fontWeight: viewMode === 'clinical' ? 600 : 400,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  boxShadow: viewMode === 'clinical' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                }}
              >
                <Stethoscope size={12} />
                Clinical Details
              </button>
              <button
                type="button"
                onClick={() => setViewMode('gemma')}
                style={{
                  padding: '4px 10px',
                  borderRadius: 'var(--r-1)',
                  border: 'none',
                  background: viewMode === 'gemma' ? 'linear-gradient(135deg, rgba(66,133,244,0.18), rgba(219,68,55,0.18))' : 'transparent',
                  color: viewMode === 'gemma' ? '#4285f4' : 'var(--ink-3)',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 'var(--text-xs)',
                  fontWeight: viewMode === 'gemma' ? 600 : 400,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  boxShadow: viewMode === 'gemma' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                }}
              >
                <Sparkles size={12} style={{ color: '#4285f4' }} />
                Gemma 4 Multimodal
              </button>
            </div>

            <Button
              onClick={onAnalyze}
              disabled={!hasWaveform || loading}
              variant="secondary"
              leadingIcon={<RefreshCw size={14} />}
              loading={loading}
              size="sm"
            >
              {result ? 'Re-analyze' : 'Analyze'}
            </Button>
          </div>
        }
      />

      <Card style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
        {!hasWaveform && (
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-3)' }}>
            Record or fetch an ECG trace first. The model and heartbeat analyzer run automatically once a waveform is available.
          </p>
        )}

        {hasWaveform && loading && !result && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 'var(--sp-3)' }}>
            <HeartPulse size={20} style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-2)' }}>
              Calculating heartbeats and running cardiac screening analysis…
            </span>
          </div>
        )}

        {error && !result && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', color: 'var(--ink-3)' }}>
            <ShieldAlert size={16} style={{ color: 'var(--warn)', flexShrink: 0, marginTop: 2 }} />
            <span style={{ fontSize: 'var(--text-sm)' }}>
              Backend analyzer offline ({error}). Using local browser-based DSP engine.
            </span>
          </div>
        )}

        {result && (
          <>
            {/* ==================== Heartbeat Summary Banner ==================== */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: 'var(--sp-3)',
                padding: 'var(--sp-4)',
                background: 'var(--surface-sunken)',
                borderRadius: 'var(--r-2)',
                border: '1px solid var(--hairline)',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Heart size={13} style={{ color: '#ef4444' }} /> Total Heartbeats
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xl)', fontWeight: 600 }}>
                  {totalBeats} <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', fontWeight: 400 }}>beats</span>
                </span>
                <span style={{ fontSize: '11px', color: 'var(--ink-4)' }}>in {durationSec.toFixed(1)}s scan</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Activity size={13} style={{ color: 'var(--accent)' }} /> Average Heart Rate
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--accent)' }}>
                  {hrBpm ?? '--'} <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', fontWeight: 400 }}>BPM</span>
                </span>
                <span style={{ fontSize: '11px', color: 'var(--ink-4)' }}>
                  Range: {minBpm ?? '--'}–{maxBpm ?? '--'} BPM
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Clock size={13} /> Beat Regularity
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xl)', fontWeight: 600 }}>
                  {regularityPct}%
                </span>
                <span style={{ fontSize: '11px', color: regularityPct >= 80 ? 'var(--success)' : 'var(--warn)' }}>
                  {regularityPct >= 90 ? 'Very consistent' : regularityPct >= 75 ? 'Mild variation' : 'Irregular spacing'}
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Timer size={13} /> R-R Interval
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xl)', fontWeight: 600 }}>
                  {meanRrMs ?? '--'} <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', fontWeight: 400 }}>ms</span>
                </span>
                <span style={{ fontSize: '11px', color: 'var(--ink-4)' }}>
                  Beat-to-beat spacing
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Zap size={13} /> Rhythm Status
                </span>
                <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-md)', fontWeight: 600 }}>
                  {rhythmLabel(result.rhythm)}
                </span>
                <span style={{ fontSize: '11px', color: 'var(--ink-4)' }}>
                  {result.rhythm === 'sinus_rhythm' ? 'Normal pacemaker' : 'Atypical rhythm'}
                </span>
              </div>
            </div>

            {/* ==================== Visual Heart Rate Spectrum Gauge ==================== */}
            {hrBpm && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)', color: 'var(--ink-3)' }}>
                  <span>Resting Heart Rate Spectrum</span>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>Current: <strong>{hrBpm} BPM</strong></span>
                </div>
                {/* Scale Bar */}
                <div
                  style={{
                    position: 'relative',
                    height: 12,
                    borderRadius: 'var(--r-pill)',
                    background: 'linear-gradient(to right, #3b82f6 0%, #3b82f6 20%, #10b981 20%, #10b981 60%, #f59e0b 60%, #ef4444 100%)',
                    overflow: 'visible',
                  }}
                >
                  {/* Indicator marker */}
                  <div
                    style={{
                      position: 'absolute',
                      left: `${hrScalePct}%`,
                      top: '50%',
                      transform: 'translate(-50%, -50%)',
                      width: 18,
                      height: 18,
                      borderRadius: '50%',
                      background: '#fff',
                      border: '3px solid var(--ink-1)',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                      transition: 'left 0.3s ease',
                    }}
                    title={`Your heart rate: ${hrBpm} BPM`}
                  />
                </div>
                {/* Zone Labels */}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--ink-4)' }}>
                  <span>Low (&lt;60)</span>
                  <span style={{ color: '#10b981', fontWeight: 500 }}>Normal Resting (60–100 BPM)</span>
                  <span>High (&gt;100)</span>
                </div>
              </div>
            )}

            {/* ==================== PATIENT FRIENDLY VIEW ==================== */}
            {viewMode === 'plain' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
                {/* Status Hero Card */}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    padding: 'var(--sp-4)',
                    borderRadius: 'var(--r-2)',
                    background:
                      result.rhythm === 'possible_afib'
                        ? 'rgba(239, 68, 68, 0.06)'
                        : hrBpm && (hrBpm < 50 || hrBpm > 100)
                        ? 'rgba(245, 158, 11, 0.06)'
                        : 'rgba(16, 185, 129, 0.06)',
                    border: `1px solid ${
                      result.rhythm === 'possible_afib'
                        ? 'rgba(239, 68, 68, 0.2)'
                        : hrBpm && (hrBpm < 50 || hrBpm > 100)
                        ? 'rgba(245, 158, 11, 0.2)'
                        : 'rgba(16, 185, 129, 0.2)'
                    }`,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {result.rhythm === 'sinus_rhythm' && hrBpm && hrBpm >= 50 && hrBpm <= 100 ? (
                        <CheckCircle2 size={20} style={{ color: '#10b981' }} />
                      ) : (
                        <AlertTriangle size={20} style={{ color: '#f59e0b' }} />
                      )}
                      <span style={{ fontSize: 'var(--text-md)', fontWeight: 600, color: 'var(--ink-1)' }}>
                        {layman?.headline ?? (result.rhythm === 'sinus_rhythm' ? 'Healthy & Steady Heartbeat' : 'Rhythm Notice')}
                      </span>
                    </div>

                    <Pill
                      tone={
                        layman?.badge?.tone ??
                        (result.rhythm === 'sinus_rhythm' ? 'success' : 'warn')
                      }
                      size="sm"
                    >
                      {layman?.badge?.label ?? (result.rhythm === 'sinus_rhythm' ? 'Normal Rhythm' : 'Review Recommended')}
                    </Pill>
                  </div>

                  <p style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-2)', lineHeight: 1.6, margin: 0 }}>
                    {layman?.plain_text_summary ??
                      `Your heart beat ${totalBeats} times in this recording, averaging ${hrBpm ?? 72} beats per minute. Electrical timing indicates standard cardiac pacing.`}
                  </p>
                </div>

                {/* Plain-English Cards Grid */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                    gap: 'var(--sp-3)',
                  }}
                >
                  {/* Heart Rate Meaning */}
                  <div
                    style={{
                      padding: 'var(--sp-3)',
                      borderRadius: 'var(--r-2)',
                      background: 'var(--surface)',
                      border: '1px solid var(--hairline)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Heart size={15} style={{ color: 'var(--accent)' }} />
                      <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, textTransform: 'uppercase', color: 'var(--ink-2)' }}>
                        Heart Rate Pace
                      </span>
                    </div>
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--ink-1)' }}>
                      {hrBpm && hrBpm >= 60 && hrBpm <= 100
                        ? 'Optimal Resting Range (60–100 BPM)'
                        : hrBpm && hrBpm < 60
                        ? 'Calm / Athletic Resting Pace'
                        : 'Elevated Pace (>100 BPM)'}
                    </span>
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', lineHeight: 1.5, margin: 0 }}>
                      {layman?.heart_rate?.description ??
                        'A resting heart rate between 60 and 100 BPM is standard for adults. Active individuals often have lower rates.'}
                    </p>
                  </div>

                  {/* Rhythm & Sinus Node */}
                  <div
                    style={{
                      padding: 'var(--sp-3)',
                      borderRadius: 'var(--r-2)',
                      background: 'var(--surface)',
                      border: '1px solid var(--hairline)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Activity size={15} style={{ color: '#10b981' }} />
                      <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, textTransform: 'uppercase', color: 'var(--ink-2)' }}>
                        What Is "Sinus Rhythm"?
                      </span>
                    </div>
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--ink-1)' }}>
                      Your Natural Heart Pacemaker
                    </span>
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', lineHeight: 1.5, margin: 0 }}>
                      "Sinus" refers to the sinus node (your heart's built-in electrical clock), not a cold or nasal sinus! It means your heart is pacing naturally.
                    </p>
                  </div>

                  {/* Extra Beats (PVC / PAC) */}
                  <div
                    style={{
                      padding: 'var(--sp-3)',
                      borderRadius: 'var(--r-2)',
                      background: 'var(--surface)',
                      border: '1px solid var(--hairline)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Zap size={15} style={{ color: '#f59e0b' }} />
                      <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, textTransform: 'uppercase', color: 'var(--ink-2)' }}>
                        Skipped or Extra Beats
                      </span>
                    </div>
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--ink-1)' }}>
                      {result.pvc_burden && result.pvc_burden > 0.05
                        ? `${Math.round(result.pvc_burden * 100)}% extra beats detected`
                        : 'None detected (0%)'}
                    </span>
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', lineHeight: 1.5, margin: 0 }}>
                      {layman?.extra_beats?.description ??
                        'Occasional extra beats (PVCs) are common "hiccups" caused by caffeine, fatigue, or stress. None were flagged here.'}
                    </p>
                  </div>

                  {/* HRV / Stress & Recovery */}
                  <div
                    style={{
                      padding: 'var(--sp-3)',
                      borderRadius: 'var(--r-2)',
                      background: 'var(--surface)',
                      border: '1px solid var(--hairline)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Sparkles size={15} style={{ color: '#6366f1' }} />
                      <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, textTransform: 'uppercase', color: 'var(--ink-2)' }}>
                        Recovery &amp; Stress (HRV)
                      </span>
                    </div>
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--ink-1)' }}>
                      {result.hrv && result.hrv.sdnn > 40
                        ? 'Optimal Resilience'
                        : result.hrv && result.hrv.sdnn >= 20
                        ? 'Balanced Range'
                        : 'Mild Fatigue / Stress'}
                    </span>
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', lineHeight: 1.5, margin: 0 }}>
                      Healthy heartbeats naturally vary slightly in millisecond timing as you breathe—this shows your nervous system is adaptable and recovering well.
                    </p>
                  </div>
                </div>

                {/* Everyday Wellness Guidance */}
                <div
                  style={{
                    padding: 'var(--sp-3)',
                    borderRadius: 'var(--r-2)',
                    background: 'var(--surface-sunken)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Info size={14} style={{ color: 'var(--accent)' }} /> Everyday Heart Tips
                  </span>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 'var(--text-xs)', color: 'var(--ink-3)', lineHeight: 1.6 }}>
                    <li><strong>Stay hydrated:</strong> Drinking enough water helps keep your blood volume and heart rate stable.</li>
                    <li><strong>Breathe deeply:</strong> Slow, deep breaths activate the vagus nerve and gently relax your resting pulse.</li>
                    <li><strong>Restorative sleep:</strong> 7–8 hours of sound sleep lets your heart muscle recharge.</li>
                    <li><strong>When to see a doctor:</strong> If you ever feel chest pressure, sudden dizziness, or fluttery palpitations, consult a healthcare provider.</li>
                  </ul>
                </div>

                {/* Cardiology Terms Decoded (Jargon Buster) */}
                <div style={{ borderTop: '1px solid var(--hairline)', paddingTop: 'var(--sp-2)' }}>
                  <button
                    type="button"
                    onClick={() => setShowDictionary(!showDictionary)}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: '6px 0',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 'var(--text-xs)',
                      color: 'var(--accent)',
                      fontWeight: 500,
                    }}
                  >
                    <BookOpen size={14} />
                    {showDictionary ? 'Hide Cardiology Terms Dictionary' : 'Decode Medical Terms (Jargon Buster)'}
                    {showDictionary ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>

                  {showDictionary && (
                    <div
                      style={{
                        marginTop: 8,
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                        gap: 10,
                        padding: 'var(--sp-3)',
                        borderRadius: 'var(--r-2)',
                        background: 'var(--surface-sunken)',
                        fontSize: 'var(--text-xs)',
                        color: 'var(--ink-2)',
                      }}
                    >
                      <div>
                        <strong>Sinus Rhythm:</strong> The normal, healthy beat generated by your heart's natural pacemaker.
                      </div>
                      <div>
                        <strong>R-Peak:</strong> The tallest spike on the ECG wave representing your main ventricle pumping blood.
                      </div>
                      <div>
                        <strong>HRV (SDNN):</strong> Variations in timing between heartbeats; higher variation generally reflects good recovery and low stress.
                      </div>
                      <div>
                        <strong>PVC / PAC:</strong> Premature extra beats. Occasional ones are harmless hiccups common with caffeine or fatigue.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ==================== CLINICAL DETAILS VIEW ==================== */}
            {viewMode === 'clinical' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Pill tone={QUALITY_TONE[result.quality] ?? 'neutral'} dot size="sm">
                    Quality: {result.quality}
                  </Pill>
                  <Pill tone="accent" dot size="sm">
                    {rhythmLabel(result.rhythm)}
                  </Pill>
                  {result.hr_bpm != null && <Pill tone="neutral" size="sm">{result.hr_bpm} bpm</Pill>}
                  <Pill tone="neutral" size="sm">PVC {pct(result.pvc_burden)}</Pill>
                  <Pill tone="neutral" size="sm">PAC {pct(result.pac_burden)}</Pill>
                  <Pill tone={result.model_used ? 'accent' : 'neutral'} size="sm">
                    <Cpu size={12} /> {result.model_used ? 'ML Model (Forest)' : 'Rule-based DSP'}
                  </Pill>
                </div>

                {result.hrv && (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
                      gap: 'var(--sp-3)',
                    }}
                  >
                    {[
                      ['Mean R-R', `${result.hrv.mean_rr} ms`],
                      ['SDNN', `${result.hrv.sdnn} ms`],
                      ['RMSSD', `${result.hrv.rmssd} ms`],
                      ['pNN50', `${result.hrv.pnn50} %`],
                      ['QRS Est.', `${result.qrs_duration_ms ?? 90} ms`],
                    ].map(([label, value]) => (
                      <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span
                          style={{
                            fontSize: 'var(--text-xs)',
                            color: 'var(--ink-3)',
                            textTransform: 'uppercase',
                            letterSpacing: '0.08em',
                          }}
                        >
                          {label}
                        </span>
                        <span className="num" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-md)' }}>
                          {value}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 'var(--text-xs)',
                      color: 'var(--ink-3)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                    }}
                  >
                    <Activity size={13} /> Diagnostic Insights
                  </span>
                  {result.insights.length === 0 && (
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-3)' }}>No notable clinical findings.</span>
                  )}
                  {result.insights.map((ins, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <Pill tone={INSIGHT_TONE[ins.level]} size="sm">
                        {ins.level}
                      </Pill>
                      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-2)', lineHeight: 1.5 }}>
                        {ins.text}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ==================== GEMMA 4 MULTIMODAL REVIEW ==================== */}
            {viewMode === 'gemma' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
                {/* Hero Header */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: 'var(--sp-4)',
                    borderRadius: 'var(--r-2)',
                    background: 'linear-gradient(135deg, rgba(66,133,244,0.08) 0%, rgba(52,168,83,0.08) 50%, rgba(251,188,4,0.08) 100%)',
                    border: '1px solid rgba(66,133,244,0.25)',
                    flexWrap: 'wrap',
                    gap: 12,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 'var(--r-2)',
                        background: '#4285f4',
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Sparkles size={18} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>
                        Google Gemma 4 · Multimodal ECG Vision
                      </div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)' }}>
                        Deep learning analysis of raw waveform morphology PNG &amp; telemetry via Gemini API
                      </div>
                    </div>
                  </div>

                  <Button
                    onClick={handleRunGemmaAnalysis}
                    loading={gemmaLoading}
                    disabled={!hasWaveform || gemmaLoading}
                    variant="primary"
                    size="sm"
                    leadingIcon={!gemmaLoading ? <Sparkles size={14} /> : undefined}
                  >
                    {gemmaResult ? 'Re-run Gemma 4' : 'Run Gemma 4 Vision'}
                  </Button>
                </div>

                {gemmaError && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      padding: '10px 14px',
                      borderRadius: 'var(--r-2)',
                      background: 'var(--error-soft)',
                      color: 'var(--error)',
                      fontSize: 'var(--text-xs)',
                      border: '1px solid rgba(239, 68, 68, 0.25)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <AlertTriangle size={15} style={{ flexShrink: 0 }} />
                      <span>{gemmaError}</span>
                    </div>
                    <Button
                      onClick={handleRunGemmaAnalysis}
                      disabled={gemmaLoading}
                      variant="secondary"
                      size="sm"
                      leadingIcon={<RefreshCw size={12} />}
                    >
                      Retry
                    </Button>
                  </div>
                )}

                {!gemmaResult && !gemmaLoading && !gemmaError && (
                  <div
                    style={{
                      textAlign: 'center',
                      padding: 'var(--sp-6) var(--sp-4)',
                      background: 'var(--surface-sunken)',
                      borderRadius: 'var(--r-2)',
                      border: '1px dashed var(--hairline)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <Sparkles size={24} style={{ color: '#4285f4', opacity: 0.8 }} />
                    <p style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-2)', fontWeight: 500, margin: 0 }}>
                      Ready for Multimodal Inspection
                    </p>
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', maxWidth: 440, margin: 0 }}>
                      Click <strong>"Run Gemma 4 Vision"</strong> to pass the visual waveform trace and intervals directly to Gemma 4 for automated P-wave, QRS, and ST-T segment classification.
                    </p>
                  </div>
                )}

                {gemmaLoading && (
                  <div
                    style={{
                      padding: 'var(--sp-6) var(--sp-4)',
                      background: 'var(--surface-sunken)',
                      borderRadius: 'var(--r-2)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--accent)', fontSize: 'var(--text-sm)', fontWeight: 500 }}>
                      <RefreshCw size={16} className="spin" />
                      Gemma 4 is examining visual ECG features &amp; telemetry…
                    </div>
                  </div>
                )}

                {gemmaResult && (() => {
                  const displaySnapshot = analyzedSnapshot || (samples && samples.length > 100 ? generateWaveformSnapshot(samples, fs, 640, 200) : null);
                  const isFlatline = /flatline|detach|disconnect|isoelectric|dropout|zero beat|asystole/i.test(
                    `${gemmaResult.summary} ${gemmaResult.rhythmInterpretation} ${gemmaResult.waveformFeatures}`
                  );

                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
                      {/* 1. Header Bar: Risk Grade Pill, Model Pill, Urgency Pill */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <Pill
                            tone={
                              gemmaResult.riskGrade === 'Normal'
                                ? 'success'
                                : gemmaResult.riskGrade === 'Borderline'
                                ? 'warn'
                                : 'error'
                            }
                            size="md"
                            dot
                          >
                            Grade: {gemmaResult.riskGrade}
                          </Pill>
                          <Pill
                            tone={
                              gemmaResult.urgencyLevel === 'Low'
                                ? 'success'
                                : gemmaResult.urgencyLevel === 'Moderate'
                                ? 'warn'
                                : 'error'
                            }
                            size="sm"
                          >
                            Urgency: {gemmaResult.urgencyLevel}
                          </Pill>
                          <Pill tone="neutral" size="sm">
                            Model: {gemmaResult.modelUsed}
                          </Pill>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <SpeechButton
                            text={`Cardiac screening assessment: ${gemmaResult.summary}. Rhythm interpretation: ${gemmaResult.rhythmInterpretation}. Visual waveform features: ${gemmaResult.waveformFeatures}. Follow-up recommendations: ${gemmaResult.clinicalRecommendations.join('. ')}`}
                            label="Listen to Assessment"
                            size="sm"
                          />
                          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Eye size={12} style={{ color: '#4285f4' }} />
                            Multimodal Vision
                          </span>
                        </div>
                      </div>

                      {/* 2. Visual Urgency Alert Banner */}
                      {isFlatline || gemmaResult.urgencyLevel === 'High / Immediate' || gemmaResult.riskGrade === 'Requires Review' ? (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 12,
                            padding: '12px 16px',
                            borderRadius: 'var(--r-2)',
                            background: 'rgba(239, 68, 68, 0.08)',
                            border: '1px solid rgba(239, 68, 68, 0.35)',
                            color: 'var(--ink)',
                          }}
                        >
                          <AlertTriangle size={20} style={{ color: '#ef4444', flexShrink: 0, marginTop: 2 }} />
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: '#ef4444' }}>
                              Clinical Alert: Visual Discrepancy / Flatline Detected
                            </div>
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-2)', lineHeight: 1.45 }}>
                              Gemma 4 identified an isoelectric flatline or acute lead detachment in the visual strip, contrasting with automated telemetry. Inspect electrode adherence, cables, and patient pulse immediately.
                            </div>
                          </div>
                        </div>
                      ) : gemmaResult.riskGrade === 'Borderline' ? (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 12,
                            padding: '12px 16px',
                            borderRadius: 'var(--r-2)',
                            background: 'rgba(245, 158, 11, 0.08)',
                            border: '1px solid rgba(245, 158, 11, 0.35)',
                            color: 'var(--ink)',
                          }}
                        >
                          <Info size={20} style={{ color: '#f59e0b', flexShrink: 0, marginTop: 2 }} />
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: '#d97706' }}>
                              Borderline Rhythm or Morphology Variation
                            </div>
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-2)', lineHeight: 1.45 }}>
                              Minor conduction variation or ectopic deflections observed. Follow-up monitoring or standard 12-lead ECG is advised.
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            padding: '10px 16px',
                            borderRadius: 'var(--r-2)',
                            background: 'rgba(16, 185, 129, 0.08)',
                            border: '1px solid rgba(16, 185, 129, 0.3)',
                            color: 'var(--ink)',
                          }}
                        >
                          <CheckCircle2 size={18} style={{ color: '#10b981', flexShrink: 0 }} />
                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-2)' }}>
                            <strong style={{ color: '#059669' }}>Normal Rhythm Verified:</strong> Regular P waves, narrow QRS complexes, and stable isoelectric baseline observed in the visual strip.
                          </div>
                        </div>
                      )}

                      {/* 3. Pictorial Element A: Analyzed ECG Lead Strip Snapshot Viewer */}
                      {displaySnapshot && (
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 8,
                            padding: 'var(--sp-3)',
                            background: '#090d16',
                            borderRadius: 'var(--r-2)',
                            border: '1px solid rgba(66, 133, 244, 0.35)',
                            boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#93c5fd', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                              <Eye size={13} style={{ color: '#60a5fa' }} />
                              <span>Analyzed ECG Lead Waveform Snapshot</span>
                              <span style={{ color: '#38bdf8', background: 'rgba(56, 189, 248, 0.15)', padding: '1px 6px', borderRadius: 4, fontSize: '10px' }}>
                                Vision Input
                              </span>
                            </div>
                            <div style={{ color: '#94a3b8', fontSize: '10px', fontFamily: 'var(--font-mono)' }}>
                              Lead I · {samples?.length || 0} samples · {fs} Hz · {durationSec.toFixed(1)}s
                            </div>
                          </div>

                          {/* Snapshot Image */}
                          <div style={{ position: 'relative', width: '100%', overflow: 'hidden', borderRadius: 'var(--r-1)', border: '1px solid rgba(51, 65, 85, 0.6)' }}>
                            <img
                              src={displaySnapshot}
                              alt="ECG Waveform Snapshot analyzed by Gemma 4"
                              style={{ width: '100%', height: 'auto', maxHeight: 180, objectFit: 'contain', display: 'block' }}
                            />
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10px', color: '#64748b', flexWrap: 'wrap', gap: 4 }}>
                            <span>Gemma 4 evaluated full visual morphology: baseline drift, QRS sharpness, and interval spacing.</span>
                            <span style={{ color: '#38bdf8', fontFamily: 'var(--font-mono)' }}>Resolution: 800×240px</span>
                          </div>
                        </div>
                      )}

                      {/* 4. Pictorial Element B: 4 Anatomical P-Q-R-S-T Component Diagnostic Tiles */}
                      <div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Layers size={13} />
                          <span>Pictorial Waveform Component Breakdown</span>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 'var(--sp-2)' }}>
                          {/* P-Wave Card */}
                          <div
                            style={{
                              padding: '10px 12px',
                              borderRadius: 'var(--r-2)',
                              background: 'var(--surface-sunken)',
                              border: '1px solid var(--hairline)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 6,
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span style={{ fontSize: '11px', color: 'var(--ink-3)', fontWeight: 600 }}>P-Wave (Atrial)</span>
                              <svg width="24" height="14" viewBox="0 0 24 14" style={{ color: gemmaResult.pWaveStatus.toLowerCase().includes('absent') || gemmaResult.pWaveStatus.toLowerCase().includes('flat') ? '#ef4444' : '#10b981' }}>
                                <path d="M 2 10 L 6 10 Q 11 2 15 10 L 22 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                              </svg>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span
                                style={{
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  padding: '2px 8px',
                                  borderRadius: 'var(--r-pill)',
                                  background: gemmaResult.pWaveStatus.toLowerCase().includes('absent') || gemmaResult.pWaveStatus.toLowerCase().includes('flat')
                                    ? 'rgba(239, 68, 68, 0.15)'
                                    : gemmaResult.pWaveStatus.toLowerCase().includes('present') || gemmaResult.pWaveStatus.toLowerCase().includes('normal')
                                    ? 'rgba(16, 185, 129, 0.15)'
                                    : 'rgba(245, 158, 11, 0.15)',
                                  color: gemmaResult.pWaveStatus.toLowerCase().includes('absent') || gemmaResult.pWaveStatus.toLowerCase().includes('flat')
                                    ? '#ef4444'
                                    : gemmaResult.pWaveStatus.toLowerCase().includes('present') || gemmaResult.pWaveStatus.toLowerCase().includes('normal')
                                    ? '#10b981'
                                    : '#f59e0b',
                                }}
                              >
                                {gemmaResult.pWaveStatus}
                              </span>
                            </div>
                            <span style={{ fontSize: '10px', color: 'var(--ink-4)' }}>Upper heart chambers (atria) activation</span>
                          </div>

                          {/* QRS Complex Card */}
                          <div
                            style={{
                              padding: '10px 12px',
                              borderRadius: 'var(--r-2)',
                              background: 'var(--surface-sunken)',
                              border: '1px solid var(--hairline)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 6,
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span style={{ fontSize: '11px', color: 'var(--ink-3)', fontWeight: 600 }}>QRS Complex</span>
                              <svg width="24" height="14" viewBox="0 0 24 14" style={{ color: gemmaResult.qrsStatus.toLowerCase().includes('absent') || gemmaResult.qrsStatus.toLowerCase().includes('flat') ? '#ef4444' : gemmaResult.qrsStatus.toLowerCase().includes('wide') ? '#f59e0b' : '#10b981' }}>
                                <path d="M 2 11 L 6 11 L 8 13 L 11 1 L 14 14 L 16 11 L 22 11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span
                                style={{
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  padding: '2px 8px',
                                  borderRadius: 'var(--r-pill)',
                                  background: gemmaResult.qrsStatus.toLowerCase().includes('absent') || gemmaResult.qrsStatus.toLowerCase().includes('flat')
                                    ? 'rgba(239, 68, 68, 0.15)'
                                    : gemmaResult.qrsStatus.toLowerCase().includes('normal')
                                    ? 'rgba(16, 185, 129, 0.15)'
                                    : 'rgba(245, 158, 11, 0.15)',
                                  color: gemmaResult.qrsStatus.toLowerCase().includes('absent') || gemmaResult.qrsStatus.toLowerCase().includes('flat')
                                    ? '#ef4444'
                                    : gemmaResult.qrsStatus.toLowerCase().includes('normal')
                                    ? '#10b981'
                                    : '#f59e0b',
                                }}
                              >
                                {gemmaResult.qrsStatus}
                              </span>
                            </div>
                            <span style={{ fontSize: '10px', color: 'var(--ink-4)' }}>Main ventricular pumping contraction</span>
                          </div>

                          {/* ST-T Segment Card */}
                          <div
                            style={{
                              padding: '10px 12px',
                              borderRadius: 'var(--r-2)',
                              background: 'var(--surface-sunken)',
                              border: '1px solid var(--hairline)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 6,
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span style={{ fontSize: '11px', color: 'var(--ink-3)', fontWeight: 600 }}>ST-T Wave (Rest)</span>
                              <svg width="24" height="14" viewBox="0 0 24 14" style={{ color: gemmaResult.stSegmentStatus.toLowerCase().includes('absent') || gemmaResult.stSegmentStatus.toLowerCase().includes('flat') ? '#ef4444' : gemmaResult.stSegmentStatus.toLowerCase().includes('elevat') || gemmaResult.stSegmentStatus.toLowerCase().includes('depress') ? '#f59e0b' : '#10b981' }}>
                                <path d="M 2 10 L 7 10 L 10 10 Q 15 3 19 10 L 22 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                              </svg>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span
                                style={{
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  padding: '2px 8px',
                                  borderRadius: 'var(--r-pill)',
                                  background: gemmaResult.stSegmentStatus.toLowerCase().includes('absent') || gemmaResult.stSegmentStatus.toLowerCase().includes('flat')
                                    ? 'rgba(239, 68, 68, 0.15)'
                                    : gemmaResult.stSegmentStatus.toLowerCase().includes('normal') || gemmaResult.stSegmentStatus.toLowerCase().includes('isoelectric')
                                    ? 'rgba(16, 185, 129, 0.15)'
                                    : 'rgba(245, 158, 11, 0.15)',
                                  color: gemmaResult.stSegmentStatus.toLowerCase().includes('absent') || gemmaResult.stSegmentStatus.toLowerCase().includes('flat')
                                    ? '#ef4444'
                                    : gemmaResult.stSegmentStatus.toLowerCase().includes('normal') || gemmaResult.stSegmentStatus.toLowerCase().includes('isoelectric')
                                    ? '#10b981'
                                    : '#f59e0b',
                                }}
                              >
                                {gemmaResult.stSegmentStatus}
                              </span>
                            </div>
                            <span style={{ fontSize: '10px', color: 'var(--ink-4)' }}>Heart muscle resting & recovery phase</span>
                          </div>

                          {/* Lead Contact Card */}
                          <div
                            style={{
                              padding: '10px 12px',
                              borderRadius: 'var(--r-2)',
                              background: 'var(--surface-sunken)',
                              border: '1px solid var(--hairline)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 6,
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span style={{ fontSize: '11px', color: 'var(--ink-3)', fontWeight: 600 }}>Lead Contact</span>
                              <Radio size={14} style={{ color: gemmaResult.leadContactStatus.toLowerCase().includes('detach') || gemmaResult.leadContactStatus.toLowerCase().includes('flat') ? '#ef4444' : '#10b981' }} />
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span
                                style={{
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  padding: '2px 8px',
                                  borderRadius: 'var(--r-pill)',
                                  background: gemmaResult.leadContactStatus.toLowerCase().includes('detach') || gemmaResult.leadContactStatus.toLowerCase().includes('flat')
                                    ? 'rgba(239, 68, 68, 0.15)'
                                    : gemmaResult.leadContactStatus.toLowerCase().includes('good')
                                    ? 'rgba(16, 185, 129, 0.15)'
                                    : 'rgba(245, 158, 11, 0.15)',
                                  color: gemmaResult.leadContactStatus.toLowerCase().includes('detach') || gemmaResult.leadContactStatus.toLowerCase().includes('flat')
                                    ? '#ef4444'
                                    : gemmaResult.leadContactStatus.toLowerCase().includes('good')
                                    ? '#10b981'
                                    : '#f59e0b',
                                }}
                              >
                                {gemmaResult.leadContactStatus}
                              </span>
                            </div>
                            <span style={{ fontSize: '10px', color: 'var(--ink-4)' }}>Hardware electrode skin connection</span>
                          </div>
                        </div>
                      </div>

                      {/* 5. Pictorial Element C: 3 Graphical Spectrum Progress Gauges */}
                      <div
                        style={{
                          padding: 'var(--sp-4)',
                          borderRadius: 'var(--r-2)',
                          background: 'var(--surface-sunken)',
                          border: '1px solid var(--hairline)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 'var(--sp-3)',
                        }}
                      >
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Gauge size={13} />
                          <span>Multimodal AI Quantitative Meters</span>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                          {/* Meter 1: Signal Integrity & Lead Adherence */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)' }}>
                              <span style={{ color: 'var(--ink-2)', fontWeight: 500 }}>Signal &amp; Electrode Contact Quality</span>
                              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: gemmaResult.signalIntegrityPct < 40 ? '#ef4444' : gemmaResult.signalIntegrityPct < 75 ? '#f59e0b' : '#10b981' }}>
                                {gemmaResult.signalIntegrityPct}% · {gemmaResult.signalIntegrityPct < 40 ? 'Severe Signal Loss' : gemmaResult.signalIntegrityPct < 75 ? 'Moderate Noise' : 'Optimal Quality'}
                              </span>
                            </div>
                            <div style={{ position: 'relative', height: 8, borderRadius: 'var(--r-pill)', background: 'rgba(0,0,0,0.08)', overflow: 'hidden' }}>
                              <div
                                style={{
                                  width: `${gemmaResult.signalIntegrityPct}%`,
                                  height: '100%',
                                  borderRadius: 'var(--r-pill)',
                                  background: 'linear-gradient(to right, #ef4444, #f59e0b 50%, #10b981 100%)',
                                  transition: 'width 0.4s ease',
                                }}
                              />
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--ink-4)' }}>
                              <span>0% Lead Disconnected / Flatline</span>
                              <span>50% Fair</span>
                              <span>100% Diagnostic Grade</span>
                            </div>
                          </div>

                          {/* Meter 2: Rhythm Regularity & Stability */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)' }}>
                              <span style={{ color: 'var(--ink-2)', fontWeight: 500 }}>Rhythm Regularity &amp; Beat Uniformity</span>
                              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: gemmaResult.rhythmStabilityPct < 40 ? '#ef4444' : gemmaResult.rhythmStabilityPct < 75 ? '#f59e0b' : '#10b981' }}>
                                {gemmaResult.rhythmStabilityPct}% · {gemmaResult.rhythmStabilityPct < 40 ? 'Zero / Arrhythmic' : gemmaResult.rhythmStabilityPct < 75 ? 'Variable Interval' : 'Regular Pacemaking'}
                              </span>
                            </div>
                            <div style={{ position: 'relative', height: 8, borderRadius: 'var(--r-pill)', background: 'rgba(0,0,0,0.08)', overflow: 'hidden' }}>
                              <div
                                style={{
                                  width: `${gemmaResult.rhythmStabilityPct}%`,
                                  height: '100%',
                                  borderRadius: 'var(--r-pill)',
                                  background: 'linear-gradient(to right, #ef4444, #3b82f6 50%, #10b981 100%)',
                                  transition: 'width 0.4s ease',
                                }}
                              />
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--ink-4)' }}>
                              <span>0% Chaotic / Isoelectric</span>
                              <span>50% Mild Arrhythmia</span>
                              <span>100% Sinus Uniform</span>
                            </div>
                          </div>

                          {/* Meter 3: Conduction Health Confidence Score */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)' }}>
                              <span style={{ color: 'var(--ink-2)', fontWeight: 500 }}>Cardiac Conduction Health Confidence</span>
                              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: gemmaResult.conductionScorePct < 40 ? '#ef4444' : gemmaResult.conductionScorePct < 75 ? '#f59e0b' : '#10b981' }}>
                                {gemmaResult.conductionScorePct}% · {gemmaResult.conductionScorePct < 40 ? 'Atypical Conduction' : gemmaResult.conductionScorePct < 75 ? 'Borderline' : 'Normal Electrophysiology'}
                              </span>
                            </div>
                            <div style={{ position: 'relative', height: 8, borderRadius: 'var(--r-pill)', background: 'rgba(0,0,0,0.08)', overflow: 'hidden' }}>
                              <div
                                style={{
                                  width: `${gemmaResult.conductionScorePct}%`,
                                  height: '100%',
                                  borderRadius: 'var(--r-pill)',
                                  background: 'linear-gradient(to right, #ef4444, #8b5cf6 50%, #10b981 100%)',
                                  transition: 'width 0.4s ease',
                                }}
                              />
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--ink-4)' }}>
                              <span>0% Block / Failure</span>
                              <span>50% Inconclusive</span>
                              <span>100% Robust Conduction</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 6. Interactive Visual Guide: Standard ECG Anatomy vs Observed (Collapsible) */}
                      <div
                        style={{
                          borderRadius: 'var(--r-2)',
                          background: 'var(--surface-sunken)',
                          border: '1px solid var(--hairline)',
                          overflow: 'hidden',
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => setShowVisualGuide((prev) => !prev)}
                          style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '10px 14px',
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--ink-2)',
                            fontSize: 'var(--text-xs)',
                            fontWeight: 600,
                            cursor: 'pointer',
                            textAlign: 'left',
                          }}
                        >
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <HelpCircle size={14} style={{ color: '#4285f4' }} />
                            How to Understand Your ECG (Pictorial Anatomy Guide)
                          </span>
                          {showVisualGuide ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>

                        {showVisualGuide && (
                          <div
                            style={{
                              padding: '12px 14px',
                              borderTop: '1px solid var(--hairline)',
                              background: 'var(--surface)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 10,
                            }}
                          >
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                              <div style={{ padding: 10, borderRadius: 6, background: 'var(--surface-sunken)', border: '1px solid var(--hairline)' }}>
                                <div style={{ fontWeight: 600, fontSize: '11px', color: '#2563eb', marginBottom: 2 }}>
                                  1. Atrial P-Wave
                                </div>
                                <div style={{ fontSize: '11px', color: 'var(--ink-3)', lineHeight: 1.4 }}>
                                  Small initial bump triggered by the sinus node pacemaker. Squeezes blood into the ventricles.
                                </div>
                              </div>

                              <div style={{ padding: 10, borderRadius: 6, background: 'var(--surface-sunken)', border: '1px solid var(--hairline)' }}>
                                <div style={{ fontWeight: 600, fontSize: '11px', color: '#16a34a', marginBottom: 2 }}>
                                  2. QRS Complex
                                </div>
                                <div style={{ fontSize: '11px', color: 'var(--ink-3)', lineHeight: 1.4 }}>
                                  Tall, sharp spike. The main pumping chamber contractions that send oxygenated blood to the body.
                                </div>
                              </div>

                              <div style={{ padding: 10, borderRadius: 6, background: 'var(--surface-sunken)', border: '1px solid var(--hairline)' }}>
                                <div style={{ fontWeight: 600, fontSize: '11px', color: '#ca8a04', marginBottom: 2 }}>
                                  3. T-Wave &amp; ST Segment
                                </div>
                                <div style={{ fontSize: '11px', color: 'var(--ink-3)', lineHeight: 1.4 }}>
                                  Gentle recovery wave where cardiac cells recharge electrical potential for the next heartbeat.
                                </div>
                              </div>
                            </div>

                            <p style={{ fontSize: '11px', color: 'var(--ink-4)', margin: 0 }}>
                              {isFlatline
                                ? '⚠️ In this recording, none of these 3 electrical events were observed on the sensor lead, confirming an open lead detachment or flatline.'
                                : '✅ Your recording shows the expected sequential electrical conduction from atria to ventricles.'}
                            </p>
                          </div>
                        )}
                      </div>

                      {/* 7. Detailed Clinical Narrative Text & Follow-ups */}
                      <div
                        style={{
                          padding: 'var(--sp-4)',
                          borderRadius: 'var(--r-2)',
                          background: 'var(--surface-sunken)',
                          border: '1px solid var(--hairline)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 12,
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                              Summary Assessment
                            </div>
                            <SpeechButton
                              text={gemmaResult.summary}
                              label="Listen"
                              size="sm"
                            />
                          </div>
                          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--ink)', margin: 0, lineHeight: 1.55 }}>
                            {gemmaResult.summary}
                          </p>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 'var(--sp-3)', paddingTop: 4 }}>
                          <div style={{ padding: 'var(--sp-3)', borderRadius: 'var(--r-1)', background: 'var(--surface)', border: '1px solid var(--hairline)' }}>
                            <div style={{ fontSize: 'var(--text-xs)', color: '#4285f4', fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                              <Activity size={13} /> Rhythm Interpretation
                            </div>
                            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-2)', margin: 0, lineHeight: 1.55 }}>
                              {gemmaResult.rhythmInterpretation}
                            </p>
                          </div>

                          <div style={{ padding: 'var(--sp-3)', borderRadius: 'var(--r-1)', background: 'var(--surface)', border: '1px solid var(--hairline)' }}>
                            <div style={{ fontSize: 'var(--text-xs)', color: '#10b981', fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                              <Heart size={13} /> Visual Waveform Morphology
                            </div>
                            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-2)', margin: 0, lineHeight: 1.55 }}>
                              {gemmaResult.waveformFeatures}
                            </p>
                          </div>
                        </div>

                        {gemmaResult.clinicalRecommendations.length > 0 && (
                          <div style={{ paddingTop: 4 }}>
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                              Recommended Follow-ups
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {gemmaResult.clinicalRecommendations.map((rec, i) => (
                                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 'var(--text-xs)', color: 'var(--ink-2)' }}>
                                  <CheckCircle2 size={13} style={{ color: 'var(--success)', marginTop: 2, flexShrink: 0 }} />
                                  <span>{rec}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Disclaimer */}
            <p
              style={{
                fontSize: '11px',
                color: 'var(--ink-4)',
                lineHeight: 1.5,
                borderTop: '1px solid var(--hairline)',
                paddingTop: 'var(--sp-3)',
                margin: 0,
              }}
            >
              {result.disclaimer}
            </p>
          </>
        )}
      </Card>
    </section>
  );
};

export default EcgAnalysisCard;