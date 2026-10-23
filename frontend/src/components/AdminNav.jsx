import { useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { committeeLabels, hasExecutiveAccess } from "../utils/workspaceAccess";
import { getEventImageUrl, logoutWithAnimation } from "../services/api";
import NotificationCenter from "./NotificationCenter";

const links = [
    { label: "Overview", to: "/admin", end: true, icon: "overview" },
    { label: "Events", to: "/admin/events", icon: "events" },
    { label: "Announcements", to: "/admin/announcements", icon: "updates" },
    { label: "Participation", to: "/admin/event-responses", icon: "registrations" },
    { label: "Attendance", to: "/admin/attendance", icon: "attendance" },
    { label: "People", to: "/admin/users", icon: "people" },
    { label: "Highlights", to: "/admin/highlights", icon: "highlights" },
    { label: "Committees", to: "/admin/committees/executive", icon: "people" },
    { label: "Finance", to: "/admin/finance", icon: "overview" },
    { label: "Council governance", to: "/council", icon: "events" }
];

function AdminNavIcon({ name }) {
    const common = {
        width: 19,
        height: 19,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.8,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": "true"
    };
    const paths = {
        overview: <><rect x="3" y="3" width="7" height="8" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="15" width="7" height="6" rx="1.5" /></>,
        events: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
        registrations: <><path d="M8 4h10a2 2 0 0 1 2 2v14H6V6a2 2 0 0 1 2-2Z" /><path d="M9 9h7M9 13h7M9 17h4M4 7v13" /></>,
        attendance: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h-3zM20 14v2M17 20h4M20 19v2" /></>,
        people: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 5a3.5 3.5 0 0 1 0 6.8M18 14a5.5 5.5 0 0 1 3.5 5" /></>,
        highlights: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m4 18 5-5 4 4 3-3 4 4" /></>,
        home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9" /><path d="M9 20v-6h6v6" /></>,
        more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
        profile: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
        updates: <><path d="m3 11 18-5-5 16-4-7-9-4Z" /><path d="m12 15 4-5" /><path d="M3 11v6l4-2" /></>
    };
    return <svg {...common}>{paths[name]}</svg>;
}

function initialsFor(user) {
    return `${user?.first_name?.[0] || ""}${user?.last_name?.[0] || ""}`.toUpperCase() || "U";
}

export default function AdminNav() {
    const [menuOpen, setMenuOpen] = useState(false);
    const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
    const asideRef = useRef(null);
    const toggleRef = useRef(null);
    const dockMoreRef = useRef(null);
    const mobileMoreRef = useRef(null);
    const location = useLocation();
    const navigate = useNavigate();
    const [signingOut, setSigningOut] = useState(false);
    const [user, setUser] = useState(() => {
        try { return JSON.parse(localStorage.getItem("user") || "null"); } catch { return null; }
    });
    const syncUser = useCallback(() => {
        try { setUser(JSON.parse(localStorage.getItem("user") || "null")); } catch { setUser(null); }
    }, []);
    useEffect(() => {
        window.addEventListener("auth-change", syncUser);
        return () => window.removeEventListener("auth-change", syncUser);
    }, [syncUser]);

    const isExecutive = hasExecutiveAccess(user);
    const committeeLink = user?.committee_assignment && user.committee_assignment !== "executive"
        ? [{ label: committeeLabels[user.committee_assignment] || "Committee workspace", to: `/admin/committees/${user.committee_assignment}`, icon: "people" }]
        : [];
    const visibleLinks = isExecutive ? links : committeeLink;
    const mobileDockLinks = isExecutive ? [
        { label: "Overview", to: "/admin", end: true, icon: "overview" },
        { label: "Events", to: "/admin/events", icon: "events" },
        { label: "Attendance", to: "/admin/attendance", icon: "attendance" },
        { label: "Committees", to: "/admin/committees/executive", icon: "people", committee: true }
    ] : [
        committeeLink[0] || (user?.council_position ? { label: "Governance", to: "/council", end: true, icon: "people" } : null),
        { label: "My events", to: "/my-events", icon: "events" }
    ].filter(Boolean);
    const mobileMoreLinks = isExecutive
        ? links
            .filter((link) => !mobileDockLinks.some((dockLink) => dockLink.to === link.to))
            .map((link) => ({
                ...link,
                description: {
                    "Participation": "See council members’ intent to help at each event",
                    Announcements: "Write and publish notices for the public site",
                    People: "Council members and account access",
                    Highlights: "Manage published campus highlights",
                    Finance: "Budgets, allocations, and expenses",
                    "Council governance": "Council seats, terms, and oversight"
                }[link.label] || "Open this workspace section"
            }))
            .concat({ label: "My profile", to: "/profile", icon: "profile", description: "View and update your account" })
        : [
            ...(user?.council_position && committeeLink.length
                ? [{ label: "Council governance", to: "/council", icon: "events", description: "Council seats, terms, and oversight" }]
                : []),
            { label: "My profile", to: "/profile", icon: "profile", description: "View and update your account" }
        ];
    const isCommitteeWorkspaceRoute = location.pathname.startsWith("/admin/committees/");
    const current = visibleLinks.find((link) => (link.end
        ? location.pathname === link.to
        : location.pathname.startsWith(link.to)) || (isExecutive && link.label === "Committees" && isCommitteeWorkspaceRoute)) || visibleLinks[0] || links[0];
    const selectedCommittee = isExecutive
        ? location.pathname.match(/^\/admin\/committees\/([^/]+)/)?.[1]
        : null;
    const currentLabel = (selectedCommittee && committeeLabels[selectedCommittee]) || current.label;

    useEffect(() => {
        setMenuOpen(false);
        setMobileMoreOpen(false);
    }, [location.pathname]);

    useEffect(() => {
        if (!menuOpen) return undefined;
        function onPointerDown(event) {
            if (
                !asideRef.current?.contains(event.target) &&
                !toggleRef.current?.contains(event.target) &&
                !dockMoreRef.current?.contains(event.target)
            ) {
                setMenuOpen(false);
            }
        }
        function onKeyDown(event) {
            if (event.key === "Escape") {
                setMenuOpen(false);
                (window.matchMedia("(max-width: 700px)").matches ? dockMoreRef.current : toggleRef.current)?.focus();
            }
        }
        document.addEventListener("pointerdown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("pointerdown", onPointerDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [menuOpen]);

    useEffect(() => {
        if (!mobileMoreOpen) return undefined;
        function onPointerDown(event) {
            if (!mobileMoreRef.current?.contains(event.target) && !dockMoreRef.current?.contains(event.target)) {
                setMobileMoreOpen(false);
            }
        }
        function onKeyDown(event) {
            if (event.key === "Escape") {
                setMobileMoreOpen(false);
                dockMoreRef.current?.focus();
            }
        }
        document.addEventListener("pointerdown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("pointerdown", onPointerDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [mobileMoreOpen]);

    function closeMenu() {
        setMenuOpen(false);
    }

    async function handleSignOut() {
        setSigningOut(true);
        await logoutWithAnimation();
        navigate("/");
        window.dispatchEvent(new Event("app-logout-end"));
    }

    return (
        <>
            <div className="admin-shell-spacer" aria-hidden="true" />
            {menuOpen && <button className="admin-sidebar-scrim" type="button" aria-label="Close admin navigation" onClick={closeMenu} />}

            <aside ref={asideRef} className={`admin-sidebar${menuOpen ? " is-open" : ""}`} aria-label="Council workspace">
                <Link className="admin-sidebar-brand" to={isExecutive ? "/admin" : committeeLink[0]?.to || "/"} aria-label="Council workspace" onClick={closeMenu}>
                    <img src="/assets/aussc-header-light.png" alt="Araullo University South Student Council" />
                    <span>COUNCIL WORKSPACE</span>
                </Link>

                <span className="admin-sidebar-label">MANAGEMENT</span>
                <nav id="admin-navigation" className="admin-sidebar-nav" aria-label="Admin sections">
                    {visibleLinks.map((link) => (
                        <NavLink
                            key={link.to}
                            to={link.to}
                            end={link.end}
                            onClick={closeMenu}
                            className={({ isActive }) => `admin-sidebar-link${!menuOpen && (isActive || (isExecutive && link.label === "Committees" && isCommitteeWorkspaceRoute)) ? " is-active" : ""}`}
                        >
                            <AdminNavIcon name={link.icon} />
                            <span>{link.label}</span>
                        </NavLink>
                    ))}
                </nav>

                <div className="admin-sidebar-footer">
                    <Link to="/profile" className="admin-sidebar-profile" onClick={closeMenu} aria-label="View and edit your profile">
                        <span className="admin-sidebar-user-mark" aria-hidden="true">
                            {user?.profile_picture && <img src={getEventImageUrl(user.profile_picture)} alt="" crossOrigin="use-credentials" onError={(event) => event.currentTarget.remove()} />}
                            <span>{initialsFor(user)}</span>
                        </span>
                        <span className="admin-sidebar-user-copy"><strong>{user?.first_name ? `${user.first_name} ${user.last_name || ""}`.trim() : "Student Council"}</strong><span>{isExecutive ? "Executive workspace" : "Committee workspace"}</span></span>
                    </Link>
                    <Link to="/" className="admin-sidebar-public-link" onClick={closeMenu} aria-label="View public website">
                        <span>Public site</span><span aria-hidden="true">↗</span>
                    </Link>
                </div>
            </aside>

            <header className="admin-shell-topbar">
                <button
                    ref={toggleRef}
                    className="admin-mobile-menu-toggle"
                    type="button"
                    aria-label={menuOpen ? "Close council navigation" : "Open council navigation"}
                    aria-expanded={menuOpen}
                    aria-controls="admin-navigation"
                    onClick={() => setMenuOpen((open) => !open)}
                >
                    <span aria-hidden="true">{menuOpen ? "×" : "☰"}</span>
                </button>
                <div className="admin-topbar-context">
                    <span>COUNCIL WORKSPACE</span>
                    <strong>{currentLabel}</strong>
                </div>
                <div className="admin-topbar-actions">
                    <Link className="admin-topbar-public-link" to="/" aria-label="View public site">
                        <span className="admin-topbar-public-full">View public site</span>
                        <span className="admin-topbar-public-compact">Public site</span>
                        <span aria-hidden="true">↗</span>
                    </Link>
                    {user && <NotificationCenter />}
                    <button className="admin-topbar-logout" type="button" onClick={handleSignOut} disabled={signingOut}>
                        {signingOut ? "Signing out…" : "Sign out"}
                    </button>
                </div>
            </header>

            <nav
                className={`admin-mobile-dock${mobileMoreOpen ? " is-more-open" : ""}`}
                style={{ "--admin-dock-columns": mobileDockLinks.length + 1 }}
                aria-label="Workspace destinations"
            >
                {mobileDockLinks.map((link) => <NavLink
                    key={link.to}
                    to={link.to}
                    end={link.end}
                    className={({ isActive }) => `admin-mobile-dock-link${!mobileMoreOpen && (isActive || (link.committee && isCommitteeWorkspaceRoute)) ? " is-active" : ""}`}
                    onClick={closeMenu}
                >
                    <AdminNavIcon name={link.icon} />
                    <span>{link.label}</span>
                </NavLink>)}
                <button
                    ref={dockMoreRef}
                    type="button"
                    className={`admin-mobile-dock-link admin-mobile-dock-more${mobileMoreOpen ? " is-active" : ""}`}
                    aria-label={mobileMoreOpen ? "Close more workspace destinations" : "Open more workspace destinations"}
                    aria-expanded={mobileMoreOpen}
                    aria-controls="admin-mobile-more-menu"
                    onClick={() => {
                        setMenuOpen(false);
                        setMobileMoreOpen((open) => !open);
                    }}
                >
                    <AdminNavIcon name="more" />
                    <span>More</span>
                </button>
            </nav>

            {mobileMoreOpen && <div className="admin-mobile-more-scrim" onClick={() => setMobileMoreOpen(false)}>
                <section
                    ref={mobileMoreRef}
                    className="admin-mobile-more-sheet"
                    id="admin-mobile-more-menu"
                    role="dialog"
                    aria-modal="true"
                    aria-label="More workspace destinations"
                    onClick={(event) => event.stopPropagation()}
                >
                    <div className="admin-mobile-more-heading">
                        <div><span>COUNCIL WORKSPACE</span><strong>More destinations</strong></div>
                        <button type="button" aria-label="Close more destinations" onClick={() => setMobileMoreOpen(false)}>×</button>
                    </div>
                    <div className="admin-mobile-more-links">
                        {mobileMoreLinks.map((link) => <Link key={link.to} to={link.to} onClick={() => setMobileMoreOpen(false)}>
                            <AdminNavIcon name={link.icon} />
                            <span><strong>{link.label}</strong><small>{link.description}</small></span>
                            <b aria-hidden="true">›</b>
                        </Link>)}
                        {!mobileMoreLinks.length && <p className="admin-mobile-more-empty">No additional workspace destinations are available for this account.</p>}
                    </div>
                </section>
            </div>}
        </>
    );
}
