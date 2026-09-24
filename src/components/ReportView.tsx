import { useEffect, useState } from "react";
import { saveSettings, type Settings } from "../lib/api";
import { aggNumbers, buildReport, type Agg, type ReportData } from "../lib/report";
import { REPORT_DEPT_ORDER, rangeText, toLocalInput, type Dicts, type Slice } from "../lib/tracker";
import { Badge, Button, C, DEPT_COLORS, Field, Note, Panel, StatCard, csvCell, downloadFile, inputBase, inputCls, stamp } from "./ui";

const startOfToday = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };

export default function ReportView({ slices, pasteTimes, dicts, settings, onError }: {
  slices: Slice[]; pasteTimes: string[]; dicts: Dicts; settings: Settings; onError: (m: string) => void;
}) {
  const [from, setFrom] = useState(toLocalInput(startOfToday()));
  const [to, setTo] = useState(toLocalInput(new Date()));
  const [grace, setGrace] = useState({ std: settings.graceStd, alist: settings.graceAlist });
  const [report, setReport] = useState<ReportData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setGrace({ std: settings.graceStd, alist: settings.graceAlist }); }, [settings.graceStd, settings.graceAlist]);

  function generate(g = grace) {
    const f = new Date(from), t = new Date(to);
    if (isNaN(f.getTime()) || isNaN(t.getTime()) || f > t) { setErr("Set a valid range: From must be before To."); return; }
    setErr(null);
    setReport(buildReport(slices, pasteTimes, f, t, dicts, g.std, g.alist));
  }
  // Keep an open report current as new pastes arrive
  useEffect(() => { if (report) generate(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [slices]);

  async function saveGrace(next: { std: number; alist: number }) {
    setGrace(next);
    try { await saveSettings({ ...settings, graceStd: next.std, graceAlist: next.alist }); }
    catch (e: any) { onError(e.message); }
    if (report) generate(next);
  }

  function exportCsv() {
    if (!report) return;
    const o = aggNumbers(report.overall);
    const cols = (a: Agg) => { const n = aggNumbers(a); return [a.total, a.onTime, n.delayed, a.unclear, a.notDue, n.rate, Math.round(n.avgMin), Math.round(n.avgMax)]; };
    const header = "Total,On time,Delayed,Unclear,Not yet due,Delay rate %,Avg delay min (low),Avg delay min (high)";
    const rows = [
      `Delay report,${csvCell(report.from.toLocaleString() + " to " + report.to.toLocaleString())}`,
      `Grace (min),Standard ${report.graceStd},A-List ${report.graceAlist}`,
      `Pastes in window,${report.pasteCount},Avg interval (min),${report.avgGap !== null ? Math.round(report.avgGap) : ""}`,
      "", `Cases,${report.cases}`, `On time,${report.overall.onTime}`, `Delayed,${o.delayed}`, `Unclear,${report.overall.unclear}`, `Delay rate %,${o.rate}`,
      "", "Department," + header,
      ...REPORT_DEPT_ORDER.filter((d) => report.byDept[d]).map((d) => [d, ...cols(report.byDept[d]!)].join(",")),
      "", "Client tier," + header,
      ...(["A-List", "Standard"] as const).map((b) => [b, ...cols(report.byTier[b])].join(",")),
      "", "Test,Department," + header,
      ...report.byTest.map((r) => [csvCell(r.key), csvCell(r.department), ...cols(r)].join(",")),
    ];
    downloadFile(`delay_report_${stamp()}.csv`, rows.join("\n"), "text/csv;charset=utf-8;");
  }

  return (
    <div className="p-6 max-w-6xl mx-auto report-print">
      <Panel title="Shift / period delay report" action={
        <div className="flex gap-2 no-print">
          <Button disabled={!report} onClick={() => window.print()}>Print</Button>
          <Button disabled={!report} onClick={exportCsv}>Export CSV</Button>
        </div>}>
        <div className="grid sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto_auto] gap-3 items-end no-print">
          <Field label="From"><input type="datetime-local" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><input type="datetime-local" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <div className="mb-3"><Button onClick={() => { setFrom(toLocalInput(startOfToday())); setTo(toLocalInput(new Date())); }}>Today so far</Button></div>
          <Field label="Grace, standard (min)"><input type="number" min={0} className={`${inputBase} w-24`} value={grace.std}
            onChange={(e) => setGrace({ ...grace, std: Math.max(0, +e.target.value || 0) })} onBlur={() => saveGrace(grace)} /></Field>
          <Field label="Grace, A-List (min)"><input type="number" min={0} className={`${inputBase} w-24`} value={grace.alist}
            onChange={(e) => setGrace({ ...grace, alist: Math.max(0, +e.target.value || 0) })} onBlur={() => saveGrace(grace)} /></Field>
        </div>
        <div className="flex items-center gap-3 no-print">
          <Button tone="primary" onClick={() => generate()}>Generate report</Button>
          <span className="text-[0.7rem] text-[#7c8ba1]">Grace periods are shared with everyone. A case counts if it was on a paste, or dropped off the list, within the window.</span>
        </div>
        {err && <div className="mt-3"><Note tone="err">{err}</Note></div>}
      </Panel>

      {report && <ReportBody r={report} />}
    </div>
  );
}

function ReportBody({ r }: { r: ReportData }) {
  const o = aggNumbers(r.overall);
  return (
    <>
      <div className="print-only mb-3 text-sm">Delay report {r.from.toLocaleString()} to {r.to.toLocaleString()}</div>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-4">
        <StatCard label="Cases in window" value={r.cases} color={C.primary} />
        <StatCard label="On time" value={r.overall.onTime} color={C.success} />
        <StatCard label="Delayed" value={o.delayed} sub={`${r.overall.late} done late, ${r.overall.ongoing} still open`} color={C.danger} />
        <StatCard label="Unclear" value={r.overall.unclear} color={C.warning} />
        <StatCard label="Delay rate" value={`${o.rate}%`} color={o.rate < 20 ? C.success : C.danger} />
        <StatCard label="Avg delay" value={<span className="text-lg">{o.delayed ? rangeText(o.avgMin, o.avgMax) : "–"}</span>} color={C.text} />
        <StatCard label="Paste interval" value={<span className="text-lg">{r.avgGap !== null ? rangeText(r.avgGap, r.avgGap) : "–"}</span>} sub={`${r.pasteCount} pastes`} color={C.dim} />
      </div>
      <p className="text-[0.7rem] text-[#7c8ba1] mb-5 leading-relaxed">
        Delay rate = delayed ÷ (on time + delayed); unclear and not-yet-due cases are left out. Delays show as a range when the finish time is only known to within a paste.
        {(r.graceStd || r.graceAlist) ? ` Grace applied: ${r.graceStd} min standard, ${r.graceAlist} min A-List.` : " No grace period applied."}
      </p>

      <Panel title="Delay by department">
        <AggTable firstCol="Department" rows={REPORT_DEPT_ORDER.filter((d) => r.byDept[d]).map((d) => ({
          key: d, label: <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full" style={{ background: DEPT_COLORS[d] }} />{d}</span>, agg: r.byDept[d]!,
        }))} bar />
      </Panel>
      <Panel title="A-List vs standard clients">
        <AggTable firstCol="Client tier" rows={(["A-List", "Standard"] as const).map((b) => ({
          key: b, label: b === "A-List" ? <Badge color={C.warning} solid>A-List</Badge> : "Standard", agg: r.byTier[b],
        }))} />
      </Panel>
      <Panel title="Delay trend by test">
        <p className="text-[0.7rem] text-[#7c8ba1] -mt-1 mb-3">Top 20 by number delayed. Each test is judged on its own finish time.</p>
        <AggTable firstCol="Test" extraCol="Department" rows={r.byTest.slice(0, 20).map((t) => ({ key: t.key, label: t.key, extra: t.department, agg: t }))} />
      </Panel>
    </>
  );
}

function AggTable({ firstCol, extraCol, rows, bar = false }: {
  firstCol: string; extraCol?: string; bar?: boolean;
  rows: { key: string; label: React.ReactNode; extra?: string; agg: Agg }[];
}) {
  if (!rows.length) return <p className="text-xs text-[#7c8ba1]">No data in this window.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[#7c8ba1] font-mono">
            {[firstCol, ...(extraCol ? [extraCol] : []), "Total", "On time", "Delayed", "Unclear", "Not yet due", "Delay rate", "Avg delay", ...(bar ? [""] : [])].map((h) => (
              <th key={h} className="py-2 pr-4 font-medium border-b" style={{ borderColor: C.border }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ key, label, extra, agg }) => {
            const n = aggNumbers(agg);
            return (
              <tr key={key} className="border-b text-[#cbd5e1]" style={{ borderColor: C.border }}>
                <td className="py-2 pr-4 font-display">{label}</td>
                {extraCol && <td className="py-2 pr-4 text-[#94a3b8]">{extra}</td>}
                <td className="py-2 pr-4 font-mono">{agg.total}</td>
                <td className="py-2 pr-4 font-mono">{agg.onTime}</td>
                <td className="py-2 pr-4 font-mono" style={{ color: n.delayed ? C.danger : undefined }}>{n.delayed}</td>
                <td className="py-2 pr-4 font-mono">{agg.unclear}</td>
                <td className="py-2 pr-4 font-mono">{agg.notDue}</td>
                <td className="py-2 pr-4 font-mono">{n.rate}%</td>
                <td className="py-2 pr-4 font-mono">{n.delayed ? rangeText(n.avgMin, n.avgMax) : "–"}</td>
                {bar && <td className="py-2 w-32"><div className="h-1.5 rounded-full" style={{ background: C.track }}>
                  <div className="h-full rounded-full" style={{ width: `${n.rate}%`, background: n.rate < 20 ? C.success : C.danger }} /></div></td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
