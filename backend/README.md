# University events API

The Express API uses MongoDB for application data, login sessions, and event cover images. The React app calls `http://localhost:3000/api` by default. The API listens while MongoDB is unavailable, reports the database state at `/api/health`, and retries its MongoDB connection with backoff. The same Express app is also exposed as a Vercel Function in production; the React app calls it at `/api` on the same domain.

## Start locally

1. Start MongoDB locally or create a MongoDB Atlas database.
2. Copy `backend/.env.example` to `backend/.env` and set `MONGODB_URI`, `MONGODB_DATABASE`, and a long random `SESSION_SECRET`.
3. Install all workspace dependencies from the repository root with `npm install`.
4. Start both the API and frontend from the project root with `npm run dev`, or start only the API with `npm run dev:api`.

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
