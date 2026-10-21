# Project architecture

Updated: 2026-10-21

## Runtime

- The frontend is a React application built with Vite.
- The API is a Node.js Express service in `backend/src/server.js`.
- MongoDB is the application's only database. Connection settings are read from `MONGODB_URI` and `MONGODB_DATABASE`.
- Express sessions and application records are stored in MongoDB. The API exposes `/api/health` to report service and database status.
- The root npm scripts start the frontend and API together for local development.

## Available flows

The application includes public event discovery and council information pages, student account and registration flows, personal event registrations and QR passes, and administrative event, registration, user, highlight, and attendance workflows. Password recovery sends one-time codes through Brevo when the corresponding environment variables are configured.

## Configuration

Copy `backend/.env.example` to `backend/.env` and configure MongoDB, session security, frontend origins, and any optional Brevo settings. Keep real credentials out of source control. See [backend/README.md](backend/README.md) for local startup and deployment configuration.

## Known scope limits

The Executive Committee is the council leadership group from Governor through Social Media Manager: Governor, Vice Governor, Secretary, Treasurer, Auditor, and Social Media Manager. Departmental representatives remain a separate council role. Committee workspaces, financial transparency, publication tracking, event approval queues, and delegated committee permissions are not yet complete end-to-end workflows. Those features need shared MongoDB models, API authorization, and connected UI before they can display authoritative information. Camera scanning also needs verification in the deployment environment.
