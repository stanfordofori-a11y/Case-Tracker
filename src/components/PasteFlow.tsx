import { useState } from "react";
import { applyPaste } from "../lib/api";
import { parseMText, planPaste, type Dicts, type ParseResult, type PastePlan, type Slice } from "../lib/tracker";
import { Button, C, Modal, Note } from "./ui";

export default function PasteFlow({ open, onClose, slices, dicts, knownUnmatched, refresh, onSaved }: {
  open: boolean;
  onClose: () => void;
  slices: Slice[];
  dicts: Dicts;
  knownUnmatched: Record<string, unknown>;
  refresh: () => Promise<{ slices: Slice[] } | null>;
  onSaved: (msg: string) => void;
}) {
  const [text, setText] = useState("");
  const [review, setReview] = useState<{ parsed: ParseResult; plan: PastePlan } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function close() { setReview(null); setErr(null); onClose(); }

  async function doReview() {
    setErr(null);
    setBusy(true);
    const fresh = await refresh(); // compare against the very latest shared data
    setBusy(false);
    const parsed = parseMText(text, dicts);
    if (!parsed.slices.length && !parsed.skipped.length) {
      setErr('No pending cases found. Check that the full MT "Outstanding Lab Specimens" list was copied.');
      return;
    }
    setReview({ parsed, plan: planPaste(fresh ? fresh.slices : slices, parsed.slices, "full") });
  }

  async function commit(mode: "full" | "partial") {
    if (!review) return;
    setBusy(true); setErr(null);
    try {
      await applyPaste(mode, review.parsed);
      setText("");
      setReview(null);
      onClose();
      onSaved(mode === "full" ? "List applied. Everyone's screen is updating." : "Cases added or updated. Nothing was marked completed.");
    } catch (e: any) {
      setErr(`${e.message}. Nothing was saved; check the connection and try again.`);
    } finally { setBusy(false); }
  }

  const p = review?.plan;
  const reqCount = review ? new Set(review.parsed.slices.map((s) => s.rNumber)).size : 0;
  const newNames = review ? Object.keys(review.parsed.unmatched).filter((k) => !knownUnmatched[k]) : [];
  const bigDrop = p ? p.completedSlices >= 5 && p.completedSlices > 0.4 * p.prevOpen : false;

  return (
    <Modal open={open} onClose={close} wide title={review ? "Review this paste" : "Paste the MT outstanding list"}>
      {err && <Note tone="err">{err}</Note>}
      {!review ? (
        <>
          <p className="text-xs text-[#94a3b8] mb-3 leading-relaxed">
            Copy the whole "Outstanding Lab Specimens" report from MT and paste it here. You'll see what will change before anything is saved.
          </p>
          <textarea value={text} onChange={(e) => setText(e.target.value)} autoFocus spellCheck={false}
            placeholder="(R#123456) CLIENT NAME&#10;  Pending: WBC, RBC, S-UREA …&#10;  @ REPORT Collection Date 24/09/2026 14:30"
            className="w-full h-72 rounded p-3 font-mono text-xs outline-none resize-y bg-[#070d1a] border border-[#1a2f50] text-[#e2e8f0] focus:border-[#22d3ee80]" />
          <div className="flex gap-2 mt-3 justify-end">
            <Button onClick={close}>Cancel</Button>
            <Button tone="primary" disabled={busy || !text.trim()} onClick={doReview}>{busy ? "Checking…" : "Review changes"}</Button>
          </div>
        </>
      ) : (
        <>
          <dl className="text-sm mb-4">
            {([
              ["Requisitions found", <>{reqCount} <span className="text-xs text-[#7c8ba1]">({review.parsed.slices.length} department entries)</span></>],
              ["New to the tracker", p!.newSlices],
              ["Still outstanding", p!.stillOpen],
              ...(p!.reopened ? [["Back on the list after being completed", p!.reopened]] : []),
              ["Tests finished inside cases still open", p!.partialTests],
              ["Will be marked completed (gone from the list)", <span style={{ color: C.danger }}>{p!.completedSlices}</span>],
            ] as [string, React.ReactNode][]).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 py-2 border-b" style={{ borderColor: C.border }}>
                <dt className="text-[#94a3b8]">{k}</dt><dd className="font-mono font-semibold text-[#e2e8f0]">{v}</dd>
              </div>
            ))}
          </dl>

          {bigDrop && (
            <Note tone="warn"><b>Check this is the whole list.</b> {p!.completedSlices} of {p!.prevOpen} outstanding entries
              ({Math.round((100 * p!.completedSlices) / p!.prevOpen)}%) are missing from this paste. If you copied only one page or
              one department, use <b>Add / update only</b> so they aren't wrongly marked completed.</Note>
          )}
          {p!.completedList.length > 0 && (
            <details className="mb-3 text-xs text-[#94a3b8]">
              <summary className="cursor-pointer text-[#cbd5e1]">Show entries that will be marked completed</summary>
              <div className="mt-2 font-mono leading-relaxed">{p!.completedList.slice(0, 80).join(", ")}{p!.completedList.length > 80 ? ` … and ${p!.completedList.length - 80} more` : ""}</div>
            </details>
          )}
          {review.parsed.skipped.length > 0 && (
            <Note tone="err">
              <b>{review.parsed.skipped.length} case{review.parsed.skipped.length === 1 ? "" : "s"} couldn't be read and won't be added:</b>
              <ul className="mt-1 ml-4 list-disc">
                {review.parsed.skipped.slice(0, 15).map((s, i) => <li key={i}>{s.patientId} {s.clientRaw}: {s.reason}</li>)}
                {review.parsed.skipped.length > 15 && <li>… and {review.parsed.skipped.length - 15} more</li>}
              </ul>
            </Note>
          )}
          {newNames.length > 0 && (
            <p className="text-xs text-[#7c8ba1] mb-3">{newNames.length} test name{newNames.length === 1 ? " is" : "s are"} not in the department dictionary yet. They'll appear under Settings → Unrecognised test names.</p>
          )}

          {review.parsed.slices.length ? (
            <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-3 mt-4 items-start">
              <div>
                <Button tone="primary" className="w-full" disabled={busy} onClick={() => commit("full")}>{busy ? "Saving…" : "Apply full list"}</Button>
                <p className="text-[0.68rem] text-[#7c8ba1] mt-1.5">This is the complete outstanding list. Anything missing is marked completed.</p>
              </div>
              <div>
                <Button className="w-full" disabled={busy} onClick={() => commit("partial")}>Add / update only</Button>
                <p className="text-[0.68rem] text-[#7c8ba1] mt-1.5">Partial paste (one page or department). Nothing is marked completed.</p>
              </div>
              <Button tone="quiet" onClick={() => setReview(null)}>Back</Button>
            </div>
          ) : (
            <div className="flex justify-end"><Button onClick={() => setReview(null)}>Back</Button></div>
          )}
        </>
      )}
    </Modal>
  );
}
