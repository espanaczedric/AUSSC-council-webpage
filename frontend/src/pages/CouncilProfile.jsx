import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import Navbar from "../components/Navbar";
import ImageCropDialog from "../components/ImageCropDialog";
import { getCurrentUser, getEventImageUrl, updateMyProfile } from "../services/api";
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

function Avatar({ src, initials, className = "" }) {
    return <span className={`profile-avatar-frame ${className}`}>
        <span aria-hidden="true">{initials}</span>
        {src && <img src={src} alt="" crossOrigin={src.startsWith("blob:") ? undefined : "use-credentials"} onError={(event) => event.currentTarget.remove()} />}
    </span>;
}

export default function CouncilProfile() {
    const navigate = useNavigate();
    const [user, setUser] = useState(readStoredUser);
    const [form, setForm] = useState(blankForm);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [connectionNote, setConnectionNote] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [profileFile, setProfileFile] = useState(null);
    const [coverFile, setCoverFile] = useState(null);
    const [removeProfile, setRemoveProfile] = useState(false);
    const [removeCover, setRemoveCover] = useState(false);
    const [profilePreview, setProfilePreview] = useState("");
    const [coverPreview, setCoverPreview] = useState("");
    const [cropRequest, setCropRequest] = useState(null);

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
        if (!profileFile) {
            setProfilePreview("");
            return undefined;
        }
        const url = URL.createObjectURL(profileFile);
        setProfilePreview(url);
        return () => URL.revokeObjectURL(url);
    }, [profileFile]);

    useEffect(() => {
        if (!coverFile) {
            setCoverPreview("");
            return undefined;
        }
        const url = URL.createObjectURL(coverFile);
        setCoverPreview(url);
        return () => URL.revokeObjectURL(url);
    }, [coverFile]);

    if (!user && loading) return <main className="loading" role="status">Loading your profile…</main>;
    if (!user) return null;

    const initials = initialsFor(user);
    const profileImage = profilePreview || (!removeProfile ? getEventImageUrl(user.profile_picture) : "");
    const coverImage = coverPreview || (!removeCover ? getEventImageUrl(user.cover_photo) : "");
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
                : { to: "/my-events", label: "My registrations" };

    function beginEditing() {
        setForm({ ...blankForm, ...user });
        setProfileFile(null);
        setCoverFile(null);
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
        setProfileFile(null);
        setCoverFile(null);
        setRemoveProfile(false);
        setRemoveCover(false);
        setCropRequest(null);
    }

    async function saveProfile(event) {
        event.preventDefault();
        setSaving(true);
        setError("");
        setNotice("");
        if ([profileFile, coverFile].some((file) => file && file.size > 5 * 1024 * 1024)) {
            setError("Choose photos smaller than 5 MB each.");
            setSaving(false);
            return;
        }
        const payload = new FormData();
        for (const field of ["first_name", "last_name", "student_id", "email", "course", "year_level"]) {
            payload.set(field, String(form[field] || "").trim());
        }
        if (profileFile) payload.set("profile_picture", profileFile);
        if (coverFile) payload.set("cover_photo", coverFile);
        if (removeProfile && !profileFile) payload.set("remove_profile_picture", "true");
        if (removeCover && !coverFile) payload.set("remove_cover_photo", "true");

        try {
            const data = await updateMyProfile(payload);
            setUser(data.user);
            setForm({ ...blankForm, ...data.user });
            localStorage.setItem("user", JSON.stringify(data.user));
            window.dispatchEvent(new Event("auth-change"));
            setEditing(false);
            setProfileFile(null);
            setCoverFile(null);
            setRemoveProfile(false);
            setRemoveCover(false);
            setNotice("Your profile has been updated.");
            setConnectionNote(false);
        } catch (requestError) {
            setError(requestError.message || "Could not save your profile. Please try again.");
        } finally {
            setSaving(false);
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

    function applyCroppedPhoto(kind, file) {
        if (kind === "profile") {
            setProfileFile(file);
            setRemoveProfile(false);
        } else {
            setCoverFile(file);
            setRemoveCover(false);
        }
        setCropRequest(null);
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
                    {!editing && <button className="admin-primary-action profile-edit-trigger" type="button" onClick={beginEditing}>Edit profile</button>}
                </header>

                {connectionNote && <p className="council-profile-note" role="status">The latest profile could not be loaded from the server. Check your connection before saving changes.</p>}
                {notice && <p className="profile-form-message is-success" role="status">{notice}</p>}
                {error && !editing && <p className="profile-form-message is-error" role="alert">{error}</p>}

                <section className="council-profile-card" aria-label="Account profile">
                    <div className="council-profile-banner" style={coverImage ? { backgroundImage: `linear-gradient(90deg,rgba(5,19,35,.2),rgba(5,19,35,.05)),url("${coverImage}")` } : undefined} />
                    <div className="council-profile-identity">
                        <Avatar src={profileImage} initials={initials} className="council-profile-avatar" />
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
                                <div><span className="profile-edit-eyebrow">PERSONALIZE YOUR PROFILE</span><h3 id="profile-photo-heading">Photos</h3><p>Choose a photo to crop and reposition it. Use JPG, PNG, or WebP up to 5 MB.</p></div>
                                <div className="profile-photo-edit-grid">
                                    <div className="profile-photo-control">
                                        <Avatar src={profileImage} initials={initials} className="is-editing" />
                                        <div><label htmlFor="profile-picture-upload">Profile picture</label><input id="profile-picture-upload" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => choosePhoto(event, "profile")} />{(user.profile_picture || profileFile) && <button type="button" className="profile-remove-photo" onClick={() => { setProfileFile(null); setRemoveProfile(true); }}>Remove picture</button>}</div>
                                    </div>
                                    <div className="profile-cover-control">
                                        <div className="profile-cover-preview" style={coverImage ? { backgroundImage: `url("${coverImage}")` } : undefined}><span>Cover photo</span></div>
                                        <label htmlFor="cover-photo-upload">Choose cover photo</label><input id="cover-photo-upload" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => choosePhoto(event, "cover")} />{(user.cover_photo || coverFile) && <button type="button" className="profile-remove-photo" onClick={() => { setCoverFile(null); setRemoveCover(true); }}>Remove cover</button>}
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

                {!editing && <section className="council-profile-actions" aria-label="Account links">
                    <div><h2>Stay involved</h2><p>Keep track of your event registrations and discover what’s happening on campus.</p></div>
                    <div className="council-profile-links"><Link className="register-button" to={primaryWorkspace.to}>{primaryWorkspace.label}</Link><Link className="council-profile-secondary" to="/events">Browse events <span aria-hidden="true">→</span></Link></div>
                </section>}

                {loading && <p className="council-profile-refresh" role="status">Refreshing account details…</p>}
            </main>
            {cropRequest && <ImageCropDialog file={cropRequest.file} kind={cropRequest.kind} onCancel={() => setCropRequest(null)} onApply={applyCroppedPhoto} />}
        </>
    );
}
