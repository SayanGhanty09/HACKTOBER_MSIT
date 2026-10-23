import React from 'react';
import { CheckCircle2, AlertTriangle, AlertCircle } from 'lucide-react';
import Card from '../ui/Card';
import Pill from '../ui/Pill';
import type { RiskScale, RiskTone } from '../../utils/riskThresholds';
import { classify } from '../../utils/riskThresholds';

// A "value against a risk threshold" reads as a meter/gauge, not a pie slice —
// a two-slice pie can't show where the value sits relative to the bands, or
// how close it is to crossing one. This is a semicircular meter: colored
// risk-zone arcs (the site's own status tokens) plus a pointer at the current
// reading.

const TONE_COLOR: Record<RiskTone, string> = {
  success: 'var(--success)',
  warn: 'var(--warn)',
  error: 'var(--error)',
};

const TONE_ICON: Record<RiskTone, React.ElementType> = {
  success: CheckCircle2,
  warn: AlertTriangle,
  error: AlertCircle,
};

interface Props {
  title: string;
  subtitle?: string;
  value?: number;
  scale: RiskScale;
  precision?: number;
  /** e.g. "anemia" / "jaundice" — used in the probability caption below. */
  riskName?: string;
  /** 0-100. Only rendered when provided (e.g. once a scan finishes). */
  probability?: number;
}

const CX = 100;
const CY = 96;
const R = 76;
const STROKE = 14;
const GAP_DEG = 2.4; // visual seam between adjacent risk-zone segments

function polarPoint(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
}

// Samples points along the angle range rather than using an SVG arc-flag —
// angle always stays within [0, 180] here so linear sampling can't take the
// "wrong way round" the circle the way an A-command sweep flag could.
function arcPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number, steps = 28) {
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = startAngle + ((endAngle - startAngle) * i) / steps;
    const p = polarPoint(cx, cy, r, t);
    pts.push(`${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`);
  }
  return pts.join(' ');
}

function valueToAngle(v: number, min: number, max: number) {
  const f = Math.min(1, Math.max(0, (v - min) / (max - min)));
  return 180 - f * 180;
}

const RiskGaugeCard: React.FC<Props> = ({ title, subtitle, value, scale, precision = 2, riskName, probability }) => {
  const { min, max, unit, zones } = scale;
  const hasReading = value !== undefined && value !== null && !Number.isNaN(value);
  const clamped = hasReading ? Math.min(max, Math.max(min, value as number)) : undefined;
  const zone = hasReading ? classify(clamped as number, scale) : undefined;
  const ZoneIcon = zone ? TONE_ICON[zone.tone] : undefined;

  const segments = zones.map((z, i) => ({ ...z, from: i === 0 ? min : zones[i - 1].to }));

  return (
    <Card pad="var(--sp-5)" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', alignItems: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignSelf: 'flex-start' }}>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.14em', fontWeight: 500 }}>
          {title}
        </span>
        {subtitle && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-4)' }}>{subtitle}</span>}
      </div>

      <svg viewBox="0 0 200 122" role="img" aria-label={`${title} gauge`} style={{ display: 'block', width: '100%', maxWidth: 260 }}>
        {/* base track (the seam between colored zones shows this through) */}
        <path d={arcPath(CX, CY, R, 180, 0, 48)} fill="none" stroke="var(--hairline-strong)" strokeWidth={STROKE} strokeLinecap="round" />

        {/* risk-zone segments */}
        {segments.map((seg, i) => {
          const startAngle = valueToAngle(seg.from, min, max) - (i === 0 ? 0 : GAP_DEG / 2);
          const endAngle = valueToAngle(seg.to, min, max) + (i === segments.length - 1 ? 0 : GAP_DEG / 2);
          return (
            <path
              key={seg.label}
              d={arcPath(CX, CY, R, startAngle, endAngle)}
              fill="none"
              stroke={TONE_COLOR[seg.tone]}
              strokeWidth={STROKE}
              strokeLinecap="round"
            >
              <title>{`${seg.label}: ${seg.from.toFixed(1)}–${seg.to.toFixed(1)} ${unit}`}</title>
            </path>
          );
        })}

        {/* pointer at the current reading */}
        {hasReading && (() => {
          const a = valueToAngle(clamped as number, min, max);
          const p = polarPoint(CX, CY, R, a);
          return <circle cx={p.x} cy={p.y} r={7} fill="var(--ink)" stroke="var(--surface)" strokeWidth={3} />;
        })()}

        <text x={CX - R} y={CY + 16} textAnchor="middle" fontSize="10" fill="var(--ink-4)" fontFamily="var(--font-mono)">{min}</text>
        <text x={CX + R} y={CY + 16} textAnchor="middle" fontSize="10" fill="var(--ink-4)" fontFamily="var(--font-mono)">{max}</text>
      </svg>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, marginTop: -8 }}>
        <span className="num" style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: 'var(--text-2xl)', letterSpacing: '-0.02em', color: 'var(--ink)' }}>
          {hasReading ? (value as number).toFixed(precision) : '—'}
        </span>
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-3)' }}>{unit}</span>
      </div>

      {zone && ZoneIcon ? (
        <Pill tone={zone.tone} leadingIcon={<ZoneIcon size={12} strokeWidth={1.8} />} size="sm">
          {zone.label}
        </Pill>
      ) : (
        <Pill tone="neutral" size="sm">No reading yet</Pill>
      )}

      {probability !== undefined && riskName && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span
            className="num"
            style={{
              fontFamily: 'var(--font-mono)',
              fontWeight: 600,
              fontSize: 'var(--text-lg)',
              color: zone ? TONE_COLOR[zone.tone] : 'var(--ink-2)',
            }}
          >
            {probability}%
          </span>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)' }}>probability of {riskName}</span>
        </div>
      )}

      <div
        style={{
          display: 'flex', flexWrap: 'wrap', gap: '8px 16px', justifyContent: 'center',
          paddingTop: 'var(--sp-3)', marginTop: 4, width: '100%',
          borderTop: '1px solid var(--hairline)',
        }}
      >
        {segments.map((seg) => (
          <div key={seg.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: TONE_COLOR[seg.tone], flexShrink: 0 }} />
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)' }}>
              {seg.label}{' '}
              <span className="num" style={{ color: 'var(--ink-2)' }}>
                {seg.from.toFixed(1)}–{seg.to.toFixed(1)}
              </span>
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
};

export default RiskGaugeCard;
