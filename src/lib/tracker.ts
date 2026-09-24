// Core tracker logic, ported from the single-file rev 13. Pure functions only:
// nothing here talks to the database or the page.

export type Department = "Hematology" | "Microbiology" | "Chemistry" | "Immunology";
export type SliceDept = Department | "Unclassified";
export type Pair = "Heme-Micro" | "Chem-Path" | "Unclassified";
export type TestStatus = "Pending" | "Completed";

export const DEPARTMENTS: Department[] = ["Hematology", "Microbiology", "Chemistry", "Immunology"];
export const REPORT_DEPT_ORDER: SliceDept[] = ["Hematology", "Microbiology", "Chemistry", "Immunology", "Unclassified"];

export interface AlistKeyword { keyword: string; displayName: string }
export interface DeptKeyword { keyword: string; department: Department }
export interface Dicts { alist: AlistKeyword[]; dept: DeptKeyword[]; ignored: string[] }

export interface TrackedTest {
  name: string;
  status: TestStatus;
  firstSeen: string;
  lastSeen: string;
  completedAt: string | null;
}

export interface Slice {
  id: string;
  rNumber: string;
  patientId: string;
  clientRaw: string;
  clientDisplay: string;
  isAlist: boolean;
  department: SliceDept;
  pair: Pair;
  tests: TrackedTest[];
  pendingTests: string;
  reportDate: string;
  reportDateTime: string;
  status: TestStatus;
  lastSeen: string | null;
  dateAdded: string | null;
  completedAt: string | null;
}

export interface ParsedSlice {
  id: string;
  rNumber: string;
  patientId: string;
  clientRaw: string;
  department: SliceDept;
  pendingNames: string[];
  reportDate: string;
  reportDateTime: string;
}

export interface ParseResult {
  slices: ParsedSlice[];
  skipped: { patientId: string; clientRaw: string; reason: string }[];
  unmatched: Record<string, { name: string; count: number; attachedTo: SliceDept }>;
}

/* ---------------- helpers ---------------- */
export const pad = (n: number) => String(n).padStart(2, "0");
export const norm = (s: unknown) => String(s ?? "").trim().replace(/\s+/g, " ").toUpperCase();
export const tokenizeTests = (str: string) => String(str || "").split(/,|\s{2,}/).map((t) => t.trim()).filter(Boolean);
export const fmtDisplay = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const fmtIso = (iso: string | null | undefined) => (iso ? fmtDisplay(new Date(iso)) : "");
export const fmtTime = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const toLocalInput = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const maxIso = (list: (string | null | undefined)[]) => {
  const v = list.filter(Boolean) as string[];
  return v.length ? v.reduce((a, b) => (new Date(a) > new Date(b) ? a : b)) : null;
};
export const minIso = (list: (string | null | undefined)[]) => {
  const v = list.filter(Boolean) as string[];
  return v.length ? v.reduce((a, b) => (new Date(a) < new Date(b) ? a : b)) : null;
};

export function formatMinutes(mins: number): string {
  const sign = mins < 0 ? "-" : "";
  const abs = Math.abs(Math.round(mins));
  const d = Math.floor(abs / 1440);
  const h = Math.floor((abs % 1440) / 60);
  const m = abs % 60;
  if (d > 0) return `${sign}${d}d ${h}h`;
  return h > 0 ? `${sign}${h}h ${m}m` : `${sign}${m}m`;
}

export function pairForDept(dept: string): Pair {
  if (dept === "Hematology" || dept === "Microbiology") return "Heme-Micro";
  if (dept === "Chemistry" || dept === "Immunology") return "Chem-Path";
  return "Unclassified";
}

/* ---------------- date parser ----------------
   The time is cut out of the string before the date numbers are read, so
   "14/08/2026 14:30" or "23/09/2026 08:09" parse correctly. */
export function parseAnyDate(dateTimeStr: string): Date | null {
  if (!dateTimeStr || dateTimeStr.trim() === "") return null;
  let clean = dateTimeStr.trim().replace(/Time/gi, " ");
  const isPM = /(\d|\s)pm\b/i.test(clean);
  const isAM = /(\d|\s)am\b/i.test(clean);
  let hours = 0, minutes = 0, timeFound = false;

  const tm = clean.match(/(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (tm && tm.index !== undefined) {
    hours = parseInt(tm[1], 10);
    minutes = parseInt(tm[2], 10);
    timeFound = true;
    clean = clean.slice(0, tm.index) + " " + clean.slice(tm.index + tm[0].length);
  }
  clean = clean.replace(/[.\-]/g, "/").replace(/[^0-9/ ]/g, " ");
  const numbers = clean.match(/\d+/g) || [];

  if (!timeFound && numbers.length >= 4) {
    const last = numbers[numbers.length - 1];
    const v = parseInt(last, 10);
    if (last!.length >= 3 && last!.length <= 4 && Math.floor(v / 100) <= 23 && v % 100 <= 59) {
      hours = Math.floor(v / 100);
      minutes = v % 100;
      numbers.pop();
    }
  }
  if (numbers.length < 3) return null;

  const n = numbers.slice(0, 3).map((x) => parseInt(x, 10));
  let day: number, month: number, year: number;
  if (numbers[0]!.length === 4 || n[0]! > 31) { year = n[0]!; month = n[1]!; day = n[2]!; }
  else {
    year = n[2];
    if (n[1] > 12 && n[0] <= 12) { month = n[0]; day = n[1]; }
    else { day = n[0]; month = n[1]; }
  }
  if (year < 100) year += 2000;
  if (isPM && hours < 12) hours += 12;
  if (isAM && hours === 12) hours = 0;
  if (!day || !month || !year || day > 31 || month > 12 || hours > 23 || minutes > 59) return null;
  const result = new Date(year, month - 1, day, hours, minutes);
  if (isNaN(result.getTime()) || result.getDate() !== day) return null;
  return result;
}

function cleanText(text: string): string {
  return text
    .replace(/\f/g, "\n")
    .split("\n")
    .filter((line) => {
      if (line.includes("REQUEST FORM")) return false;
      if (/RUN DATE:|RUN TIME:|OUTSTANDING LAB SPECIMENS|Priorities:|SPECIMEN PREFIX:|PAGE \d+/i.test(line)) return false;
      if (/^[─\-]+$/.test(line)) return false;
      return line.trim() !== "";
    })
    .join("\n");
}

/* ---------------- keyword matching ---------------- */
// A keyword only counts if it isn't glued to other letters/digits on either side,
// so "Hb" doesn't match inside "HBA1C".
export function keywordMatches(text: string, keyword: string): boolean {
  const hay = (text || "").toUpperCase();
  const kw = (keyword || "").toUpperCase();
  if (!kw) return false;
  let idx = hay.indexOf(kw);
  while (idx !== -1) {
    const before = idx > 0 ? hay[idx - 1] : null;
    const after = idx + kw.length < hay.length ? hay[idx + kw.length] : null;
    if ((!before || !/[A-Z0-9]/.test(before)) && (!after || !/[A-Z0-9]/.test(after))) return true;
    idx = hay.indexOf(kw, idx + 1);
  }
  return false;
}

export function classifyAlist(clientRaw: string, dicts: Dicts) {
  let best: AlistKeyword | null = null;
  for (const kw of dicts.alist) {
    if (keywordMatches(clientRaw, kw.keyword) && (!best || kw.keyword.length > best.keyword.length)) best = kw;
  }
  return best ? { isAlist: true, displayName: best.displayName || clientRaw } : { isAlist: false, displayName: clientRaw };
}

export function matchDeptKeyword(text: string, dicts: Dicts): { department: SliceDept; keyword: string | null } {
  let best: DeptKeyword | null = null;
  for (const kw of dicts.dept) {
    if (keywordMatches(text, kw.keyword) && (!best || kw.keyword.length > best.keyword.length)) best = kw;
  }
  return best ? { department: best.department, keyword: best.keyword } : { department: "Unclassified", keyword: null };
}

// An unmatched test name is usually a qualifier of the test printed before it
// ("CRP, Ultra sensi"), so it joins that test's department. Every unmatched
// name is also listed in Settings so the dictionary can be completed.
export function splitByDepartment<T>(items: T[], nameOf: (x: T) => string, dicts: Dicts) {
  const deptToItems: Partial<Record<SliceDept, T[]>> = {};
  const order: SliceDept[] = [];
  let lastMatched: SliceDept | null = null;
  items.forEach((it) => {
    const m = matchDeptKeyword(nameOf(it), dicts);
    const target: SliceDept = m.department !== "Unclassified" ? m.department : lastMatched || "Unclassified";
    if (m.department !== "Unclassified") lastMatched = m.department;
    if (!deptToItems[target]) { deptToItems[target] = []; order.push(target); }
    deptToItems[target]!.push(it);
  });
  return { order, deptToItems };
}

/* ---------------- parsing the MT dump (pure) ---------------- */
function processCaseBlock(block: string, dicts: Dicts):
  | null
  | { skip: ParseResult["skipped"][number] }
  | { slices: ParsedSlice[]; unmatched: { name: string; attachedTo: SliceDept }[] } {
  const rMatch = block.match(/\(R#(\d+)\)/);
  if (!rMatch) return null;
  const rNumber = rMatch[1];
  const patientId = "R#" + rNumber;

  const firstLine = block.split("\n")[0];
  const clientMatch = firstLine.match(/\(R#\d+\)\s*(.*)$/);
  const clientRaw = clientMatch ? clientMatch[1].trim() : "";

  let pendingTests = "";
  const pendingMatch = block.match(/Pending:\s*(.+?)$/im);
  if (pendingMatch) {
    pendingTests = pendingMatch[1].trim();
    const lines = block.split("\n");
    const start = lines.findIndex((l) => /Pending:/i.test(l));
    if (start !== -1) {
      for (let i = start + 1; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*@/.test(line)) break;
        if (/^\s*Ordered:|^\s*Comments:|^\s*Tube Info:|^\s*Consumables:|^\s*User:/i.test(line)) break;
        if (/RUN USER|RUN DATE|PAGE|SPECIMEN PREFIX/i.test(line)) break;
        if (line.trim().length > 0) pendingTests += ", " + line.trim();
      }
    }
  }
  pendingTests = pendingTests.replace(/\s+/g, " ").trim();
  if (!pendingTests || pendingTests.length < 2) return null;

  const rawDates: string[] = [];
  const parsedDates: Date[] = [];
  const dateRegex = /@\s*REPORT\s*Collection\s*Date\s+(.+?)(?=\n|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = dateRegex.exec(block)) !== null) {
    rawDates.push(m[1].trim());
    const d = parseAnyDate(m[1].trim());
    if (d) parsedDates.push(d);
  }
  if (!parsedDates.length) {
    return { skip: { patientId, clientRaw,
      reason: rawDates.length ? `date not recognised: "${rawDates[0]}"` : 'no "@ REPORT Collection Date" line found' } };
  }
  const earliest = new Date(Math.min(...parsedDates.map((d) => d.getTime())));

  const names: string[] = [];
  tokenizeTests(pendingTests).forEach((n) => { if (!names.some((x) => norm(x) === norm(n))) names.push(n); });
  const { order, deptToItems } = splitByDepartment(names, (x) => x, dicts);

  const unmatched: { name: string; attachedTo: SliceDept }[] = [];
  const slices = order.map((dept) => {
    deptToItems[dept]!.forEach((n) => {
      if (matchDeptKeyword(n, dicts).department === "Unclassified" && !dicts.ignored.includes(norm(n))) unmatched.push({ name: n, attachedTo: dept });
    });
    return {
      id: rNumber + "__" + dept, rNumber, patientId, clientRaw, department: dept,
      pendingNames: deptToItems[dept]!, reportDate: fmtDisplay(earliest), reportDateTime: earliest.toISOString(),
    };
  });
  return { slices, unmatched };
}

export function parseMText(rawText: string, dicts: Dicts): ParseResult {
  const result: ParseResult = { slices: [], skipped: [], unmatched: {} };
  if (!rawText || !rawText.trim()) return result;
  const lines = cleanText(rawText).split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (/\(R#\d+\)/.test(line)) {
      if (current.length) blocks.push(current.join("\n"));
      current = [line];
    } else if (line.includes("(Continued)") && !current.length && blocks.length) {
      const last = blocks.pop()!;
      blocks.push(last + "\n" + line.replace(/.*\(Continued\)/, "").trim());
    } else if (current.length) {
      current.push(line);
    }
  }
  if (current.length) blocks.push(current.join("\n"));

  for (const block of blocks) {
    const r = processCaseBlock(block, dicts);
    if (!r) continue;
    if ("skip" in r) { result.skipped.push(r.skip); continue; }
    result.slices.push(...r.slices);
    r.unmatched.forEach((u) => {
      const k = norm(u.name);
      const e = result.unmatched[k] || (result.unmatched[k] = { name: u.name, count: 0, attachedTo: u.attachedTo });
      e.count++;
      e.attachedTo = u.attachedTo;
    });
  }

  // The same requisition can be printed as more than one block: combine them.
  const byId: Record<string, ParsedSlice> = {};
  const order: string[] = [];
  result.slices.forEach((s) => {
    const e = byId[s.id];
    if (e) {
      s.pendingNames.forEach((n) => { if (!e.pendingNames.some((x) => norm(x) === norm(n))) e.pendingNames.push(n); });
      if (new Date(s.reportDateTime) < new Date(e.reportDateTime)) { e.reportDateTime = s.reportDateTime; e.reportDate = s.reportDate; }
    } else {
      byId[s.id] = { ...s, pendingNames: [...s.pendingNames] };
      order.push(s.id);
    }
  });
  result.slices = order.map((id) => byId[id]);
  return result;
}

/* ---------------- tracked model ---------------- */
export function refreshSlice(s: Omit<Slice, "pair" | "isAlist" | "clientDisplay" | "status" | "pendingTests" | "lastSeen" | "dateAdded" | "completedAt"> & Partial<Slice>, dicts: Dicts): Slice {
  const a = classifyAlist(s.clientRaw, dicts);
  const pending = s.tests.filter((t) => t.status !== "Completed");
  const status: TestStatus = pending.length ? "Pending" : "Completed";
  return {
    ...(s as Slice),
    pair: pairForDept(s.department),
    isAlist: a.isAlist,
    clientDisplay: a.displayName || s.clientRaw || "(unknown)",
    status,
    pendingTests: (pending.length ? pending : s.tests).map((t) => t.name).join(", "),
    lastSeen: maxIso(s.tests.map((t) => t.lastSeen)),
    dateAdded: minIso(s.tests.map((t) => t.firstSeen)),
    completedAt: status === "Completed" ? maxIso(s.tests.map((t) => t.completedAt)) : null,
  };
}

export interface ReqRow { r_number: string; patient_id: string; client_raw: string; report_date: string | null; report_at: string }
export interface TestRow { id: number; r_number: string; name: string; seq: number; status: TestStatus; first_seen: string; last_seen: string; completed_at: string | null }

// Department split is worked out at load time from the current dictionary,
// so editing the dictionary never rewrites stored data.
export function buildSlices(reqs: ReqRow[], tests: TestRow[], dicts: Dicts): Slice[] {
  const byR: Record<string, TestRow[]> = {};
  tests.forEach((t) => { (byR[t.r_number] = byR[t.r_number] || []).push(t); });
  const out: Slice[] = [];
  reqs.forEach((q) => {
    const ts: TrackedTest[] = (byR[q.r_number] || [])
      .sort((a, b) => a.seq - b.seq || a.id - b.id)
      .map((t) => ({ name: t.name, status: t.status, firstSeen: t.first_seen, lastSeen: t.last_seen, completedAt: t.completed_at }));
    if (!ts.length) return;
    const { order, deptToItems } = splitByDepartment(ts, (t) => t.name, dicts);
    order.forEach((dept) => out.push(refreshSlice({
      id: q.r_number + "__" + dept, rNumber: q.r_number, patientId: q.patient_id, clientRaw: q.client_raw,
      department: dept, tests: deptToItems[dept]!, reportDate: q.report_date || fmtIso(q.report_at), reportDateTime: q.report_at,
    }, dicts)));
  });
  return out;
}

// Old (rev 11) browser records had no per-test list.
export function migrateCase(c: any): any {
  if (Array.isArray(c.tests)) return c;
  const done = c.status === "Completed";
  const tests = tokenizeTests(c.pendingTests).map((name) => ({
    name, status: done ? "Completed" : "Pending", firstSeen: c.dateAdded || c.lastSeen,
    lastSeen: c.lastSeen || c.dateAdded, completedAt: done ? c.completedAt : null,
  }));
  return { ...c, tests: tests.length ? tests : [{ name: c.pendingTests || "(unknown)", status: done ? "Completed" : "Pending",
    firstSeen: c.dateAdded, lastSeen: c.lastSeen, completedAt: done ? c.completedAt : null }] };
}

export interface PastePlan {
  newSlices: number; stillOpen: number; reopened: number; partialTests: number;
  completedSlices: number; completedList: string[]; prevOpen: number;
}

// Preview only: what a paste would change, compared with what's loaded now.
export function planPaste(base: Slice[], parsed: ParsedSlice[], mode: "full" | "partial"): PastePlan {
  const byId = new Map(base.map((c) => [c.id, c]));
  const plan: PastePlan = { newSlices: 0, stillOpen: 0, reopened: 0, partialTests: 0, completedSlices: 0, completedList: [],
    prevOpen: base.filter((c) => c.status !== "Completed").length };
  const seen = new Set<string>();
  parsed.forEach((p) => {
    seen.add(p.id);
    const s = byId.get(p.id);
    if (!s) { plan.newSlices++; return; }
    if (s.status === "Completed") plan.reopened++; else plan.stillOpen++;
    if (mode === "full") {
      const pend = new Set(p.pendingNames.map(norm));
      s.tests.forEach((t) => { if (t.status !== "Completed" && !pend.has(norm(t.name))) plan.partialTests++; });
    }
  });
  if (mode === "full") {
    base.forEach((s) => {
      if (seen.has(s.id) || s.status === "Completed") return;
      plan.completedSlices++;
      plan.completedList.push(`${s.patientId} ${s.department}`);
    });
  }
  return plan;
}

/* ---------------- timing verdicts ----------------
   An item that dropped off the list finished between lastSeen (last paste it
   was pending) and completedAt (first paste it was gone). */
export type VerdictKind = "ontime" | "late" | "unclear" | "overdue" | "open";
export interface Verdict { kind: VerdictKind; min: number; max: number }

export function verdict(item: { status: TestStatus; lastSeen: string | null; completedAt: string | null }, dueMs: number, nowMs: number): Verdict {
  if (item.status !== "Completed") {
    const m = (nowMs - dueMs) / 60000;
    return m > 0 ? { kind: "overdue", min: m, max: m } : { kind: "open", min: m, max: m };
  }
  const lo = item.lastSeen ? new Date(item.lastSeen).getTime() : NaN;
  const hi = item.completedAt ? new Date(item.completedAt).getTime() : NaN;
  if (!isFinite(hi) || hi <= dueMs) return { kind: "ontime", min: 0, max: 0 };
  if (!isFinite(lo) || lo >= dueMs) return { kind: "late", min: Math.max(0, (lo - dueMs) / 60000) || 0, max: (hi - dueMs) / 60000 };
  return { kind: "unclear", min: 0, max: (hi - dueMs) / 60000 };
}

export const tatMs = (c: Slice) => new Date(c.reportDateTime).getTime();
export const rangeText = (min: number, max: number) =>
  Math.abs(max - min) < 5 ? formatMinutes(max) : `${formatMinutes(min)} – ${formatMinutes(max)}`;

export function expandCommaKeywords<T extends { keyword: string }>(list: T[]): T[] {
  const out: T[] = [];
  list.forEach((row) => {
    if (!row.keyword) return;
    row.keyword.split(",").map((k) => k.trim()).filter(Boolean).forEach((p) => out.push({ ...row, keyword: p }));
  });
  return out;
}
