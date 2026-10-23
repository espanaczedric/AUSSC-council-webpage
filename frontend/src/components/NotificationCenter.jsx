import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getMyNotifications, markAllNotificationsRead, markNotificationRead } from "../services/api";

function timeLabel(value) {
    if (!value) return "Just now";
    const date = new Date(value.replace?.(" ", "T") || value);
    return Number.isNaN(date.getTime()) ? "Recently" : date.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
}

export default function NotificationCenter() {
    const [open, setOpen] = useState(false);
    const [data, setData] = useState({ notifications: [], unread_count: 0 });
    const [error, setError] = useState("");
    const rootRef = useRef(null);
    const navigate = useNavigate();

    useEffect(() => {
        let active = true;
        const load = () => getMyNotifications().then((next) => { if (active) { setData(next); setError(""); } }).catch((requestError) => { if (active && requestError.status !== 401) setError(requestError.message); });
        load();
        const interval = window.setInterval(load, 60000);
        return () => { active = false; window.clearInterval(interval); };
    }, []);

    useEffect(() => {
        if (!open) return undefined;
        const close = (event) => { if (event.key === "Escape") setOpen(false); else if (event.type === "pointerdown" && !rootRef.current?.contains(event.target)) setOpen(false); };
        document.addEventListener("keydown", close);
        document.addEventListener("pointerdown", close);
        return () => { document.removeEventListener("keydown", close); document.removeEventListener("pointerdown", close); };
    }, [open]);

    async function refreshAfter(action) {
        try { await action(); const next = await getMyNotifications(); setData(next); setError(""); }
        catch (requestError) { setError(requestError.message); }
    }

    async function openNotification(notification) {
        setOpen(false);
        await refreshAfter(() => markNotificationRead(notification.id));
        if (notification.href) navigate(notification.href);
    }

    return <div className="notification-center" ref={rootRef}>
        <button className="notification-trigger" type="button" aria-label={`Notifications${data.unread_count ? `, ${data.unread_count} unread` : ""}`} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
            {data.unread_count > 0 && <span className="notification-badge">{data.unread_count > 99 ? "99+" : data.unread_count}</span>}
        </button>
        {open && <section className="notification-popover" aria-label="Notifications">
            <header><div><span>INBOX</span><strong>Notifications</strong></div><button type="button" disabled={!data.unread_count} onClick={() => refreshAfter(markAllNotificationsRead)}>Mark all read</button></header>
            {error && <p className="notification-error" role="alert">{error}</p>}
            <div className="notification-list">
                {data.notifications.length ? data.notifications.map((notification) => <button key={notification.id} type="button" className={`notification-item${notification.read_at ? " is-read" : " is-unread"}`} onClick={() => openNotification(notification)}>
                    <span className="notification-dot" aria-hidden="true" />
                    <span className="notification-copy"><strong>{notification.title}</strong><span>{notification.message}</span><time>{timeLabel(notification.created_at)}</time></span>
                </button>) : <p className="notification-empty">You’re all caught up.</p>}
            </div>
        </section>}
    </div>;
}
