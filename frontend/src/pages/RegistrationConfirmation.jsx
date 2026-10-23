import { useEffect, useState } from "react";
import {
    Link,
    useParams
} from "react-router-dom";

import Navbar from "../components/Navbar";
import { PublicPageSkeleton, SkeletonBlock } from "../components/LoadingSkeletons";
import { apiRequest } from "../services/api";

function attendanceDuration(attendance) {
    if (!attendance?.time_in) return "—";
    if (!attendance.time_out) return "In progress · check-out not recorded";
    const start = new Date(attendance.time_in.replace(" ", "T")).getTime();
    const end = new Date(attendance.time_out.replace(" ", "T")).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end)) return "—";
    const minutes = Math.max(0, Math.round((end - start) / 60000));
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function RegistrationConfirmation() {

    const { code } = useParams();

    const [registration, setRegistration] =
        useState(null);

    const [loading, setLoading] =
        useState(true);
    const [loadError, setLoadError] =
        useState("");

    const [downloading, setDownloading] =
        useState(false);

    const [downloadMessage, setDownloadMessage] =
        useState("");
    async function downloadHistoricalRecord() {
        setDownloading(true);
        setDownloadMessage("");

        try {
            const { jsPDF } = await import("jspdf");
            const pdf = new jsPDF({ unit: "mm", format: "a4" });

            try {
                const logoResponse = await fetch("/assets/aussc-header-pdf.png");
                if (logoResponse.ok) {
                    const logoBlob = await logoResponse.blob();
                    const logoData = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result);
                        reader.onerror = reject;
                        reader.readAsDataURL(logoBlob);
                    });
                    pdf.addImage(logoData, "PNG", 22, 11, 166, 21, undefined, "FAST");
                }
            } catch {
                pdf.setTextColor(22, 16, 65);
                pdf.setFont("helvetica", "bold");
                pdf.setFontSize(15);
                pdf.text("Araullo University South Student Council", 22, 22);
            }

            pdf.setFillColor(245, 190, 21);
            pdf.rect(0, 38, 210, 2, "F");

            pdf.setTextColor(13, 6, 105);
            pdf.setFont("helvetica", "bold");
            pdf.setFontSize(10);
            pdf.text("HISTORICAL EVENT PARTICIPATION RECORD", 22, 52);

            pdf.setTextColor(22, 16, 65);
            pdf.setFontSize(21);
            const titleLines = pdf.splitTextToSize(registration.title, 166);
            pdf.text(titleLines, 22, 64);
            const eventMetaY = 64 + titleLines.length * 8 + 4;

            const startDate = registration.start_date
                ? new Date(registration.start_date.replace(" ", "T"))
                : null;
            const formattedDate = startDate && !Number.isNaN(startDate.getTime())
                ? startDate.toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric"
                })
                : "—";
            const formattedTime = startDate && !Number.isNaN(startDate.getTime())
                ? startDate.toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit"
                })
                : "—";

            pdf.setTextColor(69, 70, 107);
            pdf.setFont("helvetica", "bold");
            pdf.setFontSize(8);
            pdf.text("DATE & TIME", 22, eventMetaY);
            pdf.text("LOCATION", 112, eventMetaY);

            pdf.setTextColor(22, 16, 65);
            pdf.setFont("helvetica", "normal");
            pdf.setFontSize(10);
            pdf.text(`${formattedDate} · ${formattedTime}`, 22, eventMetaY + 6);
            pdf.text(pdf.splitTextToSize(registration.location || "—", 76), 112, eventMetaY + 6);

            const cardY = eventMetaY + 20;
            pdf.setDrawColor(218, 220, 232);
            pdf.setFillColor(255, 255, 255);
            pdf.roundedRect(18, cardY, 174, 96, 2, 2, "FD");

            pdf.setTextColor(69, 70, 107);
            pdf.setFont("helvetica", "bold");
            pdf.setFontSize(8);
            pdf.text("PARTICIPANT", 27, cardY + 13);
            pdf.text("STUDENT ID", 27, cardY + 34);
            pdf.text("EMAIL", 27, cardY + 53);
            pdf.text("PROGRAM / YEAR", 27, cardY + 72);
            pdf.text("CONTACT", 27, cardY + 88);

            pdf.setTextColor(22, 16, 65);
            pdf.setFont("helvetica", "bold");
            pdf.setFontSize(13);
            pdf.text(`${registration.first_name} ${registration.last_name}`, 27, cardY + 20);

            pdf.setFont("helvetica", "normal");
            pdf.setFontSize(10);
            pdf.text(registration.student_id || "—", 27, cardY + 41);
            pdf.text(pdf.splitTextToSize(registration.email || "—", 95), 27, cardY + 60);
            pdf.text(
                [registration.course, registration.year_level].filter(Boolean).join(" · ") || "—",
                27,
                cardY + 79
            );
            pdf.setFontSize(9);
            pdf.text(registration.contact || "—", 27, cardY + 94);

            pdf.setTextColor(13, 6, 105);
            pdf.setFont("helvetica", "bold");
            pdf.setFontSize(9);
            pdf.text("HISTORICAL RECORD", 137, cardY + 20);
            pdf.setFont("helvetica", "normal");
            pdf.setFontSize(8);
            pdf.text(pdf.splitTextToSize("Student attendance QR codes are generated separately for each event.", 48), 137, cardY + 29);

            pdf.setFillColor(22, 16, 65);
            pdf.rect(0, 266, 210, 31, "F");
            pdf.setTextColor(255, 255, 255);
            pdf.setFont("helvetica", "bold");
            pdf.setFontSize(10);
            pdf.text("STUDENT ATTENDANCE QR CODES ARE EVENT-SPECIFIC", 22, 278);
            pdf.setFont("helvetica", "normal");
            pdf.setFontSize(8);
            pdf.text("Generate the QR from the event page. Participation and attendance remain separate.", 22, 286);

            pdf.save(`AUSSC-event-history-${registration.registration_code}.pdf`);
            setDownloadMessage("Historical event record downloaded.");
        } catch (error) {
            console.error("Failed to create historical event record:", error);
            setDownloadMessage("The event record could not be downloaded. Please try again.");
        } finally {
            setDownloading(false);
        }
    }


    useEffect(() => {

        async function loadRegistration() {

            try {

            const data = await apiRequest(`/registration/by-code?code=${encodeURIComponent(code)}`, { credentials: "include" });


                if (data.success) {

                    setRegistration(
                        data.registration
                    );

                } else {
                    setLoadError(data.message || "This historical event record could not be found.");

                }

            } catch (error) {

                console.error(error);
                setLoadError(error.message || "Unable to load this registration. Please try again.");

            } finally {

                setLoading(false);

            }

        }

        loadRegistration();

    }, [code]);


    if (loading) return <PublicPageSkeleton className="confirmation-page registration-loading-skeleton">
        <section className="confirmation-card" aria-hidden="true">
            <div className="confirmation-header"><SkeletonBlock className="ui-skeleton-eyebrow" /><SkeletonBlock className="ui-skeleton-section-title" /><SkeletonBlock className="ui-skeleton-description" /></div>
            <div className="registration-details">{Array.from({ length: 4 }, (_, index) => <div key={index}><SkeletonBlock className="ui-skeleton-eyebrow" /><SkeletonBlock className="ui-skeleton-detail-value" /></div>)}</div>
            <div className="registration-qr"><SkeletonBlock className="ui-skeleton-section-title is-small" /><SkeletonBlock className="ui-skeleton-description" /><SkeletonBlock className="ui-skeleton-qr" /><SkeletonBlock className="ui-skeleton-button" /></div>
        </section>
    </PublicPageSkeleton>;


    if (!registration) {

        return (

            <>
                <Navbar />

                <main className="event-not-found">

                    <h1>Historical Record Not Found</h1>

                    <p role="alert">{loadError || "This historical event record is unavailable or the link is incorrect."}</p>

                    <Link to="/events">
                        Back to Events
                    </Link>

                </main>
            </>

        );

    }


    return (

        <>
            <Navbar />

            <main className="confirmation-page">

                <section className="confirmation-card">

                    <div className="confirmation-header">

                        <span>
                            HISTORICAL STUDENT EVENT RECORD
                        </span>

                        <h1>
                            Past participation record
                        </h1>

                        <p>
                            A saved student event record for
                            <strong>
                                {" "}
                                {registration.title}
                            </strong>
                            {" "}from the former registration workflow. New event attendance is recorded separately.
                        </p>

                    </div>


                    <div className="registration-details">

                        <div>
                            <small>
                                PARTICIPANT
                            </small>

                            <strong>
                                {registration.first_name}
                                {" "}
                                {registration.last_name}
                            </strong>
                        </div>


                        <div>
                            <small>
                                STUDENT ID
                            </small>

                            <strong>
                                {registration.student_id}
                            </strong>
                        </div>


                        <div>
                            <small>
                                EVENT
                            </small>

                            <strong>
                                {registration.title}
                            </strong>
                        </div>


                        <div>
                            <small>
                                LOCATION
                            </small>

                            <strong>
                                {registration.location}
                            </strong>
                        </div>

                        <div>
                            <small>ATTENDANCE</small>
                            <strong>{registration.attendance?.time_out ? "Checked out" : registration.attendance?.time_in ? "Currently checked in" : "Not checked in"}</strong>
                        </div>
                        {registration.attendance?.time_in && <div><small>SESSION DURATION</small><strong>{attendanceDuration(registration.attendance)}</strong></div>}

                        {registration.attendance?.time_in && <div><small>TIME IN</small><strong>{new Date(registration.attendance.time_in.replace(" ", "T")).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}</strong></div>}
                        {registration.attendance?.time_out && <div><small>TIME OUT</small><strong>{new Date(registration.attendance.time_out.replace(" ", "T")).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}</strong></div>}

                    </div>


                    <p className="qr-instruction">

                        This is a historical registration record. Students generate a separate attendance QR from each event page; scanning it records attendance and does not create council participation.

                    </p>


                    <div className="confirmation-actions">

                        <button
                            type="button"
                            className="register-button"
                            onClick={downloadHistoricalRecord}
                            disabled={downloading}
                        >
                            {downloading ? "Preparing record…" : "Download event record"}
                        </button>

                        <Link
                            to="/my-events"
                            className="register-button"
                        >
                            My Events
                        </Link>

                        <Link
                            to="/events"
                            className="details-button"
                        >
                            Browse Events
                        </Link>

                    </div>

                    {downloadMessage && (
                        <p className="download-feedback" role="status">
                            {downloadMessage}
                        </p>
                    )}

                </section>

            </main>
        </>
    );
}

export default RegistrationConfirmation;
