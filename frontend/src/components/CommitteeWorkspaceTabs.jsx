import { NavLink } from "react-router-dom";

const committees = [
    ["executive", "Executive"],
    ["publication", "Publication"],
    ["production", "Production"],
    ["program", "Program"]
];

export default function CommitteeWorkspaceTabs({ activeCommittee }) {
    return (
        <nav className="committee-workspace-tabs" aria-label="Choose committee workspace">
            {committees.map(([committee, label]) => (
                <NavLink
                    key={committee}
                    to={`/admin/committees/${committee}`}
                    className={committee === activeCommittee ? "is-active" : ""}
                    aria-current={committee === activeCommittee ? "page" : undefined}
                >
                    {label}
                </NavLink>
            ))}
        </nav>
    );
}
