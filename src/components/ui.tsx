import { useEffect, type ReactNode } from "react";
import type { SliceDept } from "../lib/tracker";

export const DEPT_COLORS: Record<SliceDept, string> = {
  Hematology: "#f472b6",
  Microbiology: "#a78bfa",
  Chemistry: "#22d3ee",
  Immunology: "#60a5fa",
  Unclassified: "#94a3b8",
};
export const DEPT_SHORT: Record<SliceDept, string> = {
  Hematology: "Heme", Microbiology: "Micro", Chemistry: "Chem", Immunology: "Immuno", Unclassified: "Other",
};
export const C = {
  bg: "#070d1a", surface: "#0c1628", panel: "#0a1220", card: "#101e35", border: "#1a2f50", track: "#1e3a5f",
  primary: "#22d3ee", success: "#10b981", done: "#4ade80", warning: "#f59e0b", danger: "#ef4444",
  text: "#e2e8f0", dim: "#94a3b8", muted: "#7c8ba1",
};

type Tone = "primary" | "ghost" | "danger" | "quiet";
export function Button({ tone = "ghost", children, className = "", ...rest }:
  { tone?: Tone; children: ReactNode; className?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const styles: Record<Tone, string> = {
    primary: "bg-[#22d3ee] text-[#070d1a] hover:bg-[#67e8f9] font-semibold",
    ghost: "border border-[#1a2f50] text-[#94a3b8] hover:border-[#22d3ee80] hover:text-[#e2e8f0]",
    danger: "border border-[#ef444460] text-[#fca5a5] hover:bg-[#ef444415]",
    quiet: "text-[#94a3b8] hover:text-[#e2e8f0]",
  };
  return (
    <button {...rest}
      className={`inline-flex items-center justify-center gap-1.5 rounded px-3 py-1.5 text-xs font-display transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ${styles[tone]} ${className}`}>
      {children}
    </button>
  );
}

export function Badge({ color, children, solid = false, title }: { color: string; children: ReactNode; solid?: boolean; title?: string }) {
  return (
    <span title={title} className="status-badge whitespace-nowrap"
      style={solid ? { background: color, color: C.bg } : { background: `${color}1f`, color }}>
      {children}
    </span>
  );
}

export function StatCard({ label, value, sub, color }: { label: string; value: ReactNode; sub?: ReactNode; color: string }) {
  return (
    <div className="glass-card rounded-lg p-3 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-0.5" style={{ background: color }} />
      <div className="font-mono text-[0.65rem] text-[#7c8ba1] mb-1">{label}</div>
      <div className="font-display text-2xl font-bold leading-none" style={{ color }}>{value}</div>
      {sub && <div className="font-mono text-[0.65rem] text-[#7c8ba1] mt-1">{sub}</div>}
    </div>
  );
}

export function Panel({ title, action, children }: { title: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="glass-card rounded-lg p-5 mb-5">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <h2 className="font-display font-semibold text-base text-[#e2e8f0]">{title}</h2>
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 no-print" style={{ background: "rgba(3,7,15,0.72)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true"
        className={`w-full ${wide ? "max-w-3xl" : "max-w-xl"} max-h-[88vh] overflow-y-auto rounded-xl border p-6`}
        style={{ background: C.surface, borderColor: C.border }}>
        <div className="flex items-start justify-between mb-4 gap-4">
          <h3 className="font-display font-bold text-lg text-[#e2e8f0]">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="text-[#7c8ba1] hover:text-[#e2e8f0] text-xl leading-none cursor-pointer">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const inputBase = "rounded px-2.5 py-1.5 text-xs font-mono outline-none bg-[#101e35] border border-[#1a2f50] text-[#e2e8f0] focus:border-[#22d3ee80] placeholder:text-[#4b5b73]";
export const inputCls = inputBase + " w-full";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block text-xs text-[#94a3b8] mb-3">
      <span className="block mb-1 font-display">{label}</span>
      {children}
      {hint && <span className="block mt-1 text-[0.7rem] text-[#7c8ba1]">{hint}</span>}
    </label>
  );
}

export function Note({ tone, children }: { tone: "err" | "ok" | "warn" | "info"; children: ReactNode }) {
  const c = tone === "err" ? C.danger : tone === "ok" ? C.success : tone === "warn" ? C.warning : C.primary;
  return (
    <div className="rounded px-3 py-2.5 text-xs leading-relaxed mb-3" style={{ background: `${c}14`, border: `1px solid ${c}40`, color: tone === "info" ? C.dim : c }}>
      {children}
    </div>
  );
}

export function downloadFile(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const stamp = () => {
  const n = new Date();
  const p = (x: number) => String(x).padStart(2, "0");
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}_${p(n.getHours())}-${p(n.getMinutes())}`;
};
export const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
