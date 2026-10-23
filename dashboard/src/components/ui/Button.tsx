import React from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  loading?: boolean;
  block?: boolean;
};

const sizes: Record<Size, React.CSSProperties> = {
  sm: { padding: '6px 10px', fontSize: 'var(--text-sm)', borderRadius: 'var(--r-2)', gap: 6 },
  md: { padding: '9px 14px', fontSize: 'var(--text-base)', borderRadius: 'var(--r-2)', gap: 8 },
  lg: { padding: '12px 18px', fontSize: 'var(--text-md)', borderRadius: 'var(--r-2)', gap: 10 },
};

const variants: Record<Variant, React.CSSProperties> = {
  primary: {
    background: 'var(--accent)',
    color: 'var(--accent-ink)',
    border: '1px solid var(--accent)',
  },
  secondary: {
    background: 'var(--surface)',
    color: 'var(--ink)',
    border: '1px solid var(--hairline-strong)',
  },
  ghost: {
    background: 'transparent',
    color: 'var(--ink-2)',
    border: '1px solid transparent',
  },
  danger: {
    background: 'var(--surface)',
    color: 'var(--error)',
    border: '1px solid var(--hairline-strong)',
  },
};

const Button: React.FC<Props> = ({
  variant = 'primary',
  size = 'md',
  leadingIcon,
  trailingIcon,
  loading = false,
  block = false,
  disabled,
  style,
  children,
  onMouseEnter,
  onMouseLeave,
  ...rest
}) => {
  const [hover, setHover] = React.useState(false);

  const hoverStyle: React.CSSProperties = (() => {
    if (disabled || loading) return {};
    if (!hover) return {};
    switch (variant) {
      case 'primary':
        return { background: 'color-mix(in oklab, var(--accent) 88%, black)', boxShadow: '0 6px 18px -8px var(--accent-glow)' };
      case 'secondary':
        return { background: 'var(--surface-tint)', borderColor: 'var(--ink-3)' };
      case 'ghost':
        return { background: 'var(--surface-tint)' };
      case 'danger':
        return { background: 'color-mix(in oklab, var(--error-soft), white 20%)', borderColor: 'var(--error)' };
    }
  })();

  return (
    <button
      {...rest}
      disabled={disabled || loading}
      onMouseEnter={(e) => { setHover(true); onMouseEnter?.(e); }}
      onMouseLeave={(e) => { setHover(false); onMouseLeave?.(e); }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-sans)',
        fontWeight: 500,
        letterSpacing: '-0.005em',
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        transition: 'background-color var(--t-2) var(--ease), border-color var(--t-2) var(--ease), box-shadow var(--t-2) var(--ease), transform var(--t-1) var(--ease)',
        width: block ? '100%' : undefined,
        whiteSpace: 'nowrap',
        ...sizes[size],
        ...variants[variant],
        ...hoverStyle,
        ...style,
      }}
    >
      {loading ? <Spinner /> : leadingIcon}
      {children && <span>{children}</span>}
      {!loading && trailingIcon}
    </button>
  );
};

const Spinner: React.FC = () => (
  <span
    aria-hidden
    style={{
      width: 14, height: 14,
      border: '1.6px solid currentColor',
      borderRightColor: 'transparent',
      borderRadius: '50%',
      display: 'inline-block',
      animation: 'ui-spin 0.9s linear infinite',
      opacity: 0.85,
    }}
  />
);

export default Button;
