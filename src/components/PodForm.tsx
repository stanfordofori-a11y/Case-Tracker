import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { DeliverySheet, ReportDelivery } from "../lib/api";
import { POD_FORM } from "../lib/formTemplate";
import { SignatureImage } from "./Signature";

const p2 = (n: number) => String(n).padStart(2, "0");
const d = (iso: string | null) => { if (!iso) return ""; const x = new Date(iso); return `${p2(x.getDate())}/${p2(x.getMonth() + 1)}/${x.getFullYear()}`; };
const t = (iso: string | null) => { if (!iso) return ""; const x = new Date(iso); return `${p2(x.getHours())}:${p2(x.getMinutes())}`; };
const monthYear = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

/** The GHA-POSTF001 sheet, laid out like the paper form. Rendered for printing only. */
export function PodForm({ sheet, rows }: { sheet: DeliverySheet; rows: ReportDelivery[] }) {
  const blanks = Math.max(0, POD_FORM.minRows - rows.length);
  const cell = { border: "1px solid #000", padding: "3px 4px", fontSize: "9pt", verticalAlign: "middle" as const };
  const head = { ...cell, fontWeight: 700, background: "#eee", textAlign: "center" as const, fontSize: "8.5pt" };
  return (
    <div className="pod-form" style={{ fontFamily: "Arial, sans-serif", color: "#000", padding: "0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <div style={{ fontWeight: 700, fontSize: "14pt", letterSpacing: 1 }}>{POD_FORM.organisation}<div style={{ fontSize: "8pt", fontWeight: 400 }}>{POD_FORM.country}</div></div>
        <div style={{ fontSize: "8pt", textAlign: "right" }}>Sheet #{sheet.id}<br />Printed {d(new Date().toISOString())} {t(new Date().toISOString())}</div>
      </div>
      <div style={{ textAlign: "center", fontWeight: 700, fontSize: "12pt", margin: "4px 0 10px" }}>{POD_FORM.title}</div>
      <div style={{ display: "flex", gap: 40, fontSize: "10pt", marginBottom: 8 }}>
        <span>Location: <b style={{ borderBottom: "1px solid #000", paddingRight: 30 }}>{sheet.location}</b></span>
        <span>Department: <b style={{ borderBottom: "1px solid #000", paddingRight: 30 }}>{sheet.department || ""}</b></span>
        <span>Month/Year: <b style={{ borderBottom: "1px solid #000", paddingRight: 30 }}>{monthYear(sheet.started_at)}</b></span>
      </div>
      <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
        <colgroup>
          {[7, 6, 10, 9, 9, 11, 10, 10, 7, 6, 7, 8].map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}
        </colgroup>
        <thead>
          <tr><th style={head} colSpan={5}>REPORT PICK UP</th><th style={head} colSpan={7}>REPORT DELIVERY</th></tr>
          <tr>
            {["Date of Pick up", "Time at Pick up", "Req# of Report", "Courier Name", "Courier Signature", "Client Name", "Client receiver's name",
              "Receiver's signature", "Date delivered", "Time delivered", "Status (Delivered / Not delivered)", "Reason if not delivered"]
              .map((h) => <th key={h} style={head}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ height: 34 }}>
              <td style={cell}>{d(r.picked_up_at)}</td>
              <td style={cell}>{t(r.picked_up_at)}</td>
              <td style={{ ...cell, fontFamily: "Consolas, monospace" }}>{r.r_number}</td>
              <td style={cell}>{sheet.courier_name || sheet.courier_email}</td>
              <td style={cell}><SignatureImage path={sheet.courier_signature} height={26} /></td>
              <td style={cell}>{r.client_name || ""}</td>
              <td style={cell}>{r.receiver_name || ""}</td>
              <td style={cell}><SignatureImage path={r.receiver_signature} height={26} /></td>
              <td style={cell}>{r.status === "D" ? d(r.recorded_at) : ""}</td>
              <td style={cell}>{r.status === "D" ? t(r.recorded_at) : ""}</td>
              <td style={{ ...cell, textAlign: "center", fontWeight: 700 }}>{r.status === "pending" ? "" : r.status}</td>
              <td style={cell}>{r.reason || ""}{r.status !== "D" && r.recorded_at ? ` (attempted ${d(r.recorded_at)} ${t(r.recorded_at)})` : ""}</td>
            </tr>
          ))}
          {Array.from({ length: blanks }).map((_, i) => (
            <tr key={`b${i}`} style={{ height: 28 }}>{Array.from({ length: 12 }).map((__, j) => <td key={j} style={cell} />)}</tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: "9pt", marginTop: 8 }}>
        <i><u>Please indicate below abbreviation at reason or Status columns where applicable</u></i><br />
        D: delivered &nbsp; ND: not delivered &nbsp; CU: client unavailable &nbsp; C: closed
      </div>
      <div style={{ display: "flex", gap: 60, fontSize: "10pt", marginTop: 14 }}>
        <span>Reviewed by: <b style={{ borderBottom: "1px solid #000", paddingRight: 40 }}>{sheet.reviewed_by || ""}</b></span>
        <span>Date: <b style={{ borderBottom: "1px solid #000", paddingRight: 40 }}>{sheet.reviewed_at ? d(sheet.reviewed_at) : ""}</b></span>
        {sheet.review_note && <span>Note: {sheet.review_note}</span>}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "7.5pt", marginTop: 16 }}>
        <span>{POD_FORM.code} {POD_FORM.version}<br />{POD_FORM.issuedBy}<br />{POD_FORM.issueDate}</span>
        <span style={{ alignSelf: "flex-end" }}>Page 1 of 1</span>
        <span style={{ textAlign: "right" }}>{POD_FORM.author}<br />{POD_FORM.approver}<br />Signatures captured electronically in the Post-Analytical Tracker</span>
      </div>
    </div>
  );
}

/** Prints one sheet on landscape A4, then cleans up. */
export function PrintPod({ sheet, rows, onDone }: { sheet: DeliverySheet; rows: ReportDelivery[]; onDone: () => void }) {
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = "@page { size: A4 landscape; margin: 10mm; }";
    document.head.appendChild(style);
    document.body.classList.add("printing-form");
    const done = () => { document.body.classList.remove("printing-form"); style.remove(); onDone(); };
    window.addEventListener("afterprint", done, { once: true });
    const t = setTimeout(() => window.print(), 150);
    return () => { clearTimeout(t); window.removeEventListener("afterprint", done); document.body.classList.remove("printing-form"); style.remove(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return createPortal(<div className="print-portal"><PodForm sheet={sheet} rows={rows} /></div>, document.body);
}
