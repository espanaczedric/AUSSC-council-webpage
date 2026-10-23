import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import AdminNav from "./AdminNav";
import Navbar from "./Navbar";
import { SkeletonBlock } from "./LoadingSkeletons";
import { getCurrentUser } from "../services/api";
import { committeeLabels, getCommitteeWorkspacePath, hasExecutiveAccess } from "../utils/workspaceAccess";

export default function WorkspaceAccessGuard({ children, committeeRoute = false, councilRoute = false }) {
    const location = useLocation();
    const navigate = useNavigate();
    const { committee } = useParams();
    const routeSegments = location.pathname.split("/").filter(Boolean);
    const routeCommittee = committee || (committeeRoute ? routeSegments[routeSegments.length - 1] : undefined);
    const [state, setState] = useState("checking");
    const [error, setError] = useState("");
    const [attempt, setAttempt] = useState(0);
    let cachedUser = null;
    try { cachedUser = JSON.parse(localStorage.getItem("user") || "null"); } catch { /* Use the generic workspace shell while the session is verified. */ }

    useEffect(() => {
        let active = true;
        let retryTimer;
        let retryCount = 0;
        const retryDelays = [1000, 2000, 4000, 8000, 12000, 12000];
        setState("checking");
        setError("");

        const checkAccess = async () => {
            try {
                const { user } = await getCurrentUser();
                if (!user) throw new Error("Your sign-in session has expired.");
                if (!active) return;
                localStorage.setItem("user", JSON.stringify(user));
                window.dispatchEvent(new Event("auth-change"));

                const executive = hasExecutiveAccess(user);
                const assignedCommittee = user.committee_assignment;
                const committeePath = getCommitteeWorkspacePath(user);

                if (councilRoute) {
                    if (executive || (!assignedCommittee && user.council_position)) {
                        setState("allowed");
                        return;
                    }
                    navigate(assignedCommittee && assignedCommittee !== "executive" ? committeePath : "/", { replace: true });
                    return;
                }

                if (committeeRoute) {
                    if (!committeeLabels[routeCommittee]) {
                        navigate(executive ? "/admin" : committeePath, { replace: true });
                        return;
                    }
                    if (executive || assignedCommittee === routeCommittee) {
                        setState("allowed");
                        return;
                    }
                    navigate(assignedCommittee && assignedCommittee !== "executive" ? committeePath : "/", { replace: true });
                    return;
                }

                if (executive) {
                    setState("allowed");
                    return;
                }
                navigate(assignedCommittee && assignedCommittee !== "executive" ? committeePath : user.council_position ? "/my-events" : "/", { replace: true });
            } catch (requestError) {
                if (!active) return;
                if (requestError.status === 401) {
                    navigate(`/login?next=${encodeURIComponent(location.pathname)}`, { replace: true });
                    return;
                }

                const isDatabaseReconnecting = requestError.code === "DATABASE_UNAVAILABLE" ||
                    requestError.code === "MONGODB_NETWORK_UNAVAILABLE" ||
                    requestError.code === "MONGODB_DNS_UNAVAILABLE" ||
                    requestError.code === "MONGODB_CONNECTION_FAILED";
                if (isDatabaseReconnecting && retryCount < retryDelays.length) {
                    retryTimer = window.setTimeout(checkAccess, retryDelays[retryCount++]);
                    return;
                }

                setError(requestError.message || "We could not verify your workspace access.");
                setState("error");
            }
        };

        void checkAccess();

        return () => {
            active = false;
            window.clearTimeout(retryTimer);
        };
    }, [attempt, committee, routeCommittee, committeeRoute, councilRoute, location.pathname, navigate]);

    if (state === "allowed") return children;
    if (state === "error") {
        return (
            <main className="workspace-access-state" role="alert">
                <span>COUNCIL WORKSPACE</span>
                <h1>Access could not be checked</h1>
                <p>{error}</p>
                <button type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button>
                <Link to="/">Return to the public site</Link>
            </main>
        );
    }
    const usePublicShell = councilRoute && !hasExecutiveAccess(cachedUser);
    return <>
        {usePublicShell ? <Navbar /> : <AdminNav />}
        <main className={`workspace-access-skeleton${usePublicShell ? " is-public" : ""}`} aria-busy="true" aria-hidden="true">
            <div className="workspace-skeleton-heading"><SkeletonBlock className="workspace-skeleton-eyebrow" /><SkeletonBlock className="workspace-skeleton-title" /><SkeletonBlock className="workspace-skeleton-description" /></div>
            <div className="workspace-skeleton-metrics">{Array.from({ length: 4 }, (_, index) => <div key={index}><SkeletonBlock className="workspace-skeleton-label" /><SkeletonBlock className="workspace-skeleton-number" /><SkeletonBlock className="workspace-skeleton-description" /></div>)}</div>
            <div className="workspace-skeleton-panels"><section><SkeletonBlock className="workspace-skeleton-title is-small" /><SkeletonBlock className="workspace-skeleton-description" /><SkeletonBlock className="workspace-skeleton-description" /><SkeletonBlock className="workspace-skeleton-description is-short" /><SkeletonBlock className="workspace-skeleton-description" /></section><section><SkeletonBlock className="workspace-skeleton-title is-small" />{Array.from({ length: 3 }, (_, index) => <div className="workspace-skeleton-item" key={index}><SkeletonBlock className="workspace-skeleton-label" /><SkeletonBlock className="workspace-skeleton-description" /></div>)}</section></div>
        </main>
        <span className="sr-only" role="status" aria-live="polite">Checking workspace permissions…</span>
    </>;
}
