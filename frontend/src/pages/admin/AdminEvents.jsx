import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import AdminNav from "../../components/AdminNav";
import EventImage from "../../components/EventImage";
import { AdminPageSkeleton, SkeletonBlock, SkeletonPageHeading, SkeletonRows } from "../../components/LoadingSkeletons";
import { archiveAdminEvent, deleteAdminEvent, getAdminEvents, retryAdminEventNotifications } from "../../services/api";

function AdminEvents() {
    const location = useLocation();
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [query, setQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");
    const [pendingAction, setPendingAction] = useState(null);
    const [actingEventId, setActingEventId] = useState(null);
    const [notice, setNotice] = useState(location.state?.eventNotice || "");
    const [noticeIsWarning, setNoticeIsWarning] = useState(Boolean(location.state?.eventNoticeFailed || location.state?.eventNoticeEmpty));

    useEffect(() => {
        getAdminEvents()
            .then((data) => setEvents(data.events || []))
            .catch((requestError) => setError(requestError.message))
            .finally(() => setLoading(false));
    }, []);

    const filteredEvents = events.filter((event) => {
        const matchesStatus = statusFilter === "all" || (event.publication_status || "published") === statusFilter;
        const normalizedQuery = query.trim().toLowerCase();
        const matchesQuery = !normalizedQuery ||
            `${event.title} ${event.location}`.toLowerCase().includes(normalizedQuery);

        return matchesStatus && matchesQuery;
    });

    if (loading) return <AdminPageSkeleton className="admin-events-page">
        <header className="admin-header admin-page-heading"><SkeletonPageHeading /></header>
        <section className="admin-list-section"><div className="admin-list-toolbar"><SkeletonBlock className="ui-skeleton-search" /><SkeletonBlock className="ui-skeleton-filter" /></div><SkeletonRows count={5} image /></section>
    </AdminPageSkeleton>;

    async function confirmEventAction(event) {
        if (!pendingAction || pendingAction.id !== event.id) return;
        const action = pendingAction.action;
        setActingEventId(event.id);
        setError("");
        setNotice("");
        setNoticeIsWarning(false);

        try {
            if (action === "delete") {
                const result = await deleteAdminEvent(event.id);
                setEvents((current) => current.filter((item) => item.id !== event.id));
                setNotice(`${result.event_title} was permanently deleted.`);
            } else {
                const result = await archiveAdminEvent(event.id);
                setEvents((current) => current.map((item) => item.id === event.id ? { ...item, publication_status: "archived" } : item));
                setNotice(`${result.event_title} was archived. Historical records remain available.`);
            }
            setPendingAction(null);
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setActingEventId(null);
        }
    }

    async function retryNotifications(event) {
        setActingEventId(event.id);
        setError("");
        setNotice("");
        try {
            const result = await retryAdminEventNotifications(event.id);
            const notifications = result.notifications || {};
            setEvents((current) => current.map((item) => item.id === event.id ? {
                ...item,
                notification_delivery_status: notifications.failed_count ? "failed" : notifications.recipient_count ? "sent" : "no_recipients",
                notification_recipient_count: notifications.recipient_count || 0,
                notification_delivered_count: notifications.delivered_count || 0
            } : item));
            setNotice(result.message || "Council notifications retried.");
            setNoticeIsWarning(Boolean(notifications.failed_count || !notifications.recipient_count));
        } catch (requestError) {
            setError(requestError.message || "Council notifications could not be retried.");
        } finally {
            setActingEventId(null);
        }
    }

    return (
        <>
            <AdminNav />
            <main className="admin-page admin-events-page">
                <section className="admin-header admin-page-heading">
                    <div>
                        <span>EVENT OPERATIONS</span>
                        <h1>Events</h1>
                        <p>{events.length} event{events.length === 1 ? "" : "s"} in your program.</p>
                    </div>
                    <Link to="/admin/events/create" className="admin-primary-action">
                        <span aria-hidden="true">+</span>
                        Create event
                    </Link>
                </section>

                <section className="admin-list-section" aria-label="Manage events">
                    <div className="admin-list-toolbar">
                        <label className="admin-search-field">
                            <span className="sr-only">Search events</span>
                            <input
                                type="search"
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                                placeholder="Search title or location"
                            />
                        </label>
                        <label className="admin-filter-field">
                            <span className="sr-only">Filter by status</span>
                            <select
                                value={statusFilter}
                                onChange={(event) => setStatusFilter(event.target.value)}
                            >
                                <option value="all">All statuses</option>
                                <option value="draft">Draft</option>
                                <option value="pending_approval">Pending approval</option>
                                <option value="published">Published</option>
                                <option value="cancelled">Cancelled</option>
                                <option value="archived">Archived</option>
                            </select>
                        </label>
                    </div>

                    {error && <p className="admin-feedback is-error" role="alert">{error}</p>}
                    {notice && <p className={`admin-feedback${noticeIsWarning ? " is-warning" : ""}`} role="status">{notice}</p>}
                    {filteredEvents.length ? (
                        <div className="admin-event-list">
                            {filteredEvents.map((event) => (
                                <article className="admin-event-row" key={event.id}>
                                    <EventImage
                                        src={event.cover_image}
                                        alt=""
                                        className="admin-event-thumb"
                                    />
                                    <div className="admin-event-main">
                                        <span className={`admin-status is-${event.publication_status || "published"}`}>{(event.publication_status || "published").replace("_", " ")}</span>
                                        <h2>{event.title}</h2>
                                        <p>{event.location} · {event.status === "ongoing" ? "Happening now" : event.status}</p>
                                    </div>
                                    <div className="admin-event-date">
                                        <span>STARTS</span>
                                        <strong>{new Date(event.start_date).toLocaleString("en-US", {
                                            month: "short",
                                            day: "numeric",
                                            year: "numeric",
                                            hour: "numeric",
                                            minute: "2-digit"
                                        })}</strong>
                                    </div>
                                    <div className="admin-event-capacity">
                                        <span>COUNCIL PARTICIPATION</span>
                                        <strong>{event.accepted_response_count || 0} accepted · {event.pending_response_count || 0} pending · {event.declined_response_count || 0} declined</strong>
                                    </div>
                                    <div className="admin-event-actions">
                                        <Link className="admin-text-link" to={`/admin/events/${event.id}/edit`}>
                                            Edit
                                        </Link>
                                        {(event.publication_status || "published") === "published" && <Link className="admin-text-link" to={`/events/${event.id}`}>View</Link>}
                                        {event.notification_delivery_status === "failed" && <button className="admin-text-link" type="button" onClick={() => retryNotifications(event)} disabled={actingEventId === event.id}>{actingEventId === event.id ? "Retrying…" : "Retry notifications"}</button>}
                                        {(event.publication_status || "published") !== "archived" && <>
                                        <button
                                            className="admin-text-link is-danger"
                                            type="button"
                                            aria-expanded={pendingAction?.id === event.id && pendingAction.action === "archive"}
                                            onClick={() => setPendingAction((current) => current?.id === event.id && current.action === "archive" ? null : { id: event.id, action: "archive" })}
                                        >
                                            Archive
                                        </button>
                                        </>}
                                        <button
                                            className="admin-text-link is-danger"
                                            type="button"
                                            aria-expanded={pendingAction?.id === event.id && pendingAction.action === "delete"}
                                            onClick={() => setPendingAction((current) => current?.id === event.id && current.action === "delete" ? null : { id: event.id, action: "delete" })}
                                        >
                                            Delete
                                        </button>
                                    </div>
                                    {pendingAction?.id === event.id && (
                                        <div className="admin-delete-confirmation" role="group" aria-label={`Confirm ${pendingAction.action} of ${event.title}`}>
                                            <div>
                                                <strong>{pendingAction.action === "delete" ? `Permanently delete “${event.title}”?` : `Archive “${event.title}”?`}</strong>
                                                <p>{pendingAction.action === "delete"
                                                    ? "This can only be done when the event has no linked participation or historical records. Events with history must be archived instead."
                                                    : "It will leave public listings while preserving participation statuses, attendance history, and linked financial records."}</p>
                                            </div>
                                            <div>
                                                <button
                                                    className="admin-secondary-action"
                                                    type="button"
                                                    onClick={() => setPendingAction(null)}
                                                    disabled={actingEventId === event.id}
                                                >
                                                    Cancel
                                                </button>
                                                <button
                                                    className="admin-delete-confirm-button"
                                                    type="button"
                                                    onClick={() => confirmEventAction(event)}
                                                    disabled={actingEventId === event.id}
                                                >
                                                    {actingEventId === event.id
                                                        ? pendingAction.action === "delete" ? "Deleting…" : "Archiving…"
                                                        : pendingAction.action === "delete" ? "Delete event" : "Archive event"}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </article>
                            ))}
                        </div>
                    ) : (
                        <div className="admin-empty-state">
                            <h2>{events.length ? "No matching events" : "No events yet"}</h2>
                            <p>{events.length
                                ? "Try a different search or status filter."
                                : "Create your first event to notify council members and track participation."}</p>
                            {!events.length && (
                                <Link to="/admin/events/create" className="admin-text-link">Create an event</Link>
                            )}
                        </div>
                    )}
                </section>
            </main>
        </>
    );
}

export default AdminEvents;
