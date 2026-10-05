import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "../lib/api";
import { STATUS_LABEL } from "../lib/formTemplate";
import { fmtIso, fmtTime, norm } from "../lib/tracker";
import { PrintPod } from "./PodForm";
import { SignatureImage } from "./Signature";
import { Badge, Button, C, Note, Stat, csvCell, downloadFile, inputBase, stamp } from "./ui";

const statusColor = (s: string) => (s === "D" ? C.success : s === "pending" ? C.accent : C.warning);

export default function DeliveriesView({ toast }: { toast: (m: string, t?: "ok" | "err") => void }) {
  const [data, setData] = useState<{ sheets: api.DeliverySheet[]; rows: api.ReportDelivery[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "open" | "review" | "done">("all");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [printing, setPrinting] = useState<number | null>(null);

  const load = useCallback(async () => {
    try { setData(await api.loadDeliveries(45)); setErr(null); } catch (e: any) { setErr(e.message); }
  }, []);
  useEffect(() => {
    load();
    let t: number | undefined;
    const unsub = api.subscribeDeliveries(() => { clearTimeout(t); t = window.setTimeout(load, 800); });
    return () => { unsub(); clearTimeout(t); };
  }, [load]);

  const view = useMemo(() => {
    if (!data) return null;
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const today = (iso: string | null) => !!iso && new Date(iso) >= startOfDay;
    const q = norm(search);
    const rowsOf = (id: number) => data.rows.filter((r) => r.sheet_id === id);
    const sheets = data.sheets.filter((s) => {
      if (filter === "open" && s.closed_at) return false;
      if (filter === "review" && !(s.closed_at && !s.reviewed_at)) return false;
      if (filter === "done" && !s.reviewed_at) return false;
      if (!q) return true;
      return norm([s.location, s.department, s.courier_name, s.courier_email, ...rowsOf(s.id).map((r) => `${r.r_number} ${r.client_name || ""} ${r.receiver_name || ""}`)].join(" ")).includes(q);
    });
    return {
      sheets, rowsOf,
      out: data.rows.filter((r) => r.status === "pending").length,
      deliveredToday: data.rows.filter((r) => r.status === "D" && today(r.recorded_at)).length,
      failedToday: data.rows.filter((r) => ["ND", "CU", "C"].includes(r.status) && today(r.recorded_at)).length,
      toReview: data.sheets.filter((s) => s.closed_at && !s.reviewed_at).length,
    };
  }, [data, filter, search]);

  async function review(s: api.DeliverySheet) {
    const note = prompt(`Review and sign off sheet #${s.id} (${s.location})?\n\nOptional note (e.g. "checked against dispatch log"):`, "");
    if (note === null) return;
    try { await api.reviewDeliverySheet(s.id, note); toast("Sheet reviewed and signed off."); await load(); }
    catch (e: any) { toast(e.message, "err"); }
  }

  function exportCsv() {
    if (!data || !view) return;
    const rows = [["Sheet", "Location", "Department", "Courier", "Picked up", "Req#", "Client", "Receiver", "Delivered/attempted", "Status", "Reason", "Reviewed by", "Reviewed"].join(",")];
    view.sheets.forEach((s) => view.rowsOf(s.id).forEach((r) => rows.push([s.id, csvCell(s.location), csvCell(s.department), csvCell(s.courier_name || s.courier_email),
      fmtIso(r.picked_up_at), r.r_number, csvCell(r.client_name), csvCell(r.receiver_name), fmtIso(r.recorded_at), r.status, csvCell(r.reason),
      csvCell(s.reviewed_by), fmtIso(s.reviewed_at)].join(","))));
    downloadFile(`report_deliveries_${stamp()}.csv`, rows.join("\n"), "text/csv;charset=utf-8;");
  }

  const printSheet = printing && data ? data.sheets.find((s) => s.id === printing) : null;

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-5">
      {err && <Note tone="err">Couldn't load deliveries: {err}. Has 05_report_delivery.sql been run in Supabase?</Note>}
      <h1 className="text-xl font-semibold text-ink mb-1">Report deliveries</h1>
      <p className="text-sm text-ink-2 mb-4">Proof of delivery of clients' medical reports (GHA-POSTF001). Couriers fill in sheets on their phones; review and print them here.</p>

      {view && (
        <>
          <div className="flex gap-8 sm:gap-12 flex-wrap mb-5">
            <Stat label="Out for delivery" value={view.out} color={view.out ? C.accent : C.ink} />
            <Stat label="Delivered today" value={view.deliveredToday} color={C.success} />
            <Stat label="Not delivered today" value={view.failedToday} color={view.failedToday ? C.warning : C.ink} />
            <Stat label="Sheets awaiting review" value={view.toReview} color={view.toReview ? C.danger : C.ink} />
          </div>
          <div className="flex flex-wrap gap-2 items-center mb-4">
            <select className={inputBase} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Show">
              <option value="all">All sheets (last 45 days)</option>
              <option value="open">Still out with courier</option>
              <option value="review">Closed, awaiting review</option>
              <option value="done">Reviewed</option>
            </select>
            <input className={`${inputBase} w-64`} placeholder="Find R#, client, receiver, courier" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
            <Button tone="quiet" className="ml-auto" onClick={exportCsv}>Export (CSV)</Button>
          </div>

          {!view.sheets.length && <div className="card p-8 text-center text-ink-3">No delivery sheets match.</div>}
          {view.sheets.map((s) => {
            const rows = view.rowsOf(s.id);
            const counts = rows.reduce<Record<string, number>>((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), {});
            const open = openId === s.id;
            return (
              <section key={s.id} className="card mb-3 overflow-hidden">
                <button className="w-full text-left px-4 py-3 flex items-center justify-between gap-4 flex-wrap hover:bg-raised cursor-pointer"
                  onClick={() => setOpenId(open ? null : s.id)} aria-expanded={open}>
                  <span>
                    <span className="font-semibold text-ink">{s.location}</span>
                    <span className="text-ink-2"> {s.department ? `(${s.department})` : ""}</span>
                    <span className="block text-sm text-ink-3">Sheet #{s.id}, {s.courier_name || s.courier_email}, picked up {fmtIso(s.started_at)}</span>
                  </span>
                  <span className="flex items-center gap-2 flex-wrap">
                    {Object.entries(counts).map(([k, n]) => <Badge key={k} color={statusColor(k)}>{n} {k === "pending" ? "out" : k}</Badge>)}
                    {!s.closed_at ? <Badge color={C.accent} solid>With courier</Badge>
                      : !s.reviewed_at ? <Badge color={C.danger} solid>Awaiting review</Badge>
                      : <Badge color={C.success} solid>Reviewed</Badge>}
                  </span>
                </button>
                {open && (
                  <div className="border-t" style={{ borderColor: C.line }}>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead><tr className="text-left text-xs text-ink-3" style={{ background: C.raised }}>
                          {["Req#", "Client", "Picked up", "Status", "Receiver", "Signature", "Delivered / attempted", "Reason"].map((h) =>
                            <th key={h} className="px-4 py-2 font-medium">{h}</th>)}
                        </tr></thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr key={r.id} className="border-t" style={{ borderColor: C.line }}>
                              <td className="px-4 py-2 num">{r.r_number}</td>
                              <td className="px-4 py-2">{r.client_name || <span className="text-ink-3">not set</span>}</td>
                              <td className="px-4 py-2 num">{fmtTime(r.picked_up_at)}</td>
                              <td className="px-4 py-2"><Badge color={statusColor(r.status)}>{STATUS_LABEL[r.status]}</Badge></td>
                              <td className="px-4 py-2">{r.receiver_name || ""}</td>
                              <td className="px-4 py-2"><SignatureImage path={r.receiver_signature} height={30} title={`Signature of ${r.receiver_name || "receiver"}`} /></td>
                              <td className="px-4 py-2 num">{fmtIso(r.recorded_at)}</td>
                              <td className="px-4 py-2">{r.reason || ""}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="px-4 py-3 flex flex-wrap gap-2 items-center border-t" style={{ borderColor: C.line }}>
                      <span className="text-sm text-ink-2 mr-auto flex items-center gap-2">
                        Courier signature: <SignatureImage path={s.courier_signature} height={28} />
                        {s.reviewed_at && <span>. Reviewed by {s.reviewed_by}, {fmtIso(s.reviewed_at)}{s.review_note ? `: ${s.review_note}` : ""}</span>}
                      </span>
                      {s.closed_at && !s.reviewed_at && <Button tone="primary" onClick={() => review(s)}>Review and sign off</Button>}
                      <Button onClick={() => setPrinting(s.id)}>Print GHA-POSTF001</Button>
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </>
      )}
      {printSheet && data && <PrintPod sheet={printSheet} rows={data.rows.filter((r) => r.sheet_id === printSheet.id)} onDone={() => setPrinting(null)} />}
    </div>
  );
}
