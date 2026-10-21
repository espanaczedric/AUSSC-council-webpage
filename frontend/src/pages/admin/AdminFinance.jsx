import { useEffect, useState } from "react";

import AdminNav from "../../components/AdminNav";
import { getAdminEvents, getAdminFinancialRecords, saveAdminFinancialRecord } from "../../services/api";

const freshRecord = { id: "", type: "allocation", title: "", period: new Date().toISOString().slice(0, 7), category: "", amount: "", status: "proposed", public_status: "private", event_id: "", committee: "", document_url: "" };
const money = (amount) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 2 }).format(Number(amount) || 0);

export default function AdminFinance() {
    const [records, setRecords] = useState([]); const [events, setEvents] = useState([]); const [form, setForm] = useState(freshRecord);
    const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [saving, setSaving] = useState(false);
    async function load() {
        try { const [finance, eventData] = await Promise.all([getAdminFinancialRecords(), getAdminEvents()]); setRecords(finance.records || []); setEvents(eventData.events || []); }
        catch (e) { setError(e.message); }
    }
    useEffect(() => { load(); }, []);
    const allocation = records.filter((item) => item.type === "allocation" && ["approved", "recorded"].includes(item.status)).reduce((sum, item) => sum + Number(item.amount), 0);
    const expense = records.filter((item) => item.type === "expense" && item.status === "recorded").reduce((sum, item) => sum + Number(item.amount), 0);
    async function submit(event) {
        event.preventDefault(); setSaving(true); setError(""); setNotice("");
        try { await saveAdminFinancialRecord({ ...form, amount: Number(form.amount), event_id: form.event_id || null }); setForm(freshRecord); setNotice("Financial record saved."); await load(); }
        catch (e) { setError(e.message); }
        finally { setSaving(false); }
    }
    function edit(record) { setForm({ ...record, event_id: record.event_id || "", amount: String(record.amount) }); window.scrollTo({ top: 0, behavior: "smooth" }); }
    return <><AdminNav /><main className="admin-page finance-admin-page">
        <header className="admin-header admin-page-heading"><div><span>FINANCIAL STEWARDSHIP</span><h1>Finance & transparency</h1><p>Record allocations and expenses. Public figures include approved or recorded entries only.</p></div></header>
        <section className="finance-metric-grid"><article><span>Approved allocations</span><strong>{money(allocation)}</strong></article><article><span>Recorded expenses</span><strong>{money(expense)}</strong></article><article><span>Available balance</span><strong>{money(allocation - expense)}</strong></article><article><span>Private / proposed items</span><strong>{records.filter((item) => item.status === "proposed" || item.status === "pending").length}</strong></article></section>
        {error && <p className="admin-feedback is-error" role="alert">{error}</p>}{notice && <p className="admin-feedback" role="status">{notice}</p>}
        <section className="committee-create-card"><div className="admin-section-heading"><div><span>CONTROLLED RECORDING</span><h2>{form.id ? "Update record" : "Add financial record"}</h2></div></div>
            <form className="finance-entry-form" onSubmit={submit}>
                <label>Record type<select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, status: e.target.value === "allocation" ? "proposed" : "pending" })}><option value="allocation">Budget allocation</option><option value="expense">Expense</option></select></label>
                <label>Title<input required maxLength="180" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Campus event supplies" /></label>
                <label>Reporting period<input required type="month" value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} /></label>
                <label>Category<input required maxLength="100" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Operations, logistics…" /></label>
                <label>Amount (₱)<input required type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></label>
                <label>Approval status<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{(form.type === "allocation" ? ["proposed", "approved"] : ["pending", "recorded"]).map((status) => <option key={status}>{status}</option>)}</select></label>
                <label>Event filter<select value={form.event_id} onChange={(e) => setForm({ ...form, event_id: e.target.value })}><option value="">Council-wide</option>{events.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}</select></label>
                <label>Committee<select value={form.committee} onChange={(e) => setForm({ ...form, committee: e.target.value })}><option value="">Council-wide</option>{["executive", "publication", "production", "program"].map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</select></label>
                <label>Disclosure<select value={form.public_status} onChange={(e) => setForm({ ...form, public_status: e.target.value })}><option value="private">Private / internal</option><option value="published">Publish publicly</option></select></label>
                <label className="finance-document-field">Authorized supporting document URL<input type="url" value={form.document_url || ""} onChange={(e) => setForm({ ...form, document_url: e.target.value })} placeholder="https://…" /></label>
                <div className="committee-work-actions"><button className="admin-primary-action" disabled={saving}>{saving ? "Saving…" : form.id ? "Save record" : "Add record"}</button>{form.id && <button type="button" className="admin-secondary-action" onClick={() => setForm(freshRecord)}>Cancel</button>}</div>
            </form>
        </section>
        <section className="committee-items-section"><div className="admin-section-heading"><div><span>MONGO DATABASE RECORDS</span><h2>Financial ledger</h2></div></div>
            <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Record</th><th>Period</th><th>Type / category</th><th>Amount</th><th>Approval</th><th>Disclosure</th><th>Action</th></tr></thead><tbody>{records.map((record) => <tr key={record.id}><td><strong>{record.title}</strong></td><td>{record.period}</td><td>{record.type} · {record.category}<small>{record.committee || "Council-wide"}</small></td><td>{money(record.amount)}</td><td>{record.status}</td><td>{record.public_status}</td><td><button type="button" onClick={() => edit(record)}>Edit</button></td></tr>)}</tbody></table>{!records.length && <p className="admin-feedback">No financial records exist yet. Add verified records to start the ledger.</p>}</div>
        </section>
    </main></>;
}
