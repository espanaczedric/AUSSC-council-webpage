import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";

import { apiRequest, getCurrentUser } from "../services/api";
import { SkeletonBlock } from "../components/LoadingSkeletons";

function Register() {

    const { id } = useParams();

    const navigate = useNavigate();

    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [message, setMessage] = useState("");

    useEffect(() => {
        let active = true;
        getCurrentUser()
            .then((result) => { if (active) setUser(result.user); })
            .catch(() => { if (active) setUser(null); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, []);


    async function handleSubmit(event) {

        event.preventDefault();

        setSubmitting(true);

        try {

            const data = await apiRequest("/registration/create", {
                method: "POST",
                credentials: "include",
                body: JSON.stringify({
                    event_id: id
                })
            });

            navigate(
                `/registration/${data.registration_code}`
            );

        } catch (error) {
            setMessage(error.message || "Unable to register. Please try again.");

        } finally {
            setSubmitting(false);
        }

    }


    return (

        <main className="registration-page">

            {loading ? <><SkeletonBlock className="ui-skeleton-section-title" /><div className="registration-loading-form" aria-busy="true" aria-hidden="true"><SkeletonBlock className="ui-skeleton-description" /><SkeletonBlock className="ui-skeleton-description is-short" /><SkeletonBlock className="ui-skeleton-button" /></div><span className="sr-only" role="status">Checking your account…</span></> : <h1>Register for Event</h1>}
            {loading ? null : user ? (
            <form onSubmit={handleSubmit}>

                <Link to="/" className="form-back-link">
                    <span aria-hidden="true">←</span>
                    Back to Home
                </Link>

                <p>Registering as <strong>{user.first_name} {user.last_name}</strong> ({user.student_id})</p>
                <p>Your pass will be issued to your signed-in student account.</p>
                {message && <p role="alert">{message}</p>}


                <button
                    type="submit"
                    disabled={submitting}
                >

                    {submitting
                        ? "Registering..."
                        : "Register Now"}

                </button>

            </form>
            ) : <section><p>Sign in with your student account to register and receive your personal QR pass.</p><Link to={`/login?next=${encodeURIComponent(`/register/${id}`)}`}>Sign in to register</Link></section>}

        </main>
    );
}

export default Register;
