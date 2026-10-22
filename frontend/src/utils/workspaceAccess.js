export const committeeLabels = {
    executive: "Executive Committee",
    publication: "Publication Committee",
    program: "Program Committee",
    production: "Production Committee"
};

const executivePositions = new Set([
    "governor",
    "vice_governor",
    "secretary",
    "treasurer",
    "auditor",
    "social_media_manager"
]);

export function hasExecutiveAccess(user) {
    return Boolean(hasExecutiveAppointment(user) || user?.committee_assignment === "executive");
}

export function hasExecutiveAppointment(user) {
    return Boolean(user?.role === "admin" || executivePositions.has(user?.council_position));
}

export function getCommitteeWorkspacePath(user) {
    const committee = user?.committee_assignment;
    return committee && committee !== "executive" && committeeLabels[committee]
        ? `/admin/committees/${committee}`
        : "/admin";
}
