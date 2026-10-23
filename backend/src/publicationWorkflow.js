export const publicationStatuses = Object.freeze([
    "Request Submitted",
    "Requirements Review",
    "Assigned",
    "In Design",
    "Internal Review",
    "Revisions Requested",
    "Awaiting Approval",
    "Approved",
    "Scheduled",
    "Published",
    "Archived",
    "Cancelled"
]);

const asDate = (value) => {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

export function classifyPublicationTask(task, now = new Date()) {
    const firstSubmission = [...(task.submissions || [])]
        .sort((a, b) => Number(a.version || 0) - Number(b.version || 0))[0] || null;
    const hasDeadlineSnapshot = firstSubmission && Object.prototype.hasOwnProperty.call(firstSubmission, "deadline_snapshot");
    const dueAt = asDate(hasDeadlineSnapshot ? firstSubmission.deadline_snapshot : task.due_at);
    const submittedAt = asDate(firstSubmission?.submitted_at);
    let submissionTimeliness = "not_submitted";

    if (submittedAt && dueAt) {
        const difference = submittedAt.getTime() - dueAt.getTime();
        submissionTimeliness = difference < 0 ? "early" : difference === 0 ? "on_time" : "late";
    } else if (!submittedAt && dueAt && dueAt < now && task.status !== "Cancelled") {
        submissionTimeliness = "overdue";
    }

    const scheduledAt = asDate(task.scheduled_post_at);
    const postedAt = asDate(task.posted_at);
    let publicationTimeliness = "not_posted";
    if (postedAt && scheduledAt) {
        publicationTimeliness = postedAt <= scheduledAt ? "on_time" : "late";
    } else if (postedAt) {
        publicationTimeliness = "no_schedule";
    }

    return {
        first_submission: firstSubmission,
        submission_timeliness: submissionTimeliness,
        publication_timeliness: publicationTimeliness,
        overdue: submissionTimeliness === "overdue"
    };
}

export function summarizePublicationPerformance(tasks, now = new Date()) {
    const activeTasks = tasks.filter((task) => task.status !== "Cancelled");
    const classifications = activeTasks.map((task) => ({ task, ...classifyPublicationTask(task, now) }));
    const count = (predicate) => classifications.filter(predicate).length;
    const eligibleForSubmissionRate = classifications.filter(({ task, first_submission }) => {
        const hasDeadlineSnapshot = first_submission && Object.prototype.hasOwnProperty.call(first_submission, "deadline_snapshot");
        const dueAt = asDate(hasDeadlineSnapshot ? first_submission.deadline_snapshot : task.due_at);
        return dueAt && (first_submission || dueAt <= now);
    }).length;
    const eligibleForPublicationRate = classifications.filter(({ task }) => {
        const scheduledAt = asDate(task.scheduled_post_at);
        return scheduledAt && (asDate(task.posted_at) || scheduledAt <= now);
    }).length;
    const early = count((item) => item.submission_timeliness === "early");
    const onTime = count((item) => item.submission_timeliness === "on_time");
    const publicationOnTime = count((item) => item.publication_timeliness === "on_time");

    return {
        total_assigned: activeTasks.length,
        submitted: count((item) => Boolean(item.first_submission)),
        approved: count(({ task }) => ["Approved", "Scheduled", "Published", "Posted"].includes(task.status)),
        scheduled: count(({ task }) => task.status === "Scheduled"),
        posted: count(({ task }) => Boolean(asDate(task.posted_at)) || ["Published", "Posted"].includes(task.status)),
        early_submissions: early,
        on_time_submissions: onTime,
        late_submissions: count((item) => item.submission_timeliness === "late"),
        not_started: count(({ task }) => ["Not Started", "Request Submitted", "Requirements Review", "Assigned"].includes(task.status)),
        in_progress: count(({ task }) => ["In Progress", "In Design"].includes(task.status)),
        overdue: count((item) => item.overdue),
        awaiting_review: count(({ task }) => ["Submitted for Review", "Internal Review", "Awaiting Approval"].includes(task.status)),
        awaiting_revisions: count(({ task }) => ["Revision Requested", "Revisions Requested"].includes(task.status)),
        submission_rate_eligible: eligibleForSubmissionRate,
        on_time_submission_rate: eligibleForSubmissionRate ? Math.round((early + onTime) / eligibleForSubmissionRate * 100) : null,
        publication_rate_eligible: eligibleForPublicationRate,
        on_time_publication_count: publicationOnTime,
        on_time_publication_rate: eligibleForPublicationRate ? Math.round(publicationOnTime / eligibleForPublicationRate * 100) : null,
        task_classifications: classifications.map(({ task, submission_timeliness, publication_timeliness, overdue }) => ({
            task_id: task.id,
            submission_timeliness,
            publication_timeliness,
            overdue
        }))
    };
}
