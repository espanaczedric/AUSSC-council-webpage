import { useEffect, useState } from "react";

import AdminNav from "../../components/AdminNav";
import { getAdminUsers, saveCouncilAppointment } from "../../services/api";

const appointmentOptions = [
    ["", "Not appointed"], ["governor", "Governor"], ["vice_governor", "Vice Governor"],
    ["secretary", "Secretary"], ["treasurer", "Treasurer"], ["auditor", "Auditor"],
    ["social_media_manager", "Social Media Manager"], ["department_representative", "Department Representative"],
    ["advisor", "Advisor"], ["co_advisor", "Co-Advisor"]
];
const departments = ["CAS", "CMA", "CELA", "CIT", "COE", "CCJE", "CAHS"];

function Users() {
    const [users, setUsers] = useState([]);
    const [studentCount, setStudentCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [query, setQuery] = useState("");
    const [roleFilter, setRoleFilter] = useState("all");
    const [appointments, setAppointments] = useState({});
    const [savingAppointment, setSavingAppointment] = useState("");
    const [notice, setNotice] = useState("");

    useEffect(() => {
        getAdminUsers()
            .then((data) => {
                setUsers(data.users || []);
                setAppointments(Object.fromEntries((data.users || []).map((user) => [user.id, { council_position: user.council_position || "", council_department: user.council_department || "" }])));
                setStudentCount(Number(data.student_count) || 0);
            })
            .catch((requestError) => setError(requestError.message))
            .finally(() => setLoading(false));
    }, []);

    const filteredUsers = users.filter((user) => {
        const matchesRole = roleFilter === "all" || user.role === roleFilter;
        const searchText = `${user.first_name} ${user.last_name} ${user.student_id} ${user.email} ${user.course || ""}`.toLowerCase();
        return matchesRole && searchText.includes(query.trim().toLowerCase());
    });

    async function saveAppointment(user) {
        const appointment = appointments[user.id] || { council_position: "", council_department: "" };
        setSavingAppointment(String(user.id)); setError(""); setNotice("");
        try {
            await saveCouncilAppointment(user.id, appointment.council_position, appointment.council_department);
            setUsers((current) => current.map((item) => item.id === user.id ? { ...item, ...appointment } : item));
            setNotice(`Council appointment saved for ${user.first_name} ${user.last_name}.`);
        } catch (requestError) { setError(requestError.message || "Appointment could not be saved."); }
        finally { setSavingAppointment(""); }
    }

    return (
        <>
        <AdminNav />
        <main className="admin-page">
            <section className="admin-header">
                <div>
                <span>ACCOUNT DIRECTORY</span>
                <h1>Users</h1>
                <p>{studentCount} student account{studentCount === 1 ? "" : "s"}</p>
                </div>
            </section>

            <section className="admin-list-section" aria-label="User directory">
                <div className="admin-list-toolbar">
                    <label className="admin-search-field">
                        <span className="sr-only">Search people</span>
                        <input
                            type="search"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Search name, email, or student ID"
                        />
                    </label>
                    <label className="admin-filter-field">
                        <span className="sr-only">Filter by role</span>
                        <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
                            <option value="all">All roles</option>
                            <option value="student">Students</option>
                            <option value="admin">Administrators</option>
                        </select>
                    </label>
                </div>

                {error && <p className="admin-feedback is-error" role="alert">{error}</p>}
                {notice && <p className="admin-feedback" role="status">{notice}</p>}
                {loading ? (
                    <p className="admin-feedback" role="status">Loading accounts…</p>
                ) : filteredUsers.length ? (
                    <div className="admin-data-scroll">
                        <table className="admin-data-table">
                            <thead>
                                <tr>
                                    <th scope="col">Name</th>
                                    <th scope="col">Student ID</th>
                                    <th scope="col">Email</th>
                                    <th scope="col">Program</th>
                                    <th scope="col">Year</th>
                                    <th scope="col">Role</th>
                                    <th scope="col">Council appointment</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredUsers.map((user) => (
                                    <tr key={user.id}>
                                        <td><strong>{user.first_name} {user.last_name}</strong></td>
                                        <td>{user.student_id}</td>
                                        <td>{user.email}</td>
                                        <td>{user.course || "—"}</td>
                                        <td>{user.year_level || "—"}</td>
                                        <td><span className={`admin-status is-${user.role}`}>{user.role}</span></td>
                                        <td className="council-appointment-cell">
                                            <select aria-label={`Council appointment for ${user.first_name} ${user.last_name}`} value={appointments[user.id]?.council_position || ""} onChange={(event) => setAppointments((current) => ({ ...current, [user.id]: { ...current[user.id], council_position: event.target.value, council_department: event.target.value === "department_representative" ? current[user.id]?.council_department || "CAS" : "" } }))}>
                                                {appointmentOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                                            </select>
                                            {appointments[user.id]?.council_position === "department_representative" && <select aria-label={`Department represented by ${user.first_name} ${user.last_name}`} value={appointments[user.id]?.council_department || "CAS"} onChange={(event) => setAppointments((current) => ({ ...current, [user.id]: { ...current[user.id], council_department: event.target.value } }))}>{departments.map((department) => <option key={department}>{department}</option>)}</select>}
                                            <button type="button" className="admin-secondary-action" disabled={savingAppointment === String(user.id)} onClick={() => saveAppointment(user)}>{savingAppointment === String(user.id) ? "Saving…" : "Save"}</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="admin-empty-state">
                        <h2>{users.length ? "No matching accounts" : "No accounts found"}</h2>
                        <p>{users.length
                            ? "Try another search or role filter."
                            : "Accounts created through registration will appear here."}</p>
                    </div>
                )}
            </section>
        </main>
        </>
    );
}

export default Users;
