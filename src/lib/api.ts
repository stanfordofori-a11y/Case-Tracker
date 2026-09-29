import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AlistKeyword, DeptKeyword, ParseResult, ReqRow, TestRow } from "./tracker";

// Connection settings. Render can override these with environment variables
// VITE_SUPABASE_URL / VITE_SUPABASE_KEY; otherwise the values below are used.
// The publishable key is safe in the browser: every table has Row Level
// Security and all writes are checked server-side.
export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL || "https://bpymvpuuhrdhreghdofq.supabase.co";
export const SUPABASE_KEY: string = import.meta.env.VITE_SUPABASE_KEY || "sb_publishable_icdvdRX4J6rm3dQacvE4Nw_iJkraGQ_";
export const STAFF_FUNCTION = "manage-staff";

export const configOk = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(SUPABASE_URL);
export const sb: SupabaseClient | null = configOk ? createClient(SUPABASE_URL.replace(/\/$/, ""), SUPABASE_KEY) : null;

export type Role = "staff" | "admin" | "courier";
export interface Me { email: string; display_name: string | null; role: Role; active: boolean }
export interface PasteRow { id: number; at: string; mode: "full" | "partial"; by_email: string; locked: boolean; undone_at: string | null }
export interface Settings { graceStd: number; graceAlist: number; archiveDays: number }
export interface Unmatched { name: string; count: number; attachedTo: string | null }
export interface StaffRow { email: string; display_name: string | null; role: Role; active: boolean; last_sign_in_at: string | null; has_login: boolean }

export interface Snapshot {
  reqs: ReqRow[];
  tests: TestRow[];
  alist: AlistKeyword[];
  dept: DeptKeyword[];
  ignored: string[];
  unmatched: Record<string, Unmatched>;
  settings: Settings;
  pastes: PasteRow[]; // not undone, newest first
  loadedAt: Date;
}

function client(): SupabaseClient {
  if (!sb) throw new Error("Not connected to Supabase");
  return sb;
}

async function call<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

// PostgREST returns at most 1000 rows per request, so read in pages.
async function fetchAll<T>(table: string, columns: string, orderCol: string): Promise<T[]> {
  const out: T[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await client().from(table).select(columns).order(orderCol, { ascending: true }).range(from, from + size - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data as T[]));
    if (!data || data.length < size) break;
  }
  return out;
}

export async function loadSnapshot(): Promise<Snapshot> {
  const [reqs, tests, alist, dept, ign, unm, st, pastes] = await Promise.all([
    fetchAll<ReqRow>("requisitions", "r_number,patient_id,client_raw,report_date,report_at", "r_number"),
    fetchAll<TestRow>("requisition_tests", "id,r_number,name,seq,status,first_seen,last_seen,completed_at", "id"),
    fetchAll<{ keyword: string; display_name: string }>("alist_keywords", "keyword,display_name,sort", "sort"),
    fetchAll<{ keyword: string; department: DeptKeyword["department"] }>("dept_keywords", "keyword,department,sort", "sort"),
    fetchAll<{ name_norm: string }>("ignored_tokens", "name_norm", "name_norm"),
    fetchAll<{ name_norm: string; name: string; count: number; attached_to: string | null }>("unmatched_tokens", "name_norm,name,count,attached_to", "name_norm"),
    call(client().from("app_settings").select("*").eq("id", 1).maybeSingle(), "settings"),
    call(client().from("pastes").select("id,at,mode,by_email,locked,undone_at").order("id", { ascending: false }).limit(1000), "pastes"),
  ]);
  const unmatched: Record<string, Unmatched> = {};
  unm.forEach((u) => { unmatched[u.name_norm] = { name: u.name, count: u.count, attachedTo: u.attached_to }; });
  const s = st as { grace_std: number; grace_alist: number; archive_days: number } | null;
  return {
    reqs, tests,
    alist: alist.map((r) => ({ keyword: r.keyword, displayName: r.display_name })),
    dept: dept.map((r) => ({ keyword: r.keyword, department: r.department })),
    ignored: ign.map((r) => r.name_norm),
    unmatched,
    settings: s ? { graceStd: s.grace_std, graceAlist: s.grace_alist, archiveDays: s.archive_days } : { graceStd: 0, graceAlist: 0, archiveDays: 30 },
    pastes: ((pastes as PasteRow[]) || []).filter((p) => !p.undone_at),
    loadedAt: new Date(),
  };
}

export function subscribeLive(onChange: () => void, onStatus: (live: boolean) => void) {
  const ch = client()
    .channel("tracker-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "requisition_tests" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "requisitions" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "pastes" }, onChange)
    .subscribe((status) => onStatus(status === "SUBSCRIBED"));
  return () => { client().removeChannel(ch); };
}

/* ---------- writes (all checked server-side) ---------- */
export async function applyPaste(mode: "full" | "partial", parsed: ParseResult) {
  const byR: Record<string, { r_number: string; patient_id: string; client_raw: string; report_date: string; report_at: string; tests: string[] }> = {};
  const order: string[] = [];
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toUpperCase();
  parsed.slices.forEach((s) => {
    let g = byR[s.rNumber];
    if (!g) {
      g = byR[s.rNumber] = { r_number: s.rNumber, patient_id: s.patientId, client_raw: s.clientRaw, report_date: s.reportDate, report_at: s.reportDateTime, tests: [] };
      order.push(s.rNumber);
    }
    if (new Date(s.reportDateTime) < new Date(g.report_at)) { g.report_at = s.reportDateTime; g.report_date = s.reportDate; }
    s.pendingNames.forEach((n) => { if (!g.tests.some((x) => norm(x) === norm(n))) g.tests.push(n); });
  });
  const unmatched = Object.values(parsed.unmatched).map((u) => ({ name: u.name, count: u.count, attached_to: u.attachedTo }));
  return call(client().rpc("apply_paste", { p_mode: mode, p_items: order.map((r) => byR[r]), p_unmatched: unmatched }), "Saving paste");
}

export const undoLastPaste = () => call(client().rpc("undo_last_paste"), "Undo");
export const clearAllCases = () => call(client().rpc("clear_all_cases"), "Clear all");
export const addTokenToDept = (name: string, department: string) => call(client().rpc("add_token_to_dept", { p_name: name, p_department: department }), "Adding keyword");
export const ignoreToken = (name: string) => call(client().rpc("ignore_token", { p_name: name }), "Ignoring name");
export const saveSettings = (s: Settings) =>
  call(client().rpc("save_settings", { p_grace_std: s.graceStd, p_grace_alist: s.graceAlist, p_archive_days: s.archiveDays }), "Saving settings");
export const replaceAlist = (rows: AlistKeyword[]) =>
  call(client().rpc("replace_keywords", { p_kind: "alist", p_rows: rows.map((r) => ({ keyword: r.keyword, display_name: r.displayName || "" })) }), "Saving A-List");
export const replaceDept = (rows: DeptKeyword[]) =>
  call(client().rpc("replace_keywords", { p_kind: "dept", p_rows: rows.map((r) => ({ keyword: r.keyword, department: r.department })) }), "Saving departments");
export const archiveCompleted = (days: number) =>
  call(client().rpc("archive_completed", { p_days: days }), "Archive") as Promise<{ count: number; requisitions: unknown[] }>;
export const importRequisitions = (reqs: unknown[]) =>
  call(client().rpc("import_requisitions", { p_reqs: reqs }), "Import") as Promise<{ requisitions: number; tests: number }>;

/* ---------- staff Edge Function ---------- */
export async function staffFn<T = any>(payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await client().functions.invoke(STAFF_FUNCTION, { body: payload });
  if (error) {
    let msg = error.message || "Request failed";
    try { const j = await (error as any).context.json(); if (j?.error) msg = j.error; } catch { /* keep generic message */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

/* ---------- auth ---------- */
export async function currentStaff(): Promise<Me | { error: string } | null> {
  const { data: { user } } = await client().auth.getUser();
  if (!user) return null;
  const email = (user.email || "").toLowerCase();
  const { data, error } = await client().from("staff").select("email,display_name,role,active").eq("email", email).maybeSingle();
  if (error) return { error: "Could not check your access: " + error.message };
  if (!data || !data.active) return { error: "This login is not on the staff list, or has been deactivated. Ask an admin." };
  return data as Me;
}

export const signIn = (email: string, password: string) => client().auth.signInWithPassword({ email, password });
export const signOut = () => client().auth.signOut();
export const changePassword = (password: string) => client().auth.updateUser({ password });
export const getSession = () => client().auth.getSession();

/* ---------- sample transport (courier -> pre-analytical) ---------- */
export interface Centre { id: number; name: string; active: boolean }
export interface CourierRun { id: number; courier_email: string; centre_id: number; started_at: string; handed_over_at: string | null }
export interface SampleRow {
  id: number; barcode: string; barcode_raw: string | null; r_number: string | null; run_id: number | null; centre_id: number | null;
  collected_by: string | null; collected_at: string | null; photo_path: string | null; photo_deleted_at: string | null;
  received_by: string | null; received_at: string | null; source: "courier" | "reception";
}
export interface TransportSettings { photoRetentionDays: number; transitAlertMinutes: number }
export interface ReceiveResult {
  result: "received" | "already_received" | "not_logged_by_courier";
  sample_id: number; barcode: string; r_number: string | null; centre?: string | null; collected_by?: string | null;
  collected_at?: string | null; received_at: string; received_by?: string; transit_minutes?: number;
}
const SAMPLE_COLS = "id,barcode,barcode_raw,r_number,run_id,centre_id,collected_by,collected_at,photo_path,photo_deleted_at,received_by,received_at,source";

export const loadCentres = () =>
  call(client().from("centres").select("id,name,active").order("name"), "Centres") as Promise<Centre[]>;

export async function loadTransportSettings(): Promise<TransportSettings> {
  const s = await call(client().from("app_settings").select("photo_retention_days,transit_alert_minutes").eq("id", 1).maybeSingle(), "Settings") as any;
  return { photoRetentionDays: s?.photo_retention_days ?? 14, transitAlertMinutes: s?.transit_alert_minutes ?? 180 };
}

/** Everything still in transit, plus anything collected or received in the last `hours`. */
export async function loadTransport(hours = 36) {
  const since = new Date(Date.now() - hours * 3600e3).toISOString();
  const [samples, runs, centres, settings] = await Promise.all([
    call(client().from("samples").select(SAMPLE_COLS)
      .or(`received_at.is.null,collected_at.gte.${since},received_at.gte.${since}`).order("id", { ascending: false }).limit(3000), "Samples"),
    call(client().from("courier_runs").select("*").or(`handed_over_at.is.null,started_at.gte.${since}`).order("id", { ascending: false }).limit(500), "Runs"),
    loadCentres(),
    loadTransportSettings(),
  ]);
  return { samples: samples as SampleRow[], runs: runs as CourierRun[], centres, settings };
}

export const samplesForRequisition = (r: string) =>
  call(client().from("samples").select(SAMPLE_COLS).eq("r_number", r).order("id"), "Samples") as Promise<SampleRow[]>;

export async function myOpenRun(email: string) {
  const runs = await call(client().from("courier_runs").select("*").eq("courier_email", email).order("id", { ascending: false }).limit(15), "Runs") as CourierRun[];
  const ids = runs.map((r) => r.id);
  const samples = ids.length
    ? await call(client().from("samples").select(SAMPLE_COLS).in("run_id", ids).order("id", { ascending: false }), "Samples") as SampleRow[]
    : [];
  return { runs, samples };
}

export const startRun = (centreId: number) => call(client().rpc("courier_start_run", { p_centre_id: centreId }), "Starting collection") as Promise<number>;
export const logSamples = (runId: number, barcodes: string[], photoPath: string | null) =>
  call(client().rpc("courier_log_samples", { p_run_id: runId, p_barcodes: barcodes, p_photo_path: photoPath }), "Logging samples") as
    Promise<{ barcode: string; r_number: string | null; result: "logged" | "already_in_this_run" | "already_in_transit"; sample_id: number }[]>;
export const removeSample = (id: number) => call(client().rpc("courier_remove_sample", { p_sample_id: id }), "Removing sample");
export const handOver = (runId: number) => call(client().rpc("courier_hand_over", { p_run_id: runId }), "Handing over");
export const receiveSample = (barcode: string) => call(client().rpc("receive_sample", { p_barcode: barcode }), "Receiving") as Promise<ReceiveResult>;
export const undoReceive = (id: number) => call(client().rpc("undo_receive", { p_sample_id: id }), "Undo receipt");
export const saveCentre = (id: number | null, name: string, active: boolean) =>
  call(client().rpc("save_centre", { p_id: id, p_name: name, p_active: active }), "Saving centre");
export const saveTransportSettings = (s: TransportSettings) =>
  call(client().rpc("save_transport_settings", { p_photo_retention_days: s.photoRetentionDays, p_transit_alert_minutes: s.transitAlertMinutes }), "Saving settings");

/** Photos go in date folders (UTC) so old ones can be deleted a whole day at a time. */
export async function uploadSamplePhoto(blob: Blob): Promise<string> {
  const id = (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const path = `${new Date().toISOString().slice(0, 10)}/${id}.jpg`;
  const { error } = await client().storage.from("sample-photos").upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (error) throw new Error(`Uploading photo: ${error.message}`);
  return path;
}
export async function samplePhotoUrl(path: string): Promise<string> {
  const { data, error } = await client().storage.from("sample-photos").createSignedUrl(path, 600);
  if (error) throw new Error(`Opening photo: ${error.message}`);
  return data.signedUrl;
}

export function subscribeTransport(onChange: () => void) {
  const ch = client().channel("transport-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "samples" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "courier_runs" }, onChange)
    .subscribe();
  return () => { client().removeChannel(ch); };
}

/** Delete expired courier photos. Runs at most every 6 hours per computer. */
export function maybePurgePhotos() {
  try {
    const last = Number(localStorage.getItem("pat-photo-purge") || 0);
    if (Date.now() - last < 6 * 3600e3) return;
    localStorage.setItem("pat-photo-purge", String(Date.now()));
  } catch { /* ignore */ }
  staffFn({ action: "purge_photos" }).catch(() => { /* try again next time */ });
}
