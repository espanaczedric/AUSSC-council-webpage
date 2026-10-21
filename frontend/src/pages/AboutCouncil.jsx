import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";

const principles = [
    { number: "01", title: "Listen first", body: "Student perspectives guide the conversations, priorities, and experiences we bring forward." },
    { number: "02", title: "Work together", body: "Council committees contribute different skills toward shared goals and a more connected campus." },
    { number: "03", title: "Show up", body: "We turn ideas into practical events, useful communication, and service to the student community." }
];

function AboutCouncil() {
    return (
        <>
            <Navbar />
            <main className="about-page page-enter">
                <section className="about-hero">
                    <span className="eyebrow">Araullo University South Student Council</span>
                    <h1>Student leadership<br />with community at its heart.</h1>
                    <p>We represent student voices and help create a campus where people can connect, contribute, and make their ideas matter.</p>
                    <div className="about-actions">
                        <Link className="register-button" to="/committees">Explore our committees <span aria-hidden="true">→</span></Link>
                        <Link className="about-text-link" to="/events">See council events</Link>
                    </div>
                </section>

                <section className="about-purpose">
                    <div className="about-purpose-mark" aria-hidden="true"><span>A</span><i /></div>
                    <div>
                        <span className="eyebrow">Our purpose</span>
                        <h2>A council shaped by the students it serves.</h2>
                        <p>The Student Council is a place for listening, organizing, and acting together. Our work spans student representation, campus events, communications, and the practical details that make shared experiences possible.</p>
                    </div>
                </section>

                <section className="about-principles" aria-labelledby="principles-title">
                    <div className="about-section-heading">
                        <span className="eyebrow">The way we work</span>
                        <h2 id="principles-title">Small principles.<br />Meaningful work.</h2>
                    </div>
                    <div className="principle-list">
                        {principles.map((principle) => (
                            <article key={principle.number}>
                                <span>{principle.number}</span>
                                <div><h3>{principle.title}</h3><p>{principle.body}</p></div>
                            </article>
                        ))}
                    </div>
                </section>

                <section className="about-bottom-cta">
                    <div><span className="eyebrow">Stay connected</span><h2>See what’s happening on campus.</h2></div>
                    <Link className="register-button" to="/events">Browse events <span aria-hidden="true">→</span></Link>
                </section>
            </main>
        </>
    );
}

export default AboutCouncil;
