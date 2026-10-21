import { useState } from "react";
import { Link } from "react-router-dom";
import AuthLayout from "../components/AuthLayout";
import { apiRequest } from "../services/api";

const initialForm = {
    student_id: "", first_name: "", last_name: "", email: "",
    password: "", confirm_password: "", course: "", year_level: ""
};

function RegisterAccount() {
    const [form, setForm] = useState(initialForm);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState(false);

    function handleChange(event) {
        setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
    }

    async function handleSubmit(event) {
        event.preventDefault();
        setError("");
        if (!/^[^\s@]+@phinmaed\.com$/i.test(form.email.trim())) {
            setError("Use your @phinmaed.com email address.");
            return;
        }
        if (form.password !== form.confirm_password) {
            setError("Passwords do not match.");
            return;
        }
        if (form.password.length < 8) {
            setError("Password must be at least 8 characters.");
            return;
        }

        setLoading(true);
        try {
            const data = await apiRequest("/auth/register", {
                method: "POST",
                body: JSON.stringify({
                    student_id: form.student_id.trim(),
                    first_name: form.first_name.trim(),
                    last_name: form.last_name.trim(),
                    email: form.email.trim().toLowerCase(),
                    password: form.password,
                    course: form.course.trim(),
                    year_level: form.year_level
                })
            });
            if (!data.success) {
                setError(data.message || "We could not create your account. Check the details and try again.");
                return;
            }
            setSuccess(true);
        } catch (requestError) {
            setError(requestError.message || "Unable to connect. Check your connection and try again.");
        } finally {
            setLoading(false);
        }
    }

    return (
        <AuthLayout panelClassName="register-auth-inner">
            <h1>Create your account</h1>
            <p className="login-panel-intro">Use your PHINMA Education email to join campus events.</p>

            {success ? (
                <div className="auth-complete" role="status">
                    <span className="auth-complete-icon" aria-hidden="true">✓</span>
                    <h2>Account created</h2>
                    <p>Your account is ready. Sign in to continue.</p>
                    <Link className="auth-primary-link" to="/login">Go to sign in</Link>
                </div>
            ) : (
                <form className="login-form login-redesign-form register-account-form" onSubmit={handleSubmit}>
                    {error && <p className="form-message is-error" role="alert">{error}</p>}

                    <div className="register-fields-grid">
                        <div className="register-field">
                            <label htmlFor="student_id">Student ID</label>
                            <input name="student_id" id="student_id" placeholder="01-1234-123456" pattern="01-[0-9]{4}-[0-9]{6}" title="Use the format 01-1234-123456." maxLength={14} value={form.student_id} onChange={handleChange} required />
                        </div>
                        <div className="register-field">
                            <label htmlFor="register_email">PHINMA Education email</label>
                            <input type="email" name="email" id="register_email" autoComplete="email" placeholder="name.au@phinmaed.com" pattern="[A-Za-z0-9._%+-]+@phinmaed[.]com" title="Use your @phinmaed.com email address." value={form.email} onChange={handleChange} required />
                        </div>
                        <div className="register-field">
                            <label htmlFor="first_name">First name</label>
                            <input name="first_name" id="first_name" autoComplete="given-name" placeholder="First name" value={form.first_name} onChange={handleChange} required />
                        </div>
                        <div className="register-field">
                            <label htmlFor="last_name">Last name</label>
                            <input name="last_name" id="last_name" autoComplete="family-name" placeholder="Last name" value={form.last_name} onChange={handleChange} required />
                        </div>
                        <div className="register-field">
                            <label htmlFor="course">Course / program</label>
                            <input name="course" id="course" placeholder="e.g. BSIT" value={form.course} onChange={handleChange} required />
                        </div>
                        <div className="register-field">
                            <label htmlFor="year_level">Year level</label>
                            <select name="year_level" id="year_level" value={form.year_level} onChange={handleChange} required>
                                <option value="">Select year</option>
                                <option value="1st Year">1st Year</option>
                                <option value="2nd Year">2nd Year</option>
                                <option value="3rd Year">3rd Year</option>
                                <option value="4th Year">4th Year</option>
                            </select>
                        </div>
                        <div className="register-field">
                            <label htmlFor="register_password">Password</label>
                            <input type="password" name="password" id="register_password" autoComplete="new-password" placeholder="At least 8 characters" minLength={8} value={form.password} onChange={handleChange} required />
                        </div>
                        <div className="register-field">
                            <label htmlFor="confirm_password">Confirm password</label>
                            <input type="password" name="confirm_password" id="confirm_password" autoComplete="new-password" placeholder="Re-enter password" minLength={8} value={form.confirm_password} onChange={handleChange} required />
                        </div>
                    </div>

                    <button type="submit" disabled={loading}>{loading ? "Creating account…" : "Create account"}</button>
                </form>
            )}

            <div className="login-account-prompt">
                <span>Already have an account?</span>
                <Link to="/login">Sign in</Link>
            </div>
        </AuthLayout>
    );
}

export default RegisterAccount;
