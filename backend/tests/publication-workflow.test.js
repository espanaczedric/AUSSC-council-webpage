import test from "node:test";
import assert from "node:assert/strict";
import { classifyPublicationTask, summarizePublicationPerformance } from "../src/publicationWorkflow.js";

const now = new Date("2026-10-23T04:00:00.000Z");
const due = new Date("2026-10-22T04:00:00.000Z");

test("classifies early, on-time, late, and overdue first submissions", () => {
    const tasks = [
        { id: 1, due_at: due, status: "Published", submissions: [{ version: 1, submitted_at: new Date(due.getTime() - 1) }] },
        { id: 2, due_at: due, status: "Approved", submissions: [{ version: 1, submitted_at: due }] },
        { id: 3, due_at: due, status: "Published", submissions: [{ version: 1, submitted_at: new Date(due.getTime() + 1) }] },
        { id: 4, due_at: due, status: "In Progress", submissions: [] }
    ];
    assert.deepEqual(tasks.map((task) => classifyPublicationTask(task, now).submission_timeliness), ["early", "on_time", "late", "overdue"]);
});

test("uses the deadline captured at submission when deadlines change later", () => {
    const task = {
        id: 7,
        due_at: new Date("2026-10-24T04:00:00.000Z"),
        status: "Approved",
        submissions: [{ version: 1, deadline_snapshot: due, submitted_at: new Date(due.getTime() + 60_000) }]
    };
    assert.equal(classifyPublicationTask(task, now).submission_timeliness, "late");
});

test("classifies actual posting against the scheduled posting time", () => {
    const scheduled = new Date("2026-10-24T04:00:00.000Z");
    assert.equal(classifyPublicationTask({ scheduled_post_at: scheduled, posted_at: scheduled }).publication_timeliness, "on_time");
    assert.equal(classifyPublicationTask({ scheduled_post_at: scheduled, posted_at: new Date(scheduled.getTime() + 1) }).publication_timeliness, "late");
    assert.equal(classifyPublicationTask({ posted_at: scheduled }).publication_timeliness, "no_schedule");
});

test("calculates rates from active tasks with recorded eligibility and excludes cancelled work", () => {
    const tasks = [
        { id: 1, due_at: due, status: "Published", submissions: [{ version: 1, submitted_at: due }], scheduled_post_at: due, posted_at: due },
        { id: 2, due_at: due, status: "In Progress", submissions: [] },
        { id: 3, due_at: due, status: "Cancelled", submissions: [] }
    ];
    const summary = summarizePublicationPerformance(tasks, now);
    assert.equal(summary.total_assigned, 2);
    assert.equal(summary.submitted, 1);
    assert.equal(summary.overdue, 1);
    assert.equal(summary.on_time_submission_rate, 50);
    assert.equal(summary.on_time_publication_rate, 100);
    assert.deepEqual(summary.task_classifications.map((item) => item.task_id), [1, 2]);
});

test("does not lower performance rates for future deadlines", () => {
    const summary = summarizePublicationPerformance([{ id: 1, due_at: new Date("2026-10-24T04:00:00.000Z"), scheduled_post_at: new Date("2026-10-25T04:00:00.000Z"), status: "Not Started", submissions: [] }], now);
    assert.equal(summary.on_time_submission_rate, null);
    assert.equal(summary.on_time_publication_rate, null);
});


test("preserves a no-deadline-at-submission record if a deadline is added later", () => {
    const task = {
        id: 8,
        due_at: due,
        status: "Approved",
        submissions: [{ version: 1, deadline_snapshot: null, submitted_at: due }]
    };
    assert.equal(classifyPublicationTask(task, now).submission_timeliness, "not_submitted");
    assert.equal(summarizePublicationPerformance([task], now).on_time_submission_rate, null);
});
