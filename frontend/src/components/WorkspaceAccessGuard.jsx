import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import { getCurrentUser } from "../services/api";
import { committeeLabels, getCommitteeWorkspacePath, hasExecutiveAccess } from "../utils/workspaceAccess";

export default function WorkspaceAccessGuard({ children, committeeRoute = false, councilRoute = false }) {
    const location = useLocation();
    const navigate = useNavigate();
    const { committee } = useParams();
    const [state, setState] = useState("checking");
    const [error, setError] = useState("");
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let active = true;
        setState("checking");
        setError("");

        getCurrentUser().then(({ user }) => {
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
                if (!committeeLabels[committee]) {
                    navigate(executive ? "/admin" : committeePath, { replace: true });
                    return;
                }
                if (executive || assignedCommittee === committee) {
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
        }).catch((requestError) => {
            if (!active) return;
            if (requestError.status === 401) {
                navigate(`/login?next=${encodeURIComponent(location.pathname)}`, { replace: true });
                return;
            }
            setError(requestError.message || "We could not verify your workspace access.");
            setState("error");
        });

        return () => { active = false; };
    }, [attempt, committee, committeeRoute, councilRoute, location.pathname, navigate]);

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
    return <main className="workspace-access-state" role="status" aria-live="polite">Checking your workspace access…</main>;
}
