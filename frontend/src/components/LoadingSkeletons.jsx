import Navbar from "./Navbar";
import AdminNav from "./AdminNav";

export function SkeletonBlock({ className = "" }) {
    return <i className={`ui-skeleton-block ${className}`} aria-hidden="true" />;
}

export function SkeletonPageHeading({ className = "" }) {
    return (
        <div className={`ui-skeleton-page-heading ${className}`} aria-hidden="true">
            <SkeletonBlock className="ui-skeleton-eyebrow" />
            <SkeletonBlock className="ui-skeleton-title" />
            <SkeletonBlock className="ui-skeleton-description" />
        </div>
    );
}

export function SkeletonEventCards({ count = 6, className = "" }) {
    return (
        <div className={`ui-skeleton-event-grid ${className}`} aria-hidden="true">
            {Array.from({ length: count }, (_, index) => (
                <article className="ui-skeleton-event-card" key={index}>
                    <SkeletonBlock className="ui-skeleton-event-image" />
                    <div>
                        <SkeletonBlock className="ui-skeleton-short-line" />
                        <SkeletonBlock className="ui-skeleton-event-title" />
                        <SkeletonBlock className="ui-skeleton-event-copy" />
                        <SkeletonBlock className="ui-skeleton-event-copy is-short" />
                    </div>
                </article>
            ))}
        </div>
    );
}

export function SkeletonRows({ count = 5, image = false, className = "" }) {
    return (
        <div className={`ui-skeleton-rows${image ? " has-image" : ""} ${className}`} aria-hidden="true">
            {Array.from({ length: count }, (_, index) => (
                <div className="ui-skeleton-row" key={index}>
                    {image && <SkeletonBlock className="ui-skeleton-row-image" />}
                    <div className="ui-skeleton-row-copy">
                        <SkeletonBlock className="ui-skeleton-short-line" />
                        <SkeletonBlock className="ui-skeleton-row-title" />
                        <SkeletonBlock className="ui-skeleton-row-description" />
                    </div>
                    <SkeletonBlock className="ui-skeleton-row-end" />
                </div>
            ))}
        </div>
    );
}

export function SkeletonTable({ rows = 6, columns = 5, className = "" }) {
    return (
        <div className={`ui-skeleton-table-wrap ${className}`} aria-hidden="true">
            <div className="ui-skeleton-table" style={{ "--skeleton-columns": columns }}>
                <div className="ui-skeleton-table-head">
                    {Array.from({ length: columns }, (_, index) => <SkeletonBlock className="ui-skeleton-table-heading" key={index} />)}
                </div>
                {Array.from({ length: rows }, (_, row) => (
                    <div className="ui-skeleton-table-row" key={row}>
                        {Array.from({ length: columns }, (_, column) => <SkeletonBlock className="ui-skeleton-table-cell" key={column} />)}
                    </div>
                ))}
            </div>
        </div>
    );
}

export function PublicPageSkeleton({ children, className = "" }) {
    return (
        <>
            <Navbar />
            <main className={`ui-page-skeleton ${className}`} aria-busy="true">{children}</main>
            <span className="sr-only" role="status">Loading page…</span>
        </>
    );
}

export function AdminPageSkeleton({ children, className = "" }) {
    return (
        <>
            <AdminNav />
            <main className={`admin-page ui-admin-page-skeleton ${className}`} aria-busy="true">{children}</main>
            <span className="sr-only" role="status">Loading workspace page…</span>
        </>
    );
}
