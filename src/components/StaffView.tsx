import { useEffect, useState } from "react";
import { STAFF_FUNCTION, staffFn, type Me, type Role, type StaffRow } from "../lib/api";
import { fmtIso } from "../lib/tracker";
import { Badge, Button, C, Field, Note, Panel, inputBase, inputCls } from "./ui";

export function suggestPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const arr = new Uint32Array(10);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => chars[n % chars.length]).join("");
}

export default function StaffView({ me }: { me: Me }) {
  const [list, setList] = useState<StaffRow[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "staff" as Role });
  const [busy, setBusy] = useState(false);

  async function load() {
    try { const d = await staffFn<{ staff: StaffRow[] }>({ action: "list" }); setList(d.staff || []); setLoadErr(null); }
    catch (e: any) { setLoadErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function act(payload: Record<string, unknown>, ok: string) {
    try { await staffFn(payload); setMsg({ text: ok, tone: "ok" }); await load(); }
    catch (e: any) { setMsg({ text: e.message, tone: "err" }); await load(); }
  }

  async function add() {
    const email = form.email.trim().toLowerCase();
    if (!form.name.trim() || !email) return setMsg({ text: "Enter a name and an email.", tone: "err" });
    if (form.password.length < 8) return setMsg({ text: "The starting password must be at least 8 characters.", tone: "err" });
    setBusy(true);
    try {
      const res = await staffFn<{ login_created: boolean; message?: string }>({ action: "create", email, password: form.password, display_name: form.name.trim(), role: form.role });
      setMsg({ tone: "ok", text: res.login_created
        ? `${form.name.trim()} can now sign in as ${email} with the password you set. Ask them to change it from the menu after signing in.`
        : res.message || "Added to the staff list." });
      setForm({ name: "", email: "", password: "", role: "staff" });
      await load();
    } catch (e: any) { setMsg({ text: e.message, tone: "err" }); }
    finally { setBusy(false); }
  }

  function resetPassword(email: string) {
    const password = prompt(`New password for ${email} (8+ characters). A random one is filled in; you can type your own.`, suggestPassword());
    if (password === null) return;
    if (password.length < 8) return setMsg({ text: "Password must be at least 8 characters.", tone: "err" });
    act({ action: "reset_password", email, password }, `Password for ${email} is now: ${password}. Give it to them privately.`);
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Panel title="Add a staff member">
        <div className="grid md:grid-cols-[1.1fr_1.4fr_1.3fr_auto] gap-3 items-end">
          <Field label="Name"><input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="off" /></Field>
          <Field label="Email"><input className={inputCls} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="off" /></Field>
          <Field label="Starting password">
            <span className="flex gap-1.5">
              <input className={inputCls} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="off" />
              <Button type="button" onClick={() => setForm({ ...form, password: suggestPassword() })}>Suggest</Button>
            </span>
          </Field>
          <Field label="Role">
            <select className={inputCls} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              <option value="staff">Staff</option><option value="admin">Admin</option>
            </select>
          </Field>
        </div>
        <Button tone="primary" disabled={busy} onClick={add}>{busy ? "Adding…" : "Add staff member"}</Button>
        <p className="text-xs text-ink-3 mt-3">Staff can paste lists, undo, run reports and edit the dictionaries. Admins can also manage staff, import, archive and clear.</p>
      </Panel>

      {msg && <Note tone={msg.tone}>{msg.text}</Note>}

      <Panel title="Staff accounts" action={<Button tone="quiet" onClick={load}>Refresh</Button>}>
        {loadErr && <Note tone="err">Couldn't load staff: {loadErr}. Check that the {STAFF_FUNCTION} Edge Function is deployed.</Note>}
        {!list && !loadErr && <p className="text-xs text-ink-3">Loading staff…</p>}
        {list && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left num text-ink-3">
                {["Name", "Email", "Role", "Status", "Last sign-in", ""].map((h) => <th key={h} className="py-2 pr-3 font-medium border-b" style={{ borderColor: C.line }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {list.map((s) => {
                  const self = s.email === me.email;
                  return (
                    <tr key={s.email} className="border-b text-ink" style={{ borderColor: C.line, opacity: s.active ? 1 : 0.55 }}>
                      <td className="py-2 pr-3 ">{s.display_name}{self && <span className="text-ink-3"> (you)</span>}</td>
                      <td className="py-2 pr-3 num">{s.email}</td>
                      <td className="py-2 pr-3">
                        <select className={`${inputBase} w-auto`} value={s.role} disabled={self} aria-label={`Role for ${s.email}`}
                          onChange={(e) => {
                            const role = e.target.value as Role;
                            if (confirm(`Make ${s.email} ${role === "admin" ? "an admin (can manage staff, import, archive and clear)" : "regular staff"}?`)) act({ action: "set_role", email: s.email, role }, `${s.email} is now ${role}.`);
                            else load();
                          }}>
                          <option value="staff">Staff</option><option value="admin">Admin</option>
                        </select>
                      </td>
                      <td className="py-2 pr-3">{s.active ? <Badge color={C.success}>Active</Badge> : <Badge color={C.ink3}>Deactivated</Badge>}</td>
                      <td className="py-2 pr-3 num">{s.last_sign_in_at ? fmtIso(s.last_sign_in_at) : s.has_login ? "Never" : "No login"}</td>
                      <td className="py-2 whitespace-nowrap text-right">
                        <Button tone="quiet" onClick={() => resetPassword(s.email)}>Reset password</Button>
                        {!self && (
                          <Button tone={s.active ? "danger" : "ghost"} className="ml-1" onClick={() => {
                            if (confirm(s.active ? `Deactivate ${s.email}? They'll be signed out and blocked. Their past work stays in the records.` : `Reactivate ${s.email}?`))
                              act({ action: "set_active", email: s.email, active: !s.active }, `${s.email} ${s.active ? "deactivated" : "reactivated"}.`);
                          }}>{s.active ? "Deactivate" : "Reactivate"}</Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
