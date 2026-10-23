import { useCallback, useEffect, useMemo, useState } from "react";
import AdminNav from "../components/AdminNav";
import { AdminPageSkeleton, SkeletonBlock, SkeletonPageHeading } from "../components/LoadingSkeletons";
import { getMyPublicationTasks, submitPublicationTask, updateMyPublicationTaskProgress } from "../services/api";

function dateLabel(value) {
    if (!value) return "Not scheduled";
    const date = new Date(value.replace?.(" ", "T") || value);
    return Number.isNaN(date.getTime()) ? "Not scheduled" : date.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
}

const statusClass = (status) => String(status || "not-started").toLowerCase().replaceAll(" ", "-");

function LocalAttachmentPreview({ file }) {
    const [url, setUrl] = useState("");
    useEffect(() => {
        if (!file) { setUrl(""); return undefined; }
        const nextUrl = URL.createObjectURL(file);
        setUrl(nextUrl);
        return () => URL.revokeObjectURL(nextUrl);
    }, [file]);
    if (!file || !url) return null;
    if (file.type.startsWith("image/")) return <img className="publication-attachment-preview" src={url} alt="Selected creative attachment preview" />;
    if (file.type.startsWith("video/")) return <video className="publication-attachment-preview" controls preload="metadata" src={url}>Video preview is unavailable.</video>;
    return <p className="publication-file-picked">Preview is unavailable for this format.</p>;
}

function PrivateAttachmentPreview({ submission }) {
    if (!submission?.attachment_url) return null;
    if (submission.content_type?.startsWith("image/")) return <img className="publication-attachment-preview" src={submission.attachment_url} alt={`Your submission version ${submission.version}`} loading="lazy" />;
    if (submission.content_type?.startsWith("video/")) return <video className="publication-attachment-preview" controls preload="metadata" src={submission.attachment_url}>Video preview is unavailable.</video>;
    return null;
}

export default function PublicationTasks() {
    const [data, setData] = useState({ tasks: [], performance: {} });
    const [drafts, setDrafts] = useState({});
    const [filter, setFilter] = useState("all");
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState(null);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");

    const load = useCallback(() => getMyPublicationTasks().then((result) => setData({ tasks: result.tasks || [], performance: result.performance || {} })).catch((requestError) => setError(requestError.message)), []);
    useEffect(() => { let active = true; getMyPublicationTasks().then((result) => { if (active) setData({ tasks: result.tasks || [], performance: result.performance || {} }); }).catch((requestError) => { if (active) setError(requestError.message); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);

    const tasks = useMemo(() => data.tasks.filter((task) => {
        const matchesQuery = `${task.title} ${task.concept || ""} ${task.details || ""} ${task.event_title || ""}`.toLowerCase().includes(query.trim().toLowerCase());
        const matchesFilter = filter === "all" || (filter === "active" ? !["Posted", "Cancelled", "Archived", "Published"].includes(task.status) : task.status === filter);
        return matchesQuery && matchesFilter;
    }), [data.tasks, filter, query]);

    function draftFor(taskId) { return drafts[taskId] || { project_url: "", notes: "", attachment: null }; }
    function updateDraft(taskId, key, value) { setDrafts((current) => ({ ...current, [taskId]: { project_url: "", notes: "", attachment: null, ...current[taskId], [key]: value } })); }

    async function markInProgress(task) {
        setBusyId(task.id); setError(""); setNotice("");
        try { await updateMyPublicationTaskProgress(task.id, "In Design"); setNotice(`${task.title} moved to In Design.`); await load(); }
        catch (requestError) { setError(requestError.message); }
        finally { setBusyId(null); }
    }

    async function submit(event, task) {
        event.preventDefault();
        const draft = draftFor(task.id);
        const formData = new FormData();
        formData.set("id", String(task.id)); formData.set("project_url", draft.project_url); formData.set("notes", draft.notes);
        if (draft.attachment) formData.set("attachment", draft.attachment);
        setBusyId(task.id); setError(""); setNotice("");
        try { await submitPublicationTask(formData); setDrafts((current) => ({ ...current, [task.id]: { project_url: "", notes: "", attachment: null } })); setNotice("Your work was sent for review."); await load(); }
        catch (requestError) { setError(requestError.message); }
        finally { setBusyId(null); }
    }

    const performance = data.performance;
    if (loading) return <AdminPageSkeleton className="publication-member-page"><header className="admin-header admin-page-heading"><SkeletonPageHeading /></header><section className="publication-member-metrics">{Array.from({ length: 4 }, (_, i) => <article key={i}><SkeletonBlock className="ui-skeleton-eyebrow" /><SkeletonBlock className="ui-skeleton-section-title is-small" /></article>)}</section><SkeletonBlock className="ui-skeleton-section-title" />{Array.from({ length: 3 }, (_, i) => <div className="publication-task-skeleton" key={i}><SkeletonBlock className="ui-skeleton-section-title is-small" /><SkeletonBlock className="ui-skeleton-description" /><SkeletonBlock className="ui-skeleton-form-field" /></div>)}</AdminPageSkeleton>;

    return <><AdminNav /><main className="admin-page publication-member-page">
        <header className="admin-header admin-page-heading"><div><span>PUBLICATION COMMITTEE</span><h1>My assigned tasks</h1><p>Review your briefs, submit creative work, and follow feedback through approval and posting.</p></div></header>
        {error && <p className="admin-feedback is-error" role="alert">{error}</p>}{notice && <p className="admin-feedback" role="status">{notice}</p>}
        <section className="publication-member-metrics" aria-label="Your publication performance">
            {[ ["Assigned tasks", performance.total_assigned ?? 0], ["Awaiting review", performance.awaiting_review ?? 0], ["Overdue without submission", performance.overdue ?? 0], ["On-time submission rate", performance.on_time_submission_rate == null ? "N/A" : `${performance.on_time_submission_rate}%`] ].map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}
        </section>
        <section className="publication-task-list-section">
            <div className="publication-task-toolbar"><div><span>YOUR WORK QUEUE</span><h2>Assignments</h2></div><div><input type="search" aria-label="Search assigned tasks" placeholder="Search assignments" value={query} onChange={(event) => setQuery(event.target.value)} /><select aria-label="Filter tasks" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All tasks</option><option value="active">Active</option><option value="Not Started">Not started</option><option value="Request Submitted">Request submitted</option><option value="Requirements Review">Requirements review</option><option value="Assigned">Assigned</option><option value="In Design">In design</option><option value="Internal Review">Internal review</option><option value="Revisions Requested">Revisions requested</option><option value="Awaiting Approval">Awaiting approval</option><option value="Approved">Approved</option><option value="Scheduled">Scheduled</option><option value="Published">Published</option><option value="Archived">Archived</option></select></div></div>
            {tasks.length ? <div className="publication-member-task-grid">{tasks.map((task) => {
                const draft = draftFor(task.id);
                const legacyReviewStageWithoutSubmission = ["Internal Review", "Awaiting Approval"].includes(task.status) && !task.submissions?.length;
                const canSubmit = ["Not Started", "In Progress", "Revision Requested", "Request Submitted", "Requirements Review", "Assigned", "In Design", "Revisions Requested"].includes(task.status) || legacyReviewStageWithoutSubmission;
                const latestSubmission = task.submissions?.[task.submissions.length - 1];
                return <article className="publication-member-task" key={task.id}>
                    <div className="publication-member-task-head"><div><span className={`publication-status is-${statusClass(task.status)}`}>{task.status}</span><span className={`committee-priority is-${task.priority || "normal"}`}>{task.priority || "normal"} priority</span></div><h3>{task.title}</h3><p>{task.event_title || "Council-wide"}</p></div>
                    {task.concept && <section><strong>Creative direction</strong><p>{task.concept}</p></section>}
                    <section><strong>Brief and instructions</strong><p>{task.details || "No additional instructions."}</p></section>
                    {task.deliverables?.length > 0 && <section><strong>Required deliverables</strong><ul>{task.deliverables.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></section>}
                    <div className="publication-task-dates"><div><span>Submission deadline</span><strong>{dateLabel(task.due_at)}</strong></div><div><span>Scheduled post</span><strong>{dateLabel(task.scheduled_post_at)}</strong></div></div>
                    {task.published_url && <p className="publication-published-link"><strong>Published material</strong><a href={task.published_url} target="_blank" rel="noreferrer">Open public post ↗</a></p>}
                    {latestSubmission?.review_note && <aside className="publication-feedback-note"><strong>Reviewer feedback · {dateLabel(latestSubmission.reviewed_at)}</strong><p>{latestSubmission.review_note}</p></aside>}
                    {task.submissions?.length > 0 && <details className="publication-submission-history"><summary>Submission history ({task.submissions.length})</summary>{task.submissions.map((submission) => <div key={submission.version}><strong>Version {submission.version} · {dateLabel(submission.submitted_at)}</strong><span>{submission.review_status?.replaceAll("_", " ") || "Awaiting review"}</span>{submission.notes && <p>{submission.notes}</p>}{submission.project_url && <a href={submission.project_url} target="_blank" rel="noreferrer">Open project link ↗</a>}{submission.attachment_url && <><PrivateAttachmentPreview submission={submission} /><a href={submission.attachment_url} target="_blank" rel="noreferrer">Open uploaded file ↗</a></>}</div>)}</details>}
                    {["Not Started", "Assigned"].includes(task.status) && <button className="publication-secondary-action" type="button" disabled={busyId === task.id} onClick={() => markInProgress(task)}>{busyId === task.id ? "Updating…" : "Start design"}</button>}
                    {canSubmit && <form className="publication-submit-form" onSubmit={(event) => submit(event, task)}><h4>{task.status === "Revision Requested" || task.status === "Revisions Requested" ? "Submit a revised version" : "Submit your work"}</h4><label>Project link<input type="url" value={draft.project_url} onChange={(event) => updateDraft(task.id, "project_url", event.target.value)} placeholder="https://…" /></label><label>Submission notes<textarea rows="3" maxLength="2000" value={draft.notes} onChange={(event) => updateDraft(task.id, "notes", event.target.value)} placeholder="Tell the reviewer what changed or needs attention" /></label><label>Image or video attachment<input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" onChange={(event) => updateDraft(task.id, "attachment", event.target.files?.[0] || null)} /><small>JPG, PNG, WebP, MP4, WebM, or MOV · up to 4 MB</small></label>{draft.attachment && <><p className="publication-file-picked">Selected: {draft.attachment.name}</p><LocalAttachmentPreview file={draft.attachment} /></>}<button className="admin-primary-action" disabled={busyId === task.id || (!draft.project_url && !draft.attachment)}>{busyId === task.id ? "Submitting…" : "Send for review"}</button></form>}
                </article>;
            })}</div> : <div className="publication-empty-state"><h3>No assignments match this view.</h3><p>New work assigned to you will appear here with its brief and deadline.</p></div>}
        </section>
    </main></>;
}
