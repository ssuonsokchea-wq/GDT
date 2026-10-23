import clsx from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  iconRight?: ReactNode;
  loading?: boolean;
  full?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover active:bg-accent-muted disabled:bg-accent/40',
  secondary: 'bg-panel-750 text-ink-100 hover:bg-panel-700 active:bg-panel-800 border border-panel-700',
  ghost: 'bg-transparent text-ink-300 hover:bg-panel-800 hover:text-ink-100',
  danger: 'bg-signal-error/15 text-signal-error border border-signal-error/40 hover:bg-signal-error/25',
};

const SIZES: Record<Size, string> = {
  sm: 'h-7 px-2 text-xs gap-1.5 rounded',
  md: 'h-9 px-3 text-sm gap-2 rounded-md',
  lg: 'h-11 px-4 text-sm gap-2 rounded-md font-medium',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconRight,
  loading,
  full,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center whitespace-nowrap font-medium transition-colors duration-120',
        'disabled:cursor-not-allowed disabled:opacity-60',
        VARIANTS[variant],
        SIZES[size],
        full && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
      {iconRight}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={clsx('animate-spin', className ?? 'h-3.5 w-3.5')}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function IconButton({
  label,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={clsx(
        'inline-flex h-7 w-7 items-center justify-center rounded text-ink-300 transition-colors duration-120',
        'hover:bg-panel-750 hover:text-ink-100 disabled:opacity-40 disabled:hover:bg-transparent',
        className,
      )}
      {...rest}
    />
  );
}
