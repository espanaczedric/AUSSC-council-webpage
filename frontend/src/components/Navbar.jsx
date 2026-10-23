import { useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";

import { getCurrentUser, getEventImageUrl, logoutWithAnimation } from "../services/api";
import { committeeLabels, getCommitteeWorkspacePath, hasExecutiveAccess } from "../utils/workspaceAccess";
import NotificationCenter from "./NotificationCenter";


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

function NavigationIcon({ name }) {
    const shared = {
        width: 20,
        height: 20,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.8,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": "true"
    };

    const paths = {
        home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9" /><path d="M9 20v-6h6v6" /></>,
        events: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
        updates: <><path d="M4 11v2a2 2 0 0 0 2 2h2l8 5V4l-8 5H6a2 2 0 0 0-2 2Z" /><path d="m8 15 2 6M19 9l2-2M19 15l2 2" /></>,
        committees: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
        transparency: <><path d="M4 19h16" /><path d="M7 15v-4M12 15V5M17 15V9" /><path d="M5 5h2M16 5h3" /></>,
        about: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
        more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>
    };

    return <svg {...shared}>{paths[name]}</svg>;
}

function AccountIcon() {
    return (
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
    );
}


/*
|--------------------------------------------------------------------------
| NAVBAR
|--------------------------------------------------------------------------
*/

function Navbar() {
    const navigate = useNavigate();
    const location = useLocation();

    const [menuOpen, setMenuOpen] = useState(false);
    const [user, setUser] = useState(getStoredUser);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [detailsVisible, setDetailsVisible] = useState(false);
    const [loggingOut, setLoggingOut] = useState(false);
    const [isHidden, setIsHidden] = useState(false);

    const menuButtonRef = useRef(null);
    const navRef = useRef(null);
    const dropdownRef = useRef(null);
    const avatarRef = useRef(null);
    const mobileMoreButtonRef = useRef(null);
    const mobileMoreMenuRef = useRef(null);
    const lastScrollPositionRef = useRef(0);
    const canReceiveNotifications = Boolean(user && (
        hasExecutiveAccess(user) || user.committee_assignment || user.council_position
    ));
    const mobileMoreIsCurrent = !(
        location.pathname === "/" ||
        location.pathname === "/events" ||
        location.pathname.startsWith("/events/") ||
        location.pathname === "/announcements" ||
        location.pathname === "/committees"
    );
    const workspaceLink = hasExecutiveAccess(user)
        ? { to: "/admin", label: "Executive workspace" }
        : user?.committee_assignment
            ? { to: getCommitteeWorkspacePath(user), label: `${committeeLabels[user.committee_assignment]?.replace(" Committee", "") || "Committee"} workspace` }
            : user
                ? { to: "/my-events", label: "My registrations" }
                : null;

    useEffect(() => {
        setMenuOpen(false);
        setDropdownOpen(false);
        setDetailsVisible(false);
    }, [location.pathname]);

    useEffect(() => {
        lastScrollPositionRef.current = window.scrollY;

        function handleScroll() {
            const currentPosition = Math.max(0, window.scrollY);
            const previousPosition = lastScrollPositionRef.current;
            const activeElement = document.activeElement;
            const navigationHasFocus = navRef.current?.contains(activeElement);

            if (window.matchMedia("(max-width: 700px)").matches || menuOpen || dropdownOpen || navigationHasFocus || currentPosition < 36) {
                setIsHidden(false);
            } else if (Math.abs(currentPosition - previousPosition) > 7) {
                setIsHidden(currentPosition > previousPosition && currentPosition > 105);
            }

            lastScrollPositionRef.current = currentPosition;
        }

        window.addEventListener("scroll", handleScroll, { passive: true });
        return () => window.removeEventListener("scroll", handleScroll);
    }, [menuOpen, dropdownOpen]);


    /*
     * Sync user state when auth changes
     * (login / logout from any tab or component)
     */
    useEffect(() => {
        let active = true;

        function syncUser() {
            const cachedUser = getStoredUser();
            setUser(cachedUser);
            if (!cachedUser) return;

            getCurrentUser()
                .then((data) => {
                    if (!active || !data.user) return;
                    localStorage.setItem("user", JSON.stringify(data.user));
                    setUser(data.user);
                })
                .catch((error) => {
                    if (!active || error.status !== 401) return;
                    localStorage.removeItem("user");
                    setUser(null);
                });
        }

        syncUser();
        window.addEventListener("auth-change", syncUser);
        window.addEventListener("storage", syncUser);

        return () => {
            active = false;
            window.removeEventListener("auth-change", syncUser);
            window.removeEventListener("storage", syncUser);
        };
    }, []);


    /*
     * Close mobile menu on Escape
     */
    useEffect(() => {
        if (!menuOpen) return undefined;

        function handlePointerDown(event) {
            if (
                !navRef.current?.contains(event.target) &&
                !mobileMoreMenuRef.current?.contains(event.target) &&
                !mobileMoreButtonRef.current?.contains(event.target) &&
                !menuButtonRef.current?.contains(event.target)
            ) {
                setMenuOpen(false);
                setDropdownOpen(false);
                setDetailsVisible(false);
            }
        }

        function handleKeyDown(event) {
            if (event.key === "Escape") {
                setMenuOpen(false);
                setDropdownOpen(false);
                setDetailsVisible(false);
                if (mobileMoreButtonRef.current && window.matchMedia("(max-width: 700px)").matches) {
                    mobileMoreButtonRef.current.focus();
                } else {
                    menuButtonRef.current?.focus();
                }
            }
        }

        document.addEventListener("pointerdown", handlePointerDown);
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("pointerdown", handlePointerDown);
            document.removeEventListener("keydown", handleKeyDown);
        };
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
        setDropdownOpen(false);
        setDetailsVisible(false);
        setMenuOpen(false);
        await logoutWithAnimation();
        setLoggingOut(false);
        navigate("/");
        window.dispatchEvent(new Event("app-logout-end"));
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
        <>
        <div className="navbar-spacer" aria-hidden="true" />
        <nav ref={navRef} className={`navbar${isHidden ? " is-hidden" : ""}`} aria-label="Main navigation">
            <div className="navbar-container">

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
                onClick={() => {
                    setMenuOpen((open) => !open);
                    setDropdownOpen(false);
                    setDetailsVisible(false);
                }}
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
                <div className="navbar-primary-links">
                    {[
                        { label: "Home", to: "/", icon: "home", end: true },
                        { label: "Events", to: "/events", icon: "events" },
                        { label: "Updates", to: "/announcements", icon: "updates" },
                        { label: "Committees", to: "/committees", icon: "committees" },
                        { label: "Transparency", to: "/transparency", icon: "transparency" },
                        { label: "About", to: "/about", icon: "about" }
                    ].map(({ label, to, icon, end }) => (
                        <NavLink key={to} to={to} end={end} title={label} aria-label={label} onClick={() => setMenuOpen(false)}>
                            <NavigationIcon name={icon} />
                            <span className="navbar-link-label">{label}</span>
                        </NavLink>
                    ))}
                </div>

                <div className="navbar-actions">
                    {workspaceLink && (
                        <NavLink
                            className="navbar-workspace-link"
                            to={workspaceLink.to}
                            aria-label={workspaceLink.label}
                            onClick={() => setMenuOpen(false)}
                        >
                            <span className="navbar-workspace-link-full">{workspaceLink.label}</span>
                            <span className="navbar-workspace-link-compact">
                                {hasExecutiveAccess(user) || user?.committee_assignment ? "Workspace" : user?.council_position ? "Assignment" : "My events"}
                            </span>
                        </NavLink>
                    )}

                {/* ---- LOGIN / AVATAR ---- */}
                    <div className="navbar-user-wrapper">
                        {canReceiveNotifications && <NotificationCenter />}

                        {/* AVATAR BUTTON */}
                        <button
                            ref={avatarRef}
                            type="button"
                            className="navbar-avatar"
                            aria-label={user ? "Account menu" : "Sign in and account options"}
                            aria-expanded={dropdownOpen}
                            aria-haspopup="true"
                            onClick={toggleDropdown}
                        >
                            {user ? <>
                                <span className="navbar-avatar-initials">{getUserInitials(user)}</span>
                                {user.profile_picture && <img className="navbar-avatar-photo" src={getEventImageUrl(user.profile_picture)} alt="" crossOrigin="use-credentials" onError={(event) => event.currentTarget.remove()} />}
                            </> : <AccountIcon />}
                        </button>


                        {/* DROPDOWN POPOVER */}
                        {dropdownOpen && (

                            <div
                                ref={dropdownRef}
                                className="navbar-dropdown"
                                role="dialog"
                                aria-label="Account"
                            >

                                {user ? <>
                                {/* ---- HEADER ---- */}
                                <Link
                                    to="/profile"
                                    className="navbar-dropdown-header navbar-dropdown-profile-link"
                                    aria-label={`Open profile for ${user.first_name || "your"} ${user.last_name || "account"}`}
                                    onClick={() => {
                                        setDropdownOpen(false);
                                        setDetailsVisible(false);
                                        setMenuOpen(false);
                                    }}
                                >
                                    <div className="navbar-dropdown-avatar">
                                        <span className="navbar-dropdown-avatar-initials">{getUserInitials(user)}</span>
                                        {user.profile_picture && <img className="navbar-dropdown-avatar-photo" src={getEventImageUrl(user.profile_picture)} alt="" crossOrigin="use-credentials" onError={(event) => event.currentTarget.remove()} />}
                                    </div>
                                    <div className="navbar-dropdown-name">
                                        <strong>
                                            {user.first_name} {user.last_name}
                                        </strong>
                                        <span>
                                            {user.email}
                                        </span>
                                    </div>
                                    <span className="navbar-dropdown-profile-cta">Profile <span aria-hidden="true">→</span></span>
                                </Link>


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

                                </> : <div className="navbar-account-guest">
                                    <strong>Welcome</strong>
                                    <span>Sign in to manage your registrations.</span>
                                    <Link className="navbar-dropdown-item" to="/login" onClick={() => { setDropdownOpen(false); setMenuOpen(false); }}>Sign in</Link>
                                    <Link className="navbar-dropdown-item" to="/register-account" onClick={() => { setDropdownOpen(false); setMenuOpen(false); }}>Create an account</Link>
                                </div>}

                            </div>

                        )}

                    </div>

            </div>
            </div>

            </div>
        </nav>

        <nav className="public-mobile-dock" aria-label="Main destinations">
            <NavLink to="/" end className="public-mobile-dock-link">
                <NavigationIcon name="home" />
                <span>Home</span>
            </NavLink>
            <NavLink to="/events" className="public-mobile-dock-link">
                <NavigationIcon name="events" />
                <span>Events</span>
            </NavLink>
            <NavLink to="/announcements" className="public-mobile-dock-link">
                <NavigationIcon name="updates" />
                <span>Updates</span>
            </NavLink>
            <NavLink to="/committees" className="public-mobile-dock-link">
                <NavigationIcon name="committees" />
                <span>Committees</span>
            </NavLink>
            <button
                ref={mobileMoreButtonRef}
                className={`public-mobile-dock-link public-mobile-dock-more${menuOpen || mobileMoreIsCurrent ? " is-active" : ""}`}
                type="button"
                aria-label={menuOpen ? "Close more destinations" : "Open more destinations"}
                aria-expanded={menuOpen}
                aria-controls="public-mobile-more-menu"
                onClick={() => {
                    setMenuOpen((open) => !open);
                    setDropdownOpen(false);
                    setDetailsVisible(false);
                }}
            >
                <NavigationIcon name="more" />
                <span>More</span>
            </button>
        </nav>

        {menuOpen && <div className="public-mobile-more-scrim" onClick={() => setMenuOpen(false)}>
            <section
                ref={mobileMoreMenuRef}
                className="public-mobile-more-sheet"
                id="public-mobile-more-menu"
                aria-label="More council destinations"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="public-mobile-more-heading">
                    <div><span>COUNCIL WEBSITE</span><strong>More destinations</strong></div>
                    <button type="button" aria-label="Close more destinations" onClick={() => setMenuOpen(false)}>×</button>
                </div>
                <div className="public-mobile-more-links">
                    <NavLink to="/transparency" onClick={() => setMenuOpen(false)}><NavigationIcon name="transparency" /><span><strong>Transparency</strong><small>Budgets and published reports</small></span><b aria-hidden="true">›</b></NavLink>
                    <NavLink to="/about" onClick={() => setMenuOpen(false)}><NavigationIcon name="about" /><span><strong>About the Council</strong><small>Mission, vision, and mandate</small></span><b aria-hidden="true">›</b></NavLink>
                    {user?.council_position && <NavLink to="/council" onClick={() => setMenuOpen(false)}><NavigationIcon name="committees" /><span><strong>Council governance</strong><small>Meetings, records, and oversight</small></span><b aria-hidden="true">›</b></NavLink>}
                </div>
            </section>
        </div>}
        </>
    );
}

export default Navbar;
