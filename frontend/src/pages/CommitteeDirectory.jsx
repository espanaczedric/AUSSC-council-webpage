import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import { SkeletonBlock } from "../components/LoadingSkeletons";
import { getCommitteeDirectory, getEventImageUrl } from "../services/api";

const committees = [
    {
        id: "executive",
        index: "01",
        name: "Executive Committee",
        shortName: "ExeCom",
        focus: "Council leadership and coordination",
        description: "Provides direction for council priorities, coordinates committee work, and represents student concerns across the university.",
        areas: ["Council planning", "Representation", "Committee coordination"]
    },
    {
        id: "production",
        index: "02",
        name: "Production Committee",
        shortName: "Production",
        focus: "Event logistics and technical operations",
        description: "Plans the practical details that help campus events run smoothly, from setup and equipment to event-day operations.",
        areas: ["Event logistics", "Technical setup", "Operations"]
    },
    {
        id: "publication",
        index: "03",
        name: "Publication Committee",
        shortName: "Publication",
        focus: "Creative work and student communications",
        description: "Creates visual materials and shares clear, timely information about council activities with the student community.",
        areas: ["Design and pubmats", "Council communications", "Event coverage"]
    },
    {
        id: "program",
        index: "04",
        name: "Program Committee",
        shortName: "Program",
        focus: "Activities and event experiences",
        description: "Shapes event programs and activities so gatherings feel welcoming, organized, and meaningful for students.",
        areas: ["Program planning", "Event activities", "Run of show"]
    }
];

const councilPositions = {
    governor: "Governor",
    vice_governor: "Vice Governor",
    secretary: "Secretary",
    treasurer: "Treasurer",
    auditor: "Auditor",
    social_media_manager: "Social Media Manager",
    department_representative: "Department Representative",
    advisor: "Advisor",
    co_advisor: "Co-Advisor"
};

function initialsFor(member) {
    return `${member?.first_name?.[0] || ""}${member?.last_name?.[0] || ""}`.toUpperCase() || "A";
}

function memberName(member) {
    return [member?.first_name, member?.last_name].filter(Boolean).join(" ") || "Council member";
}

function memberRole(member, committee) {
    const role = councilPositions[member?.council_position];
    const department = member?.council_position === "department_representative" && member?.council_department
        ? ` · ${member.council_department}`
        : "";
    return role ? `${role}${department}` : `${committee.shortName} member`;
}

function MemberAvatar({ member, size = "" }) {
    const image = getEventImageUrl(member?.profile_picture);
    return (
        <span className={`committee-member-avatar${size ? ` ${size}` : ""}`} aria-hidden="true">
            <span>{initialsFor(member)}</span>
            {image && <img src={image} alt="" onError={(event) => event.currentTarget.remove()} />}
        </span>
    );
}

function CommitteeDirectory() {
    const [query, setQuery] = useState("");
    const [directory, setDirectory] = useState({});
    const [directoryLoading, setDirectoryLoading] = useState(true);
    const [directoryError, setDirectoryError] = useState("");
    const [activeCommitteeId, setActiveCommitteeId] = useState("");
    const [selectedMember, setSelectedMember] = useState(null);
    const dialogRef = useRef(null);
    const dialogCloseRef = useRef(null);

    useEffect(() => {
        let active = true;
        getCommitteeDirectory()
            .then((data) => {
                if (active) setDirectory(data.committees || {});
            })
            .catch((error) => {
                if (active) setDirectoryError(error.message || "Committee members could not be loaded.");
            })
            .finally(() => {
                if (active) setDirectoryLoading(false);
            });
        return () => { active = false; };
    }, []);

    const filtered = useMemo(() => {
        const normalized = query.trim().toLowerCase();
        if (!normalized) return committees;
        return committees.filter((committee) => {
            const memberNames = (directory[committee.id] || []).map(memberName).join(" ");
            return `${committee.name} ${committee.focus} ${committee.description} ${committee.areas.join(" ")} ${memberNames}`
                .toLowerCase()
                .includes(normalized);
        });
    }, [query, directory]);

    const activeCommittee = committees.find((committee) => committee.id === activeCommitteeId);
    const activeMembers = activeCommittee ? directory[activeCommittee.id] || [] : [];

    useEffect(() => {
        if (!activeCommitteeId) return undefined;
        const previousOverflow = document.body.style.overflow;
        const returnFocus = document.activeElement;
        document.body.style.overflow = "hidden";
        const focusFrame = window.requestAnimationFrame(() => dialogCloseRef.current?.focus());

        function handleDialogKeyDown(event) {
            if (event.key === "Escape") {
                event.preventDefault();
                setActiveCommitteeId("");
                setSelectedMember(null);
                return;
            }
            if (event.key !== "Tab" || !dialogRef.current) return;
            const focusable = [...dialogRef.current.querySelectorAll('button:not(:disabled), [tabindex="0"]')];
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current.contains(document.activeElement))) {
                event.preventDefault();
                first.focus();
            }
        }

        document.addEventListener("keydown", handleDialogKeyDown);
        return () => {
            window.cancelAnimationFrame(focusFrame);
            document.body.style.overflow = previousOverflow;
            document.removeEventListener("keydown", handleDialogKeyDown);
            returnFocus?.focus?.();
        };
    }, [activeCommitteeId]);

    function chooseCommittee(id) {
        setActiveCommitteeId((current) => current === id ? "" : id);
        setSelectedMember(null);
    }

    function closeCommitteeDialog() {
        setActiveCommitteeId("");
        setSelectedMember(null);
    }

    function reloadDirectory() {
        setDirectoryLoading(true);
        setDirectoryError("");
        getCommitteeDirectory()
            .then((data) => setDirectory(data.committees || {}))
            .catch((error) => setDirectoryError(error.message || "Committee members could not be loaded."))
            .finally(() => setDirectoryLoading(false));
    }

    return (
        <>
            <Navbar />
            <main className="directory-page page-enter">
                <header className="directory-hero">
                    <span className="eyebrow">How we work</span>
                    <h1>Meet the committees<br />behind campus life.</h1>
                    <p>Four teams bring student ideas to life through leadership, creative work, event planning, and on-the-ground operations.</p>
                    <a href="#committee-list" className="register-button">Explore the directory <span aria-hidden="true">↓</span></a>
                </header>

                <section className="directory-content" id="committee-list" aria-labelledby="directory-title">
                    <div className="directory-heading">
                        <div>
                            <span className="eyebrow">Student Council</span>
                            <h2 id="directory-title">Committee directory</h2>
                        </div>
                        <label className="event-search directory-search">
                            <span className="sr-only">Search committees or members</span>
                            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
                                <circle cx="10.8" cy="10.8" r="6.8" />
                                <path d="m16 16 4.5 4.5" />
                            </svg>
                            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search committees or members" type="search" />
                        </label>
                    </div>

                    {directoryError && <div className="committee-directory-error" role="alert"><span>{directoryError}</span><button type="button" onClick={reloadDirectory}>Try again</button></div>}

                    {filtered.length ? (
                        <div className="directory-grid">
                            {filtered.map((committee, index) => {
                                const selected = activeCommitteeId === committee.id;
                                const count = directory[committee.id]?.length || 0;
                                return (
                                    <article
                                        className={`directory-card committee-directory-card${selected ? " is-selected" : ""}`}
                                        key={committee.id}
                                        style={{ "--stagger": `${index * 65}ms` }}
                                        role="button"
                                        tabIndex={0}
                                        aria-expanded={selected}
                                        aria-controls="committee-roster"
                                        onClick={() => chooseCommittee(committee.id)}
                                        onKeyDown={(event) => {
                                            if (event.key === "Enter" || event.key === " ") {
                                                event.preventDefault();
                                                chooseCommittee(committee.id);
                                            }
                                        }}
                                    >
                                        <span className="directory-card-index">{committee.index}</span>
                                        <p className="directory-card-focus">{committee.focus}</p>
                                        <h3>{committee.name}</h3>
                                        <p className="directory-card-description">{committee.description}</p>
                                        <ul aria-label={`${committee.shortName} areas of work`}>
                                            {committee.areas.map((area) => <li key={area}>{area}</li>)}
                                        </ul>
                                        <span className="committee-card-footer">
                                            <span>{directoryLoading ? <SkeletonBlock className="directory-skeleton-count" /> : `${count} ${count === 1 ? "member" : "members"}`}</span>
                                            <span>{selected ? "Close roster ↑" : "View members →"}</span>
                                        </span>
                                    </article>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="event-browser-empty event-empty-state">
                            <h2>No committee matches</h2>
                            <p>Try a different search term.</p>
                            <button className="text-button" type="button" onClick={() => setQuery("")}>Clear search</button>
                        </div>
                    )}

                    {activeCommittee && (
                        <div className="committee-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeCommitteeDialog(); }}>
                            <section ref={dialogRef} className="directory-roster" id="committee-roster" role="dialog" aria-modal="true" aria-labelledby="committee-roster-title" tabIndex={-1}>
                                <header className="directory-roster-heading">
                                    <div><span className="eyebrow">Committee roster</span><h2 id="committee-roster-title">{activeCommittee.name}</h2><p>{activeCommittee.focus}</p></div>
                                    <button ref={dialogCloseRef} type="button" className="directory-roster-close" data-dialog-close aria-label="Close committee roster" onClick={closeCommitteeDialog}>
                                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
                                    </button>
                                </header>
                                {directoryLoading ? (
                                    <div className="ui-skeleton-modal-roster" role="status" aria-label="Loading assigned members">{Array.from({ length: 4 }, (_, index) => <div className="ui-skeleton-modal-member" key={index}><SkeletonBlock className="ui-skeleton-modal-avatar" /><div className="ui-skeleton-modal-copy"><SkeletonBlock /><SkeletonBlock /></div></div>)}</div>
                                ) : directoryError ? (
                                    <p className="directory-roster-empty">The roster is temporarily unavailable. Please try again.</p>
                                ) : activeMembers.length ? (
                                    <div className="committee-member-grid">
                                        {activeMembers.map((member, index) => (
                                            <button
                                                className={`committee-member-card${selectedMember === member ? " is-selected" : ""}`}
                                                key={`${member.first_name}-${member.last_name}-${index}`}
                                                type="button"
                                                aria-expanded={selectedMember === member}
                                                onClick={() => setSelectedMember((current) => current === member ? null : member)}
                                            >
                                                <MemberAvatar member={member} />
                                                <span className="committee-member-card-copy"><strong>{memberName(member)}</strong><span>{memberRole(member, activeCommittee)}</span></span>
                                                <span className="committee-member-card-arrow" aria-hidden="true">{selectedMember === member ? "−" : "+"}</span>
                                            </button>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="directory-roster-empty">No members have been assigned to this committee yet.</p>
                                )}

                                {selectedMember && (
                                    <article className="committee-public-profile" aria-label={`${memberName(selectedMember)} profile`}>
                                        <div className="committee-public-profile-cover" style={selectedMember.cover_photo ? { backgroundImage: `linear-gradient(90deg,rgba(5,19,35,.25),rgba(5,19,35,.06)),url("${getEventImageUrl(selectedMember.cover_photo)}")` } : undefined} />
                                        <div className="committee-public-profile-body">
                                            <MemberAvatar member={selectedMember} size="is-large" />
                                            <div className="committee-public-profile-copy">
                                                <span className="eyebrow">{activeCommittee.name}</span>
                                                <h3>{memberName(selectedMember)}</h3>
                                                <p>{memberRole(selectedMember, activeCommittee)}</p>
                                            </div>
                                            <button type="button" className="committee-public-profile-close" aria-label="Close member profile" onClick={() => setSelectedMember(null)}>×</button>
                                        </div>
                                        <div className="committee-public-profile-details">
                                            <div><span>Committee</span><strong>{activeCommittee.name}</strong></div>
                                            <div><span>Council role</span><strong>{memberRole(selectedMember, activeCommittee)}</strong></div>
                                        </div>
                                    </article>
                                )}
                            </section>
                        </div>
                    )}
                </section>

                <section className="directory-cta">
                    <div><span className="eyebrow">Get involved</span><h2>Find your next way to take part.</h2></div>
                    <Link to="/events" className="register-button">Explore campus events <span aria-hidden="true">→</span></Link>
                </section>
            </main>
        </>
    );
}

export default CommitteeDirectory;
