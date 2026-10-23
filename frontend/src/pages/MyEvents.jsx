import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import Navbar from "../components/Navbar";
import { PublicPageSkeleton, SkeletonBlock, SkeletonRows } from "../components/LoadingSkeletons";
import { getMyAttendance, getMyEventResponses, getPublicEventUpdates, respondToEvent } from "../services/api";

function storedUser() {
    try { return JSON.parse(localStorage.getItem("user") || "null"); } catch { return null; }
}

function dateLabel(value) {
    if (!value) return "Schedule pending";
    const date = new Date(String(value).replace(" ", "T"));
    return Number.isNaN(date.getTime()) ? "Schedule pending" : date.toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });
}

export default function MyEvents() {
    const user = storedUser();
    const isCouncilMember = Boolean(user?.role === "admin" || user?.council_position || user?.committee_assignment);
    const isSignedIn = Boolean(user?.id);
    const [responses, setResponses] = useState([]);
    const [attendance, setAttendance] = useState([]);
    const [announcements, setAnnouncements] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState("");
    const [feedback, setFeedback] = useState("");

    const load = useCallback(async () => {
        const [responseResult, attendanceResult, updateResult] = await Promise.allSettled([
            isCouncilMember ? getMyEventResponses() : Promise.resolve({ responses: [] }),
            getMyAttendance(),
            getPublicEventUpdates()
        ]);
        if (responseResult.status === "fulfilled") setResponses(responseResult.value.responses || []);
        else if (isCouncilMember) setFeedback(responseResult.reason.message || "Council participation could not be loaded.");
        if (attendanceResult.status === "fulfilled") setAttendance(attendanceResult.value.attendance || []);
        else if (!isSignedIn) setFeedback("Sign in to view your attendance history.");
        else if (!isCouncilMember) setFeedback(attendanceResult.reason.message || "Your attendance history could not be loaded.");
        if (updateResult.status === "fulfilled") setAnnouncements(updateResult.value.updates || []);
    }, [isCouncilMember, isSignedIn]);

    useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

    async function updateResponse(response, status) {
        setBusyId(String(response.event_id));
        setFeedback("");
        try {
            const result = await respondToEvent(response.event_id, status);
            setResponses((current) => current.map((item) => item.event_id === response.event_id ? { ...item, ...(result.response || {}), status, responded_at: result.response?.responded_at || new Date().toISOString() } : item));
            setFeedback(result.message || "Your participation choice was saved.");
        } catch (error) {
            setFeedback(error.message || "Your participation could not be saved.");
        } finally { setBusyId(""); }
    }

    if (loading) return <PublicPageSkeleton className="my-events-page member-events-page ui-member-events-loading">
        <header className="events-header"><SkeletonBlock className="ui-skeleton-eyebrow" /><SkeletonBlock className="ui-skeleton-title" /><SkeletonBlock className="ui-skeleton-description" /></header>
        <section className="member-assignment-section" aria-hidden="true"><header><div><SkeletonBlock className="ui-skeleton-eyebrow" /><SkeletonBlock className="ui-skeleton-section-title" /><SkeletonBlock className="ui-skeleton-description" /></div></header><SkeletonRows count={2} /></section>
        <section className="my-events-registration-section" aria-hidden="true"><header><SkeletonBlock className="ui-skeleton-eyebrow" /><SkeletonBlock className="ui-skeleton-section-title" /><SkeletonBlock className="ui-skeleton-description" /></header><SkeletonRows count={3} /></section>
    </PublicPageSkeleton>;

    return <><Navbar /><main className="my-events-page member-events-page">
        <header className="events-header"><span>YOUR ACTIVITY</span><h1>My Activity</h1><p>Council participation and student attendance are shown separately. Accepting an invitation does not create a task assignment or attendance record.</p></header>
        {feedback && <p className="my-events-feedback" role="status">{feedback}</p>}

        {announcements.length > 0 && <section className="member-assignment-section" aria-labelledby="member-notices-heading"><header><div><span>OFFICIAL COUNCIL NOTICES</span><h2 id="member-notices-heading">Recent event updates</h2><p>New events and important event changes from the council.</p></div><Link to="/announcements">All notices →</Link></header><div className="member-assignment-list">{announcements.slice(0, 3).map((event) => <article key={`${event.id}-${event.public_updated_at || event.updated_at || event.created_at}`}><div><span className={`member-assignment-status ${event.status === "cancelled" ? "is-cancelled" : "is-open"}`}>{event.status === "cancelled" || event.publication_status === "cancelled" ? "Cancelled" : event.public_update_type === "details_updated" ? "Updated" : "New event"}</span><h3>{event.title}</h3><p>{event.description}</p></div><Link to={`/events/${event.id}`}>Event notice →</Link></article>)}</div></section>}

        {isCouncilMember && <section className="member-assignment-section council-response-list" aria-labelledby="council-participation-heading"><header><div><span>COUNCIL PARTICIPATION</span><h2 id="council-participation-heading">Participation</h2><p>Let the council know whether you intend to help. This is separate from work assignments and event attendance.</p></div></header>
            {responses.length ? <div className="member-assignment-list">{responses.map((response) => <article key={response.id}><div><span className={`member-assignment-status is-${response.status}`}>{response.status}</span><h3>{response.event?.title || "Council event"}</h3><p>{response.event?.location || "Location to be confirmed"} · {dateLabel(response.event?.start_date)}</p>{response.responded_at && <small>Participation updated {dateLabel(response.responded_at)}</small>}</div><div className="council-response-card-actions"><Link to={`/events/${response.event?.id}`}>Event details →</Link>{response.event?.id && response.event?.display_status !== "past" && <><button type="button" className="admin-primary-action" disabled={busyId === String(response.event_id) || response.status === "accepted"} onClick={() => updateResponse(response, "accepted")}>{busyId === String(response.event_id) ? "Saving…" : response.status === "accepted" ? "Accepted" : "Accept"}</button><button type="button" className="admin-secondary-action" disabled={busyId === String(response.event_id) || response.status === "declined"} onClick={() => updateResponse(response, "declined")}>{response.status === "declined" ? "Declined" : "Decline"}</button></>}</div></article>)}</div> : <div className="member-assignment-empty"><h3>No event invitations yet</h3><p>When an event is shared with the council, your pending participation will appear here.</p></div>}
        </section>}

        <section className="my-events-registration-section student-attendance-history" aria-labelledby="my-attendance-heading"><header><span>EVENT ATTENDANCE</span><h2 id="my-attendance-heading">Your attendance history</h2><p>Only event check-in and check-out records appear here. Participation is not attendance.</p></header>
            <div className="my-events-list">{attendance.length ? attendance.map((record, index) => <article className="my-event-card" key={`${record.event?.id}-${record.time_in || index}`}><div><small>{dateLabel(record.event?.start_date)}</small><h3>{record.event?.title || "Event"}</h3><p>{record.event?.location || "Location not recorded"}</p><p>Attendance: <strong>{record.time_out ? "Checked out" : record.time_in ? "Checked in · checkout not recorded" : "No attendance recorded"}</strong></p>{record.time_in && <p>Time in: {dateLabel(record.time_in)}</p>}{record.time_out && <p>Time out: {dateLabel(record.time_out)}</p>}</div></article>) : <div className="empty-events"><h3>No attendance records yet</h3><p>Agree to participate on an event page, generate that event’s QR, then have it scanned at check-in.</p><Link to="/events" className="register-button">Explore events</Link></div>}</div>
        </section>
    </main></>;
}
