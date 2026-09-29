// =====================================================================
// Supabase Edge Function: manage-staff
// Lets an ADMIN of the Post-Analytical Tracker manage staff from the app.
// Before anyone exists, it also handles one-time first-admin setup:
//   setup_status    -> { needs_setup: true } while the staff list is empty (no login needed)
//   setup_first_admin -> creates the first admin; needs the SETUP_CODE secret; works only once
// Admin-only actions:
//   list            -> staff list with last sign-in
//   create          -> new login (email + password, auto-confirmed) + staff row
//   reset_password  -> set a new password for someone
//   set_active      -> deactivate / reactivate (deactivated users are also blocked from signing in)
//   set_role        -> make someone 'admin' or 'staff'
//
// The secret (service role) key never leaves Supabase: it is read from the
// function's built-in environment. Every request is checked against the
// caller's own login and the public.staff table before anything happens.
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// Works with both the legacy service_role key and Supabase's newer secret keys.
function getSecretKey(): string | undefined {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const single = Deno.env.get("SUPABASE_SECRET_KEY");
  if (single) return single;
  const many = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (many) {
    try {
      const parsed = JSON.parse(many);
      if (typeof parsed === "string") return parsed;
      if (Array.isArray(parsed)) return parsed.find((k) => typeof k === "string") ?? parsed[0]?.api_key;
      if (parsed && typeof parsed === "object") {
        return parsed.default ?? Object.values(parsed).find((v) => typeof v === "string") as string | undefined;
      }
    } catch {
      if (many.startsWith("sb_secret_")) return many;
    }
  }
  return undefined;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = ["staff", "admin", "courier"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = getSecretKey();
  if (!url || !serviceKey) return json({ error: "Function is missing its Supabase settings" }, 500);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid request" }, 400); }
  const action = String(body.action ?? "");

  // ---- one-time first-admin setup (no login needed, closes itself once anyone is on the staff list) ----
  if (action === "setup_status") {
    const { data, error } = await admin.rpc("staff_is_empty");
    if (error) return json({ error: "Database setup incomplete: run 3_first_admin_setup.sql" }, 500);
    return json({ needs_setup: data === true });
  }

  if (action === "setup_first_admin") {
    const setupCode = Deno.env.get("SETUP_CODE") ?? "";
    if (setupCode.length < 8) return json({ error: "Setup is not enabled: add a SETUP_CODE secret (8+ characters) to Edge Functions first" }, 403);
    if (String(body.setup_code ?? "") !== setupCode) {
      await new Promise((r) => setTimeout(r, 1500)); // slow down guessing
      return json({ error: "Wrong setup code" }, 403);
    }
    const { data: empty } = await admin.rpc("staff_is_empty");
    if (empty !== true) return json({ error: "Setup has already been completed. Sign in instead." }, 409);

    const e = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const displayName = String(body.display_name ?? "").trim();
    if (!EMAIL_RE.test(e)) return json({ error: "Enter a valid email address" }, 400);
    if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);

    let createdId: string | null = null;
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: e, password, email_confirm: true, user_metadata: { display_name: displayName || null },
    });
    if (createErr) {
      if (!/already|registered|exists/i.test(createErr.message)) return json({ error: createErr.message }, 500);
      // A login already exists for this email (e.g. made in the dashboard): set the chosen password on it.
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const existing = list?.users.find((u) => u.email?.toLowerCase() === e);
      if (existing) await admin.auth.admin.updateUserById(existing.id, { password, email_confirm: true });
    } else {
      createdId = created.user?.id ?? null;
    }

    const { data: claimed, error: claimErr } = await admin.rpc("claim_first_admin", { p_email: e, p_display_name: displayName });
    if (claimErr || claimed !== true) {
      if (createdId) await admin.auth.admin.deleteUser(createdId);
      return json({ error: claimErr ? claimErr.message : "Setup has already been completed. Sign in instead." }, 409);
    }
    return json({ ok: true, email: e, message: "Admin account created. You can sign in now." });
  }

  // ---- who is calling? ----
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Not signed in" }, 401);
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  const callerEmail = userData?.user?.email?.toLowerCase();
  if (userErr || !callerEmail) return json({ error: "Your session has expired. Sign in again." }, 401);

  const { data: me } = await admin.from("staff").select("role, active").eq("email", callerEmail).maybeSingle();

  // ---- delete courier photos older than the retention period (any lab staff may trigger; it's idempotent) ----
  if (action === "purge_photos") {
    if (!me || !me.active || !["staff", "admin"].includes(me.role)) return json({ error: "Not allowed" }, 403);
    const { data: st } = await admin.from("app_settings").select("photo_retention_days").eq("id", 1).maybeSingle();
    const days = Math.max(1, Number(st?.photo_retention_days) || 14);
    const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10); // YYYY-MM-DD
    const bucket = admin.storage.from("sample-photos");
    const { data: folders, error: listErr } = await bucket.list("", { limit: 1000 });
    if (listErr) return json({ error: listErr.message }, 500);
    let removed = 0;
    for (const f of folders ?? []) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.name) || f.name >= cutoff) continue; // photos are stored as YYYY-MM-DD/<id>.jpg
      for (;;) {
        const { data: files } = await bucket.list(f.name, { limit: 1000 });
        const paths = (files ?? []).filter((x) => x.id).map((x) => `${f.name}/${x.name}`);
        if (!paths.length) break;
        const { error: rmErr } = await bucket.remove(paths);
        if (rmErr) return json({ error: rmErr.message }, 500);
        removed += paths.length;
        if (paths.length < 1000) break;
      }
      await admin.from("samples").update({ photo_deleted_at: new Date().toISOString() })
        .like("photo_path", `${f.name}/%`).is("photo_deleted_at", null);
    }
    return json({ ok: true, removed, retention_days: days });
  }

  if (!me || !me.active || me.role !== "admin") return json({ error: "Only admins can manage staff" }, 403);

  // ---- admin actions ----
  const email = String(body.email ?? "").trim().toLowerCase();

  const log = (what: string, detail: Record<string, unknown>) =>
    admin.from("activity_log").insert({ by_email: callerEmail, action: what, detail });

  async function findUserId(e: string): Promise<string | null> {
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw error;
      const hit = data.users.find((u) => u.email?.toLowerCase() === e);
      if (hit) return hit.id;
      if (data.users.length < 1000) return null;
    }
    return null;
  }

  try {
    if (action === "list") {
      const { data: staff, error } = await admin.from("staff").select("*").order("role").order("email");
      if (error) throw error;
      const lastSignIn: Record<string, string | null> = {};
      const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      users?.users.forEach((u) => { if (u.email) lastSignIn[u.email.toLowerCase()] = u.last_sign_in_at ?? null; });
      return json({ staff: (staff ?? []).map((s) => ({ ...s, last_sign_in_at: lastSignIn[s.email] ?? null, has_login: s.email in lastSignIn })) });
    }

    if (!EMAIL_RE.test(email)) return json({ error: "Enter a valid email address" }, 400);

    if (action === "create") {
      const password = String(body.password ?? "");
      const role = String(body.role ?? "staff");
      const displayName = String(body.display_name ?? "").trim() || null;
      if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
      if (!ROLES.includes(role)) return json({ error: "Role must be staff, admin or courier" }, 400);

      let createdId: string | null = null;
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { display_name: displayName },
      });
      if (createErr) {
        // Login already exists (e.g. made in the dashboard): just make sure they're on the staff list.
        if (!/already|registered|exists/i.test(createErr.message)) throw createErr;
      } else {
        createdId = created.user?.id ?? null;
      }

      const { error: staffErr } = await admin.from("staff")
        .upsert({ email, display_name: displayName, role, active: true }, { onConflict: "email" });
      if (staffErr) {
        if (createdId) await admin.auth.admin.deleteUser(createdId); // don't leave a half-made account
        throw staffErr;
      }
      await log("staff_create", { email, role, login_created: !!createdId });
      return json({ ok: true, email, login_created: !!createdId,
        message: createdId ? "Account created" : "A login already existed for this email; added to the staff list (password unchanged)" });
    }

    if (action === "reset_password") {
      const password = String(body.password ?? "");
      if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
      const id = await findUserId(email);
      if (!id) return json({ error: "No login found for that email" }, 404);
      const { error } = await admin.auth.admin.updateUserById(id, { password });
      if (error) throw error;
      await log("staff_reset_password", { email });
      return json({ ok: true });
    }

    if (action === "set_active") {
      const active = body.active === true;
      if (email === callerEmail && !active) return json({ error: "You can't deactivate your own account" }, 400);
      const { error } = await admin.from("staff").update({ active }).eq("email", email);
      if (error) throw error;
      const id = await findUserId(email);
      if (id) await admin.auth.admin.updateUserById(id, { ban_duration: active ? "none" : "876000h" });
      await log(active ? "staff_reactivate" : "staff_deactivate", { email });
      return json({ ok: true });
    }

    if (action === "set_role") {
      const role = String(body.role ?? "");
      if (!ROLES.includes(role)) return json({ error: "Role must be staff, admin or courier" }, 400);
      if (email === callerEmail && role !== "admin") return json({ error: "You can't remove your own admin rights" }, 400);
      const { error } = await admin.from("staff").update({ role }).eq("email", email);
      if (error) throw error;
      await log("staff_set_role", { email, role });
      return json({ ok: true });
    }

    return json({ error: `Unknown action "${action}"` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
});
