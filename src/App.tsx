import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "./lib/api";
import { buildSlices, fmtIso, fmtTime, type Dicts, type Slice } from "./lib/tracker";
import AuthScreen, { type AuthMode } from "./components/AuthScreen";
import TrackerView from "./components/TrackerView";
import PasteFlow from "./components/PasteFlow";
import ReportView from "./components/ReportView";
import SettingsView from "./components/SettingsView";
import StaffView from "./components/StaffView";
import { Button, C, Logo } from "./components/ui";
import DisplayMenu from "./components/DisplayMenu";
import { useDisplay } from "./lib/display";

type Tab = "tracker" | "report" | "settings" | "staff";
type Phase = "boot" | "auth" | "app";

function LiveClock() {
  const [t, setT] = useState(new Date());
  useEffect(() => { const i = setInterval(() => setT(new Date()), 1000); return () => clearInterval(i); }, []);
  return <span className="num text-sm text-ink-2">{t.toLocaleTimeString("en-GB", { hour12: false })}</span>;
}

export default function App() {
  const [phase, setPhase] = useState<Phase>("boot");
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authMsg, setAuthMsg] = useState<{ text: string; tone: "err" | "ok" } | null>(null);
  const [me, setMe] = useState<api.Me | null>(null);
  const [snap, setSnap] = useState<api.Snapshot | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [tab, setTab] = useState<Tab>("tracker");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [toasts, setToasts] = useState<{ id: number; text: string; tone: "ok" | "err" }[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [display, setDisplay] = useDisplay();

  const toast = useCallback((text: string, tone: "ok" | "err" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "err" ? 9000 : 5000);
  }, []);

  const dicts: Dicts = useMemo(() => ({ alist: snap?.alist || [], dept: snap?.dept || [], ignored: snap?.ignored || [] }), [snap]);
  const slices: Slice[] = useMemo(() => (snap ? buildSlices(snap.reqs, snap.tests, dicts) : []), [snap, dicts]);

  /* ---------- data sync ---------- */
  const loading = useRef(false);
  const again = useRef(false);
  const refresh = useCallback(async (): Promise<{ slices: Slice[] } | null> => {
    if (loading.current) { again.current = true; return null; }
    loading.current = true;
    try {
      const s = await api.loadSnapshot();
      setSnap(s);
      setLoadErr(null);
      return { slices: buildSlices(s.reqs, s.tests, { alist: s.alist, dept: s.dept, ignored: s.ignored }) };
    } catch (e: any) {
      setLoadErr(`Couldn't load the latest data (${e.message}). It will retry automatically.`);
      return null;
    } finally {
      loading.current = false;
      if (again.current) { again.current = false; setTimeout(refresh, 300); }
    }
  }, []);

  const timer = useRef<number | undefined>(undefined);
  const scheduleRefresh = useCallback((ms = 1200) => { clearTimeout(timer.current); timer.current = window.setTimeout(refresh, ms); }, [refresh]);

  useEffect(() => {
    if (phase !== "app") return;
    const unsub = api.subscribeLive(() => scheduleRefresh(), setLive);
    const tick = setInterval(() => setNow(Date.now()), 60000);
    const safety = setInterval(() => { if (!document.hidden) refresh(); }, 5 * 60000);
    const vis = () => { if (!document.hidden) { setNow(Date.now()); scheduleRefresh(300); } };
    document.addEventListener("visibilitychange", vis);
    return () => { unsub(); clearInterval(tick); clearInterval(safety); document.removeEventListener("visibilitychange", vis); };
  }, [phase, refresh, scheduleRefresh]);

  /* ---------- auth ---------- */
  const enterApp = useCallback(async () => {
    const r = await api.currentStaff();
    if (!r) { setAuthMode("login"); setPhase("auth"); return; }
    if ("error" in r) {
      await api.signOut();
      setAuthMsg({ text: r.error, tone: "err" });
      setAuthMode("login");
      setPhase("auth");
      return;
    }
    setMe(r);
    await refresh();
    setPhase("app");
  }, [refresh]);

  useEffect(() => {
    (async () => {
      if (!api.configOk || !api.sb) { setAuthMode("config"); setPhase("auth"); return; }
      const { data: { session } } = await api.getSession();
      if (session) { await enterApp(); return; }
      try {
        const s = await api.staffFn<{ needs_setup: boolean }>({ action: "setup_status" });
        setAuthMode(s?.needs_setup ? "setup" : "login");
      } catch (e: any) {
        setAuthMode("login");
        setAuthMsg({ text: `Couldn't reach the ${api.STAFF_FUNCTION} function (${e.message}). Signing in may still work; on a new install, check the function is deployed with Verify JWT off.`, tone: "err" });
      }
      setPhase("auth");
    })();
  }, [enterApp]);

  async function doSignOut() {
    await api.signOut();
    setMe(null); setSnap(null); setTab("tracker"); setMenuOpen(false);
    setAuthMsg(null); setAuthMode("login"); setPhase("auth");
  }

  async function changePassword() {
    setMenuOpen(false);
    const p1 = prompt("Choose a new password (at least 8 characters):");
    if (p1 === null) return;
    if (p1.length < 8) return toast("Password must be at least 8 characters.", "err");
    if (prompt("Type the new password again:") !== p1) return toast("The passwords didn't match. Nothing was changed.", "err");
    const { error } = await api.changePassword(p1);
    toast(error ? `Couldn't change password: ${error.message}` : "Password changed.", error ? "err" : "ok");
  }

  async function undo() {
    const p = snap?.pastes[0];
    if (!p) return;
    if (!confirm(`Undo the list pasted ${fmtIso(p.at)} by ${p.by_email}?\n\nEvery case goes back to exactly how it was before that paste. This changes the tracker for everyone.`)) return;
    try { await api.undoLastPaste(); await refresh(); toast("Paste undone."); }
    catch (e: any) { toast(e.message, "err"); }
  }

  /* ---------- render ---------- */
  if (phase === "boot") {
    return <div className="min-h-screen flex items-center justify-center text-sm text-ink-3">Connecting…</div>;
  }
  if (phase === "auth" || !me || !snap) {
    return <AuthScreen mode={authMode} message={authMsg?.text} messageTone={authMsg?.tone}
      onSignedIn={() => { setAuthMsg(null); enterApp(); }}
      onModeChange={(m, msg, tone) => { setAuthMode(m); setAuthMsg(msg ? { text: msg, tone: tone || "err" } : null); }} />;
  }

  const isAdmin = me.role === "admin";
  const lastPaste = snap.pastes[0] || null;
  const initials = (me.display_name || me.email).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  const tabs: [Tab, string][] = [["tracker", "Tracker"], ["report", "Delay report"], ["settings", "Settings"], ...(isAdmin ? [["staff", "Staff"] as [Tab, string]] : [])];

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b sticky top-0 z-40 no-print bg-surface" style={{ borderColor: C.line }}>
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-2.5 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-6 flex-wrap">
            <div className="flex items-center gap-2.5">
              <Logo />
              <span className="font-semibold text-lg text-ink leading-tight">Post-Analytical Tracker</span>
            </div>
            <nav className="flex gap-1" role="tablist" aria-label="Sections">
              {tabs.map(([id, label]) => (
                <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                  className="px-3 py-1.5 text-sm cursor-pointer border-b-2 -mb-[1px]"
                  style={{ color: tab === id ? C.ink : C.ink2, borderColor: tab === id ? C.accent : "transparent", fontWeight: tab === id ? 600 : 400 }}>
                  {label}
                </button>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-3 sm:gap-4">
            <span className="flex items-center gap-2 text-sm" style={{ color: live ? C.success : C.warning }}
              title={live ? "Changes from other benches appear automatically" : "Live updates paused; data refreshes every few minutes"}>
              <span className={`relative w-2 h-2 rounded-full ${live ? "live-dot" : ""}`} style={{ color: live ? C.success : C.warning, background: live ? C.success : C.warning }} />
              {live ? "Live" : "Reconnecting"}
            </span>
            <LiveClock />
            <DisplayMenu d={display} set={setDisplay} />
            <div className="relative">
              <button onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen} className="flex items-center gap-2 cursor-pointer rounded-md px-1.5 py-1 hover:bg-raised">
                <span className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold" style={{ background: C.ink, color: C.surface }}>{initials}</span>
                <span className="text-sm text-ink hidden lg:inline">{me.display_name || me.email}</span>
              </button>
              {menuOpen && (
                <div className="card absolute right-0 mt-2 w-56 py-1 z-50">
                  <div className="px-3 py-2 text-xs text-ink-3 truncate">{me.email}{isAdmin ? " (admin)" : ""}</div>
                  <button className="w-full text-left px-3 py-2 text-sm text-ink hover:bg-raised cursor-pointer" onClick={changePassword}>Change password</button>
                  <button className="w-full text-left px-3 py-2 text-sm text-ink hover:bg-raised cursor-pointer" onClick={doSignOut}>Sign out</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {loadErr && <div className="px-6 py-2 text-sm no-print text-danger" style={{ background: "color-mix(in srgb, var(--danger) 10%, transparent)" }}>{loadErr}</div>}
      {lastPaste && !lastPaste.locked && tab === "tracker" && (
        <div className="border-b no-print" style={{ borderColor: C.line, background: C.raised }}>
          <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-1.5 flex items-center gap-3 text-sm text-ink-2">
            <span>Last list pasted at {fmtTime(lastPaste.at)} by {lastPaste.by_email}{lastPaste.mode === "partial" ? " (add/update only)" : ""}.</span>
            <Button tone="quiet" className="px-1 py-0.5" onClick={undo}>Undo that paste</Button>
          </div>
        </div>
      )}

      <main>
        {tab === "tracker" && <TrackerView slices={slices} now={now} lastPaste={lastPaste} onOpenPaste={() => setPasteOpen(true)} />}
        {tab === "report" && <ReportView slices={slices} pasteTimes={snap.pastes.map((p) => p.at)} dicts={dicts} settings={snap.settings} onError={(m) => toast(m, "err")} />}
        {tab === "settings" && <SettingsView snap={snap} dicts={dicts} slices={slices} isAdmin={isAdmin} refresh={refresh} toast={toast} />}
        {tab === "staff" && isAdmin && <StaffView me={me} />}
      </main>

      <PasteFlow open={pasteOpen} onClose={() => setPasteOpen(false)} slices={slices} dicts={dicts} knownUnmatched={snap.unmatched}
        refresh={refresh} onSaved={(m) => { toast(m); refresh(); }} />

      <div className="fixed bottom-4 right-4 z-[70] space-y-2 max-w-sm no-print" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="card px-4 py-3 text-sm text-ink" style={{ borderLeft: `4px solid ${t.tone === "err" ? C.danger : C.success}` }}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
