import { useEffect, useState } from "react";
import {
    Link,
    useParams
} from "react-router-dom";

import Navbar from "../components/Navbar";
import EventImage from "../components/EventImage";
import { PublicPageSkeleton, SkeletonBlock } from "../components/LoadingSkeletons";
import { getEvent, getEventHighlights, getEventImageUrl } from "../services/api";

function EventDetailsPage() {

    const { id } = useParams();

    const [event, setEvent] = useState(null);
    const [highlights, setHighlights] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {

        async function loadEvent() {

            try {

                const data = await getEvent(id);

                if (data.success) {
                    setEvent(data.event);
                    try {
                        const highlightData = await getEventHighlights(id);
                        setHighlights(highlightData.highlights || []);
                    } catch (highlightError) {
                        console.error("Failed to load event highlights:", highlightError);
                    }
                }

            } catch (error) {

                console.error(
                    "Failed to load event:",
                    error
                );

            } finally {

                setLoading(false);

            }
        }

        loadEvent();

    }, [id]);


    if (loading) return <PublicPageSkeleton className="event-details-page event-details-loading-skeleton">
        <section className="event-details-hero" aria-hidden="true"><div className="event-details-overlay"><SkeletonBlock className="ui-skeleton-eyebrow" /><SkeletonBlock className="ui-skeleton-title" /></div></section>
        <div className="event-details-content" aria-hidden="true"><section className="event-main-info"><SkeletonBlock className="ui-skeleton-section-title" /><SkeletonBlock className="ui-skeleton-description" /><SkeletonBlock className="ui-skeleton-description is-short" /><SkeletonBlock className="ui-skeleton-section-title is-small" /><SkeletonBlock className="ui-skeleton-description" /><SkeletonBlock className="ui-skeleton-description" /></section><aside className="event-information"><SkeletonBlock className="ui-skeleton-description" /><SkeletonBlock className="ui-skeleton-description is-short" /><SkeletonBlock className="ui-skeleton-description" /><SkeletonBlock className="ui-skeleton-button" /></aside></div>
    </PublicPageSkeleton>;


    if (!event) {

        return (
            <>
                <Navbar />

                <main className="event-not-found">

                    <h1>
                        Event Not Found
                    </h1>

                    <Link to="/events">
                        Back to Events
                    </Link>

                </main>
            </>
        );

    }


    const startDate =
        new Date(event.start_date);

    const endDate =
        new Date(event.end_date);


    return (

        <>
            <Navbar />

            <main className="event-details-page">

                <section className="event-details-hero">

                    <EventImage
                        src={event.cover_image}
                        alt={event.title}
                        className="event-details-image"
                        loading="eager"
                    />

                    <div className="event-details-overlay">

                        <span>
                            {(event.display_status || event.status) === "ongoing"
                                ? "HAPPENING NOW"
                                : (event.display_status || event.status).toUpperCase()}
                        </span>

                        <h1>
                            {event.title}
                        </h1>

                    </div>

                </section>


                <section className="event-details-content">

                    <div className="event-main-info">

                        <h2>
                            About the Event
                        </h2>

                        <p>
                            {event.description}
                        </p>

                        <div className="event-actions">

                            {(event.display_status || event.status) !== "completed" &&
                             event.status !== "cancelled" && (

                                <Link
                                    to={`/register/${event.id}`}
                                    className="register-button"
                                >
                                    Register Now
                                </Link>

                            )}

                        </div>

                    </div>


                    <aside className="event-information">

                        <div>

                            <strong>
                                DATE
                            </strong>

                            <p>
                                {startDate.toLocaleDateString(
                                    "en-US",
                                    {
                                        month: "long",
                                        day: "numeric",
                                        year: "numeric"
                                    }
                                )}
                            </p>

                        </div>


                        <div>

                            <strong>
                                TIME
                            </strong>

                            <p>
                                {startDate.toLocaleTimeString(
                                    "en-US",
                                    {
                                        hour: "numeric",
                                        minute: "2-digit"
                                    }
                                )}

                                {" — "}

                                {endDate.toLocaleTimeString(
                                    "en-US",
                                    {
                                        hour: "numeric",
                                        minute: "2-digit"
                                    }
                                )}
                            </p>

                        </div>


                        <div>

                            <strong>
                                LOCATION
                            </strong>

                            <p>
                                {event.location}
                            </p>

                        </div>


                        <div>

                            <strong>
                                CAPACITY
                            </strong>

                            <p>
                                {event.capacity > 0
                                    ? `${event.capacity} participants`
                                    : "No limit"}
                            </p>

                        </div>

                    </aside>

                </section>

                {highlights.length > 0 && (
                    <section className="event-highlights-section">
                        <div className="event-highlights-heading">
                            <span>THE MOMENTS</span>
                            <h2>Event highlights</h2>
                        </div>
                        <div className="event-highlights-grid">
                            {highlights.map((highlight) => (
                                <article className="event-highlight-card" key={highlight.id}>
                                    {highlight.media_type === "video" ? (
                                        <video controls preload="metadata">
                                            <source src={getEventImageUrl(highlight.media_url)} />
                                        </video>
                                    ) : (
                                        <EventImage
                                            src={highlight.media_url}
                                            alt={highlight.title}
                                            className="event-highlight-image"
                                        />
                                    )}
                                    <div>
                                        <span>{highlight.media_type === "video" ? "VIDEO" : "PHOTO"}</span>
                                        <h3>{highlight.title}</h3>
                                        {highlight.description && <p>{highlight.description}</p>}
                                    </div>
                                </article>
                            ))}
                        </div>
                    </section>
                )}

            </main>
        </>
    );
}

export default EventDetailsPage;
