export const API_URL =
    (import.meta.env.VITE_API_URL || "http://localhost:3000/api").replace(/\/$/, "");

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
    return apiRequest("/events/upcoming");
}

export async function getPublicEvents() {
    return apiRequest("/events/list");
}

export async function getPreviousEvents() {
    return apiRequest("/events/previous");
}

export async function getEvent(id) {
    return apiRequest(`/events/event?id=${encodeURIComponent(id)}`);
}

export async function getEventHighlights(eventId) {
    return apiRequest(`/events/highlights?event_id=${encodeURIComponent(eventId)}`);
}

export async function getAdminEvents() {
    return apiRequest("/admin/events", {
        credentials: "include"
    });
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

export async function deleteAdminEvent(id) {
    return apiRequest("/admin/events/delete", {
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

export async function getAdminUsers() {
    return apiRequest("/admin/users", {
        credentials: "include"
    });
}

export async function getAdminHighlights() {
    return apiRequest("/admin/highlights", {
        credentials: "include"
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

export async function getCurrentUser() {
    return apiRequest("/auth/me", { credentials: "include" });
}
