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

Set the Vercel project Root Directory to the repository root (`.`), then deploy using the checked-in `vercel.json`. The frontend uses the same-domain `/api` function in production, so it does not need a `VITE_API_URL` value. Add these backend environment variables in Vercel for Production and Preview as needed:

- `MONGODB_URI` — the Atlas connection URI.
- `MONGODB_DATABASE` — the database name.
- `MONGODB_MAX_POOL_SIZE=10` — keeps connection pools bounded across function instances.
- `SESSION_SECRET` — a long, random secret.
- `SESSION_COOKIE_SECURE=true`.
- `PASSWORD_RESET_SECRET` — a separate random secret for password reset codes.
- `BREVO_API_KEY` and `BREVO_SENDER_EMAIL` for password recovery email.

Event cover images are stored in MongoDB GridFS on Vercel so they persist across function invocations. Locally, covers continue to use the `uploads` directory. Check `https://<your-vercel-domain>/api/health` after deployment.

For Atlas connectivity, allow the **Vercel Function's outbound IP** in Atlas Network Access and allow outbound TCP traffic on ports `27015`–`27017`. Vercel's normal function egress uses changing IP addresses; Vercel Static IPs are available on Pro and Enterprise plans. Configure static egress for the project and add its assigned addresses to Atlas. Adding a developer's laptop IP does not authorize a deployed function unless it exits through that same address. Avoid opening Atlas to every IP as a workaround.
