import { useEffect, useState } from "react";
import {
    Link,
    useParams
} from "react-router-dom";

import Navbar from "../components/Navbar";
import RegistrationQR from "../components/RegistrationQR";
import { apiRequest } from "../services/api";

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

    async function downloadRegistrationPass() {
        setDownloading(true);
        setDownloadMessage("");

        try {
            const [{ jsPDF }, { default: QRCode }] = await Promise.all([
                import("jspdf"),
                import("qrcode")
            ]);
            const pdf = new jsPDF({ unit: "mm", format: "a4" });
            const qrImage = await QRCode.toDataURL(registration.registration_code, {
                errorCorrectionLevel: "H",
                margin: 1,
                width: 320
            });

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
            pdf.text("EVENT REGISTRATION FORM", 22, 52);

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

            pdf.addImage(qrImage, "PNG", 137, cardY + 9, 45, 45);
            pdf.setTextColor(13, 6, 105);
            pdf.setFont("helvetica", "bold");
            pdf.setFontSize(8);
            pdf.text("REGISTRATION CODE", 136, cardY + 62);
            pdf.setFont("helvetica", "normal");
            pdf.setFontSize(8);
            pdf.text(pdf.splitTextToSize(registration.registration_code, 48), 136, cardY + 68);
            pdf.setFillColor(245, 190, 21);
            pdf.roundedRect(136, cardY + 79, 47, 8, 1, 1, "F");
            pdf.setTextColor(22, 16, 65);
            pdf.setFont("helvetica", "bold");
            pdf.setFontSize(8);
            pdf.text((registration.status || "registered").toUpperCase(), 159.5, cardY + 84.5, { align: "center" });

            pdf.setFillColor(22, 16, 65);
            pdf.rect(0, 266, 210, 31, "F");
            pdf.setTextColor(255, 255, 255);
            pdf.setFont("helvetica", "bold");
            pdf.setFontSize(10);
            pdf.text("PRESENT THIS QR CODE AT EVENT CHECK-IN", 22, 278);
            pdf.setFont("helvetica", "normal");
            pdf.setFontSize(8);
            pdf.text("This pass is valid for the attendee and event listed above.", 22, 286);

            pdf.save(`AUSSC-registration-form-${registration.registration_code}.pdf`);
            setDownloadMessage("Registration form downloaded.");
        } catch (error) {
            console.error("Failed to create registration pass:", error);
            setDownloadMessage("The registration pass could not be downloaded. Please try again.");
        } finally {
            setDownloading(false);
        }
    }


    useEffect(() => {

        async function loadRegistration() {

            try {

                const data = await apiRequest(`/registration/by-code?code=${encodeURIComponent(code)}`, {
                    credentials: "include"
                });


                if (data.success) {

                    setRegistration(
                        data.registration
                    );

                } else {
                    setLoadError(data.message || "This registration could not be found.");

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


    if (loading) {

        return (
            <div className="loading">
                Loading registration...
            </div>
        );

    }


    if (!registration) {

        return (

            <>
                <Navbar />

                <main className="event-not-found">

                    <h1>
                        Registration Not Found
                    </h1>

                    <p role="alert">{loadError || "This registration may have expired or the link is incorrect."}</p>

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
                            REGISTRATION CONFIRMED
                        </span>

                        <h1>
                            You're In!
                        </h1>

                        <p>
                            Your registration for
                            <strong>
                                {" "}
                                {registration.title}
                            </strong>
                            {" "}has been confirmed.
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

                    </div>


                    <RegistrationQR
                        registrationCode={
                            registration.registration_code
                        }
                    />


                    <p className="qr-instruction">

                        Save this QR code and present it
                        at the event entrance for
                        attendance verification.

                    </p>


                    <div className="confirmation-actions">

                        <button
                            type="button"
                            className="register-button"
                            onClick={downloadRegistrationPass}
                            disabled={downloading}
                        >
                            {downloading ? "Preparing form…" : "Download registration form"}
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
