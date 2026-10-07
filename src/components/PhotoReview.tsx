import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "../lib/api";
import { fmtIso, fmtTime } from "../lib/tracker";
import { Badge, Button, C, Note, inputBase } from "./ui";

type Range = 1 | 2 | 7 | 30;

export default function PhotoReview({ retentionDays }: { retentionDays: number }) {
  const [range, setRange] = useState<Range>(1);
  const [data, setData] = useState<Awaited<ReturnType<typeof api.loadPickupPhotos>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [courier, setCourier] = useState("all");
  const [centre, setCentre] = useState<number | "all">("all");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<number | null>(null); // index into `shown`

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api.loadPickupPhotos(Math.min(range, retentionDays))); setErr(null); }
    catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  }, [range, retentionDays]);
  useEffect(() => { load(); }, [load]);

  const centreName = (id: number | null) => data?.centres.find((c) => c.id === id)?.name || "Unknown centre";
  const who = (e: string | null) => (e || "").split("@")[0];

  const shown = useMemo(() => {
    if (!data) return [];
    const q = search.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    return data.photos.filter((p) =>
      (courier === "all" || p.courier === courier) &&
      (centre === "all" || p.centreId === centre) &&
      (!q || p.samples.some((s) => s.barcode.includes(q) || (s.r_number || "").includes(q))));
  }, [data, courier, centre, search]);

  // Group by day, then by collection run
  const groups = useMemo(() => {
    const out: { day: string; runs: { key: string; label: string; items: { p: api.PickupPhoto; i: number }[] }[] }[] = [];
    shown.forEach((p, i) => {
      const day = new Date(p.takenAt).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
      let g = out.find((x) => x.day === day);
      if (!g) out.push((g = { day, runs: [] }));
      const key = String(p.runId ?? p.path);
      let r = g.runs.find((x) => x.key === key);
      if (!r) g.runs.push((r = { key, label: `${centreName(p.centreId)}, ${who(p.courier)}`, items: [] }));
      r.items.push({ p, i });
    });
    return out;
  }, [shown, data]); // eslint-disable-line react-hooks/exhaustive-deps

  const couriers = useMemo(() => [...new Set((data?.photos || []).map((p) => p.courier).filter(Boolean) as string[])].sort(), [data]);

  return (
    <div>
      <div className="flex flex-wrap gap-2 items-center mb-4">
        <select className={inputBase} value={range} onChange={(e) => setRange(Number(e.target.value) as Range)} aria-label="Period">
          <option value={1}>Today and last 24 hours</option>
          <option value={2}>Last 2 days</option>
          <option value={7}>Last 7 days</option>
          <option value={30}>Everything still kept</option>
        </select>
        <select className={inputBase} value={courier} onChange={(e) => setCourier(e.target.value)} aria-label="Courier">
          <option value="all">All couriers</option>
          {couriers.map((c) => <option key={c} value={c}>{who(c)}</option>)}
        </select>
        <select className={inputBase} value={String(centre)} onChange={(e) => setCentre(e.target.value === "all" ? "all" : Number(e.target.value))} aria-label="Centre">
          <option value="all">All centres</option>
          {(data?.centres || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input className={`${inputBase} w-56`} placeholder="Find barcode or R#" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Find barcode" />
        <Button tone="quiet" className="ml-auto" onClick={load}>Refresh</Button>
      </div>
      <p className="text-sm text-ink-3 mb-4">Photos are deleted automatically after {retentionDays} days. Links to photos expire after 30 minutes; refresh to renew them.</p>

      {err && <Note tone="err">Couldn't load photos: {err}</Note>}
      {loading && <p className="text-ink-3">Loading photos…</p>}
      {!loading && data && !shown.length && <div className="card p-8 text-center text-ink-3">No pickup photos for this selection.</div>}

      {!loading && groups.map((g) => (
        <section key={g.day} className="mb-6">
          <h3 className="font-semibold text-ink mb-2">{g.day}</h3>
          {g.runs.map((r) => (
            <div key={r.key} className="mb-4">
              <p className="text-sm text-ink-2 mb-2">{r.label} <span className="text-ink-3">({r.items.length} photo{r.items.length === 1 ? "" : "s"})</span></p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {r.items.map(({ p, i }) => {
                  const waiting = p.samples.filter((s) => !s.received_at).length;
                  return (
                    <button key={p.path} onClick={() => setOpen(i)} className="card overflow-hidden text-left cursor-pointer hover:brightness-95">
                      <div className="aspect-[4/3] bg-raised flex items-center justify-center overflow-hidden">
                        {p.url ? <img src={p.url} alt={`Pickup photo, ${fmtTime(p.takenAt)}`} loading="lazy" className="w-full h-full object-cover" />
                          : <span className="text-xs text-ink-3">Not available</span>}
                      </div>
                      <div className="px-3 py-2">
                        <div className="flex justify-between gap-2 text-sm">
                          <span className="num text-ink">{fmtTime(p.takenAt)}</span>
                          <span className="text-ink-2">{p.samples.length} tube{p.samples.length === 1 ? "" : "s"}</span>
                        </div>
                        <div className="text-xs mt-0.5" style={{ color: waiting ? C.warning : C.success }}>
                          {waiting ? `${waiting} not yet received` : "All received"}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      ))}

      {open !== null && shown[open] && (
        <PhotoViewer photo={shown[open]!} centre={centreName(shown[open]!.centreId)} index={open} total={shown.length}
          onClose={() => setOpen(null)} onPrev={() => setOpen((o) => (o! > 0 ? o! - 1 : o))} onNext={() => setOpen((o) => (o! < shown.length - 1 ? o! + 1 : o))} />
      )}
    </div>
  );
}

function PhotoViewer({ photo, centre, index, total, onClose, onPrev, onNext }: {
  photo: api.PickupPhoto; centre: string; index: number; total: number; onClose: () => void; onPrev: () => void; onNext: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [rot, setRot] = useState(0);
  useEffect(() => { setZoom(1); setRot(0); }, [photo.path]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") onPrev();
      else if (e.key === "ArrowRight") onNext();
      else if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(4, z + 0.5));
      else if (e.key === "-") setZoom((z) => Math.max(1, z - 0.5));
      else if (e.key.toLowerCase() === "r") setRot((r) => (r + 90) % 360);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose, onPrev, onNext]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Pickup photo" className="fixed inset-0 z-[80] flex flex-col lg:flex-row no-print" style={{ background: "rgb(8 12 18 / 0.94)" }}>
      <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        {photo.url ? (
          <img src={photo.url} alt={`Pickup photo from ${centre}, ${fmtIso(photo.takenAt)}`}
            onClick={() => setZoom((z) => (z === 1 ? 2.5 : 1))}
            style={{ transform: `rotate(${rot}deg)`, width: zoom === 1 ? undefined : `${zoom * 100}%`, maxWidth: zoom === 1 ? "100%" : "none",
              maxHeight: zoom === 1 ? "100%" : "none", cursor: zoom === 1 ? "zoom-in" : "zoom-out", transition: "transform .2s" }}
            className="object-contain rounded" />
        ) : <p className="text-white">This photo is no longer available.</p>}
      </div>

      <aside className="lg:w-80 shrink-0 p-5 overflow-y-auto" style={{ background: C.surface }}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <p className="font-semibold text-ink">{centre}</p>
            <p className="text-sm text-ink-2">{(photo.courier || "").split("@")[0]}, <span className="num">{fmtIso(photo.takenAt)}</span></p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-ink-3 hover:text-ink text-2xl leading-none cursor-pointer px-1">×</button>
        </div>
        <div className="flex flex-wrap gap-2 mb-4">
          <Button onClick={() => setZoom((z) => Math.max(1, z - 0.5))} disabled={zoom <= 1} aria-label="Zoom out">−</Button>
          <Button onClick={() => setZoom((z) => Math.min(4, z + 0.5))} disabled={zoom >= 4} aria-label="Zoom in">+</Button>
          <Button onClick={() => setRot((r) => (r + 90) % 360)}>Rotate</Button>
          {photo.url && <a href={photo.url} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-md px-3 py-1.5 text-sm border border-line text-ink hover:bg-raised">Open full size</a>}
        </div>

        <p className="text-sm font-semibold text-ink mb-1.5">Tubes logged from this photo</p>
        <ul className="space-y-1.5 mb-4">
          {photo.samples.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5" style={{ background: C.raised }}>
              <span>
                <span className="num text-ink">{s.barcode}</span>
                {s.r_number && s.r_number !== s.barcode && <span className="block text-xs text-ink-3">R# {s.r_number}</span>}
              </span>
              {s.received_at
                ? <Badge color={C.success} title={`Received ${fmtIso(s.received_at)}`}>Received {fmtTime(s.received_at)}</Badge>
                : <Badge color={C.warning}>In transit</Badge>}
            </li>
          ))}
        </ul>
        <p className="text-xs text-ink-3 mb-4">Check that every tube in the photo appears in this list, and that the barcode numbers match the labels.</p>

        <div className="flex items-center justify-between gap-2">
          <Button onClick={onPrev} disabled={index === 0}>Previous</Button>
          <span className="text-sm text-ink-3">{index + 1} of {total}</span>
          <Button onClick={onNext} disabled={index === total - 1}>Next</Button>
        </div>
        <p className="text-xs text-ink-3 mt-3">Keys: ← → to move, + − to zoom, R to rotate, Esc to close.</p>
      </aside>
    </div>
  );
}
