import test from "node:test";
import assert from "node:assert/strict";

import { attendanceScanAction, createAttendanceQr, isAuthorizedCouncilMember, readAttendanceQr, transitionAttendanceRecord } from "../src/attendanceWorkflow.js";

test("signed event and council QRs are opaque and verify only with the configured secret", () => {
    const passId = "K2p4k51pd2Hd8Nw4kKz4wwjw";
    for (const type of ["EVENT", "COUNCIL"]) {
        const qr = createAttendanceQr(type, passId, "a-random-session-secret");
        assert.match(qr, /^AUSSC:/);
        assert.doesNotMatch(qr, /Jane|student|person@example\.com/i);
        assert.deepEqual(readAttendanceQr(qr, "a-random-session-secret"), { type, credentialId: passId });
        assert.equal(readAttendanceQr(qr, "different-session-secret"), null);
        assert.equal(readAttendanceQr(`${qr.slice(0, -1)}x`, "a-random-session-secret"), null);
    }
});

test("attendance QR creation rejects malformed or unsigned credentials", () => {
    assert.throws(() => createAttendanceQr("STUDENT", "K2p4k51pd2Hd8Nw4kKz4wwjw", "secret"), TypeError);
    assert.throws(() => createAttendanceQr("EVENT", "short", "secret"), TypeError);
    assert.equal(readAttendanceQr("AUSSC:EVENT:not-a-secret", "secret"), null);
});

test("attendance scans move from check-in to check-out once without changing a completed session", () => {
    assert.equal(attendanceScanAction(null), "time_in");
    assert.equal(attendanceScanAction({ time_in: new Date(), time_out: null }), "time_out");
    assert.equal(attendanceScanAction({ time_in: new Date(), time_out: new Date() }), "completed");
});

test("concurrent first scans cannot turn one check-in into an immediate check-out", async () => {
    let saved = null;
    let nextId = 0;
    const run = () => transitionAttendanceRecord({
        findExisting: async () => saved,
        createRecord: async () => ({ id: ++nextId, time_in: new Date(), time_out: null }),
        insertRecord: async (record) => {
            if (saved) { const error = new Error("duplicate participant"); error.code = 11000; throw error; }
            saved = record;
        },
        checkOutRecord: async (record) => {
            if (record.time_out) return { modified: false, record };
            saved = { ...saved, time_out: new Date() };
            return { modified: true, record: saved };
        }
    });

    const firstScans = await Promise.all([run(), run()]);
    assert.equal(firstScans.filter((result) => result.action === "time_in" && result.success).length, 1);
    assert.equal(firstScans.filter((result) => result.action === "duplicate" && !result.success).length, 1);
    assert.equal(saved.time_out, null);

    const checkOut = await run();
    assert.equal(checkOut.action, "time_out");
    assert.ok(saved.time_out instanceof Date);
    const originalTimeOut = saved.time_out;
    const repeated = await run();
    assert.equal(repeated.action, "completed");
    assert.equal(saved.time_out, originalTimeOut);
});

test("only accounts with a current council position or committee assignment qualify", () => {
    const positions = new Set(["governor", "secretary"]);
    const committees = new Set(["executive", "publication", "production"]);
    assert.equal(isAuthorizedCouncilMember({ council_position: "governor" }, positions, committees), true);
    assert.equal(isAuthorizedCouncilMember({ committee_assignment: "publication" }, positions, committees), true);
    assert.equal(isAuthorizedCouncilMember({ role: "admin" }, positions, committees), false);
    assert.equal(isAuthorizedCouncilMember({ committee_assignment: "former" }, positions, committees), false);
});
