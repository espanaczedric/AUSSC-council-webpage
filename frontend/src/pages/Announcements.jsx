import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import Navbar from "../components/Navbar";
import EventImage from "../components/EventImage";
import { SkeletonRows } from "../components/LoadingSkeletons";
import { getPublicAnnouncements, getPublicEventUpdates } from "../services/api";

const RECENT_WINDOW_DAYS = 45;
const announcementFilters = [
    { id: "all", label: "All recent notices" },
    { id: "newly_published", label: "New events" },
    { id: "details_updated", label: "Event changes" },
    { id: "event_cancelled", label: "Cancellations" },
    { id: "council_announcement", label: "Council announcements" }
];

function parseTimestamp(value) {
    if (!value) return null;
    const raw = String(value).trim();
    const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
    const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
    const date = new Date(hasTimezone ? normalized : `${normalized}${normalized.length === 10 ? "T00:00:00" : ""}+08:00`);
    return Number.isNaN(date.getTime()) ? null : date;
}

function announcementFor(event) {
    const publication = (event.publication_history || [])
        .filter((item) => item.decision === "approve" && item.status === "published")
        .map((item) => parseTimestamp(item.at))
        .filter(Boolean)
        .sort((first, second) => second - first)[0];
    const editedAt = parseTimestamp(event.updated_at);
    const date = parseTimestamp(event.public_updated_at)
        || publication
        || editedAt
        || parseTimestamp(event.created_at);

    if (!date) return null;
    let type = event.status === "cancelled" || event.publication_status === "cancelled"
        ? "event_cancelled"
        : event.public_update_type;
    if (!type) {
        type = publication && editedAt && editedAt > publication
            ? "details_updated"
            : "newly_published";
    }

    return { date, type: ["details_updated", "event_cancelled"].includes(type) ? type : "newly_published" };
}

function formatDate(value) {
    const date = parseTimestamp(value);
    return date
        ? date.toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" })
        : "Date to be announced";
}

function formatPostedDate(value) {
    return value.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" });
}

function formatPostedMonth(value) {
    return value.toLocaleDateString("en-PH", { month: "short", timeZone: "Asia/Manila" });
}

function formatPostedDay(value) {
    return value.toLocaleDateString("en-PH", { day: "2-digit", timeZone: "Asia/Manila" });
}

function noticeLabel(type) {
    if (type === "event_cancelled") return "Event cancelled";
    if (type === "council_announcement") return "Council announcement";
    return type === "details_updated" ? "Event details updated" : "New event announced";
}

function Announcements() {
    const [events, setEvents] = useState([]);
    const [councilNotices, setCouncilNotices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [query, setQuery] = useState("");
    const [activeFilter, setActiveFilter] = useState("all");

    useEffect(() => {
        let active = true;
        Promise.all([getPublicEventUpdates(), getPublicAnnouncements()])
            .then(([eventData, announcementData]) => {
                if (active) {
                    setEvents(eventData.updates || []);
                    setCouncilNotices(announcementData.announcements || []);
                }
            })
            .catch((requestError) => { if (active) setError(requestError.message || "Updates are temporarily unavailable."); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, []);

    const recentAnnouncements = useMemo(() => {
        const cutoff = Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
        const eventNotices = events.map((event) => ({ ...event, kind: "event", announcement: announcementFor(event) }));
        const standaloneNotices = councilNotices.map((notice) => ({
            ...notice,
            kind: "council",
            announcement: {
                date: parseTimestamp(notice.public_updated_at || notice.published_at || notice.created_at),
                type: "council_announcement"
            }
        }));
        return [...eventNotices, ...standaloneNotices]
            .filter((event) => event.announcement?.date && event.announcement.date.getTime() >= cutoff)
            .sort((first, second) => second.announcement.date - first.announcement.date);
    }, [events, councilNotices]);

    const visibleAnnouncements = useMemo(() => {
        const normalized = query.trim().toLowerCase();
        return recentAnnouncements.filter((event) => {
            const matchesFilter = activeFilter === "all" || event.announcement.type === activeFilter;
            const matchesQuery = !normalized || `${event.title || ""} ${event.location || ""} ${event.description || event.content || ""} ${event.category || ""}`.toLowerCase().includes(normalized);
            return matchesFilter && matchesQuery;
        });
    }, [recentAnnouncements, query, activeFilter]);

    const featuredAnnouncement = visibleAnnouncements[0];
    const followingAnnouncements = visibleAnnouncements.slice(1);

    return (
        <>
            <Navbar />
            <main className="updates-page page-enter">
                <header className="updates-hero">
                    <div>
                        <span className="eyebrow">Official council notices</span>
                        <h1>What’s new on campus.</h1>
                        <p>Official council announcements, new event notices, important changes, and cancellations. Browse the event calendar for every published event.</p>
                        <Link className="updates-hero-link" to="/events">Browse the full event calendar <span aria-hidden="true">→</span></Link>
                    </div>
                    <div className="updates-hero-stamp" aria-hidden="true"><span>NEWS</span><i>AU · SSC</i></div>
                </header>

                <section className="updates-list" aria-labelledby="updates-title">
                    <div className="updates-list-heading">
                        <div><span className="eyebrow">Last {RECENT_WINDOW_DAYS} days</span><h2 id="updates-title">Recent announcements</h2></div>
                        <label className="event-search">
                            <span className="sr-only">Search recent announcements</span>
                            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5" /></svg>
                            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notices" />
                        </label>
                    </div>

                    <div className="updates-toolbar" role="group" aria-label="Filter recent announcements">
                        {announcementFilters.map((filter) => (
                            <button key={filter.id} type="button" className={activeFilter === filter.id ? "is-active" : ""} aria-pressed={activeFilter === filter.id} onClick={() => setActiveFilter(filter.id)}>{filter.label}</button>
                        ))}
                    </div>

                    {loading ? (
                        <><SkeletonRows count={4} image className="updates-skeleton" /><span className="sr-only" role="status">Loading recent council announcements…</span></>
                    ) : error ? (
                        <div className="event-empty-state" role="alert"><h2>Updates aren’t available right now.</h2><p>{error}</p></div>
                    ) : featuredAnnouncement ? (
                        <>
                            <article className={`updates-featured${featuredAnnouncement.kind === "council" ? " is-council-announcement" : ""}`}>
                                {featuredAnnouncement.kind === "council"
                                    ? <div className="updates-announcement-artwork" aria-hidden="true"><span>AU · SSC</span><strong>NOTICE</strong></div>
                                    : <EventImage src={featuredAnnouncement.cover_image} alt={featuredAnnouncement.title} className="updates-featured-image" />}
                                <div className="updates-featured-copy">
                                    <div className="update-item-meta"><span className={`update-type-pill is-${featuredAnnouncement.announcement.type}`}>{noticeLabel(featuredAnnouncement.announcement.type)}</span><time dateTime={featuredAnnouncement.announcement.date.toISOString()}>{formatPostedDate(featuredAnnouncement.announcement.date)}</time></div>
                                    <h3>{featuredAnnouncement.title}</h3>
                                    <p>{featuredAnnouncement.content || featuredAnnouncement.description || "Open the event page for the latest information."}</p>
                                    <div className="update-item-footer">{featuredAnnouncement.kind === "council"
                                        ? <span>{featuredAnnouncement.category || "General"} · Official council notice</span>
                                        : <><span>{formatDate(featuredAnnouncement.start_date)} · {featuredAnnouncement.location || "Location to be announced"}</span><Link to={`/events/${featuredAnnouncement.id}`}>View event details <span aria-hidden="true">→</span></Link></>}</div>
                                </div>
                            </article>

                            {followingAnnouncements.length > 0 && <div className="updates-feed" aria-label="Earlier announcements">
                                {followingAnnouncements.map((notice) => (
                                    <article className={`update-item${notice.kind === "council" ? " is-council-announcement" : ""}`} key={`${notice.kind}-${notice.id}-${notice.announcement.date.toISOString()}`}>
                                        <div className="update-date"><span>{formatPostedMonth(notice.announcement.date)}</span><strong>{formatPostedDay(notice.announcement.date)}</strong></div>
                                        <div className="update-item-content">
                                            <div className="update-item-meta"><span className={`update-type-pill is-${notice.announcement.type}`}>{noticeLabel(notice.announcement.type)}</span><time dateTime={notice.announcement.date.toISOString()}>{formatPostedDate(notice.announcement.date)}</time></div>
                                            <h3>{notice.title}</h3>
                                            <p>{notice.content || notice.description || "Open the event page for the latest information."}</p>
                                            <div className="update-item-footer">{notice.kind === "council"
                                                ? <span>{notice.category || "General"} · Official council notice</span>
                                                : <><span>{formatDate(notice.start_date)} · {notice.location || "Location to be announced"}</span><Link to={`/events/${notice.id}`}>Event details <span aria-hidden="true">→</span></Link></>}</div>
                                        </div>
                                    </article>
                                ))}
                            </div>}
                        </>
                    ) : (
                        <div className="event-browser-empty event-empty-state"><span className="empty-state-mark" aria-hidden="true">✳</span><h2>{query || activeFilter !== "all" ? "No matching announcements" : "No recent council notices"}</h2><p>{query || activeFilter !== "all" ? "Try another search or filter." : `Council announcements, new events, and important event changes from the last ${RECENT_WINDOW_DAYS} days will appear here. The event calendar has the complete upcoming and past event list.`}</p><Link className="text-button" to="/events">Browse all events</Link></div>
                    )}
                </section>
            </main>
        </>
    );
}

export default Announcements;
