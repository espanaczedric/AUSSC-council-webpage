import { useEffect, useMemo, useRef, useState } from "react";

const COVER_ASPECT = 16 / 5;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

export default function ImageCropDialog({ file, kind, onCancel, onApply }) {
    const imageUrl = useMemo(() => URL.createObjectURL(file), [file]);
    const viewportRef = useRef(null);
    const imageRef = useRef(null);
    const dragRef = useRef(null);
    const [viewport, setViewport] = useState({ width: 0, height: 0 });
    const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
    const [zoom, setZoom] = useState(1);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [processing, setProcessing] = useState(false);
    const aspect = kind === "cover" ? COVER_ASPECT : 1;
    const isCover = kind === "cover";
    const title = isCover ? "Adjust cover photo" : "Adjust profile picture";

    useEffect(() => () => URL.revokeObjectURL(imageUrl), [imageUrl]);

    useEffect(() => {
        const element = viewportRef.current;
        if (!element) return undefined;

        const updateSize = () => {
            const bounds = element.getBoundingClientRect();
            setViewport({ width: bounds.width, height: bounds.height });
        };
        updateSize();
        const observer = new ResizeObserver(updateSize);
        observer.observe(element);
        return () => observer.disconnect();
    }, [isCover]);

    useEffect(() => {
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => { document.body.style.overflow = previousOverflow; };
    }, []);

    useEffect(() => {
        function handleKeyDown(event) {
            if (event.key === "Escape" && !processing) onCancel();
        }
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [onCancel, processing]);

    const baseScale = imageSize.width && viewport.width
        ? Math.max(viewport.width / imageSize.width, viewport.height / imageSize.height)
        : 0;
    const scale = baseScale * zoom;
    const renderedWidth = imageSize.width * scale;
    const renderedHeight = imageSize.height * scale;
    const maxX = Math.max(0, (renderedWidth - viewport.width) / 2);
    const maxY = Math.max(0, (renderedHeight - viewport.height) / 2);

    function updateZoom(value) {
        const nextZoom = Number(value);
        const nextScale = baseScale * nextZoom;
        const nextMaxX = Math.max(0, (imageSize.width * nextScale - viewport.width) / 2);
        const nextMaxY = Math.max(0, (imageSize.height * nextScale - viewport.height) / 2);
        setZoom(nextZoom);
        setPosition((current) => ({
            x: clamp(current.x, -nextMaxX, nextMaxX),
            y: clamp(current.y, -nextMaxY, nextMaxY)
        }));
    }

    function startDrag(event) {
        if (processing || !imageSize.width) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { x: event.clientX, y: event.clientY, position };
    }

    function moveDrag(event) {
        if (!dragRef.current) return;
        const drag = dragRef.current;
        setPosition({
            x: clamp(drag.position.x + event.clientX - drag.x, -maxX, maxX),
            y: clamp(drag.position.y + event.clientY - drag.y, -maxY, maxY)
        });
    }

    function stopDrag() {
        dragRef.current = null;
    }

    function resetCrop() {
        setZoom(1);
        setPosition({ x: 0, y: 0 });
    }

    function nudgeCrop(event) {
        const directions = { ArrowLeft: [-4, 0], ArrowRight: [4, 0], ArrowUp: [0, -4], ArrowDown: [0, 4] };
        const direction = directions[event.key];
        if (!direction || processing) return;
        event.preventDefault();
        setPosition((current) => ({
            x: clamp(current.x + direction[0], -maxX, maxX),
            y: clamp(current.y + direction[1], -maxY, maxY)
        }));
    }

    function applyCrop() {
        const image = imageRef.current;
        if (!image || !viewport.width || !viewport.height || !scale) return;
        setProcessing(true);

        const sourceX = clamp(((renderedWidth - viewport.width) / 2 - position.x) / scale, 0, imageSize.width);
        const sourceY = clamp(((renderedHeight - viewport.height) / 2 - position.y) / scale, 0, imageSize.height);
        const sourceWidth = Math.min(viewport.width / scale, imageSize.width - sourceX);
        const sourceHeight = Math.min(viewport.height / scale, imageSize.height - sourceY);
        const outputWidth = isCover ? 1600 : 720;
        const outputHeight = Math.round(outputWidth / aspect);
        const canvas = document.createElement("canvas");
        canvas.width = outputWidth;
        canvas.height = outputHeight;
        const context = canvas.getContext("2d");

        if (!context) {
            setProcessing(false);
            return;
        }
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, outputWidth, outputHeight);
        canvas.toBlob((blob) => {
            if (!blob) {
                setProcessing(false);
                return;
            }
            const baseName = file.name.replace(/\.[^.]+$/, "") || (isCover ? "cover-photo" : "profile-picture");
            const croppedFile = new File([blob], `${baseName}-cropped.jpg`, { type: "image/jpeg", lastModified: Date.now() });
            onApply(kind, croppedFile);
        }, "image/jpeg", 0.92);
    }

    return (
        <div className="profile-crop-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !processing) onCancel(); }}>
            <section className="profile-crop-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-crop-title">
                <header className="profile-crop-header">
                    <div>
                        <span className="profile-edit-eyebrow">PHOTO EDITOR</span>
                        <h2 id="profile-crop-title">{title}</h2>
                        <p>Drag to reposition, then zoom in or out to frame it just right.</p>
                    </div>
                    <button className="profile-crop-close" type="button" aria-label="Close photo editor" onClick={onCancel} disabled={processing} autoFocus>×</button>
                </header>

                <div className="profile-crop-workspace">
                    <div
                        ref={viewportRef}
                        className={`profile-crop-viewport${isCover ? " is-cover" : " is-profile"}`}
                        onPointerDown={startDrag}
                        onPointerMove={moveDrag}
                        onPointerUp={stopDrag}
                        onPointerCancel={stopDrag}
                        onLostPointerCapture={stopDrag}
                        onKeyDown={nudgeCrop}
                        tabIndex={0}
                        role="group"
                        aria-label={`${title} crop area. Drag the image to reposition it.`}
                    >
                        <img
                            ref={imageRef}
                            src={imageUrl}
                            alt=""
                            draggable="false"
                            onLoad={(event) => setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
                            style={imageSize.width ? {
                                width: `${renderedWidth}px`,
                                height: `${renderedHeight}px`,
                                left: `calc(50% + ${position.x}px)`,
                                top: `calc(50% + ${position.y}px)`
                            } : undefined}
                        />
                        <span className="profile-crop-grid" aria-hidden="true" />
                    </div>
                    <div className="profile-crop-controls">
                        <label htmlFor="profile-photo-zoom">Zoom</label>
                        <input id="profile-photo-zoom" type="range" min="1" max="3" step="0.01" value={zoom} onChange={(event) => updateZoom(event.target.value)} disabled={!imageSize.width || processing} />
                        <output htmlFor="profile-photo-zoom">{Math.round(zoom * 100)}%</output>
                        <button className="profile-crop-reset" type="button" onClick={resetCrop} disabled={processing}>Reset</button>
                    </div>
                </div>

                <footer className="profile-crop-actions">
                    <button className="profile-cancel-button" type="button" onClick={onCancel} disabled={processing}>Cancel</button>
                    <button className="admin-primary-action" type="button" onClick={applyCrop} disabled={!imageSize.width || processing}>
                        {processing ? "Preparing photo…" : "Use this photo"}
                    </button>
                </footer>
            </section>
        </div>
    );
}
