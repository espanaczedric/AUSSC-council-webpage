import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";

const constitutionalDuties = [
    {
        number: "01",
        title: "Represent students",
        body: "Serve as the official voice and liaison of the general student body in institutional student matters and university deliberations."
    },
    {
        number: "02",
        title: "Uphold rights and welfare",
        body: "Protect democratic student rights, address student matters, and work with University Authorities and CSDL on student welfare."
    },
    {
        number: "03",
        title: "Serve with accountability",
        body: "Ground council work in service, representation, participation, and accountability, while managing council responsibilities prudently."
    }
];

function AboutCouncil() {
    return (
        <>
            <Navbar />
            <main className="about-page page-enter">
                <section className="about-hero">
                    <span className="eyebrow">PHINMA Araullo University - South Campus</span>
                    <h1>The representative voice<br />of the student body.</h1>
                    <p>The A.U.S.S.C. represents bona fide students in institutional student matters and deliberations, and serves as the official voice and liaison between students and the University administration.</p>
                    <div className="about-actions">
                        <Link className="register-button" to="/committees">Explore the committees <span aria-hidden="true">→</span></Link>
                        <Link className="about-text-link" to="/events">Council activities</Link>
                    </div>
                </section>

                <section className="about-mission-vision" aria-label="Council mission and vision">
                    <article className="about-statement-card">
                        <span className="eyebrow">Our mission</span>
                        <h2>Represent students and serve their welfare.</h2>
                        <p>Uphold student rights and interests, bring student concerns to the University, and work with University Authorities and the Center for Student Development and Leadership on matters affecting students.</p>
                        <span className="about-statement-reference">Constitution: Articles I–IV</span>
                    </article>
                    <article className="about-statement-card is-vision">
                        <span className="eyebrow">Our vision</span>
                        <h2>An inclusive council advancing student aspirations.</h2>
                        <p>A student government that embraces diverse ideas, encourages excellence in student life, and supports the development and general welfare of every student.</p>
                        <span className="about-statement-reference">Constitution: Preamble and Article II</span>
                    </article>
                    <p className="about-constitution-note">These mission and vision summaries are drawn from the Constitution and By-Laws; they are not quoted as separately titled statements in the document.</p>
                </section>

                <section className="about-principles" aria-labelledby="constitutional-duties-title">
                    <div className="about-section-heading">
                        <span className="eyebrow">Our constitutional mandate</span>
                        <h2 id="constitutional-duties-title">What the council is entrusted to do.</h2>
                    </div>
                    <div className="principle-list">
                        {constitutionalDuties.map((duty) => (
                            <article key={duty.number}>
                                <span>{duty.number}</span>
                                <div><h3>{duty.title}</h3><p>{duty.body}</p></div>
                            </article>
                        ))}
                    </div>
                </section>

                <section className="about-bottom-cta">
                    <div><span className="eyebrow">Council work</span><h2>Explore the committees and activities that carry out this mandate.</h2></div>
                    <Link className="register-button" to="/committees">View committees <span aria-hidden="true">→</span></Link>
                </section>
            </main>
        </>
    );
}

export default AboutCouncil;
