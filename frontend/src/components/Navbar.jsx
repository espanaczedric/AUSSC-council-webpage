import { useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";

import { logoutUser } from "../services/api";


/*
|--------------------------------------------------------------------------
| HELPERS
|--------------------------------------------------------------------------
*/

function getStoredUser() {
    try {
        const raw = localStorage.getItem("user");
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function getUserInitials(user) {
    if (!user) return "";

    const first = (user.first_name || "")[0] || "";
    const last = (user.last_name || "")[0] || "";

    return (first + last).toUpperCase() || "U";
}


/*
|--------------------------------------------------------------------------
| NAVBAR
|--------------------------------------------------------------------------
*/

function Navbar() {
    const navigate = useNavigate();

    const [menuOpen, setMenuOpen] = useState(false);
    const [user, setUser] = useState(getStoredUser);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [detailsVisible, setDetailsVisible] = useState(false);
    const [loggingOut, setLoggingOut] = useState(false);

    const menuButtonRef = useRef(null);
    const dropdownRef = useRef(null);
    const avatarRef = useRef(null);


    /*
     * Sync user state when auth changes
     * (login / logout from any tab or component)
     */
    useEffect(() => {
        function syncUser() {
            setUser(getStoredUser());
        }

        window.addEventListener("auth-change", syncUser);
        window.addEventListener("storage", syncUser);

        return () => {
            window.removeEventListener("auth-change", syncUser);
            window.removeEventListener("storage", syncUser);
        };
    }, []);


    /*
     * Close mobile menu on Escape
     */
    useEffect(() => {
        if (!menuOpen) return undefined;

        function handleKeyDown(event) {
            if (event.key === "Escape") {
                setMenuOpen(false);
                menuButtonRef.current?.focus();
            }
        }

        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [menuOpen]);


    /*
     * Close dropdown when clicking outside or pressing Escape
     */
    useEffect(() => {
        if (!dropdownOpen) return undefined;

        function handleClick(event) {
            if (
                dropdownRef.current &&
                !dropdownRef.current.contains(event.target) &&
                avatarRef.current &&
                !avatarRef.current.contains(event.target)
            ) {
                setDropdownOpen(false);
                setDetailsVisible(false);
            }
        }

        function handleKeyDown(event) {
            if (event.key === "Escape") {
                setDropdownOpen(false);
                setDetailsVisible(false);
                avatarRef.current?.focus();
            }
        }

        document.addEventListener("mousedown", handleClick);
        document.addEventListener("keydown", handleKeyDown);

        return () => {
            document.removeEventListener("mousedown", handleClick);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [dropdownOpen]);


    /*
     * Handle logout
     */
    const handleLogout = useCallback(async () => {
        setLoggingOut(true);

        try {
            await logoutUser();
        } catch (error) {
            console.error("Logout failed:", error);
            localStorage.removeItem("user");
            window.dispatchEvent(new Event("auth-change"));
        }

        setLoggingOut(false);
        setDropdownOpen(false);
        setDetailsVisible(false);
        navigate("/");
    }, [navigate]);


    /*
     * Toggle dropdown
     */
    function toggleDropdown() {
        setDropdownOpen((open) => {
            if (open) setDetailsVisible(false);
            return !open;
        });
    }


    return (
        <nav className="navbar" aria-label="Main navigation">

            {/* ---- LOGO ---- */}
            <div className="navbar-logo">
                <Link to="/" aria-label="Araullo University South Student Council home">
                    <img
                        src="/assets/aussc-header.png"
                        alt="Araullo University South Student Council"
                    />
                </Link>
            </div>


            {/* ---- MOBILE HAMBURGER ---- */}
            <button
                className={`navbar-menu-button${menuOpen ? " is-open" : ""}`}
                ref={menuButtonRef}
                type="button"
                aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
                aria-expanded={menuOpen}
                aria-controls="primary-navigation"
                onClick={() => setMenuOpen((open) => !open)}
            >
                <span />
                <span />
                <span />
            </button>


            {/* ---- NAV LINKS ---- */}
            <div
                className={`navbar-links${menuOpen ? " is-open" : ""}`}
                id="primary-navigation"
            >
                <NavLink to="/" onClick={() => setMenuOpen(false)}>
                    Home
                </NavLink>
                <NavLink to="/events" onClick={() => setMenuOpen(false)}>
                    Events
                </NavLink>
                <NavLink to="/my-events" onClick={() => setMenuOpen(false)}>
                    My Events
                </NavLink>


                {/* ---- LOGIN / AVATAR ---- */}
                {!user ? (

                    <NavLink to="/login" onClick={() => setMenuOpen(false)}>
                        Login
                    </NavLink>

                ) : (

                    <div className="navbar-user-wrapper">

                        {/* AVATAR BUTTON */}
                        <button
                            ref={avatarRef}
                            type="button"
                            className="navbar-avatar"
                            aria-label="Account menu"
                            aria-expanded={dropdownOpen}
                            aria-haspopup="true"
                            onClick={toggleDropdown}
                        >
                            {getUserInitials(user)}
                        </button>


                        {/* DROPDOWN POPOVER */}
                        {dropdownOpen && (

                            <div
                                ref={dropdownRef}
                                className="navbar-dropdown"
                                role="dialog"
                                aria-label="Account"
                            >

                                {/* ---- HEADER ---- */}
                                <div className="navbar-dropdown-header">
                                    <div className="navbar-dropdown-avatar">
                                        {getUserInitials(user)}
                                    </div>
                                    <div className="navbar-dropdown-name">
                                        <strong>
                                            {user.first_name} {user.last_name}
                                        </strong>
                                        <span>
                                            {user.email}
                                        </span>
                                    </div>
                                </div>


                                {/* ---- SEE DETAILS ---- */}
                                <button
                                    type="button"
                                    className="navbar-dropdown-item"
                                    onClick={() => setDetailsVisible((v) => !v)}
                                    aria-expanded={detailsVisible}
                                >
                                    <svg
                                        width="18"
                                        height="18"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        aria-hidden="true"
                                    >
                                        <circle cx="12" cy="8" r="4" />
                                        <path d="M5.5 21a8.38 8.38 0 0 1 13 0" />
                                    </svg>
                                    See Details
                                    <svg
                                        className={`navbar-dropdown-chevron${detailsVisible ? " is-rotated" : ""}`}
                                        width="14"
                                        height="14"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2.5"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        aria-hidden="true"
                                    >
                                        <path d="m6 9 6 6 6-6" />
                                    </svg>
                                </button>


                                {/* ---- USER DETAILS PANEL ---- */}
                                {detailsVisible && (

                                    <div className="navbar-user-details">

                                        <div className="navbar-detail-row">
                                            <span>Student ID</span>
                                            <strong>{user.student_id}</strong>
                                        </div>

                                        <div className="navbar-detail-row">
                                            <span>First Name</span>
                                            <strong>{user.first_name}</strong>
                                        </div>

                                        <div className="navbar-detail-row">
                                            <span>Last Name</span>
                                            <strong>{user.last_name}</strong>
                                        </div>

                                        <div className="navbar-detail-row">
                                            <span>Email</span>
                                            <strong>{user.email}</strong>
                                        </div>

                                        <div className="navbar-detail-row">
                                            <span>Course</span>
                                            <strong>{user.course || "—"}</strong>
                                        </div>

                                        <div className="navbar-detail-row">
                                            <span>Year Level</span>
                                            <strong>{user.year_level || "—"}</strong>
                                        </div>

                                        <div className="navbar-detail-row">
                                            <span>Role</span>
                                            <strong className="navbar-detail-role">
                                                {user.role}
                                            </strong>
                                        </div>

                                    </div>

                                )}


                                {/* ---- DIVIDER ---- */}
                                <div className="navbar-dropdown-divider" />


                                {/* ---- LOG OUT ---- */}
                                <button
                                    type="button"
                                    className="navbar-dropdown-item is-logout"
                                    onClick={handleLogout}
                                    disabled={loggingOut}
                                >
                                    <svg
                                        width="18"
                                        height="18"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        aria-hidden="true"
                                    >
                                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                                        <polyline points="16 17 21 12 16 7" />
                                        <line x1="21" y1="12" x2="9" y2="12" />
                                    </svg>
                                    {loggingOut ? "Signing out…" : "Log Out"}
                                </button>

                            </div>

                        )}

                    </div>

                )}

            </div>

        </nav>
    );
}

export default Navbar;