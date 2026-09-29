import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../lib/api";
import { fmtIso, fmtTime, formatMinutes, norm } from "../lib/tracker";
import { Badge, Button, C, Modal, Note, Stat, csvCell, downloadFile, inputBase, stamp, tint } from "./ui";

type Feedback = { tone: "ok" | "warn" | "err"; title: string; detail: string; sampleId?: number } | null;

// Short tones so staff can keep their eyes on the tubes
function beep(kind: "ok" | "warn" | "err") {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx();
    const plan = kind === "ok" ? [[880, 0.09]] : kind === "warn" ? [[520, 0.12], [520, 0.12]] : [[220, 0.35]];
    let t = ctx.currentTime;
    plan.forEach(([f, d]) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = f!; o.type = "square"; g.gain.value = 0.06;
      o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + d!); t += d! + 0.08;
    });
    setTimeout(() => ctx.close(), 1500);
  } catch { /* sound unavailable */ }
}

export default function ReceptionView({ toast }: { toast: (m: string, t?: "ok" | "err") => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.loadTransport>> | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);
  const [sound, setSound] = useState(true);
  const [centre, setCentre] = useState<number | "all">("all");
  const [search, setSearch] = useState("");
  const [photo, setPhoto] = useState<{ url: string; label: string } | null>(null);
  const [now, setNow] = useState(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try { setData(await api.loadTransport(36)); setLoadErr(null); }
    catch (e: any) { setLoadErr(e.message); }
  }, []);

  useEffect(() => {
    load();
    api.maybePurgePhotos();
    let t: number | undefined;
    const unsub = api.subscribeTransport(() => { clearTimeout(t); t = window.setTimeout(load, 800); });
    const tick = setInterval(() => setNow(Date.now()), 30000);
    return () => { unsub(); clearInterval(tick); clearTimeout(t); };
  }, [load]);

  // Keep the scan box ready: the handheld scanner types into whatever has focus.
  useEffect(() => {
    // Take focus back unless someone is typing in another field or a dialog is open.
    const refocus = () => {
      const a = document.activeElement as HTMLElement | null;
      const typing = a && (a.tagName === "INPUT" || a.tagName === "SELECT" || a.tagName === "TEXTAREA") && a !== inputRef.current;
      if (!typing && !document.querySelector('[role="dialog"]')) inputRef.current?.focus();
    };
    const i = setInterval(refocus, 1000);
    window.addEventListener("focus", refocus);
    refocus();
    return () => { clearInterval(i); window.removeEventListener("focus", refocus); };
  }, []);

  const centreName = (id: number | null) => data?.centres.find((c) => c.id === id)?.name || "—";
  const alertMin = data?.settings.transitAlertMinutes ?? 180;

  async function scan() {
    const v = code.trim();
    if (!v || busy) return;
    setBusy(true);
    setCode("");
    try {
      const r = await api.receiveSample(v);
      const who = r.collected_by ? r.collected_by.split("@")[0] : "";
      if (r.result === "received") {
        setFeedback({ tone: "ok", sampleId: r.sample_id, title: `Received ${r.barcode}`,
          detail: `From ${r.centre || "unknown centre"}${who ? `, collected by ${who}` : ""} at ${fmtTime(r.collected_at)}. In transit ${formatMinutes(r.transit_minutes || 0)}.` });
        if (sound) beep("ok");
      } else if (r.result === "already_received") {
        setFeedback({ tone: "warn", title: `${r.barcode} was already received`,
          detail: `Scanned in at ${fmtTime(r.received_at)} by ${(r.received_by || "").split("@")[0]}. Nothing changed.` });
        if (sound) beep("warn");
      } else {
        setFeedback({ tone: "err", sampleId: r.sample_id, title: `${r.barcode} was not logged by a courier`,
          detail: "Recorded as received now, flagged as “not logged”. Check which centre it came from." });
        if (sound) beep("err");
      }
      load();
    } catch (e: any) {
      setFeedback({ tone: "err", title: "Scan not saved", detail: `${e.message}. Scan it again.` });
      if (sound) beep("err");
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  async function undo(id: number, label: string) {
    if (!confirm(`Undo the receipt of ${label}? It will go back to "in transit" (or be removed if no courier logged it).`)) return;
    try { await api.undoReceive(id); setFeedback(null); await load(); toast("Receipt undone."); }
    catch (e: any) { toast(e.message, "err"); }
  }

  async function showPhoto(s: api.SampleRow) {
    if (!s.photo_path) return;
    try { setPhoto({ url: await api.samplePhotoUrl(s.photo_path), label: `${s.barcode}, collected ${fmtIso(s.collected_at)}` }); }
    catch (e: any) { toast(e.message, "err"); }
  }

  const view = useMemo(() => {
    if (!data) return null;
    const q = norm(search).replace(/[^A-Z0-9]/g, "");
    const match = (s: api.SampleRow) => (centre === "all" || s.centre_id === centre) && (!q || s.barcode.includes(q) || (s.r_number || "").includes(q));
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const inTransit = data.samples.filter((s) => !s.received_at && match(s));
    const receivedToday = data.samples.filter((s) => s.received_at && new Date(s.received_at) >= startOfDay && match(s))
      .sort((a, b) => b.received_at!.localeCompare(a.received_at!));
    const late = inTransit.filter((s) => s.collected_at && (now - new Date(s.collected_at).getTime()) / 60000 > alertMin);
    const notLogged = receivedToday.filter((s) => s.source === "reception");
    const runIds = [...new Set(inTransit.map((s) => s.run_id))];
    const runs = runIds.map((id) => ({ run: data.runs.find((r) => r.id === id) || null, items: inTransit.filter((s) => s.run_id === id) }))
      .sort((a, b) => (a.items[0]?.collected_at || "").localeCompare(b.items[0]?.collected_at || ""));
    return { inTransit, receivedToday, late, notLogged, runs };
  }, [data, centre, search, now, alertMin]);

  function exportCsv() {
    if (!view) return;
    const rows = [["Barcode", "R#", "Centre", "Collected by", "Collected", "Received by", "Received", "Transit (min)", "Flag"].join(",")];
    [...view.inTransit, ...view.receivedToday].forEach((s) => {
      const tr = s.collected_at && s.received_at ? Math.round((+new Date(s.received_at) - +new Date(s.collected_at)) / 60000) : "";
      rows.push([s.barcode, s.r_number || "", csvCell(centreName(s.centre_id)), s.collected_by || "", fmtIso(s.collected_at),
        s.received_by || "", fmtIso(s.received_at), tr, s.source === "reception" ? "Not logged by courier" : !s.received_at ? "In transit" : ""].join(","));
    });
    downloadFile(`sample_transport_${stamp()}.csv`, rows.join("\n"), "text/csv;charset=utf-8;");
  }

  const fbColor = feedback?.tone === "ok" ? C.success : feedback?.tone === "warn" ? C.warning : C.danger;

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-5">
      {loadErr && <Note tone="err">Couldn't load samples: {loadErr}. Check that 03_sample_transport.sql has been run in Supabase.</Note>}

      {/* Scan box */}
      <section className="card p-5 mb-5">
        <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
          <h1 className="text-xl font-semibold text-ink">Receive samples</h1>
          <label className="flex items-center gap-2 text-sm text-ink-2 cursor-pointer">
            <input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} className="w-4 h-4 accent-[var(--accent)]" /> Sound
          </label>
        </div>
        <label className="block text-sm text-ink-2 mb-1.5" htmlFor="scan-box">Scan a tube with the handheld scanner (or type the barcode and press Enter)</label>
        <input id="scan-box" ref={inputRef} value={code} onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); scan(); } }}
          autoComplete="off" spellCheck={false} autoFocus
          className="num w-full rounded-lg px-4 py-4 text-2xl outline-none border-2 bg-surface text-ink"
          style={{ borderColor: C.accent }} placeholder="Waiting for scan…" />
        {feedback && (
          <div className="mt-4 rounded-lg p-4 flex items-start justify-between gap-4 flex-wrap" role="status" aria-live="assertive"
            style={{ background: tint(fbColor, 12), borderLeft: `6px solid ${fbColor}` }}>
            <div>
              <p className="text-xl font-semibold" style={{ color: fbColor }}>{feedback.title}</p>
              <p className="text-ink mt-0.5">{feedback.detail}</p>
            </div>
            {feedback.sampleId && <Button onClick={() => undo(feedback.sampleId!, feedback.title.replace(/^Received /, ""))}>Undo this scan</Button>}
          </div>
        )}
      </section>

      {view && (
        <>
          <div className="flex gap-8 sm:gap-12 flex-wrap mb-5">
            <Stat label="In transit" value={view.inTransit.length} />
            <Stat label={`In transit over ${formatMinutes(alertMin)}`} value={view.late.length} color={view.late.length ? C.danger : C.ink} />
            <Stat label="Received today" value={view.receivedToday.length} color={C.success} />
            <Stat label="Not logged by courier today" value={view.notLogged.length} color={view.notLogged.length ? C.warning : C.ink} />
          </div>

          <div className="flex flex-wrap gap-2 items-center mb-4">
            <select className={inputBase} value={String(centre)} aria-label="Centre"
              onChange={(e) => setCentre(e.target.value === "all" ? "all" : Number(e.target.value))}>
              <option value="all">All centres</option>
              {data!.centres.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input className={`${inputBase} w-56`} placeholder="Find barcode or R#" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Find barcode" />
            <Button tone="quiet" className="ml-auto" onClick={exportCsv}>Export (CSV)</Button>
          </div>

          <div className="grid lg:grid-cols-2 gap-5">
            <section>
              <h2 className="text-base font-semibold text-ink mb-2">In transit <span className="num text-sm font-normal text-ink-3">{view.inTransit.length}</span></h2>
              {!view.runs.length && <div className="card p-6 text-ink-3 text-sm">Nothing in transit.</div>}
              {view.runs.map(({ run, items }) => {
                const oldest = Math.max(...items.map((s) => (now - new Date(s.collected_at || now).getTime()) / 60000));
                return (
                  <div key={run?.id ?? "none"} className="card mb-3 overflow-hidden">
                    <div className="px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap border-b" style={{ borderColor: C.line, background: C.raised }}>
                      <span className="text-ink font-semibold">{centreName(run?.centre_id ?? items[0]!.centre_id)}</span>
                      <span className="text-sm text-ink-2">
                        {run ? `${run.courier_email.split("@")[0]}, ` : ""}
                        {run?.handed_over_at ? `handed over ${fmtTime(run.handed_over_at)}` : "still collecting"}
                      </span>
                    </div>
                    <ul>
                      {items.map((s) => {
                        const age = (now - new Date(s.collected_at || now).getTime()) / 60000;
                        const isLate = age > alertMin;
                        return (
                          <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2 border-b last:border-b-0" style={{ borderColor: C.line }}>
                            <span>
                              <span className="num text-ink">{s.barcode}</span>
                              <span className="text-xs text-ink-3 ml-2">collected {fmtTime(s.collected_at)}</span>
                            </span>
                            <span className="flex items-center gap-3">
                              {s.photo_path && !s.photo_deleted_at && <Button tone="quiet" className="px-0" onClick={() => showPhoto(s)}>Photo</Button>}
                              <span className="text-sm font-semibold" style={{ color: isLate ? C.danger : C.ink2 }}>{formatMinutes(age)}</span>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    <div className="px-4 py-1.5 text-xs text-ink-3">{items.length} sample{items.length === 1 ? "" : "s"}, oldest {formatMinutes(oldest)}</div>
                  </div>
                );
              })}
            </section>

            <section>
              <h2 className="text-base font-semibold text-ink mb-2">Received today <span className="num text-sm font-normal text-ink-3">{view.receivedToday.length}</span></h2>
              <div className="card overflow-hidden">
                {!view.receivedToday.length && <p className="p-6 text-ink-3 text-sm">Nothing received yet today.</p>}
                <ul>
                  {view.receivedToday.slice(0, 200).map((s) => {
                    const tr = s.collected_at ? (new Date(s.received_at!).getTime() - new Date(s.collected_at).getTime()) / 60000 : null;
                    return (
                      <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2 border-b last:border-b-0" style={{ borderColor: C.line }}>
                        <span className="min-w-0">
                          <span className="num text-ink">{s.barcode}</span>
                          {s.source === "reception" && <span className="ml-2"><Badge color={C.warning}>Not logged by courier</Badge></span>}
                          <span className="block text-xs text-ink-3">
                            {s.source === "courier" ? `${centreName(s.centre_id)}, ${(s.collected_by || "").split("@")[0]}` : "No collection record"}
                          </span>
                        </span>
                        <span className="text-right shrink-0">
                          <span className="num text-sm text-ink">{fmtTime(s.received_at)}</span>
                          {tr !== null && <span className="block text-xs text-ink-3">transit {formatMinutes(tr)}</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>
          </div>
        </>
      )}

      <Modal open={!!photo} onClose={() => setPhoto(null)} wide title="Pickup photo">
        {photo && (<><img src={photo.url} alt={`Pickup photo for ${photo.label}`} className="w-full rounded-md" /><p className="text-sm text-ink-3 mt-2">{photo.label}</p></>)}
      </Modal>
    </div>
  );
}
