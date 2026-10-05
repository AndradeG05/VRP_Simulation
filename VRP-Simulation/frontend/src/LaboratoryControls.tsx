import type { ReactNode } from 'react';

export function NumberField({ label, value, onChange, min = 0, max, step = 1 }: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return <label className="number-field">
    <span>{label}</span>
    <input aria-label={label} type="number" value={value} min={min} max={max} step={step}
      onChange={event => onChange(Number(event.target.value))} />
  </label>;
}

export function Metric({ label, value, unit, children }: {
  label: string;
  value: ReactNode;
  unit?: string;
  children?: ReactNode;
}) {
  return <div className="metric">
    <span className="eyebrow">{label}</span>
    <div className="metric-value">{value}<small>{unit}</small></div>
    {children}
  </div>;
}
