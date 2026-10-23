import React from 'react';

type Tone = 'neutral' | 'accent' | 'success' | 'warn' | 'error';

type Props = React.HTMLAttributes<HTMLSpanElement> & {
  tone?: Tone;
  leadingIcon?: React.ReactNode;
  dot?: boolean;
  size?: 'sm' | 'md';
};

const palette: Record<Tone, { bg: string; fg: string; ring: string; dot: string }> = {
  neutral: { bg: 'var(--surface-tint)',     fg: 'var(--ink-2)',  ring: 'var(--hairline)',                       dot: 'var(--ink-3)' },
  accent:  { bg: 'var(--accent-soft)',      fg: 'var(--accent)', ring: 'var(--accent-soft-2)',                  dot: 'var(--accent)' },
  success: { bg: 'var(--success-soft)',     fg: 'var(--success)',ring: 'color-mix(in oklab, var(--success) 22%, transparent)', dot: 'var(--success)' },
  warn:    { bg: 'var(--warn-soft)',        fg: 'var(--warn)',   ring: 'color-mix(in oklab, var(--warn) 22%, transparent)',    dot: 'var(--warn)' },
  error:   { bg: 'var(--error-soft)',       fg: 'var(--error)',  ring: 'color-mix(in oklab, var(--error) 22%, transparent)',   dot: 'var(--error)' },
};

const Pill: React.FC<Props> = ({ tone = 'neutral', leadingIcon, dot, size = 'md', style, children, ...rest }) => {
  const c = palette[tone];
  const padY = size === 'sm' ? 3 : 4;
  const padX = size === 'sm' ? 8 : 10;
  const fs   = size === 'sm' ? 'var(--text-xs)' : 'var(--text-sm)';
  return (
    <span
      {...rest}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        background: c.bg,
        color: c.fg,
        border: `1px solid ${c.ring}`,
        padding: `${padY}px ${padX}px`,
        borderRadius: 'var(--r-pill)',
        fontSize: fs,
        fontWeight: 500,
        letterSpacing: '-0.005em',
        lineHeight: 1,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {dot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.dot }} />}
      {leadingIcon}
      {children}
    </span>
  );
};

export default Pill;
