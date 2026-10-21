# Project audit and implementation record

Date: 2026-10-21

## Current architecture

- React 18 and React Router 6 frontend, built with Vite from `frontend/src`.
- Node.js REST API in `backend/src/server.js`, built with Express and mysql2 against the existing MySQL-compatible/TiDB schema.
- Cookie-backed Express sessions stored in the `app_sessions` table; the current role model is only `student` and `admin`.
- Main data tables are `users`, `events`, `event_schedules`, `registrations`, `attendance`, and `event_highlights`.
- Public flows cover event discovery/details and past highlights. Signed-in flows cover account login, personal registrations and QR pass display. Admin flows cover events, registrations, users, highlights and QR check-in.
- There are two schema snapshots (`database/university_events.sql` and `backend/database/university_events.sql`) that differ in their DDL and seed data. Neither snapshot is a versioned migration system.

## Ranked findings

### Critical

1. **A visitor could register someone else using their student ID.** The previous API trusted submitted identity fields, looked up an existing user by student ID, and issued a QR registration code without requiring a session. The Express registration API now requires a signed-in session and uses its user ID; the public form no longer accepts identity fields. Duplicate registrations are handled as conflicts, and event capacity is checked while the event row is locked in a transaction.
2. **The public registration form exposed every student's personal data to impersonation risk.** The UI now directs visitors to sign in and displays only the current account identity before creating a pass.

### High

3. **Database connection values were embedded in application source.** The Node service reads connection settings from environment variables. Deployment must provide the values through its environment.
4. **Public event labels and event lists could disagree with actual dates.** Public event endpoints now calculate a `display_status` from `start_date`/`end_date`; past events are selected by `end_date`. Event pages use the calculated display status.
5. **The frontend API root and CORS origins were fixed to local development URLs.** The frontend now accepts `VITE_API_URL`; the backend accepts a comma-separated `FRONTEND_ORIGINS` allowlist and retains local origins as a development default.

### Medium / remaining platform work

6. **Authorization is only student/admin.** Committee assignments, ExeCom, Production, Publication, Program, public transparency, and delegated permissions do not exist yet. Admin operations currently check the session role; this is not a substitute for the requested fine-grained roles.
7. **Budgets, approvals, pubmat workflow, program plans, production tasks, notifications, announcements and audit logs have no backing tables or API routes.** They require requirements and safe schema migrations before user-facing screens can be implemented.
8. **Event publication is currently just an event status field.** There is no draft/submission/approval lifecycle, no status history, and stored statuses can still be edited manually in admin forms.
9. **File and deployment configuration need a production review.** Event uploads are MIME checked and bounded, but upload directory execution policy, web server configuration, CSRF protection, session cookie deployment settings, rate limiting, and HTTPS/TiDB TLS configuration are not represented in this repository.
10. **Schema drift and seed-account risk.** The two SQL snapshots diverge and include development/sample admin accounts. Existing live records and the actual deployed schema were not accessible for comparison; do not apply either SQL file as a production reset.

## Current implementation record

- Added an Express API in `backend` with the existing authentication, public event discovery, registration, QR attendance, admin listing, event CRUD, and highlight CRUD operations.
- Removed the previous API/configuration implementation after porting its active routes to Node. The existing SQL event schema snapshots remain because the service uses the current database model. Added one isolated session-store migration.
- Registration requires a signed-in student session, checks eligibility/capacity inside a transaction, and uses the database uniqueness constraint for duplicate prevention.
- Public event responses derive display status from dates. The React event pages display that status.
- Added a public event catalog endpoint that returns only event-list fields and date-derived `upcoming`, `ongoing`, or `completed` status; the public browser supports status filters and client-side title/location/description search.
- Refreshed the existing UI around the navy, gold, and white design system. The homepage introduces the council and displays a real event feature; the admin area uses a responsive navigation rail. Existing registration, scanner, user, event, and highlight workflows remain connected to the API.
- Added public About, Committee Directory, and event-updates pages. The event-updates page uses real event descriptions and dates rather than a fabricated announcements feed. The navigation collapses on mobile and closes on outside click or Escape.
- The frontend API root now defaults to `http://localhost:3000/api`; `VITE_API_URL` overrides it.
- Node deployment settings use `DB_URL` or `DB_HOST`/`DB_PORT`/`DB_NAME`, `DB_USER`, `DB_PASSWORD`, `FRONTEND_ORIGINS`, `UPLOAD_DIR`, and `SESSION_COOKIE_SECURE`.
- Added a root npm launcher: `npm run dev` starts the API and Vite together. Backend dependencies are managed through `backend/package.json`.
- Sign-in returns students to an event registration they initiated; account registration and image URLs use the configured API host.

## Database migrations

Added `backend/database/migrations/001_app_sessions.sql` for persistent Express sessions. The event service otherwise uses existing columns/tables. The deployed schema must contain `UNIQUE(user_id, event_id)` and `UNIQUE(registration_code)` for duplicate protection. Confirm these constraints against the live TiDB schema before deployment.

## Deployment configuration

For local use, apply the session migration, run `npm --prefix backend install`, then `npm run dev` from the project root. Set `VITE_API_URL` to the deployed API base ending in `/api`. Set `DB_URL` (including TiDB TLS parameters) or `DB_HOST`, `DB_PORT`, and `DB_NAME`, plus `DB_USER` and `DB_PASSWORD`. Set `FRONTEND_ORIGINS` to comma-separated frontend origins, `UPLOAD_DIR` to persistent storage, and `SESSION_COOKIE_SECURE=true` behind HTTPS. See [backend/README.md](backend/README.md).

## Known limitations

The UI refresh covers routes and workflows backed by the existing application. Committee workspaces, financial transparency, announcements, delegated roles, and approval workflows remain unavailable because this repository has no supporting API routes or database records for them; adding presentation-only dashboards would require fabricated data. They need requirements, authorization rules, and safe schema migrations. The Node service starts and its health endpoint responds, but live database workflows were not verified because no database connection was available in this workspace. An interactive browser preview was not available during this pass.

## Verification performed

- `npm run build` — passed. Vite reports a large JavaScript chunk warning (about 596 kB minified), including the PDF generation dependencies.
- `git diff --check` — passed.
- `npm --prefix backend run check` — passed.
- `npm --prefix backend install` — passed; npm audit reported zero vulnerabilities after fixing the nested mysql2 version.
- `GET /api/health` — returned HTTP 200 from the running Express service.
- No browser-to-database integration test was run because no database connection was available.
