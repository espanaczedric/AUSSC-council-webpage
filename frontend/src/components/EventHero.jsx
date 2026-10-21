import { Link } from "react-router-dom";
import EventImage from "./EventImage";

function EventHero({ event }) {
    const eventStatus = event?.display_status || event?.status;
    const eventDate = event?.start_date
        ? new Date(event.start_date).toLocaleDateString("en-PH", {
            month: "short",
            day: "numeric",
            year: "numeric"
        })
        : "Date to be announced";

    return (
        <section className="home-hero">
            <div className="home-hero-decoration" aria-hidden="true" />
            <div className="home-hero-inner">
                <div className="home-hero-copy">
                    <span className="eyebrow">Araullo University South Student Council</span>
                    <h1>Student voices.<br />A stronger campus.</h1>
                    <p>We bring students together through service, leadership, and campus experiences shaped by our community.</p>
                    <div className="home-hero-actions">
                        <Link to="/events" className="register-button">Explore events</Link>
                        <a href="#council" className="details-button">Get to know us</a>
                    </div>
                </div>

                {event ? (
                    <article className="home-featured-event">
                        <Link className="home-featured-image-link" to={`/events/${event.id}`} aria-label={`View ${event.title}`}>
                            <EventImage
                                src={event.cover_image}
                                alt={event.title}
                                className="home-featured-image"
                                loading="eager"
                            />
                        </Link>
                        <div className="home-featured-copy">
                            <span className={`event-status-pill${eventStatus === "ongoing" ? " is-live" : ""}`}>
                                {eventStatus === "ongoing" ? "Now live" : "Coming soon"}
                            </span>
                            <h2>{event.title}</h2>
                            <p className="home-featured-meta">{eventDate}{event.location ? ` · ${event.location}` : ""}</p>
                            <Link to={`/events/${event.id}`} className="home-featured-link">Event details <span aria-hidden="true">→</span></Link>
                        </div>
                    </article>
                ) : (
                    <div className="home-event-empty">
                        <span className="home-event-mark" aria-hidden="true">A</span>
                        <p>Good things are taking shape.</p>
                        <strong>New campus events will be announced here.</strong>
                        <Link to="/events">Browse event archive <span aria-hidden="true">→</span></Link>
                    </div>
                )}
            </div>
            <div className="home-hero-footer" aria-hidden="true"><span /> Campus life, shaped together</div>
        </section>
    );
}

export default EventHero;
