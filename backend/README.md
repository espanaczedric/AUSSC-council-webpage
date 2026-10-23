# University events API

The Express API uses MongoDB for application data, login sessions, and event cover images. The React app calls `http://localhost:3000/api` by default. The API listens while MongoDB is unavailable, reports the database state at `/api/health`, and retries its MongoDB connection with backoff. The same Express app is also exposed as a Vercel Function in production; the React app calls it at `/api` on the same domain.

## Start locally

1. Start MongoDB locally or create a MongoDB Atlas database.
2. Copy `backend/.env.example` to `backend/.env` and set `MONGODB_URI`, `MONGODB_DATABASE`, and a long random `SESSION_SECRET`.
3. Install all workspace dependencies from the repository root with `npm install`.
4. Start both the API and frontend from the project root with `npm run dev`, or start only the API with `npm run dev:api`.

## Council event participation and attendance

New events are published to the public site immediately when an administrator creates them. Admins choose an invitation audience (all council members or selected committees); the same request seeds one pending participation row per invitee and sends an in-app notification with the event details. Members can accept or decline from the event page; admins can filter and review participation by event, committee, member, and response in **Participation**. Only invited council accounts can respond. This records intent to help and does not create a task assignment or attendance session. Linked task assignments are still confirmed by an authorized person, require an accepted response, and require explicit confirmation when the member's weekly class schedule overlaps the event. Failed event notifications are marked on the event and can be retried from the admin event list. Existing draft or pending-approval events remain available in the executive review workflow. Admins can permanently delete events only before participation, attendance, registration, assignment, finance, or other history is linked; otherwise they can archive the event to preserve its records.

Council members maintain recurring weekly class blocks from their profile for the selected academic period. New schedule data is stored in `council_class_schedules`; council participation uses `event_responses`; student event agreements use `student_event_participations`; event work remains in `committee_work_items`; and check-in records remain in `attendance`. Council members use one signed identity QR containing their student ID; it can be scanned for time-in and time-out at any event, with the attendance team selecting the event. Students must agree to participate on the event page before generating a signed, event-specific QR. It contains the student's ID and that event's ID, title, and description, and can only be scanned for the matching event while their participation is active. Neither QR includes participation, class schedules, task assignments, or attendance state.

The API creates the required indexes on startup, including unique event/member participation and member/academic-period indexes. No manual migration is required. Existing student registration documents are retained as historical records. Student participation agreements are stored separately from legacy registrations and attendance. Event QR values are generated on demand and are not stored; event descriptions that make the QR payload exceed 2,200 characters are refused. Production signing uses `SESSION_SECRET`; local development without a 32-character secret uses a random process key, so locally generated QRs become invalid after the backend restarts.

## Public announcements

Executives and administrators can create, edit, publish, draft, and archive standalone public notices from **Announcements** in the council workspace. These notices are stored in `public_announcements`, separate from events and their publication updates. Published notices appear on `/announcements`; drafts and archived notices remain in the admin content library. The API creates the collection indexes on startup, so no manual migration is required.

## Password reset email

Password recovery sends a six-digit one-time code through Brevo transactional email. Configure `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, and optionally `BREVO_SENDER_NAME`. The sender address must be verified in Brevo. Set `PASSWORD_RESET_SECRET` to a separate random value of at least 32 characters. Reset codes are stored as keyed hashes, expire after 10 minutes, and are limited to five verification attempts. Restart the API after changing the environment.

## Create an administrator

For a new MongoDB database, set `ADMIN_EMAIL` and a unique `ADMIN_PASSWORD` of at least 12 characters in `backend/.env`, then run:

```sh
npm --prefix backend run create:admin
```

The command creates the admin account or updates the matching email/student ID. It does not install a default password.

## Vercel deployment (no separate Render service)

Commit and push the root `vercel.json` before starting or refreshing Vercel's importer; Vercel reads configuration from the Git branch, not unpushed local files. Import the repository as a **multi-service project**, with the project root at the repository root (`./`) and Framework Preset **Services**. The root config defines the `frontend` Vite service and `backend` Express service and routes `/api/*` and `/uploads/*` to Express; all other paths go to the React app. The frontend service rewrites deep links to `index.html`. Each service installs from its own package manifest and lockfile and uses Node.js 22.

The services share one deployment domain and environment variables, so do not set `VITE_API_URL`. Add these backend environment variables in Vercel under Project Settings → Environment Variables for every environment you intend to deploy (Production, Preview, and Development as applicable):

- `MONGODB_URI` — the Atlas connection URI.
- `MONGODB_DATABASE` — the database name.
- `MONGODB_MAX_POOL_SIZE=10` — keeps connection pools bounded across function instances.
- `SESSION_SECRET` — a long, random secret.
- `SESSION_COOKIE_SECURE=true`.
- `PASSWORD_RESET_SECRET` — a separate random secret for password reset codes.
- `BREVO_API_KEY` and `BREVO_SENDER_EMAIL` for password recovery email.

Generate separate, strong random values for `SESSION_SECRET` and `PASSWORD_RESET_SECRET`; never paste secrets into source files or commit `.env`. `SESSION_COOKIE_SECURE` should be `true` on Vercel. Set the Brevo variables only if password recovery email should be enabled; the sender address must be verified in Brevo.

Event covers and profile media use MongoDB GridFS on Vercel so uploads persist across function invocations. Locally, uploads continue to use the `uploads` directory. After deployment, open `https://<your-vercel-domain>/api/health`; it should return `status: "ready"` and `database: "mongodb"`. If it returns a diagnostic code, `MONGODB_DNS_UNAVAILABLE` points to the Atlas SRV hostname/DNS lookup, `MONGODB_NETWORK_UNAVAILABLE` points to Atlas network access or outbound connectivity, `MONGODB_AUTHENTICATION_FAILED` points to the Atlas database username/password, and `MONGODB_PERMISSION_DENIED` means the database user lacks the required role. Then verify account sign-in, password reset email, profile image upload, event cover upload, and QR check-in on the deployed domain.

For Atlas connectivity, allow the **Vercel Function's outbound IP** in Atlas Network Access and allow outbound TCP traffic on ports `27015`–`27017`. Vercel's normal function egress uses changing IP addresses; Vercel Static IPs are available on Pro and Enterprise plans. Configure static egress for the project and add its assigned addresses to Atlas. Adding a developer's laptop IP does not authorize a deployed function unless it exits through that same address. Avoid opening Atlas to every IP as a workaround.

For a new database, create the first administrator using the local `create:admin` command above with the production MongoDB database selected. Do not add `ADMIN_PASSWORD` to Vercel; it is only used by that one-time local command.

## Publication Committee workflow

Publication tasks live in the shared `committee_work_items` collection (`committee: "publication"`, `kind: "pubmat"`) with task briefs, deliverables, event, designer, submission deadline, scheduled post date, status, revision history, and submission records. Executive Committee members create and assign tasks, review submissions, request revisions, approve designs, and record the actual posting time. Publication members see only their own assignments and can submit links, notes, or a file; they cannot assign, edit, or review work.

Task attachments are stored privately in the `committee_submissions` GridFS bucket and are served only to the assigned member or Executive Committee. JPG, PNG, WebP, MP4, WebM, and MOV files are accepted up to 4 MB. Notifications are persisted per account in `notifications`; deadline reminders are deduplicated and generated when the inbox is opened. The dashboard calculates submission timeliness from the deadline captured at first submission and posting timeliness from the scheduled and actual publication timestamps. Rates exclude cancelled work and future deadlines.
