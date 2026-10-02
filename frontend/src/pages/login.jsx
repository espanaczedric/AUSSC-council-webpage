import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { apiRequest } from "../services/api";

function Login() {
    const navigate = useNavigate();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);

    async function handleSubmit(event) {
        event.preventDefault();

        setLoading(true);

        try {
            const data = await apiRequest("/auth/login.php", {
                method: "POST",
                credentials: "include",
                body: JSON.stringify({
                    email: email,
                    password: password
                })
            });

            if (!data.success) {
                alert(data.message);
                return;
            }

            // Save logged-in user
            localStorage.setItem(
                "user",
                JSON.stringify(data.user)
            );

            window.dispatchEvent(
                new Event("auth-change")
            );

            // Redirect based on role
            if (data.user.role === "admin") {
                navigate("/admin");
            } else {
                navigate("/my-events");
            }

        } catch (error) {
            console.error("Login error:", error);

            alert(
                "Unable to connect to the server. Please make sure XAMPP and the PHP backend are running."
            );

        } finally {
            setLoading(false);
        }
    }

    return (
        <main className="login-page">

            <section className="login-container">

                <Link to="/" className="form-back-link">
                    <span aria-hidden="true">←</span>
                    Back to Home
                </Link>

                {/* HEADER */}
                <div className="login-header">

                    <span>
                        UNIVERSITY EVENTS
                    </span>

                    <h1>
                        Welcome Back
                    </h1>

                    <p>
                        Sign in to manage your
                        event registrations.
                    </p>

                </div>


                {/* LOGIN FORM */}
                <form
                    className="login-form"
                    onSubmit={handleSubmit}
                >

                    {/* EMAIL */}
                    <label htmlFor="email">
                        Email
                    </label>

                    <input
                        id="email"
                        type="email"
                        name="email"
                        placeholder="Enter your email"
                        value={email}
                        onChange={(event) =>
                            setEmail(event.target.value)
                        }
                        required
                    />


                    {/* PASSWORD */}
                    <label htmlFor="password">
                        Password
                    </label>

                    <input
                        id="password"
                        type="password"
                        name="password"
                        placeholder="Enter your password"
                        value={password}
                        onChange={(event) =>
                            setPassword(event.target.value)
                        }
                        required
                    />


                    {/* SUBMIT */}
                    <button
                        type="submit"
                        disabled={loading}
                    >
                        {loading
                            ? "Signing in..."
                            : "Sign In"}
                    </button>

                </form>


                {/* REGISTER LINK */}
                <div className="login-footer">

                    <p>
                        Don't have an account?
                    </p>

                    <Link to="/register-account">
                        Create an account
                    </Link>

                </div>

            </section>

        </main>
    );
}

export default Login;