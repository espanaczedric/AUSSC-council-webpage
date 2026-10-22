import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import AdminNav from "../../components/AdminNav";
import EventImage from "../../components/EventImage";
import { getAdminDashboard } from "../../services/api";

const numberFormat = new Intl.NumberFormat("en-PH");
const pesoFormat = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });
const committees = [
    { key: "executive", label: "Executive" },
    { key: "publication", label: "Publication" },
    { key: "program", label: "Program" },
    { key: "production", label: "Production" }
];
const publicationStatuses = [
    { key: "draft", label: "Draft" },
    { key: "pending_approval", label: "Pending approval" },
    { key: "published", label: "Published" },
    { key: "cancelled", label: "Cancelled" },
    { key: "archived", label: "Archived" }
];

const displayNumber = (value) => Number.isFinite(Number(value)) ? numberFormat.format(Number(value)) : "—";
const formatMonth = (key) => {
    const [year, month] = key.split("-").map(Number);
    return new Date(year, month - 1, 1).toLocaleDateString("en-PH", { month: "short" });
};
const getRecentMonths = (count = 6) => {
    const now = new Date();
    return Array.from({ length: count }, (_, index) => {
        const month = new Date(now.getFullYear(), now.getMonth() - count + index + 1, 1);
        return `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
    });
};

function SectionHeading({ eyebrow, title, detail, action, id }) {
    return (
        <div className="admin-overview-heading">
            <div>
                <span>{eyebrow}</span>
                <h2 id={id}>{title}</h2>
                {detail && <p>{detail}</p>}
            </div>
            {action}
        </div>
    );
}

function OverviewMetric({ label, value, detail, to }) {
    const content = <>
        <span>{label}</span>
        <strong>{value}</strong>
        {detail && <small>{detail}</small>}
    </>;
    return to
        ? <Link className="admin-overview-metric" to={to}>{content}</Link>
        : <article className="admin-overview-metric">{content}</article>;
}

function RegistrationTrend({ months, values }) {
    const width = 660;
    const height = 248;
    const left = 48;
    const right = 638;
    const top = 20;
    const bottom = 193;
    const maximum = Math.max(1, ...values.flatMap((item) => [item.registrations, item.checked_in]));
    const pointsFor = (key) => values.map((item, index) => ({
        x: left + (values.length > 1 ? index * (right - left) / (values.length - 1) : (right - left) / 2),
        y: bottom - (item[key] / maximum) * (bottom - top),
        value: item[key]
    }));
    const pathFor = (points) => points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
    const registrationPoints = pointsFor("registrations");
    const checkInPoints = pointsFor("checked_in");
    const hasData = values.some((item) => item.registrations || item.checked_in);

    return (
        <article className="admin-overview-chart-card">
            <div className="admin-overview-chart-heading">
                <div>
                    <span>STUDENT EVENT ACTIVITY</span>
                    <h3>Registrations & check-ins</h3>
                </div>
                <Link to="/admin/registrations">View registrations</Link>
            </div>
            <div className="admin-trend-legend" aria-label="Chart legend">
                <span><i className="is-registration" /> Registrations</span>
                <span><i className="is-checkin" /> QR check-ins</span>
            </div>
            <div className="admin-trend-chart-wrap">
                <svg className="admin-trend-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Monthly student registrations and QR check-ins for the last six months">
                    {[0, 1, 2, 3].map((step) => {
                        const y = top + step * (bottom - top) / 3;
                        return <g key={step}>
                            <line x1={left} x2={right} y1={y} y2={y} className="admin-trend-gridline" />
                            <text x={left - 10} y={y + 4} textAnchor="end" className="admin-trend-axis-label">{Math.round(maximum * (3 - step) / 3)}</text>
                        </g>;
                    })}
                    {hasData && <>
                        <path d={pathFor(registrationPoints)} className="admin-trend-line is-registration" />
                        <path d={pathFor(checkInPoints)} className="admin-trend-line is-checkin" />
                        {registrationPoints.map((point, index) => <circle key={`r-${months[index]}`} cx={point.x} cy={point.y} r="4" className="admin-trend-point is-registration"><title>{months[index]}: {point.value} registrations</title></circle>)}
                        {checkInPoints.map((point, index) => <circle key={`c-${months[index]}`} cx={point.x} cy={point.y} r="4" className="admin-trend-point is-checkin"><title>{months[index]}: {point.value} QR check-ins</title></circle>)}
                    </>}
                    {months.map((month, index) => {
                        const x = left + (months.length > 1 ? index * (right - left) / (months.length - 1) : (right - left) / 2);
                        return <text key={month} x={x} y={bottom + 26} textAnchor="middle" className="admin-trend-axis-label">{formatMonth(month)}</text>;
                    })}
                    {!hasData && <text x={(left + right) / 2} y={(top + bottom) / 2} textAnchor="middle" className="admin-trend-empty-label">No registration activity in this period</text>}
                </svg>
            </div>
        </article>
    );
}

function HorizontalBreakdown({ title, eyebrow, rows, emptyLabel, link }) {
    const maximum = Math.max(1, ...rows.map((row) => row.value));
    const total = rows.reduce((sum, row) => sum + row.value, 0);
    return (
        <article className="admin-overview-chart-card">
            <div className="admin-overview-chart-heading">
                <div><span>{eyebrow}</span><h3>{title}</h3></div>
                {link && <Link to={link.to}>{link.label}</Link>}
            </div>
            {total ? <div className="admin-breakdown-list" role="list" aria-label={title}>
                {rows.map((row) => (
                    <div className="admin-breakdown-row" role="listitem" key={row.label}>
                        <div className="admin-breakdown-copy"><span>{row.label}</span><strong>{displayNumber(row.value)}</strong></div>
                        <div className="admin-breakdown-track" aria-label={`${row.label}: ${row.value}`}>
                            <i className={row.tone || ""} style={{ width: `${Math.max(row.value ? 4 : 0, row.value / maximum * 100)}%` }} />
                        </div>
                    </div>
                ))}
            </div> : <p className="admin-overview-chart-empty">{emptyLabel}</p>}
        </article>
    );
}

function MeetingQuorumChart({ meetings, threshold }) {
    return (
        <article className="admin-overview-chart-card admin-quorum-card">
            <div className="admin-overview-chart-heading">
                <div><span>GOVERNANCE MEETINGS</span><h3>Attendance & quorum</h3></div>
                <Link to="/council">Council governance</Link>
            </div>
            <p className="admin-chart-context">Constitutional quorum is at least two-thirds of voting council members ({threshold || 0} of the roster).</p>
            {meetings.length ? <div className="admin-quorum-list">
                {meetings.map((meeting) => {
                    const ratio = meeting.voting_members ? Math.min(100, meeting.present / meeting.voting_members * 100) : 0;
                    const quorumRatio = meeting.voting_members ? meeting.quorum_required / meeting.voting_members * 100 : 0;
                    const label = new Date(meeting.start_at).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
                    const status = meeting.quorum_waived ? "Waiver recorded" : meeting.quorum_met ? "Quorum met" : "Below quorum";
                    return <div className="admin-quorum-row" key={meeting.id}>
                        <div className="admin-quorum-title"><strong>{meeting.title}</strong><span>{label} · {meeting.present}/{meeting.voting_members} present</span></div>
                        <div className="admin-quorum-track" role="img" aria-label={`${meeting.title}: ${meeting.present} of ${meeting.voting_members} present; ${status}`}>
                            <i style={{ width: `${ratio}%` }} />
                            <b style={{ left: `${quorumRatio}%` }} />
                        </div>
                        <span className={`admin-quorum-status ${meeting.quorum_waived ? "is-waived" : meeting.quorum_met ? "is-met" : "is-short"}`}>{status}</span>
                    </div>;
                })}
                <div className="admin-quorum-legend"><span><i /> Attendance</span><span><b /> Two-thirds quorum</span></div>
            </div> : <p className="admin-overview-chart-empty">No completed mandatory meetings have attendance records for this academic period yet.</p>}
        </article>
    );
}

function AdminSkeletonBar({ className = "" }) {
    return <i className={`admin-skeleton-block ${className}`} aria-hidden="true" />;
}

function DashboardChartSkeleton({ kind = "rows", rowCount = 4 }) {
    return (
        <article className="admin-overview-chart-card admin-skeleton-chart" aria-hidden="true">
            <div className="admin-overview-chart-heading">
                <div><AdminSkeletonBar className="admin-skeleton-chart-eyebrow" /><AdminSkeletonBar className="admin-skeleton-chart-title" /></div>
                <AdminSkeletonBar className="admin-skeleton-chart-action" />
            </div>
            {kind === "graph" ? (
                <div className="admin-skeleton-graph">
                    {Array.from({ length: 6 }, (_, index) => (
                        <span key={index}>
                            <i style={{ height: `${32 + ((index * 37) % 52)}%` }} />
                            <i style={{ height: `${22 + ((index * 29) % 48)}%` }} />
                        </span>
                    ))}
                </div>
            ) : (
                <div className="admin-skeleton-rows">
                    {Array.from({ length: rowCount }, (_, index) => (
                        <div className="admin-skeleton-row" key={index}>
                            <div><AdminSkeletonBar className="admin-skeleton-row-label" /><AdminSkeletonBar className="admin-skeleton-row-value" /></div>
                            <AdminSkeletonBar className="admin-skeleton-row-track" />
                        </div>
                    ))}
                </div>
            )}
        </article>
    );
}

function AdminDashboardSkeleton() {
    return (
        <>
            <AdminNav />
            <main className="admin-page admin-dashboard admin-overview-page admin-dashboard-skeleton" aria-busy="true">
                <section className="admin-header admin-page-heading" aria-hidden="true">
                    <div className="admin-dashboard-skeleton-heading">
                        <AdminSkeletonBar className="admin-skeleton-page-eyebrow" />
                        <AdminSkeletonBar className="admin-skeleton-page-title" />
                        <AdminSkeletonBar className="admin-skeleton-page-subtitle" />
                    </div>
                    <AdminSkeletonBar className="admin-skeleton-create-action" />
                </section>

                <section className="admin-overview-group" aria-hidden="true">
                    <div className="admin-overview-heading admin-dashboard-skeleton-section-heading">
                        <div><AdminSkeletonBar className="admin-skeleton-section-eyebrow" /><AdminSkeletonBar className="admin-skeleton-section-title" /><AdminSkeletonBar className="admin-skeleton-section-detail" /></div>
                    </div>
                    <div className="admin-overview-metrics">
                        {Array.from({ length: 4 }, (_, index) => <article className="admin-overview-metric" key={index}><AdminSkeletonBar className="admin-skeleton-metric-label" /><AdminSkeletonBar className="admin-skeleton-metric-number" /><AdminSkeletonBar className="admin-skeleton-metric-detail" /></article>)}
                    </div>
                    <div className="admin-overview-chart-grid student-chart-grid">
                        <DashboardChartSkeleton kind="graph" />
                        <DashboardChartSkeleton rowCount={4} />
                    </div>
                </section>

                <section className="admin-overview-group" aria-hidden="true">
                    <div className="admin-overview-heading admin-dashboard-skeleton-section-heading">
                        <div><AdminSkeletonBar className="admin-skeleton-section-eyebrow" /><AdminSkeletonBar className="admin-skeleton-section-title" /><AdminSkeletonBar className="admin-skeleton-section-detail" /></div>
                    </div>
                    <div className="admin-overview-metrics">
                        {Array.from({ length: 4 }, (_, index) => <article className="admin-overview-metric" key={index}><AdminSkeletonBar className="admin-skeleton-metric-label" /><AdminSkeletonBar className="admin-skeleton-metric-number" /><AdminSkeletonBar className="admin-skeleton-metric-detail" /></article>)}
                    </div>
                    <div className="admin-overview-chart-grid council-chart-grid">
                        <DashboardChartSkeleton rowCount={4} />
                        <DashboardChartSkeleton rowCount={5} />
                        <DashboardChartSkeleton kind="graph" />
                        <DashboardChartSkeleton rowCount={4} />
                        <DashboardChartSkeleton rowCount={3} />
                    </div>
                </section>

                <section className="admin-section admin-upcoming-overview" aria-hidden="true">
                    <div className="admin-section-heading admin-dashboard-skeleton-upcoming-heading"><div><AdminSkeletonBar className="admin-skeleton-section-eyebrow" /><AdminSkeletonBar className="admin-skeleton-section-title" /></div><AdminSkeletonBar className="admin-skeleton-chart-action" /></div>
                    <div className="admin-skeleton-upcoming-row"><AdminSkeletonBar className="admin-skeleton-upcoming-image" /><div><AdminSkeletonBar className="admin-skeleton-row-label" /><AdminSkeletonBar className="admin-skeleton-upcoming-title" /><AdminSkeletonBar className="admin-skeleton-section-detail" /></div></div>
                    <div className="admin-skeleton-upcoming-row"><AdminSkeletonBar className="admin-skeleton-upcoming-image" /><div><AdminSkeletonBar className="admin-skeleton-row-label" /><AdminSkeletonBar className="admin-skeleton-upcoming-title" /><AdminSkeletonBar className="admin-skeleton-section-detail" /></div></div>
                </section>
                <span className="sr-only" role="status">Loading the executive dashboard…</span>
            </main>
        </>
    );
}

function AdminDashboard() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        getAdminDashboard()
            .then((response) => setData(response.dashboard ? { ...response.dashboard, eventsList: response.events || [] } : null))
            .catch((requestError) => {
                if (requestError.code === "API_URL_NOT_CONFIGURED") {
                    setError("The API URL is not configured. Production uses the same-domain /api Vercel Function; confirm the project is deployed from the repository root.");
                    return;
                }
                if (requestError.status === 401) {
                    setError("Your administrator session has expired. Sign in again.");
                    return;
                }
                const reference = requestError.requestId ? ` (Reference: ${requestError.requestId})` : "";
                setError(`${requestError.message || "Could not load dashboard data."}${reference}`);
            })
            .finally(() => setLoading(false));
    }, []);

    const students = data?.students || {};
    const council = data?.council || {};
    const eventData = data?.events || {};
    const events = data?.eventsList || [];
    const [months, trend] = useMemo(() => {
        const keys = getRecentMonths(6);
        const byMonth = new Map((students.registration_trend || []).map((item) => [item.month, item]));
        return [keys, keys.map((month) => ({
            registrations: Number(byMonth.get(month)?.registrations || 0),
            checked_in: Number(byMonth.get(month)?.checked_in || 0)
        }))];
    }, [students.registration_trend]);

    const councilMetrics = [
        { label: "Appointed council members", value: displayNumber(council.roster_count), detail: "Current roster", to: "/admin/users" },
        { label: "Voting members", value: displayNumber(council.voting_member_count), detail: "Quorum basis", to: "/council" },
        { label: "Mean meeting attendance", value: council.mean_meeting_attendance == null ? "—" : `${council.mean_meeting_attendance}%`, detail: `${displayNumber(council.completed_mandatory_meeting_count)} mandatory meetings completed`, to: "/council" },
        { label: "Review queue", value: displayNumber(council.approval_queue_count), detail: "Items needing council review", to: "/council" }
    ];
    const finance = council.finance || {};
    const meetings = council.meeting_chart || [];
    const recentEvents = events.filter((event) => ["upcoming", "ongoing"].includes(event.display_status));

    if (loading) return <AdminDashboardSkeleton />;

    return (
        <>
            <AdminNav />
            <main className="admin-page admin-dashboard admin-overview-page">
                <section className="admin-header admin-page-heading">
                    <div>
                        <span>EXECUTIVE OPERATIONS</span>
                        <h1>Dashboard</h1>
                        <p>Student participation, council governance, and stewardship in one view.</p>
                    </div>
                    <Link to="/admin/events/create" className="admin-primary-action">
                        <span aria-hidden="true">+</span>
                        Create event
                    </Link>
                </section>

                {error && <p className="admin-feedback is-error" role="alert">{error}</p>}

                <section className="admin-overview-group student-overview" aria-labelledby="student-overview-title">
                    <SectionHeading
                        id="student-overview-title"
                        eyebrow="STUDENT ACTIVITY"
                        title="Student participation"
                        detail="Event reach and attendance verified through student registrations and QR check-ins."
                    />
                    <div className="admin-overview-metrics">
                        <OverviewMetric label="Student accounts" value={displayNumber(students.account_count)} detail="Registered student accounts" to="/admin/users" />
                        <OverviewMetric label="Event registrations" value={displayNumber(students.registration_count)} detail="Active student registrations" to="/admin/registrations" />
                        <OverviewMetric label="QR check-ins" value={displayNumber(students.check_in_count)} detail="Student attendance recorded" to="/admin/attendance" />
                        <OverviewMetric label="Check-in rate" value={`${Number(students.check_in_rate || 0)}%`} detail="Check-ins / active registrations" to="/admin/attendance" />
                    </div>
                    <div className="admin-overview-chart-grid student-chart-grid">
                        <RegistrationTrend months={months} values={trend} />
                        <HorizontalBreakdown
                            eyebrow="MOST COMMON COURSES"
                            title="Accounts by course"
                            rows={(students.course_distribution || []).map((row, index) => ({
                                label: row.course,
                                value: Number(row.count || 0),
                                tone: ["tone-blue", "tone-gold", "tone-green", "tone-navy", "tone-muted", "tone-red"][index]
                            }))}
                            emptyLabel="Course information has not been recorded for student accounts yet."
                            link={{ to: "/admin/users", label: "View students" }}
                        />
                    </div>
                </section>

                <section className="admin-overview-group council-overview" aria-labelledby="council-overview-title">
                    <SectionHeading
                        id="council-overview-title"
                        eyebrow={`COUNCIL GOVERNANCE · ${data?.academic_period || "CURRENT ACADEMIC PERIOD"}`}
                        title="Council oversight"
                        detail="Track appointments, committee reporting, meeting attendance, quorum, and financial records."
                    />
                    <div className="admin-overview-metrics">
                        {councilMetrics.map((metric) => <OverviewMetric key={metric.label} {...metric} />)}
                    </div>
                    <div className="admin-overview-chart-grid council-chart-grid">
                        <HorizontalBreakdown
                            eyebrow="ASSIGNED WORKSPACES"
                            title="Committee workspace access"
                            rows={committees.map((committee, index) => ({
                                label: committee.label,
                                value: Number(council.committee_distribution?.find((row) => row.committee === committee.key)?.count || 0),
                                tone: ["tone-blue", "tone-gold", "tone-green", "tone-navy"][index]
                            }))}
                            emptyLabel="No committee assignments have been recorded yet."
                            link={{ to: "/admin/users", label: "Manage assignments" }}
                        />
                        <HorizontalBreakdown
                            eyebrow="EXECUTIVE EVENT OVERSIGHT"
                            title="Event publication status"
                            rows={publicationStatuses.map((status, index) => ({
                                label: status.label,
                                value: Number(eventData.publication_status?.[status.key] || 0),
                                tone: ["tone-blue", "tone-gold", "tone-green", "tone-red", "tone-muted"][index]
                            }))}
                            emptyLabel="No events have been created yet."
                            link={{ to: "/admin/events", label: "Manage events" }}
                        />
                        <MeetingQuorumChart meetings={meetings} threshold={Number(council.quorum_threshold || 0)} />
                        <HorizontalBreakdown
                            eyebrow={`COMMITTEE REPORTS · ${council.academic_period || "CURRENT PERIOD"}`}
                            title="Reporting by committee"
                            rows={committees.map((committee, index) => ({
                                label: committee.label,
                                value: Number(council.reports_by_committee?.[committee.key] || 0),
                                tone: ["tone-blue", "tone-gold", "tone-green", "tone-navy"][index]
                            }))}
                            emptyLabel="No committee reports have been submitted this academic period."
                            link={{ to: "/council", label: "Review governance" }}
                        />
                        <article className="admin-overview-chart-card admin-finance-summary">
                            <div className="admin-overview-chart-heading">
                                <div><span>FINANCIAL STEWARDSHIP · ALL PERIODS</span><h3>Approved & recorded</h3></div>
                                <Link to="/admin/finance">Open ledger</Link>
                            </div>
                            <div className="admin-finance-summary-grid">
                                <div><span>Approved allocations</span><strong>{pesoFormat.format(Number(finance.approved_allocations || 0))}</strong></div>
                                <div><span>Recorded expenses</span><strong>{pesoFormat.format(Number(finance.recorded_expenses || 0))}</strong></div>
                                <div className="is-balance"><span>Cumulative balance</span><strong>{pesoFormat.format(Number(finance.available_balance || 0))}</strong></div>
                            </div>
                            <p className="admin-finance-note">All periods. Proposed allocations ({pesoFormat.format(Number(finance.proposed_allocations || 0))}) and pending expenses ({pesoFormat.format(Number(finance.pending_expenses || 0))}) are excluded.</p>
                        </article>
                    </div>
                </section>

                <section className="admin-section admin-upcoming-overview">
                    <div className="admin-section-heading">
                        <div><span>WHAT'S NEXT · {displayNumber(eventData.upcoming_or_live)} UPCOMING OR LIVE</span><h2>Upcoming events</h2></div>
                        <Link to="/admin/events" className="admin-text-link">All events</Link>
                    </div>
                    {recentEvents.length ? (
                        <div className="admin-upcoming-list">
                            {recentEvents.map((event) => (
                                <article className="admin-upcoming-row" key={event.id}>
                                    <EventImage src={event.cover_image} alt="" className="admin-upcoming-thumb" />
                                    <div className="admin-upcoming-copy">
                                        <span className={`admin-status is-${event.display_status}`}>{event.display_status === "ongoing" ? "Happening now" : "Upcoming"}</span>
                                        <h3>{event.title}</h3>
                                        <p>{new Date(event.start_date).toLocaleString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })} · {event.location}</p>
                                    </div>
                                    <span className="admin-registration-count">{displayNumber(event.registration_count)} / {displayNumber(event.capacity)} registered</span>
                                </article>
                            ))}
                        </div>
                    ) : (
                        <div className="admin-empty-state"><h3>No upcoming events</h3><p>Create an event draft and submit it for council approval before publishing.</p><Link to="/admin/events/create" className="admin-text-link">Create an event</Link></div>
                    )}
                </section>
            </main>
        </>
    );
}

export default AdminDashboard;
