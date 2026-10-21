import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";

const links = [
    { label: "Overview", to: "/admin", end: true, icon: "overview" },
    { label: "Events", to: "/admin/events", icon: "events" },
    { label: "Registrations", to: "/admin/registrations", icon: "registrations" },
    { label: "Attendance", to: "/admin/attendance", icon: "attendance" },
    { label: "People", to: "/admin/users", icon: "people" },
    { label: "Highlights", to: "/admin/highlights", icon: "highlights" },
    { label: "Committees", to: "/admin/committees/executive", icon: "people" },
    { label: "Finance", to: "/admin/finance", icon: "overview" }
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
        highlights: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m4 18 5-5 4 4 3-3 4 4" /></>
    };
    return <svg {...common}>{paths[name]}</svg>;
}

export default function AdminNav() {
    const [menuOpen, setMenuOpen] = useState(false);
    const asideRef = useRef(null);
    const toggleRef = useRef(null);
    const location = useLocation();
    const current = links.find((link) => link.end
        ? location.pathname === link.to
        : location.pathname.startsWith(link.to)) || links[0];

    useEffect(() => setMenuOpen(false), [location.pathname]);

    useEffect(() => {
        if (!menuOpen) return undefined;
        function onPointerDown(event) {
            if (!asideRef.current?.contains(event.target) && !toggleRef.current?.contains(event.target)) {
                setMenuOpen(false);
            }
        }
        function onKeyDown(event) {
            if (event.key === "Escape") {
                setMenuOpen(false);
                toggleRef.current?.focus();
            }
        }
        document.addEventListener("pointerdown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("pointerdown", onPointerDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [menuOpen]);

    function closeMenu() {
        setMenuOpen(false);
    }

    return (
        <>
            <div className="admin-shell-spacer" aria-hidden="true" />
            {menuOpen && <button className="admin-sidebar-scrim" type="button" aria-label="Close admin navigation" onClick={closeMenu} />}

            <aside ref={asideRef} className={`admin-sidebar${menuOpen ? " is-open" : ""}`} aria-label="Council workspace">
                <Link className="admin-sidebar-brand" to="/admin" aria-label="Council workspace overview" onClick={closeMenu}>
                    <img src="/assets/aussc-header.png" alt="Araullo University South Student Council" />
                    <span>COUNCIL WORKSPACE</span>
                </Link>

                <span className="admin-sidebar-label">MANAGEMENT</span>
                <nav id="admin-navigation" className="admin-sidebar-nav" aria-label="Admin sections">
                    {links.map((link) => (
                        <NavLink
                            key={link.to}
                            to={link.to}
                            end={link.end}
                            onClick={closeMenu}
                            className={({ isActive }) => `admin-sidebar-link${isActive ? " is-active" : ""}`}
                        >
                            <AdminNavIcon name={link.icon} />
                            <span>{link.label}</span>
                        </NavLink>
                    ))}
                </nav>

                <div className="admin-sidebar-footer">
                    <div className="admin-sidebar-user-mark" aria-hidden="true">A</div>
                    <div className="admin-sidebar-user-copy"><strong>Student Council</strong><span>Admin workspace</span></div>
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
                    <strong>{current.label}</strong>
                </div>
                <Link className="admin-topbar-public-link" to="/">View public site <span aria-hidden="true">↗</span></Link>
            </header>
        </>
    );
}
