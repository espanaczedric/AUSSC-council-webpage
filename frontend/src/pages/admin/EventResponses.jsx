import { useEffect, useMemo, useState } from "react";

import AdminNav from "../../components/AdminNav";
import { AdminPageSkeleton, SkeletonBlock, SkeletonPageHeading, SkeletonTable } from "../../components/LoadingSkeletons";
import { getAdminEventResponses, manageAdminEventResponse } from "../../services/api";

const responseLabels = { pending: "Pending", accepted: "Accepted", declined: "Declined" };
const committeeLabels = { executive: "Executive Committee", publication: "Publication Committee", program: "Program Committee", production: "Production Committee" };

function dateLabel(value, options = {}) {
    if (!value) return "—";
    const date = new Date(typeof value === "string" ? value.replace(" ", "T") : value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("en-PH", { timeZone: "Asia/Manila", ...options });
}

export default function EventResponses() {
    const [events, setEvents] = useState([]);
    const [eventId, setEventId] = useState("");
    const [event, setEvent] = useState(null);
    const [responses, setResponses] = useState([]);
    const [summary, setSummary] = useState({ pending: 0, accepted: 0, declined: 0 });
    const [loading, setLoading] = useState(true);
    const [loadingRows, setLoadingRows] = useState(false);
    const [error, setError] = useState("");
    const [query, setQuery] = useState("");
    const [status, setStatus] = useState("all");
    const [committee, setCommittee] = useState("all");
    const [responseDrafts, setResponseDrafts] = useState({});
    const [savingResponseId, setSavingResponseId] = useState("");

    useEffect(() => {
        let active = true;
        getAdminEventResponses()
            .then((data) => {
                if (!active) return;
                const nextEvents = data.events || [];
                setEvents(nextEvents);
                if (nextEvents.length) setEventId(String(nextEvents[0].id));
            })
            .catch((requestError) => { if (active) setError(requestError.message); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, []);

    useEffect(() => {
        if (!eventId) { setResponses([]); setEvent(null); return undefined; }
        let active = true;
        setLoadingRows(true);
        setError("");
        getAdminEventResponses(eventId)
            .then((data) => {
                if (!active) return;
                setEvent(data.event || null);
                setResponses(data.responses || []);
                setSummary(data.summary || { pending: 0, accepted: 0, declined: 0 });
                setResponseDrafts({});
            })
            .catch((requestError) => { if (active) setError(requestError.message); })
            .finally(() => { if (active) setLoadingRows(false); });
        return () => { active = false; };
    }, [eventId]);

    const filtered = useMemo(() => responses.filter((response) => {
        const matchesStatus = status === "all" || response.status === status;
        const member = response.member || {};
        const text = `${member.first_name} ${member.last_name} ${member.student_id} ${member.email} ${member.council_position} ${member.committee_assignment}`.toLowerCase();
        const executivePositions = ["governor", "vice_governor", "secretary", "treasurer", "auditor", "social_media_manager"];
        const matchesCommittee = committee === "all" || (committee === "executive"
            ? member.role === "admin" || member.committee_assignment === "executive" || executivePositions.includes(member.council_position)
            : member.committee_assignment === committee);
        return matchesStatus && matchesCommittee && text.includes(query.trim().toLowerCase());
    }), [responses, status, committee, query]);

    async function saveResponse(response) {
        const nextStatus = responseDrafts[response.id] || response.status;
        if (nextStatus === response.status) return;
        setSavingResponseId(String(response.id));
        setError("");
        try {
            await manageAdminEventResponse(eventId, response.user_id, nextStatus);
            setResponses((current) => current.map((item) => item.id === response.id ? { ...item, status: nextStatus, responded_at: nextStatus === "pending" ? null : new Date().toISOString() } : item));
            setSummary((current) => ({ ...current, [response.status]: Math.max(0, current[response.status] - 1), [nextStatus]: current[nextStatus] + 1 }));
            setResponseDrafts((current) => { const next = { ...current }; delete next[response.id]; return next; });
        } catch (requestError) {
            setError(requestError.message || "The participation status could not be updated.");
        } finally { setSavingResponseId(""); }
    }

    if (loading) return <AdminPageSkeleton>
        <header className="admin-header admin-page-heading"><SkeletonPageHeading /></header>
        <section className="admin-list-section"><div className="admin-list-toolbar"><SkeletonBlock className="ui-skeleton-search" /><SkeletonBlock className="ui-skeleton-filter" /></div><SkeletonTable rows={6} columns={5} /></section>
    </AdminPageSkeleton>;

    return <>
        <AdminNav />
        <main className="admin-page admin-event-responses-page">
            <section className="admin-header admin-page-heading">
                <div>
                    <span>COUNCIL PARTICIPATION</span>
                    <h1>Participation</h1>
                    <p>Track council members’ intent to help with each event. Participation is separate from task assignments and attendance.</p>
                </div>
            </section>

            {!events.length ? <section className="admin-list-section"><div className="admin-empty-state"><h2>No events to plan yet</h2><p>Create an event to invite current council members and track participation.</p></div></section> : <>
                <section className="admin-list-section event-response-overview" aria-label="Selected event participation">
                    <div className="admin-list-toolbar">
                        <label className="admin-filter-field"><span>Event</span>
                            <select value={eventId} onChange={(item) => setEventId(item.target.value)}>
                                {events.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                            </select>
                        </label>
                        <label className="admin-search-field"><span className="sr-only">Search council members</span><input type="search" value={query} onChange={(item) => setQuery(item.target.value)} placeholder="Search member, role, or ID" /></label>
                        <label className="admin-filter-field"><span className="sr-only">Filter participation status</span>
                            <select value={status} onChange={(item) => setStatus(item.target.value)}>
                                <option value="all">All statuses</option>
                                <option value="pending">Pending</option>
                                <option value="accepted">Accepted</option>
                                <option value="declined">Declined</option>
                            </select>
                        </label>
                        <label className="admin-filter-field"><span className="sr-only">Filter council committee</span>
                            <select value={committee} onChange={(item) => setCommittee(item.target.value)}>
                                <option value="all">All invited groups</option>
                                <option value="executive">Executive Committee</option>
                                <option value="publication">Publication Committee</option>
                                <option value="program">Program Committee</option>
                                <option value="production">Production Committee</option>
                            </select>
                        </label>
                    </div>
                    {event && <div className="event-response-event-summary"><div><strong>{event.title}</strong><span>{dateLabel(event.start_date, { dateStyle: "medium", timeStyle: "short" })} · {event.location}</span><small>Invited: {(event.invited_committees || ["all"]).includes("all") ? "All council members" : (event.invited_committees || []).map((item) => committeeLabels[item] || item).join(", ") || "No selected group"}</small><p>{event.description}</p></div><div className="event-response-counts"><span><strong>{summary.accepted}</strong> accepted</span><span><strong>{summary.pending}</strong> pending</span><span><strong>{summary.declined}</strong> declined</span></div></div>}
                </section>

                <section className="admin-list-section" aria-label="Council member participation">
                    {error && <p className="admin-feedback is-error" role="alert">{error}</p>}
                    {loadingRows ? <div className="admin-response-loading"><SkeletonTable rows={5} columns={5} /></div> : filtered.length ? <div className="admin-data-scroll"><table className="admin-data-table">
                        <thead><tr><th scope="col">Council member</th><th scope="col">Position / committee</th><th scope="col">Participation status</th><th scope="col">Last updated</th><th scope="col">Manage</th></tr></thead>
                        <tbody>{filtered.map((response) => {
                            const member = response.member;
                            return <tr key={response.id}>
                                <td><strong>{member.first_name} {member.last_name}</strong><small>{member.student_id} · {member.email}</small></td>
                                <td>{member.council_position?.replaceAll("_", " ") || "Council member"}{member.council_department ? ` · ${member.council_department}` : ""}<small>{member.committee_assignment || "Council-wide"}</small></td>
                                <td><span className={`admin-status is-${response.status}`}>{responseLabels[response.status] || "Pending"}</span></td>
                                <td>{response.responded_at ? dateLabel(response.responded_at, { dateStyle: "medium", timeStyle: "short" }) : "Awaiting participation"}</td>
                                <td><div className="event-response-manage"><select aria-label={`Manage ${member.first_name} ${member.last_name} participation`} value={responseDrafts[response.id] || response.status} onChange={(change) => setResponseDrafts((current) => ({ ...current, [response.id]: change.target.value }))}><option value="pending">Pending</option><option value="accepted">Accepted</option><option value="declined">Declined</option></select><button type="button" className="admin-secondary-action" disabled={savingResponseId === String(response.id) || (responseDrafts[response.id] || response.status) === response.status} onClick={() => saveResponse(response)}>{savingResponseId === String(response.id) ? "Saving…" : "Save"}</button></div></td>
                            </tr>;
                        })}</tbody>
                    </table></div> : <div className="admin-empty-state"><h2>{responses.length ? "No matching members" : "No participation yet"}</h2><p>{responses.length ? "Try a different search or status filter." : "Current council members will appear as pending after an event is created."}</p></div>}
                </section>
            </>}
        </main>
    </>;
}
