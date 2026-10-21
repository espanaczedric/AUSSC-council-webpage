import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import Navbar from "../components/Navbar";
import EventImage from "../components/EventImage";
import { apiRequest } from "../services/api";

function MyEvents() {

    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {

        async function loadMyEvents() {

            try {

                /*
                 * This will connect to the
                 * Load registrations for the signed-in student.
                 * endpoint once authentication
                 * is implemented.
                 */

                const data = await apiRequest("/registration/my", {
                    credentials: "include"
                });

                if (data.success) {
                    setEvents(data.events || []);
                }

            } catch (error) {

                console.error(
                    "Failed to load registrations:",
                    error
                );

            } finally {

                setLoading(false);

            }

        }

        loadMyEvents();

    }, []);


    if (loading) {

        return (
            <div className="loading">
                Loading your events...
            </div>
        );

    }


    return (

        <>
            <Navbar />

            <main className="my-events-page">

                <section className="events-header">

                    <span>
                        YOUR ACTIVITY
                    </span>

                    <h1>
                        My Events
                    </h1>

                    <p>
                        View the events you've registered
                        for and access your registration
                        information.
                    </p>

                </section>


                <section className="my-events-list">

                    {events.length === 0 ? (

                        <div className="empty-events">

                            <h2>
                                No registered events yet.
                            </h2>

                            <p>
                                Find an event and reserve
                                your spot.
                            </p>

                            <Link
                                to="/events"
                                className="register-button"
                            >
                                Explore Events
                            </Link>

                        </div>

                    ) : (

                        events.map((registration) => (

                            <article
                                className="my-event-card"
                                key={registration.registration_id}
                            >

                                <EventImage
                                    src={registration.cover_image}
                                    alt={registration.title}
                                    className="my-event-image"
                                />

                                <div>

                                    <small>
                                        {new Date(
                                            registration.start_date
                                        ).toLocaleDateString(
                                            "en-US",
                                            {
                                                month: "long",
                                                day: "numeric",
                                                year: "numeric"
                                            }
                                        )}
                                    </small>

                                    <h2>
                                        {registration.title}
                                    </h2>

                                    <p>
                                        Registration Code:
                                        <strong>
                                            {" "}
                                            {
                                                registration.registration_code
                                            }
                                        </strong>
                                    </p>

                                    <p>
                                        Status:
                                        {" "}
                                        <strong>
                                            {
                                                registration.status
                                            }
                                        </strong>
                                    </p>

                                    <Link
                                        to={`/registration/${registration.registration_code}`}
                                    >
                                        View Registration →
                                    </Link>

                                </div>

                            </article>

                        ))

                    )}

                </section>

            </main>
        </>
    );
}

export default MyEvents;
