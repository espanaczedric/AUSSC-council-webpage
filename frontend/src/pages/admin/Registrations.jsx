import { useEffect, useState } from "react";

import AdminNav from "../../components/AdminNav";
import { AdminPageSkeleton, SkeletonBlock, SkeletonPageHeading, SkeletonTable } from "../../components/LoadingSkeletons";
import { getAdminRegistrations } from "../../services/api";

function Registrations() {
    const [registrations, setRegistrations] = useState([]);
    const [registrationCount, setRegistrationCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [query, setQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");

    useEffect(() => {
        getAdminRegistrations()
            .then((data) => {
                setRegistrations(data.registrations || []);
                setRegistrationCount(Number(data.registration_count) || 0);
            })
            .catch((requestError) => setError(requestError.message))
            .finally(() => setLoading(false));
    }, []);

    const filteredRegistrations = registrations.filter((registration) => {
        const matchesStatus = statusFilter === "all" || registration.status === statusFilter;
        const searchText = `${registration.first_name} ${registration.last_name} ${registration.student_id} ${registration.event_title} ${registration.registration_code}`.toLowerCase();
        return matchesStatus && searchText.includes(query.trim().toLowerCase());
    });

    if (loading) return <AdminPageSkeleton>
        <header className="admin-header admin-page-heading"><SkeletonPageHeading /></header>
        <section className="admin-list-section"><div className="admin-list-toolbar"><SkeletonBlock className="ui-skeleton-search" /><SkeletonBlock className="ui-skeleton-filter" /></div><SkeletonTable rows={6} columns={6} /></section>
    </AdminPageSkeleton>;

    return (
        <>
        <AdminNav />
        <main className="admin-page">
            <section className="admin-header">
                <div>
                <span>ATTENDEE OPERATIONS</span>
                <h1>Registrations</h1>
                <p>{registrationCount} active registration{registrationCount === 1 ? "" : "s"}</p>
                </div>
            </section>

            <section className="admin-list-section" aria-label="Manage registrations">
                <div className="admin-list-toolbar">
                    <label className="admin-search-field">
                        <span className="sr-only">Search registrations</span>
                        <input
                            type="search"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Search person, event, or code"
                        />
                    </label>
                    <label className="admin-filter-field">
                        <span className="sr-only">Filter registration status</span>
                        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                            <option value="all">All statuses</option>
                            <option value="registered">Registered</option>
                            <option value="attended">Attended</option>
                            <option value="cancelled">Cancelled</option>
                        </select>
                    </label>
                </div>

                {error && <p className="admin-feedback is-error" role="alert">{error}</p>}
                {filteredRegistrations.length ? (
                    <div className="admin-data-scroll">
                        <table className="admin-data-table">
                            <thead>
                                <tr>
                                    <th scope="col">Attendee</th>
                                    <th scope="col">Student ID</th>
                                    <th scope="col">Event</th>
                                    <th scope="col">Registered</th>
                                    <th scope="col">Status</th>
                                    <th scope="col">Registration code</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredRegistrations.map((registration) => (
                                    <tr key={registration.registration_id}>
                                        <td>
                                            <strong>{registration.first_name} {registration.last_name}</strong>
                                            <small>{registration.email}</small>
                                        </td>
                                        <td>{registration.student_id}</td>
                                        <td>{registration.event_title}</td>
                                        <td>{new Date(registration.registered_at).toLocaleDateString("en-US", {
                                            month: "short",
                                            day: "numeric",
                                            year: "numeric"
                                        })}</td>
                                        <td><span className={`admin-status is-${registration.status}`}>{registration.status}</span></td>
                                        <td><code>{registration.registration_code}</code></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="admin-empty-state">
                        <h2>{registrations.length ? "No matching registrations" : "No registrations yet"}</h2>
                        <p>{registrations.length
                            ? "Try another search or status filter."
                            : "Student sign-ups will appear here."}</p>
                    </div>
                )}
            </section>
        </main>
        </>
    );
}

export default Registrations;
