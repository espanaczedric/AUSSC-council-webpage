import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import AdminNav from "../../components/AdminNav";
import EventImage from "../../components/EventImage";
import { getAdminEvents } from "../../services/api";

function AdminDashboard() {
    const [overview, setOverview] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        getAdminEvents()
            .then(setOverview)
            .catch((requestError) => {
                if (requestError.code === "API_URL_NOT_CONFIGURED") {
                    setError("This frontend deployment is missing VITE_API_URL. In Vercel, add VITE_API_URL with your deployed backend address ending in /api, then redeploy the frontend.");
                    return;
                }
                if (requestError.status === 401) {
                    setError("Your administrator session has expired. Sign in again.");
                    return;
                }
                const reference = requestError.requestId ? ` (Reference: ${requestError.requestId})` : "";
                setError(`${requestError.message || "Could not load dashboard data."}${reference}`);
            })
            .finally(() => setLoading(false));
    }, []);

    const stats = overview?.stats || {};
    const upcomingEvents = (overview?.events || [])
        .filter((event) => ["upcoming", "ongoing"].includes(event.status) && [undefined, "published"].includes(event.publication_status))
        .sort((first, second) => new Date(first.start_date) - new Date(second.start_date))
        .slice(0, 4);

    const metrics = [
        { label: "Total events", value: stats.event_count ?? "—", to: "/admin/events" },
        { label: "Upcoming / live", value: stats.active_event_count ?? "—", to: "/admin/events" },
        { label: "Registrations", value: stats.registration_count ?? "—", to: "/admin/registrations" },
        { label: "Students", value: stats.student_count ?? "—", to: "/admin/users" }
    ];

    return (
        <>
            <AdminNav />
            <main className="admin-page admin-dashboard">
                <section className="admin-header admin-page-heading">
                    <div>
                        <span>OPERATIONS</span>
                        <h1>Dashboard</h1>
                        <p>Track campus events and attendee activity.</p>
                    </div>
                    <Link to="/admin/events/create" className="admin-primary-action">
                        <span aria-hidden="true">+</span>
                        Create event
                    </Link>
                </section>

                {error && (
                    <p className="admin-feedback is-error" role="alert">
                        {error}
                    </p>
                )}

                <section className="admin-metrics" aria-label="Event statistics">
                    {metrics.map((metric) => (
                        <Link className="admin-metric" key={metric.label} to={metric.to}>
                            <span>{metric.label}</span>
                            <strong>{loading ? "—" : metric.value}</strong>
                        </Link>
                    ))}
                </section>

                <section className="admin-section">
                    <div className="admin-section-heading">
                        <div>
                            <span>WHAT'S NEXT</span>
                            <h2>Upcoming events</h2>
                        </div>
                        <Link to="/admin/events" className="admin-text-link">All events</Link>
                    </div>

                    {loading ? (
                        <p className="admin-feedback" role="status">Loading event data…</p>
                    ) : upcomingEvents.length ? (
                        <div className="admin-upcoming-list">
                            {upcomingEvents.map((event) => (
                                <article className="admin-upcoming-row" key={event.id}>
                                    <EventImage
                                        src={event.cover_image}
                                        alt=""
                                        className="admin-upcoming-thumb"
                                    />
                                    <div className="admin-upcoming-copy">
                                        <span className={`admin-status is-${event.status}`}>
                                            {event.status === "ongoing" ? "Happening now" : "Upcoming"}
                                        </span>
                                        <h3>{event.title}</h3>
                                        <p>{new Date(event.start_date).toLocaleString("en-US", {
                                            month: "short",
                                            day: "numeric",
                                            year: "numeric",
                                            hour: "numeric",
                                            minute: "2-digit"
                                        })} · {event.location}</p>
                                    </div>
                                    <span className="admin-registration-count">
                                        {event.registration_count} / {event.capacity} registered
                                    </span>
                                </article>
                            ))}
                        </div>
                    ) : (
                        <div className="admin-empty-state">
                            <h3>No upcoming events</h3>
                            <p>Create an event to publish it to the student-facing site.</p>
                            <Link to="/admin/events/create" className="admin-text-link">Create an event</Link>
                        </div>
                    )}
                </section>
            </main>
        </>
    );
}

export default AdminDashboard;
