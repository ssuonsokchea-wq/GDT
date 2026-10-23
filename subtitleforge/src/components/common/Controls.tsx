/**
 * Form controls.
 *
 * Deliberately plain: a labelled row, a value readout, a native input. The
 * style panel has thirty of these, and anything more decorated would compete
 * with the video for attention.
 */

import clsx from 'clsx';
import type { ChangeEvent, ReactNode } from 'react';

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={clsx('block', className)}>
      <span className="field-label">{label}</span>
      <div className="mt-1">{children}</div>
      {hint ? <p className="mt-1 text-2xs leading-snug text-ink-500">{hint}</p> : null}
    </label>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <span className="field-label">{label}</span>
        <span className="font-mono text-2xs text-ink-300">
          {Number.isInteger(value) ? value : value.toFixed(1)}
          {unit ? <span className="text-ink-500">{unit}</span> : null}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(Number(event.target.value))}
        className={clsx(
          'h-1.5 w-full cursor-pointer appearance-none rounded-full bg-panel-750 disabled:opacity-50',
          '[&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none',
          '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent',
          '[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-panel-900',
          '[&::-webkit-slider-thumb]:shadow',
        )}
      />
    </div>
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  disabled,
  className,
}: {
  value: T;
  options: Array<{ value: T; label: string; disabled?: boolean }>;
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as T)}
      className={clsx(
        'h-8 w-full rounded border border-panel-700 bg-panel-850 px-2 text-xs text-ink-100',
        'hover:border-panel-600 focus:border-accent focus:outline-none disabled:opacity-50',
        className,
      )}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  mono,
  className,
  onBlur,
  onKeyDown,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
  className?: string;
  onBlur?: () => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      className={clsx(
        'h-8 w-full rounded border border-panel-700 bg-panel-850 px-2 text-xs text-ink-100',
        'placeholder:text-ink-500 hover:border-panel-600 focus:border-accent focus:outline-none',
        mono && 'font-mono',
        className,
      )}
    />
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  hint,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className={clsx('flex items-start gap-2.5', disabled && 'opacity-50')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          'mt-0.5 h-4 w-7 shrink-0 rounded-full p-0.5 transition-colors duration-120',
          checked ? 'bg-accent' : 'bg-panel-700',
        )}
      >
        <span
          className={clsx(
            'block h-3 w-3 rounded-full bg-white transition-transform duration-120',
            checked && 'translate-x-3',
          )}
        />
      </button>
      <span className="min-w-0">
        <span className="block text-xs text-ink-200">{label}</span>
        {hint ? <span className="mt-0.5 block text-2xs leading-snug text-ink-500">{hint}</span> : null}
      </span>
    </label>
  );
}

export function ColorInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <span className="field-label">{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          value={value.slice(0, 7)}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="h-8 w-8 shrink-0 cursor-pointer rounded border border-panel-700 bg-panel-850 p-0.5"
        />
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="h-8 min-w-0 flex-1 rounded border border-panel-700 bg-panel-850 px-2 font-mono text-2xs uppercase text-ink-200 focus:border-accent focus:outline-none"
        />
      </div>
    </div>
  );
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: Array<{ value: T; label: string; title?: string }>;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={clsx('inline-flex rounded border border-panel-700 bg-panel-850 p-0.5', className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          onClick={() => onChange(option.value)}
          className={clsx(
            'flex-1 rounded px-2 py-1 text-2xs font-medium transition-colors duration-120',
            value === option.value ? 'bg-accent text-white' : 'text-ink-400 hover:text-ink-100',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  title,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'ok' | 'warn' | 'error' | 'accent';
  title?: string;
}) {
  const tones = {
    neutral: 'bg-panel-750 text-ink-300',
    ok: 'bg-signal-ok/15 text-signal-ok',
    warn: 'bg-signal-warn/15 text-signal-warn',
    error: 'bg-signal-error/15 text-signal-error',
    accent: 'bg-accent-soft text-accent-hover',
  } as const;
  return (
    <span
      title={title}
      className={clsx('inline-flex items-center rounded px-1.5 py-0.5 text-2xs font-medium', tones[tone])}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon?: ReactNode;
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      {icon ? <div className="text-ink-500">{icon}</div> : null}
      <div>
        <h3 className="text-sm font-medium text-ink-200">{title}</h3>
        {message ? <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-ink-500">{message}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function ProgressBar({
  value,
  tone = 'accent',
  className,
}: {
  value: number;
  tone?: 'accent' | 'ok' | 'warn' | 'error';
  className?: string;
}) {
  const tones = {
    accent: 'bg-accent',
    ok: 'bg-signal-ok',
    warn: 'bg-signal-warn',
    error: 'bg-signal-error',
  } as const;
  return (
    <div className={clsx('h-1 overflow-hidden rounded-full bg-panel-750', className)}>
      <div
        className={clsx('h-full rounded-full transition-[width] duration-200 ease-out', tones[tone])}
        style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }}
      />
    </div>
  );
}
