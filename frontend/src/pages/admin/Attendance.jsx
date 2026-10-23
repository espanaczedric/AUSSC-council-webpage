import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import AdminNav from "../../components/AdminNav";
import { AdminPageSkeleton, SkeletonBlock, SkeletonPageHeading, SkeletonTable } from "../../components/LoadingSkeletons";
import { getAdminAttendance, getAdminEvents } from "../../services/api";

const PAGE_SIZE = 20;

function formatDate(value) {
    if (!value) return "—";
    const date = new Date(String(value).replace(" ", "T"));
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
}

function formatDuration(timeIn, timeOut) {
    if (!timeIn) return "—";
    if (!timeOut) return "Incomplete checkout";
    const minutes = Math.max(0, Math.round((new Date(String(timeOut).replace(" ", "T")) - new Date(String(timeIn).replace(" ", "T"))) / 60000));
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function AttendanceTable({ rows, page, onPageChange, emptyMessage }) {
    const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    return <>
        <div className="admin-table-wrap"><table className="admin-table attendance-table"><thead><tr><th>Member</th><th>Category</th><th>Event</th><th>Time in</th><th>Time out</th><th>Duration</th><th>State</th></tr></thead><tbody>
            {pageRows.map((row) => <tr key={`${row.participant_type}-${row.id}`}>
                <td><strong>{row.first_name} {row.last_name}</strong><small>{row.student_id} · {row.email}</small>{row.contact && <small>Contact: {row.contact}</small>}</td>
                <td>{row.participant_type === "council" ? <>{row.council_position?.replaceAll("_", " ") || "Council member"}<small>{row.committee_assignment || "Council"}</small></> : <>{row.course || "Student"}<small>{row.year_level || "Year not specified"}</small></>}</td>
                <td>{row.event_title}<small>Attendance recorded for this event</small></td>
                <td>{formatDate(row.time_in)}</td><td>{formatDate(row.time_out)}</td><td>{formatDuration(row.time_in, row.time_out)}</td>
                <td><span className={`attendance-state ${row.currently_present ? "is-present" : "is-complete"}`}>{row.currently_present ? "Present" : "Completed"}</span></td>
            </tr>)}
        </tbody></table>{!rows.length && <p className="admin-feedback">{emptyMessage}</p>}</div>
        {rows.length > PAGE_SIZE && <nav className="attendance-pagination" aria-label="Attendance pages"><button type="button" onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1}>Previous</button><span>Page {page} of {pageCount} · {rows.length} records</span><button type="button" onClick={() => onPageChange(Math.min(pageCount, page + 1))} disabled={page >= pageCount}>Next</button></nav>}
    </>;
}

function AnalyticsGroup({ title, rows }) {
    if (!rows?.length) return null;
    return <section className="attendance-analytics-group"><h3>{title}</h3><div>{rows.slice(0, 8).map((item) => <span key={item.label}><strong>{item.count}</strong>{item.label}</span>)}</div></section>;
}

export default function Attendance() {
    const [events, setEvents] = useState([]);
    const [report, setReport] = useState({ rows: [], student_rows: [], council_rows: [], summary: {}, analytics: {} });
    const [eventId, setEventId] = useState("");
    const [query, setQuery] = useState("");
    const [from, setFrom] = useState("");
    const [to, setTo] = useState("");
    const [councilPage, setCouncilPage] = useState(1);
    const [studentPage, setStudentPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => { getAdminEvents().then((data) => setEvents(data.events || [])).catch((requestError) => setError(requestError.message)); }, []);
    useEffect(() => {
        let active = true;
        setLoading(true);
        getAdminAttendance(eventId, { from, to })
            .then((data) => { if (active) setReport(data); })
            .catch((requestError) => { if (active) setError(requestError.message); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [eventId, from, to]);

    const matchingRows = useMemo(() => {
        const normalized = query.trim().toLowerCase();
        const matches = (row) => !normalized || `${row.first_name} ${row.last_name} ${row.student_id} ${row.email} ${row.event_title} ${row.course} ${row.year_level} ${row.council_position} ${row.committee_assignment}`.toLowerCase().includes(normalized);
        return { council: (report.council_rows || []).filter(matches), students: (report.student_rows || []).filter(matches) };
    }, [report, query]);
    const eventLabel = events.find((event) => String(event.id) === eventId)?.title;
    const resetPages = () => { setCouncilPage(1); setStudentPage(1); };

    if (loading && !report.rows.length) return <AdminPageSkeleton className="attendance-admin-page">
        <header className="admin-header admin-page-heading"><SkeletonPageHeading /><SkeletonBlock className="ui-skeleton-button" /></header>
        <div className="workspace-skeleton-metrics"><div><SkeletonBlock className="workspace-skeleton-label" /><SkeletonBlock className="workspace-skeleton-number" /></div><div><SkeletonBlock className="workspace-skeleton-label" /><SkeletonBlock className="workspace-skeleton-number" /></div></div>
        <section className="admin-list-section"><div className="admin-list-toolbar"><SkeletonBlock className="ui-skeleton-filter" /><SkeletonBlock className="ui-skeleton-search" /></div><SkeletonTable rows={6} columns={5} /></section>
    </AdminPageSkeleton>;

    return <><AdminNav /><main className="admin-page attendance-admin-page">
        <section className="admin-header admin-page-heading"><div><span>ATTENDANCE</span><h1>Participation & attendance</h1><p>Review council participation first, then open student event attendance. Check-in and check-out times are recorded separately.</p></div><Link to="/admin/attendance/scanner" className="admin-primary-action">Open scanner</Link></section>
        {error && <p className="admin-feedback is-error" role="alert">{error}</p>}
        <section className="attendance-summary"><div><span>SESSIONS RECORDED</span><strong>{report.summary?.total_sessions || 0}</strong></div><div><span>CURRENTLY PRESENT</span><strong>{report.summary?.currently_present || 0}</strong></div><div><span>CHECKED OUT</span><strong>{report.summary?.checked_out || 0}</strong></div><div><span>STUDENT ATTENDANCE</span><strong>{report.summary?.students || 0}</strong></div><div><span>COUNCIL ATTENDANCE</span><strong>{report.summary?.council_members || 0}</strong></div></section>
        <div className="attendance-list-toolbar"><label>Event<select value={eventId} onChange={(event) => { setEventId(event.target.value); resetPages(); }}><option value="">All events</option>{events.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}</select></label><label>From<input type="date" value={from} onChange={(event) => { setFrom(event.target.value); resetPages(); }} /></label><label>To<input type="date" value={to} onChange={(event) => { setTo(event.target.value); resetPages(); }} /></label><label>Search attendance<input type="search" value={query} onChange={(event) => { setQuery(event.target.value); resetPages(); }} placeholder="Name, ID, course, event, or committee" /></label></div>
        {eventLabel && <p className="attendance-filter-caption">Showing attendance for <strong>{eventLabel}</strong>{from || to ? ` · ${from || "Any date"} to ${to || "Today"}` : ""}</p>}

        <section className="attendance-category-section" aria-labelledby="council-attendance-heading"><header><div><span>COUNCIL-FIRST VIEW</span><h2 id="council-attendance-heading">Council member attendance</h2><p>Current roster credentials, positions, committees, and event sessions.</p></div><strong>{matchingRows.council.length} records</strong></header>
            <AttendanceTable rows={matchingRows.council} page={councilPage} onPageChange={setCouncilPage} emptyMessage="No council member attendance matches these filters." />
        </section>

        <details className="attendance-category-section attendance-student-section"><summary><span><small>STUDENT EVENT ATTENDANCE</small><strong>{matchingRows.students.length} records</strong></span><span>Expand student attendance</span></summary><p className="attendance-section-description">Students agree to participate before generating an event-specific QR. Their agreement is separate from attendance; only a scan records check-in.</p><AttendanceTable rows={matchingRows.students} page={studentPage} onPageChange={setStudentPage} emptyMessage="No student attendance matches these filters." /></details>

        <section className="attendance-analytics" aria-labelledby="attendance-analytics-heading"><header><span>PARTICIPATION ANALYTICS</span><h2 id="attendance-analytics-heading">Attendance breakdown</h2><p>Session counts for the selected event and date range.</p></header><div className="attendance-analytics-grid"><AnalyticsGroup title="By event" rows={report.analytics?.by_event} /><AnalyticsGroup title="Student course" rows={report.analytics?.by_course} /><AnalyticsGroup title="Student year level" rows={report.analytics?.by_year_level} /><AnalyticsGroup title="Council position" rows={report.analytics?.by_council_position} /><AnalyticsGroup title="Council committee" rows={report.analytics?.by_committee} /><AnalyticsGroup title="By month" rows={report.analytics?.by_month} /></div></section>
    </main></>;
}
