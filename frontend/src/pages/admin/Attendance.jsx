import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import AdminNav from "../../components/AdminNav";
import { getAdminAttendance, getAdminEvents } from "../../services/api";

export default function Attendance() {
    const [events, setEvents] = useState([]); const [rows, setRows] = useState([]); const [eventId, setEventId] = useState(""); const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(true); const [error, setError] = useState("");
    useEffect(() => { getAdminEvents().then((data) => setEvents(data.events || [])).catch((e) => setError(e.message)); }, []);
    useEffect(() => { setLoading(true); getAdminAttendance(eventId).then((data) => setRows(data.rows || [])).catch((e) => setError(e.message)).finally(() => setLoading(false)); }, [eventId]);
    const filtered = useMemo(() => rows.filter((row) => `${row.first_name} ${row.last_name} ${row.student_id} ${row.email} ${row.event_title} ${row.registration_code}`.toLowerCase().includes(query.trim().toLowerCase())), [rows, query]);
    const eventLabel = events.find((event) => String(event.id) === eventId)?.title;
    return <><AdminNav /><main className="admin-page attendance-admin-page">
        <section className="admin-header admin-page-heading"><div><span>ATTENDANCE</span><h1>Check-in records</h1><p>Validate each pass against the selected event and review check-ins as they arrive.</p></div><Link to="/admin/attendance/scanner" className="admin-primary-action">Open scanner</Link></section>
        {error && <p className="admin-feedback is-error" role="alert">{error}</p>}
        <section className="attendance-summary"><div><span>CHECKED IN</span><strong>{rows.length}</strong></div><div><span>SELECTED EVENT</span><strong>{eventLabel || "All events"}</strong></div></section>
        <div className="attendance-list-toolbar"><label>Event<select value={eventId} onChange={(e) => setEventId(e.target.value)}><option value="">All events</option>{events.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}</select></label><label>Search attendance<input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, ID, email, event, or pass code" /></label></div>
        {loading ? <p className="admin-feedback" role="status">Loading attendance records…</p> : <div className="admin-table-wrap"><table className="admin-table attendance-table"><thead><tr><th>Member</th><th>Student ID</th><th>Event</th><th>Checked in</th><th>Status</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.id}><td><strong>{row.first_name} {row.last_name}</strong><small>{row.email}</small></td><td>{row.student_id}</td><td>{row.event_title}</td><td>{new Date(row.time_in).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}</td><td><span className="attendance-state">Present</span></td></tr>)}</tbody></table>{!filtered.length && <p className="admin-feedback">{rows.length ? "No records match this search." : "No attendance records have been recorded for this event."}</p>}</div>}
    </main></>;
}
