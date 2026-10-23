import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import Navbar from "../components/Navbar";
import ImageCropDialog from "../components/ImageCropDialog";
import ClassScheduleEditor from "../components/ClassScheduleEditor";
import QRCode from "react-qr-code";
import { apiRequest, getCurrentUser, getEventImageUrl, getMyEventResponses, updateMyProfile } from "../services/api";
import { committeeLabels, getCommitteeWorkspacePath, hasExecutiveAccess } from "../utils/workspaceAccess";

function readStoredUser() {
    try {
        const user = JSON.parse(localStorage.getItem("user") || "null");
        return user && typeof user === "object" ? user : null;
    } catch {
        return null;
    }
}

function initialsFor(user) {
    return `${user?.first_name?.[0] || ""}${user?.last_name?.[0] || ""}`.toUpperCase() || "U";
}

function isCouncilMemberAccount(user) {
    return Boolean(user?.role === "admin" || user?.council_position || user?.committee_assignment);
}

const councilPositionNames = {
    governor: "Governor", vice_governor: "Vice Governor", secretary: "Secretary",
    treasurer: "Treasurer", auditor: "Auditor", social_media_manager: "Social Media Manager",
    department_representative: "Department Representative", advisor: "Advisor", co_advisor: "Co-Advisor"
};

const years = ["1st Year", "2nd Year", "3rd Year", "4th Year"];
const blankForm = { first_name: "", last_name: "", student_id: "", email: "", course: "", year_level: "" };

function formatDate(value) {
    if (!value) return "—";
    const date = new Date(typeof value === "string" ? value.replace(" ", "T") : value);
    return Number.isNaN(date.getTime())
        ? value
        : date.toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" });
}

function Avatar({ src, initials, className = "", saving = false }) {
    const [loadedSrc, setLoadedSrc] = useState("");
    const imageLoading = saving || (Boolean(src) && loadedSrc !== src);
    return <span className={`profile-avatar-frame ${className}`} aria-busy={imageLoading || undefined}>
        <span aria-hidden="true">{initials}</span>
        {src && <img src={src} alt="" crossOrigin={src.startsWith("blob:") ? undefined : "use-credentials"} onLoad={() => setLoadedSrc(src)} onError={(event) => { setLoadedSrc(src); event.currentTarget.remove(); }} />}
        {imageLoading && <span className="profile-avatar-skeleton" aria-hidden="true" />}
    </span>;
}

export default function CouncilProfile() {
    const navigate = useNavigate();
    const [user, setUser] = useState(readStoredUser);
    const [form, setForm] = useState(blankForm);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [photoSavingKind, setPhotoSavingKind] = useState("");
    const [loadedCoverImage, setLoadedCoverImage] = useState("");
    const [pendingPhotoFiles, setPendingPhotoFiles] = useState({ profile: null, cover: null });
    const [photoPreviewUrls, setPhotoPreviewUrls] = useState({ profile: "", cover: "" });
    const [connectionNote, setConnectionNote] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [removeProfile, setRemoveProfile] = useState(false);
    const [removeCover, setRemoveCover] = useState(false);
    const [cropRequest, setCropRequest] = useState(null);
    const [councilAttendanceEvents, setCouncilAttendanceEvents] = useState([]);
    const [councilResponses, setCouncilResponses] = useState([]);
    const [participationLoading, setParticipationLoading] = useState(true);
    const [participationError, setParticipationError] = useState("");
    const [memberAttendanceBusy, setMemberAttendanceBusy] = useState("");
    const [credentialMessage, setCredentialMessage] = useState("");
    const [identityQrValue, setIdentityQrValue] = useState("");

    useEffect(() => {
        let active = true;
        if (!readStoredUser()) {
            navigate("/login?next=%2Fprofile", { replace: true });
            setLoading(false);
            return () => { active = false; };
        }

        getCurrentUser()
            .then((data) => {
                if (!active || !data.user) return;
                setUser(data.user);
                setForm({ ...blankForm, ...data.user });
                localStorage.setItem("user", JSON.stringify(data.user));
                window.dispatchEvent(new Event("auth-change"));
            })
            .catch((requestError) => {
                if (!active) return;
                if (/sign in|signed in|session/i.test(requestError.message || "")) {
                    localStorage.removeItem("user");
                    window.dispatchEvent(new Event("auth-change"));
                    navigate("/login?next=%2Fprofile", { replace: true });
                    return;
                }
                setConnectionNote(true);
            })
            .finally(() => { if (active) setLoading(false); });

        return () => { active = false; };
    }, [navigate]);

    useEffect(() => {
        if (!user?.id || !isCouncilMemberAccount(user)) return undefined;
        let active = true;
        setParticipationLoading(true);
        setParticipationError("");
        Promise.allSettled([
            apiRequest("/council/attendance/mine", { credentials: "include" }),
            getMyEventResponses()
        ]).then(([attendanceResult, participationResult]) => {
            if (!active) return;
            setCouncilAttendanceEvents(attendanceResult.status === "fulfilled" ? attendanceResult.value.events || [] : []);
            if (participationResult.status === "fulfilled") {
                setCouncilResponses(participationResult.value.responses || []);
                setParticipationError("");
            } else {
                setCouncilResponses([]);
                setParticipationError(participationResult.reason?.message || "Council participation could not be loaded.");
            }
            setParticipationLoading(false);
        });
        return () => { active = false; };
    }, [user?.id, user?.role, user?.council_position, user?.committee_assignment]);

    useEffect(() => {
        const previews = {
            profile: pendingPhotoFiles.profile ? URL.createObjectURL(pendingPhotoFiles.profile) : "",
            cover: pendingPhotoFiles.cover ? URL.createObjectURL(pendingPhotoFiles.cover) : ""
        };
        setPhotoPreviewUrls(previews);
        return () => Object.values(previews).forEach((url) => { if (url) URL.revokeObjectURL(url); });
    }, [pendingPhotoFiles]);

    useEffect(() => {
        let active = true;
        setIdentityQrValue("");
        if (!user?.id || !isCouncilMemberAccount(user)) return () => { active = false; };
        setCredentialMessage("");
        apiRequest("/council/attendance/credential", { credentials: "include" })
            .then((data) => {
                if (!active) return;
                const qrValue = data.credential?.qr_value || "";
                setIdentityQrValue(qrValue);
                if (!qrValue) setCredentialMessage("Add a valid account ID to your profile before generating your council QR.");
            })
            .catch((requestError) => {
                if (!active) return;
                setCredentialMessage(requestError.message || "The reusable council QR could not be loaded.");
            });
        return () => { active = false; };
    }, [user?.id, user?.role, user?.student_id, user?.council_position, user?.committee_assignment]);

    useEffect(() => {
        const source = photoPreviewUrls.cover || (user?.cover_photo ? getEventImageUrl(user.cover_photo) : "");
        if (!source) {
            setLoadedCoverImage("");
            return undefined;
        }
        const image = new Image();
        image.onload = () => setLoadedCoverImage(source);
        image.onerror = () => setLoadedCoverImage(source);
        image.src = source;
        return () => { image.onload = null; image.onerror = null; };
    }, [photoPreviewUrls.cover, user?.cover_photo]);

    if (!user && loading) return <>
        <Navbar />
        <main className="council-profile-page profile-loading-skeleton" role="status" aria-label="Loading your profile">
            <div className="profile-skeleton-heading">
                <span className="profile-skeleton-block profile-skeleton-eyebrow" />
                <span className="profile-skeleton-block profile-skeleton-title" />
                <span className="profile-skeleton-block profile-skeleton-subtitle" />
            </div>
            <section className="council-profile-card" aria-hidden="true">
                <div className="council-profile-banner" />
                <div className="profile-skeleton-identity">
                    <span className="profile-skeleton-block profile-skeleton-avatar" />
                    <div><span className="profile-skeleton-block profile-skeleton-name" /><span className="profile-skeleton-block profile-skeleton-email" /></div>
                </div>
                <div className="profile-skeleton-details">
                    {Array.from({ length: 6 }, (_, index) => <div key={index}><span className="profile-skeleton-block profile-skeleton-label" /><span className="profile-skeleton-block profile-skeleton-value" /></div>)}
                </div>
            </section>
        </main>
    </>;
    if (!user) return null;

    const initials = initialsFor(user);
    const isCouncilMember = isCouncilMemberAccount(user);
    const profileImage = !removeProfile ? photoPreviewUrls.profile || getEventImageUrl(user.profile_picture) : "";
    const coverImage = !removeCover ? photoPreviewUrls.cover || getEventImageUrl(user.cover_photo) : "";
    const coverIsLoading = photoSavingKind === "cover" || (Boolean(coverImage) && loadedCoverImage !== coverImage);
    const accountDetails = [
        { label: "Student ID", value: user.student_id || "—" },
        { label: "Email address", value: user.email || "—" },
        { label: "Course / program", value: user.course || "—" },
        { label: "Year level", value: user.year_level || "—" },
        ...(user.council_position ? [{ label: "Council appointment", value: `${councilPositionNames[user.council_position] || user.council_position}${user.council_department ? ` · ${user.council_department}` : ""}` }] : []),
        ...(user.committee_assignment ? [{ label: "Committee workspace", value: committeeLabels[user.committee_assignment] || user.committee_assignment }] : []),
        { label: "Account type", value: user.role === "admin" ? "Council administrator" : "Student" },
        { label: "Member since", value: formatDate(user.created_at) }
    ];
    const primaryWorkspace = hasExecutiveAccess(user)
        ? { to: "/admin", label: "Council workspace" }
        : user.committee_assignment
            ? { to: getCommitteeWorkspacePath(user), label: `${committeeLabels[user.committee_assignment]?.replace(" Committee", "")} workspace` }
            : user.council_position
                ? { to: "/council", label: "Council governance" }
                : { to: "/my-events", label: "My attendance" };
    function beginEditing() {
        setForm({ ...blankForm, ...user });
        setPendingPhotoFiles({ profile: null, cover: null });
        setRemoveProfile(false);
        setRemoveCover(false);
        setCropRequest(null);
        setError("");
        setNotice("");
        setEditing(true);
    }

    function cancelEditing() {
        setEditing(false);
        setError("");
        setPendingPhotoFiles({ profile: null, cover: null });
        setRemoveProfile(false);
        setRemoveCover(false);
        setCropRequest(null);
    }

    async function saveProfile(event) {
        event.preventDefault();
        setSaving(true);
        setError("");
        setNotice("");
        const payload = new FormData();
        for (const field of ["first_name", "last_name", "student_id", "email", "course", "year_level"]) {
            payload.set(field, String(form[field] || "").trim());
        }
        if (pendingPhotoFiles.profile) payload.set("profile_picture", pendingPhotoFiles.profile);
        else if (removeProfile) payload.set("remove_profile_picture", "true");
        if (pendingPhotoFiles.cover) payload.set("cover_photo", pendingPhotoFiles.cover);
        else if (removeCover) payload.set("remove_cover_photo", "true");
        setPhotoSavingKind(pendingPhotoFiles.profile ? "profile" : pendingPhotoFiles.cover ? "cover" : "");

        try {
            const data = await updateMyProfile(payload);
            setUser(data.user);
            setForm({ ...blankForm, ...data.user });
            localStorage.setItem("user", JSON.stringify(data.user));
            window.dispatchEvent(new Event("auth-change"));
            setPendingPhotoFiles({ profile: null, cover: null });
            setEditing(false);
            setRemoveProfile(false);
            setRemoveCover(false);
            setNotice("Your profile has been updated.");
            setConnectionNote(false);
        } catch (requestError) {
            setError(requestError.message || "Could not save your profile. Please try again.");
        } finally {
            setSaving(false);
            setPhotoSavingKind("");
        }
    }

    function choosePhoto(event, kind) {
        const file = event.target.files?.[0] || null;
        event.target.value = "";
        if (!file) return;
        setError("");
        const supportedMimeType = ["image/jpeg", "image/png", "image/webp"].includes(file.type);
        const supportedFileName = /\.(jpe?g|png|webp)$/i.test(file.name);
        if (!supportedMimeType && !supportedFileName) {
            setError("Choose a JPG, PNG, or WebP photo.");
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            setError("Choose photos smaller than 5 MB each.");
            return;
        }
        setCropRequest({ kind, file });
    }

    async function applyCroppedPhoto(kind, file) {
        setError("");
        setNotice("");
        setPendingPhotoFiles((current) => ({ ...current, [kind]: file }));
        if (kind === "profile") setRemoveProfile(false);
        else setRemoveCover(false);
        setCropRequest(null);
        setSaving(true);
        setPhotoSavingKind(kind);

        // Save the photo immediately. Keep the cropped file queued so the
        // profile form can retry it if this upload fails.
        const payload = new FormData();
        for (const field of ["first_name", "last_name", "student_id", "email", "course", "year_level"]) {
            payload.set(field, String(user[field] || "").trim());
        }
        payload.set(kind === "profile" ? "profile_picture" : "cover_photo", file);

        try {
            const data = await updateMyProfile(payload);
            setUser(data.user);
            localStorage.setItem("user", JSON.stringify(data.user));
            window.dispatchEvent(new Event("auth-change"));
            setPendingPhotoFiles((current) => ({ ...current, [kind]: null }));
            setNotice(`${kind === "profile" ? "Profile picture" : "Cover photo"} saved.`);
            setConnectionNote(false);
        } catch (requestError) {
            setError(`${requestError.message || "Could not save the photo."} Your cropped photo is still previewed; Save changes will retry it.`);
        } finally {
            setSaving(false);
            setPhotoSavingKind("");
        }
    }

    async function recordCouncilSelfAttendance(eventId) {
        setMemberAttendanceBusy(String(eventId));
        setCredentialMessage("");
        try {
            const data = await apiRequest("/attendance/self", { method: "POST", credentials: "include", body: JSON.stringify({ event_id: eventId, participant_type: "council" }) });
            setCredentialMessage(data.message || "Attendance updated.");
            const refreshed = await apiRequest("/council/attendance/mine", { credentials: "include" });
            setCouncilAttendanceEvents(refreshed.events || []);
        } catch (requestError) {
            setCredentialMessage(requestError.message || "Attendance could not be updated.");
        } finally { setMemberAttendanceBusy(""); }
    }

    async function downloadAttendanceCredential() {
        if (!identityQrValue) return;
        try {
            const [{ jsPDF }, { default: html2canvas }] = await Promise.all([import("jspdf"), import("html2canvas")]);
            const artwork = document.getElementById("council-pass-artwork");
            if (!artwork) throw new Error("The council pass is unavailable.");
            if (document.fonts?.load) {
                await Promise.all([document.fonts.load("700 16px Poppins"), document.fonts.load("800 20px Montserrat")]);
            }
            await Promise.all(Array.from(artwork.querySelectorAll("img"), (image) => image.decode?.().catch(() => undefined)));
            const canvas = await html2canvas(artwork, { backgroundColor: null, scale: 2, useCORS: true, logging: false });
            const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
            const imageRatio = canvas.width / canvas.height;
            const maxWidth = 186;
            const maxHeight = 277;
            let width = maxWidth;
            let height = width / imageRatio;
            if (height > maxHeight) {
                height = maxHeight;
                width = height * imageRatio;
            }
            const x = (210 - width) / 2;
            const y = (297 - height) / 2;
            pdf.setFillColor(247, 249, 252);
            pdf.rect(0, 0, 210, 297, "F");
            pdf.addImage(canvas.toDataURL("image/png"), "PNG", x, y, width, height, undefined, "FAST");
            pdf.save(`AUSSC-council-identity-qr-${user.student_id || user.id}.pdf`);
        } catch {
            setCredentialMessage("The council pass PDF could not be downloaded. Please try again.");
        }
    }

    return (
        <>
            <Navbar />
            <main className="council-profile-page page-enter">
                <header className="council-profile-heading profile-heading-row">
                    <div>
                        <span className="eyebrow">Araullo University South Student Council</span>
                        <h1>Your profile</h1>
                        <p>Manage your personal details and profile photos.</p>
                    </div>
                    <div className="council-profile-heading-actions">
                        {isCouncilMember && <a className="admin-secondary-action" href="#council-class-schedule">Class schedule</a>}
                        {!editing && <button className="admin-primary-action profile-edit-trigger" type="button" onClick={beginEditing}>Edit profile</button>}
                    </div>
                </header>

                {connectionNote && <p className="council-profile-note" role="status">The latest profile could not be loaded from the server. Check your connection before saving changes.</p>}
                {notice && <p className="profile-form-message is-success" role="status">{notice}</p>}
                {error && !editing && <p className="profile-form-message is-error" role="alert">{error}</p>}
                {loading && <p className="council-profile-refresh" role="status">Refreshing account details…</p>}

                <section className="council-profile-card" aria-label="Account profile">
                    <div className="council-profile-banner" style={coverImage ? { backgroundImage: `linear-gradient(90deg,rgba(5,19,35,.2),rgba(5,19,35,.05)),url("${coverImage}")` } : undefined} />
                    <div className="council-profile-identity">
                        <Avatar src={profileImage} initials={initials} className="council-profile-avatar" saving={photoSavingKind === "profile"} />
                        <div className="council-profile-name">
                            <span className="council-profile-role">{councilPositionNames[user.council_position] || (user.role === "admin" ? "Council administrator" : "Student account")}</span>
                            <h2>{[user.first_name, user.last_name].filter(Boolean).join(" ") || "Council member"}</h2>
                            <p>{user.email || "Email not available"}</p>
                        </div>
                    </div>

                    {editing ? (
                        <form className="profile-edit-form" onSubmit={saveProfile}>
                            {error && <p className="profile-form-message is-error" role="alert">{error}</p>}
                            <section className="profile-photo-edit-section" aria-labelledby="profile-photo-heading">
                                <div><span className="profile-edit-eyebrow">PERSONALIZE YOUR PROFILE</span><h3 id="profile-photo-heading">Photos</h3><p>Choose a photo to crop and reposition it. Use this photo saves it immediately; Save changes can retry a failed upload.</p></div>
                                <div className="profile-photo-edit-grid">
                                    <div className="profile-photo-control">
                                        <Avatar src={profileImage} initials={initials} className="is-editing" saving={photoSavingKind === "profile"} />
                                        <div><label htmlFor="profile-picture-upload">Profile picture</label><input id="profile-picture-upload" type="file" accept="image/jpeg,image/png,image/webp" disabled={saving} onChange={(event) => choosePhoto(event, "profile")} />{(user.profile_picture || pendingPhotoFiles.profile) && !removeProfile && <button type="button" className="profile-remove-photo" disabled={saving} onClick={() => { setPendingPhotoFiles((current) => ({ ...current, profile: null })); setRemoveProfile(true); }}>Remove picture</button>}</div>
                                    </div>
                                    <div className="profile-cover-control">
                                        <div className={`profile-cover-preview${coverIsLoading ? " is-skeleton" : ""}`} style={coverImage ? { backgroundImage: `url("${coverImage}")` } : undefined} aria-busy={coverIsLoading || undefined}><span>Cover photo</span></div>
                                        <label htmlFor="cover-photo-upload">Choose cover photo</label><input id="cover-photo-upload" type="file" accept="image/jpeg,image/png,image/webp" disabled={saving} onChange={(event) => choosePhoto(event, "cover")} />{(user.cover_photo || pendingPhotoFiles.cover) && !removeCover && <button type="button" className="profile-remove-photo" disabled={saving} onClick={() => { setPendingPhotoFiles((current) => ({ ...current, cover: null })); setRemoveCover(true); }}>Remove cover</button>}
                                    </div>
                                </div>
                            </section>

                            <section className="profile-details-edit-section" aria-labelledby="profile-details-heading">
                                <div><span className="profile-edit-eyebrow">ACCOUNT DETAILS</span><h3 id="profile-details-heading">Personal information</h3></div>
                                <div className="profile-edit-fields">
                                    <label>First name<input autoComplete="given-name" maxLength={80} required value={form.first_name || ""} onChange={(event) => setForm({ ...form, first_name: event.target.value })} /></label>
                                    <label>Last name<input autoComplete="family-name" maxLength={80} required value={form.last_name || ""} onChange={(event) => setForm({ ...form, last_name: event.target.value })} /></label>
                                    <label>Student / account ID<input autoComplete="username" maxLength={24} pattern={user.role === "student" ? "01-[0-9]{4}-[0-9]{6}" : "[A-Za-z0-9-]{3,24}"} title={user.role === "student" ? "Use the format 01-1234-123456." : "Use 3–24 letters, numbers, or hyphens."} required value={form.student_id || ""} onChange={(event) => setForm({ ...form, student_id: event.target.value })} /></label>
                                    <label>PHINMA Education email<input type="email" autoComplete="email" pattern="[A-Za-z0-9._%+-]+@phinmaed[.]com" title="Use your @phinmaed.com email address." maxLength={254} required value={form.email || ""} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
                                    <label>Course / program<input maxLength={100} required={user.role === "student"} value={form.course || ""} onChange={(event) => setForm({ ...form, course: event.target.value })} /></label>
                                    <label>Year level<select required={user.role === "student"} value={form.year_level || ""} onChange={(event) => setForm({ ...form, year_level: event.target.value })}><option value="">{user.role === "student" ? "Select year level" : "Not specified"}</option>{years.map((year) => <option key={year} value={year}>{year}</option>)}{user.role !== "student" && <option value="N/A">N/A</option>}</select></label>
                                </div>
                            </section>
                            <div className="profile-access-note"><strong>Account type and council access are protected.</strong><span>Your administrator role, committee assignment, and council appointment can only be changed by an authorized council administrator.</span></div>
                            <div className="profile-edit-actions"><button className="admin-primary-action" type="submit" disabled={saving}>{saving ? "Saving profile…" : "Save changes"}</button><button className="profile-cancel-button" type="button" onClick={cancelEditing} disabled={saving}>Cancel</button></div>
                        </form>
                    ) : (
                        <div className="council-profile-details">
                            {accountDetails.map(({ label, value }) => <div className="council-profile-detail" key={label}><span>{label}</span><strong>{value}</strong></div>)}
                        </div>
                    )}
                </section>

                {isCouncilMember && <ClassScheduleEditor />}

                {!editing && isCouncilMember && <section className="council-member-participation-card" aria-labelledby="council-member-participation-title">
                    <header><div><span className="eyebrow">COUNCIL PARTICIPATION</span><h2 id="council-member-participation-title">Event participation</h2><p>Your event responses help with planning. They are separate from task assignments and attendance records.</p></div></header>
                    {participationLoading ? <p className="council-profile-section-status" role="status">Loading your event participation…</p>
                        : participationError ? <p className="profile-form-message is-error" role="alert">{participationError}</p>
                            : councilResponses.length ? <div className="council-member-participation-list">{councilResponses.slice(0, 4).map((response) => <article key={response.id}>
                                <div><span className={`member-assignment-status is-${response.status}`}>{response.status}</span><h3>{response.event?.title || "Council event"}</h3><p>{response.event?.location || "Location to be confirmed"} · {formatDate(response.event?.start_date)}</p></div>
                                <Link to={`/events/${response.event?.id}`}>Event details <span aria-hidden="true">→</span></Link>
                            </article>)}</div>
                                : <div className="council-member-participation-empty"><h3>No event invitations yet</h3><p>Invitations shared with the council will appear here. Accepting one does not count as attendance.</p></div>}
                    {!participationLoading && <Link className="council-profile-secondary council-member-participation-link" to="/my-events">Manage participation <span aria-hidden="true">→</span></Link>}
                </section>}

                {!editing && isCouncilMember && <>
                    <section className="council-member-attendance-card" aria-labelledby="council-member-attendance-title"><div><span className="eyebrow">MY ATTENDANCE</span><h2 id="council-member-attendance-title">Council event history</h2><p>Attendance officers can record your pass; self-service actions appear only when the event allows them.</p></div>
                        {councilAttendanceEvents.length ? <div className="council-member-attendance-list">{councilAttendanceEvents.map((event) => <article key={event.id}><div><strong>{event.title}</strong><span>{event.location} · {formatDate(event.start_date)}</span><small>{event.attendance?.time_out ? `Checked out ${formatDate(event.attendance.time_out)}` : event.attendance?.time_in ? `Checked in ${formatDate(event.attendance.time_in)}` : "No attendance recorded"}</small></div>{event.attendance?.time_out ? <span className="attendance-state is-complete">Complete</span> : event.attendance?.currently_present && event.self_service_checkout ? <button className="admin-secondary-action" type="button" onClick={() => recordCouncilSelfAttendance(event.id)} disabled={memberAttendanceBusy === String(event.id)}>{memberAttendanceBusy === String(event.id) ? "Saving…" : "Check out"}</button> : !event.attendance && event.self_service_checkin ? <button className="admin-primary-action" type="button" onClick={() => recordCouncilSelfAttendance(event.id)} disabled={memberAttendanceBusy === String(event.id)}>{memberAttendanceBusy === String(event.id) ? "Saving…" : "Check in"}</button> : <span className="attendance-state">Officer scan</span>}</article>)}</div> : <p className="council-member-attendance-empty">No council event attendance has been recorded yet.</p>}
                        {credentialMessage && <p role="status" className="profile-form-message">{credentialMessage}</p>}
                    </section>
                </>}

                {!editing && isCouncilMember && <section className="council-member-pass-card" aria-labelledby="council-pass-title">
                    <div className="council-member-pass-intro"><span className="eyebrow">COUNCIL ATTENDANCE</span><h2 id="council-pass-title">Your reusable council QR</h2><p>One member identity QR for council event time-in and time-out. Staff select the event when they scan it; participation and class schedules stay separate.</p></div>
                    {identityQrValue ? <>
                        <div className="council-member-pass-artwork" id="council-pass-artwork">
                            <header className="council-member-pass-brand"><img src="/assets/aussc-header-light.png" alt="Araullo University South Student Council" /><span>COUNCIL<br />MEMBER PASS</span></header>
                            <div className="council-member-pass-identity">
                                <div className="council-member-pass-nameplate"><span>COUNCIL MEMBER IDENTITY</span><h3>{`${user.first_name || ""} ${user.last_name || ""}`.trim() || "Council member"}</h3><p>{[councilPositionNames[user.council_position], committeeLabels[user.committee_assignment]].filter(Boolean).join(" · ") || (user.role === "admin" ? "Council administrator" : "Council member")}</p></div>
                            </div>
                            <div className="council-member-pass-code-row">
                                <div className="council-member-pass-code"><QRCode value={identityQrValue} size={196} level="H" bgColor="#ffffff" fgColor="#0b1f3a" /></div>
                                <div className="council-member-pass-code-copy"><span>REUSABLE MEMBER QR</span><h4>One council identity.<br />Every event.</h4><p>This QR identifies your council account only. Attendance is recorded for the event selected by authorized staff.</p></div>
                            </div>
                            <footer className="council-member-pass-footer"><strong>FOR THE STUDENTS, WE REMAIN</strong><span>Present this pass to the attendance officer.</span></footer>
                        </div>
                        <div className="council-member-pass-actions"><button id="council-pass-download-action" type="button" className="admin-primary-action" onClick={downloadAttendanceCredential}>Download council QR</button></div>
                    </> : <p role="status" className={`profile-form-message${credentialMessage ? " is-error" : ""}`}>{credentialMessage || (user.student_id ? "Loading your reusable council QR…" : "Add a valid account ID before generating your council QR.")}</p>}
                </section>}

                {!editing && <footer className="council-profile-actions" aria-label="Stay involved">
                    <div><h2>Stay involved</h2><p>Review council event invitations, update your class schedule, and keep student attendance history separate.</p></div>
                    <div className="council-profile-links"><Link className="register-button" to={primaryWorkspace.to}>{primaryWorkspace.label}</Link><Link className="council-profile-secondary" to="/events">Browse events <span aria-hidden="true">→</span></Link></div>
                </footer>}

            </main>
            {cropRequest && <ImageCropDialog file={cropRequest.file} kind={cropRequest.kind} onCancel={() => setCropRequest(null)} onApply={applyCroppedPhoto} />}
        </>
    );
}
