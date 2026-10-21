# University events API

The Express API uses MongoDB for application data and login sessions. The React app calls `http://localhost:3000/api` by default. The API listens while MongoDB is unavailable, reports the database state at `/api/health`, and retries its MongoDB connection with backoff.

## Start locally

1. Start MongoDB locally or create a MongoDB Atlas database.
2. Copy `backend/.env.example` to `backend/.env` and set `MONGODB_URI`, `MONGODB_DATABASE`, and a long random `SESSION_SECRET`.
3. Install backend dependencies with `npm --prefix backend install`.
4. Start both the API and frontend from the project root with `npm run dev`, or start only the API with `npm run dev:api`.

## Password reset email

Password recovery sends a six-digit one-time code through Brevo transactional email. Configure `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, and optionally `BREVO_SENDER_NAME`. The sender address must be verified in Brevo. Set `PASSWORD_RESET_SECRET` to a separate random value of at least 32 characters. Reset codes are stored as keyed hashes, expire after 10 minutes, and are limited to five verification attempts. Restart the API after changing the environment.

## Create an administrator

For a new MongoDB database, set `ADMIN_EMAIL` and a unique `ADMIN_PASSWORD` of at least 12 characters in `backend/.env`, then run:

```sh
npm --prefix backend run create:admin
```

The command creates the admin account or updates the matching email/student ID. It does not install a default password.

## Production

Use HTTPS, set `SESSION_COOKIE_SECURE=true`, configure `FRONTEND_ORIGINS`, use a long random `SESSION_SECRET`, and set the frontend's `VITE_API_URL` to the deployed API base ending in `/api`. Store uploads on persistent storage in production.

For Atlas connectivity, add the **backend host's outbound public IP** to Atlas Network Access and allow outbound TCP traffic on ports `27015`–`27017`. If the backend runs on a hosting platform, adding a developer's laptop IP will not allow the deployed backend unless that platform routes outbound traffic through the same address. Check `/api/health` from the deployed frontend's API URL after changing the network settings.
