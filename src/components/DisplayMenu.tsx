import { useEffect, useRef, useState } from "react";
import type { Display, Font, Theme, Density } from "../lib/display";

const SIZES: { v: Display["size"]; label: string }[] = [
  { v: 1, label: "Small" }, { v: 2, label: "Standard" }, { v: 3, label: "Large" }, { v: 4, label: "Larger" }, { v: 5, label: "Largest" },
];
const THEMES: { v: Theme; label: string; hint: string }[] = [
  { v: "light", label: "Light", hint: "Default, for well-lit benches" },
  { v: "dark", label: "Dark", hint: "Easier on the eyes on night shift" },
  { v: "contrast", label: "High contrast", hint: "Black on white, strongest outlines" },
];
const FONTS: { v: Font; label: string; sample: string }[] = [
  { v: "hyperlegible", label: "Hyperlegible", sample: "'Atkinson Hyperlegible Next', sans-serif" },
  { v: "standard", label: "Standard", sample: "'Source Sans 3', sans-serif" },
  { v: "system", label: "This computer's font", sample: "system-ui, sans-serif" },
];

function Seg<T extends string | number>({ value, options, onChange, label }: {
  value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-md border border-line overflow-hidden">
      {options.map((o) => (
        <button key={String(o.v)} role="radio" aria-checked={value === o.v} onClick={() => onChange(o.v)}
          className={`flex-1 px-2 py-1.5 text-sm cursor-pointer ${value === o.v ? "bg-accent text-accent-ink" : "bg-surface text-ink hover:bg-raised"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function DisplayMenu({ d, set }: { d: Display; set: (p: Partial<Display>) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog"
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-line bg-surface text-ink hover:bg-raised cursor-pointer text-sm"
        title="Text size and appearance">
        <span aria-hidden className="font-semibold"><span className="text-xs">A</span><span className="text-base">A</span></span>
        Display
      </button>
      {open && (
        <div role="dialog" aria-label="Display settings" className="card absolute right-0 mt-2 w-80 p-4 z-50">
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-semibold text-ink">Text size</span>
              <span className="text-sm text-ink-2">{SIZES.find((s) => s.v === d.size)?.label}</span>
            </div>
            <div className="flex items-center gap-2">
              <button className="w-9 h-9 rounded-md border border-line bg-surface hover:bg-raised text-sm cursor-pointer disabled:opacity-40"
                disabled={d.size <= 1} onClick={() => set({ size: (d.size - 1) as Display["size"] })} aria-label="Smaller text">A−</button>
              <input type="range" min={1} max={5} step={1} value={d.size} aria-label="Text size"
                onChange={(e) => set({ size: Number(e.target.value) as Display["size"] })} className="flex-1 accent-[var(--accent)]" />
              <button className="w-9 h-9 rounded-md border border-line bg-surface hover:bg-raised text-lg cursor-pointer disabled:opacity-40"
                disabled={d.size >= 5} onClick={() => set({ size: (d.size + 1) as Display["size"] })} aria-label="Larger text">A+</button>
            </div>
          </div>

          <div className="mb-4">
            <span className="block text-sm font-semibold text-ink mb-1.5">Theme</span>
            <div className="space-y-1.5" role="radiogroup" aria-label="Theme">
              {THEMES.map((t) => (
                <button key={t.v} role="radio" aria-checked={d.theme === t.v} onClick={() => set({ theme: t.v })}
                  className="w-full flex items-center gap-3 text-left px-2.5 py-2 rounded-md border cursor-pointer hover:bg-raised"
                  style={{ borderColor: d.theme === t.v ? "var(--accent)" : "var(--line)" }}>
                  <span data-theme={t.v} className="w-8 h-6 rounded border flex items-center justify-center text-xs font-bold shrink-0"
                    style={{ background: "var(--surface)", color: "var(--ink)", borderColor: "var(--line-strong)" }}>Aa</span>
                  <span>
                    <span className="block text-sm text-ink">{t.label}</span>
                    <span className="block text-xs text-ink-3">{t.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="mb-4">
            <span className="block text-sm font-semibold text-ink mb-1.5">Typeface</span>
            <div className="space-y-1" role="radiogroup" aria-label="Typeface">
              {FONTS.map((f) => (
                <button key={f.v} role="radio" aria-checked={d.font === f.v} onClick={() => set({ font: f.v })}
                  className="w-full flex items-center justify-between text-left px-2.5 py-1.5 rounded-md border cursor-pointer hover:bg-raised"
                  style={{ borderColor: d.font === f.v ? "var(--accent)" : "var(--line)" }}>
                  <span className="text-sm text-ink" style={{ fontFamily: f.sample }}>{f.label}</span>
                  <span className="text-sm text-ink-2" style={{ fontFamily: f.sample }}>R#1001 0O 1lI</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="block text-sm font-semibold text-ink mb-1.5">Row spacing</span>
            <Seg<Density> label="Row spacing" value={d.density} onChange={(v) => set({ density: v })}
              options={[{ v: "comfortable", label: "Comfortable" }, { v: "compact", label: "Compact" }]} />
          </div>
          <p className="text-xs text-ink-3 mt-3">Saved on this computer only.</p>
        </div>
      )}
    </div>
  );
}
