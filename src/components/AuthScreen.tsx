import { useState } from "react";
import { signIn, staffFn } from "../lib/api";
import { Button, Field, Logo, Note, inputCls } from "./ui";

export type AuthMode = "login" | "setup" | "config";

export default function AuthScreen({ mode, message, messageTone = "err", onSignedIn, onModeChange }: {
  mode: AuthMode;
  message?: string | null;
  messageTone?: "err" | "ok";
  onSignedIn: () => void;
  onModeChange: (m: AuthMode, msg?: string, tone?: "err" | "ok") => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({ name: "", email: "", password: "", password2: "", code: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function login() {
    const email = f.email.trim().toLowerCase();
    if (!email || !f.password) return;
    setBusy(true); setErr(null);
    const { error } = await signIn(email, f.password);
    setBusy(false);
    if (error) {
      setErr(/invalid login/i.test(error.message) ? "Wrong email or password."
        : /banned/i.test(error.message) ? "This account has been deactivated. Ask an admin." : error.message);
      return;
    }
    onSignedIn();
  }

  async function setup() {
    const email = f.email.trim().toLowerCase();
    if (!f.name.trim() || !email) return setErr("Enter your name and email.");
    if (f.password.length < 8) return setErr("Password must be at least 8 characters.");
    if (f.password !== f.password2) return setErr("The two passwords don't match.");
    setBusy(true); setErr(null);
    try {
      await staffFn({ action: "setup_first_admin", email, password: f.password, display_name: f.name.trim(), setup_code: f.code });
    } catch (e: any) {
      setBusy(false);
      if (/already been completed/i.test(e.message)) return onModeChange("login", "Setup was already completed. Sign in instead.");
      return setErr(e.message);
    }
    const { error } = await signIn(email, f.password);
    setBusy(false);
    if (error) return onModeChange("login", "Admin account created. Sign in to continue.", "ok");
    onSignedIn();
  }

  const submit = mode === "setup" ? setup : login;
  const onKey = (e: React.KeyboardEvent) => { if (e.key === "Enter") submit(); };

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--canvas)" }}>
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-6">
          <Logo size={40} />
          <div>
            <div className=" font-bold text-lg text-ink leading-tight">Post-Analytical Tracker</div>
            <div className="num text-xs text-accent">Outstanding specimens, shared across benches</div>
          </div>
        </div>

        <div className="card p-7">
          {mode === "config" && (
            <>
              <h1 className=" font-bold text-lg text-ink mb-3">Not connected</h1>
              <Note tone="err">The Supabase address isn't set. Add VITE_SUPABASE_URL and VITE_SUPABASE_KEY in Render's environment settings, or set them in src/lib/api.ts, then redeploy.</Note>
            </>
          )}

          {mode === "login" && (
            <>
              <h1 className=" font-bold text-lg text-ink mb-4">Sign in</h1>
              {message && <Note tone={messageTone}>{message}</Note>}
              {err && <Note tone="err">{err}</Note>}
              <Field label="Email"><input className={inputCls} type="email" autoComplete="username" autoFocus value={f.email} onChange={set("email")} onKeyDown={onKey} /></Field>
              <Field label="Password"><input className={inputCls} type="password" autoComplete="current-password" value={f.password} onChange={set("password")} onKeyDown={onKey} /></Field>
              <Button tone="primary" className="w-full py-2.5 text-sm mt-1" disabled={busy} onClick={login}>{busy ? "Signing in…" : "Sign in"}</Button>
              <p className="text-xs text-ink-3 mt-4">Forgot your password? Ask an admin to reset it.</p>
            </>
          )}

          {mode === "setup" && (
            <>
              <h1 className=" font-bold text-lg text-ink mb-2">Create the first admin</h1>
              <p className="text-xs text-ink-2 mb-4 leading-relaxed">Nobody has been set up yet, so this form appears once. You'll need the SETUP_CODE saved in Supabase under Edge Functions → Secrets.</p>
              {err && <Note tone="err">{err}</Note>}
              <Field label="Your name"><input className={inputCls} autoComplete="name" autoFocus value={f.name} onChange={set("name")} /></Field>
              <Field label="Email"><input className={inputCls} type="email" autoComplete="username" value={f.email} onChange={set("email")} /></Field>
              <Field label="Password (8+ characters)"><input className={inputCls} type="password" autoComplete="new-password" value={f.password} onChange={set("password")} /></Field>
              <Field label="Confirm password"><input className={inputCls} type="password" autoComplete="new-password" value={f.password2} onChange={set("password2")} /></Field>
              <Field label="Setup code"><input className={inputCls} type="password" autoComplete="off" value={f.code} onChange={set("code")} onKeyDown={onKey} /></Field>
              <Button tone="primary" className="w-full py-2.5 text-sm mt-1" disabled={busy} onClick={setup}>{busy ? "Creating…" : "Create admin account"}</Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
