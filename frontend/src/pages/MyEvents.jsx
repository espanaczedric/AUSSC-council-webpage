import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import Navbar from "../components/Navbar";
import EventImage from "../components/EventImage";
import { PublicPageSkeleton, SkeletonBlock, SkeletonRows } from "../components/LoadingSkeletons";
import { apiRequest, getMyEventAssignments, getPublicEvents, signUpForEventAssignment } from "../services/api";

export default function MyEvents() {
    const [events, setEvents] = useState([]); const [assignments, setAssignments] = useState([]); const [availableEvents, setAvailableEvents] = useState([]);
    const [loading, setLoading] = useState(true); const [feedback, setFeedback] = useState("");
    const load = useCallback(async () => {
        const [registrations, assignmentData, publicData] = await Promise.all([
            apiRequest("/registration/my", { credentials: "include" }), getMyEventAssignments(), getPublicEvents()
        ]);
        const nextAssignments = assignmentData.assignments || [];
        setEvents(registrations.events || []); setAssignments(nextAssignments);
        const joined = new Set(nextAssignments.map((item) => item.event_id));
        setAvailableEvents((publicData.events || []).filter((event) => event.display_status === "upcoming" && event.participation_open !== false && !joined.has(event.id) && !(Number(event.assignment_capacity) > 0 && Number(event.assignment_count) >= Number(event.assignment_capacity))));
    }, []);
    useEffect(() => { load().catch((error) => setFeedback(error.message)).finally(() => setLoading(false)); }, [load]);
    const now = Date.now();
    const assignmentGroups = [
        { title: "Upcoming assignments", items: assignments.filter((item) => new Date(item.event?.start_date?.replace(" ", "T") || 0).getTime() >= now) },
        { title: "Previous assignments", items: assignments.filter((item) => new Date(item.event?.start_date?.replace(" ", "T") || 0).getTime() < now) }
    ].filter((group) => group.items.length);

    async function joinEvent(eventId) {
        setFeedback("");
        try { await signUpForEventAssignment(eventId); await load(); setFeedback("Your sign-up was sent for council review."); }
        catch (error) { setFeedback(error.message); }
    }

    if (loading) return <PublicPageSkeleton className="my-events-page member-events-page ui-member-events-loading">
        <header className="events-header"><SkeletonBlock className="ui-skeleton-eyebrow" /><SkeletonBlock className="ui-skeleton-title" /><SkeletonBlock className="ui-skeleton-description" /></header>
        <section className="member-assignment-section" aria-hidden="true"><header><div><SkeletonBlock className="ui-skeleton-eyebrow" /><SkeletonBlock className="ui-skeleton-section-title" /><SkeletonBlock className="ui-skeleton-description" /></div></header><SkeletonRows count={2} /></section>
        <section className="my-events-registration-section" aria-hidden="true"><header><SkeletonBlock className="ui-skeleton-eyebrow" /><SkeletonBlock className="ui-skeleton-section-title" /><SkeletonBlock className="ui-skeleton-description" /></header><SkeletonRows count={3} image /></section>
    </PublicPageSkeleton>;
    return <><Navbar /><main className="my-events-page member-events-page">
        <header className="events-header"><span>YOUR ACTIVITY</span><h1>My Events & assignments</h1><p>View your event registrations, QR passes, and official council assignment sign-ups.</p></header>
        {feedback && <p className="my-events-feedback" role="status">{feedback}</p>}
        <section className="member-assignment-section" aria-labelledby="member-assignment-heading"><header><div><span>COUNCIL PARTICIPATION</span><h2 id="member-assignment-heading">Event assignments</h2><p>Sign up to help with an upcoming event. Your request stays pending until reviewed.</p></div></header>
            {assignmentGroups.map((group) => <div className="member-assignment-group" key={group.title}><h3>{group.title}</h3><div className="member-assignment-list">{group.items.map((assignment) => <article key={assignment.id}><div><span className={`member-assignment-status is-${assignment.status}`}>{assignment.status}</span><h3>{assignment.event?.title}</h3><p>{assignment.event?.location} · {assignment.event?.start_date ? new Date(assignment.event.start_date.replace(" ", "T")).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }) : "Schedule pending"}</p>{assignment.event?.participation_requirements && <p className="member-assignment-requirements">Requirements: {assignment.event.participation_requirements}</p>}</div><Link to={`/events/${assignment.event?.id}`}>Event details →</Link></article>)}</div></div>)}
            {availableEvents.length > 0 ? <div className="member-assignment-list">{availableEvents.map((event) => <article key={event.id}><div><span className="member-assignment-status is-open">Sign-ups open</span><h3>{event.title}</h3><p>{event.location} · {new Date(event.start_date.replace(" ", "T")).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}</p>{event.participation_requirements && <p className="member-assignment-requirements">Requirements: {event.participation_requirements}</p>}{Number(event.assignment_capacity) > 0 && <p>{Math.max(0, Number(event.assignment_capacity) - Number(event.assignment_count || 0))} assignment places remain</p>}</div><button className="register-button" type="button" onClick={() => joinEvent(event.id)}>Sign up</button></article>)}</div> : assignments.length === 0 && <p className="member-assignment-empty">There are no upcoming assignment sign-ups right now.</p>}
        </section>
        <section className="my-events-registration-section" aria-labelledby="my-registrations-heading"><header><span>ATTENDANCE PASSES</span><h2 id="my-registrations-heading">Event registrations</h2><p>Open your individual QR pass for check-in. The code only grants access to your own registration.</p></header>
            <div className="my-events-list">{events.length ? events.map((registration) => <article className="my-event-card" key={registration.registration_id}><EventImage src={registration.cover_image} alt={registration.title} className="my-event-image"/><div><small>{new Date(registration.start_date.replace(" ", "T")).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" })}</small><h3>{registration.title}</h3><p>Status: <strong>{registration.status}</strong></p><Link to={`/registration/${registration.registration_code}`}>Open QR attendance pass →</Link></div></article>) : <div className="empty-events"><h3>No event registrations yet.</h3><p>Find an event and reserve your spot.</p><Link to="/events" className="register-button">Explore events</Link></div>}</div>
        </section>
    </main></>;
}
