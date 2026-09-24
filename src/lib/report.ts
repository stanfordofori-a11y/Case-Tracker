import { matchDeptKeyword, norm, verdict, type Dicts, type Slice, type SliceDept, type Verdict } from "./tracker";

export interface Agg { total: number; onTime: number; late: number; ongoing: number; unclear: number; notDue: number; sumMin: number; sumMax: number }
export const newAgg = (): Agg => ({ total: 0, onTime: 0, late: 0, ongoing: 0, unclear: 0, notDue: 0, sumMin: 0, sumMax: 0 });

export function addToAgg(a: Agg, v: Verdict) {
  a.total++;
  if (v.kind === "ontime") a.onTime++;
  else if (v.kind === "late") { a.late++; a.sumMin += v.min; a.sumMax += v.max; }
  else if (v.kind === "overdue") { a.ongoing++; a.sumMin += v.min; a.sumMax += v.max; }
  else if (v.kind === "unclear") a.unclear++;
  else a.notDue++;
}

export function aggNumbers(a: Agg) {
  const delayed = a.late + a.ongoing;
  const judged = a.onTime + delayed;
  return { delayed, rate: judged ? Math.round((100 * delayed) / judged) : 0,
    avgMin: delayed ? a.sumMin / delayed : 0, avgMax: delayed ? a.sumMax / delayed : 0 };
}

export interface ReportData {
  from: Date; to: Date; cases: number;
  overall: Agg;
  byDept: Partial<Record<SliceDept, Agg>>;
  byTier: { "A-List": Agg; Standard: Agg };
  byTest: (Agg & { key: string; department: string })[];
  pasteCount: number; avgGap: number | null;
  graceStd: number; graceAlist: number;
}

export function buildReport(slices: Slice[], pasteTimes: string[], from: Date, to: Date, dicts: Dicts, graceStd: number, graceAlist: number): ReportData {
  const nowMs = Math.min(Date.now(), to.getTime());
  const inWin = (iso: string | null) => { if (!iso) return false; const d = new Date(iso); return d >= from && d <= to; };
  const windowCases = slices.filter((c) => inWin(c.lastSeen) || inWin(c.completedAt));
  const overall = newAgg();
  const byDept: ReportData["byDept"] = {};
  const byTier = { "A-List": newAgg(), Standard: newAgg() };
  const testAgg: Record<string, Agg & { key: string; department: string }> = {};

  windowCases.forEach((c) => {
    const due = new Date(c.reportDateTime).getTime() + ((c.isAlist ? graceAlist : graceStd) || 0) * 60000;
    const v = verdict(c, due, nowMs);
    addToAgg(overall, v);
    addToAgg(byDept[c.department] || (byDept[c.department] = newAgg()), v);
    addToAgg(byTier[c.isAlist ? "A-List" : "Standard"], v);
    // Each test is judged on its own finish time.
    c.tests.forEach((t) => {
      if (!inWin(t.lastSeen) && !inWin(t.completedAt)) return;
      const m = matchDeptKeyword(t.name, dicts);
      const key = m.department === "Unclassified" ? norm(t.name) : m.keyword!;
      const e = testAgg[key] || (testAgg[key] = { ...newAgg(), key,
        department: m.department === "Unclassified" ? `${c.department} (not in dictionary)` : m.department });
      addToAgg(e, verdict(t, due, nowMs));
    });
  });

  const pastes = pasteTimes.filter(inWin).map((p) => new Date(p).getTime()).sort((a, b) => a - b);
  const avgGap = pastes.length >= 2 ? (pastes[pastes.length - 1] - pastes[0]) / (pastes.length - 1) / 60000 : null;
  const byTest = Object.values(testAgg).sort((x, y) => {
    const nx = aggNumbers(x), ny = aggNumbers(y);
    return ny.delayed - nx.delayed || ny.avgMax - nx.avgMax || y.total - x.total;
  });
  return { from, to, cases: windowCases.length, overall, byDept, byTier, byTest, pasteCount: pastes.length, avgGap, graceStd, graceAlist };
}
