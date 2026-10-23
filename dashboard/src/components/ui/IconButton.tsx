import React from 'react';

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: number;
  tone?: 'default' | 'danger';
};

const IconButton: React.FC<Props> = ({ size = 32, tone = 'default', style, ...rest }) => {
  const [hover, setHover] = React.useState(false);
  const fg = tone === 'danger' ? 'var(--error)' : 'var(--ink-2)';
  return (
    <button
      {...rest}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: size, height: size,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: hover ? 'var(--surface-tint)' : 'transparent',
        color: fg,
        border: '1px solid transparent',
        borderRadius: 'var(--r-2)',
        cursor: 'pointer',
        transition: 'background-color var(--t-2) var(--ease), color var(--t-2) var(--ease)',
        ...style,
      }}
    />
  );
};

export default IconButton;
