import React from 'react';

type Props = React.HTMLAttributes<HTMLDivElement> & {
  label: string;
  value: React.ReactNode;
  unit?: string;
  hint?: React.ReactNode;
  leadingIcon?: React.ReactNode;
  accent?: string;
};

const KpiTile: React.FC<Props> = ({ label, value, unit, hint, leadingIcon, accent, style, ...rest }) => {
  return (
    <div
      {...rest}
      style={{
        position: 'relative',
        background: 'var(--surface)',
        border: '1px solid var(--hairline)',
        borderRadius: 'var(--r-3)',
        padding: 'var(--sp-5) var(--sp-5) var(--sp-4)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--sp-2)',
        boxShadow: 'var(--shadow-1)',
        overflow: 'hidden',
        ...style,
      }}
    >
      {accent && (
        <span
          aria-hidden
          style={{
            position: 'absolute', top: 0, left: 0, right: 0,
            height: 2, background: accent, opacity: 0.85,
          }}
        />
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--ink-3)' }}>
        <span style={{ fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>{label}</span>
        {leadingIcon}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span
          className="num"
          style={{
            fontFamily: 'var(--font-mono)',
            fontWeight: 500,
            fontSize: 'var(--text-2xl)',
            color: 'var(--ink)',
            letterSpacing: '-0.02em',
            lineHeight: 1.1,
          }}
        >
          {value}
        </span>
        {unit && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--ink-3)' }}>{unit}</span>
        )}
      </div>
      {hint && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)' }}>{hint}</div>
      )}
    </div>
  );
};

export default KpiTile;
