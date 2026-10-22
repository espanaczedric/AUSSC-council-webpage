import { useEffect, useState } from "react";

import AdminNav from "../../components/AdminNav";
import EventImage from "../../components/EventImage";
import { AdminPageSkeleton, SkeletonBlock, SkeletonPageHeading, SkeletonRows } from "../../components/LoadingSkeletons";
import {
    createAdminHighlight,
    deleteAdminHighlight,
    getEventImageUrl,
    getAdminEvents,
    getAdminHighlights
} from "../../services/api";

function EventHighlightsManager() {
    const [events, setEvents] = useState([]);
    const [highlights, setHighlights] = useState([]);
    const [form, setForm] = useState({
        event_id: "",
        title: "",
        description: "",
        media_url: "",
        media_type: "image"
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [pendingDelete, setPendingDelete] = useState(null);

    async function loadHighlights() {
        const data = await getAdminHighlights();
        setHighlights(data.highlights || []);
    }

    useEffect(() => {
        Promise.all([getAdminEvents(), getAdminHighlights()])
            .then(([eventData, highlightData]) => {
                const loadedEvents = eventData.events || [];
                setEvents(loadedEvents);
                setHighlights(highlightData.highlights || []);
                if (loadedEvents.length) {
                    setForm((current) => ({ ...current, event_id: String(loadedEvents[0].id) }));
                }
            })
            .catch((requestError) => setError(requestError.message))
            .finally(() => setLoading(false));
    }, []);

    function handleChange(event) {
        const { name, value } = event.target;
        setForm((current) => ({ ...current, [name]: value }));
    }

    async function handleSubmit(event) {
        event.preventDefault();
        setSaving(true);
        setError("");
        setNotice("");

        try {
            await createAdminHighlight(form);
            await loadHighlights();
            setForm((current) => ({
                ...current,
                title: "",
                description: "",
                media_url: ""
            }));
            setNotice("Highlight added.");
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setSaving(false);
        }
    }

    async function handleDelete(id) {
        setError("");
        try {
            await deleteAdminHighlight(id);
            setHighlights((current) => current.filter((highlight) => highlight.id !== id));
            setPendingDelete(null);
            setNotice("Highlight deleted.");
        } catch (requestError) {
            setError(requestError.message);
        }
    }

    if (loading) return <AdminPageSkeleton>
        <header className="admin-header admin-page-heading"><SkeletonPageHeading /></header>
        <div className="admin-highlight-layout"><section className="admin-form admin-highlight-form ui-skeleton-form"><SkeletonBlock className="ui-skeleton-section-title" />{Array.from({ length: 5 }, (_, index) => <div key={index}><SkeletonBlock className="ui-skeleton-form-label" /><SkeletonBlock className="ui-skeleton-form-field" /></div>)}<SkeletonBlock className="ui-skeleton-button" /></section><section className="admin-highlight-list"><SkeletonBlock className="ui-skeleton-section-title" /><SkeletonRows count={4} image /></section></div>
    </AdminPageSkeleton>;

    return (
        <>
        <AdminNav />
        <main className="admin-page">
            <section className="admin-header admin-page-heading">
                <div>
                    <span>EVENT CONTENT</span>
                    <h1>Highlights</h1>
                    <p>{highlights.length} event highlight{highlights.length === 1 ? "" : "s"}</p>
                </div>
            </section>

            {error && <p className="admin-feedback is-error" role="alert">{error}</p>}
            {notice && <p className="admin-feedback" role="status">{notice}</p>}

            <div className="admin-highlight-layout">
                <form className="admin-form admin-highlight-form" onSubmit={handleSubmit}>
                    <div className="admin-section-heading">
                        <div>
                            <span>ADD HIGHLIGHT</span>
                            <h2>Share a moment</h2>
                        </div>
                    </div>

                    <label htmlFor="highlight-event">Event</label>
                    <select
                        id="highlight-event"
                        name="event_id"
                        value={form.event_id}
                        onChange={handleChange}
                        required
                        disabled={!events.length}
                    >
                        {events.length ? events.map((event) => (
                            <option key={event.id} value={event.id}>{event.title}</option>
                        )) : <option value="">No events available</option>}
                    </select>

                    <label htmlFor="highlight-title">Title</label>
                    <input
                        id="highlight-title"
                        name="title"
                        value={form.title}
                        onChange={handleChange}
                        maxLength={255}
                        required
                    />

                    <label htmlFor="highlight-description">Description</label>
                    <textarea
                        id="highlight-description"
                        name="description"
                        rows={4}
                        value={form.description}
                        onChange={handleChange}
                        required
                    />

                    <label htmlFor="highlight-media-url">Image or video URL</label>
                    <input
                        id="highlight-media-url"
                        name="media_url"
                        value={form.media_url}
                        onChange={handleChange}
                        placeholder="https://… or /uploads/highlights/…"
                        required
                    />

                    <label htmlFor="highlight-media-type">Media type</label>
                    <select
                        id="highlight-media-type"
                        name="media_type"
                        value={form.media_type}
                        onChange={handleChange}
                    >
                        <option value="image">Image</option>
                        <option value="video">Video</option>
                    </select>

                    <button className="admin-primary-action" type="submit" disabled={saving || !events.length}>
                        {saving ? "Adding…" : "Add highlight"}
                    </button>
                </form>

                <section className="admin-highlight-list" aria-label="Current event highlights">
                    <div className="admin-section-heading">
                        <div>
                            <span>LIBRARY</span>
                            <h2>Current highlights</h2>
                        </div>
                    </div>

                    {highlights.length ? (
                        <div className="admin-highlight-items">
                            {highlights.map((highlight) => (
                                <article className="admin-highlight-item" key={highlight.id}>
                                    {highlight.media_type === "image" ? (
                                        <EventImage src={highlight.media_url} alt={highlight.title} className="admin-highlight-thumb" />
                                    ) : (
                                        <div className="admin-highlight-video-thumb">VIDEO</div>
                                    )}
                                    <div className="admin-highlight-copy">
                                        <span>{highlight.event_title} · {highlight.media_type}</span>
                                        <h3>{highlight.title}</h3>
                                        <p>{highlight.description}</p>
                                        {highlight.media_type === "video" && (
                                            <a href={getEventImageUrl(highlight.media_url)} target="_blank" rel="noreferrer" className="admin-text-link">
                                                Open video
                                            </a>
                                        )}
                                        {pendingDelete === highlight.id ? (
                                            <div className="admin-inline-confirm" role="group" aria-label={`Delete ${highlight.title}`}>
                                                <span>Delete this highlight?</span>
                                                <button type="button" className="admin-text-link is-danger" onClick={() => handleDelete(highlight.id)}>Delete</button>
                                                <button type="button" className="admin-text-link" onClick={() => setPendingDelete(null)}>Cancel</button>
                                            </div>
                                        ) : (
                                            <button type="button" className="admin-text-link is-danger" onClick={() => setPendingDelete(highlight.id)}>Delete</button>
                                        )}
                                    </div>
                                </article>
                            ))}
                        </div>
                    ) : (
                        <div className="admin-empty-state">
                            <h2>No highlights yet</h2>
                            <p>Highlights added here appear on their event detail page.</p>
                        </div>
                    )}
                </section>
            </div>
        </main>
        </>
    );
}

export default EventHighlightsManager;
