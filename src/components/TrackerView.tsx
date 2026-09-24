import { useMemo, useState } from "react";
import {
  fmtIso, fmtTime, formatMinutes, norm, rangeText, tatMs, verdict,
  type Slice, type SliceDept, type TrackedTest,
} from "../lib/tracker";
import { Badge, Button, C, DEPT_COLORS, DEPT_SHORT, StatCard, csvCell, downloadFile, inputBase, inputCls, stamp } from "./ui";

type StatusFilter = "open" | "all" | "done";
type SortMode = "priority" | "due" | "r" | "client";

function ageInfo(c: Slice, now: number) {
  const tat = tatMs(c);
  if (c.status !== "Completed") {
    const diff = (now - tat) / 60000;
    if (diff > 0) return { text: `${formatMinutes(diff)} overdue`, color: C.danger, kind: "overdue" as const };
    return { text: `due in ${formatMinutes(-diff)}`, color: diff > -60 ? C.warning : C.success, kind: diff > -60 ? "soon" as const : "due" as const };
  }
  const v = verdict(c, tat, now);
  if (v.kind === "ontime") return { text: "done on time", color: C.done, kind: "done" as const };
  if (v.kind === "late") return { text: `done ${rangeText(v.min, v.max)} late`, color: "#fca5a5", kind: "late" as const };
  return { text: "done, on time?", color: C.warning, kind: "unclear" as const };
}

function TestDots({ tests }: { tests: TrackedTest[] }) {
  const shown = tests.slice(0, 12);
  return (
    <div className="flex items-center gap-1" aria-label={`${tests.filter((t) => t.status === "Completed").length} of ${tests.length} tests done`}>
      {shown.map((t, i) => {
        const done = t.status === "Completed";
        return <span key={i} title={`${t.name}: ${done ? "done" : "pending"}`} className="rounded-full"
          style={{ width: 7, height: 7, background: done ? C.done : "transparent", border: done ? "none" : `1.5px solid ${C.primary}` }} />;
      })}
      {tests.length > shown.length && <span className="font-mono text-[0.6rem] text-[#7c8ba1]">+{tests.length - shown.length}</span>}
    </div>
  );
}

export default function TrackerView({ slices, now, lastPaste, onOpenPaste }: {
  slices: Slice[];
  now: number;
  lastPaste: { at: string; by_email: string } | null;
  onOpenPaste: () => void;
}) {
  const [dept, setDept] = useState<SliceDept | "all">("all");
  const [status, setStatus] = useState<StatusFilter>("open");
  const [alistOnly, setAlistOnly] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [sort, setSort] = useState<SortMode>("priority");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const open = slices.filter((c) => c.status !== "Completed");
  const deptsPresent: SliceDept[] = ["Hematology", "Microbiology", "Chemistry", "Immunology",
    ...(slices.some((c) => c.department === "Unclassified") ? ["Unclassified" as SliceDept] : [])];

  const visible = useMemo(() => {
    const q = norm(search);
    const v = slices.filter((c) => {
      if (dept !== "all" && c.department !== dept) return false;
      if (status === "open" && c.status === "Completed") return false;
      if (status === "done" && c.status !== "Completed") return false;
      if (alistOnly && !c.isAlist) return false;
      if (overdueOnly && !(c.status !== "Completed" && now > tatMs(c))) return false;
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
  }, [slices, dept, status, alistOnly, overdueOnly, sort, search, now]);

  const selected = visible.find((c) => c.id === selectedId) || visible[0] || null;
  const siblings = selected ? slices.filter((c) => c.rNumber === selected.rNumber && c.id !== selected.id) : [];
  const overdueCount = open.filter((c) => now > tatMs(c)).length;
  const staleMin = lastPaste ? (now - new Date(lastPaste.at).getTime()) / 60000 : null;

  function exportCsv() {
    const rows = [["R#", "Client", "A-List", "Department", "Pair", "Pending tests", "Tests done", "TAT", "Age", "Status", "Completed (detected)", "Last seen pending"].join(",")];
    visible.forEach((c) => {
      const pend = c.tests.filter((t) => t.status !== "Completed").map((t) => t.name).join(", ");
      const done = c.tests.filter((t) => t.status === "Completed").map((t) => t.name).join(", ");
      rows.push([c.patientId, csvCell(c.clientDisplay), c.isAlist ? "A-LIST" : "", c.department, c.pair, csvCell(pend), csvCell(done),
        c.reportDate, csvCell(ageInfo(c, now).text), c.status, fmtIso(c.completedAt), fmtIso(c.lastSeen)].join(","));
    });
    downloadFile(`tracker_export_${stamp()}.csv`, rows.join("\n"), "text/csv;charset=utf-8;");
  }

  return (
    <>
      {/* Department bar */}
      <div className="border-b px-6 py-3" style={{ borderColor: C.border, background: C.surface }}>
        <div className="flex items-center gap-1.5 flex-wrap">
          {deptsPresent.map((d) => {
            const count = open.filter((c) => c.department === d).length;
            const color = DEPT_COLORS[d];
            const on = dept === d;
            return (
              <button key={d} onClick={() => setDept(on ? "all" : d)} aria-pressed={on}
                className="flex items-center gap-2 px-3 py-1.5 rounded text-xs transition-colors cursor-pointer"
                style={{ background: on ? `${color}18` : "transparent", border: `1px solid ${on ? color : C.border}`, color: on ? color : C.dim }}>
                <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                <span className="font-display font-medium">{d}</span>
                <span className="font-mono font-bold px-1.5 rounded text-[0.62rem]"
                  style={{ background: count ? `${color}22` : C.track, color: count ? color : C.muted }}>{count}</span>
              </button>
            );
          })}
          <div className="ml-auto flex items-center gap-3">
            <span className="font-mono text-xs" style={{ color: staleMin !== null && staleMin > 120 && open.length ? C.warning : C.muted }}>
              {lastPaste ? `Updated ${fmtTime(lastPaste.at)} by ${lastPaste.by_email.split("@")[0]}${staleMin !== null && staleMin > 120 ? " · list may be out of date" : ""}` : "No list pasted yet"}
            </span>
            <Button tone="primary" onClick={onOpenPaste}>Paste MT list</Button>
          </div>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row lg:h-[calc(100vh-118px)]">
        {/* Left: list */}
        <div className="flex flex-col border-r lg:w-[480px] shrink-0" style={{ borderColor: C.border, background: C.panel }}>
          <div className="grid grid-cols-4 gap-2 p-3 border-b" style={{ borderColor: C.border }}>
            <StatCard label="Outstanding" value={open.length} color={C.primary} />
            <StatCard label="Overdue" value={overdueCount} color={C.danger} />
            <StatCard label="A-List" value={open.filter((c) => c.isAlist).length} color={C.warning} />
            <StatCard label="Completed" value={slices.length - open.length} color={C.success} />
          </div>

          <div className="p-3 border-b space-y-2" style={{ borderColor: C.border }}>
            <input type="search" placeholder="Search R#, client or test" value={search} onChange={(e) => setSearch(e.target.value)} className={inputCls} aria-label="Search" />
            <div className="flex gap-2 flex-wrap items-center">
              <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className={`${inputBase} w-auto`} aria-label="Status">
                <option value="open">Outstanding</option>
                <option value="all">All</option>
                <option value="done">Completed</option>
              </select>
              <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)} className={`${inputBase} w-auto`} aria-label="Sort">
                <option value="priority">A-List first, oldest TAT</option>
                <option value="due">Oldest TAT first</option>
                <option value="r">R# number</option>
                <option value="client">Client name</option>
              </select>
              <label className="flex items-center gap-1.5 text-xs text-[#94a3b8] cursor-pointer">
                <input type="checkbox" checked={alistOnly} onChange={(e) => setAlistOnly(e.target.checked)} className="accent-[#f59e0b]" /> A-List
              </label>
              <label className="flex items-center gap-1.5 text-xs text-[#94a3b8] cursor-pointer">
                <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} className="accent-[#ef4444]" /> Overdue
              </label>
              <Button tone="quiet" className="ml-auto px-1" onClick={exportCsv} title="Download the cases in this view">Export CSV</Button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto max-h-[60vh] lg:max-h-none" role="listbox" aria-label="Cases">
            {visible.map((c) => {
              const isSel = selected?.id === c.id;
              const age = ageInfo(c, now);
              const color = DEPT_COLORS[c.department];
              return (
                <div key={c.id} role="option" aria-selected={isSel} tabIndex={0}
                  onClick={() => setSelectedId(c.id)} onKeyDown={(e) => { if (e.key === "Enter") setSelectedId(c.id); }}
                  className="cursor-pointer border-b outline-none focus-visible:bg-white/[0.04]"
                  style={{ borderColor: C.border, borderLeft: `3px solid ${isSel ? color : "transparent"}`, background: isSel ? `${color}0d` : "transparent" }}>
                  <div className="px-4 py-3 hover:bg-white/[0.02]">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="min-w-0">
                        <div className="font-display font-semibold text-sm text-[#e2e8f0] truncate">{c.clientDisplay}</div>
                        <div className="flex items-center gap-2 mt-0.5 font-mono text-xs text-[#7c8ba1]">
                          <span className="text-[#cbd5e1]">{c.patientId}</span>
                          <span style={{ color }}>{DEPT_SHORT[c.department]}</span>
                          <span>TAT {c.reportDate.split(" ")[1] || c.reportDate}</span>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {c.isAlist && <Badge color={C.warning} solid>A-List</Badge>}
                        <span className="font-mono text-[0.68rem]" style={{ color: age.color }}>{age.text}</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <TestDots tests={c.tests} />
                      <span className="font-mono text-[0.65rem] text-[#7c8ba1]">
                        {c.tests.filter((t) => t.status === "Completed").length}/{c.tests.length} done
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {c.tests.filter((t) => c.status === "Completed" || t.status !== "Completed").slice(0, 8).map((t) => (
                        <span key={t.name} className="px-1.5 py-0.5 rounded font-mono text-[0.6rem] text-[#94a3b8]"
                          style={{ background: C.card, border: `1px solid ${C.track}` }}>{t.name}</span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
            {!visible.length && (
              <div className="p-8 text-center text-xs text-[#7c8ba1] leading-relaxed">
                {slices.length ? "No cases match these filters." : <>Nothing tracked yet.<br />Paste the MT outstanding list to start.</>}
                {!slices.length && <div className="mt-3"><Button tone="primary" onClick={onOpenPaste}>Paste MT list</Button></div>}
              </div>
            )}
          </div>
          <div className="px-4 py-2 border-t font-mono text-[0.65rem] text-[#7c8ba1]" style={{ borderColor: C.border }}>
            Showing {visible.length} of {slices.length} department entries
          </div>
        </div>

        {/* Right: detail */}
        <div className="flex-1 overflow-y-auto">
          {selected ? <CaseDetail c={selected} siblings={siblings} now={now} onSelect={setSelectedId} /> : (
            <div className="h-full min-h-[40vh] flex items-center justify-center text-sm text-[#7c8ba1]">Select a case to see its tests.</div>
          )}
        </div>
      </div>
    </>
  );
}

function CaseDetail({ c, siblings, now, onSelect }: { c: Slice; siblings: Slice[]; now: number; onSelect: (id: string) => void }) {
  const color = DEPT_COLORS[c.department];
  const age = ageInfo(c, now);
  const done = c.tests.filter((t) => t.status === "Completed").length;
  const pct = Math.round((done / c.tests.length) * 100);
  const tat = tatMs(c);

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <h1 className="font-display font-bold text-2xl text-[#e2e8f0]">{c.patientId}</h1>
            {c.isAlist && <Badge color={C.warning} solid>A-List</Badge>}
            <Badge color={c.status === "Completed" ? C.done : C.primary}>{c.status === "Completed" ? "Completed" : "Outstanding"}</Badge>
          </div>
          <div className="text-sm text-[#cbd5e1]">{c.clientDisplay}</div>
          {c.clientDisplay !== c.clientRaw && c.clientRaw && <div className="font-mono text-xs text-[#7c8ba1] mt-0.5">MT client text: {c.clientRaw}</div>}
        </div>
        <div className="text-right">
          <div className="font-mono text-xs text-[#7c8ba1] mb-1">Department</div>
          <div className="font-display font-semibold text-sm px-3 py-1 rounded" style={{ background: `${color}14`, color, border: `1px solid ${color}40` }}>
            {c.department} <span className="text-[#7c8ba1] font-normal">· {c.pair}</span>
          </div>
        </div>
      </div>

      {/* Status highlight */}
      <div className="rounded-lg p-4 mb-6 border" style={{ background: `${age.color}0d`, borderColor: `${age.color}33` }}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="font-mono text-xs text-[#7c8ba1] mb-1">{c.status === "Completed" ? "Outcome" : "Time to TAT"}</div>
            <div className="font-display font-bold text-lg flex items-center gap-2" style={{ color: age.color }}>
              {c.status !== "Completed" && (
                <span className="relative w-2.5 h-2.5 rounded-full" style={{ background: age.color }}>
                  {age.kind === "overdue" && <span className="absolute inset-0 rounded-full animate-ping opacity-60 motion-reduce:hidden" style={{ background: age.color }} />}
                </span>
              )}
              {age.text.charAt(0).toUpperCase() + age.text.slice(1)}
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-xs text-[#7c8ba1] mb-1">TAT (report date)</div>
            <div className="font-mono font-bold text-xl text-[#e2e8f0]">{c.reportDate}</div>
          </div>
        </div>
        <div className="mt-3">
          <div className="h-1 rounded-full" style={{ background: C.track }}>
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${C.primary}, ${C.done})` }} />
          </div>
          <div className="font-mono text-[0.65rem] text-[#7c8ba1] mt-1">{done} of {c.tests.length} tests finished</div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
        {[
          ["First on the list", fmtIso(c.dateAdded)],
          ["Last seen pending", fmtIso(c.lastSeen)],
          ["Completed (detected)", c.completedAt ? fmtIso(c.completedAt) : "Still outstanding"],
          ["Pending tests", String(c.tests.length - done)],
          ["Tests done", String(done)],
          ["Other departments", siblings.length ? siblings.map((s) => s.department).join(", ") : "None"],
        ].map(([label, value]) => (
          <div key={label} className="rounded p-3" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <div className="font-mono text-[0.62rem] text-[#7c8ba1] mb-1">{label}</div>
            <div className="font-display text-sm font-medium text-[#e2e8f0] leading-snug">{value}</div>
          </div>
        ))}
      </div>

      {siblings.length > 0 && (
        <div className="flex gap-2 flex-wrap mb-6">
          {siblings.map((s) => (
            <Button key={s.id} onClick={() => onSelect(s.id)}>
              <span className="w-2 h-2 rounded-full" style={{ background: DEPT_COLORS[s.department] }} />
              Open {s.department} ({s.tests.filter((t) => t.status !== "Completed").length} pending)
            </Button>
          ))}
        </div>
      )}

      <div className="font-display font-semibold text-sm text-[#cbd5e1] mb-4">Tests on this requisition</div>
      <div>
        {c.tests.map((t, i) => {
          const v = verdict(t, tat, now);
          const isDone = t.status === "Completed";
          const dotColor = isDone ? (v.kind === "late" ? "#fca5a5" : v.kind === "unclear" ? C.warning : C.done) : now > tat ? C.danger : C.primary;
          const last = i === c.tests.length - 1;
          return (
            <div key={t.name} className="flex gap-4">
              <div className="flex flex-col items-center" style={{ width: 20 }}>
                <div className="rounded-full shrink-0 mt-1 flex items-center justify-center"
                  style={{ width: 14, height: 14, background: isDone ? dotColor : "transparent", border: isDone ? "none" : `2px solid ${dotColor}` }}>
                  {isDone && <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden><path d="M1.5 4L3 5.5L6.5 2" stroke="#070d1a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </div>
                {!last && <div className="w-px flex-1 mt-1" style={{ background: C.track, minHeight: 28 }} />}
              </div>
              <div className="pb-5 flex-1 min-w-0">
                <div className="flex items-center justify-between gap-3 mb-0.5">
                  <span className="font-display font-semibold text-sm" style={{ color: isDone ? C.text : dotColor }}>{t.name}</span>
                  <span className="font-mono text-[0.68rem]" style={{ color: dotColor }}>
                    {isDone ? (v.kind === "ontime" ? "on time" : v.kind === "late" ? `${rangeText(v.min, v.max)} late` : "on time?")
                      : now > tat ? `${formatMinutes((now - tat) / 60000)} overdue` : "pending"}
                  </span>
                </div>
                <div className="font-mono text-[0.68rem] text-[#7c8ba1] leading-relaxed">
                  First seen {fmtIso(t.firstSeen)}
                  {isDone
                    ? <> · finished between {fmtTime(t.lastSeen)} and {fmtIso(t.completedAt)}</>
                    : <> · still pending at {fmtIso(t.lastSeen)}</>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[0.7rem] text-[#7c8ba1] mt-2 leading-relaxed">
        Finish times are only known to within one paste: a test finished sometime between the last paste it appeared on and the first paste it was missing from.
      </p>
    </div>
  );
}
