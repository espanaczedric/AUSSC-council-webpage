import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import AuthLayout from "../components/AuthLayout";
import { apiRequest } from "../services/api";

function Login() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [identifier, setIdentifier] = useState("");
    const [password, setPassword] = useState("");
    const [rememberMe, setRememberMe] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [databaseStatus, setDatabaseStatus] = useState("checking");

    useEffect(() => {
        let active = true;
        async function checkDatabase() {
            try {
                const data = await apiRequest("/health");
                if (active) setDatabaseStatus(data.database === "mongodb" && data.status === "ready" ? "connected" : "unavailable");
            } catch (error) {
                if (active) setDatabaseStatus(error.code === "API_URL_NOT_CONFIGURED" ? "misconfigured" : "unavailable");
            }
        }
        void checkDatabase();
        const interval = window.setInterval(checkDatabase, 15000);
        return () => { active = false; window.clearInterval(interval); };
    }, []);

    async function handleSubmit(event) {
        event.preventDefault();
        const normalizedIdentifier = identifier.trim();
        const isPhinmaEmail = /^[^\s@]+@phinmaed\.com$/i.test(normalizedIdentifier);
        const isStudentId = /^01-\d{4}-\d{6}$/.test(normalizedIdentifier);
        if (!isPhinmaEmail && !isStudentId) {
            setError("Use your @phinmaed.com email or a student ID in 01-1234-123456 format.");
            return;
        }
        setLoading(true);
        setError("");

        try {
            const data = await apiRequest("/auth/login", {
                method: "POST",
                credentials: "include",
                body: JSON.stringify({ email: normalizedIdentifier, password, remember_me: rememberMe })
            });

            if (!data.success) {
                setError(data.message || "Check your email or student ID and password, then try again.");
                return;
            }

            localStorage.setItem("user", JSON.stringify(data.user));
            window.dispatchEvent(new Event("auth-change"));

            const requestedPath = searchParams.get("next");
            const nextPath = requestedPath?.startsWith("/") && !requestedPath.startsWith("//") ? requestedPath : null;
            if (nextPath && data.user.role !== "admin") navigate(nextPath);
            else if (data.user.role === "admin") navigate("/admin");
            else navigate("/my-events");
        } catch (requestError) {
            console.error("Login error:", requestError);
            if (requestError.code === "DATABASE_UNAVAILABLE") setDatabaseStatus("unavailable");
            if (requestError.code === "API_URL_NOT_CONFIGURED") setDatabaseStatus("misconfigured");
            setError(requestError.message || "Unable to connect. Check your connection and try again.");
        } finally {
            setLoading(false);
        }
    }

    return (
        <AuthLayout>
                    <h1>Welcome back</h1>
                    <p className="login-panel-intro">Sign in to continue to your campus events and registrations.</p>
                    <p className={`login-db-status is-${databaseStatus}`} role="status" aria-live="polite">
                        <span aria-hidden="true" />
                        {databaseStatus === "checking" && "Checking sign-in service…"}
                        {databaseStatus === "connected" && "Database responding"}
                        {databaseStatus === "unavailable" && "Sign-in API or database is unavailable."}
                        {databaseStatus === "misconfigured" && "Sign-in API is not configured for this deployment."}
                    </p>

                    <form className="login-form login-redesign-form" onSubmit={handleSubmit}>
                        {error && <p className="form-message is-error" role="alert">{error}</p>}

                        <label htmlFor="login-identifier">Email or student ID</label>
                        <input
                            id="login-identifier"
                            type="text"
                            name="identifier"
                            placeholder="name.au@phinmaed.com or 01-1234-123456"
                            value={identifier}
                            autoComplete="username"
                            onChange={(event) => setIdentifier(event.target.value)}
                            required
                        />

                        <label htmlFor="login-password">Password</label>
                        <div className="login-password-wrap">
                            <input
                                id="login-password"
                                type={showPassword ? "text" : "password"}
                                name="password"
                                placeholder="Enter your password"
                                value={password}
                                autoComplete="current-password"
                                onChange={(event) => setPassword(event.target.value)}
                                required
                            />
                            <button
                                className="login-password-toggle"
                                type="button"
                                aria-label={showPassword ? "Hide password" : "Show password"}
                                aria-pressed={showPassword}
                                onClick={() => setShowPassword((visible) => !visible)}
                            >
                                {showPassword ? (
                                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M9.9 5.2A10.7 10.7 0 0 1 12 5c5.2 0 8.6 5.1 9.5 7-.4.8-1.3 2.1-2.7 3.4M6.2 6.2C3.9 7.7 2.7 10 2.5 12c.4.8 1.5 2.6 3.4 4.2A9.9 9.9 0 0 0 12 19c1.2 0 2.3-.2 3.3-.6" /></svg>
                                ) : (
                                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.4-7 9.5-7 9.5 7 9.5 7-3.4 7-9.5 7-9.5-7-9.5-7Z" /><circle cx="12" cy="12" r="2.5" /></svg>
                                )}
                            </button>
                        </div>

                        <div className="login-form-options">
                            <label className="login-remember">
                                <input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} />
                                <span>Remember me for 30 days</span>
                            </label>
                            <span className="login-help-text">Need help? Contact the Student Council.</span>
                        </div>

                        <button type="submit" disabled={loading}>
                            {loading ? "Signing in…" : "Sign in"}
                        </button>
                    </form>

                    <div className="login-account-prompt">
                        <span>New to the portal?</span>
                        <Link to="/register-account">Create an account</Link>
                    </div>
                    <Link className="login-forgot-link" to="/forgot-password">Forgot password?</Link>
                    <p className="login-terms">By signing in, you agree to use this portal responsibly.</p>
        </AuthLayout>
    );
}

export default Login;
