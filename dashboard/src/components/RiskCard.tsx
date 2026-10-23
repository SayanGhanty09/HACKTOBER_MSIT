import type { ChronicRiskResult } from "../utils/riskThresholds";

const TONE_MAP = {
  Low:         { bg: "#f0fdf4", border: "#86efac", badge: "#16a34a", bar: "#22c55e" },
  Moderate:    { bg: "#fffbeb", border: "#fcd34d", badge: "#b45309", bar: "#f59e0b" },
  Medium:      { bg: "#fffbeb", border: "#fcd34d", badge: "#b45309", bar: "#f59e0b" },
  High:        { bg: "#fff1f2", border: "#fca5a5", badge: "#dc2626", bar: "#ef4444" },
  "Very High": { bg: "#f3e8ff", border: "#c084fc", badge: "#7e22ce", bar: "#a855f7" }
};

const SEGMENTS = [
  { label: "Low", from: 0, to: 29, color: "#22c55e" },
  { label: "Moderate", from: 29, to: 59, color: "#f59e0b" },
  { label: "High", from: 59, to: 79, color: "#ef4444" },
  { label: "Very High", from: 79, to: 100, color: "#a855f7" }
];

function polarPoint(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number, steps = 24) {
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = startAngle + ((endAngle - startAngle) * i) / steps;
    const p = polarPoint(cx, cy, r, t);
    pts.push(`${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`);
  }
  return pts.join(' ');
}

function valueToAngle(v: number) {
  const f = Math.min(1, Math.max(0, v / 100));
  return 180 - f * 180;
}

interface Props { result: ChronicRiskResult; }

export default function RiskCard({ result }: Props) {
  const t = TONE_MAP[result.riskLevel as keyof typeof TONE_MAP] || TONE_MAP.Low;

  return (
    <div style={{
      border: `1.5px solid ${t.border}`, 
      borderRadius: 16,
      background: t.bg, 
      padding: "20px 24px",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      boxShadow: "0 2px 8px rgba(0, 0, 0, 0.04)",
      animation: "slideUp 0.4s ease both"
    }}>
      {/* Left side: Disease and risk level */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h3 style={{ fontWeight: 700, fontSize: 18, margin: 0, color: "#1e293b" }}>
          {result.disease}
        </h3>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{
            background: t.badge, 
            color: "#fff", 
            borderRadius: 20,
            padding: "3px 14px", 
            fontSize: 12, 
            fontWeight: 700
          }}>
            {result.riskLevel}
          </span>
          <span style={{ fontSize: 13, color: "#64748b" }}>
            Estimated Risk
          </span>
        </div>
      </div>

      {/* Right side: Semicircular Arc Gauge */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
        <div style={{ position: "relative", width: 120, height: 70 }}>
          <svg viewBox="0 0 120 70" style={{ display: 'block', width: '100%' }}>
            {/* Base track */}
            <path
              d={arcPath(60, 60, 46, 180, 0)}
              fill="none"
              stroke="rgba(0, 0, 0, 0.05)"
              strokeWidth="8"
              strokeLinecap="round"
            />
            {/* Colored segments */}
            {SEGMENTS.map((seg, i) => {
              const startAngle = valueToAngle(seg.from) - (i === 0 ? 0 : 2.0 / 2);
              const endAngle = valueToAngle(seg.to) + (i === SEGMENTS.length - 1 ? 0 : 2.0 / 2);
              return (
                <path
                  key={seg.label}
                  d={arcPath(60, 60, 46, startAngle, endAngle)}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth="8"
                  strokeLinecap="round"
                />
              );
            })}
            {/* Pointer circle */}
            {(() => {
              const a = valueToAngle(result.score);
              const p = polarPoint(60, 60, 46, a);
              return (
                <circle
                  cx={p.x}
                  cy={p.y}
                  r="5"
                  fill="#1e293b"
                  stroke="#fff"
                  strokeWidth="2"
                />
              );
            })()}
          </svg>
        </div>
        <div style={{
          fontSize: "14px",
          fontWeight: 700,
          color: "#1e293b",
          fontFamily: "monospace",
          marginTop: "-10px"
        }}>
          {result.score}%
        </div>
      </div>
    </div>
  );
}
