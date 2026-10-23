import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import Navbar from "../components/Navbar";
import EventImage from "../components/EventImage";
import { PublicPageSkeleton, SkeletonBlock, SkeletonEventCards, SkeletonPageHeading } from "../components/LoadingSkeletons";
import { getPublicEvents } from "../services/api";

const categories = [
    { id: "all", label: "All events" },
    { id: "upcoming", label: "Coming soon" },
    { id: "ongoing", label: "Now live" },
    { id: "past", label: "Past events" }
];

function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? "Date to be announced"
        : date.toLocaleDateString("en-PH", {
            month: "long",
            day: "numeric",
            year: "numeric"
        });
}

function Events() {
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [activeCategory, setActiveCategory] = useState("all");
    const [search, setSearch] = useState("");

    useEffect(() => {
        let active = true;

        async function loadEvents() {
            try {
                const data = await getPublicEvents();
                if (!active) return;
                setEvents(data.events || []);
            } catch (error) {
                if (active) setLoadError(true);
                console.error("Failed to load events:", error);
            } finally {
                if (active) setLoading(false);
            }
        }

        loadEvents();
        return () => { active = false; };
    }, []);

    const visibleEvents = useMemo(() => {
        const query = search.trim().toLowerCase();
        return events.filter((event) => {
            const status = event.display_status || event.status;
            const matchesCategory = activeCategory === "all"
                || (activeCategory === "past" ? status === "completed" : status === activeCategory);
            const matchesSearch = !query
                || `${event.title || ""} ${event.location || ""} ${event.description || ""}`.toLowerCase().includes(query);
            return matchesCategory && matchesSearch;
        });
    }, [events, activeCategory, search]);

    if (loading) return (
        <PublicPageSkeleton className="events-page events-loading-skeleton">
            <header className="events-header events-page-intro"><SkeletonPageHeading /></header>
            <section className="event-browser" aria-hidden="true">
                <div className="event-browser-toolbar">
                    <div className="ui-skeleton-filter-tabs">{Array.from({ length: 4 }, (_, index) => <SkeletonBlock key={index} />)}</div>
                    <SkeletonBlock className="ui-skeleton-search" />
                </div>
                <SkeletonEventCards />
            </section>
        </PublicPageSkeleton>
    );

    return (
        <>
            <Navbar />
            <main className="events-page">
                <header className="events-header events-page-intro">
                    <span className="eyebrow">Campus calendar</span>
                    <h1>Browse campus events.</h1>
                    <p>Search the event catalog, filter by date status, and open an event for details and council participation notices.</p>
                    <Link className="events-updates-link" to="/announcements">See recent council announcements <span aria-hidden="true">→</span></Link>
                </header>

                <section className="event-browser" aria-label="Browse events">
                    <div className="event-browser-toolbar">
                        <div className="event-filter-tabs" role="group" aria-label="Filter events by status">
                            {categories.map((category) => (
                                <button
                                    key={category.id}
                                    type="button"
                                    className={activeCategory === category.id ? "is-active" : ""}
                                    aria-pressed={activeCategory === category.id}
                                    onClick={() => setActiveCategory(category.id)}
                                >
                                    {category.label}
                                </button>
                            ))}
                        </div>
                        <label className="event-search">
                            <span className="sr-only">Search events</span>
                            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
                                <circle cx="10.8" cy="10.8" r="6.8" />
                                <path d="m16 16 4.5 4.5" />
                            </svg>
                            <input
                                type="search"
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                                placeholder="Search events"
                            />
                        </label>
                    </div>

                    {loadError ? (
                        <div className="event-empty-state" role="alert">
                            <h2>We couldn’t load the event list.</h2>
                            <p>Check your connection and try again in a moment.</p>
                        </div>
                    ) : visibleEvents.length ? (
                        <div className="events-grid">
                            {visibleEvents.map((event) => {
                                const status = event.display_status || event.status;
                                const statusLabel = status === "ongoing"
                                    ? "Now live"
                                    : status === "completed" ? "Past event" : "Coming soon";

                                return (
                                    <article className="event-card browse-event-card" key={event.id}>
                                        <Link className="browse-event-image-link" to={`/events/${event.id}`} aria-label={`View ${event.title}`}>
                                            <EventImage
                                                src={event.cover_image}
                                                alt={event.title}
                                                className="event-card-image"
                                            />
                                            <span className={`event-status-pill${status === "ongoing" ? " is-live" : ""}`}>
                                                {statusLabel}
                                            </span>
                                        </Link>
                                        <div className="event-card-content">
                                            <small>{formatDate(event.start_date)}</small>
                                            <h2>{event.title}</h2>
                                            <p className="browse-event-location">{event.location || "Location to be announced"}</p>
                                            <p className="browse-event-description">{event.description}</p>
                                            <Link className="browse-event-action" to={`/events/${event.id}`}>
                                                {status === "completed" ? "View event" : "Explore event"}
                                                <span aria-hidden="true">→</span>
                                            </Link>
                                        </div>
                                    </article>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="event-empty-state event-browser-empty">
                            <span className="empty-state-mark" aria-hidden="true">✳</span>
                            <h2>{search ? "No matching events" : "Nothing to show just yet"}</h2>
                            <p>{search ? "Try another title or location." : "Check back soon for new campus events and memories."}</p>
                            {(search || activeCategory !== "all") && (
                                <button className="text-button" type="button" onClick={() => { setSearch(""); setActiveCategory("all"); }}>
                                    Clear filters
                                </button>
                            )}
                        </div>
                    )}
                </section>
            </main>
        </>
    );
}

export default Events;
