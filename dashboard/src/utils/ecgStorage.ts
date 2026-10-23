import type { EcgAnalysisResult } from '../services/ecgAnalysis';
import { processECGWaveform } from './ecgFilter';

export interface StoredEcgRecord {
  id: string;
  timestamp: number;
  dateLabel: string;
  durationSec: number;
  sampleRate: number;
  totalBeats: number;
  heartRateBpm: number | null;
  minHeartRateBpm?: number | null;
  maxHeartRateBpm?: number | null;
  regularityPct?: number | null;
  rhythm: string;
  quality: string;
  waveformImage: string; // Base64 data URL (PNG)
  samples: number[];
  analysis: EcgAnalysisResult;
  notes?: string;
  patientName?: string;
}

const DB_NAME = 'anebilin_ecg_v1';
const DB_VERSION = 1;
const STORE_NAME = 'ecg_records';

function openEcgDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not supported on this device'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Generate a clean, high-resolution PNG snapshot of the ECG waveform
 * with medical grid ticks, baseline, and R-peak indicators.
 */
export function generateWaveformSnapshot(
  samples: number[],
  fs: number = 1000,
  width: number = 800,
  height: number = 240
): string {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Process signal to remove noise & baseline wander
  const processed = processECGWaveform(samples, fs);
  const series = processed.filtered.length > 0 ? processed.filtered : samples;
  const n = series.length;

  // Background
  ctx.fillStyle = '#0f172a'; // Sleek dark medical theme
  ctx.fillRect(0, 0, width, height);

  if (n < 2) {
    ctx.fillStyle = '#64748b';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No waveform data', width / 2, height / 2);
    return canvas.toDataURL('image/png');
  }

  // Draw Medical Grid
  ctx.strokeStyle = 'rgba(51, 65, 85, 0.4)';
  ctx.lineWidth = 0.8;
  const gridStep = 20;
  for (let x = 0; x < width; x += gridStep) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += gridStep) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // Min / Max for scaling
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = series[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = Math.max(max - min, 1);
  const pad = span * 0.15;
  const yMin = min - pad;
  const yMax = max + pad;
  const ySpan = Math.max(yMax - yMin, 1);

  const toScreenX = (idx: number) => (idx / (n - 1)) * width;
  const toScreenY = (val: number) => height - ((val - yMin) / ySpan) * height;

  // Baseline
  const zeroY = toScreenY(0);
  if (zeroY >= 0 && zeroY <= height) {
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.3)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, zeroY);
    ctx.lineTo(width, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Draw ECG Waveform
  ctx.strokeStyle = '#2dd4bf'; // Teal / Accent trace
  ctx.lineWidth = 1.8;
  ctx.lineJoin = 'round';
  ctx.beginPath();

  const step = Math.max(1, Math.floor(n / (width * 2)));
  for (let i = 0; i < n; i += step) {
    const x = toScreenX(i);
    const y = toScreenY(series[i]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Draw R-peak markers
  if (processed.rPeaks && processed.rPeaks.length > 0) {
    ctx.fillStyle = '#ef4444';
    for (const p of processed.rPeaks) {
      if (p < n) {
        const px = toScreenX(p);
        const py = toScreenY(series[p]);
        ctx.beginPath();
        ctx.arc(px, Math.max(12, py - 8), 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Overlay Header Info Banner
  ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
  ctx.fillRect(0, 0, width, 26);
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'left';
  const bpmText = processed.heartRateBpm ? `${processed.heartRateBpm} BPM` : '-- BPM';
  ctx.fillText(`ANEBILIN ECG • ${bpmText} • ${processed.totalBeats} Beats • ${processed.totalDurationSec.toFixed(1)}s`, 10, 17);

  return canvas.toDataURL('image/png');
}

/**
 * Save an ECG record (waveform image, heartbeat calculation, analysis) to local IndexedDB.
 */
export async function saveLocalEcgRecord(params: {
  samples: number[];
  fs?: number;
  analysis: EcgAnalysisResult;
  waveformImage?: string;
  notes?: string;
  patientName?: string;
}): Promise<StoredEcgRecord> {
  const fs = params.fs || 1000;
  const timestamp = Date.now();
  const id = `ecg_${timestamp}_${Math.random().toString(36).slice(2, 6)}`;
  const date = new Date(timestamp);
  const dateLabel = date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }) + ' • ' + date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  const waveformImage =
    params.waveformImage || generateWaveformSnapshot(params.samples, fs, 800, 240);

  const durationSec =
    params.analysis.duration_s || Math.round((params.samples.length / fs) * 10) / 10;
  const totalBeats =
    params.analysis.total_beats ?? params.analysis.beats ?? 0;
  const heartRateBpm = params.analysis.hr_bpm ?? null;
  const minHeartRateBpm = params.analysis.min_hr_bpm ?? heartRateBpm;
  const maxHeartRateBpm = params.analysis.max_hr_bpm ?? heartRateBpm;
  const regularityPct = params.analysis.regularity_pct ?? 95;
  const rhythm = params.analysis.rhythm || 'sinus_rhythm';
  const quality = params.analysis.quality || 'good';

  const record: StoredEcgRecord = {
    id,
    timestamp,
    dateLabel,
    durationSec,
    sampleRate: fs,
    totalBeats,
    heartRateBpm,
    minHeartRateBpm,
    maxHeartRateBpm,
    regularityPct,
    rhythm,
    quality,
    waveformImage,
    samples: params.samples,
    analysis: params.analysis,
    notes: params.notes,
    patientName: params.patientName,
  };

  const db = await openEcgDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(record);
    req.onsuccess = () => resolve(record);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Retrieve all locally saved ECG records, ordered by newest first.
 */
export async function getLocalEcgRecords(): Promise<StoredEcgRecord[]> {
  try {
    const db = await openEcgDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const records = (req.result as StoredEcgRecord[]) || [];
        records.sort((a, b) => b.timestamp - a.timestamp);
        resolve(records);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Failed to load local ECG records:', err);
    return [];
  }
}

/**
 * Delete a specific local ECG record by ID.
 */
export async function deleteLocalEcgRecord(id: string): Promise<void> {
  const db = await openEcgDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Clear all local ECG records.
 */
export async function clearAllLocalEcgRecords(): Promise<void> {
  const db = await openEcgDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Trigger browser download of the waveform image (PNG).
 */
export function downloadWaveformImage(record: StoredEcgRecord): void {
  if (!record.waveformImage) return;
  const link = document.createElement('a');
  link.href = record.waveformImage;
  link.download = `ecg_waveform_${record.id}.png`;
  link.click();
}
