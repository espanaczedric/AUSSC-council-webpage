import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import AdminNav from "../../components/AdminNav";
import CommitteeWorkspaceTabs from "../../components/CommitteeWorkspaceTabs";
import PublicationTasks from "../PublicationTasks";
import { AdminPageSkeleton, SkeletonBlock, SkeletonRows } from "../../components/LoadingSkeletons";
import { archivePublicationTask, cancelPublicationTask, getAdminPublicationTasks, getCommitteeWork, recordPublicationPost, reviewPublicationTask, saveCommitteeWork } from "../../services/api";

const blankForm = { id: "", title: "", event_id: "", assignee_user_id: "", concept: "", details: "", deliverables: "", due_at: "", scheduled_post_at: "", priority: "normal", status: "Assigned" };
const workflowStatuses = ["Not Started", "In Progress", "Submitted for Review", "Revision Requested", "Approved", "Posted", "Cancelled", "Request Submitted", "Requirements Review", "Assigned", "In Design", "Internal Review", "Revisions Requested", "Awaiting Approval", "Scheduled", "Published", "Archived"];
const statusTransitions = {
    "Request Submitted": ["Requirements Review"], "Requirements Review": ["Assigned", "Request Submitted"],
    Assigned: ["Request Submitted"], "Internal Review": ["Awaiting Approval"], "Awaiting Approval": [],
    "Revisions Requested": ["In Design"], Approved: ["Scheduled"], Scheduled: ["Approved"], Published: ["Archived"],
    "Not Started": ["In Design"], "In Progress": ["In Design"]
};
const statusClass = (status) => String(status || "not-started").toLowerCase().replaceAll(" ", "-");

function dateLabel(value) {
    if (!value) return "Not scheduled";
    const date = new Date(value.replace?.(" ", "T") || value);
    return Number.isNaN(date.getTime()) ? "Not scheduled" : date.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
}

function manilaInput(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function PrivateAttachmentPreview({ submission }) {
    if (!submission?.attachment_url) return null;
    if (submission.content_type?.startsWith("image/")) return <img className="publication-attachment-preview" src={submission.attachment_url} alt={`Preview for submission version ${submission.version}`} loading="lazy" />;
    if (submission.content_type?.startsWith("video/")) return <video className="publication-attachment-preview" controls preload="metadata" src={submission.attachment_url}>Video preview is unavailable.</video>;
    return null;
}

function readExecutive() {
    try {
        const user = JSON.parse(localStorage.getItem("user") || "null");
        const positions = ["governor", "vice_governor", "secretary", "treasurer", "auditor", "social_media_manager"];
        return Boolean(user?.role === "admin" || user?.committee_assignment === "executive" || positions.includes(user?.council_position));
    } catch { return false; }
}

export default function PublicationWorkspace() {
    const [searchParams] = useSearchParams();
    const [data, setData] = useState({ tasks: [], metrics: {}, members: [], performance_by_member: [], events: [] });
    const [form, setForm] = useState(blankForm);
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState("all");
    const [viewMode, setViewMode] = useState("board");
    const [selectedId, setSelectedId] = useState(null);
    const [postedAt, setPostedAt] = useState(() => manilaInput());
    const [publishedUrl, setPublishedUrl] = useState("");
    const [reviewNote, setReviewNote] = useState("");
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [assignmentOpen, setAssignmentOpen] = useState(false);
    const dialogRef = useRef(null);
    const closeButtonRef = useRef(null);
    const executive = useMemo(readExecutive, []);

    useEffect(() => {
        if (!assignmentOpen) return undefined;
        const previousFocus = document.activeElement;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
        const handleDialogKeys = (event) => {
            if (event.key === "Escape") { event.preventDefault(); setAssignmentOpen(false); return; }
            if (event.key !== "Tab") return;
            const focusable = [...(dialogRef.current?.querySelectorAll("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]") || [])];
            if (!focusable.length) return;
            if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1).focus(); }
            else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus(); }
        };
        document.addEventListener("keydown", handleDialogKeys);
        return () => {
            window.cancelAnimationFrame(focusFrame);
            document.body.style.overflow = previousOverflow;
            document.removeEventListener("keydown", handleDialogKeys);
            if (previousFocus?.isConnected) previousFocus.focus();
        };
    }, [assignmentOpen]);

    const load = useCallback(async () => {
        if (!executive) return;
        const [publication, workspace] = await Promise.all([getAdminPublicationTasks(), getCommitteeWork("publication")]);
        setData({ ...publication, events: workspace.events || [] });
        setSelectedId((current) => {
            const requested = Number(searchParams.get("task"));
            if (requested && publication.tasks?.some((task) => task.id === requested)) return requested;
            return current && publication.tasks?.some((task) => task.id === current) ? current : publication.tasks?.[0]?.id || null;
        });
    }, [executive, searchParams]);

    useEffect(() => {
        if (!executive) return undefined;
        let active = true;
        Promise.all([getAdminPublicationTasks(), getCommitteeWork("publication")]).then(([publication, workspace]) => {
            if (!active) return;
            setData({ ...publication, events: workspace.events || [] });
            const requested = Number(searchParams.get("task"));
            setSelectedId(requested && publication.tasks?.some((task) => task.id === requested) ? requested : publication.tasks?.[0]?.id || null);
        }).catch((requestError) => { if (active) setError(requestError.message); }).finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [executive, searchParams]);

    const tasks = useMemo(() => (data.tasks || []).filter((task) => {
        const words = `${task.title} ${task.event_title || ""} ${task.assignee_name || ""} ${task.concept || ""}`.toLowerCase();
        if (!words.includes(query.trim().toLowerCase())) return false;
        if (filter === "review") return ["Submitted for Review", "Internal Review", "Awaiting Approval"].includes(task.status);
        if (filter === "overdue") return data.metrics?.task_classifications?.some((item) => item.task_id === task.id && item.overdue);
        if (filter === "active") return !["Posted", "Cancelled", "Archived", "Published"].includes(task.status);
        return filter === "all" || task.status === filter;
    }), [data.tasks, data.metrics, filter, query]);
    const selectedTask = data.tasks.find((task) => task.id === selectedId) || null;
    const latestSubmission = selectedTask?.submissions?.[selectedTask.submissions.length - 1] || null;

    function beginCreate() {
        setForm(blankForm);
        setError("");
        setNotice("");
        setAssignmentOpen(true);
    }

    function editTask(task) {
        setForm({ ...blankForm, ...task, id: String(task.id), event_id: task.event_id ? String(task.event_id) : "", assignee_user_id: task.assignee_user_id ? String(task.assignee_user_id) : "", due_at: task.due_at ? manilaInput(task.due_at) : "", scheduled_post_at: task.scheduled_post_at ? manilaInput(task.scheduled_post_at) : "", deliverables: (task.deliverables || []).join("\n") });
        setSelectedId(task.id);
        setError("");
        setNotice("");
        setAssignmentOpen(true);
    }

    async function saveTask(event) {
        event.preventDefault();
        setBusy(true); setError(""); setNotice("");
        try {
            await saveCommitteeWork({ ...form, kind: "pubmat", committee: "publication", status: form.id ? form.status : (form.assignee_user_id ? "Assigned" : "Request Submitted"), event_id: form.event_id || null, assignee_user_id: form.assignee_user_id || null, deliverables: form.deliverables });
            setNotice(form.id ? "Publication assignment updated." : "Publication task created and assigned.");
            setForm(blankForm);
            setAssignmentOpen(false);
            await load();
        } catch (requestError) { setError(requestError.message); }
        finally { setBusy(false); }
    }

    async function cancelTask(task) {
        if (!window.confirm(`Cancel “${task.title}”? Members will be notified.`)) return;
        setBusy(true); setError(""); setNotice("");
        try { await cancelPublicationTask(task.id); setNotice("Publication task cancelled."); await load(); }
        catch (requestError) { setError(requestError.message); }
        finally { setBusy(false); }
    }

    async function archiveTask(task) {
        if (!window.confirm(`Archive “${task.title}” from the active publication queue?`)) return;
        setBusy(true); setError(""); setNotice("");
        try { await archivePublicationTask(task.id); setNotice("Published material archived."); await load(); }
        catch (requestError) { setError(requestError.message); }
        finally { setBusy(false); }
    }

    async function advanceStatus(task, status) {
        setBusy(true); setError(""); setNotice("");
        try {
            await saveCommitteeWork({ id: task.id, committee: "publication", kind: "pubmat", title: task.title, details: task.details || "", concept: task.concept || "", deliverables: (task.deliverables || []).join("\n"), event_id: task.event_id || null, assignee_user_id: task.assignee_user_id || null, due_at: task.due_at ? manilaInput(task.due_at) : "", scheduled_post_at: task.scheduled_post_at ? manilaInput(task.scheduled_post_at) : "", priority: task.priority || "normal", attachment_url: task.attachment_url || "", status });
            setNotice(`Task moved to ${status}.`); await load();
        } catch (requestError) { setError(requestError.message); }
        finally { setBusy(false); }
    }

    async function review(decision) {
        if (!selectedTask) return;
        setBusy(true); setError(""); setNotice("");
        try { await reviewPublicationTask(selectedTask.id, decision, reviewNote); setReviewNote(""); setNotice(decision === "approve" ? "Submission approved." : "Revision request sent to the designer."); await load(); }
        catch (requestError) { setError(requestError.message); }
        finally { setBusy(false); }
    }

    async function recordPost() {
        if (!selectedTask) return;
        setBusy(true); setError(""); setNotice("");
        try { await recordPublicationPost(selectedTask.id, postedAt, publishedUrl); setNotice("Actual publication time recorded."); await load(); }
        catch (requestError) { setError(requestError.message); }
        finally { setBusy(false); }
    }

    const metrics = data.metrics || {};
    const statusCounts = workflowStatuses.map((status) => ({ status, count: data.tasks.filter((task) => task.status === status).length })).filter((item) => item.count > 0);
    const maxStatusCount = Math.max(1, ...statusCounts.map((item) => item.count));

    if (!executive) return <PublicationTasks />;

    if (loading) return <AdminPageSkeleton className="publication-admin-page"><header className="admin-header admin-page-heading"><div><span>COMMITTEE WORKSPACE</span><h1>Publication Committee</h1><p>Assign creative work, review submissions, track deadlines, and record when approved materials go live.</p><CommitteeWorkspaceTabs activeCommittee="publication" /></div><SkeletonBlock className="ui-skeleton-button" /></header><section className="publication-admin-metrics">{Array.from({ length: 5 }, (_, index) => <article key={index}><SkeletonBlock className="ui-skeleton-eyebrow" /><SkeletonBlock className="ui-skeleton-section-title is-small" /></article>)}</section><div className="publication-admin-skeleton"><section><SkeletonBlock className="ui-skeleton-section-title" /><SkeletonRows count={5} /></section><section><SkeletonBlock className="ui-skeleton-section-title" /><SkeletonBlock className="ui-skeleton-form-grid" /></section></div></AdminPageSkeleton>;


    return <><AdminNav /><main className="admin-page publication-admin-page">
        <header className="admin-header admin-page-heading"><div><span>COMMITTEE WORKSPACE</span><h1>Publication Committee</h1><p>Assign creative work, review submissions, track deadlines, and record when approved materials go live.</p><CommitteeWorkspaceTabs activeCommittee="publication" /></div><button className="admin-primary-action" type="button" onClick={beginCreate}>＋ Create publication task</button></header>
        {error && <p className="admin-feedback is-error" role="alert">{error}</p>}{notice && <p className="admin-feedback" role="status">{notice}</p>}
        <section className="publication-admin-metrics" aria-label="Publication workflow summary">
            {[["Tasks tracked", metrics.total_assigned ?? 0], ["Awaiting review", metrics.awaiting_review ?? 0], ["Overdue submissions", metrics.overdue ?? 0], ["On-time submissions", metrics.on_time_submission_rate == null ? "N/A" : `${metrics.on_time_submission_rate}%`], ["On-time posting", metrics.on_time_publication_rate == null ? "N/A" : `${metrics.on_time_publication_rate}%`]].map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}
        </section>
        <section className="publication-analytics-grid">
            <article className="publication-analytics-card"><div className="admin-section-heading"><div><span>WORKLOAD SNAPSHOT</span><h2>Tasks by status</h2></div></div>{statusCounts.length ? <div className="publication-status-chart" role="img" aria-label={statusCounts.map(({ status, count }) => `${status}: ${count}`).join(", ")}>{statusCounts.map(({ status, count }) => <div className="publication-chart-row" key={status}><span>{status}</span><i><b style={{ width: `${Math.max(4, count / maxStatusCount * 100)}%` }} /></i><strong>{count}</strong></div>)}</div> : <p className="publication-chart-empty">Create assignments to see the workflow distribution.</p>}</article>
            <article className="publication-analytics-card"><div className="admin-section-heading"><div><span>TEAM PERFORMANCE</span><h2>Individual delivery</h2></div></div>{data.performance_by_member.length ? <div className="publication-performance-list">{data.performance_by_member.map(({ user, performance }) => <div className="publication-performance-row" key={user.id}><div><strong>{user.first_name} {user.last_name}</strong><span>{performance.total_assigned} tracked assignments · {performance.submitted} submitted</span></div><b>{performance.on_time_submission_rate == null ? "N/A" : `${performance.on_time_submission_rate}%`}<small>on time</small></b></div>)}</div> : <p className="publication-chart-empty">No member assignments have been made yet.</p>}</article>
        </section>
        <section className="publication-admin-workarea">
            <section className="publication-admin-queue"><div className="admin-section-heading"><div><span>SHARED WORK ITEMS</span><h2>Assignment queue</h2></div><span>{tasks.length} shown</span></div><div className="publication-admin-filters"><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, event, or assignee" aria-label="Search publication assignments" /><select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter publication assignments"><option value="all">All statuses</option><option value="active">Active</option><option value="review">Awaiting review</option><option value="overdue">Overdue</option>{workflowStatuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></div>
                <div className="publication-view-toggle" role="group" aria-label="Choose task view"><button type="button" className={viewMode === "board" ? "is-active" : ""} onClick={() => setViewMode("board")}>Board</button><button type="button" className={viewMode === "list" ? "is-active" : ""} onClick={() => setViewMode("list")}>List</button></div>
                {tasks.length ? viewMode === "list" ? <div className="publication-admin-task-list">{tasks.map((task) => {
                    const classification = metrics.task_classifications?.find((item) => item.task_id === task.id);
                    return <article className={task.id === selectedId ? "is-selected" : ""} key={task.id}><button type="button" className="publication-admin-task-select" onClick={() => { setSelectedId(task.id); setReviewNote(""); }}><span className={`publication-status is-${statusClass(task.status)}`}>{task.status}</span><strong>{task.title}</strong><span>{task.event_title || "Council-wide"} · {task.assignee_name || "Unassigned"}</span><small>Due {dateLabel(task.due_at)} · Post {dateLabel(task.scheduled_post_at)}</small>{classification?.overdue && <em>Submission overdue</em>}</button><button type="button" className="publication-edit-task" onClick={() => editTask(task)}>Edit</button></article>;
                })}</div> : <div className="publication-admin-board">{workflowStatuses.filter((status) => tasks.some((task) => task.status === status)).map((status) => <section key={status}><h3>{status}<span>{tasks.filter((task) => task.status === status).length}</span></h3>{tasks.filter((task) => task.status === status).map((task) => <button type="button" key={task.id} className={`publication-board-card${task.id === selectedId ? " is-selected" : ""}`} onClick={() => setSelectedId(task.id)}><strong>{task.title}</strong><span>{task.event_title || "Council-wide"}</span><small>{task.assignee_name || "Unassigned"}</small><small>Due {dateLabel(task.due_at)}</small></button>)}</section>)}</div> : <div className="publication-empty-state"><h3>No publication tasks found.</h3><p>Create an assignment to start tracking a pubmat request.</p></div>}
            </section>
            <section className="publication-admin-detail">
                {selectedTask ? <>
                    <div className="admin-section-heading"><div><span>TASK DETAILS</span><h2>{selectedTask.title}</h2></div><span className={`publication-status is-${statusClass(selectedTask.status)}`}>{selectedTask.status}</span></div>
                    <dl className="publication-detail-meta"><div><dt>Assignee</dt><dd>{selectedTask.assignee_name || "Unassigned"}</dd></div><div><dt>Event</dt><dd>{selectedTask.event_title || "Council-wide"}</dd></div><div><dt>Submission deadline</dt><dd>{dateLabel(selectedTask.due_at)}</dd></div><div><dt>Scheduled post</dt><dd>{dateLabel(selectedTask.scheduled_post_at)}</dd></div></dl>
                    {selectedTask.concept && <div className="publication-detail-copy"><strong>Creative direction</strong><p>{selectedTask.concept}</p></div>}<div className="publication-detail-copy"><strong>Brief and instructions</strong><p>{selectedTask.details || "No additional brief provided."}</p></div>{selectedTask.deliverables?.length > 0 && <div className="publication-detail-copy"><strong>Required deliverables</strong><ul>{selectedTask.deliverables.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></div>}
                    {selectedTask.activity?.length > 0 && <details className="publication-activity-history"><summary>Task activity ({selectedTask.activity.length})</summary>{selectedTask.activity.slice(-12).reverse().map((entry, index) => <div key={`${entry.at}-${index}`}><strong>{entry.status}</strong><span>{dateLabel(entry.at)}</span>{entry.note && <p>{entry.note}</p>}</div>)}</details>}
                    {selectedTask.submissions?.length > 0 && <div className="publication-admin-submissions"><h3>Submission history</h3>{selectedTask.submissions.map((submission) => <article key={submission.version}><div><strong>Version {submission.version}</strong><span>{dateLabel(submission.submitted_at)} · {submission.review_status?.replaceAll("_", " ") || "pending"}</span></div>{submission.notes && <p>{submission.notes}</p>}{submission.project_url && <a href={submission.project_url} target="_blank" rel="noreferrer">Open project link ↗</a>}{submission.attachment_url && <><PrivateAttachmentPreview submission={submission} /><a href={submission.attachment_url} target="_blank" rel="noreferrer">Open attachment ↗</a></>}{submission.review_note && <aside><strong>Review feedback</strong><p>{submission.review_note}</p></aside>}</article>)}</div>}
                    {["Submitted for Review", "Internal Review", "Awaiting Approval"].includes(selectedTask.status) && latestSubmission && <form className="publication-review-form" onSubmit={(event) => event.preventDefault()}><h3>Review latest submission</h3><label>Feedback{selectedTask.submissions?.length > 0 && latestSubmission.review_note && <small>Previous feedback: {latestSubmission.review_note}</small>}<textarea rows="4" maxLength="2000" value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="Add feedback; required when requesting revisions" /></label><div><button type="button" className="admin-secondary-action" disabled={busy || !reviewNote.trim()} onClick={() => review("revision")}>Request revisions</button><button type="button" className="admin-primary-action" disabled={busy} onClick={() => review("approve")}>{busy ? "Saving…" : "Approve submission"}</button></div></form>}
                    {["Approved", "Scheduled"].includes(selectedTask.status) && <div className="publication-post-form"><h3>Record publication</h3><p>Save the actual posting time and public link for this approved material.</p><label>Published at<input type="datetime-local" value={postedAt} onChange={(event) => setPostedAt(event.target.value)} /></label><label>Public post link <small>Optional</small><input type="url" value={publishedUrl} onChange={(event) => setPublishedUrl(event.target.value)} placeholder="https://www.instagram.com/p/…" /></label><button className="admin-primary-action" type="button" disabled={busy || !postedAt} onClick={recordPost}>{busy ? "Saving…" : "Mark as published"}</button></div>}{selectedTask.published_url && <p className="publication-published-link"><strong>Published material</strong><a href={selectedTask.published_url} target="_blank" rel="noreferrer">Open public post ↗</a></p>}
                    {selectedTask.status === "Published" && <button className="publication-archive-task" type="button" disabled={busy} onClick={() => archiveTask(selectedTask)}>Archive published material</button>}
                    {!['Cancelled', 'Posted', 'Archived', 'Published'].includes(selectedTask.status) && <button className="publication-cancel-task" type="button" disabled={busy} onClick={() => cancelTask(selectedTask)}>Cancel this task</button>}
                </> : <div className="publication-empty-state"><h3>Select an assignment</h3><p>Choose a task from the queue to review its brief, submission history, and status.</p></div>}
            </section>
        </section>
    </main>
    {assignmentOpen && createPortal(
        <div className="publication-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setAssignmentOpen(false); }}>
            <section ref={dialogRef} className="publication-create-panel publication-create-modal" id="publication-task-form" role="dialog" aria-modal="true" aria-labelledby="publication-task-form-title" tabIndex={-1}>
                <header className="publication-create-modal-header"><div><span>ASSIGNMENT SETUP</span><h2 id="publication-task-form-title">{form.id ? "Edit publication task" : "Create publication task"}</h2><p>Set the brief, designer, deadline, and required deliverables.</p></div><button ref={closeButtonRef} className="publication-create-modal-close" type="button" disabled={busy} aria-label="Close assignment setup" onClick={() => setAssignmentOpen(false)}>×</button></header>
                {error && <p className="admin-feedback is-error" role="alert">{error}</p>}
                <form className="publication-create-form" onSubmit={saveTask}>
                    <label>Task title<input required maxLength="180" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="e.g. Student assembly announcement pubmat" /></label>
                    <label>Related event<select value={form.event_id} onChange={(event) => setForm({ ...form, event_id: event.target.value })}><option value="">Council-wide / no linked event</option>{data.events.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}</select></label>
                    <label>Assigned designer<select value={form.assignee_user_id} onChange={(event) => setForm({ ...form, assignee_user_id: event.target.value })}><option value="">Unassigned</option>{data.members.map((member) => <option key={member.id} value={member.id}>{member.first_name} {member.last_name} · {member.email}</option>)}</select></label>
                    <label>Priority<select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}>{["low", "normal", "high", "urgent"].map((priority) => <option key={priority} value={priority}>{priority[0].toUpperCase() + priority.slice(1)}</option>)}</select></label>
                    <label>Submission deadline<input type="datetime-local" value={form.due_at} onChange={(event) => setForm({ ...form, due_at: event.target.value })} /></label>
                    <label>Scheduled posting date<input type="datetime-local" value={form.scheduled_post_at} onChange={(event) => setForm({ ...form, scheduled_post_at: event.target.value })} /></label>
                    {form.id && <label>Workflow stage<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>{[form.status, ...(statusTransitions[form.status] || [])].filter((status, index, all) => all.indexOf(status) === index).map((status) => <option key={status} value={status}>{status}</option>)}</select></label>}
                    <label className="is-wide">Creative direction<textarea rows="3" maxLength="1000" value={form.concept} onChange={(event) => setForm({ ...form, concept: event.target.value })} placeholder="Audience, message, tone, dimensions, brand notes…" /></label>
                    <label className="is-wide">Design brief and requirements<textarea rows="4" maxLength="4000" value={form.details} onChange={(event) => setForm({ ...form, details: event.target.value })} placeholder="Instructions and reference details for the assigned member" /></label>
                    <label className="is-wide">Required deliverables <small>One item per line</small><textarea rows="3" maxLength="4000" value={form.deliverables} onChange={(event) => setForm({ ...form, deliverables: event.target.value })} placeholder={"Square feed graphic\nStory-sized version\nCaption draft"} /></label>
                    <div className="publication-create-actions"><button className="admin-secondary-action" type="button" disabled={busy} onClick={() => setAssignmentOpen(false)}>Cancel</button><button className="admin-primary-action" disabled={busy}>{busy ? "Saving…" : form.id ? "Save task changes" : "Create and assign task"}</button></div>
                </form>
            </section>
        </div>,
        document.body
    )}
</>;

}
