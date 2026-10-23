import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

import AdminNav from "../../components/AdminNav";
import CommitteeWorkspaceTabs from "../../components/CommitteeWorkspaceTabs";
import { AdminPageSkeleton, SkeletonBlock, SkeletonRows } from "../../components/LoadingSkeletons";
import { deleteCommitteeWork, getCommitteeWork, reviewAdminEvent, saveCommitteeWork, updateCommitteeChecklist } from "../../services/api";
import { hasExecutiveAccess } from "../../utils/workspaceAccess";

const workspaces = {
    executive: { title: "Executive Committee", intro: "Council-wide progress, approvals, and event oversight.", kinds: ["approval", "task"], focus: ["Pending approvals", "Committee progress", "Recent activity"] },
    publication: { title: "Publication Committee", intro: "Track creative requests from brief review through publication.", kinds: ["pubmat", "task"], focus: ["Design board", "Upcoming deadlines", "Published materials"] },
    production: { title: "Production Committee", intro: "Coordinate setup, equipment, technical assignments, and operations.", kinds: ["production", "task"], focus: ["Production tasks", "Equipment & resources", "Operational issues"] },
    program: { title: "Program Committee", intro: "Plan event schedules, segments, speakers, and run-of-show tasks.", kinds: ["program", "task"], focus: ["Run of show", "Preparation checklist", "Assigned personnel"] }
};

const publicationStatuses = ["Request Submitted", "Requirements Review", "Assigned", "In Design", "Internal Review", "Revisions Requested", "Awaiting Approval", "Approved", "Scheduled", "Published", "Archived"];
const taskStatuses = ["Not Started", "In Progress", "Blocked", "Complete"];
const emptyForm = { id: "", kind: "task", title: "", details: "", event_id: "", assignee_user_id: "", due_at: "", priority: "normal", status: "Not Started", attachment_url: "", time_slot: "", duration_minutes: "", checklist_text: "", confirm_class_conflict: false };

function dateLabel(value) {
    if (!value) return "No deadline";
    const date = new Date(value.replace(" ", "T"));
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
}

export default function CommitteeWorkspace() {
    const { committee = "executive" } = useParams();
    const workspace = workspaces[committee] || workspaces.executive;
    const canSwitchWorkspace = useMemo(() => {
        try { return hasExecutiveAccess(JSON.parse(localStorage.getItem("user") || "null")); } catch { return false; }
    }, []);
    const [data, setData] = useState({ items: [], events: [], users: [] });
    const [form, setForm] = useState(emptyForm);
    const [view, setView] = useState("board");
    const [query, setQuery] = useState("");
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");

    const load = useCallback(() => getCommitteeWork(committee).then(setData).catch((requestError) => setError(requestError.message)), [committee]);
    useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]);
    useEffect(() => { setView(committee === "program" ? "list" : "board"); setForm(emptyForm); }, [committee]);

    const items = useMemo(() => data.items.filter((item) => {
        const words = `${item.title} ${item.details} ${item.event_title} ${item.assignee_name}`.toLowerCase();
        return words.includes(query.trim().toLowerCase());
    }).sort((a, b) => committee === "program" ? (a.time_slot || "99:99").localeCompare(b.time_slot || "99:99") : 0), [data.items, query, committee]);
    const overdue = items.filter((item) => item.due_at && new Date(item.due_at) < new Date() && !["Complete", "Published", "Archived"].includes(item.status)).length;

    async function submit(event) {
        event.preventDefault(); setBusy(true); setError(""); setNotice("");
        try {
            await saveCommitteeWork({ ...form, committee, event_id: form.event_id || null, assignee_user_id: form.assignee_user_id || null });
            setForm(emptyForm); setNotice("Workspace item saved."); await load();
        } catch (requestError) { setError(requestError.message); }
        finally { setBusy(false); }
    }

    function edit(item) {
        setForm({ ...emptyForm, ...item, due_at: item.due_at ? item.due_at.replace(" ", "T").slice(0, 16) : "", event_id: item.event_id || "", assignee_user_id: item.assignee_user_id || "", duration_minutes: item.duration_minutes || "", checklist_text: (item.checklist || []).map((entry) => entry.label).join("\n") });
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    async function remove(id) {
        if (!window.confirm("Delete this workspace item?")) return;
        try { await deleteCommitteeWork(id); setNotice("Workspace item deleted."); await load(); }
        catch (requestError) { setError(requestError.message); }
    }

    async function toggleChecklist(item, entry) {
        try { await updateCommitteeChecklist(item.id, entry.label, !entry.done); await load(); }
        catch (requestError) { setError(requestError.message); }
    }

    async function decideEvent(event, decision) {
        try { await reviewAdminEvent(event.id, decision); setNotice(decision === "approve" ? "Event approved and published." : "Event returned to draft."); await load(); }
        catch (requestError) { setError(requestError.message); }
    }

    const allowedKinds = workspace.kinds;
    const statuses = form.kind === "pubmat" ? publicationStatuses : taskStatuses;
    const eventAvailability = form.event_id ? data.availability?.filter((item) => String(item.event_id) === String(form.event_id)) || [] : [];
    const availableUserIds = new Set(eventAvailability.map((item) => Number(item.user_id)));
    const assignableUsers = form.event_id
        ? data.users.filter((user) => availableUserIds.has(Number(user.id)) || Number(user.id) === Number(form.assignee_user_id))
        : data.users;
    const selectedAvailability = eventAvailability.find((item) => Number(item.user_id) === Number(form.assignee_user_id));
    const columns = (committee === "publication" ? publicationStatuses : taskStatuses).filter((status) => items.some((item) => item.status === status));
    const overview = data.overview || {};
    const focusMetrics = committee === "executive" ? [
        ["Council events", `${overview.active_event_count || 0} active · ${overview.event_count || 0} total`],
        ["Approval queue", `${overview.pending_approval_count || 0} pending`],
        ["Committee progress", `${items.filter((item) => item.status === "Complete" || item.status === "Approved").length} complete · ${items.length} items`],
        ["Approved budget / expenses", `${new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(overview.approved_allocation_total || 0)} / ${new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(overview.recorded_expense_total || 0)}`],
        ["Participation", `${overview.pending_response_count || 0} pending`]
    ] : workspace.focus.map((label, index) => [label, index === 0 ? `${items.filter((item) => !["Complete", "Published", "Archived"].includes(item.status)).length} active items` : index === 1 ? `${overdue} overdue` : `${items.length} total records`]);

    if (loading) return <AdminPageSkeleton className="committee-workspace-page">
        <header className="admin-header admin-page-heading"><div><span>COMMITTEE WORKSPACE</span><h1>{workspace.title}</h1><p>{workspace.intro}</p>{canSwitchWorkspace && <CommitteeWorkspaceTabs activeCommittee={committee} />}</div></header>
        <section className="committee-focus-grid" aria-hidden="true">{Array.from({ length: committee === "executive" ? 5 : 3 }, (_, index) => <article key={index}><SkeletonBlock className="ui-skeleton-eyebrow" /><SkeletonBlock className="ui-skeleton-section-title is-small" /><SkeletonBlock className="ui-skeleton-description" /></article>)}</section>
        <div className="committee-work-board-skeleton"><section><SkeletonBlock className="ui-skeleton-section-title" /><div className="ui-skeleton-board-columns">{Array.from({ length: committee === "publication" ? 4 : 3 }, (_, index) => <div key={index}><SkeletonBlock className="ui-skeleton-eyebrow" /><SkeletonRows count={2} /></div>)}</div></section><section><SkeletonBlock className="ui-skeleton-section-title" />{Array.from({ length: 5 }, (_, index) => <div className="ui-skeleton-work-field" key={index}><SkeletonBlock className="ui-skeleton-form-label" /><SkeletonBlock className="ui-skeleton-form-field" /></div>)}</section></div>
    </AdminPageSkeleton>;

    return <><AdminNav /><main className="admin-page committee-workspace-page">
        <header className="admin-header admin-page-heading"><div><span>COMMITTEE WORKSPACE</span><h1>{workspace.title}</h1><p>{workspace.intro}</p>{canSwitchWorkspace && <CommitteeWorkspaceTabs activeCommittee={committee} />}</div></header>
        <section className="committee-focus-grid" aria-label="Workspace overview">
            {focusMetrics.map(([label, value], index) => <article key={label}><span>0{index + 1}</span><strong>{label}</strong><small>{value}</small></article>)}
        </section>

        {committee === "executive" && data.event_queue?.length > 0 && <section className="committee-approval-queue"><div className="admin-section-heading"><div><span>COUNCIL REVIEW</span><h2>Event publication queue</h2></div><span>{data.event_queue.length} pending</span></div>{data.event_queue.map((event) => <article key={`event-${event.id}`}><div><strong>{event.title}</strong><span>Event publication · {event.location}</span><p>{dateLabel(event.start_date)} · {event.description}</p></div><div><button type="button" onClick={() => decideEvent(event, "approve")}>Publish</button><button type="button" onClick={() => decideEvent(event, "return")}>Return to draft</button></div></article>)}</section>}

        {committee === "executive" && items.length > 0 && <section className="committee-recent-activity"><div><span>COUNCIL-WIDE</span><h2>Recent activity</h2></div>{[...items].sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at)).slice(0, 5).map((item) => <article key={item.id}><div><strong>{item.title}</strong><span>{item.event_title} · {item.committee}</span></div><div><span>{item.status}</span><small>{dateLabel(item.updated_at || item.created_at)}</small></div></article>)}</section>}

        <section className="committee-create-card">
            <div className="admin-section-heading"><div><span>WORKFLOW</span><h2>{form.id ? "Update work item" : "Add to workspace"}</h2></div></div>
            <form onSubmit={submit} className="committee-work-form">
                <label>Work type<select disabled={Boolean(form.id)} value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value, status: event.target.value === "pubmat" ? "Request Submitted" : "Not Started" })}>{allowedKinds.map((kind) => <option key={kind} value={kind}>{kind === "pubmat" ? "Pubmat" : kind[0].toUpperCase() + kind.slice(1)}</option>)}</select></label>
                <label>Title<input required maxLength="180" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder={committee === "program" ? "Opening remarks" : "Add a clear work item"} /></label>
                <label>Event<select value={form.event_id} onChange={(event) => setForm({ ...form, event_id: event.target.value, assignee_user_id: "", confirm_class_conflict: false })}><option value="">Council-wide / not linked</option>{data.events.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}</select></label>
                <label>Assigned to<select value={form.assignee_user_id} onChange={(event) => setForm({ ...form, assignee_user_id: event.target.value, confirm_class_conflict: false })}><option value="">Unassigned</option>{assignableUsers.map((user) => {
                    const availability = eventAvailability.find((item) => Number(item.user_id) === Number(user.id));
                    const responseStatus = availability?.response_status || "pending";
                    const responseLabel = responseStatus[0].toUpperCase() + responseStatus.slice(1);
                    const blocked = responseStatus !== "accepted" && Number(user.id) !== Number(form.assignee_user_id);
                    return <option key={user.id} value={user.id} disabled={blocked}>{user.first_name} {user.last_name} · {responseLabel}{responseStatus === "accepted" && availability?.class_conflict ? " · Class conflict" : ""}</option>;
                })}</select></label>
                {form.event_id && form.assignee_user_id && <div className={`committee-class-conflict-note${selectedAvailability?.class_conflict ? " is-conflict" : ""}`} role="status">
                    {selectedAvailability?.response_status !== "accepted"
                        ? `This member’s response is ${selectedAvailability?.response_status || "pending"}; only accepted members can be assigned event work.`
                        : selectedAvailability?.class_conflict
                            ? <><span>Class schedule conflict: this member has a class during the event. Confirm their availability before assigning this work.</span><label><input type="checkbox" checked={Boolean(form.confirm_class_conflict)} onChange={(change) => setForm({ ...form, confirm_class_conflict: change.target.checked })} /> I confirmed this assignment with the member.</label></>
                            : selectedAvailability?.has_schedule
                                ? "No class overlap appears during the event. Confirm availability with the member before assigning."
                                : "No class schedule is saved for this term. Confirm availability with the member before assigning."}
                </div>}
                <label>Deadline<input type="datetime-local" value={form.due_at} onChange={(event) => setForm({ ...form, due_at: event.target.value })} /></label>
                <label>Priority<select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}>{["low", "normal", "high", "urgent"].map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</select></label>
                <label>Status<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>{statuses.map((status) => <option key={status}>{status}</option>)}</select></label>
                <label>Preview / attachment URL<input type="url" value={form.attachment_url} onChange={(event) => setForm({ ...form, attachment_url: event.target.value })} placeholder="https://…" /></label>
                {committee === "program" && <><label>Run-of-show start time<input type="time" value={form.time_slot} onChange={(event) => setForm({ ...form, time_slot: event.target.value })} /></label><label>Duration in minutes<input type="number" min="1" max="1440" value={form.duration_minutes} onChange={(event) => setForm({ ...form, duration_minutes: event.target.value })} placeholder="15" /></label></>}
                <label className="committee-work-details">Brief, instructions, or issue details<textarea rows="3" maxLength="4000" value={form.details} onChange={(event) => setForm({ ...form, details: event.target.value })} /></label>
                {committee === "production" && <label className="committee-work-details">Equipment / preparation checklist<textarea rows="4" value={form.checklist_text} onChange={(event) => setForm({ ...form, checklist_text: event.target.value })} placeholder="One equipment or preparation item per line" /></label>}
                <div className="committee-work-actions"><button className="admin-primary-action" disabled={busy}>{busy ? "Saving…" : form.id ? "Save changes" : "Add work item"}</button>{form.id && <button type="button" className="admin-secondary-action" onClick={() => setForm(emptyForm)}>Cancel edit</button>}</div>
            </form>
        </section>

        {error && <p className="admin-feedback is-error" role="alert">{error}</p>}{notice && <p className="admin-feedback" role="status">{notice}</p>}
        <section className="committee-items-section">
            <div className="admin-section-heading committee-list-heading"><div><span>SHARED WORK ITEMS</span><h2>Team workflow</h2></div><div className="committee-view-controls"><input type="search" aria-label="Search workspace items" placeholder="Search work…" value={query} onChange={(event) => setQuery(event.target.value)} /><button type="button" className={view === "board" ? "is-selected" : ""} onClick={() => setView("board")}>Board</button><button type="button" className={view === "list" ? "is-selected" : ""} onClick={() => setView("list")}>List</button></div></div>
            {view === "board" ? <div className="committee-board">{(columns.length ? columns : ["No items yet"]).map((status) => <div className="committee-board-column" key={status}><h3>{status}<span>{items.filter((item) => item.status === status).length}</span></h3>{items.filter((item) => item.status === status).map((item) => <article className="committee-work-item" key={item.id}><div className="committee-item-topline"><span className={`committee-priority is-${item.priority}`}>{item.priority}</span><button type="button" onClick={() => edit(item)} aria-label={`Edit ${item.title}`}>Edit</button></div><h4>{item.title}</h4><p>{item.details || item.event_title}</p>{item.attachment_url && <a className="committee-preview-link" href={item.attachment_url} target="_blank" rel="noreferrer">{/\.(png|jpe?g|webp|gif)(\?|$)/i.test(item.attachment_url) ? <img src={item.attachment_url} alt={`Preview for ${item.title}`} /> : "Open attached file ↗"}</a>}{item.checklist?.length > 0 && <div className="committee-checklist">{item.checklist.map((entry) => <label key={entry.label}><input type="checkbox" checked={entry.done} onChange={() => toggleChecklist(item, entry)} />{entry.label}</label>)}</div>}<div className="committee-item-meta"><span>{item.assignee_name}</span><span>{committee === "program" && item.time_slot ? `${item.time_slot}${item.duration_minutes ? ` · ${item.duration_minutes} min` : ""} · ` : ""}{dateLabel(item.due_at)}</span></div>{item.activity?.length > 0 && <details className="committee-activity-history"><summary>Revision / status history ({item.activity.length})</summary>{item.activity.slice(-5).reverse().map((entry, index) => <span key={`${entry.at}-${index}`}>{entry.status} · {dateLabel(entry.at)}</span>)}</details>}<div className="committee-item-actions"><button type="button" onClick={() => edit(item)}>Update</button><button type="button" onClick={() => remove(item.id)}>Delete</button></div></article>)}</div>)}</div> : <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>{committee === "program" ? "Time / segment" : "Work item"}</th><th>Event</th><th>Assignee</th><th>Deadline</th><th>Status</th><th>Actions</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong>{committee === "program" && item.time_slot ? `${item.time_slot} · ` : ""}{item.title}</strong><small>{item.kind} · {item.priority}{item.duration_minutes ? ` · ${item.duration_minutes} min` : ""}</small></td><td>{item.event_title}</td><td>{item.assignee_name}</td><td>{dateLabel(item.due_at)}</td><td>{item.status}</td><td><button type="button" onClick={() => edit(item)}>Edit</button> <button type="button" onClick={() => remove(item.id)}>Delete</button></td></tr>)}</tbody></table>{!items.length && <p className="admin-feedback">No workspace records match your search.</p>}</div>}
        </section>
    </main></>;
}
