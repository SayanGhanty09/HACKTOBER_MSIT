import React from 'react';

type Props = {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
};

const SectionHeader: React.FC<Props> = ({ eyebrow, title, description, actions }) => (
  <header
    style={{
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: 'var(--sp-4)',
      flexWrap: 'wrap',
    }}
  >
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {eyebrow && (
        <span
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--ink-3)',
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            fontWeight: 500,
          }}
        >
          {eyebrow}
        </span>
      )}
      <h2
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 400,
          letterSpacing: '-0.02em',
          fontSize: 'var(--text-xl)',
          lineHeight: 1.1,
          color: 'var(--ink)',
        }}
      >
        {title}
      </h2>
      {description && (
        <p style={{ color: 'var(--ink-3)', fontSize: 'var(--text-sm)', maxWidth: '52ch' }}>{description}</p>
      )}
    </div>
    {actions && <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>{actions}</div>}
  </header>
);

export default SectionHeader;
