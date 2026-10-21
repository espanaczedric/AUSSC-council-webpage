import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import Navbar from "../components/Navbar";
import { getCurrentUser } from "../services/api";

function readStoredUser() {
    try {
        const user = JSON.parse(localStorage.getItem("user") || "null");
        return user && typeof user === "object" ? user : null;
    } catch {
        return null;
    }
}

function initialsFor(user) {
    return `${user?.first_name?.[0] || ""}${user?.last_name?.[0] || ""}`.toUpperCase() || "U";
}

function formatDate(value) {
    if (!value) return "—";
    const date = new Date(typeof value === "string" ? value.replace(" ", "T") : value);
    return Number.isNaN(date.getTime())
        ? value
        : date.toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" });
}

export default function CouncilProfile() {
    const navigate = useNavigate();
    const [user, setUser] = useState(readStoredUser);
    const [loading, setLoading] = useState(true);
    const [connectionNote, setConnectionNote] = useState(false);

    useEffect(() => {
        let active = true;

        if (!readStoredUser()) {
            navigate("/login?next=%2Fprofile", { replace: true });
            setLoading(false);
            return () => { active = false; };
        }

        getCurrentUser()
            .then((data) => {
                if (!active || !data.user) return;
                setUser(data.user);
                localStorage.setItem("user", JSON.stringify(data.user));
                window.dispatchEvent(new Event("auth-change"));
            })
            .catch((error) => {
                if (!active) return;
                if (/sign in|signed in|session/i.test(error.message || "")) {
                    localStorage.removeItem("user");
                    window.dispatchEvent(new Event("auth-change"));
                    navigate("/login?next=%2Fprofile", { replace: true });
                    return;
                }
                setConnectionNote(true);
            })
            .finally(() => { if (active) setLoading(false); });

        return () => { active = false; };
    }, [navigate]);

    if (!user && loading) {
        return <main className="loading" role="status">Loading your profile…</main>;
    }
    if (!user) return null;

    const accountDetails = [
        { label: "Student ID", value: user.student_id || "—" },
        { label: "Email address", value: user.email || "—" },
        { label: "Course / program", value: user.course || "—" },
        { label: "Year level", value: user.year_level || "—" },
        { label: "Account type", value: user.role === "admin" ? "Council administrator" : "Student" },
        { label: "Member since", value: formatDate(user.created_at) }
    ];

    return (
        <>
            <Navbar />
            <main className="council-profile-page page-enter">
                <header className="council-profile-heading">
                    <span className="eyebrow">Araullo University South Student Council</span>
                    <h1>Your profile</h1>
                    <p>View the account details connected to your council portal sign-in.</p>
                </header>

                {connectionNote && (
                    <p className="council-profile-note" role="status">
                        Showing your saved profile details. Reconnect to refresh them from your account.
                    </p>
                )}

                <section className="council-profile-card" aria-label="Account profile">
                    <div className="council-profile-banner" />
                    <div className="council-profile-identity">
                        <div className="council-profile-avatar" aria-hidden="true">{initialsFor(user)}</div>
                        <div className="council-profile-name">
                            <span className="council-profile-role">{user.role === "admin" ? "Council administrator" : "Student account"}</span>
                            <h2>{[user.first_name, user.last_name].filter(Boolean).join(" ") || "Council member"}</h2>
                            <p>{user.email || "Email not available"}</p>
                        </div>
                    </div>

                    <div className="council-profile-details">
                        {accountDetails.map(({ label, value }) => (
                            <div className="council-profile-detail" key={label}>
                                <span>{label}</span>
                                <strong>{value}</strong>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="council-profile-actions" aria-label="Account links">
                    <div>
                        <h2>Stay involved</h2>
                        <p>Keep track of your event registrations and discover what’s happening on campus.</p>
                    </div>
                    <div className="council-profile-links">
                        <Link className="register-button" to={user.role === "admin" ? "/admin" : "/my-events"}>
                            {user.role === "admin" ? "Council workspace" : "My registrations"}
                        </Link>
                        <Link className="council-profile-secondary" to="/events">Browse events <span aria-hidden="true">→</span></Link>
                    </div>
                </section>

                {loading && <p className="council-profile-refresh" role="status">Refreshing account details…</p>}
            </main>
        </>
    );
}
