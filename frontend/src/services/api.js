const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();
// Production is deployed with the API function on the same Vercel domain.
// Vite proxies local API and upload requests to Express, keeping browser calls same-origin.
export const API_URL = (import.meta.env.DEV ? configuredApiUrl || "/api" : "/api").replace(/\/$/, "");

const BACKEND_URL = API_URL.replace(/\/api\/?$/, "");

export function getEventImageUrl(path) {
    if (typeof path !== "string" || path.trim() === "") {
        return "";
    }

    const imagePath = path.trim();

    if (/^(https?:|blob:|data:)/i.test(imagePath)) {
        return imagePath;
    }

    return `${BACKEND_URL}/${imagePath.replace(/^\/+/, "")}`;
}

export async function apiRequest(path, options = {}) {
    if (!API_URL) {
        const error = new Error("The sign-in API is not configured. Confirm the site is deployed with its /api Vercel Function.");
        error.code = "API_URL_NOT_CONFIGURED";
        throw error;
    }

    const headers = new Headers(options.headers || {});
    const isFormData =
        typeof FormData !== "undefined" &&
        options.body instanceof FormData;

    if (!isFormData && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
    }

    const response = await fetch(`${API_URL}${path}`, {
        ...options,
        headers
    });

    let data;
    try {
        data = await response.json();
    } catch {
        const error = new Error(`The API returned a non-JSON response for ${path} (HTTP ${response.status}). Restart the backend or redeploy it so this endpoint is available.`);
        error.status = response.status;
        error.code = "API_NON_JSON_RESPONSE";
        throw error;
    }

    if (!response.ok) {
        const message = data.message || "Request failed.";
        const error = new Error(message);
        error.status = response.status;
        error.code = data.code;
        error.missingEnvironmentVariables = data.missing_environment_variables;
        error.requestId = data.request_id || response.headers.get("X-Request-ID");
        throw error;
    }

    return data;
}

export async function getUpcomingEvent() {
    return apiRequest("/events/upcoming");
}

export async function getPublicEvents() {
    return apiRequest("/events/list");
}

export async function getPublicEventUpdates() {
    return apiRequest("/events/updates");
}

export async function getPublicAnnouncements() {
    return apiRequest("/announcements/list");
}

export async function getPreviousEvents() {
    return apiRequest("/events/previous");
}

export async function getCommitteeDirectory() {
    return apiRequest("/committees/directory");
}

export async function getEvent(id) {
    return apiRequest(`/events/event?id=${encodeURIComponent(id)}`, { credentials: "include" });
}

export async function getStudentEventQr(eventId) {
    return apiRequest(`/attendance/student-event-qr?event_id=${encodeURIComponent(eventId)}`, { credentials: "include" });
}

export async function respondToStudentEventParticipation(eventId, status) {
    return apiRequest("/participation/student/respond", { method: "POST", credentials: "include", body: JSON.stringify({ event_id: eventId, status }) });
}

export async function getEventHighlights(eventId) {
    return apiRequest(`/events/highlights?event_id=${encodeURIComponent(eventId)}`);
}

export async function getAdminEvents() {
    return apiRequest("/admin/events", {
        credentials: "include"
    });
}

export async function getAdminEvent(id) {
    return apiRequest(`/admin/events/event?id=${encodeURIComponent(id)}`, { credentials: "include" });
}

export async function getAdminDashboard() {
    return apiRequest("/admin/dashboard", { credentials: "include" });
}

export async function createAdminEvent(formData) {
    return apiRequest("/admin/events/create", {
        method: "POST",
        credentials: "include",
        body: formData
    });
}

export async function updateAdminEvent(id, formData) {
    return apiRequest(`/admin/events/update?id=${encodeURIComponent(id)}`, {
        method: "POST",
        credentials: "include",
        body: formData
    });
}

export async function reviewAdminEvent(eventId, decision) {
    return apiRequest("/admin/events/review", { method: "POST", credentials: "include", body: JSON.stringify({ event_id: eventId, decision }) });
}

export async function deleteAdminEvent(id) {
    return apiRequest("/admin/events/delete", {
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ id })
    });
}

export async function retryAdminEventNotifications(eventId) {
    return apiRequest("/admin/events/notifications/retry", { method: "POST", credentials: "include", body: JSON.stringify({ event_id: eventId }) });
}

export async function archiveAdminEvent(id) {
    return apiRequest("/admin/events/archive", {
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ id })
    });
}

export async function getAdminRegistrations() {
    return apiRequest("/admin/registrations", {
        credentials: "include"
    });
}

export async function getAdminEventResponses(eventId = "") {
    const query = eventId ? `?event_id=${encodeURIComponent(eventId)}` : "";
    return apiRequest(`/admin/event-responses${query}`, { credentials: "include" });
}

export async function manageAdminEventResponse(eventId, userId, status) {
    return apiRequest("/admin/event-responses/manage", { method: "POST", credentials: "include", body: JSON.stringify({ event_id: eventId, user_id: userId, status }) });
}

export async function getAdminAttendance(eventId = "", filters = {}) {
    const params = new URLSearchParams();
    if (eventId) params.set("event_id", eventId);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    const query = params.size ? `?${params.toString()}` : "";
    return apiRequest(`/admin/attendance${query}`, { credentials: "include" });
}

export async function getAdminUsers() {
    return apiRequest("/admin/users", {
        credentials: "include"
    });
}

export async function saveCouncilAppointment(userId, councilPosition, councilDepartment = "") {
    return apiRequest("/admin/council/roster", {
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ user_id: userId, council_position: councilPosition, council_department: councilDepartment })
    });
}

export async function saveCommitteeAssignment(userId, committeeAssignment) {
    return apiRequest("/admin/council/committee-assignment", {
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ user_id: userId, committee_assignment: committeeAssignment })
    });
}

export async function getCouncilGovernance(period) {
    const query = period ? `?period=${encodeURIComponent(period)}` : "";
    return apiRequest(`/council/governance${query}`, { credentials: "include" });
}

export async function saveCouncilMeeting(meeting) {
    return apiRequest("/council/meetings/save", { method: "POST", credentials: "include", body: JSON.stringify(meeting) });
}

export async function saveCouncilMinutes(meetingId, minutes, decisions) {
    return apiRequest("/council/meetings/minutes", { method: "POST", credentials: "include", body: JSON.stringify({ meeting_id: meetingId, minutes, decisions }) });
}

export async function reviewCouncilMinutes(meetingId, decision, note) {
    return apiRequest("/council/meetings/review-minutes", { method: "POST", credentials: "include", body: JSON.stringify({ meeting_id: meetingId, decision, note }) });
}

export async function submitCouncilExcuse(meetingId, category, details, evidenceUrl) {
    return apiRequest("/council/meetings/excuse", { method: "POST", credentials: "include", body: JSON.stringify({ meeting_id: meetingId, category, details, evidence_url: evidenceUrl }) });
}

export async function reviewCouncilExcuse(id, status) {
    return apiRequest("/council/meetings/review-excuse", { method: "POST", credentials: "include", body: JSON.stringify({ id, status }) });
}

export async function getCouncilAttendancePass(meetingId) {
    return apiRequest("/council/attendance/pass", { method: "POST", credentials: "include", body: JSON.stringify({ meeting_id: meetingId }) });
}

export async function checkInCouncilMember(qrValue, meetingId) {
    return apiRequest("/council/attendance/checkin", { method: "POST", credentials: "include", body: JSON.stringify({ qr_value: qrValue, meeting_id: meetingId }) });
}

export async function saveCouncilReport(report) {
    return apiRequest("/council/reports/save", { method: "POST", credentials: "include", body: JSON.stringify(report) });
}

export async function reviewCouncilReport(id, decision, note) {
    return apiRequest("/council/reports/review", { method: "POST", credentials: "include", body: JSON.stringify({ id, decision, note }) });
}

export async function saveCouncilInventoryItem(item) {
    return apiRequest("/council/inventory/save", { method: "POST", credentials: "include", body: JSON.stringify(item) });
}

export async function getMyEventResponses() {
    return apiRequest("/participation/mine", { credentials: "include" });
}

export async function respondToEvent(eventId, status) {
    return apiRequest("/participation/respond", { method: "POST", credentials: "include", body: JSON.stringify({ event_id: eventId, status }) });
}

export async function getCommitteeWork(committee) {
    const query = committee ? `?committee=${encodeURIComponent(committee)}` : "";
    return apiRequest(`/admin/committee-work${query}`, { credentials: "include" });
}

export async function saveCommitteeWork(item) {
    return apiRequest("/admin/committee-work/save", { method: "POST", credentials: "include", body: JSON.stringify(item) });
}

export async function deleteCommitteeWork(id) {
    return apiRequest("/admin/committee-work/delete", { method: "POST", credentials: "include", body: JSON.stringify({ id }) });
}

export async function updateCommitteeChecklist(id, label, done) {
    return apiRequest("/admin/committee-work/checklist", { method: "POST", credentials: "include", body: JSON.stringify({ id, label, done }) });
}

export async function getAdminPublicationTasks() {
    return apiRequest("/admin/publication/tasks", { credentials: "include" });
}

export async function getMyPublicationTasks() {
    return apiRequest("/publication/tasks/mine", { credentials: "include" });
}

export async function updateMyPublicationTaskProgress(id, status) {
    return apiRequest("/publication/tasks/progress", { method: "POST", credentials: "include", body: JSON.stringify({ id, status }) });
}

export async function submitPublicationTask(formData) {
    return apiRequest("/publication/tasks/submit", { method: "POST", credentials: "include", body: formData });
}

export async function reviewPublicationTask(id, decision, note = "") {
    return apiRequest("/admin/publication/tasks/review", { method: "POST", credentials: "include", body: JSON.stringify({ id, decision, note }) });
}

export async function recordPublicationPost(id, postedAt = "", publishedUrl = "") {
    return apiRequest("/admin/publication/tasks/post", { method: "POST", credentials: "include", body: JSON.stringify({ id, posted_at: postedAt, published_url: publishedUrl }) });
}

export async function archivePublicationTask(id) {
    return apiRequest("/admin/publication/tasks/archive", { method: "POST", credentials: "include", body: JSON.stringify({ id }) });
}

export async function cancelPublicationTask(id) {
    return apiRequest("/admin/publication/tasks/cancel", { method: "POST", credentials: "include", body: JSON.stringify({ id }) });
}

export async function getMyNotifications() {
    return apiRequest("/notifications", { credentials: "include" });
}

export async function markNotificationRead(id) {
    return apiRequest("/notifications/read", { method: "POST", credentials: "include", body: JSON.stringify({ id }) });
}

export async function markAllNotificationsRead() {
    return apiRequest("/notifications/read-all", { method: "POST", credentials: "include", body: JSON.stringify({}) });
}

export async function getPublicFinancialReports() {
    return apiRequest("/transparency/reports");
}

export async function getAdminFinancialRecords() {
    return apiRequest("/admin/finance", { credentials: "include" });
}

export async function saveAdminFinancialRecord(record) {
    return apiRequest("/admin/finance/save", { method: "POST", credentials: "include", body: JSON.stringify(record) });
}

export async function getAdminHighlights() {
    return apiRequest("/admin/highlights", {
        credentials: "include"
    });
}

export async function getAdminAnnouncements() {
    return apiRequest("/admin/announcements", { credentials: "include" });
}

export async function saveAdminAnnouncement(announcement) {
    return apiRequest("/admin/announcements/save", {
        method: "POST",
        credentials: "include",
        body: JSON.stringify(announcement)
    });
}

export async function archiveAdminAnnouncement(id) {
    return apiRequest("/admin/announcements/archive", {
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ id })
    });
}

export async function createAdminHighlight(highlight) {
    return apiRequest("/admin/highlights/create", {
        method: "POST",
        credentials: "include",
        body: JSON.stringify(highlight)
    });
}

export async function deleteAdminHighlight(id) {
    return apiRequest("/admin/highlights/delete", {
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ id })
    });
}

export async function logoutUser() {
    await apiRequest("/auth/logout", {
        method: "POST",
        credentials: "include"
    });

    localStorage.removeItem("user");
    window.dispatchEvent(new Event("auth-change"));
}

export async function logoutWithAnimation() {
    window.dispatchEvent(new Event("app-logout-start"));
    const animationFinished = new Promise((resolve) => window.setTimeout(resolve, 460));
    try {
        await logoutUser();
    } catch (error) {
        console.error("Logout failed:", error);
        localStorage.removeItem("user");
        window.dispatchEvent(new Event("auth-change"));
    }
    await animationFinished;
}

export async function getCurrentUser() {
    return apiRequest("/auth/me", { credentials: "include" });
}

export async function updateMyProfile(profile) {
    return apiRequest("/profile/update", { method: "POST", credentials: "include", body: profile });
}

export async function getMyClassSchedule(academicPeriod = "") {
    const query = academicPeriod ? `?academic_period=${encodeURIComponent(academicPeriod)}` : "";
    return apiRequest(`/profile/class-schedule${query}`, { credentials: "include" });
}

export async function saveMyClassSchedule(schedule) {
    return apiRequest("/profile/class-schedule", { method: "POST", credentials: "include", body: JSON.stringify(schedule) });
}

export async function getMyAttendance() {
    return apiRequest("/attendance/mine", { credentials: "include" });
}
