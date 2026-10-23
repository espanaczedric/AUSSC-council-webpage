import { useEffect, useState } from "react";
import {
    BrowserRouter,
    Routes,
    Route,
    Navigate,
    Link,
    useLocation
} from "react-router-dom";

// Public Pages
import Home from "./pages/Home";
import Events from "./pages/Events";
import EventDetailsPage from "./pages/EventDetailsPage";
import Announcements from "./pages/Announcements";
import CommitteeDirectory from "./pages/CommitteeDirectory";
import AboutCouncil from "./pages/AboutCouncil";
import Transparency from "./pages/Transparency";

// Registration
import Register from "./pages/Register";
import RegistrationConfirmation from "./pages/RegistrationConfirmation";
import MyEvents from "./pages/MyEvents";

// Authentication
import Login from "./pages/login";
import RegisterAccount from "./pages/RegisterAccount";
import ForgotPassword from "./pages/ForgotPassword";
import CouncilProfile from "./pages/CouncilProfile";
import CouncilGovernance from "./pages/CouncilGovernance";
import WorkspaceAccessGuard from "./components/WorkspaceAccessGuard";

// Admin Pages
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminEvents from "./pages/admin/AdminEvents";
import CreateEvent from "./pages/admin/CreateEvent";
import EditEvent from "./pages/admin/EditEvent";
import EventResponses from "./pages/admin/EventResponses";
import Attendance from "./pages/admin/Attendance";
import QRScannerPage from "./pages/admin/QRScannerPage";
import EventHighlightsManager from "./pages/admin/EventHighlightsManager";
import AdminAnnouncements from "./pages/admin/AdminAnnouncements";
import Users from "./pages/admin/Users";
import CommitteeWorkspace from "./pages/admin/CommitteeWorkspace";
import AdminFinance from "./pages/admin/AdminFinance";
import PublicationWorkspace from "./pages/admin/PublicationWorkspace";

function NotFound() {
    return (
        <main className="not-found-page">
            <span>404 · PAGE NOT FOUND</span>
            <h1>We can’t find that page.</h1>
            <p>The link may be outdated, or the page may have moved.</p>
            <Link className="register-button" to="/">Back to home</Link>
        </main>
    );
}

function AppRoutes() {
    const location = useLocation();
    const [logoutTransition, setLogoutTransition] = useState(false);

    useEffect(() => {
        const startLogout = () => setLogoutTransition(true);
        const finishLogout = () => setLogoutTransition(false);
        window.addEventListener("app-logout-start", startLogout);
        window.addEventListener("app-logout-end", finishLogout);
        return () => {
            window.removeEventListener("app-logout-start", startLogout);
            window.removeEventListener("app-logout-end", finishLogout);
        };
    }, []);

    return (
        <>
            <div className="app-route-transition" key={location.pathname}>
            <Routes location={location}>

                {/* =========================
                    PUBLIC PAGES
                ========================= */}

                <Route
                    path="/"
                    element={<Home />}
                />

                <Route
                    path="/events"
                    element={<Events />}
                />

                <Route path="/announcements" element={<Announcements />} />
                <Route path="/committees" element={<CommitteeDirectory />} />
                <Route path="/transparency" element={<Transparency />} />
                <Route path="/about" element={<AboutCouncil />} />

                <Route
                    path="/events/:id"
                    element={<EventDetailsPage />}
                />


                {/* =========================
                    AUTHENTICATION
                ========================= */}

                <Route
                    path="/login"
                    element={<Login />}
                />

                <Route
                    path="/register-account"
                    element={<RegisterAccount />}
                />

                <Route
                    path="/forgot-password"
                    element={<ForgotPassword />}
                />

                <Route path="/profile" element={<CouncilProfile />} />
                <Route path="/council" element={<WorkspaceAccessGuard councilRoute><CouncilGovernance /></WorkspaceAccessGuard>} />


                {/* =========================
                    EVENT REGISTRATION
                ========================= */}

                <Route
                    path="/register/:id"
                    element={<Register />}
                />

                <Route
                    path="/registration/:code"
                    element={<RegistrationConfirmation />}
                />

                <Route
                    path="/my-events"
                    element={<MyEvents />}
                />


                {/* =========================
                    ADMIN
                ========================= */}

                <Route
                    path="/admin"
                    element={<WorkspaceAccessGuard><AdminDashboard /></WorkspaceAccessGuard>}
                />

                <Route
                    path="/admin/events"
                    element={<WorkspaceAccessGuard><AdminEvents /></WorkspaceAccessGuard>}
                />

                <Route
                    path="/admin/announcements"
                    element={<WorkspaceAccessGuard><AdminAnnouncements /></WorkspaceAccessGuard>}
                />

                <Route
                    path="/admin/events/create"
                    element={<WorkspaceAccessGuard><CreateEvent /></WorkspaceAccessGuard>}
                />

                <Route
                    path="/admin/events/:id/edit"
                    element={<WorkspaceAccessGuard><EditEvent /></WorkspaceAccessGuard>}
                />

                <Route
                    path="/admin/registrations"
                    element={<WorkspaceAccessGuard><Navigate to="/admin/event-responses" replace /></WorkspaceAccessGuard>}
                />

                <Route
                    path="/admin/event-responses"
                    element={<WorkspaceAccessGuard><EventResponses /></WorkspaceAccessGuard>}
                />

                <Route
                    path="/admin/attendance"
                    element={<WorkspaceAccessGuard><Attendance /></WorkspaceAccessGuard>}
                />

                <Route
                    path="/admin/attendance/scanner"
                    element={<WorkspaceAccessGuard><QRScannerPage /></WorkspaceAccessGuard>}
                />

                <Route
                    path="/admin/highlights"
                    element={<WorkspaceAccessGuard><EventHighlightsManager /></WorkspaceAccessGuard>}
                />

                <Route
                    path="/admin/users"
                    element={<WorkspaceAccessGuard><Users /></WorkspaceAccessGuard>}
                />

                <Route path="/admin/committees/publication" element={<WorkspaceAccessGuard committeeRoute><PublicationWorkspace /></WorkspaceAccessGuard>} />
                <Route path="/admin/committees/:committee" element={<WorkspaceAccessGuard committeeRoute><CommitteeWorkspace /></WorkspaceAccessGuard>} />
                <Route path="/admin/finance" element={<WorkspaceAccessGuard><AdminFinance /></WorkspaceAccessGuard>} />

                <Route path="*" element={<NotFound />} />

            </Routes>
            </div>
            <div className={`logout-transition-overlay${logoutTransition ? " is-active" : ""}`} aria-hidden={!logoutTransition}>
                <div className="logout-transition-card" role="status" aria-live="polite">
                    <span className="logout-transition-mark" aria-hidden="true">A</span>
                    <strong>Signing you out</strong>
                    <span className="logout-transition-track" aria-hidden="true"><i /></span>
                </div>
            </div>
        </>
    );
}

function App() {
    return <BrowserRouter><AppRoutes /></BrowserRouter>;
}

export default App;
