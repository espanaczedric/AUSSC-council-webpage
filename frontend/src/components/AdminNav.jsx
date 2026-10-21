import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";

function AdminNav() {
    const [menuOpen, setMenuOpen] = useState(false);
    const [isHidden, setIsHidden] = useState(false);
    const navRef = useRef(null);
    const lastScrollPositionRef = useRef(0);
    const location = useLocation();
    const links = [
        { label: "Overview", to: "/admin", end: true },
        { label: "Events", to: "/admin/events" },
        { label: "Registrations", to: "/admin/registrations" },
        { label: "Attendance", to: "/admin/attendance" },
        { label: "People", to: "/admin/users" },
        { label: "Highlights", to: "/admin/highlights" }
    ];

    useEffect(() => {
        setMenuOpen(false);
    }, [location.pathname]);

    useEffect(() => {
        lastScrollPositionRef.current = window.scrollY;
        function handleScroll() {
            const currentPosition = Math.max(0, window.scrollY);
            const previousPosition = lastScrollPositionRef.current;
            const navigationHasFocus = navRef.current?.contains(document.activeElement);

            if (menuOpen || navigationHasFocus || currentPosition < 36) {
                setIsHidden(false);
            } else if (Math.abs(currentPosition - previousPosition) > 7) {
                setIsHidden(currentPosition > previousPosition && currentPosition > 105);
            }
            lastScrollPositionRef.current = currentPosition;
        }
        window.addEventListener("scroll", handleScroll, { passive: true });
        return () => window.removeEventListener("scroll", handleScroll);
    }, [menuOpen]);

    useEffect(() => {
        if (!menuOpen) return undefined;
        function handlePointerDown(event) {
            if (navRef.current && !navRef.current.contains(event.target)) setMenuOpen(false);
        }
        function handleKeyDown(event) {
            if (event.key === "Escape") {
                setMenuOpen(false);
                navRef.current?.querySelector(".admin-menu-toggle")?.focus();
            }
        }
        document.addEventListener("pointerdown", handlePointerDown);
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("pointerdown", handlePointerDown);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [menuOpen]);

    return (
        <>
            <div className="admin-nav-spacer" aria-hidden="true" />
            <header ref={navRef} className={`admin-topbar${isHidden ? " is-hidden" : ""}`}>
                <div className="admin-topbar-inner">
                    <Link className="admin-brand" to="/admin" aria-label="Administration overview">
                        <img src="/assets/aussc-header.png" alt="Araullo University South Student Council" />
                        <span>Workspace</span>
                    </Link>

                    <button
                        className="admin-menu-toggle"
                        type="button"
                        aria-label={menuOpen ? "Close administration navigation" : "Open administration navigation"}
                        aria-expanded={menuOpen}
                        aria-controls="admin-navigation"
                        onClick={() => setMenuOpen((open) => !open)}
                    >
                        <span aria-hidden="true">{menuOpen ? "×" : "☰"}</span>
                        <span>{menuOpen ? "Close" : "Menu"}</span>
                    </button>

                    <nav id="admin-navigation" className={`admin-nav${menuOpen ? " is-open" : ""}`} aria-label="Admin sections">
                        {links.map((link) => (
                            <NavLink
                                key={link.to}
                                to={link.to}
                                end={link.end}
                                onClick={() => setMenuOpen(false)}
                                className={({ isActive }) => `admin-nav-link${isActive ? " is-active" : ""}`}
                            >
                                {link.label}
                            </NavLink>
                        ))}
                        <Link className="admin-view-site admin-view-mobile" to="/" onClick={() => setMenuOpen(false)}>
                            View public site <span aria-hidden="true">↗</span>
                        </Link>
                    </nav>

                    <Link className="admin-view-site admin-view-desktop" to="/">
                        Public site <span aria-hidden="true">↗</span>
                    </Link>
                </div>
            </header>
        </>
    );
}

export default AdminNav;
