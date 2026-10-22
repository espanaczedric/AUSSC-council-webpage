import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import { SkeletonRows } from "../components/LoadingSkeletons";
import { getPublicEvents } from "../services/api";

function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? "Date to be announced"
        : date.toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" });
}

function Announcements() {
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [query, setQuery] = useState("");

    useEffect(() => {
        let active = true;
        getPublicEvents()
            .then((data) => { if (active) setEvents(data.events || []); })
            .catch((requestError) => { if (active) setError(requestError.message || "Updates are temporarily unavailable."); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, []);

    const updates = useMemo(() => {
        const normalized = query.trim().toLowerCase();
        return events
            .filter((event) => !normalized || `${event.title || ""} ${event.location || ""} ${event.description || ""}`.toLowerCase().includes(normalized))
            .sort((first, second) => new Date(second.start_date) - new Date(first.start_date));
    }, [events, query]);

    return (
        <>
            <Navbar />
            <main className="updates-page page-enter">
                <header className="updates-hero">
                    <div>
                        <span className="eyebrow">Council updates</span>
                        <h1>News from the campus calendar.</h1>
                        <p>Published event details and updates from the Student Council, gathered in one place.</p>
                    </div>
                    <div className="updates-hero-stamp" aria-hidden="true"><span>AU</span><i>SSC</i></div>
                </header>

                <section className="updates-list" aria-labelledby="updates-title">
                    <div className="updates-list-heading">
                        <div><span className="eyebrow">Published events</span><h2 id="updates-title">Event updates</h2></div>
                        <label className="event-search">
                            <span className="sr-only">Search event updates</span>
                            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5" /></svg>
                            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search updates" />
                        </label>
                    </div>

                    {loading ? (
                        <><SkeletonRows count={4} className="updates-skeleton" /><span className="sr-only" role="status">Loading published event updates…</span></>
                    ) : error ? (
                        <div className="event-empty-state" role="alert"><h2>Updates aren’t available right now.</h2><p>{error}</p></div>
                    ) : updates.length ? (
                        <div className="updates-feed">
                            {updates.map((event, index) => {
                                const status = event.display_status || event.status;
                                const label = status === "ongoing" ? "Now live" : status === "completed" ? "Past event" : "Coming soon";
                                return (
                                    <article className="update-item" key={event.id} style={{ "--stagger": `${Math.min(index, 7) * 50}ms` }}>
                                        <div className="update-date"><span>{new Date(event.start_date).toLocaleDateString("en-PH", { month: "short" })}</span><strong>{new Date(event.start_date).toLocaleDateString("en-PH", { day: "2-digit" })}</strong></div>
                                        <div className="update-item-content">
                                            <div className="update-item-meta"><span className={`event-status-pill${status === "ongoing" ? " is-live" : ""}`}>{label}</span><span>{formatDate(event.start_date)}</span></div>
                                            <h3>{event.title}</h3>
                                            <p>{event.description || "Event details will be shared soon."}</p>
                                            <div className="update-item-footer"><span>{event.location || "Location to be announced"}</span><Link to={`/events/${event.id}`}>View event <span aria-hidden="true">→</span></Link></div>
                                        </div>
                                    </article>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="event-browser-empty event-empty-state"><span className="empty-state-mark" aria-hidden="true">✳</span><h2>{query ? "No matching updates" : "No published event updates yet"}</h2><p>{query ? "Try a different search." : "When events are published, their details will appear here."}</p>{query && <button type="button" className="text-button" onClick={() => setQuery("")}>Clear search</button>}</div>
                    )}
                </section>
            </main>
        </>
    );
}

export default Announcements;
