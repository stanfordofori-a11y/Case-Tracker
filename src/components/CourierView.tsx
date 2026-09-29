import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../lib/api";
import { compressPhoto, decodePhoto, normBarcode } from "../lib/barcode";
import { fmtIso, fmtTime, formatMinutes } from "../lib/tracker";
import { Badge, Button, C, Note, inputCls, tint } from "./ui";

type Pending = { preview: string; photo: Blob; codes: string[]; chosen: Record<string, boolean> } | null;

export default function CourierView({ me, toast }: { me: api.Me; toast: (m: string, t?: "ok" | "err") => void }) {
  const [centres, setCentres] = useState<api.Centre[]>([]);
  const [runs, setRuns] = useState<api.CourierRun[]>([]);
  const [samples, setSamples] = useState<api.SampleRow[]>([]);
  const [retention, setRetention] = useState(14);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [manual, setManual] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [c, mine, st] = await Promise.all([api.loadCentres(), api.myOpenRun(me.email), api.loadTransportSettings()]);
      setCentres(c.filter((x) => x.active));
      setRuns(mine.runs);
      setSamples(mine.samples);
      setRetention(st.photoRetentionDays);
      setErr(null);
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  }, [me.email]);
  useEffect(() => { load(); }, [load]);

  const openRun = runs.find((r) => !r.handed_over_at) || null;
  const centreName = (id: number | null) => centres.find((c) => c.id === id)?.name || "Unknown centre";
  const runSamples = openRun ? samples.filter((s) => s.run_id === openRun.id) : [];

  async function start(centreId: number) {
    setBusy("Starting…");
    try { await api.startRun(centreId); await load(); }
    catch (e: any) { toast(e.message, "err"); }
    finally { setBusy(null); }
  }

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setBusy("Reading barcodes…");
    try {
      const [codes, small] = await Promise.all([decodePhoto(file), compressPhoto(file)]);
      const preview = URL.createObjectURL(small);
      setPending({ preview, photo: small, codes, chosen: Object.fromEntries(codes.map((c) => [c, true])) });
    } catch (e: any) {
      toast(`Couldn't read that photo: ${e.message}`, "err");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function addManual() {
    const v = manual.trim();
    if (!v || !pending) return;
    if (!normBarcode(v)) return;
    setPending({ ...pending, codes: [...new Set([...pending.codes, v])], chosen: { ...pending.chosen, [v]: true } });
    setManual("");
  }

  async function confirm() {
    if (!pending || !openRun) return;
    const codes = pending.codes.filter((c) => pending.chosen[c]);
    if (!codes.length) { toast("Tick at least one barcode, or type the number.", "err"); return; }
    setBusy("Saving…");
    try {
      const path = await api.uploadSamplePhoto(pending.photo);
      const res = await api.logSamples(openRun.id, codes, path);
      const logged = res.filter((r) => r.result === "logged").length;
      const dup = res.length - logged;
      toast(`${logged} sample${logged === 1 ? "" : "s"} logged${dup ? `, ${dup} already logged earlier` : ""}.`);
      URL.revokeObjectURL(pending.preview);
      setPending(null);
      await load();
    } catch (e: any) {
      toast(`${e.message}. Nothing was saved; try again.`, "err");
    } finally { setBusy(null); }
  }

  async function remove(s: api.SampleRow) {
    if (!confirmBox(`Remove ${s.barcode} from this collection? Only do this if it was logged by mistake.`)) return;
    try { await api.removeSample(s.id); await load(); } catch (e: any) { toast(e.message, "err"); }
  }

  async function handOver() {
    if (!openRun) return;
    if (!confirmBox(`Hand over ${runSamples.length} sample${runSamples.length === 1 ? "" : "s"} from ${centreName(openRun.centre_id)} to the lab?\n\nYou won't be able to add more to this collection.`)) return;
    setBusy("Handing over…");
    try { await api.handOver(openRun.id); toast("Handed over. The lab will scan them in."); await load(); }
    catch (e: any) { toast(e.message, "err"); }
    finally { setBusy(null); }
  }

  if (loading) return <p className="p-6 text-ink-3">Loading…</p>;

  return (
    <div className="max-w-lg mx-auto px-4 py-5">
      {err && <Note tone="err">{err}</Note>}

      {!openRun && !pending && (
        <>
          <h1 className="text-2xl font-semibold text-ink mb-1">Start a collection</h1>
          <p className="text-ink-2 mb-4">Which centre are you collecting from?</p>
          {!centres.length && <Note tone="warn">No centres have been set up yet. Ask a lab admin to add them in Settings.</Note>}
          <div className="space-y-2 mb-8">
            {centres.map((c) => (
              <button key={c.id} disabled={!!busy} onClick={() => start(c.id)}
                className="card w-full text-left px-4 py-4 text-lg text-ink hover:bg-raised cursor-pointer disabled:opacity-50">
                {c.name}
              </button>
            ))}
          </div>
        </>
      )}

      {openRun && !pending && (
        <>
          <div className="card p-4 mb-4">
            <p className="text-sm text-ink-3">Collecting from</p>
            <p className="text-2xl font-semibold text-ink">{centreName(openRun.centre_id)}</p>
            <p className="text-sm text-ink-2">Started {fmtTime(openRun.started_at)}. {runSamples.length} sample{runSamples.length === 1 ? "" : "s"} so far.</p>
          </div>

          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="sr-only" id="photo-input"
            onChange={(e) => onPhoto(e.target.files?.[0])} />
          <label htmlFor="photo-input"
            className={`flex items-center justify-center gap-3 w-full rounded-xl py-6 text-xl font-semibold cursor-pointer mb-2 ${busy ? "opacity-60 pointer-events-none" : ""}`}
            style={{ background: C.accent, color: "var(--accent-ink)" }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M4 8h3l2-3h6l2 3h3v11H4z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><circle cx="12" cy="13" r="3.5" stroke="currentColor" strokeWidth="2" /></svg>
            {busy || "Take photo of samples"}
          </label>
          <p className="text-sm text-ink-3 mb-5 text-center">Several tubes can go in one photo. Keep the barcodes flat, in focus and well lit.</p>

          {runSamples.length > 0 && (
            <>
              <h2 className="font-semibold text-ink mb-2">In this collection</h2>
              <ul className="card divide-y mb-5" style={{ borderColor: C.line }}>
                {runSamples.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderColor: C.line }}>
                    <span>
                      <span className="num text-lg text-ink">{s.barcode}</span>
                      <span className="block text-xs text-ink-3">Logged {fmtTime(s.collected_at)}</span>
                    </span>
                    {s.received_at
                      ? <Badge color={C.success}>At lab</Badge>
                      : <button onClick={() => remove(s)} className="text-sm text-danger underline cursor-pointer px-2 py-2">Remove</button>}
                  </li>
                ))}
              </ul>
            </>
          )}

          <Button className="w-full py-3 text-base" disabled={!!busy || !runSamples.length} onClick={handOver}>
            Hand over to the lab
          </Button>
        </>
      )}

      {pending && openRun && (
        <>
          <h1 className="text-xl font-semibold text-ink mb-3">Check the barcodes</h1>
          <img src={pending.preview} alt="Photo of the samples" className="w-full rounded-lg mb-3 border" style={{ borderColor: C.line }} />
          {pending.codes.length === 0 && (
            <Note tone="warn">No barcode could be read. Retake the photo closer and in better light, or type the number below.</Note>
          )}
          <ul className="space-y-2 mb-4">
            {pending.codes.map((c) => (
              <li key={c}>
                <label className="card flex items-center gap-3 px-4 py-3 cursor-pointer">
                  <input type="checkbox" className="w-6 h-6 accent-[var(--accent)]" checked={!!pending.chosen[c]}
                    onChange={(e) => setPending({ ...pending, chosen: { ...pending.chosen, [c]: e.target.checked } })} />
                  <span className="num text-lg text-ink">{c}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex gap-2 mb-5">
            <input className={inputCls} inputMode="text" placeholder="Type a barcode number" value={manual}
              onChange={(e) => setManual(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addManual(); }} />
            <Button onClick={addManual}>Add</Button>
          </div>
          <Button tone="primary" className="w-full py-3.5 text-lg mb-2" disabled={!!busy} onClick={confirm}>
            {busy || `Log ${pending.codes.filter((c) => pending.chosen[c]).length} sample(s)`}
          </Button>
          <Button className="w-full py-3" disabled={!!busy} onClick={() => { URL.revokeObjectURL(pending.preview); setPending(null); }}>Cancel</Button>
          <p className="text-xs text-ink-3 mt-3">The photo is kept as proof of pickup and deleted automatically after {retention} days.</p>
        </>
      )}

      <PastRuns runs={runs.filter((r) => r.handed_over_at)} samples={samples} centreName={centreName} />
    </div>
  );
}

function PastRuns({ runs, samples, centreName }: { runs: api.CourierRun[]; samples: api.SampleRow[]; centreName: (id: number) => string }) {
  if (!runs.length) return null;
  return (
    <section className="mt-8">
      <h2 className="font-semibold text-ink mb-2">Recent handovers</h2>
      <ul className="space-y-2">
        {runs.slice(0, 8).map((r) => {
          const s = samples.filter((x) => x.run_id === r.id);
          const got = s.filter((x) => x.received_at).length;
          const waiting = s.length - got;
          const age = (Date.now() - new Date(r.handed_over_at!).getTime()) / 60000;
          return (
            <li key={r.id} className="card px-4 py-3">
              <div className="flex justify-between gap-3">
                <span className="text-ink">{centreName(r.centre_id)}</span>
                <span className="text-sm text-ink-3">{fmtIso(r.handed_over_at)}</span>
              </div>
              <div className="text-sm mt-1" style={{ color: waiting ? C.warning : C.success }}>
                {got} of {s.length} received by the lab
                {waiting > 0 && <span className="text-ink-3"> ({waiting} waiting, handed over {formatMinutes(age)} ago)</span>}
              </div>
              {waiting > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {s.filter((x) => !x.received_at).map((x) => (
                    <span key={x.id} className="num text-xs px-1.5 py-0.5 rounded" style={{ background: tint(C.warning, 14), color: C.ink }}>{x.barcode}</span>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function confirmBox(msg: string) { return window.confirm(msg); }
