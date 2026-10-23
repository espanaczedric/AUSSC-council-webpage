import { useEffect, useId, useRef, useState } from "react";
import {
    Html5Qrcode,
    Html5QrcodeSupportedFormats
} from "html5-qrcode";

import { apiRequest, getAdminAttendance, getAdminEvents } from "../services/api";

export function CameraScanner({ onDecoded, disabled = false, title = "Verify an attendance QR", label = "Attendance QR camera scanner" }) {
    const readerId = `qr-camera-${useId().replace(/:/g, "")}`;
    const scannerRef = useRef(null);
    const decodedRef = useRef(onDecoded);
    const lockedRef = useRef(false);
    const [cameraState, setCameraState] = useState("idle");
    const [cameraError, setCameraError] = useState("");

    decodedRef.current = onDecoded;

    useEffect(() => () => {
        const scanner = scannerRef.current;
        if (!scanner) return;

        if (scanner.isScanning) {
            scanner.stop()
                .then(() => scanner.clear())
                .catch(() => {});
        } else {
            try {
                scanner.clear();
            } catch {
            }
        }
    }, []);

    async function stopCamera(scanner = scannerRef.current) {
        if (!scanner) return;

        try {
            if (scanner.isScanning) {
                await scanner.stop();
            }
            scanner.clear();
        } catch {
            setCameraError("The camera could not be stopped cleanly. You can still continue.");
        }

        if (scannerRef.current === scanner) {
            scannerRef.current = null;
        }
        setCameraState("idle");
    }

    async function startCamera() {
        setCameraError("");
        setCameraState("starting");
        lockedRef.current = false;

        const scanner = new Html5Qrcode(readerId, {
            formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE]
        });
        scannerRef.current = scanner;

        try {
            await scanner.start(
                { facingMode: "environment" },
                {
                    fps: 10,
                    qrbox: { width: 250, height: 250 },
                    aspectRatio: 1
                },
                async (decodedText) => {
                    if (lockedRef.current) return;
                    lockedRef.current = true;
                    setCameraState("checking");

                    try {
                        if (scanner.isScanning) {
                            await scanner.stop();
                        }
                        scanner.clear();
                        if (scannerRef.current === scanner) {
                            scannerRef.current = null;
                        }
                        await decodedRef.current(decodedText);
                        lockedRef.current = false;
                        setCameraState("idle");
                    } catch {
                        setCameraError("The camera stopped unexpectedly. Please try again.");
                        lockedRef.current = false;
                        setCameraState("idle");
                    }
                },
                () => {}
            );

            if (!lockedRef.current) {
                setCameraState("scanning");
            }
        } catch {
            try {
                scanner.clear();
            } catch {
            }
            scannerRef.current = null;
            setCameraState("idle");
            setCameraError("Camera access is unavailable. Allow camera permission and try again.");
        }
    }

    return (
        <section className="qr-camera-panel" aria-label={label}>
            <div className="qr-camera-heading">
                <div>
                    <span>CAMERA SCANNER</span>
                    <h2>{title}</h2>
                </div>
                <span className={`qr-camera-indicator is-${cameraState}`} role="status">
                    {cameraState === "scanning" ? "Camera active" :
                        cameraState === "starting" ? "Opening camera" :
                            cameraState === "checking" ? "Verifying" : "Camera off"}
                </span>
            </div>

            <div className={`qr-camera-stage is-${cameraState}`}>
                <div id={readerId} className="qr-camera-reader" />
                {cameraState === "idle" && (
                    <div className="qr-camera-placeholder">
                        <span aria-hidden="true">QR</span>
                        <p>Your camera preview will appear here.</p>
                    </div>
                )}
            </div>

            {cameraError && <p className="admin-feedback is-error" role="alert">{cameraError}</p>}

            <div className="qr-camera-actions">
                {cameraState === "scanning" ? (
                    <button className="admin-secondary-action" type="button" onClick={() => stopCamera()}>
                        Stop camera
                    </button>
                ) : (
                    <button
                        className="admin-primary-action"
                        type="button"
                        onClick={startCamera}
                        disabled={disabled || cameraState === "starting" || cameraState === "checking"}
                    >
                        {cameraState === "starting" ? "Opening camera…" : "Start camera"}
                    </button>
                )}
            </div>
        </section>
    );
}

function formatDateTime(value) {
    if (!value) return "—";
    const date = new Date(value.replace(" ", "T"));
    if (Number.isNaN(date.getTime())) return value;

    return date.toLocaleString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit"
    });
}

function QRScanner() {
    const [result, setResult] = useState(null);
    const [verifying, setVerifying] = useState(false);
    const [memberQuery, setMemberQuery] = useState("");
    const [memberMatches, setMemberMatches] = useState([]);
    const [searchingMembers, setSearchingMembers] = useState(false);
    const [eventId, setEventId] = useState("");
    const [events, setEvents] = useState([]);
    const [attendanceCount, setAttendanceCount] = useState(0);

    useEffect(() => {
        getAdminEvents().then((data) => setEvents(data.events || [])).catch(() => {});
    }, []);

    useEffect(() => {
        if (!eventId) { setAttendanceCount(0); return; }
        getAdminAttendance(eventId).then((data) => setAttendanceCount(data.summary?.currently_present || 0)).catch(() => {});
    }, [eventId]);

    async function verifyAttendanceQr(qrValue) {
        setVerifying(true);

        try {
            const data = await apiRequest("/attendance/checkin", {
                method: "POST",
                credentials: "include",
                body: JSON.stringify({ qr_value: qrValue, event_id: Number(eventId) })
            });

            setResult({
                kind: data.success ? data.action === "time_out" ? "checked-out" : "verified" :
                    data.wrong_event ? "wrong-event" :
                    data.action === "completed" ? "complete" :
                    data.action === "duplicate" ? "duplicate" :
                        data.attendee ? "cancelled" : "invalid",
                data,
                message: data.message
            });
            if (data.success) {
                getAdminAttendance(eventId).then((attendance) => setAttendanceCount(attendance.summary?.currently_present || 0)).catch(() => {});
            }
        } catch (error) {
            setResult({
                kind: "invalid",
                message: error.message || "This QR code could not be verified."
            });
        } finally {
            setVerifying(false);
        }
    }

    async function recordManualAttendance(match) {
        setVerifying(true);
        try {
            const data = await apiRequest("/admin/attendance/manual", {
                method: "POST", credentials: "include",
                body: JSON.stringify({ event_id: Number(eventId), participant_type: match.participant_type, registration_id: match.registration_id, user_id: match.user_id })
            });
            setResult({ kind: data.success ? data.action === "time_out" ? "checked-out" : "verified" : data.action === "completed" ? "complete" : "duplicate", data, message: data.message });
            if (data.success) getAdminAttendance(eventId).then((attendance) => setAttendanceCount(attendance.summary?.currently_present || 0)).catch(() => {});
        } catch (error) {
            setResult({ kind: "invalid", message: error.message || "Manual attendance could not be recorded." });
        } finally { setVerifying(false); }
    }

    async function handleManualSubmit(event) {
        event.preventDefault();
        if (!eventId || memberQuery.trim().length < 2) return;
        setSearchingMembers(true);
        setMemberMatches([]);
        try {
            const data = await apiRequest(`/admin/attendance/lookup?event_id=${encodeURIComponent(eventId)}&q=${encodeURIComponent(memberQuery.trim())}`, { credentials: "include" });
            setMemberMatches(data.matches || []);
        } catch (error) {
            setResult({ kind: "invalid", message: error.message || "Member lookup failed." });
        } finally { setSearchingMembers(false); }
    }

    const resultTitle = result?.kind === "verified" ? "Checked in" :
        result?.kind === "checked-out" ? "Checked out" :
        result?.kind === "complete" ? "Already checked out" :
        result?.kind === "wrong-event" ? "Wrong event" :
        result?.kind === "duplicate" ? "Already checked in" :
            result?.kind === "cancelled" ? "Account unavailable" : "QR not verified";

    return (
        <div className="qr-checkin-workspace" aria-live="polite">
            <label className="qr-event-select">Select event before scanning<select required value={eventId} onChange={(event) => setEventId(event.target.value)}><option value="">Choose an event…</option>{events.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}</select><span>Council members use one reusable identity QR. Students agree to participate and then use the QR from that event page. Scanning records attendance; participation is not attendance.</span></label>
            {eventId && <p className="qr-event-attendance-count" role="status">{attendanceCount} attendee{attendanceCount === 1 ? "" : "s"} currently present at this event</p>}
            {verifying ? (
                <section className="qr-verification-pending" role="status">
                    <span className="qr-result-symbol" aria-hidden="true">…</span>
                    <div>
                            <h2>Verifying attendance QR</h2>
                            <p>Checking the account and, for students, confirming the QR matches the selected event before recording the next attendance action.</p>
                    </div>
                </section>
            ) : result ? (
                <section className={`qr-verification-result is-${result.kind}`}>
                    <div className="qr-result-heading">
                        <span className="qr-result-symbol" aria-hidden="true">
                            {result.kind === "verified" || result.kind === "checked-out" ? "✓" : result.kind === "duplicate" ? "!" : "×"}
                        </span>
                        <div>
                            <span>{resultTitle}</span>
                            <h2>{result.data?.attendee?.name || result.message}</h2>
                        </div>
                    </div>

                    {result.data?.attendee && (
                        <div className="qr-result-details">
                            <div>
                                <span>STUDENT ID</span>
                                <strong>{result.data.attendee.student_id}</strong>
                            </div>
                            <div>
                                <span>EMAIL</span>
                                <strong>{result.data.attendee.email}</strong>
                            </div>
                            {result.data.attendee.contact && <div><span>CONTACT</span><strong>{result.data.attendee.contact}</strong></div>}
                            <div>
                                <span>PROGRAM / YEAR</span>
                                <strong>{[result.data.attendee.course, result.data.attendee.year_level].filter(Boolean).join(" · ") || "—"}</strong>
                            </div>
                            <div>
                                <span>EVENT</span>
                                <strong>{result.data.event?.title}</strong>
                            </div>
                            <div>
                                <span>LOCATION</span>
                                <strong>{result.data.event?.location || "—"}</strong>
                            </div>
                            <div>
                                <span>EVENT START</span>
                                <strong>{formatDateTime(result.data.event?.start_date)}</strong>
                            </div>
                            {result.data.time_in && (
                                <div>
                                    <span>CHECK-IN TIME</span>
                                    <strong>{formatDateTime(result.data.time_in)}</strong>
                                </div>
                            )}
                            <div>
                                <span>PARTICIPANT TYPE</span>
                                <strong>{result.data.participant_type === "council" ? "Council member" : "Student"}</strong>
                            </div>
                            {result.data.attendee.council_position && <div><span>COUNCIL POSITION</span><strong>{result.data.attendee.council_position.replaceAll("_", " ")}</strong></div>}
                            {result.data.time_out && <div><span>CHECK-OUT TIME</span><strong>{formatDateTime(result.data.time_out)}</strong></div>}
                        </div>
                    )}

                    <p className="qr-result-message">{result.message}</p>
                    <button className="admin-primary-action" type="button" onClick={() => {
                        setResult(null);
                        setMemberQuery("");
                        setMemberMatches([]);
                    }}>
                        Scan another QR
                    </button>
                </section>
            ) : (
                <>
                    <CameraScanner onDecoded={verifyAttendanceQr} disabled={!eventId} />
                    <form className="qr-manual-form" onSubmit={handleManualSubmit}>
                        <label htmlFor="member-lookup">Manual member lookup</label>
                        <div>
                            <input
                                id="member-lookup"
                                value={memberQuery}
                                onChange={(event) => setMemberQuery(event.target.value)}
                                placeholder="Name, student ID, or PHINMA email"
                                autoComplete="off"
                                required
                                disabled={!eventId}
                            />
                            <button className="admin-secondary-action" type="submit" disabled={!eventId || searchingMembers}>
                                {searchingMembers ? "Searching…" : "Find member"}
                            </button>
                        </div>
                    </form>
                    {memberMatches.length > 0 && <div className="qr-member-matches" aria-live="polite">{memberMatches.map((member) => <article key={`${member.participant_type}-${member.registration_id || member.user_id}`}><div><strong>{member.name}</strong><span>{member.student_id} · {member.email}</span><small>{member.participant_type === "council" ? member.council_position?.replaceAll("_", " ") || "Council member" : `${member.course || "Student"} · ${member.year_level || "Year not specified"}`}</small></div><button className="admin-primary-action" type="button" disabled={verifying || member.attendance_state === "completed"} onClick={() => recordManualAttendance(member)}>{member.attendance_state === "present" ? "Record check-out" : member.attendance_state === "completed" ? "Attendance complete" : "Record check-in"}</button></article>)}</div>}
                    {!searchingMembers && memberQuery.length >= 2 && memberMatches.length === 0 && !result && <p className="admin-feedback">No student or council account matched this search.</p>}
                </>
            )}
        </div>
    );
}

export default QRScanner;
