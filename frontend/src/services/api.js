export const API_URL =
    "http://localhost/university-events/backend/api";

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

    const data = await response.json().catch(() => ({
        success: false,
        message: "Invalid JSON response from the server."
    }));

    if (!response.ok) {
        const message = data.message || "Request failed.";
        throw new Error(message);
    }

    return data;
}

export async function getUpcomingEvent() {
    return apiRequest("/events/get-upcoming.php");
}

export async function getPreviousEvents() {
    return apiRequest("/events/get-previous.php");
}

export async function getEvent(id) {
    return apiRequest(`/events/get-event.php?id=${encodeURIComponent(id)}`);
}

export async function getEventHighlights(eventId) {
    return apiRequest(`/events/get-highlights.php?event_id=${encodeURIComponent(eventId)}`);
}

export async function getAdminEvents() {
    return apiRequest("/admin/events/list.php", {
        credentials: "include"
    });
}

export async function createAdminEvent(formData) {
    return apiRequest("/admin/events/create.php", {
        method: "POST",
        credentials: "include",
        body: formData
    });
}

export async function updateAdminEvent(id, formData) {
    return apiRequest(`/admin/events/update.php?id=${encodeURIComponent(id)}`, {
        method: "POST",
        credentials: "include",
        body: formData
    });
}

export async function deleteAdminEvent(id) {
    return apiRequest("/admin/events/delete.php", {
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ id })
    });
}

export async function getAdminRegistrations() {
    return apiRequest("/admin/registrations/list.php", {
        credentials: "include"
    });
}

export async function getAdminUsers() {
    return apiRequest("/admin/users/list.php", {
        credentials: "include"
    });
}

export async function getAdminHighlights() {
    return apiRequest("/admin/highlights/list.php", {
        credentials: "include"
    });
}

export async function createAdminHighlight(highlight) {
    return apiRequest("/admin/highlights/create.php", {
        method: "POST",
        credentials: "include",
        body: JSON.stringify(highlight)
    });
}

export async function deleteAdminHighlight(id) {
    return apiRequest("/admin/highlights/delete.php", {
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ id })
    });
}

export async function logoutUser() {
    await apiRequest("/auth/logout.php", {
        method: "POST",
        credentials: "include"
    });

    localStorage.removeItem("user");
    window.dispatchEvent(new Event("auth-change"));
}