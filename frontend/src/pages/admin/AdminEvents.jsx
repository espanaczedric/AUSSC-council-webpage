import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import AdminNav from "../../components/AdminNav";
import EventImage from "../../components/EventImage";
import { AdminPageSkeleton, SkeletonBlock, SkeletonPageHeading, SkeletonRows } from "../../components/LoadingSkeletons";
import { deleteAdminEvent, getAdminEvents } from "../../services/api";

function AdminEvents() {
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [query, setQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");
    const [pendingDeleteId, setPendingDeleteId] = useState(null);
    const [deletingId, setDeletingId] = useState(null);
    const [notice, setNotice] = useState("");

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

    async function confirmDelete(event) {
        setDeletingId(event.id);
        setError("");
        setNotice("");

        try {
            const result = await deleteAdminEvent(event.id);
            setEvents((current) => current.map((item) => item.id === event.id ? { ...item, publication_status: "archived" } : item));
            setPendingDeleteId(null);
            setNotice(`${result.event_title} was archived. Historical records remain available.`);
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setDeletingId(null);
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
                    {notice && <p className="admin-feedback" role="status">{notice}</p>}
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
                                        <span>REGISTERED</span>
                                        <strong>{event.registration_count} / {event.capacity}</strong>
                                    </div>
                                    <div className="admin-event-actions">
                                        <Link className="admin-text-link" to={`/admin/events/${event.id}/edit`}>
                                            Edit
                                        </Link>
                                        {(event.publication_status || "published") === "published" && <Link className="admin-text-link" to={`/events/${event.id}`}>View</Link>}
                                        {(event.publication_status || "published") !== "archived" && <>
                                        <button
                                            className="admin-text-link is-danger"
                                            type="button"
                                            aria-expanded={pendingDeleteId === event.id}
                                            onClick={() => setPendingDeleteId((current) => current === event.id ? null : event.id)}
                                        >
                                            Archive
                                        </button>
                                        </>}
                                    </div>
                                    {pendingDeleteId === event.id && (
                                        <div className="admin-delete-confirmation" role="group" aria-label={`Confirm archive of ${event.title}`}>
                                            <div>
                                                <strong>Archive “{event.title}”?</strong>
                                                <p>It will leave public listings while preserving registrations, attendance, and linked financial history.</p>
                                            </div>
                                            <div>
                                                <button
                                                    className="admin-secondary-action"
                                                    type="button"
                                                    onClick={() => setPendingDeleteId(null)}
                                                    disabled={deletingId === event.id}
                                                >
                                                    Keep event
                                                </button>
                                                <button
                                                    className="admin-delete-confirm-button"
                                                    type="button"
                                                    onClick={() => confirmDelete(event)}
                                                    disabled={deletingId === event.id}
                                                >
                                                    {deletingId === event.id ? "Archiving…" : "Archive event"}
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
                                : "Create your first event to publish it to students."}</p>
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
