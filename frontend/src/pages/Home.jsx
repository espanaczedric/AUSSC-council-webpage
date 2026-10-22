import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import Navbar from "../components/Navbar";
import EventHero from "../components/EventHero";
import EventCarousel from "../components/EventCarousel";

import {
    getUpcomingEvent,
    getPreviousEvents
} from "../services/api";

function HomeLoadingSkeleton() {
    return (
        <>
            <Navbar />
            <main className="home-loading-skeleton" aria-busy="true">
                <section className="home-hero home-skeleton-hero" aria-hidden="true">
                    <div className="home-hero-decoration" />
                    <div className="home-hero-inner">
                        <div className="home-hero-copy">
                            <span className="home-skeleton-dark home-skeleton-eyebrow" />
                            <div className="home-skeleton-title"><i /><i /></div>
                            <div className="home-skeleton-paragraph"><i /><i /><i /></div>
                            <div className="home-skeleton-actions"><i /><i /></div>
                        </div>
                        <article className="home-featured-event home-skeleton-featured">
                            <div className="home-skeleton-feature-image" />
                            <div className="home-featured-copy">
                                <i className="home-skeleton-light home-skeleton-status" />
                                <i className="home-skeleton-light home-skeleton-event-title" />
                                <i className="home-skeleton-light home-skeleton-meta" />
                                <i className="home-skeleton-light home-skeleton-link" />
                            </div>
                        </article>
                    </div>
                    <div className="home-hero-footer"><span /> <i className="home-skeleton-dark home-skeleton-footer" /></div>
                </section>

                <section className="council-intro" aria-hidden="true">
                    <div className="council-intro-copy home-skeleton-intro-copy">
                        <i className="home-skeleton-light home-skeleton-eyebrow" />
                        <i className="home-skeleton-light home-skeleton-intro-title" />
                        <i className="home-skeleton-light home-skeleton-intro-text" />
                        <i className="home-skeleton-light home-skeleton-intro-text is-short" />
                    </div>
                    <div className="council-pillars home-skeleton-pillars">
                        {Array.from({ length: 4 }, (_, index) => <div key={index}><i className="home-skeleton-light home-skeleton-pillar-title" /><i className="home-skeleton-light home-skeleton-pillar-text" /><i className="home-skeleton-light home-skeleton-pillar-text is-short" /></div>)}
                    </div>
                </section>

                <section className="home-transparency-preview home-skeleton-transparency" aria-hidden="true">
                    <i className="home-skeleton-light home-skeleton-mark" />
                    <div><i className="home-skeleton-light home-skeleton-eyebrow" /><i className="home-skeleton-light home-skeleton-transparency-title" /><i className="home-skeleton-light home-skeleton-transparency-text" /></div>
                    <i className="home-skeleton-light home-skeleton-transparency-link" />
                </section>

                <section className="previous-section home-skeleton-previous" aria-hidden="true">
                    <div className="section-heading">
                        <i className="home-skeleton-light home-skeleton-eyebrow" />
                        <i className="home-skeleton-light home-skeleton-previous-title" />
                        <i className="home-skeleton-light home-skeleton-previous-text" />
                    </div>
                    <div className="event-carousel">
                        {Array.from({ length: 2 }, (_, index) => <article className="event-slide" key={index}><i className="home-skeleton-light home-skeleton-previous-image" /><div className="event-info"><i className="home-skeleton-light home-skeleton-meta" /><i className="home-skeleton-light home-skeleton-event-title" /><i className="home-skeleton-light home-skeleton-previous-text" /><i className="home-skeleton-light home-skeleton-link" /></div></article>)}
                    </div>
                </section>
                <span className="sr-only" role="status">Loading the home page…</span>
            </main>
        </>
    );
}

function Home() {

    const [upcoming, setUpcoming] =
        useState(null);

    const [previous, setPrevious] =
        useState([]);

    const [loading, setLoading] =
        useState(true);

    const [loadError, setLoadError] =
        useState(false);


    useEffect(() => {

        async function loadEvents() {

            try {

                const upcomingData =
                    await getUpcomingEvent();

                const previousData =
                    await getPreviousEvents();

                setUpcoming(
                    upcomingData.event
                );

                setPrevious(
                    previousData.events || []
                );

            } catch (error) {

                setLoadError(true);

                console.error(
                    "Failed to load events:",
                    error
                );

            } finally {

                setLoading(false);

            }
        }

        loadEvents();

    }, []);


    if (loading) return <HomeLoadingSkeleton />;


    return (

        <>

            <Navbar />

            <main>

                <EventHero event={loadError ? null : upcoming} loadError={loadError} />

                <section className="council-intro" id="council">
                    <div className="council-intro-copy">
                        <span className="eyebrow">Who we are</span>
                        <h2>Representing students.<br />Building community.</h2>
                        <p>The Student Council works to make campus life more connected, meaningful, and responsive to the students it serves.</p>
                    </div>
                    <div className="council-pillars" aria-label="Student Council committees">
                        <article><span>01</span><h3>Executive</h3><p>Leadership and council-wide coordination</p></article>
                        <article><span>02</span><h3>Production</h3><p>Event logistics and technical operations</p></article>
                        <article><span>03</span><h3>Publication</h3><p>Creative work and student communications</p></article>
                        <article><span>04</span><h3>Program</h3><p>Activities and event experiences</p></article>
                    </div>
                </section>

                <section className="home-transparency-preview" aria-labelledby="home-transparency-title">
                    <div className="home-transparency-mark" aria-hidden="true">A</div>
                    <div className="home-transparency-copy">
                        <span className="eyebrow">Open governance</span>
                        <h2 id="home-transparency-title">Council work should be clear to students.</h2>
                        <p>Visit the public reports page for council materials released for the student community.</p>
                    </div>
                    <Link to="/transparency" className="home-transparency-link">View public reports <span aria-hidden="true">→</span></Link>
                </section>


                <section className="previous-section">

                    <div className="section-heading">

                        <span>LOOKING BACK</span>

                        <h2>
                            Previous Events
                        </h2>

                        <p>
                            Take a look back at
                            the moments that brought
                            our university community
                            together.
                        </p>

                    </div>


                    {loadError ? (
                        <p className="event-load-error" role="alert">
                            Previous events could not be loaded.
                        </p>
                    ) : (
                        <EventCarousel events={previous} />
                    )}

                </section>

            </main>

        </>
    );
}

export default Home;
