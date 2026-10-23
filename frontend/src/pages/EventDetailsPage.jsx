import { useEffect, useState } from "react";
import QRCode from "react-qr-code";
import {
    Link,
    useParams
} from "react-router-dom";

import Navbar from "../components/Navbar";
import EventImage from "../components/EventImage";
import { PublicPageSkeleton, SkeletonBlock } from "../components/LoadingSkeletons";
import { getEvent, getEventHighlights, getEventImageUrl, getStudentEventQr, respondToEvent, respondToStudentEventParticipation } from "../services/api";

function EventDetailsPage() {

    const { id } = useParams();

    const [event, setEvent] = useState(null);
    const [councilResponse, setCouncilResponse] = useState(null);
    const [highlights, setHighlights] = useState([]);
    const [loading, setLoading] = useState(true);
    const [responseBusy, setResponseBusy] = useState(false);
    const [responseMessage, setResponseMessage] = useState("");
    const [studentQrValue, setStudentQrValue] = useState("");
    const [studentQrEventId, setStudentQrEventId] = useState(null);
    const [studentQrBusy, setStudentQrBusy] = useState(false);
    const [studentQrMessage, setStudentQrMessage] = useState("");
    const [studentParticipation, setStudentParticipation] = useState(null);
    const [studentParticipationBusy, setStudentParticipationBusy] = useState(false);
    const [studentParticipationMessage, setStudentParticipationMessage] = useState("");

    useEffect(() => {
        let active = true;
        setLoading(true);
        setEvent(null);
        setCouncilResponse(null);
        setHighlights([]);
        setStudentQrValue("");
        setStudentQrEventId(null);
        setStudentQrMessage("");
        setStudentParticipation(null);
        setStudentParticipationMessage("");

        async function loadEvent() {

            try {

                const data = await getEvent(id);

                if (active && data.success) {
                    setEvent({
                        ...data.event,
                        council_can_respond: Boolean(data.council_can_respond),
                        student_can_participate: Boolean(data.student_can_participate),
                        student_needs_sign_in: Boolean(data.student_needs_sign_in),
                        student_participation: data.student_participation || null,
                        student_can_generate_qr: Boolean(data.student_can_generate_qr)
                    });
                    setCouncilResponse(data.council_response || null);
                    setStudentParticipation(data.student_participation || null);
                    try {
                        const highlightData = await getEventHighlights(id);
                        if (active) setHighlights(highlightData.highlights || []);
                    } catch (highlightError) {
                        if (active) console.error("Failed to load event highlights:", highlightError);
                    }
                }

            } catch (error) {

                if (active) console.error("Failed to load event:", error);

            } finally {

                if (active) setLoading(false);

            }
        }

        loadEvent();

        return () => { active = false; };
    }, [id]);

    async function saveResponse(status) {
        setResponseBusy(true);
        setResponseMessage("");
        try {
            const data = await respondToEvent(event.id, status);
            setCouncilResponse(data.response || { status, responded_at: new Date().toISOString() });
            setResponseMessage(data.message || "Your participation choice was saved.");
        } catch (error) {
            setResponseMessage(error.message || "Your participation could not be saved.");
        } finally {
            setResponseBusy(false);
        }
    }

    async function generateStudentQr() {
        if (!event?.id) return;
        setStudentQrBusy(true);
        setStudentQrMessage("");
        try {
            const data = await getStudentEventQr(event.id);
            setStudentQrValue(data.qr_value || "");
            setStudentQrEventId(data.event?.id ?? event.id);
            setStudentQrMessage(data.message || "Your QR is ready for this event.");
        } catch (error) {
            setStudentQrMessage(error.message || "An event QR could not be generated.");
        } finally {
            setStudentQrBusy(false);
        }
    }

    async function updateStudentParticipation(status) {
        if (!event?.id) return;
        setStudentParticipationBusy(true);
        setStudentParticipationMessage("");
        setStudentQrValue("");
        setStudentQrEventId(null);
        setStudentQrMessage("");
        try {
            const data = await respondToStudentEventParticipation(event.id, status);
            setStudentParticipation(data.participation || { status });
            setEvent((current) => ({ ...current, student_can_generate_qr: Boolean(data.participation?.can_generate_qr) }));
            setStudentParticipationMessage(data.message || "Your participation was updated.");
        } catch (error) {
            setStudentParticipationMessage(error.message || "Your participation could not be updated.");
        } finally {
            setStudentParticipationBusy(false);
        }
    }


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
    const responseStatus = councilResponse?.status || "pending";


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

                            {event.council_can_respond && event.status !== "cancelled" && event.publication_status !== "archived" && <section className="event-council-response" aria-label="Council event participation">
                                <span className="eyebrow">COUNCIL PARTICIPATION</span>
                                <h3>Your participation: <span className={`admin-status is-${responseStatus}`}>{responseStatus}</span></h3>
                                <p>This records your intent to help with this event. It is separate from task assignments and attendance.</p>
                                <div className="event-council-response-actions">
                                    <button className="admin-primary-action" type="button" onClick={() => saveResponse("accepted")} disabled={responseBusy || responseStatus === "accepted"}>{responseBusy && responseStatus !== "accepted" ? "Saving…" : responseStatus === "accepted" ? "Accepted" : "Accept participation"}</button>
                                    <button className="admin-secondary-action" type="button" onClick={() => saveResponse("declined")} disabled={responseBusy || responseStatus === "declined"}>{responseBusy && responseStatus !== "declined" ? "Saving…" : responseStatus === "declined" ? "Declined" : "Decline"}</button>
                                </div>
                                {councilResponse?.responded_at && <small>Responded {new Date(String(councilResponse.responded_at).replace(" ", "T")).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}</small>}
                                {responseMessage && <p role="status">{responseMessage}</p>}
                            </section>}

                            {event.student_needs_sign_in && <section className="event-student-qr" aria-label="Student event participation">
                                <span className="eyebrow">STUDENT PARTICIPATION</span>
                                <h3>Sign in to participate</h3>
                                <p>Sign in to agree to participate in this event. Your event QR becomes available here after you agree.</p>
                                <Link className="admin-primary-action" to={`/login?next=${encodeURIComponent(`/events/${event.id}`)}`}>Sign in to participate</Link>
                            </section>}

                            {event.student_can_participate && <section className="event-student-qr" aria-label="Student event participation and attendance QR">
                                <span className="eyebrow">STUDENT PARTICIPATION</span>
                                <h3>{studentParticipation?.status === "accepted" ? "You’re participating" : studentParticipation?.status === "withdrawn" ? "Participation withdrawn" : "Will you participate?"}</h3>
                                <p>Agree to participate to unlock an event-specific QR. It contains this event’s title and description. Attendance is recorded only when the QR is scanned at check-in.</p>
                                <div className="event-council-response-actions">
                                    {studentParticipation?.status !== "accepted" ? <button className="admin-primary-action" type="button" onClick={() => updateStudentParticipation("accepted")} disabled={studentParticipationBusy}>{studentParticipationBusy ? "Saving…" : "Agree to participate"}</button> : <button className="admin-secondary-action" type="button" onClick={() => updateStudentParticipation("withdrawn")} disabled={studentParticipationBusy}>{studentParticipationBusy ? "Saving…" : "Withdraw participation"}</button>}
                                    {studentParticipation?.status === "accepted" && event.student_can_generate_qr && <button className="admin-primary-action" type="button" onClick={generateStudentQr} disabled={studentQrBusy}>{studentQrBusy ? "Preparing QR…" : studentQrValue && studentQrEventId === event.id ? "Refresh event QR" : "Generate event QR"}</button>}
                                </div>
                                {studentParticipation?.agreed_at && studentParticipation.status === "accepted" && <small>Agreed {new Date(String(studentParticipation.agreed_at).replace(" ", "T")).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}</small>}
                                {studentParticipation?.status === "accepted" && !event.student_can_generate_qr && <p className="event-student-qr-message" role="status">Add a valid student ID to your profile before generating this QR.</p>}
                                {studentQrValue && studentQrEventId === event.id && <div className="event-student-qr-code"><QRCode value={studentQrValue} size={220} level="M" /><span>{event.title}</span></div>}
                                {studentParticipationMessage && <p className="event-student-qr-message" role="status">{studentParticipationMessage}</p>}
                                {studentQrMessage && <p className="event-student-qr-message" role="status">{studentQrMessage}</p>}
                            </section>}

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
