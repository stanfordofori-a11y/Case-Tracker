import { useEffect, useRef, useState } from "react";
import { C } from "./ui";

// Signatures are stored as an SVG path in a 600 x 200 box: small, sharp when printed.
const W = 600, H = 200;

export function SignaturePad({ onChange, label }: { onChange: (path: string) => void; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<[number, number][][]>([]);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  function redraw() {
    const c = ref.current!; const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.lineWidth = 3.2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#0b1b3a";
    for (const s of strokes.current) {
      ctx.beginPath();
      s.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      if (s.length === 1) ctx.lineTo(s[0]![0] + 0.1, s[0]![1] + 0.1);
      ctx.stroke();
    }
  }
  const toPath = () => strokes.current.filter((s) => s.length)
    .map((s) => "M" + s.map(([x, y]) => `${Math.round(x)} ${Math.round(y)}`).join(" L")).join(" ");

  const pos = (e: React.PointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  };
  useEffect(() => { redraw(); }, []);

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-sm font-medium text-ink-2">{label}</span>
        <button type="button" className="text-sm text-accent underline cursor-pointer px-1"
          onClick={() => { strokes.current = []; redraw(); setEmpty(true); onChange(""); }}>Clear</button>
      </div>
      <canvas ref={ref} width={W} height={H} aria-label={label}
        className="w-full rounded-lg border-2 border-dashed bg-white touch-none cursor-crosshair"
        style={{ borderColor: C.line, aspectRatio: `${W} / ${H}` }}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drawing.current = true; strokes.current.push([pos(e)]); redraw(); }}
        onPointerMove={(e) => { if (!drawing.current) return; strokes.current[strokes.current.length - 1]!.push(pos(e)); redraw(); }}
        onPointerUp={() => { drawing.current = false; const p = toPath(); setEmpty(!p); onChange(p); }}
        onPointerCancel={() => { drawing.current = false; }} />
      <p className="text-xs text-ink-3 mt-1">{empty ? "Sign inside the box with a finger." : "Signed. Tap Clear to redo."}</p>
    </div>
  );
}

export function SignatureImage({ path, height = 36, title }: { path: string | null | undefined; height?: number; title?: string }) {
  if (!path) return null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ height, width: (height * W) / H }} role="img" aria-label={title || "Signature"}>
      <path d={path} fill="none" stroke="#0b1b3a" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
