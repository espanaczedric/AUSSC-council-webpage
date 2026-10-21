# University events API

The Express API stores application data and login sessions in MongoDB. The React app calls it at `http://localhost:3000/api` by default. One MongoDB client is kept for the lifetime of the API, and database indexes enforce unique accounts, registrations, and registration codes.

## Start locally

1. Install and start MongoDB locally, or create a MongoDB Atlas database.
2. Copy `backend/.env.example` to `backend/.env`. Set `MONGODB_URI`, a long random `SESSION_SECRET`, and the database name.
3. Install dependencies with `npm --prefix backend install`.
4. Start the complete project from the root with `npm run dev`, or start the API alone with `npm run dev:api`.

The API waits for a successful MongoDB connection before it begins listening. Health checks at `/api/health` report the active database.

## Password reset email

Password recovery sends a six-digit, one-time code through Brevo transactional email. Configure `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, and optionally `BREVO_SENDER_NAME` in `backend/.env`. The sender address must be verified in Brevo. Set `PASSWORD_RESET_SECRET` to a separate random value of at least 32 characters; reset codes are stored as keyed hashes, expire after 10 minutes, and are limited to five verification attempts. The API limits code requests per email and source IP. Restart the API after changing the environment.

## Move existing MySQL data

The API no longer reads or writes MySQL. If the old MySQL database still exists, set the `MYSQL_*` values in `backend/.env` and run:

```sh
npm --prefix backend run import:mysql
```

The import copies users, events, registrations, attendance, event highlights, and event schedules, preserving their numeric IDs and password hashes. It uses upserts and does not delete existing MongoDB data. Local image files in the old `uploads` folder remain in place; copy that folder with the application when moving hosts. Existing SQL files are kept as import references only. Login sessions are not migrated, so users sign in again after the switch.

## Create an administrator

For a new empty MongoDB database, set `ADMIN_EMAIL` and a unique `ADMIN_PASSWORD` of at least 12 characters in `backend/.env`, then run:

```sh
npm --prefix backend run create:admin
```

The command creates the admin account or updates the matching email/student ID. It does not install a default password.

## Production

Use HTTPS, set `SESSION_COOKIE_SECURE=true`, configure `FRONTEND_ORIGINS`, use a long random `SESSION_SECRET`, and set the frontend's `VITE_API_URL` to the deployed API base ending in `/api`. Store uploads on persistent storage in production.
