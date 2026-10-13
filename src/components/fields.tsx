import { useState, type ReactNode } from "react";

export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

function parseList(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Keeps the raw text locally so typing a trailing comma does not get normalised away mid-word.
export function ListInput({
  value,
  onChange,
  placeholder,
  multiline = false,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  const [raw, setRaw] = useState(value.join(", "));
  const update = (s: string) => {
    setRaw(s);
    onChange(parseList(s));
  };
  return multiline ? (
    <textarea rows={3} value={raw} placeholder={placeholder} onChange={(e) => update(e.target.value)} />
  ) : (
    <input value={raw} placeholder={placeholder} onChange={(e) => update(e.target.value)} />
  );
}

export function NumberInput({
  value,
  onChange,
  placeholder,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="number"
      min={0}
      step="0.5"
      inputMode="decimal"
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
    />
  );
}
