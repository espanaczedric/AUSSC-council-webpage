import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import AdminNav from "../../components/AdminNav";
import EventImage from "../../components/EventImage";
import { AdminPageSkeleton, SkeletonBlock, SkeletonPageHeading } from "../../components/LoadingSkeletons";
import {
    createAdminEvent,
    getAdminEvent,
    getEventImageUrl,
    updateAdminEvent
} from "../../services/api";

const councilInviteAudiences = [
    ["all", "All council members"],
    ["executive", "Executive Committee"],
    ["publication", "Publication Committee"],
    ["program", "Program Committee"],
    ["production", "Production Committee"]
];

function toDateTimeLocal(value) {
    return value ? value.replace(" ", "T").slice(0, 16) : "";
}

function CreateEvent({ editMode = false }) {
    const navigate = useNavigate();
    const { id } = useParams();
    const [form, setForm] = useState({
        title: "",
        description: "",
        location: "",
        invited_committees: ["all"],
        start_date: "",
        end_date: "",
        registration_deadline: "",
        capacity: "",
        assignment_capacity: "",
        participation_open: true,
        participation_requirements: "",
        eligible_courses: "",
        eligible_year_levels: "",
        require_event_registration: false,
        registration_open: true,
        registration_eligible_courses: "",
        registration_eligible_year_levels: "",
        self_service_checkin: false,
        self_service_checkout: false,
        publication_status: "published",
        status: "upcoming"
    });
    const [coverImage, setCoverImage] = useState(null);
    const [existingImage, setExistingImage] = useState("");
    const [imagePreview, setImagePreview] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [eventLoading, setEventLoading] = useState(editMode);
    const [eventLoadError, setEventLoadError] = useState("");

    useEffect(() => {
        if (!editMode) return undefined;

        let active = true;
        getAdminEvent(id)
            .then((data) => {
                if (!data.success || !data.event) {
                    throw new Error(data.message || "Event not found.");
                }

                if (!active) return;
                const event = data.event;
                setForm({
                    title: event.title || "",
                    description: event.description || "",
                    location: event.location || "",
                    invited_committees: Array.isArray(event.invited_committees) ? event.invited_committees : ["all"],
                    start_date: toDateTimeLocal(event.start_date),
                    end_date: toDateTimeLocal(event.end_date),
                    registration_deadline: toDateTimeLocal(event.registration_deadline),
                    capacity: String(event.capacity ?? ""),
                    assignment_capacity: String(event.assignment_capacity || ""),
                    participation_open: event.participation_open !== false,
                    participation_requirements: event.participation_requirements || "",
                    eligible_courses: (event.eligible_courses || []).join(", "),
                    eligible_year_levels: (event.eligible_year_levels || []).join(", "),
                    require_event_registration: Boolean(event.require_event_registration),
                    registration_open: event.registration_open !== false,
                    registration_eligible_courses: (event.registration_eligible_courses || []).join(", "),
                    registration_eligible_year_levels: (event.registration_eligible_year_levels || []).join(", "),
                    self_service_checkin: Boolean(event.self_service_checkin),
                    self_service_checkout: Boolean(event.self_service_checkout),
                    publication_status: event.publication_status || "published",
                    status: event.status || "upcoming"
                });
                setExistingImage(getEventImageUrl(event.cover_image));
            })
            .catch((requestError) => {
                if (active) setEventLoadError(requestError.message);
            })
            .finally(() => {
                if (active) setEventLoading(false);
            });

        return () => {
            active = false;
        };
    }, [editMode, id]);

    useEffect(() => {
        if (!coverImage) {
            setImagePreview(existingImage);
            return undefined;
        }

        const previewUrl = URL.createObjectURL(coverImage);
        setImagePreview(previewUrl);
        return () => URL.revokeObjectURL(previewUrl);
    }, [coverImage, existingImage]);

    const handleChange = (event) => {
        const { name, value } = event.target;
        setForm((current) => ({ ...current, [name]: value }));
    };

    const toggleInviteAudience = (audience, checked) => {
        setForm((current) => {
            const selected = current.invited_committees || [];
            if (audience === "all") return { ...current, invited_committees: checked ? ["all"] : [] };
            const next = selected.filter((item) => item !== "all" && item !== audience);
            if (checked) next.push(audience);
            return { ...current, invited_committees: next };
        });
    };

    const handleImageChange = (event) => {
        const file = event.target.files?.[0] || null;
        setError("");

        if (file && file.size > 5 * 1024 * 1024) {
            setCoverImage(null);
            event.target.value = "";
            setError("Choose an image smaller than 5 MB.");
            return;
        }

        setCoverImage(file);
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        setSaving(true);
        setError("");

        try {
            const formData = new FormData(event.currentTarget);
            formData.set("invited_committees", (form.invited_committees || []).join(","));
            formData.set("participation_open", form.participation_open ? "true" : "false");
            formData.set("require_event_registration", form.require_event_registration ? "true" : "false");
            formData.set("registration_open", form.registration_open ? "true" : "false");
            formData.set("self_service_checkin", form.self_service_checkin ? "true" : "false");
            formData.set("self_service_checkout", form.self_service_checkout ? "true" : "false");
            let result;
            if (editMode) {
                result = await updateAdminEvent(id, formData);
            } else {
                result = await createAdminEvent(formData);
            }
            navigate("/admin/events", { state: { eventNotice: result.message, eventNoticeFailed: result.notifications?.failed_count !== undefined && result.notifications.failed_count !== 0, eventNoticeEmpty: result.notifications?.recipient_count === 0 } });
        } catch (requestError) {
            setError(requestError.message || "The event could not be saved. Please try again.");
        } finally {
            setSaving(false);
        }
    };

    const previewDate = form.start_date
        ? new Date(form.start_date).toLocaleString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit"
        })
        : "Date and time will appear here";

    if (eventLoading) {
        return <AdminPageSkeleton className="admin-create-page">
            <header className="admin-header admin-page-heading"><SkeletonPageHeading /></header>
            <div className="admin-form admin-create-form ui-skeleton-form">
                {Array.from({ length: 4 }, (_, section) => <section className="admin-form-section" key={section}><SkeletonBlock className="ui-skeleton-section-title is-small" /><div className="ui-skeleton-form-grid">{Array.from({ length: section === 0 ? 4 : 3 }, (_, field) => <div key={field}><SkeletonBlock className="ui-skeleton-form-label" /><SkeletonBlock className={field === 1 && section === 0 ? "ui-skeleton-form-area" : "ui-skeleton-form-field"} /></div>)}</div></section>)}
            </div>
        </AdminPageSkeleton>;
    }

    if (editMode && eventLoadError) {
        return (
            <>
                <AdminNav />
                <main className="admin-page">
                    <p className="admin-feedback is-error" role="alert">{eventLoadError}</p>
                    <Link to="/admin/events" className="admin-secondary-action">Back to events</Link>
                </main>
            </>
        );
    }

    return (
        <>
            <AdminNav />
            <main className="admin-page admin-create-page">
                <section className="admin-header admin-page-heading">
                    <div>
                        <span>EVENT OPERATIONS</span>
                        <h1>{editMode ? "Edit event" : "Create event"}</h1>
                        <p>{editMode
                            ? "Update the details council members and attendees use to plan."
                            : "Create an event and invite current council members to share their availability."}</p>
                    </div>
                    <Link to="/admin/events" className="admin-secondary-action">
                        <span aria-hidden="true">←</span>
                        Back to events
                    </Link>
                </section>

                {error && <p className="admin-feedback is-error" role="alert">{error}</p>}

                <div className="admin-create-layout">
                    <form className="admin-form admin-create-form" onSubmit={handleSubmit}>
                        <input type="hidden" name="assignment_capacity" value={form.assignment_capacity} />
                        <input type="hidden" name="participation_requirements" value={form.participation_requirements} />
                        <input type="hidden" name="eligible_courses" value={form.eligible_courses} />
                        <input type="hidden" name="eligible_year_levels" value={form.eligible_year_levels} />
                        <input type="hidden" name="registration_open" value={form.registration_open ? "true" : "false"} />
                        <input type="hidden" name="registration_eligible_courses" value={form.registration_eligible_courses} />
                        <input type="hidden" name="registration_eligible_year_levels" value={form.registration_eligible_year_levels} />
                        <section className="admin-form-section">
                            <div className="admin-section-heading">
                                <div>
                                    <span>01 · EVENT DETAILS</span>
                                    <h2>What is happening?</h2>
                                </div>
                            </div>

                            <label htmlFor="event-title">Event title</label>
                            <input
                                id="event-title"
                                name="title"
                                value={form.title}
                                onChange={handleChange}
                                maxLength={255}
                                placeholder="e.g. Organization Fair 2026"
                                required
                            />

                            <label htmlFor="event-description">About the event</label>
                            <textarea
                                id="event-description"
                                name="description"
                                value={form.description}
                                onChange={handleChange}
                                rows={5}
                                maxLength={3000}
                                placeholder="Explain what will happen and who should attend."
                                required
                            />

                            <label htmlFor="event-location">Location</label>
                            <input
                                id="event-location"
                                name="location"
                                value={form.location}
                                onChange={handleChange}
                                maxLength={255}
                                placeholder="Campus, building, or venue"
                                required
                            />
                        </section>

                        <section className="admin-form-section">
                            <div className="admin-section-heading">
                                <div>
                                    <span>02 · DATE & CAPACITY</span>
                                    <h2>Set the event schedule</h2>
                                </div>
                            </div>

                            <div className="admin-form-grid">
                                <label htmlFor="event-start">Starts</label>
                                <input
                                    id="event-start"
                                    type="datetime-local"
                                    name="start_date"
                                    value={form.start_date}
                                    onChange={handleChange}
                                    required
                                />

                                <label htmlFor="event-end">Ends</label>
                                <input
                                    id="event-end"
                                    type="datetime-local"
                                    name="end_date"
                                    value={form.end_date}
                                    onChange={handleChange}
                                    required
                                />

                                <label htmlFor="event-capacity">Capacity</label>
                                <input
                                    id="event-capacity"
                                    type="number"
                                    name="capacity"
                                    min="1"
                                    step="1"
                                    value={form.capacity}
                                    onChange={handleChange}
                                    placeholder="e.g. 250"
                                    required
                                />

                                <label htmlFor="event-status">Status</label>
                                <select
                                    id="event-status"
                                    name="status"
                                    value={form.status}
                                    onChange={handleChange}
                                >
                                    <option value="upcoming">Upcoming</option>
                                    <option value="ongoing">Happening now</option>
                                    {editMode && <option value="completed">Completed</option>}
                                    {editMode && <option value="cancelled">Cancelled</option>}
                                </select>
                            </div>
                        </section>

                        <section className="admin-form-section">
                            <div className="admin-section-heading"><div><span>03 · COUNCIL INVITATIONS</span><h2>Invite council participation</h2></div></div>
                            <p className="admin-form-note">Choose who should receive this event invitation. Selected members receive the event details and can accept or decline. Participation helps with planning but does not create assignments or attendance records.</p>
                            <div className="event-invite-audiences" role="group" aria-label="Council invitation audience">
                                {councilInviteAudiences.map(([audience, label]) => <label key={audience} className={(form.invited_committees || []).includes(audience) ? "is-selected" : ""}>
                                    <input type="checkbox" checked={(form.invited_committees || []).includes(audience)} onChange={(change) => toggleInviteAudience(audience, change.target.checked)} />
                                    <span>{label}</span>
                                </label>)}
                            </div>
                            {!(form.invited_committees || []).length && <p className="admin-feedback is-error" role="alert">Select at least one group to notify.</p>}
                        </section>

                        <section className="admin-form-section">
                            <div className="admin-section-heading"><div><span>04 · ATTENDANCE</span><h2>Configure event check-in</h2></div></div>
                            <div className="event-participation-toggles">
                                <label><input type="checkbox" checked={form.self_service_checkin} onChange={(event) => setForm((current) => ({ ...current, self_service_checkin: event.target.checked }))} /> Allow attendees to check in themselves</label>
                                <label><input type="checkbox" checked={form.self_service_checkout} onChange={(event) => setForm((current) => ({ ...current, self_service_checkout: event.target.checked }))} /> Allow attendees to check out themselves</label>
                            </div>
                            <p className="admin-form-note">Attendance is recorded only when a student or council member checks in to this selected event. Participation does not count as attendance.</p>
                        </section>

                        {editMode ? <section className="admin-form-section">
                            <div className="admin-section-heading"><div><span>05 · PUBLICATION</span><h2>Manage the event’s release status</h2></div></div>
                            <label htmlFor="event-publication-status">Publication status</label>
                            <select id="event-publication-status" name="publication_status" value={form.publication_status} onChange={handleChange}>
                                <option value="draft">Draft · private to council</option>
                                <option value="pending_approval">Pending approval · executive queue</option>
                                <option value="published">Published</option>
                                <option value="cancelled">Cancelled</option>
                                <option value="archived">Archived</option>
                            </select>
                            {form.publication_status === "pending_approval" && <p className="event-review-note">This existing event stays off the public site until it is approved.</p>}
                        </section> : <section className="admin-form-section">
                            <div className="admin-section-heading"><div><span>05 · PUBLICATION</span><h2>Publish when you post</h2></div></div>
                            <p className="admin-form-note">Saving publishes this event immediately and sends its details to the selected council audience.</p>
                        </section>}

                        <section className="admin-form-section">
                            <div className="admin-section-heading">
                                <div>
                                    <span>06 · COVER IMAGE</span>
                                    <h2>Choose the event thumbnail</h2>
                                </div>
                            </div>
                            <label htmlFor="event-cover">
                                {editMode ? "Replace cover image" : "Cover image"}
                                <span>JPG, PNG, or WebP · max 5 MB{editMode ? " · optional" : ""}</span>
                            </label>
                            <input
                                id="event-cover"
                                className="admin-file-input"
                                type="file"
                                name="cover_image"
                                accept="image/jpeg,image/png,image/webp"
                                onChange={handleImageChange}
                                required={!editMode}
                            />
                        </section>

                        <div className="admin-form-actions">
                            <Link to="/admin/events" className="admin-secondary-action">Cancel</Link>
                            <button className="admin-primary-action" type="submit" disabled={saving}>
                                {saving
                                    ? editMode ? "Saving…" : "Publishing…"
                                    : editMode ? "Save changes" : "Publish event"}
                            </button>
                        </div>
                    </form>

                    <aside className="admin-event-preview" aria-label="Student event preview">
                        <div className="admin-preview-heading">
                            <span>STUDENT PREVIEW</span>
                            <h2>Event card</h2>
                        </div>
                        <article className="admin-preview-card">
                            <div className="admin-preview-media">
                                {imagePreview ? (
                                    <EventImage
                                        src={imagePreview}
                                        alt="Selected event cover preview"
                                        className="admin-preview-event-image"
                                        loading="eager"
                                    />
                                ) : (
                                    <span>Select a cover image</span>
                                )}
                            </div>
                            <div className="admin-preview-copy">
                                <span>{previewDate}</span>
                                <h3>{form.title || "Your event title"}</h3>
                                <p>{form.description || "Your event description will appear here."}</p>
                                <strong>{form.location || "Event location"}</strong>
                            </div>
                        </article>
                    </aside>
                </div>
            </main>
        </>
    );
}

export default CreateEvent;
