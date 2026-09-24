import { useEffect, type ReactNode } from "react";
import type { SliceDept } from "../lib/tracker";

/* Colours are CSS variables so every theme (light, dark, high contrast) works. */
export const C = {
  canvas: "var(--canvas)", surface: "var(--surface)", raised: "var(--raised)", line: "var(--line)", track: "var(--track)",
  ink: "var(--ink)", ink2: "var(--ink-2)", ink3: "var(--ink-3)",
  accent: "var(--accent)", danger: "var(--danger)", warning: "var(--warning)", success: "var(--success)", alist: "var(--alist)",
};
export const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

// Specimen tube cap colours
export const DEPT_COLORS: Record<SliceDept, string> = {
  Hematology: "var(--cap-heme)", Microbiology: "var(--cap-micro)", Chemistry: "var(--cap-chem)",
  Immunology: "var(--cap-immuno)", Unclassified: "var(--cap-other)",
};
export const DEPT_SHORT: Record<SliceDept, string> = {
  Hematology: "Heme", Microbiology: "Micro", Chemistry: "Chem", Immunology: "Immuno", Unclassified: "Other",
};

/** A small specimen-tube cap: the department marker used throughout. */
export function Cap({ dept, size = 14 }: { dept: SliceDept; size?: number }) {
  const c = DEPT_COLORS[dept];
  return (
    <svg style={{ width: `${size / 16}rem`, height: `${(size * 1.15) / 16}rem` }} viewBox="0 0 14 16" aria-hidden className="shrink-0">
      <rect x="1" y="0.5" width="12" height="6" rx="2" fill={c} />
      <rect x="3" y="6.5" width="8" height="9" rx="3.5" fill="none" stroke={c} strokeWidth="1.4" opacity="0.55" />
    </svg>
  );
}

type Tone = "primary" | "ghost" | "danger" | "quiet";
export function Button({ tone = "ghost", children, className = "", ...rest }:
  { tone?: Tone; children: ReactNode; className?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const styles: Record<Tone, string> = {
    primary: "bg-accent text-accent-ink hover:brightness-110 font-semibold border border-accent",
    ghost: "bg-surface border border-line text-ink hover:border-line-strong hover:bg-raised",
    danger: "bg-surface border border-danger text-danger hover:bg-raised",
    quiet: "text-accent hover:underline underline-offset-2",
  };
  return (
    <button {...rest}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer ${styles[tone]} ${className}`}>
      {children}
    </button>
  );
}

export function Badge({ color, children, solid = false, title }: { color: string; children: ReactNode; solid?: boolean; title?: string }) {
  return (
    <span title={title} className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap"
      style={solid ? { background: color, color: "var(--surface)" } : { background: tint(color, 14), color }}>
      {children}
    </span>
  );
}

export function Panel({ title, action, children, className = "" }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card p-5 mb-5 ${className}`}>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <h2 className="font-semibold text-lg text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Modal({ open, onClose, title, children, wide = false }:
  { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 no-print" style={{ background: "rgb(10 16 24 / 0.5)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" className={`card w-full ${wide ? "max-w-3xl" : "max-w-xl"} max-h-[88vh] overflow-y-auto p-6`}>
        <div className="flex items-start justify-between mb-4 gap-4">
          <h3 className="font-semibold text-xl text-ink">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="text-ink-3 hover:text-ink text-2xl leading-none cursor-pointer px-1">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const inputBase = "rounded-md px-2.5 py-1.5 text-sm outline-none bg-surface border border-line text-ink focus:border-accent placeholder:text-ink-3";
export const inputCls = inputBase + " w-full";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block text-sm text-ink-2 mb-3">
      <span className="block mb-1 font-medium">{label}</span>
      {children}
      {hint && <span className="block mt-1 text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

export function Note({ tone, children }: { tone: "err" | "ok" | "warn" | "info"; children: ReactNode }) {
  const c = tone === "err" ? C.danger : tone === "ok" ? C.success : tone === "warn" ? C.warning : C.accent;
  return (
    <div className="rounded-md px-3 py-2.5 text-sm leading-relaxed mb-3 text-ink"
      style={{ background: tint(c, 9), borderLeft: `4px solid ${c}` }}>
      {children}
    </div>
  );
}

export function Stat({ label, value, color = C.ink, sub }: { label: string; value: ReactNode; color?: string; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="num text-3xl font-semibold leading-none" style={{ color }}>{value}</div>
      <div className="text-sm text-ink-2 mt-1">{label}</div>
      {sub && <div className="text-xs text-ink-3 mt-0.5">{sub}</div>}
    </div>
  );
}

export function downloadFile(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const stamp = () => {
  const n = new Date();
  const p = (x: number) => String(x).padStart(2, "0");
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}_${p(n.getHours())}-${p(n.getMinutes())}`;
};
export const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

/** Logo: a rack of four tube caps, one per department. */
export function Logo({ size = 34 }: { size?: number }) {
  const caps = ["var(--cap-heme)", "var(--cap-micro)", "var(--cap-chem)", "var(--cap-immuno)"];
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" aria-hidden className="shrink-0">
      <rect x="0.5" y="0.5" width="33" height="33" rx="8" fill="var(--ink)" />
      {caps.map((c, i) => (
        <g key={i}>
          <rect x={5 + i * 6.5} y="8" width="5" height="4" rx="1.2" fill={c} />
          <rect x={5.6 + i * 6.5} y="12" width="3.8" height="14" rx="1.9" fill="none" stroke="var(--surface)" strokeWidth="1" opacity="0.7" />
        </g>
      ))}
    </svg>
  );
}
