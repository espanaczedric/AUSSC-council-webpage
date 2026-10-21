import { useEffect, useId, useRef, useState } from "react";
import {
    Html5Qrcode,
    Html5QrcodeSupportedFormats
} from "html5-qrcode";

import { apiRequest } from "../services/api";

function CameraScanner({ onDecoded }) {
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
                        decodedRef.current(decodedText);
                    } catch {
                        setCameraError("The camera stopped unexpectedly. Please try again.");
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
        <section className="qr-camera-panel" aria-label="Registration QR camera scanner">
            <div className="qr-camera-heading">
                <div>
                    <span>CAMERA SCANNER</span>
                    <h2>Verify a registration</h2>
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
                        disabled={cameraState === "starting" || cameraState === "checking"}
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
    const [manualCode, setManualCode] = useState("");

    async function verifyRegistration(registrationCode) {
        setVerifying(true);

        try {
            const data = await apiRequest("/attendance/checkin", {
                method: "POST",
                credentials: "include",
                body: JSON.stringify({ registration_code: registrationCode })
            });

            setResult({
                kind: data.success ? "verified" :
                    data.already_checked_in ? "duplicate" :
                        data.attendee ? "cancelled" : "invalid",
                data,
                message: data.message
            });
        } catch (error) {
            setResult({
                kind: "invalid",
                message: error.message || "This QR code could not be verified."
            });
        } finally {
            setVerifying(false);
        }
    }

    function handleManualSubmit(event) {
        event.preventDefault();
        const registrationCode = manualCode.trim();
        if (registrationCode) {
            verifyRegistration(registrationCode);
        }
    }

    const resultTitle = result?.kind === "verified" ? "Checked in" :
        result?.kind === "duplicate" ? "Already checked in" :
            result?.kind === "cancelled" ? "Registration cancelled" : "QR not verified";

    return (
        <div className="qr-checkin-workspace" aria-live="polite">
            {verifying ? (
                <section className="qr-verification-pending" role="status">
                    <span className="qr-result-symbol" aria-hidden="true">…</span>
                    <div>
                        <h2>Verifying registration</h2>
                        <p>Checking the registration and recording attendance.</p>
                    </div>
                </section>
            ) : result ? (
                <section className={`qr-verification-result is-${result.kind}`}>
                    <div className="qr-result-heading">
                        <span className="qr-result-symbol" aria-hidden="true">
                            {result.kind === "verified" ? "✓" : result.kind === "duplicate" ? "!" : "×"}
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
                                <span>REGISTRATION</span>
                                <strong>{result.data.registration_code}</strong>
                            </div>
                        </div>
                    )}

                    <p className="qr-result-message">{result.message}</p>
                    <button className="admin-primary-action" type="button" onClick={() => {
                        setResult(null);
                        setManualCode("");
                    }}>
                        Scan another QR
                    </button>
                </section>
            ) : (
                <>
                    <CameraScanner onDecoded={verifyRegistration} />
                    <form className="qr-manual-form" onSubmit={handleManualSubmit}>
                        <label htmlFor="registration-code">Registration code</label>
                        <div>
                            <input
                                id="registration-code"
                                value={manualCode}
                                onChange={(event) => setManualCode(event.target.value)}
                                placeholder="REG-XXXXXXXXXXXX"
                                autoComplete="off"
                                required
                            />
                            <button className="admin-secondary-action" type="submit">
                                Verify code
                            </button>
                        </div>
                    </form>
                </>
            )}
        </div>
    );
}

export default QRScanner;
