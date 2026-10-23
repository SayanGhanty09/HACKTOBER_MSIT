import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  SlidersHorizontal,
  Scissors,
  Layers,
  Sparkles,
  RotateCcw,
  Ruler,
} from 'lucide-react';
import {
  processECGWaveform,
  DEFAULT_FILTER_OPTIONS,
} from '../utils/ecgFilter';
import type {
  FilterOptions,
  ProcessedECGResult,
} from '../utils/ecgFilter';

export interface ECGWaveformProps {
  samples?: number[];
  rawSamples?: number[];
  fs?: number;
  height?: number;
  emptyLabel?: string;
  onProcessed?: (result: ProcessedECGResult) => void;
  filterOptions?: Partial<FilterOptions>;
  onFilterOptionsChange?: (opts: FilterOptions) => void;
}

type ViewMode = 'filtered' | 'raw' | 'overlay';

/**
 * Strict raw polyline: sample-accurate straight segments with no smoothing.
 * When zoomed out (more samples than pixels), uses per-pixel min/max buckets
 * so no raw spike is ever skipped — each pixel column draws straight lines
 * through its bucket minimum and maximum. No curve interpolation, no
 * averaging, no rounded joins (caller must set miter/butt).
 */
function drawStrictRawPolyline(
  ctx: CanvasRenderingContext2D,
  series: number[],
  visibleStart: number,
  visibleEnd: number,
  viewSpan: number,
  cssW: number,
  toScreenX: (idx: number) => number,
  toScreenY: (val: number) => number,
): void {
  const spanSamples = visibleEnd - visibleStart + 1;
  if (spanSamples <= 0 || cssW <= 0) return;
  if (spanSamples <= cssW * 2) {
    for (let i = visibleStart; i <= visibleEnd; i++) {
      const x = toScreenX(i);
      const y = toScreenY(series[i]);
      if (i === visibleStart) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    return;
  }
  let first = true;
  for (let px = 0; px < cssW; px++) {
    const s0 = Math.floor(visibleStart + (px / cssW) * viewSpan);
    const s1 = Math.min(
      visibleEnd,
      Math.floor(visibleStart + ((px + 1) / cssW) * viewSpan),
    );
    if (s1 < s0) continue;
    let minV = Infinity;
    let maxV = -Infinity;
    for (let i = s0; i <= s1; i++) {
      const v = series[i];
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    if (!isFinite(minV) || !isFinite(maxV)) continue;
    const colX = px + 0.5;
    if (first) {
      ctx.moveTo(colX, toScreenY(maxV));
      first = false;
    } else {
      ctx.lineTo(colX, toScreenY(maxV));
    }
    ctx.lineTo(colX, toScreenY(minV));
  }
}

/**
 * Advanced Interactive ECG Waveform Canvas:
 * - 2-second edge cropping (eliminates start settling spike and end release artifacts)
 * - Zero-phase noise reduction (0.67 Hz baseline wander + 50/60 Hz notch + 40 Hz EMG filter)
 * - Interactive horizontal zoom & pan: mouse wheel, drag, touch pinch, preset buttons
 * - Timeline mini-map / overview scrubber track
 * - Medical grid (0.2s major / 0.04s minor ticks) with time & amplitude scales
 * - Caliper interval measurement tool (measure ms and BPM between points)
 * - R-peak detection markers
 */
const ECGWaveform: React.FC<ECGWaveformProps> = ({
  samples,
  rawSamples,
  fs = 1000,
  height = 320,
  emptyLabel = 'No waveform yet',
  onProcessed,
  filterOptions: externalFilterOptions,
  onFilterOptionsChange,
}) => {
  const inputSamples = rawSamples ?? samples ?? [];
  const safeFs = fs > 0 ? fs : 1000;

  // Filter settings state
  const [internalFilterOpts, setInternalFilterOpts] = useState<FilterOptions>(DEFAULT_FILTER_OPTIONS);
  const filterOpts = externalFilterOptions
    ? { ...internalFilterOpts, ...externalFilterOptions }
    : internalFilterOpts;

  const updateFilterOpts = useCallback(
    (updater: (prev: FilterOptions) => FilterOptions) => {
      setInternalFilterOpts((prev) => {
        const next = updater(prev);
        onFilterOptionsChange?.(next);
        return next;
      });
    },
    [onFilterOptionsChange]
  );

  // View presentation mode
  const [viewMode, setViewMode] = useState<ViewMode>('filtered');
  const [showRPeaks, setShowRPeaks] = useState<boolean>(true);
  const [caliperActive, setCaliperActive] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);

  // Caliper measurement points (indices into displayed samples)
  const [caliperP1, setCaliperP1] = useState<number | null>(null);
  const [caliperP2, setCaliperP2] = useState<number | null>(null);

  // Process signal
  const processed: ProcessedECGResult = useMemo(() => {
    return processECGWaveform(inputSamples, safeFs, filterOpts);
  }, [inputSamples, safeFs, filterOpts]);

  // Notify parent of updated metrics
  useEffect(() => {
    onProcessed?.(processed);
  }, [processed, onProcessed]);

  // Active display array based on viewMode
  const activeSeries = useMemo(() => {
    if (viewMode === 'raw') return processed.raw;
    return processed.filtered;
  }, [viewMode, processed]);

  const totalDisplayLength = activeSeries.length;

  // Zoom & Pan viewport: [viewStart, viewEnd] in sample indices
  const [viewRange, setViewRange] = useState<[number, number]>([0, Math.max(0, totalDisplayLength - 1)]);

  // Reset view when new waveform is loaded or length changes significantly
  const prevLenRef = useRef(totalDisplayLength);
  useEffect(() => {
    if (totalDisplayLength > 0 && Math.abs(totalDisplayLength - prevLenRef.current) > 10) {
      setViewRange([0, totalDisplayLength - 1]);
    }
    prevLenRef.current = totalDisplayLength;
  }, [totalDisplayLength]);

  // Keep viewRange valid within bounds
  const clampedRange: [number, number] = useMemo(() => {
    if (totalDisplayLength < 2) return [0, 1];
    let start = Math.max(0, Math.min(viewRange[0], totalDisplayLength - 2));
    let end = Math.max(start + 1, Math.min(viewRange[1], totalDisplayLength - 1));
    return [start, end];
  }, [viewRange, totalDisplayLength]);

  const [viewStart, viewEnd] = clampedRange;
  const viewSpan = Math.max(viewEnd - viewStart, 1);

  // Canvas Refs
  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const miniCanvasRef = useRef<HTMLCanvasElement>(null);

  // Interaction tracking refs
  const isDraggingMain = useRef(false);
  const dragStartX = useRef(0);
  const dragStartRange = useRef<[number, number]>([0, 1]);

  const isDraggingMini = useRef(false);
  const miniDragMode = useRef<'pan' | 'left' | 'right' | null>(null);
  const miniDragStartX = useRef(0);
  const miniDragStartRange = useRef<[number, number]>([0, 1]);

  // Hover state for tooltip and crosshair
  const [hoverInfo, setHoverInfo] = useState<{
    visible: boolean;
    canvasX: number;
    canvasY: number;
    sampleIdx: number;
    timeSec: number;
    value: number;
  }>({ visible: false, canvasX: 0, canvasY: 0, sampleIdx: 0, timeSec: 0, value: 0 });

  // --------------------------------------------------------------------------
  // Zoom & Pan helper functions
  // --------------------------------------------------------------------------
  const setZoomWindow = useCallback(
    (targetCenterSample: number, newSpanSamples: number) => {
      if (totalDisplayLength < 2) return;
      const minSpan = Math.max(20, Math.round(safeFs * 0.2)); // minimum 200ms
      const maxSpan = totalDisplayLength - 1;
      const clampedSpan = Math.max(minSpan, Math.min(maxSpan, newSpanSamples));

      let newStart = Math.round(targetCenterSample - clampedSpan / 2);
      let newEnd = newStart + clampedSpan;

      if (newStart < 0) {
        newStart = 0;
        newEnd = Math.min(maxSpan, clampedSpan);
      } else if (newEnd > maxSpan) {
        newEnd = maxSpan;
        newStart = Math.max(0, maxSpan - clampedSpan);
      }

      setViewRange([newStart, newEnd]);
    },
    [totalDisplayLength, safeFs]
  );

  const zoomBy = useCallback(
    (factor: number, centerFrac: number = 0.5) => {
      const centerSample = viewStart + viewSpan * centerFrac;
      const newSpan = Math.round(viewSpan * factor);
      setZoomWindow(centerSample, newSpan);
    },
    [viewStart, viewSpan, setZoomWindow]
  );

  const zoomToSeconds = useCallback(
    (seconds: number) => {
      const targetSpan = Math.round(seconds * safeFs);
      const centerSample = (viewStart + viewEnd) / 2;
      setZoomWindow(centerSample, targetSpan);
    },
    [safeFs, viewStart, viewEnd, setZoomWindow]
  );

  const resetView = useCallback(() => {
    setViewRange([0, Math.max(1, totalDisplayLength - 1)]);
  }, [totalDisplayLength]);

  // --------------------------------------------------------------------------
  // Main Canvas Wheel (Zoom) & Mouse (Pan / Caliper)
  // --------------------------------------------------------------------------
  const handleMainWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = mainCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

    // zoom in on negative delta, zoom out on positive
    const factor = e.deltaY < 0 ? 0.75 : 1.33;
    const centerSample = viewStart + viewSpan * frac;
    setZoomWindow(centerSample, Math.round(viewSpan * factor));
  };

  const handleMainMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = mainCanvasRef.current;
    if (!canvas || totalDisplayLength < 2) return;
    const rect = canvas.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const sampleIdx = Math.round(viewStart + frac * viewSpan);

    if (caliperActive) {
      if (caliperP1 === null || (caliperP1 !== null && caliperP2 !== null)) {
        setCaliperP1(sampleIdx);
        setCaliperP2(null);
      } else {
        setCaliperP2(sampleIdx);
      }
      return;
    }

    isDraggingMain.current = true;
    dragStartX.current = e.clientX;
    dragStartRange.current = [viewStart, viewEnd];
  };

  const handleMainMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = mainCanvasRef.current;
    if (!canvas || totalDisplayLength < 2) return;
    const rect = canvas.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const sampleIdx = Math.max(0, Math.min(totalDisplayLength - 1, Math.round(viewStart + frac * viewSpan)));
    const timeSec = processed.cropStartTimeSec + sampleIdx / safeFs;
    const value = activeSeries[sampleIdx] ?? 0;

    setHoverInfo({
      visible: true,
      canvasX: e.clientX - rect.left,
      canvasY: e.clientY - rect.top,
      sampleIdx,
      timeSec,
      value,
    });

    if (isDraggingMain.current) {
      const deltaX = e.clientX - dragStartX.current;
      const deltaSamples = Math.round((-deltaX / rect.width) * (dragStartRange.current[1] - dragStartRange.current[0]));
      const [origStart, origEnd] = dragStartRange.current;
      const span = origEnd - origStart;

      let newStart = origStart + deltaSamples;
      let newEnd = origEnd + deltaSamples;

      if (newStart < 0) {
        newStart = 0;
        newEnd = span;
      } else if (newEnd > totalDisplayLength - 1) {
        newEnd = totalDisplayLength - 1;
        newStart = Math.max(0, totalDisplayLength - 1 - span);
      }
      setViewRange([newStart, newEnd]);
    }
  };

  const handleMainMouseUp = () => {
    isDraggingMain.current = false;
  };

  const handleMainMouseLeave = () => {
    isDraggingMain.current = false;
    setHoverInfo((prev) => ({ ...prev, visible: false }));
  };

  // --------------------------------------------------------------------------
  // Mini-Map Interaction
  // --------------------------------------------------------------------------
  const handleMiniMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = miniCanvasRef.current;
    if (!canvas || totalDisplayLength < 2) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const frac = Math.max(0, Math.min(1, x / rect.width));

    const boxStartFrac = viewStart / (totalDisplayLength - 1);
    const boxEndFrac = viewEnd / (totalDisplayLength - 1);
    const boxStartX = boxStartFrac * rect.width;
    const boxEndX = boxEndFrac * rect.width;

    isDraggingMini.current = true;
    miniDragStartX.current = e.clientX;
    miniDragStartRange.current = [viewStart, viewEnd];

    // Check if clicked near left or right edge of viewport box (within 8px)
    if (Math.abs(x - boxStartX) < 8) {
      miniDragMode.current = 'left';
    } else if (Math.abs(x - boxEndX) < 8) {
      miniDragMode.current = 'right';
    } else if (x >= boxStartX && x <= boxEndX) {
      miniDragMode.current = 'pan';
    } else {
      // Clicked outside: jump center to clicked position
      const clickedSample = Math.round(frac * (totalDisplayLength - 1));
      setZoomWindow(clickedSample, viewSpan);
      miniDragMode.current = 'pan';
    }
  };

  const handleMiniMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDraggingMini.current) return;
    const canvas = miniCanvasRef.current;
    if (!canvas || totalDisplayLength < 2) return;
    const rect = canvas.getBoundingClientRect();
    const deltaX = e.clientX - miniDragStartX.current;
    const deltaFrac = deltaX / rect.width;
    const deltaSamples = Math.round(deltaFrac * (totalDisplayLength - 1));

    const [origStart, origEnd] = miniDragStartRange.current;
    const minSpan = Math.max(20, Math.round(safeFs * 0.2));

    if (miniDragMode.current === 'pan') {
      const span = origEnd - origStart;
      let newStart = origStart + deltaSamples;
      let newEnd = origEnd + deltaSamples;
      if (newStart < 0) {
        newStart = 0;
        newEnd = span;
      } else if (newEnd > totalDisplayLength - 1) {
        newEnd = totalDisplayLength - 1;
        newStart = Math.max(0, totalDisplayLength - 1 - span);
      }
      setViewRange([newStart, newEnd]);
    } else if (miniDragMode.current === 'left') {
      const newStart = Math.max(0, Math.min(origEnd - minSpan, origStart + deltaSamples));
      setViewRange([newStart, origEnd]);
    } else if (miniDragMode.current === 'right') {
      const newEnd = Math.min(totalDisplayLength - 1, Math.max(origStart + minSpan, origEnd + deltaSamples));
      setViewRange([origStart, newEnd]);
    }
  };

  const handleMiniMouseUp = () => {
    isDraggingMini.current = false;
    miniDragMode.current = null;
  };

  // --------------------------------------------------------------------------
  // Main Waveform Canvas Rendering
  // --------------------------------------------------------------------------
  useEffect(() => {
    const canvas = mainCanvasRef.current;
    if (!canvas) return;

    const render = () => {
      const rect = canvas.getBoundingClientRect();
      const cssW = Math.max(1, Math.floor(rect.width));
      const cssH = height;
      const dpr = window.devicePixelRatio || 1;

      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      const css = getComputedStyle(canvas);
      const gridColor = css.getPropertyValue('--hairline').trim() || 'rgba(11,11,12,0.08)';
      const gridMajor = css.getPropertyValue('--hairline-strong').trim() || 'rgba(11,11,12,0.18)';
      const axisColor = css.getPropertyValue('--ink-4').trim() || 'rgba(11,11,12,0.3)';
      const primaryTrace = css.getPropertyValue('--accent').trim() || '#0d6e6e';
      const rawTrace = '#e29578'; // warm terracotta for raw comparison
      const textColor = css.getPropertyValue('--ink-3').trim() || '#64748b';

      if (totalDisplayLength < 2) return;

      // 1. Compute min / max within CURRENT VISIBLE WINDOW with 10% breathing room
      const visibleStart = Math.max(0, viewStart);
      const visibleEnd = Math.min(totalDisplayLength - 1, viewEnd);

      let min = Infinity;
      let max = -Infinity;

      for (let i = visibleStart; i <= visibleEnd; i++) {
        const v = activeSeries[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }

      if (viewMode === 'overlay' && processed.raw.length === totalDisplayLength) {
        for (let i = visibleStart; i <= visibleEnd; i++) {
          const rv = processed.raw[i];
          if (rv < min) min = rv;
          if (rv > max) max = rv;
        }
      }

      if (!isFinite(min) || !isFinite(max) || min === max) {
        min = -100;
        max = 100;
      }

      const padding = (max - min) * 0.12;
      const yMin = min - padding;
      const yMax = max + padding;
      const ySpan = Math.max(yMax - yMin, 1);

      const toScreenX = (idx: number) => ((idx - viewStart) / viewSpan) * cssW;
      const toScreenY = (val: number) => cssH - ((val - yMin) / ySpan) * (cssH - 32) - 20;

      // 2. Draw Medical ECG Grid (responsive intervals)
      const windowSec = viewSpan / safeFs;
      let majorTickSec = 1.0;
      let minorTickSec = 0.2;

      if (windowSec <= 1.5) {
        majorTickSec = 0.2; // 200 ms (standard ECG major box)
        minorTickSec = 0.04; // 40 ms (standard ECG small square)
      } else if (windowSec <= 4) {
        majorTickSec = 0.5;
        minorTickSec = 0.1;
      } else if (windowSec <= 10) {
        majorTickSec = 1.0;
        minorTickSec = 0.2;
      } else if (windowSec <= 25) {
        majorTickSec = 2.0;
        minorTickSec = 0.5;
      } else {
        majorTickSec = 5.0;
        minorTickSec = 1.0;
      }

      const startAbsSec = processed.cropStartTimeSec + viewStart / safeFs;
      const endAbsSec = processed.cropStartTimeSec + viewEnd / safeFs;

      // Minor grid lines
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 1;
      const firstMinor = Math.ceil(startAbsSec / minorTickSec) * minorTickSec;
      for (let t = firstMinor; t <= endAbsSec; t += minorTickSec) {
        const sampleIdx = (t - processed.cropStartTimeSec) * safeFs;
        const x = toScreenX(sampleIdx);
        if (x >= 0 && x <= cssW) {
          ctx.beginPath();
          ctx.moveTo(x + 0.5, 0);
          ctx.lineTo(x + 0.5, cssH - 18);
          ctx.stroke();
        }
      }

      // Major grid lines & time labels
      ctx.strokeStyle = gridMajor;
      ctx.lineWidth = 1.2;
      ctx.fillStyle = textColor;
      ctx.font = '10px var(--font-mono, monospace)';
      ctx.textAlign = 'center';

      const firstMajor = Math.ceil(startAbsSec / majorTickSec) * majorTickSec;
      for (let t = firstMajor; t <= endAbsSec; t += majorTickSec) {
        const sampleIdx = (t - processed.cropStartTimeSec) * safeFs;
        const x = toScreenX(sampleIdx);
        if (x >= 0 && x <= cssW) {
          ctx.beginPath();
          ctx.moveTo(x + 0.5, 0);
          ctx.lineTo(x + 0.5, cssH - 16);
          ctx.stroke();

          // Time text at bottom
          ctx.fillText(`${t.toFixed(windowSec < 2 ? 2 : 1)}s`, x, cssH - 5);
        }
      }

      // Horizontal baseline (0 if highpassed, or median)
      const baselineVal = filterOpts.enableBaselineRemoval ? 0 : (min + max) / 2;
      const baselineY = toScreenY(baselineVal);
      if (baselineY >= 0 && baselineY <= cssH) {
        ctx.strokeStyle = axisColor;
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, baselineY + 0.5);
        ctx.lineTo(cssW, baselineY + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // 3. Draw Raw Signal (if in overlay mode) — strict straight segments, no smoothing
      if (viewMode === 'overlay' && processed.raw.length === totalDisplayLength) {
        ctx.strokeStyle = rawTrace;
        ctx.lineWidth = 1.2;
        ctx.lineJoin = 'miter';
        ctx.lineCap = 'butt';
        ctx.globalAlpha = 0.5;
        ctx.beginPath();

        drawStrictRawPolyline(ctx, processed.raw, visibleStart, visibleEnd, viewSpan, cssW, toScreenX, toScreenY);
        ctx.stroke();
        ctx.globalAlpha = 1.0;
      }

      // 4. Draw Primary Waveform (Filtered or Raw)
      const isRawMode = viewMode === 'raw';
      ctx.strokeStyle = isRawMode ? rawTrace : primaryTrace;
      ctx.lineWidth = 1.8;
      // Raw ECG must be sample-accurate straight segments: miter joins + butt
      // caps. Filtered (clean) keeps round joins for readability.
      ctx.lineJoin = isRawMode ? 'miter' : 'round';
      ctx.lineCap = isRawMode ? 'butt' : 'round';
      ctx.beginPath();

      if (isRawMode) {
        drawStrictRawPolyline(ctx, activeSeries, visibleStart, visibleEnd, viewSpan, cssW, toScreenX, toScreenY);
      } else {
        // Downsample dynamically if zoomed far out to keep 60 FPS performance
        // (filtered signal is already band-limited, so skipping is safe here).
        const step = Math.max(1, Math.floor(viewSpan / (cssW * 3)));
        for (let i = visibleStart; i <= visibleEnd; i += step) {
          const x = toScreenX(i);
          const y = toScreenY(activeSeries[i]);
          if (i === visibleStart) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        // Ensure the exact last visible sample connects
        if (visibleEnd !== visibleStart) {
          ctx.lineTo(toScreenX(visibleEnd), toScreenY(activeSeries[visibleEnd]));
        }
      }
      ctx.stroke();

      // 5. Draw R-Peak Indicators
      if (showRPeaks && processed.rPeaks.length > 0) {
        ctx.fillStyle = '#ef4444';
        const showLabels = viewSpan / cssW < 8; // visible when moderately zoomed in
        for (let i = 0; i < processed.rPeaks.length; i++) {
          const peakIdx = processed.rPeaks[i];
          if (peakIdx >= visibleStart && peakIdx <= visibleEnd) {
            const px = toScreenX(peakIdx);
            const py = toScreenY(activeSeries[peakIdx]);

            // Diamond marker above peak
            const markerY = Math.max(16, py - 10);
            ctx.beginPath();
            ctx.arc(px, markerY, 3.5, 0, Math.PI * 2);
            ctx.fill();

            // Tiny pulse stem
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(px, markerY + 3.5);
            ctx.lineTo(px, py);
            ctx.stroke();

            // Beat number & instant BPM tag when zoomed in
            if (showLabels) {
              const beat = processed.beats[i];
              ctx.font = 'bold 9px var(--font-mono, monospace)';
              ctx.textAlign = 'center';
              ctx.fillStyle = '#ef4444';
              const label = beat?.instantBpm ? `#${i + 1} (${beat.instantBpm})` : `#${i + 1}`;
              ctx.fillText(label, px, markerY - 4);
            }
          }
        }
      }

      // 6. Draw Caliper Measurement
      if (caliperP1 !== null) {
        const x1 = toScreenX(caliperP1);
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 2]);

        // Caliper line 1
        ctx.beginPath();
        ctx.moveTo(x1, 0);
        ctx.lineTo(x1, cssH - 18);
        ctx.stroke();

        if (caliperP2 !== null) {
          const x2 = toScreenX(caliperP2);

          // Caliper line 2
          ctx.beginPath();
          ctx.moveTo(x2, 0);
          ctx.lineTo(x2, cssH - 18);
          ctx.stroke();
          ctx.setLineDash([]);

          // Connecting span band
          ctx.fillStyle = 'rgba(59, 130, 246, 0.12)';
          ctx.fillRect(Math.min(x1, x2), 0, Math.abs(x2 - x1), cssH - 18);

          // Caliper delta stats
          const dtMs = Math.abs((caliperP2 - caliperP1) / safeFs) * 1000;
          const bpm = dtMs > 0 ? Math.round(60000 / dtMs) : 0;
          const midX = (x1 + x2) / 2;

          ctx.fillStyle = '#1d4ed8';
          ctx.font = 'bold 11px var(--font-mono, monospace)';
          ctx.textAlign = 'center';
          ctx.fillText(`Δt = ${Math.round(dtMs)} ms (${bpm} BPM)`, midX, 24);
        } else {
          ctx.setLineDash([]);
        }
      }

      // 7. Hover Crosshair & Tooltip
      if (hoverInfo.visible && !caliperActive) {
        const { canvasX, value } = hoverInfo;
        const curY = toScreenY(value);

        // Vertical guide
        ctx.strokeStyle = 'rgba(15, 118, 110, 0.5)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(canvasX, 0);
        ctx.lineTo(canvasX, cssH - 18);
        ctx.stroke();
        ctx.setLineDash([]);

        // Intersection point
        ctx.fillStyle = primaryTrace;
        ctx.beginPath();
        ctx.arc(canvasX, curY, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    };

    render();
    const ro = new ResizeObserver(render);
    ro.observe(canvas);
    window.addEventListener('resize', render);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', render);
    };
  }, [
    activeSeries,
    totalDisplayLength,
    viewStart,
    viewEnd,
    viewSpan,
    safeFs,
    height,
    viewMode,
    showRPeaks,
    caliperActive,
    caliperP1,
    caliperP2,
    hoverInfo,
    processed,
    filterOpts.enableBaselineRemoval,
  ]);

  // --------------------------------------------------------------------------
  // Mini-Map Overview Canvas Rendering
  // --------------------------------------------------------------------------
  useEffect(() => {
    const canvas = miniCanvasRef.current;
    if (!canvas || totalDisplayLength < 2) return;

    const renderMini = () => {
      const rect = canvas.getBoundingClientRect();
      const cssW = Math.max(1, Math.floor(rect.width));
      const cssH = 38;
      const dpr = window.devicePixelRatio || 1;

      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      // Find overall min / max (scan every sample so raw spikes are never missed)
      let min = Infinity;
      let max = -Infinity;

      for (let i = 0; i < totalDisplayLength; i++) {
        const v = activeSeries[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const span = Math.max(max - min, 1);

      // Draw mini overview trace — per-pixel min/max so no raw sample is
      // skipped when zoomed out (strict straight segments, no smoothing).
      const isMiniRaw = viewMode !== 'filtered';
      ctx.strokeStyle = 'rgba(13, 110, 110, 0.45)';
      ctx.lineWidth = 1;
      ctx.lineJoin = isMiniRaw ? 'miter' : 'round';
      ctx.lineCap = isMiniRaw ? 'butt' : 'round';
      ctx.beginPath();
      const toMiniY = (v: number) => cssH - ((v - min) / span) * (cssH - 8) - 4;
      if (totalDisplayLength <= cssW * 2) {
        for (let i = 0; i < totalDisplayLength; i++) {
          const x = (i / (totalDisplayLength - 1)) * cssW;
          const y = toMiniY(activeSeries[i]);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      } else {
        let first = true;
        for (let px = 0; px < cssW; px++) {
          const s0 = Math.floor((px / cssW) * (totalDisplayLength - 1));
          const s1 = Math.min(
            totalDisplayLength - 1,
            Math.floor(((px + 1) / cssW) * (totalDisplayLength - 1)),
          );
          if (s1 < s0) continue;
          let bMin = Infinity;
          let bMax = -Infinity;
          for (let i = s0; i <= s1; i++) {
            const v = activeSeries[i];
            if (v < bMin) bMin = v;
            if (v > bMax) bMax = v;
          }
          if (!isFinite(bMin) || !isFinite(bMax)) continue;
          const colX = px + 0.5;
          if (first) {
            ctx.moveTo(colX, toMiniY(bMax));
            first = false;
          } else {
            ctx.lineTo(colX, toMiniY(bMax));
          }
          ctx.lineTo(colX, toMiniY(bMin));
        }
      }
      ctx.stroke();

      // Draw highlighted viewport window
      const startX = (viewStart / (totalDisplayLength - 1)) * cssW;
      const endX = (viewEnd / (totalDisplayLength - 1)) * cssW;
      const winW = Math.max(6, endX - startX);

      // Shaded background for non-selected areas
      ctx.fillStyle = 'rgba(15, 23, 42, 0.08)';
      ctx.fillRect(0, 0, startX, cssH);
      ctx.fillRect(endX, 0, cssW - endX, cssH);

      // Highlight active window
      ctx.fillStyle = 'rgba(13, 110, 110, 0.12)';
      ctx.fillRect(startX, 0, winW, cssH);

      // Border and drag handles
      ctx.strokeStyle = 'var(--accent, #0d6e6e)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(startX, 0, winW, cssH);

      // Left handle
      ctx.fillStyle = 'var(--accent, #0d6e6e)';
      ctx.fillRect(startX - 2, cssH / 2 - 8, 4, 16);
      // Right handle
      ctx.fillRect(endX - 2, cssH / 2 - 8, 4, 16);
    };

    renderMini();
    const ro = new ResizeObserver(renderMini);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [activeSeries, totalDisplayLength, viewStart, viewEnd, viewMode]);

  // Current view stats
  const currentViewDurationSec = (viewSpan / safeFs).toFixed(2);
  const zoomLevel = (totalDisplayLength / viewSpan).toFixed(1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', width: '100%' }}>
      {/* ----------------- Top Toolbar: View Controls & Zoom Presets ----------------- */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          fontSize: 'var(--text-xs)',
        }}
      >
        {/* Left: View Mode & Filtering Badges */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <div
            style={{
              display: 'inline-flex',
              background: 'var(--surface-sunken)',
              padding: 3,
              borderRadius: 'var(--r-2)',
              border: '1px solid var(--hairline)',
            }}
          >
            <button
              type="button"
              onClick={() => setViewMode('filtered')}
              style={{
                padding: '4px 10px',
                borderRadius: 'var(--r-1)',
                border: 'none',
                background: viewMode === 'filtered' ? 'var(--surface)' : 'transparent',
                color: viewMode === 'filtered' ? 'var(--accent)' : 'var(--ink-3)',
                fontWeight: viewMode === 'filtered' ? 600 : 500,
                boxShadow: viewMode === 'filtered' ? 'var(--shadow-1)' : 'none',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <Sparkles size={12} />
              Clean
            </button>
            <button
              type="button"
              onClick={() => setViewMode('raw')}
              style={{
                padding: '4px 10px',
                borderRadius: 'var(--r-1)',
                border: 'none',
                background: viewMode === 'raw' ? 'var(--surface)' : 'transparent',
                color: viewMode === 'raw' ? '#e29578' : 'var(--ink-3)',
                fontWeight: viewMode === 'raw' ? 600 : 500,
                boxShadow: viewMode === 'raw' ? 'var(--shadow-1)' : 'none',
                cursor: 'pointer',
              }}
            >
              Raw
            </button>
            <button
              type="button"
              onClick={() => setViewMode('overlay')}
              style={{
                padding: '4px 10px',
                borderRadius: 'var(--r-1)',
                border: 'none',
                background: viewMode === 'overlay' ? 'var(--surface)' : 'transparent',
                color: viewMode === 'overlay' ? 'var(--ink-1)' : 'var(--ink-3)',
                fontWeight: viewMode === 'overlay' ? 600 : 500,
                boxShadow: viewMode === 'overlay' ? 'var(--shadow-1)' : 'none',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <Layers size={12} />
              Overlay
            </button>
          </div>

          {/* Quick toggle chips */}
          <button
            type="button"
            onClick={() => updateFilterOpts((prev) => ({ ...prev, enableCrop: !prev.enableCrop }))}
            style={{
              padding: '4px 8px',
              borderRadius: 'var(--r-1)',
              border: `1px solid ${filterOpts.enableCrop ? 'var(--accent)' : 'var(--hairline)'}`,
              background: filterOpts.enableCrop ? 'var(--accent-soft)' : 'var(--surface)',
              color: filterOpts.enableCrop ? 'var(--accent)' : 'var(--ink-3)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
            title="Crop first and last 2 seconds to remove settling spike"
          >
            <Scissors size={12} />
            Crop 2s edges: {filterOpts.enableCrop ? 'ON' : 'OFF'}
          </button>

          <button
            type="button"
            onClick={() => setShowRPeaks(!showRPeaks)}
            style={{
              padding: '4px 8px',
              borderRadius: 'var(--r-1)',
              border: `1px solid ${showRPeaks ? '#ef4444' : 'var(--hairline)'}`,
              background: showRPeaks ? 'rgba(239, 68, 68, 0.1)' : 'var(--surface)',
              color: showRPeaks ? '#ef4444' : 'var(--ink-3)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            Peaks: {showRPeaks ? 'ON' : 'OFF'}
          </button>

          {processed.totalBeats > 0 && (
            <span
              style={{
                padding: '3px 8px',
                borderRadius: 'var(--r-pill)',
                background: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                color: '#ef4444',
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontWeight: 600,
              }}
              title={`${processed.totalBeats} total heartbeats detected across ${processed.totalDurationSec.toFixed(1)}s`}
            >
              ❤️ {processed.totalBeats} Beats
              {processed.heartRateBpm ? ` • ${processed.heartRateBpm} BPM` : ''}
            </span>
          )}

          <button
            type="button"
            onClick={() => {
              setCaliperActive(!caliperActive);
              if (!caliperActive) {
                setCaliperP1(null);
                setCaliperP2(null);
              }
            }}
            style={{
              padding: '4px 8px',
              borderRadius: 'var(--r-1)',
              border: `1px solid ${caliperActive ? '#3b82f6' : 'var(--hairline)'}`,
              background: caliperActive ? 'rgba(59, 130, 246, 0.12)' : 'var(--surface)',
              color: caliperActive ? '#1d4ed8' : 'var(--ink-3)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
            title="Click two points to measure interval in ms and BPM"
          >
            <Ruler size={12} />
            Caliper {caliperActive ? 'Active' : ''}
          </button>

          <button
            type="button"
            onClick={() => setShowSettings(!showSettings)}
            style={{
              padding: '4px 8px',
              borderRadius: 'var(--r-1)',
              border: '1px solid var(--hairline)',
              background: showSettings ? 'var(--surface-sunken)' : 'var(--surface)',
              color: 'var(--ink-2)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <SlidersHorizontal size={12} />
            Filters
          </button>
        </div>

        {/* Right: Zoom Controls & Presets */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: 'var(--ink-4)', fontFamily: 'var(--font-mono)' }}>
            {currentViewDurationSec}s ({zoomLevel}x)
          </span>

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
              onClick={() => zoomToSeconds(1)}
              style={presetBtnStyle}
              title="Zoom to 1 second"
            >
              1s
            </button>
            <button
              type="button"
              onClick={() => zoomToSeconds(2.5)}
              style={presetBtnStyle}
              title="Zoom to 2.5 seconds (Standard 25mm/s speed)"
            >
              2.5s
            </button>
            <button
              type="button"
              onClick={() => zoomToSeconds(5)}
              style={presetBtnStyle}
              title="Zoom to 5 seconds rhythm strip"
            >
              5s
            </button>
            <button
              type="button"
              onClick={() => zoomToSeconds(10)}
              style={presetBtnStyle}
              title="Zoom to 10 seconds"
            >
              10s
            </button>
            <button
              type="button"
              onClick={resetView}
              style={presetBtnStyle}
              title="Fit entire waveform"
            >
              All
            </button>
          </div>

          <div style={{ display: 'inline-flex', gap: 2 }}>
            <button
              type="button"
              onClick={() => zoomBy(1.4)}
              style={iconBtnStyle}
              title="Zoom Out"
            >
              <ZoomOut size={14} />
            </button>
            <button
              type="button"
              onClick={() => zoomBy(0.7)}
              style={iconBtnStyle}
              title="Zoom In"
            >
              <ZoomIn size={14} />
            </button>
            <button
              type="button"
              onClick={resetView}
              style={iconBtnStyle}
              title="Reset View (Fit)"
            >
              <Maximize2 size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* ----------------- Filter Configuration Drawer ----------------- */}
      {showSettings && (
        <div
          style={{
            padding: '10px 14px',
            background: 'var(--surface-tint)',
            border: '1px solid var(--hairline)',
            borderRadius: 'var(--r-2)',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 16,
            fontSize: 'var(--text-xs)',
          }}
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={filterOpts.enableBaselineRemoval}
              onChange={(e) =>
                updateFilterOpts((prev) => ({ ...prev, enableBaselineRemoval: e.target.checked }))
              }
            />
            <span>0.67 Hz High-pass (Baseline Wander Removal)</span>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={filterOpts.enableNotch}
              onChange={(e) => updateFilterOpts((prev) => ({ ...prev, enableNotch: e.target.checked }))}
            />
            <span>Powerline Notch</span>
          </label>

          {filterOpts.enableNotch && (
            <select
              value={filterOpts.notchFreq ?? 50}
              onChange={(e) => {
                const val = e.target.value;
                updateFilterOpts((prev) => ({
                  ...prev,
                  notchFreq: (val === '50' ? 50 : val === '60' ? 60 : val === 'both' ? 'both' : 'off') as FilterOptions['notchFreq'],
                }));
              }}
              style={{
                padding: '2px 8px',
                borderRadius: 'var(--r-1)',
                border: '1px solid var(--hairline-strong)',
                background: 'var(--surface)',
                fontSize: 'var(--text-xs)',
              }}
            >
              <option value="50">50 Hz (India / Europe)</option>
              <option value="60">60 Hz (Americas)</option>
              <option value="both">Both (50 Hz & 60 Hz)</option>
            </select>
          )}

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={filterOpts.enableLowPass}
              onChange={(e) => updateFilterOpts((prev) => ({ ...prev, enableLowPass: e.target.checked }))}
            />
            <span>40 Hz Low-pass (EMG / Muscle Noise Removal)</span>
          </label>

          <button
            type="button"
            onClick={() => setInternalFilterOpts(DEFAULT_FILTER_OPTIONS)}
            style={{
              marginLeft: 'auto',
              border: 'none',
              background: 'transparent',
              color: 'var(--accent)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <RotateCcw size={12} /> Reset to defaults
          </button>
        </div>
      )}

      {/* ----------------- Main Waveform Canvas Container ----------------- */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          borderRadius: 'var(--r-2)',
          overflow: 'hidden',
          background: 'var(--surface-tint)',
          border: '1px solid var(--hairline)',
        }}
      >
        <canvas
          ref={mainCanvasRef}
          onWheel={handleMainWheel}
          onMouseDown={handleMainMouseDown}
          onMouseMove={handleMainMouseMove}
          onMouseUp={handleMainMouseUp}
          onMouseLeave={handleMainMouseLeave}
          style={{
            display: 'block',
            width: '100%',
            height,
            cursor: caliperActive ? 'crosshair' : isDraggingMain.current ? 'grabbing' : 'grab',
          }}
        />

        {/* Empty state overlay */}
        {totalDisplayLength < 2 && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--ink-4)',
              fontSize: 'var(--text-sm)',
              pointerEvents: 'none',
            }}
          >
            {emptyLabel}
          </div>
        )}

        {/* Dynamic Hover / Caliper Tooltip */}
        {hoverInfo.visible && totalDisplayLength >= 2 && !caliperActive && (
          <div
            style={{
              position: 'absolute',
              top: 10,
              left: Math.max(10, Math.min(hoverInfo.canvasX - 60, (mainCanvasRef.current?.clientWidth || 400) - 130)),
              background: 'rgba(15, 23, 42, 0.88)',
              color: '#fff',
              padding: '4px 8px',
              borderRadius: 'var(--r-1)',
              fontSize: '11px',
              fontFamily: 'var(--font-mono, monospace)',
              pointerEvents: 'none',
              zIndex: 10,
              boxShadow: 'var(--shadow-2)',
            }}
          >
            <div>t: {hoverInfo.timeSec.toFixed(3)}s</div>
            <div>val: {Math.round(hoverInfo.value)}</div>
          </div>
        )}

        {/* Caliper Instruction / Readout */}
        {caliperActive && (
          <div
            style={{
              position: 'absolute',
              top: 10,
              right: 12,
              background: 'rgba(255, 255, 255, 0.92)',
              border: '1px solid #3b82f6',
              color: '#1d4ed8',
              padding: '4px 10px',
              borderRadius: 'var(--r-1)',
              fontSize: '11px',
              fontFamily: 'var(--font-mono, monospace)',
              pointerEvents: 'none',
              zIndex: 10,
            }}
          >
            {caliperP1 === null
              ? 'Click 1st point to start caliper'
              : caliperP2 === null
              ? 'Click 2nd point to finish caliper'
              : 'Measurement complete (click to start new)'}
          </div>
        )}
      </div>

      {/* ----------------- Mini-Map / Timeline Scrubber Track ----------------- */}
      {totalDisplayLength > 2 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '10px',
              color: 'var(--ink-4)',
              fontFamily: 'var(--font-mono, monospace)',
              padding: '0 2px',
            }}
          >
            <span>{(processed.cropStartTimeSec).toFixed(1)}s (start)</span>
            <span>Drag window to scrub timeline • Scroll wheel to zoom</span>
            <span>{(processed.cropStartTimeSec + totalDisplayLength / safeFs).toFixed(1)}s (end)</span>
          </div>
          <div
            style={{
              position: 'relative',
              width: '100%',
              height: 38,
              borderRadius: 'var(--r-1)',
              background: 'var(--surface-sunken)',
              border: '1px solid var(--hairline)',
              overflow: 'hidden',
            }}
          >
            <canvas
              ref={miniCanvasRef}
              onMouseDown={handleMiniMouseDown}
              onMouseMove={handleMiniMouseMove}
              onMouseUp={handleMiniMouseUp}
              onMouseLeave={handleMiniMouseUp}
              style={{
                display: 'block',
                width: '100%',
                height: '100%',
                cursor: 'pointer',
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

const presetBtnStyle: React.CSSProperties = {
  padding: '3px 8px',
  borderRadius: 'var(--r-1)',
  border: 'none',
  background: 'transparent',
  color: 'var(--ink-2)',
  fontFamily: 'var(--font-mono, monospace)',
  fontSize: '11px',
  cursor: 'pointer',
};

const iconBtnStyle: React.CSSProperties = {
  width: 26,
  height: 26,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 'var(--r-1)',
  border: '1px solid var(--hairline)',
  background: 'var(--surface)',
  color: 'var(--ink-2)',
  cursor: 'pointer',
};

export default ECGWaveform;
