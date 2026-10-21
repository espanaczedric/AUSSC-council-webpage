import {
    BrowserRouter,
    Routes,
    Route
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

// Admin Pages
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminEvents from "./pages/admin/AdminEvents";
import CreateEvent from "./pages/admin/CreateEvent";
import EditEvent from "./pages/admin/EditEvent";
import Registrations from "./pages/admin/Registrations";
import Attendance from "./pages/admin/Attendance";
import QRScannerPage from "./pages/admin/QRScannerPage";
import EventHighlightsManager from "./pages/admin/EventHighlightsManager";
import Users from "./pages/admin/Users";
import CommitteeWorkspace from "./pages/admin/CommitteeWorkspace";
import AdminFinance from "./pages/admin/AdminFinance";

function NotFound() {
    return (
        <main className="not-found-page">
            <span>404 · PAGE NOT FOUND</span>
            <h1>We can’t find that page.</h1>
            <p>The link may be outdated, or the page may have moved.</p>
            <a className="register-button" href="/">Back to home</a>
        </main>
    );
}

function App() {
    return (
        <BrowserRouter>
            <Routes>

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
                <Route path="/council" element={<CouncilGovernance />} />


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
                    element={<AdminDashboard />}
                />

                <Route
                    path="/admin/events"
                    element={<AdminEvents />}
                />

                <Route
                    path="/admin/events/create"
                    element={<CreateEvent />}
                />

                <Route
                    path="/admin/events/:id/edit"
                    element={<EditEvent />}
                />

                <Route
                    path="/admin/registrations"
                    element={<Registrations />}
                />

                <Route
                    path="/admin/attendance"
                    element={<Attendance />}
                />

                <Route
                    path="/admin/attendance/scanner"
                    element={<QRScannerPage />}
                />

                <Route
                    path="/admin/highlights"
                    element={<EventHighlightsManager />}
                />

                <Route
                    path="/admin/users"
                    element={<Users />}
                />

                <Route path="/admin/committees/:committee" element={<CommitteeWorkspace />} />
                <Route path="/admin/finance" element={<AdminFinance />} />

                <Route path="*" element={<NotFound />} />

            </Routes>
        </BrowserRouter>
    );
}

export default App;
