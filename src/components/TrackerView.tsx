import { useEffect, useMemo, useState } from "react";
import {
  fmtIso, fmtTime, formatMinutes, norm, rangeText, tatMs, verdict,
  type Slice, type SliceDept, type TrackedTest,
} from "../lib/tracker";
import { Badge, Button, C, Cap, DEPT_COLORS, Stat, csvCell, downloadFile, inputBase, inputCls, stamp, tint } from "./ui";

type StatusFilter = "open" | "all" | "done";
type SortMode = "priority" | "due" | "r" | "client";
type Group = "overdue" | "soon" | "later" | "done";
const GROUP_LABEL: Record<Group, string> = { overdue: "Overdue", soon: "Due within the hour", later: "Due later", done: "Completed" };
const HOUR = 3600e3;

function groupOf(c: Slice, now: number): Group {
  if (c.status === "Completed") return "done";
  const t = tatMs(c);
  if (now > t) return "overdue";
  return t - now <= HOUR ? "soon" : "later";
}

function statusText(c: Slice, now: number): { text: string; color: string } {
  const tat = tatMs(c);
  if (c.status !== "Completed") {
    const diff = (now - tat) / 60000;
    if (diff > 0) return { text: `${formatMinutes(diff)} over`, color: C.danger };
    return { text: `${formatMinutes(-diff)} left`, color: diff > -60 ? C.warning : C.ink2 };
  }
  const v = verdict(c, tat, now);
  if (v.kind === "ontime") return { text: "Done on time", color: C.success };
  if (v.kind === "late") return { text: `Done ${rangeText(v.min, v.max)} late`, color: C.danger };
  return { text: "Done, on time?", color: C.warning };
}

/** The TAT fuse: how much of the time between first sighting and TAT has burned. */
function Fuse({ c, now }: { c: Slice; now: number }) {
  const tat = tatMs(c);
  if (c.status === "Completed") {
    return <div className="h-1.5 rounded-full" style={{ background: tint(C.success, 55) }} />;
  }
  const start = Math.min(new Date(c.dateAdded || c.reportDateTime).getTime(), tat - HOUR);
  const frac = (now - start) / Math.max(tat - start, 1);
  const over = now > tat;
  const color = over ? C.danger : frac > 0.75 ? C.warning : C.accent;
  return (
    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--track)" }}
      role="img" aria-label={over ? "Past TAT" : `${Math.round(frac * 100)}% of time to TAT used`}>
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(4, frac * 100))}%`, background: color }} />
    </div>
  );
}

function TestChips({ tests, showDone }: { tests: TrackedTest[]; showDone: boolean }) {
  const pending = tests.filter((t) => t.status !== "Completed");
  const done = tests.filter((t) => t.status === "Completed");
  const list = showDone ? tests : pending;
  return (
    <div className="flex flex-wrap gap-1 items-center">
      {list.slice(0, 7).map((t) => (
        <span key={t.name} className={`num text-xs px-1.5 py-0.5 rounded border ${t.status === "Completed" && !showDone ? "" : ""}`}
          style={{ borderColor: C.line, background: C.raised, color: t.status === "Completed" ? C.ink3 : C.ink,
            textDecoration: t.status === "Completed" && !showDone ? "line-through" : undefined }}>
          {t.name}
        </span>
      ))}
      {list.length > 7 && <span className="text-xs text-ink-3">+{list.length - 7} more</span>}
      {!showDone && done.length > 0 && <span className="text-xs text-success">{done.length} done</span>}
    </div>
  );
}

export default function TrackerView({ slices, now, lastPaste, onOpenPaste }: {
  slices: Slice[]; now: number; lastPaste: { at: string; by_email: string } | null; onOpenPaste: () => void;
}) {
  const [dept, setDept] = useState<SliceDept | "all">("all");
  const [status, setStatus] = useState<StatusFilter>("open");
  const [alistOnly, setAlistOnly] = useState(false);
  const [sort, setSort] = useState<SortMode>("priority");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const open = slices.filter((c) => c.status !== "Completed");
  const depts: SliceDept[] = ["Hematology", "Microbiology", "Chemistry", "Immunology",
    ...(slices.some((c) => c.department === "Unclassified") ? ["Unclassified" as SliceDept] : [])];

  const visible = useMemo(() => {
    const q = norm(search);
    const v = slices.filter((c) => {
      if (dept !== "all" && c.department !== dept) return false;
      if (status === "open" && c.status === "Completed") return false;
      if (status === "done" && c.status !== "Completed") return false;
      if (alistOnly && !c.isAlist) return false;
      if (q && !norm([c.patientId, c.clientDisplay, c.clientRaw, c.tests.map((t) => t.name).join(" ")].join(" ")).includes(q)) return false;
      return true;
    });
    v.sort((a, b) => {
      if (sort === "priority" && a.isAlist !== b.isAlist) return a.isAlist ? -1 : 1;
      if (sort === "r") return Number(a.rNumber) - Number(b.rNumber);
      if (sort === "client") return a.clientDisplay.localeCompare(b.clientDisplay) || tatMs(a) - tatMs(b);
      return tatMs(a) - tatMs(b);
    });
    return v;
  }, [slices, dept, status, alistOnly, sort, search]);

  const groups = (["overdue", "soon", "later", "done"] as Group[])
    .map((g) => ({ g, rows: visible.filter((c) => groupOf(c, now) === g) }))
    .filter((x) => x.rows.length);

  const selected = openId ? slices.find((c) => c.id === openId) || null : null;
  const overdue = open.filter((c) => now > tatMs(c)).length;
  const soon = open.filter((c) => groupOf(c, now) === "soon").length;
  const staleMin = lastPaste ? (now - new Date(lastPaste.at).getTime()) / 60000 : null;

  function exportCsv() {
    const rows = [["R#", "Client", "A-List", "Department", "Pending tests", "Tests done", "TAT", "Status", "Completed (detected)", "Last seen pending"].join(",")];
    visible.forEach((c) => {
      const pend = c.tests.filter((t) => t.status !== "Completed").map((t) => t.name).join(", ");
      const done = c.tests.filter((t) => t.status === "Completed").map((t) => t.name).join(", ");
      rows.push([c.patientId, csvCell(c.clientDisplay), c.isAlist ? "A-List" : "", c.department, csvCell(pend), csvCell(done),
        c.reportDate, csvCell(statusText(c, now).text), fmtIso(c.completedAt), fmtIso(c.lastSeen)].join(","));
    });
    downloadFile(`tracker_export_${stamp()}.csv`, rows.join("\n"), "text/csv;charset=utf-8;");
  }

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-5">
      {/* Headline numbers + primary action */}
      <div className="flex items-end justify-between gap-6 flex-wrap mb-5">
        <div className="flex gap-8 sm:gap-12 flex-wrap">
          <Stat label="Outstanding" value={open.length} />
          <Stat label="Overdue" value={overdue} color={overdue ? C.danger : C.ink} />
          <Stat label="Due within the hour" value={soon} color={soon ? C.warning : C.ink} />
          <Stat label="A-List outstanding" value={open.filter((c) => c.isAlist).length} color={C.alist} />
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button tone="primary" className="px-4 py-2 text-base" onClick={onOpenPaste}>Paste MT list</Button>
          <span className="text-xs" style={{ color: staleMin !== null && staleMin > 120 && open.length ? C.warning : C.ink3 }}>
            {lastPaste ? `Last updated ${fmtTime(lastPaste.at)}${staleMin !== null && staleMin > 120 ? ", paste a fresh list" : ""}` : "No list pasted yet"}
          </span>
        </div>
      </div>

      {/* Department filter */}
      <div className="flex flex-wrap gap-2 mb-3" role="group" aria-label="Department">
        <button onClick={() => setDept("all")} aria-pressed={dept === "all"}
          className="px-3 py-1.5 rounded-full text-sm border cursor-pointer"
          style={{ borderColor: dept === "all" ? C.ink : C.line, background: dept === "all" ? C.ink : C.surface, color: dept === "all" ? C.surface : C.ink }}>
          All departments <span className="num ml-1 opacity-80">{open.length}</span>
        </button>
        {depts.map((d) => {
          const on = dept === d;
          const n = open.filter((c) => c.department === d).length;
          return (
            <button key={d} onClick={() => setDept(on ? "all" : d)} aria-pressed={on}
              className="flex items-center gap-2 pl-2.5 pr-3 py-1.5 rounded-full text-sm border cursor-pointer"
              style={{ borderColor: on ? DEPT_COLORS[d] : C.line, background: on ? tint(DEPT_COLORS[d], 14) : C.surface, color: C.ink }}>
              <Cap dept={d} size={12} /> {d} <span className="num text-ink-2">{n}</span>
            </button>
          );
        })}
      </div>

      {/* Tools */}
      <div className="flex flex-wrap gap-2 items-center mb-4">
        <input type="search" placeholder="Search R#, client or test" value={search} onChange={(e) => setSearch(e.target.value)}
          className={`${inputBase} w-64 max-w-full`} aria-label="Search" />
        <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className={inputBase} aria-label="Show">
          <option value="open">Outstanding only</option>
          <option value="all">Outstanding and completed</option>
          <option value="done">Completed only</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)} className={inputBase} aria-label="Sort">
          <option value="priority">A-List first, then oldest TAT</option>
          <option value="due">Oldest TAT first</option>
          <option value="r">By R# number</option>
          <option value="client">By client</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-ink-2 cursor-pointer px-1">
          <input type="checkbox" checked={alistOnly} onChange={(e) => setAlistOnly(e.target.checked)} className="w-4 h-4 accent-[var(--alist)]" />
          A-List only
        </label>
        <Button tone="quiet" className="ml-auto" onClick={exportCsv}>Export this view (CSV)</Button>
      </div>

      {/* Worklist */}
      {!visible.length ? (
        <div className="card p-10 text-center">
          <p className="text-ink-2 mb-4">{slices.length ? "No cases match these filters." : "Nothing is being tracked yet. Paste the MT outstanding list to start."}</p>
          {!slices.length && <Button tone="primary" onClick={onOpenPaste}>Paste MT list</Button>}
        </div>
      ) : groups.map(({ g, rows }) => (
        <section key={g} className="mb-6" aria-label={GROUP_LABEL[g]}>
          <h2 className="flex items-baseline gap-2 mb-2 text-base font-semibold" style={{ color: g === "overdue" ? C.danger : g === "soon" ? C.warning : C.ink }}>
            {GROUP_LABEL[g]} <span className="num text-sm font-normal text-ink-3">{rows.length}</span>
          </h2>
          <div className="card overflow-hidden">
            <div className="hidden md:grid grid-cols-[9rem_minmax(12rem,1.3fr)_minmax(10rem,2fr)_12rem] gap-4 px-4 py-2 text-xs text-ink-3 border-b" style={{ borderColor: C.line, background: C.raised }}>
              <span>Department</span><span>Requisition</span><span>Tests</span><span>TAT</span>
            </div>
            {rows.map((c) => {
              const st = statusText(c, now);
              return (
                <button key={c.id} onClick={() => setOpenId(c.id)}
                  className="w-full text-left grid md:grid-cols-[9rem_minmax(12rem,1.3fr)_minmax(10rem,2fr)_12rem] gap-x-4 gap-y-2 px-4 border-b last:border-b-0 hover:bg-raised cursor-pointer"
                  style={{ borderColor: C.line, paddingTop: "var(--row-y)", paddingBottom: "var(--row-y)",
                    boxShadow: g === "overdue" ? `inset 4px 0 0 ${C.danger}` : undefined }}>
                  <span className="flex items-center gap-2 text-sm text-ink-2"><Cap dept={c.department} /> {c.department}</span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="num font-semibold text-ink">{c.patientId}</span>
                      {c.isAlist && <Badge color={C.alist}>A-List</Badge>}
                    </span>
                    <span className="block text-sm text-ink-2 break-words">{c.clientDisplay}</span>
                  </span>
                  <span className="self-center"><TestChips tests={c.tests} showDone={c.status === "Completed"} /></span>
                  <span className="self-center min-w-0">
                    <span className="block text-sm font-semibold mb-1" style={{ color: st.color }}>{st.text}</span>
                    <Fuse c={c} now={now} />
                    <span className="block num text-xs text-ink-3 mt-1">TAT {c.reportDate}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
      <p className="text-xs text-ink-3">Showing {visible.length} of {slices.length} department entries.</p>

      <CaseDrawer c={selected} siblings={selected ? slices.filter((s) => s.rNumber === selected.rNumber && s.id !== selected.id) : []}
        now={now} onClose={() => setOpenId(null)} onSelect={setOpenId} />
    </div>
  );
}

function CaseDrawer({ c, siblings, now, onClose, onSelect }: {
  c: Slice | null; siblings: Slice[]; now: number; onClose: () => void; onSelect: (id: string) => void;
}) {
  useEffect(() => {
    if (!c) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [c, onClose]);
  if (!c) return null;
  const st = statusText(c, now);
  const tat = tatMs(c);
  const done = c.tests.filter((t) => t.status === "Completed").length;

  return (
    <div className="fixed inset-0 z-50 no-print" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{ background: "rgb(10 16 24 / 0.35)" }}>
      <aside role="dialog" aria-modal="true" aria-label={`Requisition ${c.patientId}`}
        className="absolute right-0 top-0 h-full w-full max-w-lg overflow-y-auto border-l p-6" style={{ background: C.surface, borderColor: C.line }}>
        <div className="flex items-start justify-between gap-4 mb-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="num text-2xl font-semibold text-ink">{c.patientId}</h2>
            {c.isAlist && <Badge color={C.alist} solid>A-List</Badge>}
          </div>
          <button onClick={onClose} aria-label="Close" className="text-ink-3 hover:text-ink text-2xl leading-none cursor-pointer px-1">×</button>
        </div>
        <p className="text-ink mb-0.5">{c.clientDisplay}</p>
        {c.clientRaw && c.clientRaw !== c.clientDisplay && <p className="text-xs text-ink-3 mb-3">As printed in MT: {c.clientRaw}</p>}

        <div className="flex items-center gap-2 text-sm text-ink-2 mt-3 mb-5"><Cap dept={c.department} /> {c.department} ({c.pair})</div>

        <div className="rounded-lg p-4 mb-5" style={{ background: tint(st.color, 8), borderLeft: `4px solid ${st.color}` }}>
          <div className="flex items-baseline justify-between gap-3 mb-2 flex-wrap">
            <span className="text-lg font-semibold" style={{ color: st.color }}>{st.text}</span>
            <span className="text-sm text-ink-2">TAT <span className="num text-ink">{c.reportDate}</span></span>
          </div>
          <Fuse c={c} now={now} />
          <p className="text-xs text-ink-3 mt-2">{done} of {c.tests.length} tests finished</p>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm mb-5">
          <div><dt className="text-ink-3 text-xs">First on the list</dt><dd className="num text-ink">{fmtIso(c.dateAdded)}</dd></div>
          <div><dt className="text-ink-3 text-xs">Last seen pending</dt><dd className="num text-ink">{fmtIso(c.lastSeen)}</dd></div>
          <div><dt className="text-ink-3 text-xs">Completed (detected)</dt><dd className="num text-ink">{c.completedAt ? fmtIso(c.completedAt) : "Still outstanding"}</dd></div>
        </dl>

        {siblings.length > 0 && (
          <div className="mb-5">
            <p className="text-xs text-ink-3 mb-1.5">Same requisition, other departments</p>
            <div className="flex flex-wrap gap-2">
              {siblings.map((s) => (
                <Button key={s.id} onClick={() => onSelect(s.id)}>
                  <Cap dept={s.department} size={11} /> {s.department}
                  <span className="text-ink-3">{s.status === "Completed" ? "done" : `${s.tests.filter((t) => t.status !== "Completed").length} pending`}</span>
                </Button>
              ))}
            </div>
          </div>
        )}

        <h3 className="font-semibold text-ink mb-3">Tests</h3>
        <ol>
          {c.tests.map((t, i) => {
            const v = verdict(t, tat, now);
            const isDone = t.status === "Completed";
            const color = isDone ? (v.kind === "late" ? C.danger : v.kind === "unclear" ? C.warning : C.success) : now > tat ? C.danger : C.accent;
            const label = isDone ? (v.kind === "ontime" ? "on time" : v.kind === "late" ? `${rangeText(v.min, v.max)} late` : "on time?")
              : now > tat ? `${formatMinutes((now - tat) / 60000)} over` : "pending";
            return (
              <li key={t.name} className="flex gap-3">
                <div className="flex flex-col items-center w-4 pt-1">
                  <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ background: isDone ? color : "transparent", border: `2px solid ${color}` }} />
                  {i < c.tests.length - 1 && <span className="w-px flex-1 my-1" style={{ background: C.line }} />}
                </div>
                <div className="pb-4 flex-1 min-w-0">
                  <div className="flex justify-between gap-3">
                    <span className="num font-semibold text-ink">{t.name}</span>
                    <span className="text-sm font-medium" style={{ color }}>{label}</span>
                  </div>
                  <p className="text-xs text-ink-3 num">
                    First seen {fmtIso(t.firstSeen)}.{" "}
                    {isDone ? `Finished between ${fmtTime(t.lastSeen)} and ${fmtIso(t.completedAt)}.` : `Still pending at ${fmtIso(t.lastSeen)}.`}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
        <p className="text-xs text-ink-3 mt-2">Finish times are known to within one paste: between the last list a test appeared on and the first list it was missing from.</p>
      </aside>
    </div>
  );
}
