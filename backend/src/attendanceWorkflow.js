import crypto from "node:crypto";

const QR_TYPES = new Set(["EVENT", "COUNCIL"]);

export function createAttendanceQr(type, credentialId, secret) {
    const normalizedType = String(type || "").toUpperCase();
    if (!QR_TYPES.has(normalizedType) || !/^[A-Za-z0-9_-]{20,64}$/.test(credentialId || "") || !secret) {
        throw new TypeError("A valid attendance credential and signing secret are required.");
    }
    const signature = crypto.createHmac("sha256", secret).update(`${normalizedType}:${credentialId}`).digest("base64url");
    return `AUSSC:${normalizedType}:${credentialId}:${signature}`;
}

export function readAttendanceQr(value, secret) {
    if (typeof value !== "string" || value.length > 180 || !secret) return null;
    const match = /^AUSSC:(EVENT|COUNCIL):([A-Za-z0-9_-]{20,64}):([A-Za-z0-9_-]{43})$/.exec(value.trim());
    if (!match) return null;
    const [, type, credentialId, suppliedSignature] = match;
    const expectedSignature = crypto.createHmac("sha256", secret).update(`${type}:${credentialId}`).digest("base64url");
    const supplied = Buffer.from(suppliedSignature);
    const expected = Buffer.from(expectedSignature);
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
    return { type, credentialId };
}

export function attendanceScanAction(record) {
    if (!record) return "time_in";
    if (!record.time_out) return "time_out";
    return "completed";
}

export async function transitionAttendanceRecord({ findExisting, createRecord, insertRecord, checkOutRecord, isDuplicateError = (error) => error?.code === 11000 }) {
    let record = await findExisting();
    if (!record) {
        const candidate = await createRecord();
        try {
            await insertRecord(candidate);
            return { success: true, action: "time_in", record: candidate, message: "Check-in recorded." };
        } catch (error) {
            if (!isDuplicateError(error)) throw error;
            // A concurrent first scan won the unique insert. Keep this scan a
            // duplicate instead of interpreting it as the participant's exit.
            record = await findExisting();
            return { success: false, action: "duplicate", record, message: "This attendee is already checked in." };
        }
    }
    const action = attendanceScanAction(record);
    if (action === "completed") return { success: false, action, record, message: "This attendee has already checked out for this event." };
    const checkout = await checkOutRecord(record);
    if (!checkout.modified) {
        return { success: false, action: "duplicate", record: checkout.record, message: checkout.record?.time_out ? "Check-out was already recorded." : "This attendee is already checked in." };
    }
    return { success: true, action: "time_out", record: checkout.record, message: "Check-out recorded." };
}

export function isAuthorizedCouncilMember(user, councilPositions, committeeAssignments) {
    // Administrator accounts are council workspace accounts as well; include
    // them in the reusable identity QR and council attendance flows.
    return Boolean(user && (user.role === "admin" || councilPositions.has(user.council_position) || committeeAssignments.has(user.committee_assignment)));
}
