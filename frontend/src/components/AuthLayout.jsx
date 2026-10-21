import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

const slides = [
    { image: "/assets/council-carousel/council-1.jpg", label: "Council photo 1" },
    { image: "/assets/council-carousel/council-2.jpg", label: "Council photo 2" },
    { image: "/assets/council-carousel/council-3.jpg", label: "Council photo 3" }
];

export default function AuthLayout({ children, panelClassName = "" }) {
    const [activeSlide, setActiveSlide] = useState(0);
    const [imageFailed, setImageFailed] = useState(false);
    const currentSlide = slides[activeSlide];

    useEffect(() => {
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
        const interval = window.setInterval(() => {
            setActiveSlide((current) => (current + 1) % slides.length);
        }, 6000);
        return () => window.clearInterval(interval);
    }, []);

    useEffect(() => setImageFailed(false), [activeSlide]);

    return (
        <main className="login-page login-redesign">
            <section className="login-story" aria-label="Student Council activities">
                {imageFailed ? (
                    <div className={`login-story-placeholder login-story-placeholder-${activeSlide + 1}`} aria-hidden="true" />
                ) : (
                    <img
                        key={currentSlide.image}
                        className="login-story-image"
                        src={currentSlide.image}
                        alt="Student council members and campus activities"
                        onError={() => setImageFailed(true)}
                    />
                )}
                <div className="login-story-shade" />
                <Link to="/" className="login-story-logo" aria-label="Araullo University South Student Council home">
                    <img src="/assets/aussc-header-light.png" alt="Araullo University South Student Council" />
                </Link>
                <div className="login-story-bottom">
                    <strong>For the Students, We Remain</strong>
                    <div className="login-story-dots" role="group" aria-label="Choose a slideshow image">
                        {slides.map((slide, index) => (
                            <button
                                key={slide.image}
                                type="button"
                                className={index === activeSlide ? "is-active" : ""}
                                aria-label={`Show ${slide.label}`}
                                aria-pressed={index === activeSlide}
                                onClick={() => { setActiveSlide(index); setImageFailed(false); }}
                            />
                        ))}
                    </div>
                </div>
                <small className="login-story-copyright">© {new Date().getFullYear()} Araullo University South Student Council</small>
            </section>
            <section className="login-panel">
                <div className={`login-panel-inner ${panelClassName}`}>{children}</div>
            </section>
        </main>
    );
}
