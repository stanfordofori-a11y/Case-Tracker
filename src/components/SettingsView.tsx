import { useEffect, useRef, useState } from "react";
import * as api from "../lib/api";
import { DEFAULT_ALIST, DEFAULT_DEPT } from "../lib/defaults";
import {
  DEPARTMENTS, expandCommaKeywords, matchDeptKeyword, migrateCase, norm,
  type AlistKeyword, type DeptKeyword, type Dicts, type Slice,
} from "../lib/tracker";
import { Button, C, Note, Panel, downloadFile, inputBase, inputCls, stamp } from "./ui";

export default function SettingsView({ snap, dicts, slices, isAdmin, refresh, toast }: {
  snap: api.Snapshot; dicts: Dicts; slices: Slice[]; isAdmin: boolean;
  refresh: () => Promise<unknown>; toast: (msg: string, tone?: "ok" | "err") => void;
}) {
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); await refresh(); if (ok) toast(ok); } catch (e: any) { toast(e.message, "err"); }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Note tone="info">Changes here apply to everyone using the tracker.</Note>
      <Unrecognised snap={snap} dicts={dicts} run={run} />
      <AlistEditor rows={snap.alist} run={run} />
      <DeptEditor rows={snap.dept} run={run} />
      <DataPanel snap={snap} slices={slices} isAdmin={isAdmin} run={run} toast={toast} refresh={refresh} />
    </div>
  );
}

type Run = (fn: () => Promise<unknown>, ok?: string) => Promise<void>;

function Unrecognised({ snap, dicts, run }: { snap: api.Snapshot; dicts: Dicts; run: Run }) {
  const [choice, setChoice] = useState<Record<string, string>>({});
  const list = Object.entries(snap.unmatched)
    .filter(([k, u]) => matchDeptKeyword(u.name, dicts).department === "Unclassified" && !dicts.ignored.includes(k))
    .sort((a, b) => b[1].count - a[1].count);
  return (
    <Panel title={<>Unrecognised test names {list.length > 0 && <span className="font-mono text-xs text-[#f59e0b] ml-1">{list.length}</span>}</>}>
      <p className="text-xs text-[#94a3b8] mb-3 leading-relaxed">
        Test names from pastes that match nothing in the department dictionary. Each is currently counted under the department of the test printed just before it.
        Add real tests to the dictionary; ignore qualifiers such as "Ultra sensi".
      </p>
      {!list.length ? <p className="text-xs text-[#7c8ba1]">Nothing to review. Every test name seen so far is in the dictionary or ignored.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left font-mono text-[#7c8ba1]">
              {["Name as printed", "Seen", "Counted under", "Add to", ""].map((h) => <th key={h} className="py-2 pr-3 font-medium border-b" style={{ borderColor: C.border }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {list.map(([k, u]) => {
                const dept = choice[k] || (DEPARTMENTS.includes(u.attachedTo as any) ? u.attachedTo! : "Hematology");
                return (
                  <tr key={k} className="border-b text-[#cbd5e1]" style={{ borderColor: C.border }}>
                    <td className="py-2 pr-3 font-mono">{u.name}</td>
                    <td className="py-2 pr-3 font-mono">{u.count}</td>
                    <td className="py-2 pr-3">{u.attachedTo || "Unclassified"}</td>
                    <td className="py-2 pr-3">
                      <select className={`${inputBase} w-auto`} value={dept} onChange={(e) => setChoice({ ...choice, [k]: e.target.value })}>
                        {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
                      </select>
                    </td>
                    <td className="py-2 whitespace-nowrap">
                      <Button onClick={() => run(() => api.addTokenToDept(u.name, dept), `"${u.name}" added to ${dept}.`)}>Add</Button>{" "}
                      <Button tone="quiet" title="It's a qualifier or part of another test" onClick={() => run(() => api.ignoreToken(u.name))}>Ignore</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function useDraft<T>(source: T[]) {
  const [draft, setDraft] = useState<T[]>(source);
  const [dirty, setDirty] = useState(false);
  const srcKey = JSON.stringify(source);
  const last = useRef(srcKey);
  // Take in live updates only while there are no unsaved edits
  useEffect(() => { if (!dirty && last.current !== srcKey) setDraft(source); last.current = srcKey; }, [srcKey, dirty]); // eslint-disable-line
  const update = (next: T[]) => { setDraft(next); setDirty(true); };
  return { draft, update, dirty, reset: () => { setDraft(source); setDirty(false); }, saved: () => setDirty(false) };
}

function AlistEditor({ rows, run }: { rows: AlistKeyword[]; run: Run }) {
  const d = useDraft(rows);
  const set = (i: number, k: keyof AlistKeyword, v: string) => d.update(d.draft.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <Panel title="A-List clients" action={<div className="flex gap-2">
      {d.dirty && <Button tone="quiet" onClick={d.reset}>Discard changes</Button>}
      <Button onClick={() => { if (confirm("Reset the A-List to the built-in defaults for everyone? Clients you added will be removed (the old list is kept in the activity log).")) run(() => api.replaceAlist(DEFAULT_ALIST), "A-List reset to defaults.").then(d.saved); }}>Reset to defaults</Button>
      <Button tone="primary" disabled={!d.dirty} onClick={() => run(() => api.replaceAlist(expandCommaKeywords(d.draft.filter((r) => r.keyword.trim()))), "A-List saved.").then(d.saved)}>Save A-List</Button>
    </div>}>
      <p className="text-xs text-[#94a3b8] mb-3">A case is A-List if its client text contains the keyword (any case). Use a short, unique part of the account name, like "LANCET".</p>
      <div className="grid grid-cols-[1fr_2fr_auto] gap-2 text-xs font-mono text-[#7c8ba1] mb-1"><span>Keyword</span><span>Display name</span><span /></div>
      {d.draft.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_2fr_auto] gap-2 mb-1.5">
          <input className={inputCls} value={r.keyword} onChange={(e) => set(i, "keyword", e.target.value)} aria-label="Keyword" />
          <input className={inputCls} value={r.displayName} onChange={(e) => set(i, "displayName", e.target.value)} aria-label="Display name" />
          <Button tone="quiet" onClick={() => d.update(d.draft.filter((_, j) => j !== i))}>Remove</Button>
        </div>
      ))}
      <Button className="mt-2" onClick={() => d.update([...d.draft, { keyword: "", displayName: "" }])}>Add client</Button>
    </Panel>
  );
}

function DeptEditor({ rows, run }: { rows: DeptKeyword[]; run: Run }) {
  const d = useDraft(rows);
  const [filter, setFilter] = useState("");
  const set = (i: number, k: keyof DeptKeyword, v: string) => d.update(d.draft.map((r, j) => (j === i ? { ...r, [k]: v } as DeptKeyword : r)));
  const q = norm(filter);
  return (
    <Panel title="Department keywords" action={<div className="flex gap-2">
      {d.dirty && <Button tone="quiet" onClick={d.reset}>Discard changes</Button>}
      <Button onClick={() => { if (confirm("Reset the department dictionary to the built-in defaults for everyone? Keywords you added will be removed (the old list is kept in the activity log).")) run(() => api.replaceDept(DEFAULT_DEPT), "Department dictionary reset.").then(d.saved); }}>Reset to defaults</Button>
      <Button tone="primary" disabled={!d.dirty} onClick={() => run(() => api.replaceDept(expandCommaKeywords(d.draft.filter((r) => r.keyword.trim()))), "Department keywords saved. Cases re-split on every screen.").then(d.saved)}>Save keywords</Button>
    </div>}>
      <p className="text-xs text-[#94a3b8] mb-3">The longest keyword found in a test name wins. Saving re-splits cases on every screen; completion history is never changed.</p>
      <input className={`${inputCls} mb-3 max-w-xs`} placeholder="Filter keywords" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter keywords" />
      <div className="grid md:grid-cols-2 gap-x-6">
        {d.draft.map((r, i) => (!q || norm(r.keyword).includes(q) || norm(r.department).includes(q)) && (
          <div key={i} className="grid grid-cols-[1fr_140px_auto] gap-2 mb-1.5">
            <input className={inputCls} value={r.keyword} onChange={(e) => set(i, "keyword", e.target.value)} aria-label="Keyword" />
            <select className={inputCls} value={r.department} onChange={(e) => set(i, "department", e.target.value)} aria-label="Department">
              {DEPARTMENTS.map((x) => <option key={x}>{x}</option>)}
            </select>
            <Button tone="quiet" onClick={() => d.update(d.draft.filter((_, j) => j !== i))}>Remove</Button>
          </div>
        ))}
      </div>
      <Button className="mt-2" onClick={() => { setFilter(""); d.update([...d.draft, { keyword: "", department: "Hematology" }]); }}>Add keyword</Button>
    </Panel>
  );
}

function DataPanel({ snap, slices, isAdmin, run, toast, refresh }: {
  snap: api.Snapshot; slices: Slice[]; isAdmin: boolean; run: Run; toast: (m: string, t?: "ok" | "err") => void; refresh: () => Promise<unknown>;
}) {
  const [days, setDays] = useState(snap.settings.archiveDays || 30);
  const done = slices.filter((c) => c.status === "Completed").length;

  function backup() {
    downloadFile(`tracker_backup_${stamp()}.json`, JSON.stringify({ app: "post-analytical-tracker", version: 4, exportedAt: new Date().toISOString(),
      trackedCases: slices, alistKeywords: snap.alist, deptKeywords: snap.dept, pasteLog: snap.pastes, settings: snap.settings }), "application/json");
  }

  async function importFile(file: File) {
    let data: any;
    try { data = JSON.parse(await file.text()); } catch { return toast("That file isn't valid JSON.", "err"); }
    const raw: any[] | null = Array.isArray(data?.trackedCases) ? data.trackedCases : Array.isArray(data?.cases) ? data.cases : null;
    if (!raw) return toast("No tracked cases found in that file.", "err");
    const byR: Record<string, any> = {};
    const order: string[] = [];
    raw.map(migrateCase).forEach((c: any) => {
      if (!c.rNumber) return;
      let g = byR[c.rNumber];
      if (!g) {
        g = byR[c.rNumber] = { r_number: String(c.rNumber), patient_id: c.patientId || "R#" + c.rNumber, client_raw: c.clientRaw || "",
          report_date: c.reportDate, report_at: c.reportDateTime, first_seen: c.dateAdded, tests: [] };
        order.push(c.rNumber);
      }
      if (new Date(c.reportDateTime) < new Date(g.report_at)) { g.report_at = c.reportDateTime; g.report_date = c.reportDate; }
      (c.tests || []).forEach((t: any) => {
        if (g.tests.some((x: any) => norm(x.name) === norm(t.name))) return;
        g.tests.push({ name: t.name, seq: g.tests.length + 1, status: t.status === "Completed" ? "Completed" : "Pending",
          first_seen: t.firstSeen || c.dateAdded || c.lastSeen, last_seen: t.lastSeen || c.lastSeen || c.dateAdded,
          completed_at: t.status === "Completed" ? t.completedAt || c.completedAt : null });
      });
    });
    const reqs = order.map((r) => byR[r]).filter((g) => g.report_at && g.tests.length);
    if (!confirm(`Import ${reqs.length} requisitions into the shared tracker?\n\nRequisitions already in the database are skipped. Earlier pastes can no longer be undone afterwards.`)) return;
    const hasDicts = Array.isArray(data.deptKeywords) && data.deptKeywords.length && Array.isArray(data.alistKeywords) && data.alistKeywords.length;
    const withDicts = hasDicts && confirm(`The file also has A-List (${data.alistKeywords.length}) and department (${data.deptKeywords.length}) dictionaries.\n\nOK: replace the current dictionaries with these.\nCancel: keep the current ones.`);
    try {
      let r = 0, t = 0;
      for (let i = 0; i < reqs.length; i += 300) {
        const res = await api.importRequisitions(reqs.slice(i, i + 300));
        r += res.requisitions; t += res.tests;
      }
      if (withDicts) {
        await api.replaceAlist(data.alistKeywords.map((x: any) => ({ keyword: x.keyword, displayName: x.displayName || x.display_name || "" })));
        await api.replaceDept(data.deptKeywords);
      }
      await refresh();
      toast(`Imported ${r} requisitions (${t} tests)${withDicts ? " and the dictionaries" : ""}.`);
    } catch (e: any) { toast(e.message, "err"); await refresh(); }
  }

  async function archive() {
    if (!confirm(`Archive requisitions whose tests were all completed more than ${days} days ago?\n\nThey're removed from the shared tracker and downloaded as a JSON file. Reports for those dates won't include them afterwards.`)) return;
    try {
      await api.saveSettings({ ...snap.settings, archiveDays: days });
      const res = await api.archiveCompleted(days);
      if (!res.count) return toast(`Nothing to archive: no requisitions fully completed more than ${days} days ago.`);
      downloadFile(`tracker_archive_${stamp()}.json`, JSON.stringify({ app: "post-analytical-tracker", type: "archive",
        exportedAt: new Date().toISOString(), olderThanDays: days, requisitions: res.requisitions }), "application/json");
      await refresh();
      toast(`Archived ${res.count} requisitions. Keep the downloaded file somewhere safe.`);
    } catch (e: any) { toast(e.message, "err"); }
  }

  function clearAll() {
    const typed = prompt("This permanently removes EVERY tracked case, for everyone. Dictionaries and staff are kept. It can't be undone; download a backup first if you might need the data.\n\nType CLEAR to confirm:");
    if (typed === "CLEAR") run(() => api.clearAllCases(), "All tracked cases cleared.");
  }

  return (
    <Panel title="Data and backup">
      <p className="text-xs text-[#94a3b8] mb-3">
        {snap.reqs.length} requisitions ({slices.length} department entries, {done} completed) stored in Supabase. Last synced {snap.loadedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}.
      </p>
      <div className="flex gap-2 flex-wrap mb-4">
        <Button onClick={backup}>Download full backup</Button>
        {isAdmin && (
          <label className="inline-flex items-center rounded px-3 py-1.5 text-xs font-display border border-[#1a2f50] text-[#94a3b8] hover:border-[#22d3ee80] hover:text-[#e2e8f0] cursor-pointer">
            Import from backup file
            <input type="file" accept=".json,application/json" className="sr-only"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) importFile(f); }} />
          </label>
        )}
      </div>
      {isAdmin && (
        <>
          <p className="text-[0.7rem] text-[#7c8ba1] mb-4">Import accepts backups from the old browser versions (rev 11 to 13) and this one. Requisitions already in the database are skipped.</p>
          <div className="flex items-center gap-2 flex-wrap mb-4">
            <span className="text-xs text-[#94a3b8]">Archive requisitions completed more than</span>
            <input type="number" min={1} className={`${inputBase} w-20`} value={days} onChange={(e) => setDays(Math.max(1, +e.target.value || 30))} aria-label="Days" />
            <span className="text-xs text-[#94a3b8]">days ago</span>
            <Button onClick={archive}>Download and remove</Button>
          </div>
          <div className="pt-4 border-t" style={{ borderColor: C.border }}>
            <Button tone="danger" onClick={clearAll}>Clear all tracked cases</Button>
          </div>
        </>
      )}
    </Panel>
  );
}
