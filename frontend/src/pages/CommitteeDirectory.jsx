import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";

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

function CommitteeDirectory() {
    const [query, setQuery] = useState("");
    const filtered = useMemo(() => {
        const normalized = query.trim().toLowerCase();
        if (!normalized) return committees;
        return committees.filter((committee) =>
            `${committee.name} ${committee.focus} ${committee.description} ${committee.areas.join(" ")}`
                .toLowerCase()
                .includes(normalized)
        );
    }, [query]);

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
                            <span className="sr-only">Search committees</span>
                            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
                                <circle cx="10.8" cy="10.8" r="6.8" />
                                <path d="m16 16 4.5 4.5" />
                            </svg>
                            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search committees" type="search" />
                        </label>
                    </div>

                    {filtered.length ? (
                        <div className="directory-grid">
                            {filtered.map((committee, index) => (
                                <article className="directory-card" key={committee.id} style={{ "--stagger": `${index * 65}ms` }}>
                                    <span className="directory-card-index">{committee.index}</span>
                                    <p className="directory-card-focus">{committee.focus}</p>
                                    <h3>{committee.name}</h3>
                                    <p className="directory-card-description">{committee.description}</p>
                                    <ul aria-label={`${committee.shortName} areas of work`}>
                                        {committee.areas.map((area) => <li key={area}>{area}</li>)}
                                    </ul>
                                </article>
                            ))}
                        </div>
                    ) : (
                        <div className="event-browser-empty event-empty-state">
                            <h2>No committee matches</h2>
                            <p>Try a different search term.</p>
                            <button className="text-button" type="button" onClick={() => setQuery("")}>Clear search</button>
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
