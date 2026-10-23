import React from 'react';

type Props = React.HTMLAttributes<HTMLDivElement> & {
  as?: keyof React.JSX.IntrinsicElements;
  pad?: number | string;
  interactive?: boolean;
  tone?: 'default' | 'sunken';
};

const Card: React.FC<Props> = ({
  as = 'div',
  pad = 'var(--sp-6)',
  interactive = false,
  tone = 'default',
  style,
  className,
  ...rest
}) => {
  const Tag = as as React.ElementType;
  return (
    <Tag
      {...rest}
      className={[className, interactive ? 'card-glow' : ''].filter(Boolean).join(' ')}
      style={{
        background: tone === 'sunken' ? 'var(--surface-tint)' : 'var(--surface)',
        border: '1px solid var(--hairline)',
        borderRadius: 'var(--r-3)',
        padding: pad,
        boxShadow: 'var(--shadow-1)',
        transition: 'border-color var(--t-2) var(--ease), box-shadow var(--t-2) var(--ease)',
        ...style,
      }}
    />
  );
};

export default Card;
