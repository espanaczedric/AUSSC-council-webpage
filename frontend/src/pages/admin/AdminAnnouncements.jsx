import { useEffect, useState } from "react";

import AdminNav from "../../components/AdminNav";
import { AdminPageSkeleton, SkeletonBlock, SkeletonPageHeading } from "../../components/LoadingSkeletons";
import { archiveAdminAnnouncement, getAdminAnnouncements, saveAdminAnnouncement } from "../../services/api";

const emptyForm = { title: "", category: "General", content: "", status: "published" };

function formatDate(value) {
    if (!value) return "Not published";
    const date = new Date(String(value).replace(" ", "T"));
    return Number.isNaN(date.getTime())
        ? "Not published"
        : date.toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });
}

export default function AdminAnnouncements() {
    const [announcements, setAnnouncements] = useState([]);
    const [form, setForm] = useState(emptyForm);
    const [editingId, setEditingId] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [archivingId, setArchivingId] = useState("");
    const [confirmArchiveId, setConfirmArchiveId] = useState("");
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");

    async function loadAnnouncements(showLoading = false) {
        if (showLoading) setLoading(true);
        try {
            const data = await getAdminAnnouncements();
            setAnnouncements(data.announcements || []);
        } catch (requestError) {
            setError(requestError.message || "Announcements could not be loaded.");
        } finally {
            if (showLoading) setLoading(false);
        }
    }

    useEffect(() => { loadAnnouncements(true); }, []);

    async function handleSubmit(event) {
        event.preventDefault();
        setSaving(true);
        setError("");
        setNotice("");
        try {
            const result = await saveAdminAnnouncement({ ...form, id: editingId || undefined });
            setForm(emptyForm);
            setEditingId("");
            setNotice(result.message || "Announcement saved.");
            await loadAnnouncements();
        } catch (requestError) {
            setError(requestError.message || "Announcement could not be saved.");
        } finally {
            setSaving(false);
        }
    }

    function beginEdit(announcement) {
        setEditingId(announcement.id);
        setForm({ title: announcement.title, category: announcement.category || "General", content: announcement.content, status: announcement.status === "published" ? "published" : "draft" });
        setNotice("");
        setError("");
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    async function handleArchive(id) {
        setArchivingId(id);
        setError("");
        setNotice("");
        try {
            const result = await archiveAdminAnnouncement(id);
            setConfirmArchiveId("");
            setNotice(result.message || "Announcement archived.");
            await loadAnnouncements();
        } catch (requestError) {
            setError(requestError.message || "Announcement could not be archived.");
        } finally {
            setArchivingId("");
        }
    }

    function cancelEdit() {
        setForm(emptyForm);
        setEditingId("");
        setError("");
    }

    if (loading) return <AdminPageSkeleton className="announcement-admin-page">
        <header className="admin-header admin-page-heading"><SkeletonPageHeading /></header>
        <section className="announcement-admin-form-skeleton"><SkeletonBlock className="ui-skeleton-section-title" />{Array.from({ length: 4 }, (_, index) => <SkeletonBlock className={index === 2 ? "ui-skeleton-form-area" : "ui-skeleton-form-field"} key={index} />)}</section>
        <section className="announcement-admin-list-skeleton"><SkeletonBlock className="ui-skeleton-section-title" /><SkeletonBlock className="ui-skeleton-form-area" /></section>
    </AdminPageSkeleton>;

    return <>
        <AdminNav />
        <main className="admin-page announcement-admin-page">
            <header className="admin-header admin-page-heading">
                <div>
                    <span>PUBLIC SITE CONTENT</span>
                    <h1>Announcements</h1>
                    <p>Create standalone council notices for the public announcements page. Event updates remain managed through Events.</p>
                </div>
            </header>

            {error && <p className="admin-feedback is-error" role="alert">{error}</p>}
            {notice && <p className="admin-feedback" role="status">{notice}</p>}

            <section className="announcement-admin-compose" aria-labelledby="announcement-compose-title">
                <div className="admin-section-heading"><div><span>{editingId ? "EDIT NOTICE" : "NEW NOTICE"}</span><h2 id="announcement-compose-title">{editingId ? "Update announcement" : "Write an announcement"}</h2></div></div>
                <form className="announcement-admin-form" onSubmit={handleSubmit}>
                    <label>Title<input required maxLength={180} value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="A clear headline for students" /></label>
                    <label>Category<input required maxLength={60} value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} placeholder="General, Important, Campus update…" /></label>
                    <label className="announcement-admin-content-field">Announcement details<textarea required maxLength={5000} rows={8} value={form.content} onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))} placeholder="Share the information students need to know." /></label>
                    <label>Publication status<select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}><option value="published">Publish on public site</option><option value="draft">Save as draft</option></select></label>
                    <p className="announcement-admin-note">Published announcements appear in the public site’s recent announcements list. Drafts remain visible to administrators only.</p>
                    <div className="announcement-admin-actions"><button className="admin-primary-action" type="submit" disabled={saving}>{saving ? "Saving…" : editingId ? "Save announcement" : form.status === "published" ? "Publish announcement" : "Save draft"}</button>{editingId && <button className="admin-secondary-action" type="button" onClick={cancelEdit} disabled={saving}>Cancel editing</button>}</div>
                </form>
            </section>

            <section className="announcement-admin-library" aria-labelledby="announcement-library-title">
                <div className="admin-section-heading"><div><span>CONTENT LIBRARY</span><h2 id="announcement-library-title">Council announcements</h2></div><a className="admin-text-link" href="/announcements" target="_blank" rel="noreferrer">View public page ↗</a></div>
                {announcements.length ? <div className="announcement-admin-list">
                    {announcements.map((announcement) => <article className={`announcement-admin-card is-${announcement.status}`} key={announcement.id}>
                        <div className="announcement-admin-card-copy"><div><span className={`admin-status is-${announcement.status}`}>{announcement.status}</span><span className="announcement-admin-category">{announcement.category || "General"}</span></div><h3>{announcement.title}</h3><p>{announcement.content}</p><small>{announcement.status === "published" ? `Published ${formatDate(announcement.public_updated_at || announcement.published_at)}` : `Updated ${formatDate(announcement.updated_at)}`}</small></div>
                        <div className="announcement-admin-card-actions">
                            {announcement.status !== "archived" && <button className="admin-text-link" type="button" onClick={() => beginEdit(announcement)}>Edit</button>}
                            {announcement.status !== "archived" && (confirmArchiveId === announcement.id ? <div className="announcement-admin-confirm" role="group" aria-label={`Archive ${announcement.title}`}><span>Archive this notice?</span><button className="admin-text-link is-danger" type="button" disabled={archivingId === announcement.id} onClick={() => handleArchive(announcement.id)}>{archivingId === announcement.id ? "Archiving…" : "Confirm"}</button><button className="admin-text-link" type="button" onClick={() => setConfirmArchiveId("")}>Cancel</button></div> : <button className="admin-text-link is-danger" type="button" onClick={() => setConfirmArchiveId(announcement.id)}>Archive</button>)}
                        </div>
                    </article>)}
                </div> : <div className="admin-empty-state"><h3>No announcements yet</h3><p>Write and publish a standalone council notice here. Creating an announcement does not create an event.</p></div>}
            </section>
        </main>
    </>;
}
