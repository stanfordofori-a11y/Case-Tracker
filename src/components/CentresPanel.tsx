import { useEffect, useState } from "react";
import * as api from "../lib/api";
import { Badge, Button, C, Note, Panel, inputBase, inputCls } from "./ui";

/** Admin: outside centres couriers collect from, photo retention and transit alert time. */
export default function CentresPanel({ isAdmin, toast }: { isAdmin: boolean; toast: (m: string, t?: "ok" | "err") => void }) {
  const [centres, setCentres] = useState<api.Centre[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [st, setSt] = useState<api.TransportSettings | null>(null);

  async function load() {
    try { const [c, s] = await Promise.all([api.loadCentres(), api.loadTransportSettings()]); setCentres(c); setSt(s); setErr(null); }
    catch (e: any) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); await load(); toast(ok); } catch (e: any) { toast(e.message, "err"); }
  };

  return (
    <Panel title="Sample collection: centres and photos">
      {err && <Note tone="err">Couldn't load centres: {err}. Has 03_sample_transport.sql been run in Supabase?</Note>}
      {centres && (
        <>
          <p className="text-sm text-ink-2 mb-3">Centres couriers can choose when they start a collection.{!isAdmin && " Only admins can change these."}</p>
          <ul className="mb-3">
            {centres.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2 border-b" style={{ borderColor: C.line }}>
                <span className="text-ink">{c.name} {!c.active && <Badge color={C.ink3}>Hidden</Badge>}</span>
                {isAdmin && (
                  <span className="flex gap-2">
                    <Button tone="quiet" onClick={() => { const n = prompt("New name for this centre:", c.name); if (n && n.trim()) run(() => api.saveCentre(c.id, n, c.active), "Centre renamed."); }}>Rename</Button>
                    <Button tone="quiet" onClick={() => run(() => api.saveCentre(c.id, c.name, !c.active), c.active ? "Centre hidden from couriers." : "Centre shown to couriers.")}>{c.active ? "Hide" : "Show"}</Button>
                  </span>
                )}
              </li>
            ))}
            {!centres.length && <li className="text-sm text-ink-3 py-2">No centres yet.</li>}
          </ul>
          {isAdmin && (
            <div className="flex gap-2 mb-5 max-w-md">
              <input className={inputCls} placeholder="Centre name, e.g. Tema branch" value={name} onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) { run(() => api.saveCentre(null, name, true), "Centre added."); setName(""); } }} />
              <Button disabled={!name.trim()} onClick={() => { run(() => api.saveCentre(null, name, true), "Centre added."); setName(""); }}>Add centre</Button>
            </div>
          )}
        </>
      )}
      {st && isAdmin && (
        <div className="flex flex-wrap items-end gap-4 pt-4 border-t" style={{ borderColor: C.line }}>
          <label className="text-sm text-ink-2">Delete pickup photos after (days)
            <input type="number" min={1} max={365} className={`${inputBase} block w-28 mt-1`} value={st.photoRetentionDays}
              onChange={(e) => setSt({ ...st, photoRetentionDays: Math.max(1, Math.min(365, +e.target.value || 14)) })} />
          </label>
          <label className="text-sm text-ink-2">Flag samples in transit longer than (minutes)
            <input type="number" min={15} className={`${inputBase} block w-28 mt-1`} value={st.transitAlertMinutes}
              onChange={(e) => setSt({ ...st, transitAlertMinutes: Math.max(15, +e.target.value || 180) })} />
          </label>
          <Button onClick={() => run(() => api.saveTransportSettings(st), "Collection settings saved.")}>Save</Button>
          <Button tone="quiet" onClick={() => run(() => api.staffFn({ action: "purge_photos" }), "Expired photos deleted.")}>Delete expired photos now</Button>
        </div>
      )}
    </Panel>
  );
}
