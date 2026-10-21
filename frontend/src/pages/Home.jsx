import { useEffect, useState } from "react";

import Navbar from "../components/Navbar";
import EventHero from "../components/EventHero";
import EventCarousel from "../components/EventCarousel";

import {
    getUpcomingEvent,
    getPreviousEvents
} from "../services/api";

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


    if (loading) {

        return (
            <div className="loading">
                Loading events...
            </div>
        );

    }


    return (

        <>

            <Navbar />

            <main>

                <EventHero event={loadError ? null : upcoming} />

                {loadError && (
                    <p className="home-event-error" role="alert">
                        Event listings are temporarily unavailable. Please try again later.
                    </p>
                )}

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
