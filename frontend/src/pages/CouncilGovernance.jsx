import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import QRCode from "react-qr-code";

import AdminNav from "../components/AdminNav";
import Navbar from "../components/Navbar";
import { SkeletonBlock } from "../components/LoadingSkeletons";
import { CameraScanner } from "../components/QRScanner";
import {
    checkInCouncilMember,
    getCouncilAttendancePass,
    getCouncilGovernance,
    reviewCouncilExcuse,
    reviewCouncilMinutes,
    reviewCouncilReport,
    saveCouncilInventoryItem,
    saveCouncilReport,
    saveCouncilMeeting,
    saveCouncilMinutes,
    submitCouncilExcuse
} from "../services/api";

const positionNames = {
    governor: "Governor", vice_governor: "Vice Governor", secretary: "Secretary",
    treasurer: "Treasurer", auditor: "Auditor", social_media_manager: "Social Media Manager",
    department_representative: "Department Representative", advisor: "Advisor", co_advisor: "Co-Advisor"
};
const managerPositions = ["governor", "vice_governor", "secretary"];
const excuseOptions = [
    ["competition", "Documented competition"],
    ["recognized_organization", "Approved school organization activity"],
    ["internship", "OJT or internship requirement"],
    ["medical_emergency", "Medical reason or emergency"]
];

function academicPeriodNow() {
    const now = new Date();
    return now.getMonth() >= 6 ? `${now.getFullYear()}-1` : `${now.getFullYear() - 1}-2`;
}

function dateTime(value) {
    if (!value) return "Not scheduled";
    const parsed = new Date(value.replace(" ", "T"));
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
}

function localInputDate(value) {
    return value ? value.replace(" ", "T").slice(0, 16) : "";
}

function emptyMeeting(period) {
    return { id: "", title: "", meeting_type: "regular", location: "", start_at: "", end_at: "", academic_period: period, mandatory: true, agenda: "", waive_quorum: false, quorum_waiver_rationale: "", status: "scheduled" };
}

export default function CouncilGovernance() {
    const [period, setPeriod] = useState(academicPeriodNow);
    const [data, setData] = useState({ meetings: [], members: [], attendance_stats: [], excuses: [], reports: [], inventory: [], summary: {} });
    const [selectedId, setSelectedId] = useState("");
    const [tab, setTab] = useState("meetings");
    const [meetingForm, setMeetingForm] = useState(() => emptyMeeting(academicPeriodNow()));
    const [minutes, setMinutes] = useState("");
    const [decisions, setDecisions] = useState("");
    const [advisorNote, setAdvisorNote] = useState("");
    const [reportForm, setReportForm] = useState({ id: "", committee: "executive", academic_period: academicPeriodNow(), title: "", activities: "", accomplishments: "", recommendations: "" });
    const [reportNote, setReportNote] = useState("");
    const [inventoryForm, setInventoryForm] = useState({ id: "", item_name: "", asset_tag: "", category: "Equipment", quantity: "1", condition: "serviceable", location: "", notes: "" });
    const [excuseCategory, setExcuseCategory] = useState("competition");
    const [excuseDetails, setExcuseDetails] = useState("");
    const [evidenceUrl, setEvidenceUrl] = useState("");
    const [pass, setPass] = useState(null);
    const [scanResult, setScanResult] = useState(null);
    const [manualPass, setManualPass] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [clockNow, setClockNow] = useState(Date.now());
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");

    const load = useCallback(async () => {
        const result = await getCouncilGovernance(period);
        setData(result);
        setSelectedId((prior) => result.meetings.some((meeting) => String(meeting.id) === String(prior))
            ? prior
            : String(result.meetings.find((meeting) => meeting.status === "scheduled")?.id || result.meetings[0]?.id || ""));
        return result;
    }, [period]);

    useEffect(() => {
        let active = true;
        setLoading(true);
        setError("");
        getCouncilGovernance(period)
            .then((result) => {
                if (!active) return;
                setData(result);
                setSelectedId(String(result.meetings.find((meeting) => meeting.status === "scheduled")?.id || result.meetings[0]?.id || ""));
            })
            .catch((requestError) => { if (active) setError(requestError.message || "Council workspace could not be loaded."); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [period]);

    const member = data.current_user || {};
    const isAdmin = member.role === "admin";
    const isCouncilMember = Boolean(member.council_position);
    const canManage = isAdmin || managerPositions.includes(member.council_position);
    const canReview = ["advisor", "co_advisor"].includes(member.council_position);
    const canReviewReports = member.council_position === "governor";
    const canManageInventory = isAdmin || ["governor", "auditor"].includes(member.council_position);
    const canReviewExcuses = isAdmin || ["governor", "vice_governor", "advisor", "co_advisor"].includes(member.council_position);
    const canScan = isAdmin || managerPositions.includes(member.council_position);
    const canReceivePass = ["governor", "vice_governor", "secretary", "treasurer", "auditor", "social_media_manager", "department_representative"].includes(member.council_position);
    const selected = data.meetings.find((meeting) => String(meeting.id) === String(selectedId));
    const myAttendance = selected?.attendance?.some((record) => record.user_id === member.id);
    const myExcuse = selected && data.excuses.find((excuse) => excuse.meeting_id === selected.id && excuse.user_id === member.id);
    const pendingExcuses = useMemo(() => data.excuses.filter((excuse) => excuse.status === "pending"), [data.excuses]);
    const attendanceWindowOpen = selected && new Date(selected.attendance_opens_at).getTime() <= clockNow && new Date(selected.attendance_closes_at).getTime() >= clockNow;

    useEffect(() => {
        const interval = window.setInterval(() => setClockNow(Date.now()), 15000);
        return () => window.clearInterval(interval);
    }, []);

    useEffect(() => {
        setPass(null);
        setScanResult(null);
        if (selected) {
            setMinutes(selected.minutes || "");
            setDecisions(selected.decisions || "");
            setAdvisorNote(selected.advisor_note || "");
        } else {
            setMinutes(""); setDecisions(""); setAdvisorNote("");
        }
    }, [selectedId, selected?.minutes, selected?.decisions, selected?.advisor_note]);

    useEffect(() => {
        if (selected && clockNow > new Date(selected.attendance_closes_at).getTime()) setPass(null);
    }, [selected, clockNow]);

    async function withFeedback(action, successMessage) {
        setSaving(true); setError(""); setNotice("");
        try {
            await action();
            if (successMessage) setNotice(successMessage);
            await load();
        } catch (requestError) { setError(requestError.message || "The council update could not be saved."); }
        finally { setSaving(false); }
    }

    async function submitMeeting(event) {
        event.preventDefault();
        await withFeedback(async () => {
            const result = await saveCouncilMeeting(meetingForm);
            setSelectedId(String(result.meeting_id));
            setMeetingForm(emptyMeeting(period));
        }, meetingForm.status === "cancelled" ? "Meeting cancelled." : "Meeting saved.");
    }

    async function submitReport(event) {
        event.preventDefault();
        await withFeedback(async () => {
            await saveCouncilReport({ ...reportForm, academic_period: period });
            setReportForm({ id: "", committee: "executive", academic_period: period, title: "", activities: "", accomplishments: "", recommendations: "" });
        }, "Committee report submitted to the Governor.");
    }

    async function submitInventoryItem(event) {
        event.preventDefault();
        await withFeedback(async () => {
            await saveCouncilInventoryItem(inventoryForm);
            setInventoryForm({ id: "", item_name: "", asset_tag: "", category: "Equipment", quantity: "1", condition: "serviceable", location: "", notes: "" });
        }, inventoryForm.id ? "Inventory record updated." : "Inventory item added.");
    }

    function editReport(report) {
        setReportForm({ id: report.id, committee: report.committee, academic_period: report.academic_period, title: report.title, activities: report.activities, accomplishments: report.accomplishments, recommendations: report.recommendations });
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    function editInventoryItem(item) {
        setInventoryForm({ id: item.id, item_name: item.item_name, asset_tag: item.asset_tag || "", category: item.category, quantity: String(item.quantity), condition: item.condition, location: item.location, notes: item.notes || "" });
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    function editMeeting(meeting) {
        setMeetingForm({ ...emptyMeeting(period), ...meeting, start_at: localInputDate(meeting.start_at), end_at: localInputDate(meeting.end_at), waive_quorum: Boolean(meeting.quorum_waiver_rationale), quorum_waiver_rationale: meeting.quorum_waiver_rationale || "" });
        setSelectedId(String(meeting.id));
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    async function submitPass() {
        if (!selected) return;
        setError(""); setNotice(""); setPass(null);
        try {
            const result = await getCouncilAttendancePass(selected.id);
            setPass(result.pass);
        } catch (requestError) { setError(requestError.message); }
    }

    async function scan(qrValue) {
        setError(""); setNotice(""); setScanResult({ pending: true, title: "Verifying pass" });
        try {
            const result = await checkInCouncilMember(qrValue, selected?.id);
            const kind = result.success ? "success" : result.already_checked_in ? "duplicate" : "invalid";
            setScanResult({ kind, title: result.success ? "Attendance recorded" : result.already_checked_in ? "Already checked in" : "Pass not accepted", message: result.message, member: result.member, meeting: result.meeting });
            if (result.success) { setNotice(result.message); await load(); }
        } catch (requestError) {
            setScanResult({ kind: requestError.code === "WRONG_MEETING" ? "wrong-meeting" : "invalid", title: requestError.code === "WRONG_MEETING" ? "Wrong meeting" : "Pass not accepted", message: requestError.message });
        }
    }

    async function submitManualPass(event) {
        event.preventDefault();
        await scan(manualPass.trim());
        setManualPass("");
    }

    const shell = isAdmin ? <AdminNav /> : <Navbar />;
    if (loading) return <>{shell}<main className="admin-page council-governance-page ui-governance-loading" aria-busy="true" aria-hidden="true"><header className="admin-header admin-page-heading"><div><SkeletonBlock className="workspace-skeleton-eyebrow" /><SkeletonBlock className="workspace-skeleton-title" /><SkeletonBlock className="workspace-skeleton-description" /></div></header><section className="council-governance-metrics">{Array.from({ length: 4 }, (_, index) => <article key={index}><SkeletonBlock className="workspace-skeleton-label" /><SkeletonBlock className="workspace-skeleton-number" /><SkeletonBlock className="workspace-skeleton-description" /></article>)}</section><div className="workspace-skeleton-panels"><section><SkeletonBlock className="workspace-skeleton-title is-small" />{Array.from({ length: 3 }, (_, index) => <div className="workspace-skeleton-item" key={index}><SkeletonBlock className="workspace-skeleton-label" /><SkeletonBlock className="workspace-skeleton-description" /></div>)}</section><section><SkeletonBlock className="workspace-skeleton-title is-small" /><SkeletonBlock className="workspace-skeleton-description" /><SkeletonBlock className="workspace-skeleton-description" /><SkeletonBlock className="workspace-skeleton-description is-short" /><SkeletonBlock className="workspace-skeleton-description" /></section></div></main><span className="sr-only" role="status">Loading council governance…</span></>;
    if (error && !data.current_user) return <>{shell}<main className="admin-page"><p className="admin-feedback is-error" role="alert">{error}</p><Link to="/profile">Back to profile</Link></main></>;

    return <>
        {shell}
        <main className="admin-page council-governance-page">
            <header className="admin-header admin-page-heading">
                <div><span>CONSTITUTIONAL OPERATIONS</span><h1>Council governance</h1><p>Meetings, official records, council attendance, and member accountability.</p><small>{positionNames[member.council_position] || "Council administrator"}{member.council_department ? ` · ${member.council_department}` : ""}</small></div>
            </header>

            <section className="council-governance-metrics" aria-label="Council governance summary">
                <article><span>VOTING MEMBERS</span><strong>{data.summary.voting_members || 0}</strong><small>Current council roster</small></article>
                <article><span>MEETINGS THIS SEMESTER</span><strong>{data.summary.meeting_count || 0}</strong><small>{data.summary.completed_mandatory_count || 0} mandatory completed</small></article>
                <article><span>80% ATTENDANCE STANDARD</span><strong>{data.summary.good_standing_count || 0}/{data.summary.voting_members || 0}</strong><small>Members currently in good standing</small></article>
                <label className="council-period-filter"><span>ACADEMIC PERIOD</span><input aria-label="Academic year and semester" value={period} onChange={(event) => setPeriod(event.target.value)} placeholder="2026-1" /><small>Format: year-semester, e.g. 2026-1</small></label>
            </section>

            <nav className="council-governance-tabs" aria-label="Council governance sections">
                <button className={tab === "meetings" ? "is-active" : ""} onClick={() => setTab("meetings")}>Meetings & records</button>
                <button className={tab === "attendance" ? "is-active" : ""} onClick={() => setTab("attendance")}>Attendance standing</button>
                <button className={tab === "reports" ? "is-active" : ""} onClick={() => setTab("reports")}>Committee reports</button>
                <button className={tab === "inventory" ? "is-active" : ""} onClick={() => setTab("inventory")}>Property inventory</button>
            </nav>

            {error && <p className="admin-feedback is-error" role="alert">{error}</p>}
            {notice && <p className="admin-feedback" role="status">{notice}</p>}

            {tab === "meetings" ? <>
                {canManage && <section className="admin-form-card council-meeting-editor">
                    <div className="admin-section-heading"><div><span>SECRETARIAT & GOVERNOR</span><h2>{meetingForm.id ? "Update meeting" : "Schedule a meeting or activity"}</h2></div></div>
                    <form className="committee-work-form" onSubmit={submitMeeting}>
                        <label>Meeting title<input required maxLength="180" value={meetingForm.title} onChange={(event) => setMeetingForm({ ...meetingForm, title: event.target.value })} placeholder="Weekly council meeting" /></label>
                        <label>Meeting type<select value={meetingForm.meeting_type} onChange={(event) => setMeetingForm({ ...meetingForm, meeting_type: event.target.value, waive_quorum: false, quorum_waiver_rationale: "" })}><option value="regular">Regular meeting</option><option value="special">Special meeting</option><option value="mandatory_activity">Mandatory activity</option></select></label>
                        <label>Location<input required maxLength="180" value={meetingForm.location} onChange={(event) => setMeetingForm({ ...meetingForm, location: event.target.value })} placeholder="Council room / online" /></label>
                        <label>Academic period<input required pattern="20[0-9]{2}-[12]" value={meetingForm.academic_period} onChange={(event) => setMeetingForm({ ...meetingForm, academic_period: event.target.value })} placeholder="2026-1" /></label>
                        <label>Starts<input required type="datetime-local" value={meetingForm.start_at} onChange={(event) => setMeetingForm({ ...meetingForm, start_at: event.target.value })} /></label>
                        <label>Ends<input required type="datetime-local" value={meetingForm.end_at} onChange={(event) => setMeetingForm({ ...meetingForm, end_at: event.target.value })} /></label>
                        <label className="council-mandatory-toggle"><input type="checkbox" checked={meetingForm.mandatory} onChange={(event) => setMeetingForm({ ...meetingForm, mandatory: event.target.checked })} /> Counts toward mandatory attendance</label>
                        <label className="committee-work-details">Agenda / notice<textarea rows="3" maxLength="5000" value={meetingForm.agenda} onChange={(event) => setMeetingForm({ ...meetingForm, agenda: event.target.value })} placeholder="Topics and official notice for members" /></label>
                        {meetingForm.meeting_type === "special" && member.council_position === "governor" && <><label className="council-mandatory-toggle"><input type="checkbox" checked={meetingForm.waive_quorum} onChange={(event) => setMeetingForm({ ...meetingForm, waive_quorum: event.target.checked, quorum_waiver_rationale: event.target.checked ? meetingForm.quorum_waiver_rationale : "" })} /> Urgent special meeting: Governor waives quorum</label>{meetingForm.waive_quorum && <label className="committee-work-details">Documented reason for waiver<textarea required minLength="20" rows="2" maxLength="1000" value={meetingForm.quorum_waiver_rationale} onChange={(event) => setMeetingForm({ ...meetingForm, quorum_waiver_rationale: event.target.value })} /></label>}</>}
                        <div className="committee-work-actions"><button className="admin-primary-action" disabled={saving}>{saving ? "Saving…" : meetingForm.id ? "Save meeting" : "Schedule meeting"}</button>{meetingForm.id && <button type="button" className="admin-secondary-action" onClick={() => setMeetingForm(emptyMeeting(period))}>New meeting</button>}</div>
                    </form>
                    <small className="council-rule-note">Attendance opens one hour before the start. Check-in closes 15 minutes after it starts, consistent with the constitution’s tardiness rule.</small>
                </section>}

                <section className="council-meeting-layout">
                    <div className="council-meeting-list">
                        <div className="admin-section-heading"><div><span>OFFICIAL CALENDAR</span><h2>Meetings & activities</h2></div><span>{data.meetings.length} records</span></div>
                        {data.meetings.length ? data.meetings.map((meeting) => <button type="button" key={meeting.id} onClick={() => setSelectedId(String(meeting.id))} className={`council-meeting-option${String(meeting.id) === String(selectedId) ? " is-active" : ""}`}><span>{meeting.meeting_type.replaceAll("_", " ")} · {meeting.mandatory ? "Mandatory" : "Optional"}</span><strong>{meeting.title}</strong><small>{dateTime(meeting.start_at)} · {meeting.location}</small><small>{meeting.quorum.present}/{meeting.quorum.total} voting members · {meeting.minutes_status.replaceAll("_", " ")}</small></button>) : <p className="admin-feedback">No meetings are scheduled for this academic period.</p>}
                    </div>

                    {selected ? <section className="council-meeting-detail">
                        <div className="admin-section-heading"><div><span>{selected.meeting_type.replaceAll("_", " ").toUpperCase()} · {selected.mandatory ? "MANDATORY" : "OPTIONAL"}</span><h2>{selected.title}</h2><p>{dateTime(selected.start_at)} – {dateTime(selected.end_at)} · {selected.location}</p></div>{canManage && <button type="button" className="admin-secondary-action" onClick={() => editMeeting(selected)}>Edit</button>}</div>
                        <div className={`council-quorum-status${selected.quorum.reached || selected.quorum.waived ? " is-met" : ""}`}><strong>{selected.quorum.waived ? "Quorum waived for urgent special meeting" : selected.quorum.reached ? "Quorum reached" : "Quorum not reached"}</strong><span>{selected.quorum.present} present of {selected.quorum.total} voting members · {selected.quorum.required} required (two-thirds)</span>{selected.quorum.waived && <small>{selected.quorum_waiver_rationale}</small>}</div>
                        <div className="council-agenda"><h3>Agenda & notice</h3><p>{selected.agenda || "No agenda was added."}</p></div>

                        {canReceivePass && selected.mandatory && selected.status !== "cancelled" && <section className="council-qr-pass"><div><span>MEMBER ATTENDANCE PASS</span><h3>Your private meeting QR</h3><p>Show this pass to the authorized check-in officer. It expires after the 15-minute arrival window.</p></div>{pass ? <div className="council-qr-code"><QRCode value={pass} size={190} level="M" /><code>AUSSC meeting pass</code></div> : <button className="admin-primary-action" type="button" onClick={submitPass} disabled={!attendanceWindowOpen || Boolean(myAttendance)}>{myAttendance ? "Attendance already recorded" : attendanceWindowOpen ? "Show my QR pass" : "Available during check-in"}</button>}</section>}

                        {canScan && selected.mandatory && selected.status !== "cancelled" && <section className="council-qr-scanner"><div className="admin-section-heading"><div><span>AUTHORIZED CHECK-IN</span><h3>Scan council member pass</h3></div></div><CameraScanner onDecoded={scan} disabled={!attendanceWindowOpen} title="Verify council attendance" label="Council meeting QR scanner" /><form onSubmit={submitManualPass} className="council-manual-qr"><label>Manual QR pass fallback<input value={manualPass} onChange={(event) => setManualPass(event.target.value)} placeholder="Paste AUSSC-MEETING pass value" /></label><button type="submit" className="admin-secondary-action" disabled={!manualPass.trim()}>Verify pass</button></form>{scanResult && <div className={`council-scan-result is-${scanResult.kind || "pending"}`} role="status"><strong>{scanResult.title}</strong><span>{scanResult.member?.name || ""}{scanResult.member?.position ? ` · ${positionNames[scanResult.member.position]}` : ""}</span><p>{scanResult.message}</p></div>}</section>}

                        <section className="council-attendance-roster"><div className="admin-section-heading"><div><span>MEETING RECORD</span><h3>Attendance</h3></div><strong>{selected.attendance.length} present</strong></div>{selected.attendance.length ? <ul>{selected.attendance.map((record) => <li key={record.user_id}><strong>{record.member?.name || "Council member"}</strong><span>{positionNames[record.member?.position] || "Officer"} · {dateTime(record.checked_in_at)}</span></li>)}</ul> : <p>No one has checked in yet.</p>}</section>

                        {canReceivePass && selected.mandatory && !myAttendance && !myExcuse && <form className="council-excuse-form" onSubmit={(event) => { event.preventDefault(); withFeedback(async () => { await submitCouncilExcuse(selected.id, excuseCategory, excuseDetails, evidenceUrl); setExcuseDetails(""); setEvidenceUrl(""); }, "Absence notice submitted for review."); }}><h3>Notify the council about an absence</h3><p>Submit documented exceptions for review. Approved exceptions are excluded from the semester attendance denominator. School-organization activities need advance approval from both the Governor and Advisor.</p><label>Exception category<select value={excuseCategory} onChange={(event) => setExcuseCategory(event.target.value)}>{excuseOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Reason and supporting context<textarea required minLength="10" maxLength="1000" rows="3" value={excuseDetails} onChange={(event) => setExcuseDetails(event.target.value)} /></label>{["competition", "recognized_organization"].includes(excuseCategory) && <label>Supporting document HTTPS link<input type="url" required value={evidenceUrl} onChange={(event) => setEvidenceUrl(event.target.value)} placeholder="https://…" /></label>}<button className="admin-secondary-action" disabled={saving}>Submit absence notice</button></form>}
                        {myExcuse && <p className={`admin-feedback${myExcuse.status === "rejected" ? " is-error" : ""}`} role="status">Your absence notice is {myExcuse.status}.</p>}

                        {selected.minutes && <section className="council-minutes-readonly"><div className="admin-section-heading"><div><span>OFFICIAL RECORD</span><h3>Meeting minutes</h3></div><span className={`council-minutes-status is-${selected.minutes_status}`}>{selected.minutes_status.replaceAll("_", " ")}</span></div><p>{selected.minutes}</p>{selected.decisions && <><h4>Decisions & resolutions</h4><p>{selected.decisions}</p></>}{selected.advisor_note && <small>Advisor review: {selected.advisor_note}</small>}</section>}

                        {canManage && <form className="council-minutes-form" onSubmit={(event) => { event.preventDefault(); withFeedback(() => saveCouncilMinutes(selected.id, minutes, decisions), "Minutes submitted to the Advisor for review."); }}><div className="admin-section-heading"><div><span>SECRETARY’S RECORD</span><h3>{selected.minutes ? "Update meeting minutes" : "Record meeting minutes"}</h3></div></div><label>Proceedings & attendance notes<textarea rows="6" maxLength="20000" value={minutes} onChange={(event) => setMinutes(event.target.value)} placeholder="Record the meeting proceedings, attendance context, and reports." required /></label><label>Decisions, resolutions, and action items<textarea rows="4" maxLength="10000" value={decisions} onChange={(event) => setDecisions(event.target.value)} placeholder="Decisions are accepted only when quorum is reached or a valid urgent special-meeting waiver is recorded." /></label><button className="admin-primary-action" disabled={saving || !minutes.trim()}>Submit minutes for Advisor review</button></form>}

                        {canReview && selected.minutes_status === "pending_advisor" && <form className="council-minutes-review" onSubmit={(event) => { event.preventDefault(); withFeedback(() => reviewCouncilMinutes(selected.id, "approve", advisorNote), "Official minutes approved."); }}><h3>Advisor review</h3><label>Review note<textarea rows="2" maxLength="2000" value={advisorNote} onChange={(event) => setAdvisorNote(event.target.value)} /></label><div><button className="admin-primary-action" disabled={saving}>Approve official record</button><button type="button" className="admin-secondary-action" disabled={saving} onClick={() => withFeedback(() => reviewCouncilMinutes(selected.id, "revisions", advisorNote), "Revisions requested.")}>Request revisions</button></div></form>}
                    </section> : <p className="admin-feedback">Choose a meeting to view its record and QR attendance tools.</p>}
                </section>

                {canReviewExcuses && pendingExcuses.length > 0 && <section className="council-excuse-queue"><div className="admin-section-heading"><div><span>REVIEW QUEUE</span><h2>Absence notices</h2></div><span>{pendingExcuses.length} pending</span></div>{pendingExcuses.map((excuse) => { const specialReview = excuse.category === "recognized_organization"; const reviewerType = ["advisor", "co_advisor"].includes(member.council_position) ? "advisor" : member.council_position; const alreadyApproved = specialReview && Boolean(excuse.approvals?.[reviewerType]); const canReviewThisExcuse = specialReview ? ["governor", "advisor", "co_advisor"].includes(member.council_position) : canReviewExcuses; return <article key={excuse.id}><div><strong>{excuse.member?.name || "Council member"} · {excuse.meeting_title}</strong><span>{excuseOptions.find(([value]) => value === excuse.category)?.[1] || excuse.category}</span><p>{excuse.details}</p>{excuse.evidence_url && <a href={excuse.evidence_url} target="_blank" rel="noreferrer">Review supporting document ↗</a>}{specialReview && <small>{excuse.approvals?.governor ? "Governor approved" : "Governor review needed"} · {excuse.approvals?.advisor ? "Advisor approved" : "Advisor review needed"}</small>}</div>{canReviewThisExcuse && <div><button type="button" disabled={alreadyApproved || saving} onClick={() => withFeedback(() => reviewCouncilExcuse(excuse.id, "approved"), "Exception review saved.")}>{alreadyApproved ? "Approval recorded" : "Approve exception"}</button><button type="button" disabled={saving} onClick={() => withFeedback(() => reviewCouncilExcuse(excuse.id, "rejected"), "Exception declined.")}>Decline</button></div>}</article>; })}</section>}
            </> : tab === "attendance" ? <section className="council-standing-section">
                <div className="admin-section-heading"><div><span>ARTICLE VII · MEETINGS & QUORUMS</span><h2>Semester attendance standing</h2><p>Approved constitutional exceptions are excluded. Tardy check-ins after 15 minutes are not recorded.</p></div></div>
                <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Council member</th><th>Position</th><th>Present</th><th>Eligible mandatory activities</th><th>Standing</th></tr></thead><tbody>{data.attendance_stats.map((record) => <tr key={record.user_id}><td><strong>{record.name}</strong></td><td>{positionNames[record.position]}{record.department ? ` · ${record.department}` : ""}</td><td>{record.attended}</td><td>{record.eligible}</td><td><span className={`council-standing-badge${record.good_standing ? " is-good" : " is-low"}`}>{record.percentage === null ? "No meetings recorded" : `${record.percentage}% · ${record.good_standing ? "Good standing" : "Below 80%"}`}</span></td></tr>)}</tbody></table>{!data.attendance_stats.length && <p className="admin-feedback">No voting positions have been assigned to council accounts yet.</p>}</div>
                <p className="council-rule-note">The 80% threshold is a monitoring aid only. It does not automatically suspend or discipline a member; all action remains subject to the constitution’s due-process requirements.</p>
            </section> : tab === "reports" ? <section className="council-reports-section">
                <div className="admin-section-heading"><div><span>ARTICLE VIII · COMMITTEE REPORTS</span><h2>Activities, accomplishments & recommendations</h2><p>Standing committees submit regular reports for council-wide review and continuity.</p></div></div>
                {isCouncilMember && <form className="council-report-form" onSubmit={submitReport}>
                    <h3>{reportForm.id ? "Update returned report" : "Submit a committee report"}</h3>
                    <label>Committee<select value={reportForm.committee} onChange={(event) => setReportForm({ ...reportForm, committee: event.target.value })}><option value="executive">Executive Committee</option><option value="publication">Publications Committee</option><option value="program">Program Committee</option><option value="production">Production Committee</option></select></label>
                    <label>Report title<input required maxLength="180" value={reportForm.title} onChange={(event) => setReportForm({ ...reportForm, title: event.target.value })} placeholder="September activity report" /></label>
                    <label>Activities and work completed<textarea required minLength="10" maxLength="5000" rows="4" value={reportForm.activities} onChange={(event) => setReportForm({ ...reportForm, activities: event.target.value })} /></label>
                    <label>Accomplishments<textarea maxLength="5000" rows="3" value={reportForm.accomplishments} onChange={(event) => setReportForm({ ...reportForm, accomplishments: event.target.value })} /></label>
                    <label>Recommendations and issues<textarea maxLength="5000" rows="3" value={reportForm.recommendations} onChange={(event) => setReportForm({ ...reportForm, recommendations: event.target.value })} /></label>
                    <button className="admin-primary-action" disabled={saving}>{saving ? "Submitting…" : reportForm.id ? "Resubmit report" : "Submit report"}</button>
                </form>}
                <div className="council-report-list">{data.reports?.length ? data.reports.map((report) => <article key={report.id}>
                    <header><div><span>{report.committee.replaceAll("_", " ")} · {report.academic_period}</span><h3>{report.title}</h3><small>Submitted by {report.author_name} · {dateTime(report.submitted_at)}</small></div><span className={`council-minutes-status is-${report.status}`}>{report.status.replaceAll("_", " ")}</span></header>
                    <h4>Activities</h4><p>{report.activities}</p>{report.accomplishments && <><h4>Accomplishments</h4><p>{report.accomplishments}</p></>}{report.recommendations && <><h4>Recommendations & issues</h4><p>{report.recommendations}</p></>}{report.review_note && <small>Governor review: {report.review_note}</small>}
                    {member.id === report.submitted_by && ["submitted", "revisions_requested"].includes(report.status) && <button type="button" className="admin-secondary-action" onClick={() => editReport(report)}>Edit / resubmit</button>}
                    {canReviewReports && report.status === "submitted" && <div className="council-report-review"><label>Governor review note<input value={reportNote} onChange={(event) => setReportNote(event.target.value)} placeholder="Optional feedback" /></label><button type="button" className="admin-primary-action" disabled={saving} onClick={() => withFeedback(() => reviewCouncilReport(report.id, "acknowledge", reportNote), "Committee report acknowledged.")}>Acknowledge</button><button type="button" className="admin-secondary-action" disabled={saving} onClick={() => withFeedback(() => reviewCouncilReport(report.id, "revisions", reportNote), "Revisions requested.")}>Request revisions</button></div>}
                </article>) : <p className="admin-feedback">No committee reports have been submitted for this academic period.</p>}</div>
            </section> : <section className="council-inventory-section">
                <div className="admin-section-heading"><div><span>ARTICLE IV · AUDITOR</span><h2>Council property inventory</h2><p>Maintain the council property register and preserve a history of inventory updates.</p></div><strong>{data.inventory?.length || 0} items</strong></div>
                {canManageInventory && <form className="council-inventory-form" onSubmit={submitInventoryItem}>
                    <h3>{inventoryForm.id ? "Update property record" : "Add council property"}</h3>
                    <label>Item name<input required maxLength="180" value={inventoryForm.item_name} onChange={(event) => setInventoryForm({ ...inventoryForm, item_name: event.target.value })} placeholder="Portable speaker" /></label>
                    <label>Asset tag / serial number<input maxLength="80" value={inventoryForm.asset_tag} onChange={(event) => setInventoryForm({ ...inventoryForm, asset_tag: event.target.value })} /></label>
                    <label>Category<input required maxLength="100" value={inventoryForm.category} onChange={(event) => setInventoryForm({ ...inventoryForm, category: event.target.value })} placeholder="Audio equipment" /></label>
                    <label>Quantity<input required type="number" min="1" max="100000" value={inventoryForm.quantity} onChange={(event) => setInventoryForm({ ...inventoryForm, quantity: event.target.value })} /></label>
                    <label>Condition<select value={inventoryForm.condition} onChange={(event) => setInventoryForm({ ...inventoryForm, condition: event.target.value })}><option value="serviceable">Serviceable</option><option value="needs_repair">Needs repair</option><option value="unserviceable">Unserviceable</option><option value="retired">Retired</option></select></label>
                    <label>Storage / assigned location<input required maxLength="180" value={inventoryForm.location} onChange={(event) => setInventoryForm({ ...inventoryForm, location: event.target.value })} /></label>
                    <label className="council-inventory-notes">Notes<textarea rows="2" maxLength="2000" value={inventoryForm.notes} onChange={(event) => setInventoryForm({ ...inventoryForm, notes: event.target.value })} /></label>
                    <div className="council-work-actions"><button className="admin-primary-action" disabled={saving}>{saving ? "Saving…" : inventoryForm.id ? "Save record" : "Add inventory item"}</button>{inventoryForm.id && <button type="button" className="admin-secondary-action" onClick={() => setInventoryForm({ id: "", item_name: "", asset_tag: "", category: "Equipment", quantity: "1", condition: "serviceable", location: "", notes: "" })}>Cancel edit</button>}</div>
                </form>}
                <div className="council-inventory-list">{data.inventory?.length ? data.inventory.map((item) => <article key={item.id}><div><span className={`council-inventory-condition is-${item.condition}`}>{item.condition.replaceAll("_", " ")}</span><h3>{item.item_name}</h3><small>{item.category}{item.asset_tag ? ` · ${item.asset_tag}` : ""}</small><p>{item.quantity} · stored at {item.location}</p>{item.notes && <p>{item.notes}</p>}<details><summary>Inventory history ({item.history?.length || 0})</summary>{item.history?.slice(-8).reverse().map((entry, index) => <small key={`${entry.at}-${index}`}>{entry.action} · {entry.quantity} item(s) · {dateTime(entry.at)}</small>)}<small>Last updated by {item.updated_by_name} · {dateTime(item.updated_at)}</small></details></div>{canManageInventory && <button type="button" className="admin-secondary-action" onClick={() => editInventoryItem(item)}>Edit record</button>}</article>) : <p className="admin-feedback">No property has been recorded yet.</p>}</div>
                {!canManageInventory && <p className="council-rule-note">The Auditor and Governor can update property records. Council members may view the register.</p>}
            </section>}

            <footer className="council-governance-links"><strong>Related council functions</strong>{isAdmin && <Link to="/admin/users">People & council appointments</Link>}{isCouncilMember && <Link to="/admin/committees/executive">Committee workspaces</Link>}{(isAdmin || ["governor", "treasurer", "auditor"].includes(member.council_position)) && <Link to="/admin/finance">Budgets & financial records</Link>}{isCouncilMember && <Link to="/admin/events">University events</Link>}{(isAdmin || ["governor", "vice_governor", "secretary", "social_media_manager"].includes(member.council_position)) && <Link to="/admin/attendance">Event registration attendance</Link>}</footer>
            {!isCouncilMember && isAdmin && <p className="council-rule-note">Assign elected positions in the People directory to enable member QR passes. Administrators can manage records, but only appointed voting officers are issued attendance credentials.</p>}
        </main>
    </>;
}
