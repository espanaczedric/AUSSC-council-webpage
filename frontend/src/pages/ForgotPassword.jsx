import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import AuthLayout from "../components/AuthLayout";
import { apiRequest } from "../services/api";

const EMPTY_CODE = ["", "", "", "", "", ""];

function ForgotPassword() {
    const [stage, setStage] = useState("email");
    const [email, setEmail] = useState("");
    const [code, setCode] = useState(EMPTY_CODE);
    const [resetToken, setResetToken] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [resendSeconds, setResendSeconds] = useState(0);
    const codeInputs = useRef([]);

    useEffect(() => {
        if (resendSeconds <= 0) return undefined;
        const interval = window.setInterval(() => setResendSeconds((seconds) => Math.max(0, seconds - 1)), 1000);
        return () => window.clearInterval(interval);
    }, [resendSeconds > 0]);

    async function sendCode(event) {
        event?.preventDefault();
        setError("");
        setNotice("");
        setLoading(true);
        try {
            const result = await apiRequest("/auth/forgot-password/request", {
                method: "POST",
                body: JSON.stringify({ email: email.trim().toLowerCase() })
            });
            setCode(EMPTY_CODE);
            setStage("verify");
            setResendSeconds(60);
            setNotice(result.message || "If an account matches that email, a code will arrive shortly.");
        } catch (requestError) {
            setError(requestError.message || "We could not send a code. Please try again.");
        } finally {
            setLoading(false);
        }
    }

    function changeCode(index, rawValue) {
        const digits = rawValue.replace(/\D/g, "").slice(0, codeInputs.current.length - index);
        if (!digits) {
            setCode((current) => current.map((value, position) => position === index ? "" : value));
            return;
        }
        setCode((current) => current.map((value, position) => {
            const offset = position - index;
            return offset >= 0 && offset < digits.length ? digits[offset] : value;
        }));
        codeInputs.current[Math.min(index + digits.length, 5)]?.focus();
    }

    function pasteCode(event, index) {
        const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
        if (!pasted) return;
        event.preventDefault();
        const digits = [...pasted];
        const next = [...EMPTY_CODE];
        digits.forEach((digit, offset) => { if (index + offset < next.length) next[index + offset] = digit; });
        setCode(next);
        codeInputs.current[Math.min(index + digits.length, 5)]?.focus();
    }

    function handleCodeKeyDown(event, index) {
        if (event.key === "Backspace" && !code[index] && index > 0) codeInputs.current[index - 1]?.focus();
        if (event.key === "ArrowLeft" && index > 0) codeInputs.current[index - 1]?.focus();
        if (event.key === "ArrowRight" && index < 5) codeInputs.current[index + 1]?.focus();
    }

    async function verifyCode(event) {
        event.preventDefault();
        setError("");
        setNotice("");
        setLoading(true);
        try {
            const result = await apiRequest("/auth/forgot-password/verify", {
                method: "POST",
                body: JSON.stringify({ email: email.trim().toLowerCase(), code: code.join("") })
            });
            setResetToken(result.reset_token);
            setStage("password");
        } catch (requestError) {
            setError(requestError.message || "That code is invalid or expired. Check it and try again.");
        } finally {
            setLoading(false);
        }
    }

    async function resetPassword(event) {
        event.preventDefault();
        setError("");
        if (password.length < 8) {
            setError("Your password must be at least 8 characters.");
            return;
        }
        if (password !== confirmPassword) {
            setError("The passwords do not match.");
            return;
        }

        setLoading(true);
        try {
            await apiRequest("/auth/forgot-password/reset", {
                method: "POST",
                body: JSON.stringify({
                    email: email.trim().toLowerCase(),
                    reset_token: resetToken,
                    password
                })
            });
            setStage("done");
        } catch (requestError) {
            setError(requestError.message || "We could not reset your password. Request a new code and try again.");
        } finally {
            setLoading(false);
        }
    }

    return (
        <AuthLayout panelClassName="recovery-auth-inner">
            {stage === "email" && <>
                <h1>Forgot password?</h1>
                <p className="login-panel-intro">Enter your PHINMA Education email and we’ll send you a reset code.</p>
                <form className="login-form login-redesign-form recovery-form" onSubmit={sendCode}>
                    {error && <p className="form-message is-error" role="alert">{error}</p>}
                    <label htmlFor="recovery-email">PHINMA Education email</label>
                    <input id="recovery-email" type="email" autoComplete="email" placeholder="name.au@phinmaed.com" pattern="[A-Za-z0-9._%+-]+@phinmaed[.]com" title="Use your @phinmaed.com email address." value={email} onChange={(event) => setEmail(event.target.value)} required />
                    <button type="submit" disabled={loading}>{loading ? "Sending code…" : "Send verification code"}</button>
                </form>
                <Link className="recovery-back-link" to="/login">Back to sign in</Link>
            </>}

            {stage === "verify" && <>
                <h1>Check your email</h1>
                <p className="login-panel-intro">Enter the six-digit code sent to <strong>{email}</strong>.</p>
                {notice && <p className="form-message is-success" role="status">{notice}</p>}
                <form className="login-form login-redesign-form recovery-form" onSubmit={verifyCode}>
                    {error && <p className="form-message is-error" role="alert">{error}</p>}
                    <label id="otp-label">Verification code</label>
                    <div className="otp-digit-group" role="group" aria-labelledby="otp-label">
                        {code.map((digit, index) => (
                            <input
                                key={index}
                                ref={(element) => { codeInputs.current[index] = element; }}
                                className="otp-digit"
                                type="text"
                                inputMode="numeric"
                                autoComplete={index === 0 ? "one-time-code" : "off"}
                                pattern="[0-9]"
                                maxLength={index === 0 ? 6 : 1}
                                aria-label={`Digit ${index + 1} of 6`}
                                value={digit}
                                onChange={(event) => changeCode(index, event.target.value)}
                                onPaste={(event) => pasteCode(event, index)}
                                onKeyDown={(event) => handleCodeKeyDown(event, index)}
                                required
                            />
                        ))}
                    </div>
                    <button type="submit" disabled={loading || code.some((digit) => !digit)}>{loading ? "Verifying…" : "Verify code"}</button>
                </form>
                <div className="recovery-actions">
                    <button type="button" className="recovery-text-button" onClick={() => sendCode()} disabled={loading || resendSeconds > 0}>{loading ? "Sending…" : resendSeconds > 0 ? `Resend in ${resendSeconds}s` : "Resend code"}</button>
                    <button type="button" className="recovery-text-button" onClick={() => { setStage("email"); setError(""); setNotice(""); }}>Change email</button>
                </div>
            </>}

            {stage === "password" && <>
                <h1>Set a new password</h1>
                <p className="login-panel-intro">Choose a new password for your student account.</p>
                <form className="login-form login-redesign-form recovery-form" onSubmit={resetPassword}>
                    {error && <p className="form-message is-error" role="alert">{error}</p>}
                    <label htmlFor="new-password">New password</label>
                    <input id="new-password" type="password" autoComplete="new-password" placeholder="At least 8 characters" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required />
                    <label htmlFor="confirm-new-password">Confirm new password</label>
                    <input id="confirm-new-password" type="password" autoComplete="new-password" placeholder="Re-enter your password" minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
                    <button type="submit" disabled={loading}>{loading ? "Saving password…" : "Reset password"}</button>
                </form>
                <div className="recovery-actions">
                    <button type="button" className="recovery-text-button" onClick={() => { setStage("email"); setResetToken(""); setCode(EMPTY_CODE); setError(""); }}>Restart recovery</button>
                </div>
            </>}

            {stage === "done" && <div className="auth-complete" role="status">
                <span className="auth-complete-icon" aria-hidden="true">✓</span>
                <h2>Password updated</h2>
                <p>Your password has been reset. You can sign in with your new password.</p>
                <Link className="auth-primary-link" to="/login">Back to sign in</Link>
            </div>}

            {stage !== "done" && <p className="login-terms">Codes expire after 10 minutes and can only be used once.</p>}
        </AuthLayout>
    );
}

export default ForgotPassword;
