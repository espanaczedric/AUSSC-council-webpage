import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import cors from "cors";
import express from "express";
import session from "express-session";
import { GridFSBucket, MongoClient, ObjectId } from "mongodb";
import multer from "multer";
import { fileTypeFromBuffer } from "file-type";
import { summarizePublicationPerformance } from "./publicationWorkflow.js";
import { attendanceScanAction, isAuthorizedCouncilMember, transitionAttendanceRecord } from "./attendanceWorkflow.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const uploadRoot = path.resolve(process.env.UPLOAD_DIR || path.join(rootDir, "uploads"));
const port = Number(process.env.PORT || 3000);
const isProduction = process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
const configuredSessionSecret = (process.env.SESSION_SECRET || "").trim();
const sessionCookieSecure = process.env.SESSION_COOKIE_SECURE === "true" || isProduction;
const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const databaseName = process.env.MONGODB_DATABASE || "university_events";
const localFrontendOrigins = "http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174";
const allowedOrigins = [
    ...(process.env.FRONTEND_ORIGINS || (isProduction ? "" : localFrontendOrigins)).split(","),
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "",
    process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : ""
].map((origin) => origin.trim()).filter((origin) => Boolean(origin) && !(isProduction && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)));

const mongoOptions = {
    serverSelectionTimeoutMS: Number(process.env.MONGODB_CONNECT_TIMEOUT_MS || 10000),
    maxPoolSize: Number(process.env.MONGODB_MAX_POOL_SIZE || 10)
};
let mongoClient = new MongoClient(mongoUri, mongoOptions);
let db;
let collections;
let eventCovers;
let profileMedia;
let committeeSubmissionFiles;
let databaseReady = false;
let databaseConnectionPromise;

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", isProduction ? 1 : false);
app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
    if (req.path === "/api" || req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
    if (isProduction) res.setHeader("Strict-Transport-Security", "max-age=31536000");
    next();
});
app.use((req, res, next) => cors({
    origin(origin, callback) {
        const requestOrigin = `${req.protocol}://${req.get("host")}`;
        let isLocalViteOrigin = false;
        if (origin) {
            try {
                const parsedOrigin = new URL(origin);
                const portNumber = Number(parsedOrigin.port);
                isLocalViteOrigin = !isProduction && parsedOrigin.protocol === "http:" &&
                    ["localhost", "127.0.0.1"].includes(parsedOrigin.hostname) &&
                    portNumber >= 5173 && portNumber <= 5199;
            } catch { /* Invalid origins are rejected below. */ }
        }
        if (!origin || origin === requestOrigin || allowedOrigins.includes(origin) || isLocalViteOrigin) return callback(null, true);
        return callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
})(req, res, next));
app.use((req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const origin = req.get("Origin");
    if (!origin) return next(); // Non-browser clients may omit Origin; browser form/fetch requests include it.
    const requestOrigin = `${req.protocol}://${req.get("host")}`;
    let isLocalViteOrigin = false;
    try {
        const parsedOrigin = new URL(origin);
        const portNumber = Number(parsedOrigin.port);
        isLocalViteOrigin = !isProduction && parsedOrigin.protocol === "http:" &&
            ["localhost", "127.0.0.1"].includes(parsedOrigin.hostname) && portNumber >= 5173 && portNumber <= 5199;
    } catch { /* Invalid origins are rejected below. */ }
    if (origin === requestOrigin || allowedOrigins.includes(origin) || isLocalViteOrigin) return next();
    return fail(res, 403, "This request origin is not allowed.");
});
app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
    req.requestId = crypto.randomUUID();
    res.setHeader("X-Request-ID", req.requestId);
    next();
});
app.use(async (req, res, next) => {
    if (!isProduction) return next();
    // Let health checks run during an Atlas outage so they can return a safe
    // diagnostic category instead of this middleware's generic 503 response.
    if (req.path === "/api/health") return next();

    const missingConfiguration = [];
    if (!process.env.MONGODB_URI?.trim()) missingConfiguration.push("MONGODB_URI");
    if (configuredSessionSecret.length < 32) missingConfiguration.push("SESSION_SECRET (at least 32 characters)");
    if (missingConfiguration.length) {
        return fail(res, 503, "The API deployment is missing required environment variables.", {
            code: "DEPLOYMENT_CONFIGURATION_MISSING",
            missing_environment_variables: missingConfiguration,
            request_id: req.requestId
        });
    }

    try {
        await ensureDatabaseConnection();
        return next();
    } catch (error) {
        console.error("Vercel API could not connect to MongoDB:", error.name || "Error", mongoFailureCode(error));
        return fail(res, 503, "The database is temporarily unavailable. Check the MongoDB Atlas network access and API environment settings.", {
            code: mongoFailureCode(error),
            database: "mongodb",
            request_id: req.requestId
        });
    }
});

class MongoSessionStore extends session.Store {
    constructor(collection = null) {
        super();
        this.collection = collection;
    }

    get(sessionId, callback) {
        this.collection.findOne({ _id: sessionId, expiresAt: { $gt: new Date() } })
            .then((record) => callback(null, record?.data || null))
            .catch(callback);
    }

    set(sessionId, data, callback = () => {}) {
        const expiresAt = data.cookie?.expires ? new Date(data.cookie.expires) : new Date(Date.now() + 24 * 60 * 60 * 1000);
        this.collection.updateOne(
            { _id: sessionId },
            { $set: { data, expiresAt, updatedAt: new Date() } },
            { upsert: true }
        ).then(() => callback(null)).catch(callback);
    }

    touch(sessionId, data, callback = () => {}) {
        const expiresAt = data.cookie?.expires ? new Date(data.cookie.expires) : new Date(Date.now() + 24 * 60 * 60 * 1000);
        this.collection.updateOne({ _id: sessionId }, { $set: { expiresAt, updatedAt: new Date() } })
            .then(() => callback(null)).catch(callback);
    }

    destroy(sessionId, callback = () => {}) {
        this.collection.deleteOne({ _id: sessionId }).then(() => callback(null)).catch(callback);
    }
}

const sessionStore = new MongoSessionStore();
app.use(session({
    name: "university_events.sid",
    secret: configuredSessionSecret || "local-development-secret-change-before-deployment",
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: sessionCookieSecure,
        maxAge: 24 * 60 * 60 * 1000
    }
}));
async function serveGridFsCover(req, res, next) {
    if (process.env.VERCEL !== "1") return next();
    const match = /^event-([a-f0-9]{24})\.(jpg|png|webp)$/.exec(req.params.filename);
    if (!match) return fail(res, 404, "Image not found.");
    try {
        const fileId = new ObjectId(match[1]);
        const file = await db.collection("event_covers.files").findOne({ _id: fileId });
        if (!file) return fail(res, 404, "Image not found.");
        res.setHeader("Content-Type", file.metadata?.contentType || "application/octet-stream");
        res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
        const download = eventCovers.openDownloadStream(fileId);
        download.on("error", next);
        download.pipe(res);
    } catch (error) { next(error); }
}
app.get("/api/uploads/events/:filename", serveGridFsCover);
app.get("/uploads/events/:filename", serveGridFsCover);
app.use("/uploads", express.static(uploadRoot, { fallthrough: false, index: false, maxAge: "1h" }));

const text = (value) => value == null ? "" : String(value);
const studentIdPattern = /^01-[0-9]{4}-[0-9]{6}$/;
const councilPositions = new Set(["governor", "vice_governor", "secretary", "treasurer", "auditor", "social_media_manager", "department_representative", "advisor", "co_advisor"]);
const executiveCouncilPositions = new Set(["governor", "vice_governor", "secretary", "treasurer", "auditor", "social_media_manager"]);
const votingCouncilPositions = ["governor", "vice_governor", "secretary", "treasurer", "auditor", "social_media_manager", "department_representative"];
const councilDepartments = new Set(["CAS", "CMA", "CELA", "CIT", "COE", "CCJE", "CAHS"]);
const excuseCategories = new Set(["competition", "recognized_organization", "internship", "medical_emergency"]);
const councilCommittees = new Set(["executive", "publication", "program", "production"]);
const registrationCode = () => `REG-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
const studentEventQrMaxLength = 2200;
const qrSigningSecret = configuredSessionSecret.length >= 32 ? configuredSessionSecret : crypto.randomBytes(32);
const identityQr = (studentId) => {
    const normalizedId = text(studentId).trim();
    if (!/^[A-Za-z0-9-]{3,24}$/.test(normalizedId)) return null;
    const unsignedValue = `AUSSC:IDENTITY:${normalizedId}`;
    const signature = crypto.createHmac("sha256", qrSigningSecret).update(unsignedValue).digest("base64url");
    return `${unsignedValue}:${signature}`;
};
function createStudentEventQr(event, user) {
    const encodedPayload = Buffer.from(JSON.stringify({
        version: 1,
        event_id: event.id,
        student_id: user.student_id,
        title: event.title,
        description: event.description
    }), "utf8").toString("base64url");
    const unsignedValue = `AUSSC:STUDENT_EVENT:${encodedPayload}`;
    const signature = crypto.createHmac("sha256", qrSigningSecret).update(unsignedValue).digest("base64url");
    const qrValue = `${unsignedValue}:${signature}`;
    return qrValue.length <= studentEventQrMaxLength ? qrValue : null;
}

function readStudentEventQr(value) {
    if (typeof value !== "string" || value.length > studentEventQrMaxLength) return null;
    const match = /^AUSSC:STUDENT_EVENT:([A-Za-z0-9_-]+):([A-Za-z0-9_-]{43})$/.exec(value);
    if (!match) return null;
    const [, encodedPayload, suppliedSignature] = match;
    const unsignedValue = `AUSSC:STUDENT_EVENT:${encodedPayload}`;
    const expectedSignature = crypto.createHmac("sha256", qrSigningSecret).update(unsignedValue).digest("base64url");
    const supplied = Buffer.from(suppliedSignature);
    const expected = Buffer.from(expectedSignature);
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
    try {
        const payloadBuffer = Buffer.from(encodedPayload, "base64url");
        if (payloadBuffer.toString("base64url") !== encodedPayload) return null;
        const payload = JSON.parse(payloadBuffer.toString("utf8"));
        if (payload?.version !== 1 || !Number.isSafeInteger(payload.event_id) || payload.event_id < 1 ||
            !/^[A-Za-z0-9-]{3,24}$/.test(payload.student_id || "") || typeof payload.title !== "string" ||
            payload.title.length > 255 || typeof payload.description !== "string" || !payload.description.trim()) return null;
        return payload;
    } catch {
        return null;
    }
}
const ok = (res, message, extra = {}) => res.status(200).json(toApi({ success: true, ...(message ? { message } : {}), ...extra }));
const fail = (res, status, message, extra = {}) => res.status(status).json({ success: false, message, ...extra });

function mongoFailureCode(error) {
    const details = [];
    const seen = new Set();
    const pending = [error];
    while (pending.length) {
        const current = pending.pop();
        if (!current || typeof current !== "object" || seen.has(current)) continue;
        seen.add(current);
        details.push(`${current.name || ""} ${current.codeName || ""} ${current.code || ""} ${current.message || ""}`);
        pending.push(current.cause);
        const servers = current.reason?.servers;
        if (servers instanceof Map) {
            for (const server of servers.values()) pending.push(server.error);
        }
    }
    const text = details.join(" ").toLowerCase();
    if (/authenticationfailed|bad auth|authentication failed|auth failed/.test(text) || /\bcode 18\b/.test(text)) {
        return "MONGODB_AUTHENTICATION_FAILED";
    }
    if (/unauthorized|not authorized/.test(text) || /\bcode 13\b/.test(text)) {
        return "MONGODB_PERMISSION_DENIED";
    }
    if (/querysrv|enotfound|eai_again|getaddrinfo/.test(text)) return "MONGODB_DNS_UNAVAILABLE";
    if (/econnrefused|etimedout|ehostunreach|enetunreach|mongonetworkerror|mongoserverselectionerror/.test(text)) {
        return "MONGODB_NETWORK_UNAVAILABLE";
    }
    return "MONGODB_CONNECTION_FAILED";
}
const signedIn = (req, res, next) => req.session?.userId ? next() : fail(res, 401, "You must be signed in to continue.");

function hasExecutiveAccess(user) {
    return user?.role === "admin" || user?.committee_assignment === "executive" || executiveCouncilPositions.has(user?.council_position);
}

async function getSessionUser(req) {
    if (!req.session?.userId) return null;
    return collections.users.findOne({ id: Number(req.session.userId) }, {
        projection: { id: 1, role: 1, council_position: 1, council_department: 1, committee_assignment: 1 }
    });
}

async function executiveAccess(req, res, next) {
    if (!req.session?.userId) return fail(res, 401, "You must be signed in to continue.");
    try {
        const user = await getSessionUser(req);
        if (!user || !hasExecutiveAccess(user)) return fail(res, 403, "Executive committee or administrator access is required.");
        req.councilUser = user;
        next();
    } catch (error) { next(error); }
}

const adminOnly = executiveAccess;

async function committeeWorkspaceAccess(req, res, next) {
    if (!req.session?.userId) return fail(res, 401, "You must be signed in to continue.");
    try {
        const user = await getSessionUser(req);
        if (!user) return fail(res, 403, "A current committee assignment is required.");
        req.councilUser = user;
        if (hasExecutiveAccess(user)) return next();

        const assignedCommittee = user.committee_assignment;
        if (!councilCommittees.has(assignedCommittee) || assignedCommittee === "executive") {
            return fail(res, 403, "A current committee assignment is required.");
        }
        req.workspaceCommittee = assignedCommittee;

        const requestedCommittee = text(req.query.committee || req.body?.committee).trim().toLowerCase();
        if (requestedCommittee && requestedCommittee !== assignedCommittee) {
            return fail(res, 403, "You can only access your assigned committee workspace.");
        }

        const itemId = Number(req.body?.id || req.body?.item_id || 0);
        if (itemId) {
            const item = await collections.committeeWorkItems.findOne({ id: itemId }, { projection: { committee: 1 } });
            if (!item || item.committee !== assignedCommittee) {
                return fail(res, 403, "You can only manage items in your assigned committee workspace.");
            }
        }
        next();
    } catch (error) { next(error); }
}

function councilAccess(positions = [], allowAdmin = true) {
    return async (req, res, next) => {
        if (!req.session?.userId) return fail(res, 401, "You must be signed in to continue.");
        try {
            const user = await getSessionUser(req);
            if (allowAdmin && hasExecutiveAccess(user)) { req.councilUser = user; return next(); }
            if (user?.committee_assignment && user.committee_assignment !== "executive") {
                return fail(res, 403, "Your account is limited to its assigned committee workspace.");
            }
            if (!user || !councilPositions.has(user.council_position)) return fail(res, 403, "A current A.U.S.S.C. council appointment is required.");
            if (positions.length && !positions.includes(user.council_position)) return fail(res, 403, "Your council appointment does not have permission for this action.");
            req.councilUser = user;
            next();
        } catch (error) { next(error); }
    };
}

function votingCouncilMember(req, res, next) {
    return councilAccess(votingCouncilPositions, false)(req, res, next);
}

function toApi(value) {
    if (value instanceof Date) {
        const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
        }).formatToParts(value).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
        return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
    }
    if (Array.isArray(value)) return value.map(toApi);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value)
            .filter(([key]) => key !== "_id" && key !== "passwordHash")
            .map(([key, item]) => [key, toApi(item)]));
    }
    return value;
}

async function nextId(name) {
    const result = await collections.counters.findOneAndUpdate(
        { _id: name }, { $inc: { value: 1 } }, { upsert: true, returnDocument: "after" }
    );
    const document = result?.value && typeof result.value === "object" ? result.value : result;
    return document.value;
}

function parseDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value || "")) return null;
    const [year, month, day, hour, minute] = value.split(/[T:-]/).map(Number);
    const date = new Date(`${value}:00+08:00`);
    if (Number.isNaN(date.getTime())) return null;
    const manila = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
    if (Number(manila.year) !== year || Number(manila.month) !== month || Number(manila.day) !== day || Number(manila.hour) !== hour || Number(manila.minute) !== minute) return null;
    return date;
}

function displayStatus(event, now = new Date()) {
    if (event.status === "cancelled" || event.publication_status === "cancelled") return "cancelled";
    if (event.start_date <= now && event.end_date >= now) return "ongoing";
    if (event.end_date < now) return "completed";
    return "upcoming";
}

function withEventStatus(event) {
    return { ...event, display_status: displayStatus(event) };
}

function publishedEventQuery() {
    return { $or: [{ publication_status: "published" }, { publication_status: { $exists: false } }] };
}

function publicUser(user) {
    if (!user) return null;
    const { passwordHash, ...safe } = user;
    return safe;
}

function duplicateKey(error) {
    return error?.code === 11000;
}

function passwordResetDigest(email, value) {
    return crypto.createHmac("sha256", process.env.PASSWORD_RESET_SECRET).update(`${email}\0${value}`).digest("hex");
}

function safeDigestEqual(a, b) {
    if (!/^[a-f0-9]{64}$/i.test(a || "") || !/^[a-f0-9]{64}$/i.test(b || "")) return false;
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

async function consumeRequestLimit(scope, subject, limit, windowMs) {
    const now = new Date();
    const nextResetAt = new Date(now.getTime() + windowMs);
    const hmacKey = configuredSessionSecret || "local-development-secret-change-before-deployment";
    const id = crypto.createHmac("sha256", hmacKey).update(`${scope}\0${subject}`).digest("hex");
    const result = await collections.rateLimits.findOneAndUpdate(
        { _id: id },
        [{ $set: {
            count: { $cond: [{ $gt: ["$resetAt", now] }, { $add: [{ $ifNull: ["$count", 0] }, 1] }, 1] },
            resetAt: { $cond: [{ $gt: ["$resetAt", now] }, "$resetAt", nextResetAt] }
        } }],
        { upsert: true, returnDocument: "after" }
    );
    const record = result?.value && typeof result.value === "object" ? result.value : result;
    const retryAfterSeconds = Math.max(1, Math.ceil((new Date(record.resetAt).getTime() - now.getTime()) / 1000));
    return { limited: Number(record.count) > limit, retryAfterSeconds };
}

function requestIp(req) {
    return req.ip || req.socket?.remoteAddress || "unknown";
}

function rejectRateLimited(res, rateLimits) {
    const blocked = rateLimits.filter((result) => result.limited);
    if (!blocked.length) return false;
    res.setHeader("Retry-After", String(Math.max(...blocked.map((result) => result.retryAfterSeconds))));
    fail(res, 429, "Too many requests. Please wait before trying again.");
    return true;
}

async function sendPasswordResetEmail(email, code) {
    const apiKey = process.env.BREVO_API_KEY;
    const senderEmail = process.env.BREVO_SENDER_EMAIL;
    if (!apiKey || !senderEmail) throw new Error("Brevo is not configured.");

    const senderName = process.env.BREVO_SENDER_NAME || "Araullo University South Student Council";
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        signal: AbortSignal.timeout(10000),
        headers: { accept: "application/json", "api-key": apiKey, "content-type": "application/json" },
        body: JSON.stringify({
            sender: { name: senderName, email: senderEmail },
            to: [{ email }],
            subject: "Your student council portal password reset code",
            htmlContent: `<html><body style="margin:0;background:#f5f7fa;padding:32px;font-family:Arial,sans-serif;color:#172338"><div style="max-width:520px;margin:auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:32px"><p style="margin:0 0 8px;color:#8a5e0b;font-size:12px;font-weight:bold;letter-spacing:2px">PASSWORD RESET</p><h1 style="margin:0 0 18px;font-size:24px">Your verification code</h1><p style="color:#64748b;line-height:1.6">Enter this code to reset your student council portal password. It expires in 10 minutes.</p><div style="margin:24px 0;padding:16px;background:#f5f7fa;border-radius:12px;text-align:center;font-size:32px;font-weight:bold;letter-spacing:10px;color:#0b1f3a">${code}</div><p style="color:#64748b;font-size:13px">If you did not request this code, you can ignore this email.</p></div></body></html>`,
            textContent: `Your password reset code is ${code}. It expires in 10 minutes. If you did not request this code, ignore this email.`
        })
    });

    if (!response.ok) {
        console.error(`Brevo password reset email failed with status ${response.status}.`);
        throw new Error("Brevo rejected the email request.");
    }
}

app.get("/api/health", async (req, res) => {
    const missingConfiguration = [];
    if (isProduction) {
        if (!process.env.MONGODB_URI?.trim()) missingConfiguration.push("MONGODB_URI");
        if (configuredSessionSecret.length < 32) missingConfiguration.push("SESSION_SECRET");
    }
    if (missingConfiguration.length) {
        return fail(res, 503, "The API deployment is missing required environment variables.", {
            status: "not_ready", database: "mongodb", code: "DEPLOYMENT_CONFIGURATION_MISSING",
            missing_environment_variables: missingConfiguration, request_id: req.requestId
        });
    }
    try {
        await ensureDatabaseConnection();
        await db.command({ ping: 1 });
        await collections.users.findOne({}, { projection: { _id: 1 } });

        databaseReady = true;
        return ok(res, null, { status: "ready", database: "mongodb" });
    } catch (error) {
        databaseReady = false;
        console.error("MongoDB health check failed:", error.name || "Error", mongoFailureCode(error));
        return fail(res, 503, "MongoDB is not ready. Use the diagnostic code to check Atlas access, credentials, and database permissions.", {
            status: "not_ready", database: "mongodb", code: mongoFailureCode(error), request_id: req.requestId
        });
    }
});

// Keep API failures explicit while MongoDB is unavailable. This also avoids
// downstream handlers dereferencing collections before the first connection.
app.use("/api", (req, res, next) => {
    if (databaseReady && collections) return next();
    return fail(res, 503, "The database is temporarily unavailable. The API is retrying its MongoDB connection.", {
        code: "DATABASE_UNAVAILABLE",
        database: "mongodb",
        status: "not_ready",
        request_id: req.requestId
    });
});

// Authentication
app.post("/api/auth/register", async (req, res, next) => {
    const studentId = text(req.body.student_id).trim();
    const first = text(req.body.first_name).trim();
    const last = text(req.body.last_name).trim();
    const email = text(req.body.email).trim().toLowerCase();
    const password = text(req.body.password);
    const course = text(req.body.course).trim();
    const year = text(req.body.year_level).trim();
    if (![studentId, first, last, email, password, course, year].every(Boolean)) return fail(res, 422, "Please complete all required fields.");
    if (!studentIdPattern.test(studentId)) return fail(res, 422, "Student ID must use the format 01-1234-123456.");
    if (!/^[^\s@]+@phinmaed\.com$/i.test(email)) return fail(res, 422, "Please use your @phinmaed.com email address.");
    if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) return fail(res, 422, "Password must be at least 8 characters and no more than 72 UTF-8 bytes.");
    try {
        if (rejectRateLimited(res, [await consumeRequestLimit("register-ip", requestIp(req), 12, 60 * 60 * 1000)])) return;
        const user = {
            id: await nextId("users"), student_id: studentId, first_name: first, last_name: last,
            email, passwordHash: await bcrypt.hash(password, 12), course, year_level: year,
            role: "student", created_at: new Date()
        };
        await collections.users.insertOne(user);
        return ok(res, "Account created successfully.");
    } catch (error) {
        if (duplicateKey(error)) return fail(res, 409, "A student account with that ID or email already exists.");
        return next(error);
    }
});

app.post("/api/auth/login", async (req, res, next) => {
    const identifier = text(req.body.email || req.body.identifier).trim();
    const password = text(req.body.password);
    if (!identifier || !password) return fail(res, 422, "Please enter your email or student ID and password.");
    if (identifier.includes("@") && !/^[^\s@]+@phinmaed\.com$/i.test(identifier)) return fail(res, 422, "Please use your @phinmaed.com email address.");
    if (!identifier.includes("@") && !studentIdPattern.test(identifier)) return fail(res, 422, "Student ID must use the format 01-1234-123456.");
    if (Buffer.byteLength(password, "utf8") > 72) return fail(res, 422, "Password is too long.");
    try {
        const ip = requestIp(req);
        const limits = await Promise.all([
            consumeRequestLimit("login-ip", ip, 60, 15 * 60 * 1000),
            consumeRequestLimit("login-ip-identifier", `${ip}\0${identifier.toLowerCase()}`, 10, 15 * 60 * 1000)
        ]);
        if (rejectRateLimited(res, limits)) return;
        const user = await collections.users.findOne({
            $or: [
                { email: identifier.toLowerCase() },
                { student_id: identifier }
            ]
        });
        if (!user || !(await bcrypt.compare(password, String(user.passwordHash || "").replace(/^\$2y\$/, "$2a$")))) {
            return fail(res, 401, "Invalid email or password.");
        }
        req.session.regenerate((error) => {
            if (error) return next(error);
            req.session.userId = Number(user.id);
            req.session.role = user.role;
            req.session.cookie.maxAge = req.body.remember_me ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
            return ok(res, "Login successful.", { user: publicUser(user) });
        });
    } catch (error) { return next(error); }
});

const resetRequestMessage = "If an account matches that PHINMA Education email, a verification code will be sent shortly.";

app.post("/api/auth/forgot-password/request", async (req, res, next) => {
    const email = text(req.body.email).trim().toLowerCase();
    if (!/^[^\s@]+@phinmaed\.com$/i.test(email)) return fail(res, 422, "Use your @phinmaed.com email address.");
    if (!process.env.BREVO_API_KEY || !process.env.BREVO_SENDER_EMAIL || (process.env.PASSWORD_RESET_SECRET || "").length < 32) return fail(res, 503, "Password reset is not configured. Set the Brevo API key, verified sender, and a 32-character PASSWORD_RESET_SECRET in backend/.env.");

    try {
        if (rejectRateLimited(res, [await consumeRequestLimit("password-reset-request-ip", requestIp(req), 12, 60 * 60 * 1000)])) return;
        const user = await collections.users.findOne({ email });
        if (!user) return ok(res, resetRequestMessage);

        const now = new Date();
        const existing = await collections.passwordResetOtps.findOne({ email });
        const priorWindowStart = existing?.windowStartedAt ? new Date(existing.windowStartedAt) : null;
        const sameWindow = priorWindowStart && now.getTime() - priorWindowStart.getTime() < 60 * 60 * 1000;
        const windowStartedAt = sameWindow ? priorWindowStart : now;
        const requestCount = sameWindow ? Number(existing.requestCount || 0) : 0;
        const lastSentAt = existing?.lastSentAt ? new Date(existing.lastSentAt) : null;
        if ((lastSentAt && now.getTime() - lastSentAt.getTime() < 60 * 1000) || requestCount >= 3) {
            return ok(res, resetRequestMessage);
        }

        const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
        const codeHash = passwordResetDigest(email, code);
        const expiresAt = new Date(windowStartedAt.getTime() + 60 * 60 * 1000);
        await collections.passwordResetOtps.updateOne(
            { email },
            { $set: {
                email, codeHash, attempts: 0, requestCount: requestCount + 1,
                windowStartedAt, lastSentAt: now, codeExpiresAt: new Date(now.getTime() + 10 * 60 * 1000),
                expiresAt, resetTokenHash: null, verifiedAt: null
            } },
            { upsert: true }
        );

        try {
            await sendPasswordResetEmail(email, code);
        } catch (emailError) {
            console.error("Password reset email could not be sent:", emailError?.name || "Error");
            await collections.passwordResetOtps.updateOne(
                { email, codeHash },
                { $set: { requestCount, lastSentAt: new Date(now.getTime() - 60_001) }, $unset: { codeHash: "", codeExpiresAt: "" } }
            );
            return fail(res, 502, "The email could not be sent right now. Please try again later.");
        }

        return ok(res, resetRequestMessage);
    } catch (error) { return next(error); }
});

app.post("/api/auth/forgot-password/verify", async (req, res, next) => {
    const email = text(req.body.email).trim().toLowerCase();
    const code = text(req.body.code).trim();
    if (!/^[^\s@]+@phinmaed\.com$/i.test(email) || !/^\d{6}$/.test(code)) return fail(res, 422, "Enter the PHINMA email and 6-digit code.");
    if ((process.env.PASSWORD_RESET_SECRET || "").length < 32) return fail(res, 503, "Password reset is not configured. Set PASSWORD_RESET_SECRET in backend/.env.");
    try {
        if (rejectRateLimited(res, [await consumeRequestLimit("password-reset-verify-ip", requestIp(req), 30, 60 * 60 * 1000)])) return;
        const now = new Date();
        const resetRecord = await collections.passwordResetOtps.findOne({ email, codeExpiresAt: { $gt: now } });
        if (!resetRecord || resetRecord.attempts >= 5 || !safeDigestEqual(passwordResetDigest(email, code), resetRecord.codeHash)) {
            if (resetRecord && resetRecord.attempts < 5) {
                await collections.passwordResetOtps.updateOne({ _id: resetRecord._id, attempts: { $lt: 5 } }, { $inc: { attempts: 1 } });
            }
            return fail(res, 400, "That code is invalid or expired. Check it and try again.");
        }

        const resetToken = crypto.randomBytes(32).toString("base64url");
        const updated = await collections.passwordResetOtps.updateOne(
            { _id: resetRecord._id, codeHash: resetRecord.codeHash, attempts: { $lt: 5 }, codeExpiresAt: { $gt: now } },
            { $set: { resetTokenHash: passwordResetDigest(email, resetToken), verifiedAt: now, codeExpiresAt: new Date(now.getTime() + 10 * 60 * 1000) }, $unset: { codeHash: "" } }
        );
        if (!updated.modifiedCount) return fail(res, 400, "That code is invalid or expired. Check it and try again.");
        return ok(res, "Code verified. Set a new password.", { reset_token: resetToken });
    } catch (error) { return next(error); }
});

app.post("/api/auth/forgot-password/reset", async (req, res, next) => {
    const email = text(req.body.email).trim().toLowerCase();
    const resetToken = text(req.body.reset_token);
    const password = text(req.body.password);
    if (!/^[^\s@]+@phinmaed\.com$/i.test(email) || !resetToken) return fail(res, 422, "Restart password recovery and verify your email code.");
    if ((process.env.PASSWORD_RESET_SECRET || "").length < 32) return fail(res, 503, "Password reset is not configured. Set PASSWORD_RESET_SECRET in backend/.env.");
    if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) return fail(res, 422, "Password must be at least 8 characters and no more than 72 UTF-8 bytes.");
    try {
        if (rejectRateLimited(res, [await consumeRequestLimit("password-reset-finish-ip", requestIp(req), 12, 60 * 60 * 1000)])) return;
        const now = new Date();
        const record = await collections.passwordResetOtps.findOne({ email, codeExpiresAt: { $gt: now } });
        if (!record || !record.resetTokenHash || !safeDigestEqual(passwordResetDigest(email, resetToken), record.resetTokenHash)) {
            return fail(res, 400, "Your reset session expired. Request a new verification code.");
        }
        const claimed = await collections.passwordResetOtps.updateOne(
            { _id: record._id, resetTokenHash: record.resetTokenHash, consumedAt: { $exists: false }, codeExpiresAt: { $gt: now } },
            { $set: { consumedAt: now } }
        );
        if (!claimed.modifiedCount) return fail(res, 400, "Your reset session expired. Request a new verification code.");

        await collections.users.updateOne({ email }, { $set: { passwordHash: await bcrypt.hash(password, 12), password_updated_at: now } });
        await collections.passwordResetOtps.deleteOne({ _id: record._id });
        return ok(res, "Your password has been reset. You can now sign in.");
    } catch (error) { return next(error); }
});

app.post("/api/auth/logout", (req, res, next) => {
    req.session.destroy((error) => {
        if (error) return next(error);
        res.clearCookie("university_events.sid", { httpOnly: true, sameSite: "lax", secure: sessionCookieSecure });
        return ok(res, "Logged out successfully.");
    });
});

app.get("/api/auth/me", signedIn, async (req, res, next) => {
    try {
        const user = await collections.users.findOne({ id: Number(req.session.userId) });
        if (!user) return fail(res, 401, "User not found.");
        return ok(res, null, { user: publicUser(user) });
    } catch (error) { return next(error); }
});

app.get("/api/profile/media/:fileId", signedIn, async (req, res, next) => {
    if (!/^[a-f0-9]{24}$/i.test(req.params.fileId)) return fail(res, 404, "Profile image not found.");
    try {
        const fileId = new ObjectId(req.params.fileId);
        const file = await db.collection("profile_media.files").findOne({ _id: fileId, "metadata.owner_user_id": Number(req.session.userId) });
        if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.contentType)) return fail(res, 404, "Profile image not found.");
        res.setHeader("Content-Type", file.contentType);
        res.setHeader("Cache-Control", "private, no-store");
        const download = profileMedia.openDownloadStream(fileId);
        download.on("error", next);
        download.pipe(res);
    } catch (error) { next(error); }
});

app.get("/api/committees/directory", async (_req, res, next) => {
    try {
        const memberQuery = {
            $or: [
                { committee_assignment: { $in: [...councilCommittees] } },
                { council_position: { $in: [...executiveCouncilPositions] } }
            ]
        };
        const users = await collections.users.find(memberQuery, {
            projection: {
                _id: 0, first_name: 1, last_name: 1, committee_assignment: 1,
                council_position: 1, council_department: 1, profile_picture: 1, cover_photo: 1
            }
        }).sort({ last_name: 1, first_name: 1 }).toArray();
        const committees = Object.fromEntries([...councilCommittees].map((committee) => [committee, []]));
        const publicMediaUrl = (url) => {
            const match = /^\/api\/profile\/media\/([a-f0-9]{24})$/i.exec(url || "");
            return match ? `/api/committees/media/${match[1]}` : "";
        };

        for (const user of users) {
            const member = {
                first_name: user.first_name || "",
                last_name: user.last_name || "",
                council_position: user.council_position || "",
                council_department: user.council_department || "",
                profile_picture: publicMediaUrl(user.profile_picture),
                cover_photo: publicMediaUrl(user.cover_photo)
            };
            if (executiveCouncilPositions.has(user.council_position) || user.committee_assignment === "executive") {
                committees.executive.push(member);
            }
            if (user.committee_assignment && user.committee_assignment !== "executive" && committees[user.committee_assignment]) {
                committees[user.committee_assignment].push(member);
            }
        }
        return ok(res, null, { committees });
    } catch (error) { return next(error); }
});

app.get("/api/committees/media/:fileId", async (req, res, next) => {
    if (!/^[a-f0-9]{24}$/i.test(req.params.fileId)) return fail(res, 404, "Committee profile image not found.");
    try {
        const fileId = new ObjectId(req.params.fileId);
        const file = await db.collection("profile_media.files").findOne({ _id: fileId });
        const ownerId = Number(file?.metadata?.owner_user_id);
        const imageField = file?.metadata?.kind === "profile" ? "profile_picture" : file?.metadata?.kind === "cover" ? "cover_photo" : "";
        if (!file || !imageField || !["image/jpeg", "image/png", "image/webp"].includes(file.contentType)) {
            return fail(res, 404, "Committee profile image not found.");
        }
        const memberQuery = {
            id: ownerId,
            [imageField]: `/api/profile/media/${fileId.toHexString()}`,
            $or: [
                { committee_assignment: { $in: [...councilCommittees] } },
                { council_position: { $in: [...executiveCouncilPositions] } }
            ]
        };
        if (!await collections.users.findOne(memberQuery, { projection: { id: 1 } })) {
            return fail(res, 404, "Committee profile image not found.");
        }
        res.setHeader("Content-Type", file.contentType);
        res.setHeader("Cache-Control", "public, max-age=300");
        res.setHeader("X-Content-Type-Options", "nosniff");
        const download = profileMedia.openDownloadStream(fileId);
        download.on("error", next);
        download.pipe(res);
    } catch (error) { return next(error); }
});

// Public event discovery
app.get("/api/events/updates", async (_req, res, next) => {
    try {
        const cutoff = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
        const updates = await collections.events.find({
            $and: [
                {
                    $or: [
                        { public_updated_at: { $gte: cutoff } },
                        { public_updated_at: { $exists: false }, updated_at: { $gte: cutoff } },
                        { public_updated_at: { $exists: false }, updated_at: { $exists: false }, created_at: { $gte: cutoff } },
                        { public_updated_at: { $exists: false }, updated_at: { $exists: false }, publication_history: { $elemMatch: { decision: "approve", status: "published", at: { $gte: cutoff } } } }
                    ]
                },
                {
                    $or: [
                        { publication_status: "published" },
                        { publication_status: "cancelled" },
                        { publication_status: { $exists: false } }
                    ]
                }
            ]
        }).sort({ public_updated_at: -1, updated_at: -1, created_at: -1 }).limit(50).toArray();
        return ok(res, null, { updates: updates.map(withEventStatus) });
    } catch (error) { return next(error); }
});

app.get("/api/announcements/list", async (_req, res, next) => {
    try {
        const announcements = await collections.publicAnnouncements.find({ status: "published" }, {
            projection: { id: 1, title: 1, category: 1, content: 1, published_at: 1, public_updated_at: 1, created_at: 1 }
        })
            .sort({ public_updated_at: -1, published_at: -1 })
            .limit(50)
            .toArray();
        return ok(res, null, { announcements });
    } catch (error) { return next(error); }
});

app.get("/api/events/list", async (_req, res, next) => {
    try {
        const events = await collections.events.find({ status: { $ne: "cancelled" }, ...publishedEventQuery() }).sort({ start_date: -1 }).toArray();
        return ok(res, null, { events: events.map(withEventStatus) });
    } catch (error) { return next(error); }
});

app.get("/api/events/upcoming", async (_req, res, next) => {
    try {
        const event = await collections.events.findOne({ status: { $ne: "cancelled" }, end_date: { $gte: new Date() }, ...publishedEventQuery() }, { sort: { start_date: 1 } });
        return ok(res, null, { event: event ? withEventStatus(event) : null });
    } catch (error) { return next(error); }
});

app.get("/api/events/previous", async (_req, res, next) => {
    try {
        const events = await collections.events.find({ status: { $ne: "cancelled" }, end_date: { $lt: new Date() }, ...publishedEventQuery() }).sort({ start_date: -1 }).toArray();
        return ok(res, null, { events: events.map((event) => ({ ...event, display_status: "completed" })) });
    } catch (error) { return next(error); }
});

app.get("/api/events/event", async (req, res, next) => {
    const id = Number(req.query.id);
    if (!Number.isInteger(id) || id < 1) return fail(res, 422, "Event ID is required.");
    try {
        let event = await collections.events.findOne({ id, $or: [{ publication_status: "published" }, { publication_status: { $exists: false } }, { publication_status: "cancelled" }] });
        let councilResponse = null;
        let canRespond = false;
        let studentParticipation = null;
        let studentCanParticipate = false;
        let studentCanGenerateQr = false;
        if (req.session?.userId) {
            const member = await collections.users.findOne({ id: Number(req.session.userId) }, { projection: { id: 1, role: 1, student_id: 1, council_position: 1, committee_assignment: 1 } });
            const invitedCouncilMember = isEventInvitee(member, event);
            canRespond = invitedCouncilMember && isCouncilParticipationOpen(event);
            if (invitedCouncilMember) {
                councilResponse = await collections.eventResponses.findOne({ event_id: id, user_id: member.id });
                if (!event && councilResponse) event = await collections.events.findOne({ id, status: { $nin: ["cancelled", "archived"] }, publication_status: { $nin: ["cancelled", "archived"] } });
            }
            if (member?.role === "student" && !canRespond) {
                studentParticipation = await collections.studentEventParticipations.findOne({ event_id: id, user_id: member.id });
                studentCanParticipate = Boolean(event && !["cancelled", "completed", "archived"].includes(event.status) && event.publication_status !== "cancelled" && event.publication_status !== "archived" && new Date(event.end_date) >= new Date());
                studentCanGenerateQr = Boolean(studentCanParticipate && studentParticipation?.status === "accepted" && /^[A-Za-z0-9-]{3,24}$/.test(member.student_id || ""));
            }
        }
        if (!event) return fail(res, 404, "Event not found.");
        const studentCanSignInForParticipation = Boolean(!req.session?.userId && !["cancelled", "completed", "archived"].includes(event.status) && event.publication_status !== "cancelled" && event.publication_status !== "archived" && new Date(event.end_date) >= new Date());
        return ok(res, null, { event: withEventStatus(event), council_can_respond: canRespond, council_response: councilResponse ? { id: councilResponse.id, status: councilResponse.status, responded_at: councilResponse.responded_at || null } : null, student_can_participate: studentCanParticipate, student_needs_sign_in: studentCanSignInForParticipation, student_participation: studentParticipation ? { status: studentParticipation.status, agreed_at: studentParticipation.agreed_at || null, updated_at: studentParticipation.updated_at || null } : null, student_can_generate_qr: studentCanGenerateQr });
    } catch (error) { return next(error); }
});

app.get("/api/attendance/student-event-qr", signedIn, async (req, res, next) => {
    const eventId = Number(req.query.event_id);
    if (!Number.isInteger(eventId) || eventId < 1) return fail(res, 422, "Choose a valid event.");
    try {
        const user = await collections.users.findOne({ id: Number(req.session.userId) }, { projection: { id: 1, role: 1, student_id: 1, council_position: 1, committee_assignment: 1 } });
        if (!user || user.role !== "student" || isAuthorizedCouncilMember(user, councilPositions, councilCommittees)) return fail(res, 403, "Event-specific attendance QRs are available to student accounts. Council members use their reusable identity QR.");
        if (!/^[A-Za-z0-9-]{3,24}$/.test(user.student_id || "")) return fail(res, 422, "Add a valid student ID to your profile before generating an event QR.");
        const event = await collections.events.findOne({ id: eventId, ...publishedEventQuery(), status: { $nin: ["cancelled", "completed", "archived"] }, publication_status: { $nin: ["cancelled", "archived"] } });
        if (!event || !event.end_date || new Date(event.end_date) < new Date()) return fail(res, 404, "This event is not available for a student attendance QR.");
        const participation = await collections.studentEventParticipations.findOne({ event_id: eventId, user_id: user.id, status: "accepted" }, { projection: { id: 1 } });
        if (!participation) return fail(res, 403, "Agree to participate from this event page before generating its QR.");
        const qrValue = createStudentEventQr(event, user);
        if (!qrValue) return fail(res, 422, "This event description is too long to fit in a QR code. Contact the council for an attendance pass.");
        return ok(res, "Event-specific attendance QR generated.", { qr_value: qrValue, event: { id: event.id, title: event.title, description: event.description } });
    } catch (error) { return next(error); }
});

app.get("/api/events/highlights", async (req, res, next) => {
    const eventId = Number(req.query.event_id);
    if (!Number.isInteger(eventId) || eventId < 1) return fail(res, 422, "A valid event ID is required.");
    try {
        if (!await collections.events.findOne({ id: eventId, ...publishedEventQuery(), status: { $ne: "cancelled" } }, { projection: { id: 1 } })) return fail(res, 404, "Event not found.");
        const highlights = await collections.event_highlights.find({ event_id: eventId }).sort({ created_at: -1 }).toArray();
        return ok(res, null, { highlights });
    } catch (error) { return next(error); }
});

// The old student sign-up endpoint remains in place for compatibility but no longer creates records.
app.post("/api/registration/create", signedIn, (_req, res) => fail(res, 410, "Student event sign-ups are no longer used. Event attendance is recorded separately at the event."));

app.get("/api/registration/my", signedIn, async (req, res, next) => {
    try {
        const registrations = await collections.registrations.find({ user_id: Number(req.session.userId) }).sort({ registered_at: -1 }).toArray();
        const eventIds = registrations.map((registration) => registration.event_id);
        const events = await collections.events.find({ id: { $in: eventIds } }).toArray();
        const eventMap = new Map(events.map((event) => [event.id, event]));
        const rows = await Promise.all(registrations.map(async (registration) => {
            const event = eventMap.get(registration.event_id);
            if (!event) return null;
            const attendance = await collections.attendance.findOne({ $or: [{ registration_id: registration.id }, { participant_key: `event:${event.id}:user:${registration.user_id}` }] }, { sort: { time_in: -1 } });
            return {
                registration_id: registration.id, registration_code: registration.registration_code,
                status: registration.status, registered_at: registration.registered_at,
                attendance: attendance ? { time_in: attendance.time_in, time_out: attendance.time_out || null, currently_present: !attendance.time_out } : null,
                event_id: event.id, title: event.title, description: event.description,
                location: event.location, start_date: event.start_date, end_date: event.end_date,
                cover_image: event.cover_image, event_status: event.status,
                self_service_checkin: Boolean(event.self_service_checkin), self_service_checkout: Boolean(event.self_service_checkout)
            };
        })).then((rows) => rows.filter(Boolean));
        return ok(res, null, { events: rows });
    } catch (error) { return next(error); }
});

// Event responses are kept separate from task assignments and attendance.
app.get("/api/participation/mine", signedIn, async (req, res, next) => {
    try {
        const member = await collections.users.findOne({ id: Number(req.session.userId) }, { projection: { id: 1, role: 1, council_position: 1, committee_assignment: 1 } });
        if (!isAuthorizedCouncilMember(member, councilPositions, councilCommittees)) return fail(res, 403, "A current council appointment or committee assignment is required.");
        const responses = await collections.eventResponses.find({ user_id: member.id }).sort({ created_at: -1 }).toArray();
        const eventIds = [...new Set(responses.map((response) => response.event_id))];
        const events = await collections.events.find({ id: { $in: eventIds } }).toArray();
        const eventMap = new Map(events.map((event) => [event.id, event]));
        return ok(res, null, { responses: responses.map((response) => {
            const event = eventMap.get(response.event_id);
            return event ? { ...response, event: { id: event.id, title: event.title, description: event.description, location: event.location, start_date: event.start_date, end_date: event.end_date, display_status: displayStatus(event), publication_status: event.publication_status || "published" } } : null;
        }).filter(Boolean) });
    } catch (error) { return next(error); }
});

app.post("/api/participation/respond", signedIn, async (req, res, next) => {
    const eventId = Number(req.body.event_id);
    const status = text(req.body.status).trim();
    if (!Number.isSafeInteger(eventId) || eventId < 1 || !["accepted", "declined"].includes(status)) return fail(res, 422, "Choose an event and accept or decline participation.");
    try {
        const member = await collections.users.findOne({ id: Number(req.session.userId) }, { projection: { id: 1, role: 1, council_position: 1, committee_assignment: 1 } });
        if (!isAuthorizedCouncilMember(member, councilPositions, councilCommittees)) return fail(res, 403, "Only current council members can update participation.");
        const event = await collections.events.findOne({ id: eventId });
        if (!event || ["cancelled", "archived"].includes(event.status) || ["cancelled", "archived"].includes(event.publication_status)) return fail(res, 404, "This event is unavailable for participation.");
        if (!isEventInvitee(member, event)) return fail(res, 403, "You are not included in this event’s council invitation.");
        if (!isCouncilParticipationOpen(event)) return fail(res, 409, "Council participation responses are closed for this event.");
        const now = new Date();
        const responseFilter = { event_id: eventId, user_id: member.id };
        try {
            await collections.eventResponses.updateOne(responseFilter, { $setOnInsert: { id: await nextId("event_responses"), event_id: eventId, user_id: member.id, status: "pending", created_at: now, history: [] } }, { upsert: true });
        } catch (error) { if (!duplicateKey(error)) throw error; }
        const current = await collections.eventResponses.findOne(responseFilter);
        const updated = await collections.eventResponses.updateOne({ ...responseFilter, id: current.id }, {
            $set: { status, responded_at: now, updated_at: now, response_source: "member" },
            $push: { history: { status, changed_at: now, changed_by: member.id, source: "member" } }
        });
        if (!updated.matchedCount) return fail(res, 409, "This participation status changed. Refresh and try again.");
        return ok(res, status === "accepted" ? "Participation accepted." : "Participation declined.", { response: { id: current.id, event_id: eventId, user_id: member.id, status, responded_at: now } });
    } catch (error) { return next(error); }
});

app.post("/api/participation/student/respond", signedIn, async (req, res, next) => {
    const eventId = Number(req.body.event_id);
    const status = text(req.body.status).trim();
    if (!Number.isSafeInteger(eventId) || eventId < 1 || !["accepted", "withdrawn"].includes(status)) return fail(res, 422, "Choose an event and confirm or withdraw your participation.");
    try {
        const student = await collections.users.findOne({ id: Number(req.session.userId) }, { projection: { id: 1, role: 1, student_id: 1, council_position: 1, committee_assignment: 1 } });
        if (!student || student.role !== "student" || isAuthorizedCouncilMember(student, councilPositions, councilCommittees)) return fail(res, 403, "Student event participation is available to student accounts. Council members use council participation.");
        const event = await collections.events.findOne({ id: eventId, ...publishedEventQuery(), status: { $nin: ["cancelled", "completed", "archived"] }, publication_status: { $nin: ["cancelled", "archived"] } });
        if (!event || !event.end_date || new Date(event.end_date) < new Date()) return fail(res, 404, "This event is unavailable for participation.");
        const filter = { event_id: eventId, user_id: student.id };
        const current = await collections.studentEventParticipations.findOne(filter);
        if (status === "withdrawn" && current?.status !== "accepted") return fail(res, 409, "Agree to participate before withdrawing.");
        const now = new Date();
        const update = {
            $set: { status, updated_at: now, ...(status === "accepted" ? { agreed_at: now } : { withdrawn_at: now }) },
            $setOnInsert: { id: await nextId("student_event_participations"), event_id: eventId, user_id: student.id, created_at: now }
        };
        try {
            if (status === "accepted") await collections.studentEventParticipations.updateOne(filter, update, { upsert: true });
            else await collections.studentEventParticipations.updateOne({ ...filter, status: "accepted" }, update);
        } catch (error) {
            if (!duplicateKey(error) || status !== "accepted") throw error;
            await collections.studentEventParticipations.updateOne(filter, update);
        }
        return ok(res, status === "accepted" ? "You agreed to participate in this event." : "Your participation has been withdrawn.", { participation: { event_id: eventId, user_id: student.id, status, agreed_at: status === "accepted" ? now : current?.agreed_at || null, updated_at: now, can_generate_qr: status === "accepted" && /^[A-Za-z0-9-]{3,24}$/.test(student.student_id || "") } });
    } catch (error) { return next(error); }
});

app.get("/api/admin/event-responses", adminOnly, async (req, res, next) => {
    const eventId = req.query.event_id ? Number(req.query.event_id) : null;
    if (eventId !== null && (!Number.isSafeInteger(eventId) || eventId < 1)) return fail(res, 422, "Choose a valid event.");
    try {
        const events = await collections.events.find({}, { projection: { id: 1, title: 1, description: 1, location: 1, start_date: 1, end_date: 1, status: 1, publication_status: 1, invited_committees: 1 } }).sort({ start_date: -1 }).limit(500).toArray();
        if (!eventId) return ok(res, null, { events, responses: [], summary: { pending: 0, accepted: 0, declined: 0 } });
        const event = events.find((item) => item.id === eventId);
        if (!event) return fail(res, 404, "Event not found.");
        const responses = await collections.eventResponses.find({ event_id: eventId }).sort({ status: 1, created_at: 1 }).toArray();
        const ids = [...new Set(responses.map((response) => response.user_id))];
        const users = await collections.users.find({ id: { $in: ids } }, { projection: { id: 1, role: 1, first_name: 1, last_name: 1, student_id: 1, email: 1, course: 1, year_level: 1, council_position: 1, council_department: 1, committee_assignment: 1 } }).toArray();
        const userMap = new Map(users.map((user) => [user.id, user]));
        const rows = responses.map((response) => ({ ...response, member: userMap.get(response.user_id) || null })).filter((response) => response.member && isEventInvitee(response.member, event));
        return ok(res, null, { event, events, responses: rows, summary: { pending: rows.filter((row) => row.status === "pending").length, accepted: rows.filter((row) => row.status === "accepted").length, declined: rows.filter((row) => row.status === "declined").length } });
    } catch (error) { return next(error); }
});

app.post("/api/admin/event-responses/manage", adminOnly, async (req, res, next) => {
    const eventId = Number(req.body.event_id), userId = Number(req.body.user_id), status = text(req.body.status).trim();
    if (!Number.isSafeInteger(eventId) || eventId < 1 || !Number.isSafeInteger(userId) || userId < 1 || !["pending", "accepted", "declined"].includes(status)) return fail(res, 422, "Choose a valid participation status.");
    try {
        const now = new Date();
        const event = await collections.events.findOne({ id: eventId });
        if (!event) return fail(res, 404, "Event not found.");
        const member = await collections.users.findOne({ id: userId }, { projection: { id: 1, role: 1, council_position: 1, committee_assignment: 1 } });
        if (!member || !isEventInvitee(member, event)) return fail(res, 403, "This member is not included in the event’s council invitation.");
        const response = await collections.eventResponses.findOne({ event_id: eventId, user_id: userId });
        if (!response) return fail(res, 404, "Participation record not found.");
        const result = await collections.eventResponses.updateOne({ id: response.id, event_id: eventId, user_id: userId }, {
            $set: { status, updated_at: now, responded_at: status === "pending" ? null : now, response_source: "admin" },
            $push: { history: { status, changed_at: now, changed_by: Number(req.session.userId), source: "admin" } }
        });
        if (!result.modifiedCount) return fail(res, 409, "This participation status changed. Refresh the page and try again.");
        return ok(res, "Council participation updated.");
    } catch (error) { return next(error); }
});

// Retain old event assignment rows without accepting new sign-ups into that legacy workflow.
app.post("/api/participation/signup", signedIn, (_req, res) => fail(res, 410, "Legacy event assignment sign-ups are no longer used. Use council participation or agree to participate from a student event page."));

app.get("/api/registration/by-code", signedIn, async (req, res, next) => {
    const code = text(req.query.code).trim();
    if (!code) return fail(res, 422, "Registration code is required.");
    try {
        const registration = await collections.registrations.findOne({ registration_code: code, user_id: Number(req.session.userId) });
        if (!registration) return fail(res, 404, "Registration not found.");
        const [user, event, attendance] = await Promise.all([
            collections.users.findOne({ id: registration.user_id }),
            collections.events.findOne({ id: registration.event_id }),
            collections.attendance.findOne({ registration_id: registration.id }, { sort: { time_in: -1 } })
        ]);
        if (!user || !event) return fail(res, 404, "Registration not found.");
        return ok(res, null, { registration: {
            registration_id: registration.id, registration_code: registration.registration_code,
            status: registration.status, registered_at: registration.registered_at,
            attendance: attendance ? { time_in: attendance.time_in, time_out: attendance.time_out || null, currently_present: !attendance.time_out } : null,
            student_id: registration.participant_snapshot?.student_id || user.student_id, first_name: registration.participant_snapshot?.first_name || user.first_name, last_name: registration.participant_snapshot?.last_name || user.last_name,
            email: registration.participant_snapshot?.email || user.email, course: registration.participant_snapshot?.course || user.course, year_level: registration.participant_snapshot?.year_level || user.year_level, contact: registration.participant_snapshot?.contact || null,
            event_id: event.id, title: event.title, description: event.description,
            location: event.location, start_date: event.start_date, end_date: event.end_date,
            cover_image: event.cover_image, self_service_checkin: Boolean(event.self_service_checkin), self_service_checkout: Boolean(event.self_service_checkout)
        } });
    } catch (error) { return next(error); }
});

app.post("/api/registration/pass/reissue", signedIn, (_req, res) => fail(res, 410, "Students agree to participate and generate an attendance QR from the event page. Council members use their reusable identity QR from their profile."));

// Admin event and account management
app.get("/api/admin/events/event", adminOnly, async (req, res, next) => {
    const id = Number(req.query.id);
    if (!Number.isSafeInteger(id) || id < 1) return fail(res, 422, "A valid event ID is required.");
    try {
        const event = await collections.events.findOne({ id });
        if (!event) return fail(res, 404, "Event not found.");
        return ok(res, null, { event: withEventStatus(event) });
    } catch (error) { return next(error); }
});

app.get("/api/admin/events", adminOnly, async (_req, res, next) => {
    try {
        const [events, eventCount, activeEventCount, studentCount] = await Promise.all([
            collections.events.find({}).sort({ start_date: -1 }).toArray(),
            collections.events.countDocuments({}),
            collections.events.countDocuments({ status: { $in: ["upcoming", "ongoing"] }, $or: [{ publication_status: "published" }, { publication_status: { $exists: false } }] }),
            collections.users.countDocuments({ role: "student" })
        ]);
        const responseCountMap = await countInvitedEventResponses(events);
        return ok(res, null, {
            events: events.map((event) => ({ ...withEventStatus(event), response_count: responseCountMap.get(event.id)?.total || 0, accepted_response_count: responseCountMap.get(event.id)?.accepted || 0, pending_response_count: responseCountMap.get(event.id)?.pending || 0, declined_response_count: responseCountMap.get(event.id)?.declined || 0 })),
            stats: { event_count: eventCount, active_event_count: activeEventCount, student_count: studentCount }
        });
    } catch (error) { return next(error); }
});

app.get("/api/admin/registrations", adminOnly, async (_req, res, next) => {
    try {
        const docs = await collections.registrations.find({}).sort({ registered_at: -1 }).limit(200).toArray();
        const userIds = [...new Set(docs.map((doc) => doc.user_id))];
        const eventIds = [...new Set(docs.map((doc) => doc.event_id))];
        const [users, events, registrationCount] = await Promise.all([
            collections.users.find({ id: { $in: userIds } }).toArray(),
            collections.events.find({ id: { $in: eventIds } }).toArray(),
            collections.registrations.countDocuments({ status: { $ne: "cancelled" } })
        ]);
        const userMap = new Map(users.map((user) => [user.id, user]));
        const eventMap = new Map(events.map((event) => [event.id, event]));
        const registrations = docs.map((registration) => {
            const user = userMap.get(registration.user_id), event = eventMap.get(registration.event_id);
            if (!user || !event) return null;
            return {
                registration_id: registration.id, registration_code: registration.registration_code,
                status: registration.status, registered_at: registration.registered_at,
                first_name: user.first_name, last_name: user.last_name, student_id: user.student_id,
                email: user.email, event_title: event.title
            };
        }).filter(Boolean);
        return ok(res, null, { registrations, registration_count: registrationCount });
    } catch (error) { return next(error); }
});

app.get("/api/admin/users", adminOnly, async (_req, res, next) => {
    try {
        const [users, studentCount] = await Promise.all([
            collections.users.find({}, { projection: { passwordHash: 0 } }).sort({ created_at: -1 }).limit(500).toArray(),
            collections.users.countDocuments({ role: "student" })
        ]);
        return ok(res, null, { users, student_count: studentCount });
    } catch (error) { return next(error); }
});

const periodForDate = (date = new Date()) => {
    const parts = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "numeric" }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
    const year = Number(parts.year), month = Number(parts.month);
    return month >= 7 ? `${year}-1` : `${year - 1}-2`;
};

app.get("/api/profile/class-schedule", signedIn, async (req, res, next) => {
    const period = text(req.query.academic_period).trim() || periodForDate();
    if (!/^20\d{2}-[12]$/.test(period)) return fail(res, 422, "Choose an academic period in YYYY-1 or YYYY-2 format.");
    try {
        const member = await collections.users.findOne({ id: Number(req.session.userId) }, { projection: { id: 1, role: 1, council_position: 1, committee_assignment: 1 } });
        if (!isAuthorizedCouncilMember(member, councilPositions, councilCommittees)) return fail(res, 403, "A current council appointment or committee assignment is required to manage a class schedule.");
        const schedule = await collections.councilClassSchedules.findOne({ user_id: member.id, academic_period: period });
        return ok(res, null, { academic_period: period, slots: schedule?.slots || [], updated_at: schedule?.updated_at || null });
    } catch (error) { return next(error); }
});

app.post("/api/profile/class-schedule", signedIn, async (req, res, next) => {
    const period = text(req.body.academic_period).trim() || periodForDate();
    const sourceSlots = Array.isArray(req.body.slots) ? req.body.slots : null;
    if (!/^20\d{2}-[12]$/.test(period) || !sourceSlots || sourceSlots.length > 40) return fail(res, 422, "Choose an academic period and enter up to 40 weekly class blocks.");
    const slots = [];
    for (const source of sourceSlots) {
        const day = Number(source.day_of_week);
        const start = text(source.start_time).trim(), end = text(source.end_time).trim(), label = text(source.label).trim();
        if (!Number.isInteger(day) || day < 0 || day > 6 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end) || end <= start || label.length > 100) return fail(res, 422, "Each class needs a valid day, start time, end time, and short course label.");
        slots.push({ day_of_week: day, start_time: start, end_time: end, label });
    }
    const byDay = new Map();
    for (const slot of slots) {
        const daySlots = byDay.get(slot.day_of_week) || [];
        daySlots.push(slot);
        byDay.set(slot.day_of_week, daySlots);
    }
    for (const daySlots of byDay.values()) {
        daySlots.sort((a, b) => a.start_time.localeCompare(b.start_time));
        for (let index = 1; index < daySlots.length; index += 1) {
            if (daySlots[index].start_time < daySlots[index - 1].end_time) return fail(res, 422, "Class blocks on the same day cannot overlap.");
        }
    }
    try {
        const member = await collections.users.findOne({ id: Number(req.session.userId) }, { projection: { id: 1, role: 1, council_position: 1, committee_assignment: 1 } });
        if (!isAuthorizedCouncilMember(member, councilPositions, councilCommittees)) return fail(res, 403, "A current council appointment or committee assignment is required to manage a class schedule.");
        const now = new Date();
        await collections.councilClassSchedules.updateOne({ user_id: member.id, academic_period: period }, {
            $set: { slots, updated_at: now },
            $setOnInsert: { id: await nextId("council_class_schedules"), user_id: member.id, academic_period: period, created_at: now }
        }, { upsert: true });
        return ok(res, "Class schedule saved.", { academic_period: period, slots, updated_at: now });
    } catch (error) { return next(error); }
});

const meetingIdFrom = (value) => Number(value);
const attendancePassHash = (token) => crypto.createHash("sha256").update(token).digest("hex");

async function revokeCouncilAttendanceCredential(userId, operatorUserId) {
    const credential = await collections.councilMemberCredentials.findOne({ user_id: Number(userId), revoked_at: { $exists: false } });
    if (!credential) return;
    const now = new Date();
    await collections.councilMemberCredentials.updateOne({ user_id: Number(userId), pass_id: credential.pass_id }, { $set: { revoked_at: now, revoked_by: Number(operatorUserId) }, $unset: { pass_id: "" } });
    await collections.attendanceAudit.insertOne({ id: await nextId("attendance_audit"), action: "council_credential_revoked", participant_type: "council", user_id: Number(userId), operator_user_id: Number(operatorUserId), created_at: now });
}

app.post("/api/admin/council/roster", adminOnly, async (req, res, next) => {
    const userId = Number(req.body.user_id);
    const position = text(req.body.council_position).trim();
    const department = text(req.body.council_department).trim().toUpperCase();
    if (!Number.isInteger(userId) || userId < 1 || (position && !councilPositions.has(position))) return fail(res, 422, "Choose a valid account and council appointment.");
    if (position === "department_representative" && !councilDepartments.has(department)) return fail(res, 422, "Choose the represented department.");
    try {
        const user = await collections.users.findOne({ id: userId }, { projection: { id: 1, role: 1, council_position: 1, committee_assignment: 1 } });
        if (!user) return fail(res, 404, "Council account not found.");
        if (position && !["advisor", "co_advisor"].includes(position)) {
            const assignmentQuery = position === "department_representative"
                ? { id: { $ne: userId }, council_position: position, council_department: department }
                : { id: { $ne: userId }, council_position: position };
            const assigned = await collections.users.findOne(assignmentQuery, { projection: { id: 1 } });
            if (assigned) return fail(res, 409, "That elected council position is already assigned.");
        }
        if (!position) {
            await collections.users.updateOne({ id: userId }, { $unset: { council_position: "", council_department: "" } });
        } else {
            const update = { $set: { council_position: position, ...(position === "department_representative" ? { council_department: department } : {}), council_appointed_at: new Date(), council_appointed_by: Number(req.session.userId) } };
            if (position !== "department_representative") update.$unset = { council_department: "" };
            await collections.users.updateOne({ id: userId }, update);
        }
        const updatedMember = { ...user, council_position: position || undefined, council_department: position === "department_representative" ? department : undefined };
        if (!isAuthorizedCouncilMember(updatedMember, councilPositions, councilCommittees)) await revokeCouncilAttendanceCredential(userId, req.session.userId);
        return ok(res, position ? "Council appointment saved." : "Council appointment removed.");
    } catch (error) { return next(error); }
});

app.post("/api/admin/council/committee-assignment", adminOnly, async (req, res, next) => {
    const userId = Number(req.body.user_id);
    const committee = text(req.body.committee_assignment).trim().toLowerCase();
    if (!Number.isInteger(userId) || userId < 1 || (committee && !councilCommittees.has(committee))) {
        return fail(res, 422, "Choose a valid account and committee workspace.");
    }
    try {
        const user = await collections.users.findOne({ id: userId }, {
            projection: { id: 1, role: 1, council_position: 1 }
        });
        if (!user) return fail(res, 404, "Account not found.");

        if (committee) {
            await collections.users.updateOne({ id: userId }, { $set: {
                committee_assignment: committee,
                committee_assigned_at: new Date(),
                committee_assigned_by: Number(req.session.userId)
            } });
        } else {
            await collections.users.updateOne({ id: userId }, { $unset: {
                committee_assignment: "",
                committee_assigned_at: "",
                committee_assigned_by: ""
            } });
        }
        const updatedMember = { ...user, committee_assignment: committee || undefined };
        if (!isAuthorizedCouncilMember(updatedMember, councilPositions, councilCommittees)) await revokeCouncilAttendanceCredential(userId, req.session.userId);
        return ok(res, committee ? "Committee workspace access saved." : "Committee workspace access removed.", {
            committee_assignment: committee || null,
            effective_committee_assignment: user.role === "admin" || executiveCouncilPositions.has(user.council_position)
                ? "executive"
                : committee || null
        });
    } catch (error) { return next(error); }
});

app.get("/api/council/governance", councilAccess([...councilPositions]), async (req, res, next) => {
    const period = text(req.query.period || periodForDate()).trim();
    if (!/^20\d{2}-[12]$/.test(period)) return fail(res, 422, "Choose an academic year and semester.");
    try {
        const [members, meetings, reports, inventory] = await Promise.all([
            collections.users.find({ council_position: { $in: [...councilPositions] } }, { projection: { id: 1, first_name: 1, last_name: 1, council_position: 1, council_department: 1 } }).sort({ council_position: 1, last_name: 1 }).toArray(),
            collections.governanceMeetings.find({ academic_period: period }).sort({ start_at: -1 }).limit(100).toArray(),
            collections.councilReports.find({ academic_period: period }).sort({ submitted_at: -1 }).limit(100).toArray(),
            collections.councilInventory.find({}).sort({ item_name: 1 }).limit(500).toArray()
        ]);
        const meetingIds = meetings.map((meeting) => meeting.id);
        const [attendance, excuses] = meetingIds.length ? await Promise.all([
            collections.councilAttendance.find({ meeting_id: { $in: meetingIds } }).toArray(),
            collections.councilExcuses.find({ meeting_id: { $in: meetingIds } }).toArray()
        ]) : [[], []];
        const attendanceByMeeting = new Map();
        for (const record of attendance) {
            const list = attendanceByMeeting.get(record.meeting_id) || [];
            list.push(record);
            attendanceByMeeting.set(record.meeting_id, list);
        }
        const membersById = new Map(members.map((member) => [member.id, member]));
        const now = new Date();
        const completedMandatory = meetings.filter((meeting) => meeting.mandatory && meeting.status !== "cancelled" && new Date(meeting.end_at) <= now);
        const stats = members.filter((member) => votingCouncilPositions.includes(member.council_position)).map((member) => {
            const approvedExcuses = new Set(excuses.filter((excuse) => excuse.user_id === member.id && excuse.status === "approved").map((excuse) => excuse.meeting_id));
            const eligible = completedMandatory.filter((meeting) => !approvedExcuses.has(meeting.id));
            const attended = eligible.filter((meeting) => attendance.some((record) => record.meeting_id === meeting.id && record.user_id === member.id)).length;
            const percentage = eligible.length ? Math.round(attended / eligible.length * 100) : null;
            return { user_id: member.id, name: `${member.first_name} ${member.last_name}`, position: member.council_position, department: member.council_department || null, attended, eligible: eligible.length, approved_excuses: approvedExcuses.size, percentage, good_standing: percentage !== null && percentage >= 80 };
        });
        const quorumSize = members.filter((member) => votingCouncilPositions.includes(member.council_position)).length;
        const currentUser = req.councilUser || await collections.users.findOne({ id: Number(req.session.userId) }, { projection: { id: 1, role: 1, council_position: 1, council_department: 1 } });
        const enrichedMeetings = meetings.map((meeting) => {
            const present = attendanceByMeeting.get(meeting.id) || [];
            const quorumRequired = Math.ceil(quorumSize * 2 / 3);
            return { ...meeting, attendance: present.map((record) => ({ ...record, member: membersById.get(record.user_id) ? { name: `${membersById.get(record.user_id).first_name} ${membersById.get(record.user_id).last_name}`, position: membersById.get(record.user_id).council_position } : null })), quorum: { present: present.length, total: quorumSize, required: quorumRequired, reached: quorumSize > 0 && present.length >= quorumRequired, waived: Boolean(meeting.quorum_waiver_rationale) } };
        });
        const currentMeetingIds = new Set(meetingIds);
        return ok(res, null, {
            academic_period: period,
            current_user: currentUser,
            members: members.map(({ passwordHash, ...member }) => member),
            meetings: enrichedMeetings,
            reports: reports.map((report) => ({ ...report, author_name: membersById.has(report.submitted_by) ? `${membersById.get(report.submitted_by).first_name} ${membersById.get(report.submitted_by).last_name}` : "Former council member", reviewer_name: membersById.has(report.reviewed_by) ? `${membersById.get(report.reviewed_by).first_name} ${membersById.get(report.reviewed_by).last_name}` : "" })),
            inventory: inventory.map((item) => ({ ...item, updated_by_name: membersById.has(item.updated_by) ? `${membersById.get(item.updated_by).first_name} ${membersById.get(item.updated_by).last_name}` : "Council officer" })),
            attendance_stats: stats,
            excuses: excuses.map((excuse) => ({ ...excuse, member: membersById.get(excuse.user_id) ? { name: `${membersById.get(excuse.user_id).first_name} ${membersById.get(excuse.user_id).last_name}`, position: membersById.get(excuse.user_id).council_position } : null, meeting_title: meetings.find((meeting) => meeting.id === excuse.meeting_id)?.title || "Meeting" })),
            summary: { voting_members: quorumSize, meeting_count: currentMeetingIds.size, completed_mandatory_count: completedMandatory.length, good_standing_count: stats.filter((member) => member.good_standing).length }
        });
    } catch (error) { return next(error); }
});

app.post("/api/council/meetings/save", councilAccess(["governor", "vice_governor", "secretary"]), async (req, res, next) => {
    const id = req.body.id ? Number(req.body.id) : null;
    const title = text(req.body.title).trim();
    const meetingType = text(req.body.meeting_type).trim();
    const location = text(req.body.location).trim();
    const startAt = parseDate(text(req.body.start_at));
    const endAt = parseDate(text(req.body.end_at));
    const period = text(req.body.academic_period || periodForDate(startAt || new Date())).trim();
    const agenda = text(req.body.agenda).trim();
    const waiveQuorum = req.body.waive_quorum === true;
    const waiverRationale = text(req.body.quorum_waiver_rationale).trim();
    if (id !== null && (!Number.isInteger(id) || id < 1)) return fail(res, 422, "Choose a valid meeting.");
    if (!title || title.length > 180 || !location || location.length > 180 || !startAt || !endAt || endAt <= startAt || agenda.length > 5000) return fail(res, 422, "Enter a title, location, valid schedule, and agenda under 5,000 characters.");
    if (!["regular", "special", "mandatory_activity"].includes(meetingType) || !/^20\d{2}-[12]$/.test(period)) return fail(res, 422, "Choose a valid meeting type and academic period.");
    if (waiveQuorum && (meetingType !== "special" || req.councilUser?.council_position !== "governor" || waiverRationale.length < 20)) return fail(res, 422, "Only the Governor may waive quorum for an urgent special meeting, with a documented rationale of at least 20 characters.");
    if (!waiveQuorum && waiverRationale) return fail(res, 422, "A quorum waiver requires an urgent special meeting approved by the Governor.");
    try {
        const meetingStatus = text(req.body.status || "scheduled");
        if (!(id ? ["scheduled", "completed", "cancelled"] : ["scheduled"]).includes(meetingStatus)) return fail(res, 422, "Choose a valid meeting status.");
        const values = { title, meeting_type: meetingType, location, start_at: startAt, end_at: endAt, attendance_opens_at: new Date(startAt.getTime() - 60 * 60 * 1000), attendance_closes_at: new Date(startAt.getTime() + 15 * 60 * 1000), mandatory: req.body.mandatory !== false, academic_period: period, agenda, status: meetingStatus, quorum_waiver_rationale: waiveQuorum ? waiverRationale : "", quorum_waiver_by: waiveQuorum ? Number(req.session.userId) : null, updated_at: new Date() };
        if (id) {
            const result = await collections.governanceMeetings.updateOne({ id }, { $set: values });
            if (!result.matchedCount) return fail(res, 404, "Meeting not found.");
            return ok(res, "Meeting updated.", { meeting_id: id });
        }
        const meetingId = await nextId("governance_meetings");
        await collections.governanceMeetings.insertOne({ id: meetingId, ...values, created_by: Number(req.session.userId), created_at: new Date(), minutes: "", decisions: "", minutes_status: "draft" });
        return ok(res, "Meeting scheduled.", { meeting_id: meetingId });
    } catch (error) { return next(error); }
});

app.post("/api/council/meetings/minutes", councilAccess(["governor", "vice_governor", "secretary"]), async (req, res, next) => {
    const meetingId = meetingIdFrom(req.body.meeting_id);
    const minutes = text(req.body.minutes).trim();
    const decisions = text(req.body.decisions).trim();
    if (!Number.isInteger(meetingId) || meetingId < 1 || minutes.length > 20000 || decisions.length > 10000) return fail(res, 422, "Enter valid meeting minutes and decision notes.");
    try {
        const meeting = await collections.governanceMeetings.findOne({ id: meetingId });
        if (!meeting) return fail(res, 404, "Meeting not found.");
        if (new Date(meeting.end_at) > new Date()) return fail(res, 409, "Meeting minutes can be submitted after the meeting ends.");
        if (decisions) {
            const [present, total] = await Promise.all([
                collections.councilAttendance.countDocuments({ meeting_id: meetingId }),
                collections.users.countDocuments({ council_position: { $in: votingCouncilPositions } })
            ]);
            const quorumReached = total > 0 && present >= Math.ceil(total * 2 / 3);
            const validWaiver = meeting.meeting_type === "special" && Boolean(meeting.quorum_waiver_rationale);
            if (!quorumReached && !validWaiver) return fail(res, 409, `Quorum is not met (${present} of ${total}; ${Math.ceil(total * 2 / 3)} required). Record minutes without decisions, or document a Governor-approved urgent special-meeting waiver.`);
        }
        await collections.governanceMeetings.updateOne({ id: meetingId }, { $set: { minutes, decisions, minutes_status: "pending_advisor", minutes_submitted_by: Number(req.session.userId), minutes_submitted_at: new Date(), status: "completed", updated_at: new Date() } });
        return ok(res, "Minutes submitted for Advisor review.");
    } catch (error) { return next(error); }
});

app.post("/api/council/meetings/review-minutes", councilAccess(["advisor", "co_advisor"], false), async (req, res, next) => {
    const meetingId = meetingIdFrom(req.body.meeting_id);
    const decision = text(req.body.decision).trim();
    const note = text(req.body.note).trim();
    if (!Number.isInteger(meetingId) || meetingId < 1 || !["approve", "revisions"].includes(decision) || note.length > 2000) return fail(res, 422, "Choose an approval decision and a review note under 2,000 characters.");
    try {
        const status = decision === "approve" ? "approved" : "revisions_requested";
        const result = await collections.governanceMeetings.updateOne({ id: meetingId, minutes_status: "pending_advisor" }, { $set: { minutes_status: status, advisor_note: note, minutes_reviewed_by: Number(req.session.userId), minutes_reviewed_at: new Date(), updated_at: new Date() } });
        if (!result.modifiedCount) return fail(res, 409, "These minutes are no longer awaiting review.");
        return ok(res, decision === "approve" ? "Official minutes approved." : "Revisions requested for these minutes.");
    } catch (error) { return next(error); }
});

app.post("/api/council/reports/save", councilAccess([...councilPositions], false), async (req, res, next) => {
    const id = req.body.id ? Number(req.body.id) : null;
    const committee = text(req.body.committee).trim().toLowerCase();
    const period = text(req.body.academic_period || periodForDate()).trim();
    const title = text(req.body.title).trim();
    const activities = text(req.body.activities).trim();
    const accomplishments = text(req.body.accomplishments).trim();
    const recommendations = text(req.body.recommendations).trim();
    if ((id !== null && (!Number.isInteger(id) || id < 1)) || !councilCommittees.has(committee) || !/^20\d{2}-[12]$/.test(period) || !title || title.length > 180 || activities.length < 10 || activities.length > 5000 || accomplishments.length > 5000 || recommendations.length > 5000) return fail(res, 422, "Complete the committee, period, title, activities, accomplishments, and recommendations fields within their limits.");
    try {
        const values = { committee, academic_period: period, title, activities, accomplishments, recommendations, updated_at: new Date() };
        if (id) {
            const result = await collections.councilReports.updateOne({ id, submitted_by: Number(req.session.userId), status: { $in: ["submitted", "revisions_requested"] } }, { $set: { ...values, status: "submitted", submitted_at: new Date() }, $unset: { review_note: "", reviewed_by: "", reviewed_at: "" } });
            if (!result.matchedCount) return fail(res, 404, "Only your submitted or returned report can be updated.");
            return ok(res, "Committee report resubmitted for Governor review.", { report_id: id });
        }
        const reportId = await nextId("council_reports");
        await collections.councilReports.insertOne({ id: reportId, ...values, status: "submitted", submitted_by: Number(req.session.userId), submitted_at: new Date() });
        return ok(res, "Committee report submitted for Governor review.", { report_id: reportId });
    } catch (error) { return next(error); }
});

app.post("/api/council/reports/review", councilAccess(["governor"], false), async (req, res, next) => {
    const id = Number(req.body.id);
    const decision = text(req.body.decision).trim();
    const note = text(req.body.note).trim();
    if (!Number.isInteger(id) || id < 1 || !["acknowledge", "revisions"].includes(decision) || note.length > 2000) return fail(res, 422, "Choose a report decision and an optional note under 2,000 characters.");
    try {
        const status = decision === "acknowledge" ? "acknowledged" : "revisions_requested";
        const result = await collections.councilReports.updateOne({ id, status: "submitted" }, { $set: { status, review_note: note, reviewed_by: Number(req.session.userId), reviewed_at: new Date(), updated_at: new Date() } });
        if (!result.modifiedCount) return fail(res, 409, "This report is no longer awaiting review.");
        return ok(res, decision === "acknowledge" ? "Committee report acknowledged." : "Revisions requested for this report.");
    } catch (error) { return next(error); }
});

app.post("/api/council/inventory/save", councilAccess(["auditor", "governor"]), async (req, res, next) => {
    const id = req.body.id ? Number(req.body.id) : null;
    const itemName = text(req.body.item_name).trim();
    const assetTag = text(req.body.asset_tag).trim();
    const category = text(req.body.category).trim();
    const quantity = Number(req.body.quantity);
    const condition = text(req.body.condition).trim();
    const location = text(req.body.location).trim();
    const notes = text(req.body.notes).trim();
    if ((id !== null && (!Number.isInteger(id) || id < 1)) || !itemName || itemName.length > 180 || assetTag.length > 80 || !category || category.length > 100 || !Number.isInteger(quantity) || quantity < 1 || quantity > 100000 || !["serviceable", "needs_repair", "unserviceable", "retired"].includes(condition) || !location || location.length > 180 || notes.length > 2000) return fail(res, 422, "Enter a valid item, category, quantity, condition, location, and notes.");
    try {
        const now = new Date();
        const actor = Number(req.session.userId);
        const record = { item_name: itemName, asset_tag: assetTag, category, quantity, condition, location, notes, status: condition === "retired" ? "retired" : "active", updated_at: now, updated_by: actor };
        if (id) {
            const current = await collections.councilInventory.findOne({ id });
            if (!current) return fail(res, 404, "Inventory item not found.");
            const history = [...(current.history || []), { action: "updated", by: actor, at: now, previous_quantity: current.quantity, quantity, previous_condition: current.condition, condition }].slice(-30);
            await collections.councilInventory.updateOne({ id }, { $set: { ...record, history } });
            return ok(res, "Inventory record updated.", { inventory_id: id });
        }
        const inventoryId = await nextId("council_inventory");
        await collections.councilInventory.insertOne({ id: inventoryId, ...record, created_at: now, created_by: actor, history: [{ action: "created", by: actor, at: now, quantity, condition }] });
        return ok(res, "Inventory item added.", { inventory_id: inventoryId });
    } catch (error) { return next(error); }
});

app.post("/api/council/meetings/excuse", votingCouncilMember, async (req, res, next) => {
    const meetingId = meetingIdFrom(req.body.meeting_id);
    const category = text(req.body.category).trim();
    const details = text(req.body.details).trim();
    const evidenceUrl = text(req.body.evidence_url).trim();
    if (!Number.isInteger(meetingId) || meetingId < 1 || !excuseCategories.has(category) || details.length < 10 || details.length > 1000) return fail(res, 422, "Choose a recognized excuse category and provide 10–1,000 characters of context.");
    if (["competition", "recognized_organization"].includes(category) && !/^https:\/\//i.test(evidenceUrl)) return fail(res, 422, "Attach a secure link to supporting documentation for this exception.");
    if (evidenceUrl && (!/^https:\/\//i.test(evidenceUrl) || evidenceUrl.length > 1000)) return fail(res, 422, "Supporting documentation must use a valid HTTPS URL under 1,000 characters.");
    try {
        const meeting = await collections.governanceMeetings.findOne({ id: meetingId, mandatory: true, status: { $ne: "cancelled" } });
        if (!meeting) return fail(res, 404, "Mandatory meeting or activity not found.");
        if (category === "recognized_organization" && new Date(meeting.start_at) <= new Date()) return fail(res, 422, "School-organization exceptions require prior approval. Submit this request before the meeting starts.");
        const existing = await collections.councilExcuses.findOne({ meeting_id: meetingId, user_id: Number(req.session.userId) });
        if (existing) return fail(res, 409, "You already submitted an excuse for this meeting.");
        await collections.councilExcuses.insertOne({ id: await nextId("council_excuses"), meeting_id: meetingId, user_id: Number(req.session.userId), category, details, evidence_url: evidenceUrl, approvals: {}, status: "pending", submitted_at: new Date() });
        return ok(res, "Excuse submitted for council review.");
    } catch (error) { return next(error); }
});

app.post("/api/council/meetings/review-excuse", councilAccess(["governor", "vice_governor", "advisor", "co_advisor"]), async (req, res, next) => {
    const id = Number(req.body.id);
    const status = text(req.body.status).trim();
    if (!Number.isInteger(id) || id < 1 || !["approved", "rejected"].includes(status)) return fail(res, 422, "Choose a valid excuse review decision.");
    try {
        const excuse = await collections.councilExcuses.findOne({ id, status: "pending" });
        if (!excuse) return fail(res, 409, "This excuse was already reviewed or is unavailable.");
        const position = req.councilUser?.council_position;
        if (excuse.category === "recognized_organization") {
            if (!["governor", "advisor", "co_advisor"].includes(position)) return fail(res, 403, "School-organization activities require separate Governor and Advisor approval.");
            const approvalKey = ["advisor", "co_advisor"].includes(position) ? "advisor" : "governor";
            if (status === "approved" && excuse.approvals?.[approvalKey]) return fail(res, 409, `The ${approvalKey} has already reviewed this request.`);
            const approvals = { ...(excuse.approvals || {}) };
            if (status === "approved") approvals[approvalKey] = Number(req.session.userId);
            const fullyApproved = Boolean(approvals.governor && approvals.advisor);
            const nextStatus = status === "rejected" ? "rejected" : fullyApproved ? "approved" : "pending";
            const result = await collections.councilExcuses.updateOne({ id, status: "pending" }, { $set: { status: nextStatus, approvals, last_reviewed_by: Number(req.session.userId), last_reviewed_at: new Date() } });
            if (!result.modifiedCount) return fail(res, 409, "This excuse was reviewed by someone else. Refresh and try again.");
            return ok(res, nextStatus === "approved" ? "Governor and Advisor approval recorded; exception approved." : status === "rejected" ? "Excuse declined." : `Waiting for the ${approvalKey === "governor" ? "Advisor" : "Governor"}'s required approval.`);
        }
        const result = await collections.councilExcuses.updateOne({ id, status: "pending" }, { $set: { status, reviewed_by: Number(req.session.userId), reviewed_at: new Date() } });
        if (!result.modifiedCount) return fail(res, 409, "This excuse was already reviewed or is unavailable.");
        return ok(res, status === "approved" ? "Excuse approved and excluded from the attendance denominator." : "Excuse declined.");
    } catch (error) { return next(error); }
});

app.post("/api/council/attendance/pass", votingCouncilMember, async (req, res, next) => {
    const meetingId = meetingIdFrom(req.body.meeting_id);
    if (!Number.isInteger(meetingId) || meetingId < 1) return fail(res, 422, "Choose a valid meeting.");
    try {
        const meeting = await collections.governanceMeetings.findOne({ id: meetingId, mandatory: true, status: { $ne: "cancelled" } });
        if (!meeting) return fail(res, 404, "Meeting pass is unavailable.");
        const now = new Date();
        const expiresAt = new Date(meeting.attendance_closes_at);
        if (now < new Date(meeting.attendance_opens_at) || now > expiresAt) return fail(res, 409, "The attendance pass is available from one hour before the meeting until 15 minutes after it starts.");
        const token = crypto.randomBytes(32).toString("base64url");
        const tokenHash = attendancePassHash(token);
        await collections.councilAttendancePasses.deleteMany({ meeting_id: meetingId, user_id: Number(req.session.userId) });
        await collections.councilAttendancePasses.insertOne({ token_hash: tokenHash, meeting_id: meetingId, user_id: Number(req.session.userId), expiresAt });
        return ok(res, null, { pass: `AUSSC-MEETING:${token}`, expires_at: expiresAt, meeting: { id: meeting.id, title: meeting.title, start_at: meeting.start_at, location: meeting.location } });
    } catch (error) { return next(error); }
});

async function getAuthorizedCouncilCredentialUser(userId) {
    const user = await collections.users.findOne({ id: Number(userId) }, {
        projection: { id: 1, role: 1, first_name: 1, last_name: 1, student_id: 1, email: 1, course: 1, year_level: 1, council_position: 1, council_department: 1, committee_assignment: 1 }
    });
    return isAuthorizedCouncilMember(user, councilPositions, councilCommittees) ? user : null;
}

app.get("/api/council/attendance/credential", signedIn, async (req, res, next) => {
    try {
        const member = await getAuthorizedCouncilCredentialUser(req.session.userId);
        if (!member) return fail(res, 403, "A current council appointment or committee assignment is required for a member QR.");
        return ok(res, null, { credential: { qr_value: identityQr(member.student_id), issued_at: null, reissued_at: null }, member: { name: `${member.first_name} ${member.last_name}`, position: member.council_position || null, committee: member.committee_assignment || null } });
    } catch (error) { return next(error); }
});

app.post("/api/council/attendance/credential/issue", signedIn, async (req, res, next) => {
    try {
        const member = await getAuthorizedCouncilCredentialUser(req.session.userId);
        if (!member) return fail(res, 403, "A current council appointment or committee assignment is required for a member QR.");
        return ok(res, "Your reusable council identity QR is ready.", { qr_value: identityQr(member.student_id) });
    } catch (error) { return next(error); }
});

app.post("/api/council/attendance/credential/reissue", signedIn, async (req, res, next) => {
    try {
        const member = await getAuthorizedCouncilCredentialUser(req.session.userId);
        if (!member) return fail(res, 403, "A current council appointment or committee assignment is required for a member QR.");
        return ok(res, "Your reusable council QR contains your account ID and no event or attendance state.", { qr_value: identityQr(member.student_id) });
    } catch (error) { return next(error); }
});

app.get("/api/council/attendance/mine", signedIn, async (req, res, next) => {
    try {
        const member = await getAuthorizedCouncilCredentialUser(req.session.userId);
        if (!member) return fail(res, 403, "A current council appointment or committee assignment is required.");
        const [records, events] = await Promise.all([
            collections.attendance.find({ participant_type: "council", user_id: member.id }).sort({ time_in: -1 }).limit(500).toArray(),
            collections.events.find({ status: { $in: ["upcoming", "ongoing"] }, $or: [{ publication_status: "published" }, { publication_status: { $exists: false } }] }).sort({ start_date: 1 }).limit(200).toArray()
        ]);
        const recordMap = new Map(records.map((record) => [record.event_id, record]));
        const eventMap = new Map(events.map((event) => [event.id, event]));
        const historyEvents = await collections.events.find({ id: { $in: records.map((record) => record.event_id).filter(Number.isInteger) } }, { projection: { id: 1, title: 1, location: 1, start_date: 1, end_date: 1, status: 1, publication_status: 1, self_service_checkin: 1, self_service_checkout: 1 } }).toArray();
        historyEvents.forEach((event) => eventMap.set(event.id, event));
        const visibleEvents = [...eventMap.values()].filter((event) => recordMap.has(event.id) || event.self_service_checkin || event.self_service_checkout).sort((a, b) => new Date(a.start_date) - new Date(b.start_date));
        return ok(res, null, { events: visibleEvents.map((event) => {
            const record = recordMap.get(event.id);
            return { id: event.id, title: event.title, location: event.location, start_date: event.start_date, end_date: event.end_date, self_service_checkin: Boolean(event.self_service_checkin), self_service_checkout: Boolean(event.self_service_checkout), attendance: record ? { time_in: record.time_in, time_out: record.time_out || null, currently_present: !record.time_out } : null };
        }) });
    } catch (error) { return next(error); }
});

app.post("/api/council/attendance/checkin", councilAccess(["governor", "vice_governor", "secretary"]), async (req, res, next) => {
    const qrValue = text(req.body.qr_value).trim();
    const token = qrValue.startsWith("AUSSC-MEETING:") ? qrValue.slice("AUSSC-MEETING:".length) : "";
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return fail(res, 422, "This is not a valid council attendance pass.");
    const expectedMeetingId = Number(req.body.meeting_id);
    if (!Number.isInteger(expectedMeetingId) || expectedMeetingId < 1) return fail(res, 422, "Select the meeting the check-in team is serving.");
    try {
        const pass = await collections.councilAttendancePasses.findOne({ token_hash: attendancePassHash(token), expiresAt: { $gt: new Date() } });
        if (!pass) return fail(res, 404, "This attendance pass is invalid or expired.");
        if (pass.meeting_id !== expectedMeetingId) return fail(res, 409, "This QR pass belongs to a different meeting.", { code: "WRONG_MEETING" });
        const meeting = await collections.governanceMeetings.findOne({ id: pass.meeting_id });
        if (!meeting || meeting.status === "cancelled") return fail(res, 409, "This meeting is cancelled or unavailable.");
        const now = new Date();
        if (now < new Date(meeting.attendance_opens_at)) return fail(res, 409, "Check-in has not opened yet.");
        if (now > new Date(meeting.attendance_closes_at)) return fail(res, 409, "Check-in closed 15 minutes after the meeting started. Tardy attendance is not recorded.", { late: true });
        const member = await collections.users.findOne({ id: pass.user_id }, { projection: { id: 1, first_name: 1, last_name: 1, council_position: 1, council_department: 1 } });
        if (!member || !votingCouncilPositions.includes(member.council_position)) return fail(res, 403, "This account is not on the current voting council roster.");
        const existing = await collections.councilAttendance.findOne({ meeting_id: meeting.id, user_id: member.id });
        if (existing) return ok(res, "This council member is already checked in.", { success: false, already_checked_in: true, member: { name: `${member.first_name} ${member.last_name}`, position: member.council_position }, meeting: { title: meeting.title }, checked_in_at: existing.checked_in_at });
        try {
            await collections.councilAttendance.insertOne({ id: await nextId("council_attendance"), meeting_id: meeting.id, user_id: member.id, checked_in_at: now, recorded_by: Number(req.session.userId) });
        } catch (error) {
            if (error?.code !== 11000) throw error;
            return ok(res, "This council member is already checked in.", { success: false, already_checked_in: true, member: { name: `${member.first_name} ${member.last_name}`, position: member.council_position }, meeting: { title: meeting.title } });
        }
        return ok(res, "Council member attendance recorded.", { member: { name: `${member.first_name} ${member.last_name}`, position: member.council_position, department: member.council_department || null }, meeting: { title: meeting.title }, checked_in_at: now });
    } catch (error) { return next(error); }
});

// Shared committee work items provide one source of truth for publication, production and program workflows.
const workStatuses = new Set(["Request Submitted", "Requirements Review", "Assigned", "In Design", "Internal Review", "Revisions Requested", "Awaiting Approval", "Approved", "Scheduled", "Published", "Archived", "Not Started", "In Progress", "Submitted for Review", "Revision Requested", "Posted", "Cancelled", "Blocked", "Complete"]);
const workCommittees = new Set(["executive", "publication", "production", "program"]);


const publicationSubmissionUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 1, fields: 4, parts: 5, fieldSize: 8 * 1024 } });
const publicationSubmissionMiddleware = (req, res, next) => publicationSubmissionUpload.single("attachment")(req, res, (error) => {
    if (error) return fail(res, 422, "Attachments must be smaller than 4 MB.");
    next();
});
const publicationFileTypes = new Set(["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm", "video/quicktime"]);

async function createNotification(userId, { kind, title, message, taskId = null, eventId = null, href = null, dedupeKey }) {
    if (!Number.isInteger(Number(userId)) || !dedupeKey) return;
    const id = await nextId("notifications");
    await collections.notifications.updateOne(
        { user_id: Number(userId), dedupe_key: dedupeKey },
        { $setOnInsert: { id, user_id: Number(userId), kind, title, message, task_id: taskId, event_id: eventId, href: href || (taskId ? `/admin/committees/publication?task=${taskId}` : eventId ? `/events/${eventId}` : null), dedupe_key: dedupeKey, created_at: new Date(), read_at: null } },
        { upsert: true }
    );
}

function eventInviteCommittees(event) {
    const value = event?.invited_committees;
    const configured = Array.isArray(value) ? value : value == null ? ["all"] : text(value).split(",");
    const selected = [...new Set(configured.map((value) => text(value).trim().toLowerCase()).filter((value) => value === "all" || councilCommittees.has(value)))];
    return selected.includes("all") ? ["all"] : selected;
}

function isEventInvitee(member, event) {
    if (!isAuthorizedCouncilMember(member, councilPositions, councilCommittees) || !event) return false;
    const invitedCommittees = eventInviteCommittees(event);
    if (invitedCommittees.includes("all")) return true;
    const memberCommittees = new Set();
    if (member.role === "admin" || member.committee_assignment === "executive" || executiveCouncilPositions.has(member.council_position)) memberCommittees.add("executive");
    if (councilCommittees.has(member.committee_assignment)) memberCommittees.add(member.committee_assignment);
    return invitedCommittees.some((committee) => memberCommittees.has(committee));
}

function isCouncilParticipationOpen(event, now = new Date()) {
    const end = event?.end_date ? new Date(event.end_date) : null;
    return Boolean(event && event.participation_open !== false && end && !Number.isNaN(end.getTime()) && end >= now &&
        !["cancelled", "completed", "archived"].includes(event.status) && !["cancelled", "archived"].includes(event.publication_status));
}

async function listEventResponseMembers(event) {
    const members = await collections.users.find({ $or: [
        { role: "admin" },
        { council_position: { $in: [...councilPositions] } },
        { committee_assignment: { $in: [...councilCommittees] } }
    ] }, { projection: { id: 1, role: 1, first_name: 1, last_name: 1, student_id: 1, email: 1, course: 1, council_position: 1, council_department: 1, committee_assignment: 1 } }).toArray();
    return members.filter((member) => isEventInvitee(member, event));
}

async function countInvitedEventResponses(events) {
    if (!events.length) return new Map();
    const eventIds = events.map((event) => event.id);
    const eventMap = new Map(events.map((event) => [event.id, event]));
    const responses = await collections.eventResponses.find({ event_id: { $in: eventIds } }, { projection: { event_id: 1, user_id: 1, status: 1 } }).toArray();
    const userIds = [...new Set(responses.map((response) => response.user_id))];
    const users = userIds.length ? await collections.users.find({ id: { $in: userIds } }, { projection: { id: 1, role: 1, council_position: 1, committee_assignment: 1 } }).toArray() : [];
    const userMap = new Map(users.map((user) => [user.id, user]));
    const counts = new Map();
    for (const event of events) counts.set(event.id, { total: 0, accepted: 0, pending: 0, declined: 0 });
    for (const response of responses) {
        const event = eventMap.get(response.event_id), member = userMap.get(response.user_id);
        if (!isEventInvitee(member, event)) continue;
        const count = counts.get(response.event_id);
        count.total += 1;
        if (Object.hasOwn(count, response.status)) count[response.status] += 1;
    }
    return counts;
}

async function seedEventResponseRoster(eventId, members, now = new Date()) {
    if (!members.length) return;
    const operations = await Promise.all(members.map(async (member) => ({
        updateOne: {
            filter: { event_id: Number(eventId), user_id: Number(member.id) },
            update: { $setOnInsert: { id: await nextId("event_responses"), event_id: Number(eventId), user_id: Number(member.id), status: "pending", created_at: now, responded_at: null, history: [] } },
            upsert: true
        }
    })));
    await collections.eventResponses.bulkWrite(operations, { ordered: false });
}

function eventNoticeMessage(event, reason) {
    const start = new Date(event.start_date).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });
    const end = new Date(event.end_date).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" });
    const description = text(event.description).trim();
    const instruction = reason === "New council event"
        ? "Open the event to accept or decline council participation."
        : reason === "Event cancelled"
            ? "This event has been cancelled. Review the event page for details."
            : "Review the updated details and revise your participation response if needed.";
    return `${reason}\n${event.title}\nWhen: ${start}–${end} (Philippine time)\nWhere: ${event.location}\n${description.slice(0, 500)}${description.length > 500 ? "…" : ""}\n${instruction}`.slice(0, 950);
}

function eventNoticeStatus(result) {
    if (result.failed_count) return "failed";
    return result.recipient_count ? "sent" : "no_recipients";
}

async function notifyEventResponseMembers(event, reason, dedupeKey) {
    const members = await listEventResponseMembers(event);
    await seedEventResponseRoster(event.id, members);
    let pending = members;
    for (let attempt = 0; attempt < 2 && pending.length; attempt += 1) {
        const results = await Promise.allSettled(pending.map((member) => createNotification(member.id, {
            kind: reason === "New council event" ? "event_invitation" : reason === "Event cancelled" ? "event_cancelled" : "event_updated",
            title: reason === "New council event" ? `Council event: ${event.title}` : reason === "Event cancelled" ? `Event cancelled: ${event.title}` : `Event details updated: ${event.title}`,
            message: eventNoticeMessage(event, reason), eventId: event.id, href: `/events/${event.id}`,
            dedupeKey: `${dedupeKey}:${member.id}`
        })));
        pending = pending.filter((_member, index) => results[index].status === "rejected");
    }
    return { recipient_count: members.length, delivered_count: members.length - pending.length, failed_count: pending.length };
}

async function notifyPublicationExecutives(kind, title, message, taskId, dedupeKey) {
    const executives = await collections.users.find({ $or: [
        { role: "admin" },
        { committee_assignment: "executive" },
        { council_position: { $in: [...executiveCouncilPositions] } }
    ] }, { projection: { id: 1 } }).toArray();
    await Promise.all(executives.map((user) => createNotification(user.id, { kind, title, message, taskId, dedupeKey: `${dedupeKey}:${user.id}` })));
}

async function createPublicationDeadlineNotices(userId) {
    const now = new Date();
    const cutoff = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const tasks = await collections.committeeWorkItems.find({
        committee: "publication", kind: "pubmat", assignee_user_id: Number(userId), submissions: { $in: [null, []] },
        status: { $nin: ["Cancelled", "Posted", "Approved", "Published", "Archived"] },
        due_at: { $lte: cutoff }
    }, { projection: { id: 1, title: 1, due_at: 1 } }).limit(100).toArray();
    for (const task of tasks) {
        const due = task.due_at instanceof Date ? task.due_at : new Date(task.due_at);
        if (Number.isNaN(due.getTime())) continue;
        const overdue = due <= now;
        await createNotification(userId, {
            kind: overdue ? "task_overdue" : "deadline_reminder",
            title: overdue ? "Publication task overdue" : "Publication deadline approaching",
            message: overdue ? `${task.title} is past its deadline.` : `${task.title} is due within 24 hours.`,
            taskId: task.id,
            dedupeKey: `publication:${task.id}:${overdue ? "overdue" : "reminder"}:${due.getTime()}`
        });
    }
}

function withSubmissionLinks(task) {
    return {
        ...task,
        submissions: (task.submissions || []).map((submission) => ({
            ...submission,
            attachment_url: submission.attachment_file_id
                ? `/api/publication/tasks/${task.id}/submissions/${submission.version}/attachment`
                : ""
        }))
    };
}

function revisionFilter(item) {
    const filter = { id: item.id };
    if (Object.prototype.hasOwnProperty.call(item, "revision")) filter.revision = item.revision;
    else filter.revision = { $exists: false };
    return filter;
}

function publicationTaskId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function classScheduleOverlaps(slots, startValue, endValue) {
    const start = new Date(startValue), end = new Date(endValue);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return false;
    const partsFor = (date) => Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(date).map((part) => [part.type, part.value]));
    const startParts = partsFor(start), endParts = partsFor(end);
    const startKey = `${startParts.year}-${startParts.month}-${startParts.day}`;
    const endKey = `${endParts.year}-${endParts.month}-${endParts.day}`;
    const dateKeyUtc = (key) => Date.parse(`${key}T00:00:00Z`);
    const startDay = dateKeyUtc(startKey), endDay = dateKeyUtc(endKey);
    const startMinute = Number(startParts.hour) * 60 + Number(startParts.minute);
    const endMinute = Number(endParts.hour) * 60 + Number(endParts.minute);
    for (let day = startDay; day <= endDay; day += 24 * 60 * 60 * 1000) {
        const date = new Date(day);
        const key = date.toISOString().slice(0, 10);
        const lower = key === startKey ? startMinute : 0;
        const upper = key === endKey ? endMinute : 1440;
        if (upper <= lower) continue;
        const weekday = date.getUTCDay();
        for (const slot of slots || []) {
            if (Number(slot.day_of_week) !== weekday) continue;
            const [startHour, startMinutes] = text(slot.start_time).split(":").map(Number);
            const [endHour, endMinutes] = text(slot.end_time).split(":").map(Number);
            const classStart = startHour * 60 + startMinutes, classEnd = endHour * 60 + endMinutes;
            if (classStart < upper && classEnd > lower) return true;
        }
    }
    return false;
}

async function storePublicationAttachment(file, taskId, userId, version) {
    if (!file) return null;
    const type = await fileTypeFromBuffer(file.buffer);
    if (!type || !publicationFileTypes.has(type.mime)) {
        throw new Error("Use a JPG, PNG, WebP, MP4, WebM, or MOV attachment.");
    }
    const id = new ObjectId();
    await new Promise((resolve, reject) => {
        const stream = committeeSubmissionFiles.openUploadStreamWithId(id, `submission-${taskId}-${version}-${id.toHexString()}`, {
            contentType: type.mime,
            metadata: { task_id: taskId, owner_user_id: userId, version }
        });
        stream.once("error", reject);
        stream.once("finish", resolve);
        stream.end(file.buffer);
    });
    return { id: id.toHexString(), content_type: type.mime, file_name: text(file.originalname).slice(0, 180), size: file.size };
}

app.get("/api/notifications", signedIn, async (req, res, next) => {
    const userId = Number(req.session.userId);
    try {
        await createPublicationDeadlineNotices(userId);
        const [notifications, unreadCount] = await Promise.all([
            collections.notifications.find({ user_id: userId }).sort({ created_at: -1 }).limit(50).toArray(),
            collections.notifications.countDocuments({ user_id: userId, read_at: null })
        ]);
        return ok(res, null, { notifications, unread_count: unreadCount });
    } catch (error) { return next(error); }
});

app.post("/api/notifications/read", signedIn, async (req, res, next) => {
    const id = publicationTaskId(req.body.id);
    if (!id) return fail(res, 422, "Choose a valid notification.");
    try {
        const result = await collections.notifications.updateOne({ id, user_id: Number(req.session.userId), read_at: null }, { $set: { read_at: new Date() } });
        return ok(res, result.matchedCount ? "Notification marked as read." : "Notification is already read.");
    } catch (error) { return next(error); }
});

app.post("/api/notifications/read-all", signedIn, async (req, res, next) => {
    try {
        await collections.notifications.updateMany({ user_id: Number(req.session.userId), read_at: null }, { $set: { read_at: new Date() } });
        return ok(res, "Notifications marked as read.");
    } catch (error) { return next(error); }
});

app.get("/api/publication/tasks/mine", signedIn, async (req, res, next) => {
    const userId = Number(req.session.userId);
    try {
        const user = await collections.users.findOne({ id: userId }, { projection: { id: 1, committee_assignment: 1 } });
        if (!user || (user.committee_assignment !== "publication" && !hasExecutiveAccess(user))) return fail(res, 403, "Publication Committee access is required.");
        const tasks = await collections.committeeWorkItems.find({ committee: "publication", kind: "pubmat", assignee_user_id: userId })
            .sort({ due_at: 1, updated_at: -1 }).limit(200).toArray();
        const eventIds = [...new Set(tasks.map((task) => task.event_id).filter(Boolean))];
        const events = eventIds.length ? await collections.events.find({ id: { $in: eventIds } }, { projection: { id: 1, title: 1 } }).toArray() : [];
        const eventMap = new Map(events.map((event) => [event.id, event.title]));
        const normalized = tasks.map((task) => withSubmissionLinks({ ...task, event_title: eventMap.get(task.event_id) || "Council-wide" }));
        return ok(res, null, { tasks: normalized, performance: summarizePublicationPerformance(tasks) });
    } catch (error) { return next(error); }
});

app.get("/api/admin/publication/tasks", adminOnly, async (_req, res, next) => {
    try {
        const tasks = await collections.committeeWorkItems.find({ committee: "publication", kind: "pubmat" }).sort({ due_at: 1, updated_at: -1 }).limit(500).toArray();
        const ids = [...new Set(tasks.map((task) => task.assignee_user_id).filter(Boolean))];
        const eventIds = [...new Set(tasks.map((task) => task.event_id).filter(Boolean))];
        const [members, events] = await Promise.all([
            collections.users.find({ committee_assignment: "publication" }, { projection: { id: 1, first_name: 1, last_name: 1, email: 1, student_id: 1 } }).sort({ first_name: 1, last_name: 1 }).toArray(),
            eventIds.length ? collections.events.find({ id: { $in: eventIds } }, { projection: { id: 1, title: 1 } }).toArray() : []
        ]);
        const memberMap = new Map(members.map((member) => [member.id, member]));
        const eventMap = new Map(events.map((event) => [event.id, event.title]));
        const enriched = tasks.map((task) => withSubmissionLinks({
            ...task,
            event_title: eventMap.get(task.event_id) || "Council-wide",
            assignee: memberMap.get(task.assignee_user_id) || null,
            assignee_name: memberMap.has(task.assignee_user_id) ? `${memberMap.get(task.assignee_user_id).first_name || ""} ${memberMap.get(task.assignee_user_id).last_name || ""}`.trim() : "Unassigned"
        }));
        const byMember = new Map();
        for (const task of tasks.filter((item) => item.assignee_user_id)) {
            if (!byMember.has(task.assignee_user_id)) byMember.set(task.assignee_user_id, []);
            byMember.get(task.assignee_user_id).push(task);
        }
        const performanceByMember = members.map((member) => ({
            user: member,
            performance: summarizePublicationPerformance(byMember.get(member.id) || [])
        }));
        return ok(res, null, { tasks: enriched, metrics: summarizePublicationPerformance(tasks), members, performance_by_member: performanceByMember });
    } catch (error) { return next(error); }
});

app.post("/api/publication/tasks/progress", signedIn, async (req, res, next) => {
    const id = publicationTaskId(req.body.id);
    if (!id) return fail(res, 422, "Choose a valid publication task.");
    try {
        const userId = Number(req.session.userId);
        const item = await collections.committeeWorkItems.findOne({ id, committee: "publication", kind: "pubmat", assignee_user_id: userId });
        if (!item) return fail(res, 404, "Assigned publication task not found.");
        if (["Assigned", "Not Started"].includes(item.status) && ["In Design", "In Progress"].includes(req.body.status)) {
            const now = new Date();
            const updated = await collections.committeeWorkItems.updateOne(revisionFilter(item), { $set: { status: "In Design", updated_at: now }, $push: { activity: { at: now, actor_id: userId, status: "In Design" } }, $inc: { revision: 1 } });
            if (!updated.modifiedCount) return fail(res, 409, "This task changed. Refresh and try again.");
        } else if (!["In Design", "In Progress", "Revisions Requested", "Revision Requested"].includes(item.status)) {
            return fail(res, 422, "This task cannot be changed at its current review stage.");
        }
        return ok(res, "Task progress updated.");
    } catch (error) { return next(error); }
});

app.post("/api/publication/tasks/submit", signedIn, publicationSubmissionMiddleware, async (req, res, next) => {
    const id = publicationTaskId(req.body.id);
    const projectUrl = text(req.body.project_url).trim();
    const notes = text(req.body.notes).trim();
    if (!id || notes.length > 2000 || (projectUrl && (!/^https:\/\//i.test(projectUrl) || projectUrl.length > 1200))) return fail(res, 422, "Enter a valid task, HTTPS project link, and notes under 2,000 characters.");
    if (!projectUrl && !req.file) return fail(res, 422, "Add a project link or attach a file.");
    try {
        const userId = Number(req.session.userId);
        const item = await collections.committeeWorkItems.findOne({ id, committee: "publication", kind: "pubmat", assignee_user_id: userId });
        if (!item) return fail(res, 404, "Assigned publication task not found.");
        const submittableStatuses = ["Not Started", "In Progress", "Revision Requested", "Request Submitted", "Requirements Review", "Assigned", "In Design", "Internal Review", "Revisions Requested", "Awaiting Approval"];
        const legacyReviewStageWithoutSubmission = ["Internal Review", "Awaiting Approval"].includes(item.status) && !(item.submissions || []).length;
        if (!submittableStatuses.includes(item.status) || (["Internal Review", "Awaiting Approval"].includes(item.status) && !legacyReviewStageWithoutSubmission)) return fail(res, 409, "This task is not accepting a submission at its current status.");
        const version = (item.submissions || []).length + 1;
        const attachment = req.file ? await storePublicationAttachment(req.file, id, userId, version) : null;
        const now = new Date();
        const submission = {
            version, submitted_by: userId, submitted_at: now, deadline_snapshot: item.due_at || null,
            project_url: projectUrl || null, notes, review_status: "pending",
            ...(attachment ? { attachment_file_id: attachment.id, content_type: attachment.content_type, file_name: attachment.file_name, file_size: attachment.size } : {})
        };
        const result = await collections.committeeWorkItems.updateOne(revisionFilter(item), {
            $set: { status: "Internal Review", updated_at: now },
            $push: { submissions: submission, activity: { at: now, actor_id: userId, status: "Internal Review" } },
            $inc: { revision: 1 }
        });
        if (!result.modifiedCount) {
            if (attachment) await committeeSubmissionFiles.delete(new ObjectId(attachment.id)).catch(() => {});
            return fail(res, 409, "This task changed while the submission was being uploaded. Refresh and submit again.");
        }
        await notifyPublicationExecutives("submission_received", "Publication work submitted", `${item.title} is ready for review.`, id, `publication:submission:${id}:${version}`);
        return ok(res, "Your work was submitted for review.", { version, submitted_at: now });
    } catch (error) {
        if (error.message?.startsWith("Use a JPG")) return fail(res, 422, error.message);
        return next(error);
    }
});

app.get("/api/publication/tasks/:taskId/submissions/:version/attachment", signedIn, async (req, res, next) => {
    const taskId = publicationTaskId(req.params.taskId);
    const version = publicationTaskId(req.params.version);
    if (!taskId || !version) return fail(res, 404, "Submission attachment not found.");
    try {
        const [item, user] = await Promise.all([
            collections.committeeWorkItems.findOne({ id: taskId, committee: "publication", kind: "pubmat" }),
            getSessionUser(req)
        ]);
        if (!item) return fail(res, 404, "Submission attachment not found.");
        if (Number(req.session.userId) !== item.assignee_user_id && !hasExecutiveAccess(user)) return fail(res, 403, "You cannot view this submission.");
        const submission = (item.submissions || []).find((entry) => entry.version === version);
        if (!submission?.attachment_file_id) return fail(res, 404, "Submission attachment not found.");
        const fileId = new ObjectId(submission.attachment_file_id);
        const file = await db.collection("committee_submissions.files").findOne({ _id: fileId, "metadata.task_id": taskId });
        if (!file) return fail(res, 404, "Submission attachment not found.");
        res.setHeader("Content-Type", file.contentType || "application/octet-stream");
        res.setHeader("Content-Disposition", `inline; filename="${String(submission.file_name || "submission").replace(/[\\"\r\n]/g, "_")}"`);
        res.setHeader("Cache-Control", "private, no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        committeeSubmissionFiles.openDownloadStream(fileId).on("error", next).pipe(res);
    } catch (error) { return next(error); }
});

app.post("/api/admin/publication/tasks/review", adminOnly, async (req, res, next) => {
    const id = publicationTaskId(req.body.id);
    const decision = text(req.body.decision).trim();
    const note = text(req.body.note).trim();
    if (!id || !["approve", "revision"].includes(decision) || note.length > 2000 || (decision === "revision" && !note)) return fail(res, 422, "Choose a review decision and provide feedback for requested revisions.");
    try {
        const item = await collections.committeeWorkItems.findOne({ id, committee: "publication", kind: "pubmat" });
        if (!item || !["Submitted for Review", "Internal Review", "Awaiting Approval"].includes(item.status)) return fail(res, 409, "There is no pending submission to review.");
        const index = (item.submissions || []).length - 1;
        if (index < 0) return fail(res, 409, "There is no submission to review.");
        const status = decision === "approve" ? (item.scheduled_post_at ? "Scheduled" : "Approved") : "Revisions Requested";
        const now = new Date();
        const update = await collections.committeeWorkItems.updateOne(revisionFilter(item), {
            $set: {
                status, updated_at: now,
                [`submissions.${index}.review_status`]: decision === "approve" ? "approved" : "revisions_requested",
                [`submissions.${index}.review_note`]: note,
                [`submissions.${index}.reviewed_at`]: now,
                [`submissions.${index}.reviewed_by`]: Number(req.session.userId)
            },
            $push: {
                [`submissions.${index}.review_history`]: { decision, note, reviewed_by: Number(req.session.userId), reviewed_at: now },
                activity: { at: now, actor_id: Number(req.session.userId), status, note }
            },
            $inc: { revision: 1 }
        });
        if (!update.modifiedCount) return fail(res, 409, "This task changed while you were reviewing it. Refresh and try again.");
        if (item.assignee_user_id) await createNotification(item.assignee_user_id, {
            kind: decision === "approve" ? "submission_approved" : "revision_requested",
            title: decision === "approve" ? "Publication work approved" : "Revisions requested",
            message: decision === "approve" ? `${item.title} was approved.` : `Feedback is ready for ${item.title}: ${note.slice(0, 220)}`,
            taskId: id,
            dedupeKey: `publication:${id}:review:${index + 1}:${decision}`
        });
        return ok(res, decision === "approve" ? "Submission approved." : "Revision request sent.");
    } catch (error) { return next(error); }
});

app.post("/api/admin/publication/tasks/archive", adminOnly, async (req, res, next) => {
    const id = publicationTaskId(req.body.id);
    if (!id) return fail(res, 422, "Choose a valid publication task.");
    try {
        const item = await collections.committeeWorkItems.findOne({ id, committee: "publication", kind: "pubmat", status: "Published" });
        if (!item) return fail(res, 409, "Only published materials can be archived.");
        const now = new Date();
        const update = await collections.committeeWorkItems.updateOne(revisionFilter(item), {
            $set: { status: "Archived", archived_at: now, archived_by: Number(req.session.userId), updated_at: now },
            $push: { activity: { at: now, actor_id: Number(req.session.userId), status: "Archived" } },
            $inc: { revision: 1 }
        });
        if (!update.modifiedCount) return fail(res, 409, "This task changed while archiving was being recorded.");
        return ok(res, "Published material archived.");
    } catch (error) { return next(error); }
});

app.post("/api/admin/publication/tasks/cancel", adminOnly, async (req, res, next) => {
    const id = publicationTaskId(req.body.id);
    if (!id) return fail(res, 422, "Choose a valid publication task.");
    try {
        const item = await collections.committeeWorkItems.findOne({ id, committee: "publication", kind: "pubmat" });
        if (!item || ["Cancelled", "Posted", "Published", "Archived"].includes(item.status)) return fail(res, 409, "This publication task can no longer be cancelled.");
        const now = new Date();
        const update = await collections.committeeWorkItems.updateOne(revisionFilter(item), {
            $set: { status: "Cancelled", updated_at: now },
            $push: { activity: { at: now, actor_id: Number(req.session.userId), status: "Cancelled" } },
            $inc: { revision: 1 }
        });
        if (!update.modifiedCount) return fail(res, 409, "This task changed while cancellation was being recorded.");
        if (item.assignee_user_id) await createNotification(item.assignee_user_id, { kind: "task_cancelled", title: "Publication task cancelled", message: `${item.title} was cancelled.`, taskId: id, dedupeKey: `publication:${id}:cancelled:${now.getTime()}` });
        return ok(res, "Publication task cancelled.");
    } catch (error) { return next(error); }
});

app.post("/api/admin/publication/tasks/post", adminOnly, async (req, res, next) => {
    const id = publicationTaskId(req.body.id);
    const postedAt = req.body.posted_at ? parseDate(text(req.body.posted_at)) : new Date();
    const publishedUrl = text(req.body.published_url).trim();
    if (!id || !postedAt || (publishedUrl && (!/^https:\/\//i.test(publishedUrl) || publishedUrl.length > 1200))) return fail(res, 422, "Enter a valid posting date and an HTTPS link to the published material.");
    try {
        const item = await collections.committeeWorkItems.findOne({ id, committee: "publication", kind: "pubmat" });
        if (!item || !["Approved", "Scheduled"].includes(item.status)) return fail(res, 409, "Only approved or scheduled work can be marked as published.");
        const update = await collections.committeeWorkItems.updateOne(revisionFilter(item), {
            $set: { status: "Published", posted_at: postedAt, posted_by: Number(req.session.userId), ...(publishedUrl ? { published_url: publishedUrl } : {}), updated_at: new Date() },
            $push: { activity: { at: new Date(), actor_id: Number(req.session.userId), status: "Published", posted_at: postedAt } },
            $inc: { revision: 1 }
        });
        if (!update.modifiedCount) return fail(res, 409, "This task changed while posting was being recorded.");
        if (item.assignee_user_id) await createNotification(item.assignee_user_id, { kind: "task_posted", title: "Publication is live", message: `${item.title} has been recorded as posted.`, taskId: id, dedupeKey: `publication:${id}:posted` });
        return ok(res, "Actual posting date recorded.");
    } catch (error) { return next(error); }
});

app.get("/api/admin/dashboard", adminOnly, async (_req, res, next) => {
    try {
        const now = new Date();
        const period = periodForDate(now);
        const [
            studentCount,
            studentCourseRows,
            studentAttendanceCount,
            totalEventCount,
            activeEventCount,
            publicationRows,
            eventRows,
            eventAudienceRows,
            councilMetricsRows,
            meetings,
            reports,
            pendingApprovalWorkCount,
            financeRows
        ] = await Promise.all([
            collections.users.countDocuments({ role: "student" }),
            collections.users.aggregate([
                { $match: { role: "student", course: { $type: "string", $ne: "" } } },
                { $group: { _id: "$course", count: { $sum: 1 } } },
                { $sort: { count: -1, _id: 1 } },
                { $limit: 6 }
            ]).toArray(),
            collections.attendance.countDocuments({ participant_type: { $ne: "council" } }),
            collections.events.countDocuments({}),
            collections.events.countDocuments({ status: { $in: ["upcoming", "ongoing"] }, $or: [{ publication_status: "published" }, { publication_status: { $exists: false } }] }),
            collections.events.aggregate([{ $group: { _id: { $ifNull: ["$publication_status", "published"] }, count: { $sum: 1 } } }]).toArray(),
            collections.events.find({ status: { $in: ["upcoming", "ongoing"] }, $or: [{ publication_status: "published" }, { publication_status: { $exists: false } }] }, { projection: { id: 1, title: 1, start_date: 1, end_date: 1, location: 1, cover_image: 1, capacity: 1, status: 1, publication_status: 1 } }).sort({ start_date: 1 }).limit(4).toArray(),
            collections.events.find({}, { projection: { id: 1, invited_committees: 1 } }).toArray(),
            collections.users.aggregate([{ $facet: {
                roster: [{ $match: { council_position: { $in: [...councilPositions] } } }, { $count: "count" }],
                voting: [{ $match: { council_position: { $in: votingCouncilPositions } } }, { $count: "count" }],
                executive: [{ $match: { $or: [{ committee_assignment: "executive" }, { council_position: { $in: [...executiveCouncilPositions] } }] } }, { $count: "count" }],
                committees: [{ $match: { committee_assignment: { $in: [...workCommittees] } } }, { $group: { _id: "$committee_assignment", count: { $sum: 1 } } }]
            } }]).toArray(),
            collections.governanceMeetings.find({ academic_period: period }, { projection: { id: 1, title: 1, meeting_type: 1, mandatory: 1, status: 1, start_at: 1, end_at: 1, quorum_waiver_rationale: 1, minutes_status: 1 } }).sort({ start_at: 1 }).toArray(),
            collections.councilReports.find({ academic_period: period }, { projection: { committee: 1, status: 1 } }).toArray(),
            collections.committeeWorkItems.countDocuments({ committee: "executive", kind: "approval", status: { $nin: ["Approved", "Complete", "Archived"] } }),
            collections.financialRecords.find({ $or: [{ type: "allocation", status: { $in: ["proposed", "approved"] } }, { type: "expense", status: { $in: ["pending", "recorded"] } }] }, { projection: { type: 1, status: 1, amount: 1 } }).toArray()
        ]);

        const publication = Object.fromEntries(publicationRows.map(({ _id, count }) => [_id, count]));
        const eventResponseCount = await countInvitedEventResponses(eventAudienceRows);
        const pendingResponseCount = [...eventResponseCount.values()].reduce((sum, counts) => sum + counts.pending, 0);
        const councilMetrics = councilMetricsRows[0] || {};
        const votingMemberCount = councilMetrics.voting?.[0]?.count || 0;
        const quorumThreshold = votingMemberCount ? Math.ceil(votingMemberCount * 2 / 3) : 0;
        const meetingIds = meetings.map((meeting) => meeting.id);
        const [councilAttendance, currentPeriodExcuses] = meetingIds.length ? await Promise.all([
            collections.councilAttendance.find({ meeting_id: { $in: meetingIds } }, { projection: { meeting_id: 1, user_id: 1 } }).toArray(),
            collections.councilExcuses.find({ meeting_id: { $in: meetingIds }, status: { $in: ["pending", "approved"] } }, { projection: { id: 1, meeting_id: 1, user_id: 1, status: 1 } }).toArray()
        ]) : [[], []];
        const attendanceByMeeting = new Map();
        for (const record of councilAttendance) {
            const present = attendanceByMeeting.get(record.meeting_id) || new Set();
            present.add(record.user_id);
            attendanceByMeeting.set(record.meeting_id, present);
        }
        const approvedExcusesByMeeting = new Map();
        for (const excuse of currentPeriodExcuses.filter((record) => record.status === "approved")) {
            const excused = approvedExcusesByMeeting.get(excuse.meeting_id) || new Set();
            excused.add(excuse.user_id);
            approvedExcusesByMeeting.set(excuse.meeting_id, excused);
        }
        const completedMandatoryMeetings = meetings.filter((meeting) => meeting.mandatory && meeting.status !== "cancelled" && new Date(meeting.end_at) <= now);
        const meetingChart = completedMandatoryMeetings.slice(-6).map((meeting) => {
            const present = attendanceByMeeting.get(meeting.id)?.size || 0;
            const waived = Boolean(meeting.quorum_waiver_rationale);
            return { id: meeting.id, title: meeting.title, start_at: meeting.start_at, present, voting_members: votingMemberCount, quorum_required: quorumThreshold, quorum_met: votingMemberCount > 0 && present >= quorumThreshold, quorum_waived: waived };
        });
        let totalMeetingAttendance = 0;
        let possibleMeetingAttendance = 0;
        for (const meeting of completedMandatoryMeetings) {
            const approvedExcuses = approvedExcusesByMeeting.get(meeting.id) || new Set();
            const present = attendanceByMeeting.get(meeting.id) || new Set();
            possibleMeetingAttendance += Math.max(0, votingMemberCount - approvedExcuses.size);
            totalMeetingAttendance += [...present].filter((userId) => !approvedExcuses.has(userId)).length;
        }
        const reportStatusCount = reports.reduce((result, report) => {
            result[report.status] = (result[report.status] || 0) + 1;
            result.by_committee[report.committee] = (result.by_committee[report.committee] || 0) + 1;
            return result;
        }, { by_committee: Object.fromEntries([...workCommittees].map((committee) => [committee, 0])) });
        const finance = financeRows.reduce((summary, record) => {
            const amount = Number(record.amount) || 0;
            if (record.type === "allocation" && record.status === "approved") summary.approved_allocations += amount;
            if (record.type === "allocation" && record.status === "proposed") summary.proposed_allocations += amount;
            if (record.type === "expense" && record.status === "recorded") summary.recorded_expenses += amount;
            if (record.type === "expense" && record.status === "pending") summary.pending_expenses += amount;
            return summary;
        }, { approved_allocations: 0, proposed_allocations: 0, recorded_expenses: 0, pending_expenses: 0 });
        const publicationPending = Number(publication.pending_approval || 0);
        const reportsPending = Number(reportStatusCount.submitted || 0);
        const minutesPending = meetings.filter((meeting) => meeting.minutes_status === "pending_advisor").length;
        const pendingExcuseReviews = currentPeriodExcuses.filter((excuse) => excuse.status === "pending").length;
        const pendingApprovals = publicationPending + reportsPending + minutesPending + pendingExcuseReviews + pendingApprovalWorkCount;

        return ok(res, null, {
            dashboard: {
                academic_period: period,
                students: {
                    account_count: studentCount,
                    attendance_session_count: studentAttendanceCount,
                    course_distribution: studentCourseRows.map((row) => ({ course: row._id, count: row.count }))
                },
                events: {
                    total: totalEventCount,
                    upcoming_or_live: activeEventCount,
                    pending_approval: publicationPending,
                    publication_status: { draft: publication.draft || 0, pending_approval: publicationPending, published: publication.published || 0, cancelled: publication.cancelled || 0, archived: publication.archived || 0 }
                },
                council: {
                    roster_count: councilMetrics.roster?.[0]?.count || 0,
                    voting_member_count: votingMemberCount,
                    committee_distribution: [
                        { committee: "executive", count: councilMetrics.executive?.[0]?.count || 0 },
                        ...["publication", "program", "production"].map((committee) => ({ committee, count: councilMetrics.committees?.find((row) => row._id === committee)?.count || 0 }))
                    ],
                    academic_period: period,
                    meeting_count: meetings.length,
                    completed_mandatory_meeting_count: completedMandatoryMeetings.length,
                    mean_meeting_attendance: possibleMeetingAttendance ? Math.round(totalMeetingAttendance / possibleMeetingAttendance * 100) : null,
                    quorum_threshold: quorumThreshold,
                    quorum_met_count: meetingChart.filter((meeting) => meeting.quorum_met || meeting.quorum_waived).length,
                    meeting_chart: meetingChart,
                    report_count: reports.length,
                    reports_pending: reportsPending,
                    reports_by_committee: reportStatusCount.by_committee,
                    minutes_pending_review: minutesPending,
                    excuses_pending_review: pendingExcuseReviews,
                    event_responses_pending: pendingResponseCount,
                    approval_queue_count: pendingApprovals,
                    finance: { ...finance, available_balance: finance.approved_allocations - finance.recorded_expenses }
                }
            },
            events: eventRows.map((event) => ({ ...withEventStatus(event), response_count: eventResponseCount.get(event.id)?.total || 0, accepted_response_count: eventResponseCount.get(event.id)?.accepted || 0, pending_response_count: eventResponseCount.get(event.id)?.pending || 0, declined_response_count: eventResponseCount.get(event.id)?.declined || 0 }))
        });
    } catch (error) { return next(error); }
});

app.get("/api/admin/committee-work", committeeWorkspaceAccess, async (req, res, next) => {
    const committee = req.workspaceCommittee || text(req.query.committee).trim().toLowerCase();
    if (committee && !workCommittees.has(committee)) return fail(res, 422, "Choose a valid committee workspace.");
    try {
        const isExecutive = !req.workspaceCommittee;
        const query = committee && committee !== "executive" ? { committee } : {};
        if (req.workspaceCommittee === "publication") Object.assign(query, { kind: "pubmat", assignee_user_id: Number(req.session.userId) });
        const itemProjection = isExecutive ? {} : { submissions: 0, deadline_history: 0, change_history: 0, assignee_history: 0 };
        const visibleEventsQuery = isExecutive
            ? {}
            : { status: { $ne: "cancelled" }, $or: [{ publication_status: "published" }, { publication_status: { $exists: false } }] };
        const usersQuery = isExecutive
            ? { $or: [
                { committee_assignment: committee || "executive" },
                { committee_assignment: { $in: [...councilCommittees] } },
                { committee_assignment: "executive" },
                { role: "admin" },
                { council_position: { $in: [...councilPositions] } }
            ] }
            : req.workspaceCommittee === "publication" ? { id: Number(req.session.userId) } : { committee_assignment: req.workspaceCommittee };
        const [items, events, users, eventCount, activeEventCount, attendanceCount, workApprovalCount, pendingEvents, financeRecords, eventAudienceRows] = await Promise.all([
            collections.committeeWorkItems.find(query, { projection: itemProjection }).sort({ due_at: 1, updated_at: -1 }).toArray(),
            collections.events.find(visibleEventsQuery, { projection: { id: 1, title: 1, start_date: 1, end_date: 1, status: 1 } }).sort({ start_date: -1 }).toArray(),
            collections.users.find(usersQuery, { projection: { id: 1, first_name: 1, last_name: 1, email: 1, role: 1, council_position: 1, committee_assignment: 1 } }).sort({ first_name: 1 }).toArray(),
            isExecutive ? collections.events.countDocuments({}) : Promise.resolve(0),
            isExecutive ? collections.events.countDocuments({ status: { $in: ["upcoming", "ongoing"] } }) : Promise.resolve(0),
            isExecutive ? collections.attendance.countDocuments({}) : Promise.resolve(0),
            isExecutive ? collections.committeeWorkItems.countDocuments({ committee: "executive", kind: "approval", status: { $nin: ["Approved", "Complete", "Archived"] } }) : Promise.resolve(0),
            isExecutive && committee === "executive" ? collections.events.find({ publication_status: "pending_approval" }, { projection: { id: 1, title: 1, description: 1, start_date: 1, end_date: 1, location: 1, cover_image: 1 } }).sort({ start_date: 1 }).toArray() : Promise.resolve([]),
            isExecutive && committee === "executive" ? collections.financialRecords.find({ $or: [{ type: "allocation", status: "approved" }, { type: "expense", status: "recorded" }] }, { projection: { type: 1, amount: 1 } }).toArray() : Promise.resolve([]),
            isExecutive ? collections.events.find({}, { projection: { id: 1, invited_committees: 1 } }).toArray() : Promise.resolve([])
        ]);
        const eventResponseCounts = isExecutive ? await countInvitedEventResponses(eventAudienceRows) : new Map();
        const pendingResponseCount = [...eventResponseCounts.values()].reduce((sum, counts) => sum + counts.pending, 0);
        const eventMap = new Map(events.map((event) => [event.id, event.title]));
        const userMap = new Map(users.map((user) => [user.id, `${user.first_name} ${user.last_name}`.trim()]));
        const financeSummary = financeRecords.reduce((summary, item) => { if (item.type === "allocation") summary.allocated += Number(item.amount); if (item.type === "expense") summary.expenses += Number(item.amount); return summary; }, { allocated: 0, expenses: 0 });
        const eventIds = events.map((event) => event.id);
        const [eventResponses, schedules] = await Promise.all([
            eventIds.length && users.length ? collections.eventResponses.find({ event_id: { $in: eventIds }, user_id: { $in: users.map((user) => user.id) } }, { projection: { event_id: 1, user_id: 1, status: 1 } }).toArray() : Promise.resolve([]),
            users.length ? collections.councilClassSchedules.find({ user_id: { $in: users.map((user) => user.id) } }, { projection: { user_id: 1, academic_period: 1, slots: 1 } }).toArray() : Promise.resolve([])
        ]);
        const responseByPair = new Map(eventResponses.map((response) => [`${response.event_id}:${response.user_id}`, response]));
        const scheduleMap = new Map(schedules.map((schedule) => [`${schedule.academic_period}:${schedule.user_id}`, schedule.slots || []]));
        const availability = [];
        for (const event of events) {
            const schedulePeriod = periodForDate(new Date(event.start_date));
            for (const user of users) {
                if (!isEventInvitee(user, event)) continue;
                const response = responseByPair.get(`${event.id}:${user.id}`);
                if (!response) continue;
                const slots = scheduleMap.get(`${schedulePeriod}:${user.id}`);
                availability.push({ event_id: event.id, user_id: user.id, response_status: response?.status || "pending", has_schedule: Array.isArray(slots), class_conflict: Array.isArray(slots) && classScheduleOverlaps(slots, event.start_date, event.end_date) });
            }
        }
        return ok(res, null, { items: items.map((item) => ({ ...item, event_title: eventMap.get(item.event_id) || "—", assignee_name: userMap.get(item.assignee_user_id) || "Unassigned" })), events, users, availability, event_queue: pendingEvents, overview: isExecutive ? { event_count: eventCount, active_event_count: activeEventCount, attendance_count: attendanceCount, pending_response_count: pendingResponseCount, pending_approval_count: workApprovalCount + pendingEvents.length, approved_allocation_total: financeSummary.allocated, recorded_expense_total: financeSummary.expenses } : null });
    } catch (error) { return next(error); }
});

app.post("/api/admin/committee-work/save", committeeWorkspaceAccess, async (req, res, next) => {
    if (req.workspaceCommittee === "publication") return fail(res, 403, "Publication members use their assigned task submission workflow.");
    const id = Number(req.body.id || 0);
    const committee = req.workspaceCommittee || text(req.body.committee).trim().toLowerCase();
    const kind = text(req.body.kind).trim().toLowerCase();
    const title = text(req.body.title).trim();
    const details = text(req.body.details).trim();
    const concept = text(req.body.concept).trim();
    const deliverables = text(req.body.deliverables).split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 40);
    let status = text(req.body.status).trim();
    const priority = text(req.body.priority || "normal").trim().toLowerCase();
    const eventId = req.body.event_id ? Number(req.body.event_id) : null;
    const assigneeId = req.body.assignee_user_id ? Number(req.body.assignee_user_id) : null;
    const dueAt = req.body.due_at ? parseDate(text(req.body.due_at)) : null;
    const scheduledPostAt = req.body.scheduled_post_at ? parseDate(text(req.body.scheduled_post_at)) : null;
    const attachmentUrl = text(req.body.attachment_url).trim();
    const timeSlot = text(req.body.time_slot).trim();
    const duration = req.body.duration_minutes ? Number(req.body.duration_minutes) : null;
    const checklistLabels = text(req.body.checklist_text).split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 40);
    const validKinds = new Set(["pubmat", "program", "production", "approval", "task"]);
    const kindsByCommittee = { executive: ["approval", "task"], publication: ["pubmat", "task"], program: ["program", "task"], production: ["production", "task"] };
    if (!workCommittees.has(committee) || !validKinds.has(kind) || !kindsByCommittee[committee]?.includes(kind) || !title || title.length > 180 || details.length > 4000 || !workStatuses.has(status) || !["low", "normal", "high", "urgent"].includes(priority)) return fail(res, 422, "Review the work item fields and status.");
    if (req.body.due_at && !dueAt) return fail(res, 422, "Enter a valid deadline.");
    if (req.body.scheduled_post_at && !scheduledPostAt) return fail(res, 422, "Enter a valid scheduled posting date.");
    if (committee === "publication" && kind === "pubmat") {
        if (["Request Submitted", "Requirements Review"].includes(status) && assigneeId && status !== "Requirements Review") status = "Assigned";
        if (status === "Assigned" && !assigneeId) status = "Request Submitted";
        if (status === "Approved" && scheduledPostAt) status = "Scheduled";
        if (status === "Scheduled" && !scheduledPostAt) status = "Approved";
    }
    if (concept.length > 1000 || deliverables.some((entry) => entry.length > 180)) return fail(res, 422, "Keep the concept under 1,000 characters and deliverables under 180 characters each.");
    if (timeSlot && !/^([01]\d|2[0-3]):[0-5]\d$/.test(timeSlot)) return fail(res, 422, "Enter a valid local start time.");
    if (duration !== null && (!Number.isInteger(duration) || duration < 1 || duration > 1440)) return fail(res, 422, "Duration must be between 1 and 1,440 minutes.");
    if (eventId !== null && (!Number.isInteger(eventId) || eventId < 1)) return fail(res, 422, "Choose a valid event.");
    if (assigneeId !== null && (!Number.isInteger(assigneeId) || assigneeId < 1)) return fail(res, 422, "Choose a valid assignee.");
    if (attachmentUrl && (!/^https?:\/\//i.test(attachmentUrl) || attachmentUrl.length > 1000)) return fail(res, 422, "Attachments must use a valid HTTPS or HTTP URL.");
    try {
        const now = new Date();
        const linkedEvent = eventId ? await collections.events.findOne({ id: eventId }) : null;
        if (eventId && !linkedEvent) return fail(res, 404, "Event not found.");
        const existingWorkItem = id ? await collections.committeeWorkItems.findOne({ id }, { projection: { id: 1, committee: 1, kind: 1, event_id: 1, assignee_user_id: 1 } }) : null;
        if (id && !existingWorkItem) return fail(res, 404, "Work item not found.");
        if (existingWorkItem && (existingWorkItem.committee !== committee || existingWorkItem.kind !== kind)) return fail(res, 422, "A work item cannot be moved between committee workflows or types after creation.");
        const isExistingAssignee = Boolean(existingWorkItem && existingWorkItem.assignee_user_id === assigneeId && (existingWorkItem.event_id || null) === eventId);
        if (eventId && assigneeId && !isExistingAssignee) {
            if (!isEventInvitee(await collections.users.findOne({ id: assigneeId }, { projection: { id: 1, role: 1, council_position: 1, committee_assignment: 1 } }), linkedEvent)) {
                return fail(res, 422, "Choose a council member invited to this event.");
            }
            if (!await collections.eventResponses.findOne({ event_id: eventId, user_id: assigneeId, status: "accepted" }, { projection: { id: 1 } })) {
                return fail(res, 422, "Choose an invited council member who accepted this event before assigning them event work.");
            }
            const schedule = await collections.councilClassSchedules.findOne({ user_id: assigneeId, academic_period: periodForDate(new Date(linkedEvent.start_date)) }, { projection: { slots: 1 } });
            const hasConflict = Boolean(schedule && classScheduleOverlaps(schedule.slots || [], linkedEvent.start_date, linkedEvent.end_date));
            if (hasConflict && req.body.confirm_class_conflict !== true && req.body.confirm_class_conflict !== "true") {
                return fail(res, 409, "This member has a class during the event. Confirm that you have checked their availability before assigning the work.");
            }
        }
        if (assigneeId) {
            const assigneeQuery = isExistingAssignee ? null : committee === "publication" && kind === "pubmat"
                ? { id: assigneeId, committee_assignment: "publication" }
                : req.workspaceCommittee
                    ? { id: assigneeId, committee_assignment: req.workspaceCommittee }
                    : eventId
                        ? { id: assigneeId, $or: [
                            { committee_assignment: { $in: [...councilCommittees] } },
                            { council_position: { $in: [...councilPositions] } }
                        ] }
                        : { id: assigneeId, $or: [
                            { committee_assignment: committee },
                            { committee_assignment: "executive" },
                            { role: "admin" },
                            { council_position: { $in: [...executiveCouncilPositions] } }
                        ] };
            if (assigneeQuery && !await collections.users.findOne(assigneeQuery, { projection: { id: 1 } })) {
                return fail(res, 422, req.workspaceCommittee ? "You can assign work only to members of your committee." : "Assignee must belong to this committee or the Executive Committee.");
            }
        }
        if (!id && ((kind === "pubmat" && !["Not Started", "Request Submitted", "Assigned"].includes(status)) || (kind !== "pubmat" && !["Not Started", "Request Submitted"].includes(status)))) return fail(res, 422, "New items must start at the first step in their workflow.");
        if (id) {
            const existing = await collections.committeeWorkItems.findOne({ id });
            if (!existing) return fail(res, 404, "Work item not found.");
            if (existing.committee !== committee || existing.kind !== kind) return fail(res, 422, "A work item cannot be moved between committee workflows or types after creation.");
            const pubmatNext = {
                "Not Started": ["In Design", "In Progress", "Cancelled"],
                "Request Submitted": ["Requirements Review", "Assigned", "Cancelled"],
                "Requirements Review": ["Assigned", "Request Submitted", "Cancelled"],
                "Assigned": ["In Design", "Revisions Requested", "Request Submitted", "Cancelled"],
                "In Design": ["Internal Review", "Revisions Requested", "Cancelled"],
                "Internal Review": ["Awaiting Approval", "Revisions Requested", "Cancelled"],
                "Awaiting Approval": ["Approved", "Scheduled", "Revisions Requested", "Cancelled"],
                "Revisions Requested": ["In Design", "Internal Review", "Cancelled"],
                "Approved": ["Scheduled", "Cancelled"],
                "Scheduled": ["Approved", "Published", "Cancelled"],
                "Published": ["Archived"],
                "Archived": [],
                "Submitted for Review": ["Cancelled"],
                "Revision Requested": ["Cancelled"],
                "In Progress": ["Cancelled"],
                "Posted": [],
                "Cancelled": []
            };
            const taskNext = { "Not Started": ["In Progress", "Blocked"], "In Progress": ["Blocked", "Complete"], "Blocked": ["In Progress"], "Complete": [] };
            const transitions = existing.kind === "pubmat" ? pubmatNext : taskNext;
            if (existing.kind === "pubmat" && status !== existing.status) {
                if (["Internal Review", "Submitted for Review"].includes(status)) return fail(res, 422, "Members submit their work to enter internal review.");
                if (["Approved", "Revisions Requested", "Revision Requested"].includes(status)) return fail(res, 422, "Use the submission review controls to approve work or request revisions.");
                if (["Published", "Posted"].includes(status)) return fail(res, 422, "Record the actual publication using the publish action.");
                if (["Awaiting Approval", "Scheduled"].includes(status) && !(existing.submissions || []).length) return fail(res, 422, "A task needs a member submission before it can enter approval or scheduling.");
                if (status === "Archived" && existing.status !== "Published") return fail(res, 422, "Only published materials can be archived.");
            }
            if (status !== existing.status && !(transitions[existing.status] || []).includes(status)) return fail(res, 422, "That status change is not allowed in this workflow.");
            const completed = new Map((existing.checklist || []).map((item) => [item.label, item.done]));
            req.body.checklist = checklistLabels.map((label) => ({ label, done: Boolean(completed.get(label)) }));
        } else {
            req.body.checklist = checklistLabels.map((label) => ({ label, done: false }));
        }
        const publicationFields = committee === "publication" && kind === "pubmat"
            ? { concept, deliverables, scheduled_post_at: scheduledPostAt }
            : {};
        const values = { committee, kind, title, details, status, priority, event_id: eventId, assignee_user_id: assigneeId, due_at: dueAt, attachment_url: attachmentUrl, checklist: req.body.checklist, time_slot: timeSlot, duration_minutes: duration, ...publicationFields, updated_at: now };
        if (id) {
            const existing = await collections.committeeWorkItems.findOne({ id });
            if (!existing) return fail(res, 404, "Work item not found.");
            const deadlineChanged = committee === "publication" && kind === "pubmat" && (existing.due_at?.getTime?.() || null) !== (dueAt?.getTime?.() || null);
            const assignmentChanged = existing.assignee_user_id !== assigneeId;
            const deadlineHistory = [...(existing.deadline_history || [])];
            if (deadlineChanged) deadlineHistory.push({ from: existing.due_at || null, to: dueAt, changed_at: now, changed_by: Number(req.session.userId) });
            const assigneeHistory = [...(existing.assignee_history || [])];
            if (assignmentChanged) assigneeHistory.push({ from_user_id: existing.assignee_user_id || null, to_user_id: assigneeId, changed_at: now, changed_by: Number(req.session.userId) });
            const changedFields = Object.keys(values).filter((key) => !["updated_at", "checklist"].includes(key) && JSON.stringify(values[key]) !== JSON.stringify(existing[key] ?? null));
            const changeHistory = [...(existing.change_history || [])];
            if (changedFields.length) changeHistory.push({ changed_at: now, changed_by: Number(req.session.userId), fields: changedFields });
            const result = await collections.committeeWorkItems.updateOne({ id }, {
                $set: { ...values, revision: Number(existing.revision || 0) + 1, deadline_history: deadlineHistory, assignee_history: assigneeHistory, change_history: changeHistory, ...(assignmentChanged && assigneeId ? { assigned_at: now } : {}) },
                $push: { activity: { at: now, actor_id: Number(req.session.userId), status } }
            });
            if (!result.matchedCount) return fail(res, 404, "Work item not found.");
            if (committee === "publication" && kind === "pubmat") {
                if (assignmentChanged && assigneeId) await createNotification(assigneeId, { kind: existing.assignee_user_id ? "task_reassigned" : "task_assigned", title: existing.assignee_user_id ? "Publication task reassigned" : "New publication task", message: `${title} is assigned to you.`, taskId: id, dedupeKey: `publication:${id}:assigned:${now.getTime()}:${assigneeId}` });
                if (assignmentChanged && existing.assignee_user_id && existing.assignee_user_id !== assigneeId) await createNotification(existing.assignee_user_id, { kind: "task_unassigned", title: "Publication assignment updated", message: `${title} is no longer assigned to you.`, taskId: id, dedupeKey: `publication:${id}:unassigned:${now.getTime()}:${existing.assignee_user_id}` });
                if (deadlineChanged && assigneeId) await createNotification(assigneeId, { kind: "deadline_changed", title: "Publication deadline changed", message: `The deadline for ${title} was updated.`, taskId: id, dedupeKey: `publication:${id}:deadline:${now.getTime()}` });
                if (status === "Cancelled" && existing.status !== "Cancelled" && assigneeId) await createNotification(assigneeId, { kind: "task_cancelled", title: "Publication task cancelled", message: `${title} was cancelled.`, taskId: id, dedupeKey: `publication:${id}:cancelled:${now.getTime()}` });
            }
            return ok(res, "Work item updated.", { id });
        }
        const newId = await nextId("committee_work_items");
        const item = {
            id: newId, ...values, created_at: now, created_by: Number(req.session.userId), revision: 0,
            ...(committee === "publication" && kind === "pubmat" ? { submissions: [], deadline_history: [], change_history: [], assignee_history: assigneeId ? [{ from_user_id: null, to_user_id: assigneeId, changed_at: now, changed_by: Number(req.session.userId) }] : [], ...(assigneeId ? { assigned_at: now } : {}) } : {})
        };
        await collections.committeeWorkItems.insertOne(item);
        if (committee === "publication" && kind === "pubmat" && assigneeId) await createNotification(assigneeId, { kind: "task_assigned", title: "New publication task", message: `${title} is assigned to you.`, taskId: newId, dedupeKey: `publication:${newId}:assigned:${now.getTime()}:${assigneeId}` });
        return ok(res, "Work item created.", { id: newId });
    } catch (error) { return next(error); }
});

app.post("/api/admin/committee-work/delete", committeeWorkspaceAccess, async (req, res, next) => {
    if (req.workspaceCommittee === "publication") return fail(res, 403, "Only Executive Committee members can remove publication tasks.");
    const id = Number(req.body.id);
    if (!Number.isInteger(id) || id < 1) return fail(res, 422, "Choose a valid work item.");
    try {
        const result = await collections.committeeWorkItems.deleteOne({ id });
        if (!result.deletedCount) return fail(res, 404, "Work item not found.");
        return ok(res, "Work item deleted.");
    } catch (error) { return next(error); }
});

app.post("/api/admin/committee-work/checklist", committeeWorkspaceAccess, async (req, res, next) => {
    if (req.workspaceCommittee === "publication") return fail(res, 403, "Publication checklist changes must be submitted with the assigned work.");
    const id = Number(req.body.id);
    const label = text(req.body.label).trim();
    if (!Number.isInteger(id) || id < 1 || !label || label.length > 180 || typeof req.body.done !== "boolean") return fail(res, 422, "Choose a checklist item and completion status.");
    try {
        const result = await collections.committeeWorkItems.updateOne({ id, checklist: { $elemMatch: { label } } }, { $set: { "checklist.$.done": req.body.done, updated_at: new Date() } });
        if (!result.matchedCount) return fail(res, 404, "Checklist item not found.");
        return ok(res, "Checklist updated.");
    } catch (error) { return next(error); }
});

app.post("/api/admin/participation/review", adminOnly, (_req, res) => fail(res, 410, "Legacy event assignment requests are read-only. Manage council participation from the Participation page."));

// Finance records remain private until an authorized administrator approves publication.
app.get("/api/transparency/reports", async (_req, res, next) => {
    try {
        const records = await collections.financialRecords.find({ public_status: "published", $or: [{ type: "allocation", status: "approved" }, { type: "expense", status: "recorded" }] }, { projection: { created_by: 0, reviewed_by: 0, internal_notes: 0 } }).sort({ period: -1, created_at: -1 }).toArray();
        const eventIds = [...new Set(records.map((record) => record.event_id).filter(Boolean))];
        const events = await collections.events.find({ id: { $in: eventIds } }, { projection: { id: 1, title: 1 } }).toArray();
        const eventMap = new Map(events.map((item) => [item.id, item.title]));
        return ok(res, null, { records: records.map((record) => ({ ...record, event_title: eventMap.get(record.event_id) || "Council-wide" })) });
    } catch (error) { return next(error); }
});

app.get("/api/admin/finance", adminOnly, async (_req, res, next) => {
    try {
        return ok(res, null, { records: await collections.financialRecords.find({}).sort({ period: -1, created_at: -1 }).toArray() });
    } catch (error) { return next(error); }
});

app.post("/api/admin/finance/save", adminOnly, async (req, res, next) => {
    const id = Number(req.body.id || 0);
    const type = text(req.body.type).trim();
    const title = text(req.body.title).trim();
    const period = text(req.body.period).trim();
    const category = text(req.body.category).trim();
    const amount = Number(req.body.amount);
    const status = text(req.body.status).trim();
    const publicStatus = text(req.body.public_status || "private").trim();
    const eventId = req.body.event_id ? Number(req.body.event_id) : null;
    const committee = text(req.body.committee || "").trim().toLowerCase();
    if (!["allocation", "expense"].includes(type) || !title || title.length > 180 || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period) || !category || category.length > 100 || !Number.isFinite(amount) || amount <= 0 || amount > 1000000000 || !["proposed", "approved", "pending", "recorded"].includes(status) || !["private", "published"].includes(publicStatus)) return fail(res, 422, "Enter a valid period, category, amount, type and approval status.");
    if ((type === "allocation" && !["proposed", "approved"].includes(status)) || (type === "expense" && !["pending", "recorded"].includes(status))) return fail(res, 422, "Allocations must be proposed or approved; expenses must be pending or recorded.");
    if (publicStatus === "published" && !((type === "allocation" && status === "approved") || (type === "expense" && status === "recorded"))) return fail(res, 422, "Only approved allocations or recorded expenses can be published.");
    if (eventId !== null && (!Number.isInteger(eventId) || eventId < 1)) return fail(res, 422, "Choose a valid event.");
    if (committee && !workCommittees.has(committee)) return fail(res, 422, "Choose a valid committee.");
    try {
        if (eventId && !await collections.events.findOne({ id: eventId }, { projection: { id: 1 } })) return fail(res, 404, "Event not found.");
        const now = new Date();
        const record = { type, title, period, category, amount, status, public_status: publicStatus, committee: committee || null, event_id: eventId, document_url: text(req.body.document_url).trim(), updated_at: now };
        if (record.document_url && (!/^https?:\/\//i.test(record.document_url) || record.document_url.length > 1000)) return fail(res, 422, "Supporting documents must use a valid URL.");
        if (id) {
            const result = await collections.financialRecords.updateOne({ id }, { $set: record });
            if (!result.matchedCount) return fail(res, 404, "Financial record not found.");
            return ok(res, "Financial record updated.", { id });
        }
        const newId = await nextId("financial_records");
        await collections.financialRecords.insertOne({ id: newId, ...record, created_at: now, created_by: Number(req.session.userId) });
        return ok(res, "Financial record created.", { id: newId });
    } catch (error) { return next(error); }
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 1, fields: 30, parts: 31, fieldSize: 32 * 1024 } });
const imageMiddleware = (req, res, next) => upload.single("cover_image")(req, res, (error) => {
    if (error) return fail(res, 422, "Choose an image smaller than 4 MB.");
    next();
});

const profileUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 2, fields: 12, parts: 14, fieldSize: 8 * 1024 } });
const profileImageMiddleware = (req, res, next) => profileUpload.fields([
    { name: "profile_picture", maxCount: 1 },
    { name: "cover_photo", maxCount: 1 }
])(req, res, (error) => {
    if (error) return fail(res, 422, "Choose JPG, PNG, or WebP photos under 5 MB each.");
    next();
});

async function storeProfileMedia(file, ownerUserId, kind) {
    const type = await fileTypeFromBuffer(file.buffer);
    if (!type || !["image/jpeg", "image/png", "image/webp"].includes(type.mime)) {
        throw new Error("Profile and cover photos must be JPG, PNG, or WebP images.");
    }
    const id = new ObjectId();
    await new Promise((resolve, reject) => {
        const stream = profileMedia.openUploadStreamWithId(id, `${kind}-${id.toHexString()}`, {
            contentType: type.mime,
            metadata: { owner_user_id: ownerUserId, kind }
        });
        stream.once("error", reject);
        stream.once("finish", resolve);
        stream.end(file.buffer);
    });
    return `/api/profile/media/${id.toHexString()}`;
}

async function removeProfileMedia(mediaUrl, ownerUserId) {
    const match = /^\/api\/profile\/media\/([a-f0-9]{24})$/i.exec(mediaUrl || "");
    if (!match) return;
    const id = new ObjectId(match[1]);
    const file = await db.collection("profile_media.files").findOne({ _id: id, "metadata.owner_user_id": ownerUserId }, { projection: { _id: 1 } });
    if (file) await profileMedia.delete(id).catch(() => {});
}

app.post("/api/profile/update", signedIn, profileImageMiddleware, async (req, res, next) => {
    const userId = Number(req.session.userId);
    const firstName = text(req.body.first_name).trim();
    const lastName = text(req.body.last_name).trim();
    const studentId = text(req.body.student_id).trim();
    const email = text(req.body.email).trim().toLowerCase();
    const course = text(req.body.course).trim();
    const yearLevel = text(req.body.year_level).trim();

    if (!firstName || firstName.length > 80 || !lastName || lastName.length > 80) return fail(res, 422, "Enter a first and last name under 80 characters each.");
    if (!/^[^\s@]+@phinmaed\.com$/i.test(email) || email.length > 254) return fail(res, 422, "Use a valid @phinmaed.com email address.");
    if (course.length > 100 || yearLevel.length > 40) return fail(res, 422, "Course and year level must be under 100 and 40 characters.");

    let currentUser;
    try {
        currentUser = await collections.users.findOne({ id: userId });
        if (!currentUser) return fail(res, 401, "Your account could not be found. Sign in again.");
    } catch (error) { return next(error); }

    if (currentUser.role === "student" && !studentIdPattern.test(studentId)) return fail(res, 422, "Student ID must use the format 01-1234-123456.");
    if (currentUser.role === "student" && (!course || !["1st Year", "2nd Year", "3rd Year", "4th Year"].includes(yearLevel))) return fail(res, 422, "Choose a course and valid year level.");
    if (currentUser.role !== "student" && !/^[A-Za-z0-9-]{3,24}$/.test(studentId)) return fail(res, 422, "Enter a valid ID using 3–24 letters, numbers, or hyphens.");

    const files = req.files || {};
    const nextImages = {};
    const storedImages = [];
    try {
        if (files.profile_picture?.[0]) {
            nextImages.profile_picture = await storeProfileMedia(files.profile_picture[0], userId, "profile");
            storedImages.push(nextImages.profile_picture);
        }
        if (files.cover_photo?.[0]) {
            nextImages.cover_photo = await storeProfileMedia(files.cover_photo[0], userId, "cover");
            storedImages.push(nextImages.cover_photo);
        }
    } catch (error) {
        await Promise.all(storedImages.map((url) => removeProfileMedia(url, userId)));
        if (error.message?.includes("must be JPG")) return fail(res, 422, error.message);
        return next(error);
    }

    const set = { first_name: firstName, last_name: lastName, student_id: studentId, email, course, year_level: yearLevel, updated_at: new Date() };
    if (nextImages.profile_picture) set.profile_picture = nextImages.profile_picture;
    else if (req.body.remove_profile_picture === "true") set.profile_picture = "";
    if (nextImages.cover_photo) set.cover_photo = nextImages.cover_photo;
    else if (req.body.remove_cover_photo === "true") set.cover_photo = "";

    try {
        const duplicate = await collections.users.findOne({ id: { $ne: userId }, $or: [{ email }, { student_id: studentId }] }, { projection: { id: 1 } });
        if (duplicate) {
            await Promise.all(storedImages.map((url) => removeProfileMedia(url, userId)));
            return fail(res, 409, "That email address or ID is already linked to another account.");
        }
        const result = await collections.users.updateOne({ id: userId }, { $set: set });
        if (!result.matchedCount) {
            await Promise.all(storedImages.map((url) => removeProfileMedia(url, userId)));
            return fail(res, 401, "Your account could not be found. Sign in again.");
        }
        if (set.profile_picture !== undefined && set.profile_picture !== currentUser.profile_picture) await removeProfileMedia(currentUser.profile_picture, userId);
        if (set.cover_photo !== undefined && set.cover_photo !== currentUser.cover_photo) await removeProfileMedia(currentUser.cover_photo, userId);
        const updatedUser = await collections.users.findOne({ id: userId });
        return ok(res, "Profile updated successfully.", { user: publicUser(updatedUser) });
    } catch (error) {
        await Promise.all(storedImages.map((url) => removeProfileMedia(url, userId)));
        if (duplicateKey(error)) return fail(res, 409, "That email address or ID is already linked to another account.");
        return next(error);
    }
});

async function storeCover(file) {
    if (!file) throw new Error("An event cover image is required.");
    const type = await fileTypeFromBuffer(file.buffer);
    const extensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
    const ext = type && extensions[type.mime];
    if (!ext) throw new Error("Use a JPG, PNG, or WebP cover image.");
    if (process.env.VERCEL === "1") {
        const id = new ObjectId();
        await new Promise((resolve, reject) => {
            const stream = eventCovers.openUploadStreamWithId(id, `event-${id.toHexString()}.${ext}`, {
                contentType: type.mime,
                metadata: { contentType: type.mime }
            });
            stream.once("error", reject);
            stream.once("finish", resolve);
            stream.end(file.buffer);
        });
        return `/api/uploads/events/event-${id.toHexString()}.${ext}`;
    }
    const directory = path.join(uploadRoot, "events");
    await fs.mkdir(directory, { recursive: true });
    const filename = `event-${crypto.randomBytes(12).toString("hex")}.${ext}`;
    await fs.writeFile(path.join(directory, filename), file.buffer, { flag: "wx" });
    return `/uploads/events/${filename}`;
}

function validateEventFields(body, creating) {
    const title = text(body.title).trim(), description = text(body.description).trim(), location = text(body.location).trim();
    const start = parseDate(body.start_date), end = parseDate(body.end_date);
    const deadline = text(body.registration_deadline).trim() ? parseDate(body.registration_deadline) : null;
    const capacity = Number(body.capacity), status = text(body.status || "upcoming");
    const assignmentCapacity = text(body.assignment_capacity).trim() ? Number(body.assignment_capacity) : 0;
    // Posting a new event publishes it immediately. Existing drafts and pending
    // events can still be managed through the edit/review workflows.
    const publicationStatus = creating ? "published" : text(body.publication_status || "published").trim();
    const participationRequirements = text(body.participation_requirements).trim();
    const invitedCommittees = eventInviteCommittees({ invited_committees: body.invited_committees });
    const eligibleCourses = text(body.eligible_courses).split(",").map((item) => item.trim()).filter(Boolean).slice(0, 30);
    const eligibleYearLevels = text(body.eligible_year_levels).split(",").map((item) => item.trim()).filter(Boolean).slice(0, 10);
    const registrationEligibleCourses = text(body.registration_eligible_courses).split(",").map((item) => item.trim()).filter(Boolean).slice(0, 30);
    const registrationEligibleYearLevels = text(body.registration_eligible_year_levels).split(",").map((item) => item.trim()).filter(Boolean).slice(0, 10);
    if ([...registrationEligibleCourses, ...registrationEligibleYearLevels].some((item) => item.length > 100)) return { error: "Each eligible course or year level must be under 100 characters." };
    if (!title || title.length > 255 || !description || !location || location.length > 255) return { error: "Enter a title, event description, and location." };
    if (!start || !end || end <= start) return { error: "Enter valid start and end times; the end must be after the start." };
    if (body.registration_deadline && (!deadline || deadline > start)) return { error: "The registration deadline must be valid and no later than the event start." };
    if (!Number.isInteger(capacity) || capacity < 1) return { error: "Capacity must be at least one attendee." };
    if (!Number.isInteger(assignmentCapacity) || assignmentCapacity < 0 || assignmentCapacity > 10000) return { error: "Assignment capacity must be zero (unlimited) or between 1 and 10,000." };
    if (participationRequirements.length > 1000) return { error: "Participation requirements must be under 1,000 characters." };
    if (!invitedCommittees.length) return { error: "Choose at least one council audience for event invitations." };
    if (!(creating ? ["upcoming", "ongoing"] : ["upcoming", "ongoing", "completed", "cancelled"]).includes(status)) return { error: "Choose a valid event status." };
    if (!(["draft", "pending_approval", "published", "cancelled", "archived"].includes(publicationStatus))) return { error: "Choose a valid publication status." };
    return { title, description, location, start_date: start, end_date: end, registration_deadline: deadline, capacity, status, publication_status: publicationStatus, invited_committees: invitedCommittees, assignment_capacity: assignmentCapacity, participation_open: body.participation_open !== "false", participation_requirements: participationRequirements, eligible_courses: eligibleCourses, eligible_year_levels: eligibleYearLevels, require_event_registration: body.require_event_registration === "true", registration_open: body.registration_open !== "false", registration_eligible_courses: registrationEligibleCourses, registration_eligible_year_levels: registrationEligibleYearLevels, self_service_checkin: body.self_service_checkin === "true", self_service_checkout: body.self_service_checkout === "true" };
}

app.post("/api/admin/events/create", adminOnly, imageMiddleware, async (req, res, next) => {
    const event = validateEventFields(req.body, true);
    if (event.error) return fail(res, 422, event.error);
    let cover;
    try { cover = await storeCover(req.file); }
    catch (error) { return fail(res, 422, error.message); }
    let eventInserted = false;
    try {
        const id = await nextId("events");
        const now = new Date();
        const createdEvent = {
            id,
            ...event,
            cover_image: cover,
            registration_count: 0,
            assignment_count: 0,
            created_at: now,
            published_at: now,
            public_updated_at: now,
            public_update_type: "newly_published",
            notification_reason: "New council event",
            notification_dedupe_key: `event:${id}:created`,
            notification_delivery_status: "pending"
        };
        await collections.events.insertOne(createdEvent);
        eventInserted = true;
        let notificationResult;
        try {
            notificationResult = await notifyEventResponseMembers(createdEvent, createdEvent.notification_reason, createdEvent.notification_dedupe_key);
            await collections.events.updateOne({ id }, { $set: { notification_delivery_status: eventNoticeStatus(notificationResult), notification_recipient_count: notificationResult.recipient_count, notification_delivered_count: notificationResult.delivered_count, notification_last_attempt_at: new Date() } });
        }
        catch (notificationError) {
            console.error("Event was published, but invitation setup failed:", notificationError?.message || "unknown error");
            notificationResult = { recipient_count: 0, delivered_count: 0, failed_count: -1 };
            await collections.events.updateOne({ id }, { $set: { notification_delivery_status: "failed", notification_last_attempt_at: new Date() } }).catch(() => {});
        }
        const hasNotificationFailure = notificationResult.failed_count !== 0;
        const message = hasNotificationFailure
            ? "Event published, but some council invitations could not be delivered. Use Retry notifications on the event list; do not repost the event."
            : notificationResult.recipient_count
                ? "Event published and council members notified."
                : "Event published. No current council members match the selected invitation audience.";
        return ok(res, message, { event_id: id, publication_status: "published", notifications: notificationResult });
    } catch (error) {
        if (!eventInserted) await removeLocalCover(cover);
        return next(error);
    }
});

app.post("/api/admin/events/update", adminOnly, imageMiddleware, async (req, res, next) => {
    const id = Number(req.query.id);
    if (!Number.isInteger(id) || id < 1) return fail(res, 422, "A valid event ID is required.");
    const event = validateEventFields(req.body, false);
    if (event.error) return fail(res, 422, event.error);
    try {
        const existing = await collections.events.findOne({ id });
        if (!existing) return fail(res, 404, "Event not found.");
        const priorPublicationStatus = existing.publication_status || "published";
        const publicationTransitions = { draft: ["draft", "pending_approval"], pending_approval: ["draft", "pending_approval"], published: ["published", "cancelled", "archived"], cancelled: ["cancelled", "archived"], archived: ["archived"] };
        if (!(publicationTransitions[priorPublicationStatus] || []).includes(event.publication_status)) return fail(res, 422, "Submit drafts for approval, and use the approval queue to publish pending events.");
        const registrationCount = await collections.registrations.countDocuments({ event_id: id, status: { $ne: "cancelled" } });
        if (event.capacity < registrationCount) return fail(res, 422, "Capacity cannot be lower than the existing attendee count.");
        if (event.assignment_capacity > 0 && event.assignment_capacity < Number(existing.assignment_count || 0)) return fail(res, 422, "Assignment positions cannot be lower than the current number of sign-ups.");
        const cover = req.file ? await storeCover(req.file) : existing.cover_image;
        const now = new Date();
        const isPublicUpdate = priorPublicationStatus === "published" && ["published", "cancelled"].includes(event.publication_status);
        const publicUpdate = isPublicUpdate
            ? { public_updated_at: now, public_update_type: event.publication_status === "cancelled" || event.status === "cancelled" ? "event_cancelled" : "details_updated" }
            : {};
        const participationFields = ["title", "description", "location", "start_date", "end_date", "status", "publication_status", "participation_open", "participation_requirements", "eligible_courses", "eligible_year_levels", "invited_committees"];
        const participationChanged = participationFields.some((field) => {
            const before = existing[field] instanceof Date ? existing[field].getTime() : JSON.stringify(existing[field] ?? null);
            const after = event[field] instanceof Date ? event[field].getTime() : JSON.stringify(event[field] ?? null);
            return before !== after;
        });
        const notificationReason = event.status === "cancelled" || event.publication_status === "cancelled" ? "Event cancelled" : "Event details changed";
        const notificationKey = `event:${id}:updated:${now.getTime()}`;
        await collections.events.updateOne({ id }, { $set: {
            ...event, cover_image: cover, registration_count: registrationCount, updated_at: now, ...publicUpdate,
            ...(participationChanged ? { notification_reason: notificationReason, notification_dedupe_key: notificationKey, notification_delivery_status: "pending" } : {})
        } });
        let notificationResult = null;
        if (participationChanged) {
            try {
                notificationResult = await notifyEventResponseMembers({ id, ...event }, notificationReason, notificationKey);
                await collections.events.updateOne({ id }, { $set: { notification_delivery_status: eventNoticeStatus(notificationResult), notification_recipient_count: notificationResult.recipient_count, notification_delivered_count: notificationResult.delivered_count, notification_last_attempt_at: new Date() } });
            }
            catch (notificationError) {
                console.error("Event changes were saved, but council notifications failed:", notificationError?.message || "unknown error");
                notificationResult = { recipient_count: 0, delivered_count: 0, failed_count: -1 };
                await collections.events.updateOne({ id }, { $set: { notification_delivery_status: "failed", notification_last_attempt_at: new Date() } }).catch(() => {});
            }
        }
        if (req.file && existing.cover_image !== cover) await removeLocalCover(existing.cover_image);
        const notificationFailed = notificationResult && notificationResult.failed_count !== 0;
        const notificationEmpty = notificationResult && notificationResult.recipient_count === 0;
        const message = notificationFailed
            ? "Event changes were saved, but some council notifications could not be delivered. Use Retry notifications on the event list."
            : notificationEmpty
                ? "Event updated, but no current council members match the selected invitation audience."
                : "Event updated successfully.";
        return ok(res, message, { event_id: id, notifications: notificationResult });
    } catch (error) { return next(error); }
});

app.post("/api/admin/events/notifications/retry", adminOnly, async (req, res, next) => {
    const id = Number(req.body.event_id);
    if (!Number.isSafeInteger(id) || id < 1) return fail(res, 422, "Choose a valid event.");
    try {
        const event = await collections.events.findOne({ id });
        if (!event) return fail(res, 404, "Event not found.");
        if (event.notification_delivery_status !== "failed" || !event.notification_dedupe_key) return fail(res, 409, "This event has no failed notification batch to retry.");
        const reason = event.notification_reason || "Event details changed";
        const result = await notifyEventResponseMembers(event, reason, event.notification_dedupe_key);
        await collections.events.updateOne({ id }, { $set: { notification_delivery_status: eventNoticeStatus(result), notification_recipient_count: result.recipient_count, notification_delivered_count: result.delivered_count, notification_last_attempt_at: new Date() } });
        return ok(res, result.failed_count ? "Some council notifications are still failing. Retry again when the connection is stable." : result.recipient_count ? "Council notifications delivered." : "No current council members match this invitation audience.", { notifications: result });
    } catch (error) { return next(error); }
});

app.post("/api/admin/events/review", adminOnly, async (req, res, next) => {
    const id = Number(req.body.event_id);
    const decision = text(req.body.decision).trim();
    if (!Number.isInteger(id) || id < 1 || !["approve", "return"].includes(decision)) return fail(res, 422, "Choose a valid event approval decision.");
    try {
        const publicationStatus = decision === "approve" ? "published" : "draft";
        const reviewedAt = new Date();
        const publicUpdate = decision === "approve"
            ? { public_updated_at: reviewedAt, public_update_type: "newly_published" }
            : {};
        const result = await collections.events.updateOne({ id, publication_status: "pending_approval" }, { $set: { publication_status: publicationStatus, reviewed_by: Number(req.session.userId), reviewed_at: reviewedAt, updated_at: reviewedAt, ...publicUpdate }, $push: { publication_history: { status: publicationStatus, decision, reviewer_id: Number(req.session.userId), at: reviewedAt } } });
        if (!result.modifiedCount) return fail(res, 404, "This event is no longer awaiting approval.");
        return ok(res, decision === "approve" ? "Event published." : "Event returned to draft.");
    } catch (error) { return next(error); }
});

async function removeLocalCover(cover) {
    const match = /^\/(?:api\/)?uploads\/events\/event-([a-f0-9]{24})\.(jpg|png|webp)$/.exec(cover || "");
    if (!match) return;
    const stillReferenced = await collections.events.countDocuments({ cover_image: cover });
    if (stillReferenced) return;
    if (process.env.VERCEL === "1") {
        const id = new ObjectId(match[1]);
        await eventCovers.delete(id).catch(() => {});
        return;
    }
    await fs.unlink(path.join(uploadRoot, "events", path.basename(cover))).catch(() => {});
}

app.post("/api/admin/events/archive", adminOnly, async (req, res, next) => {
    const id = Number(req.body.id);
    if (!Number.isInteger(id) || id < 1) return fail(res, 422, "A valid event ID is required.");
    try {
        const event = await collections.events.findOne({ id });
        if (!event) return fail(res, 404, "Event not found.");
        if (event.publication_status === "archived") return fail(res, 409, "This event is already archived.");
        await collections.events.updateOne({ id }, { $set: { publication_status: "archived", archived_at: new Date(), updated_at: new Date() } });
        return ok(res, "Event archived. Its attendance and financial records remain available in the historical record.", { event_title: event.title });
    } catch (error) { return next(error); }
});

app.post("/api/admin/events/delete", adminOnly, async (req, res, next) => {
    const id = Number(req.body.id);
    if (!Number.isInteger(id) || id < 1) return fail(res, 422, "A valid event ID is required.");
    try {
        const event = await collections.events.findOne({ id });
        if (!event) return fail(res, 404, "Event not found.");

        const responses = await collections.eventResponses.find({ event_id: id }, { projection: { status: 1, responded_at: 1, history: 1 } }).toArray();
        const hasRecordedResponses = responses.some((response) => response.status !== "pending" || response.responded_at || response.history?.length);
        const [registrationCount, attendanceCount, studentParticipationCount, assignmentCount, workItemCount, financeCount, highlightCount, scheduleCount, attendanceAuditCount] = await Promise.all([
            collections.registrations.countDocuments({ event_id: id }),
            collections.attendance.countDocuments({ event_id: id }),
            collections.studentEventParticipations.countDocuments({ event_id: id }),
            collections.eventAssignments.countDocuments({ event_id: id }),
            collections.committeeWorkItems.countDocuments({ event_id: id }),
            collections.financialRecords.countDocuments({ event_id: id }),
            collections.event_highlights.countDocuments({ event_id: id }),
            collections.event_schedules.countDocuments({ event_id: id }),
            collections.attendanceAudit.countDocuments({ event_id: id })
        ]);
        if (hasRecordedResponses || registrationCount || attendanceCount || studentParticipationCount || assignmentCount || workItemCount || financeCount || highlightCount || scheduleCount || attendanceAuditCount) {
            return fail(res, 409, "This event has participation, registration, attendance, assignment, or other history and cannot be permanently deleted. Archive it to preserve those records.");
        }

        const result = await collections.events.deleteOne({ id });
        if (!result.deletedCount) return fail(res, 404, "Event not found.");
        await Promise.all([
            collections.eventResponses.deleteMany({ event_id: id }),
            collections.notifications.deleteMany({ event_id: id })
        ]);
        await removeLocalCover(event.cover_image);
        return ok(res, "Event permanently deleted.", { event_id: id, event_title: event.title });
    } catch (error) { return next(error); }
});

// Standalone council announcements are managed separately from event notices.
app.get("/api/admin/announcements", adminOnly, async (_req, res, next) => {
    try {
        const announcements = await collections.publicAnnouncements.find({}).sort({ updated_at: -1 }).limit(200).toArray();
        return ok(res, null, { announcements });
    } catch (error) { return next(error); }
});

app.post("/api/admin/announcements/save", adminOnly, async (req, res, next) => {
    const id = Number(req.body.id || 0);
    const title = text(req.body.title).trim();
    const category = text(req.body.category || "General").trim();
    const content = text(req.body.content).trim();
    const status = text(req.body.status || "published").trim();
    if (id && (!Number.isSafeInteger(id) || id < 1)) return fail(res, 422, "A valid announcement ID is required.");
    if (!title || title.length > 180) return fail(res, 422, "Enter an announcement title under 180 characters.");
    if (!category || category.length > 60) return fail(res, 422, "Enter a category under 60 characters.");
    if (!content || content.length > 5000) return fail(res, 422, "Enter announcement details under 5,000 characters.");
    if (!["draft", "published"].includes(status)) return fail(res, 422, "Choose draft or published status.");
    try {
        const now = new Date();
        const fields = { title, category, content, status, updated_at: now };
        if (!id) {
            const newId = await nextId("public_announcements");
            const announcement = {
                id: newId,
                ...fields,
                created_by: Number(req.session.userId),
                created_at: now,
                published_at: status === "published" ? now : null,
                public_updated_at: status === "published" ? now : null
            };
            await collections.publicAnnouncements.insertOne(announcement);
            return ok(res, status === "published" ? "Announcement published." : "Announcement saved as a draft.", { announcement_id: newId });
        }

        const existing = await collections.publicAnnouncements.findOne({ id });
        if (!existing) return fail(res, 404, "Announcement not found.");
        if (existing.status === "archived") return fail(res, 409, "Archived announcements cannot be edited.");
        const changed = ["title", "category", "content"].some((field) => existing[field] !== fields[field]);
        const becamePublic = existing.status !== "published" && status === "published";
        if (status === "published" && (changed || becamePublic)) fields.public_updated_at = now;
        if (status === "published" && !existing.published_at) fields.published_at = now;
        const result = await collections.publicAnnouncements.updateOne({ id, status: { $ne: "archived" } }, { $set: fields });
        if (!result.matchedCount) return fail(res, 409, "Archived announcements cannot be edited.");
        return ok(res, status === "published" ? "Announcement saved and published." : "Announcement saved as a draft.", { announcement_id: id });
    } catch (error) { return next(error); }
});

app.post("/api/admin/announcements/archive", adminOnly, async (req, res, next) => {
    const id = Number(req.body.id);
    if (!Number.isSafeInteger(id) || id < 1) return fail(res, 422, "A valid announcement ID is required.");
    try {
        const now = new Date();
        const result = await collections.publicAnnouncements.updateOne({ id, status: { $ne: "archived" } }, { $set: { status: "archived", archived_at: now, updated_at: now } });
        if (!result.matchedCount) return fail(res, 404, "Announcement not found or already archived.");
        return ok(res, "Announcement archived. Its record remains available in the admin list.");
    } catch (error) { return next(error); }
});

// Highlights
app.get("/api/admin/highlights", adminOnly, async (_req, res, next) => {
    try {
        const highlights = await collections.event_highlights.find({}).sort({ created_at: -1 }).toArray();
        const eventIds = [...new Set(highlights.map((highlight) => highlight.event_id))];
        const events = await collections.events.find({ id: { $in: eventIds } }, { projection: { id: 1, title: 1 } }).toArray();
        const eventMap = new Map(events.map((event) => [event.id, event.title]));
        return ok(res, null, { highlights: highlights.map((highlight) => ({ ...highlight, event_title: eventMap.get(highlight.event_id) || "Deleted event" })) });
    } catch (error) { return next(error); }
});

app.post("/api/admin/highlights/create", adminOnly, async (req, res, next) => {
    const eventId = Number(req.body.event_id), title = text(req.body.title).trim(), description = text(req.body.description).trim();
    const mediaUrl = text(req.body.media_url).trim(), type = text(req.body.media_type || "image");
    if (!Number.isInteger(eventId) || eventId < 1 || !title || title.length > 255 || !description || !mediaUrl || mediaUrl.length > 255) return fail(res, 422, "Complete the event, title, description, and media URL fields.");
    if (!["image", "video"].includes(type)) return fail(res, 422, "Media type must be image or video.");
    const isLocal = mediaUrl.startsWith("/uploads/highlights/") && !mediaUrl.includes("..");
    let isWeb = false;
    try { isWeb = ["http:", "https:"].includes(new URL(mediaUrl).protocol); } catch {}
    if (!isLocal && !isWeb) return fail(res, 422, "Use an HTTP(S) URL or a path under /uploads/highlights/.");
    try {
        if (!await collections.events.findOne({ id: eventId }, { projection: { id: 1 } })) return fail(res, 404, "Event not found.");
        const id = await nextId("event_highlights");
        await collections.event_highlights.insertOne({ id, event_id: eventId, title, description, media_url: mediaUrl, media_type: type, created_at: new Date() });
        return ok(res, "Highlight added.", { highlight_id: id });
    } catch (error) { return next(error); }
});

app.post("/api/admin/highlights/delete", adminOnly, async (req, res, next) => {
    const id = Number(req.body.id);
    if (!Number.isInteger(id) || id < 1) return fail(res, 422, "A valid highlight ID is required.");
    try {
        const result = await collections.event_highlights.deleteOne({ id });
        if (!result.deletedCount) return fail(res, 404, "Highlight not found.");
        return ok(res, "Highlight deleted.");
    } catch (error) { return next(error); }
});

// New event attendance is keyed by event and account. Legacy registration IDs
// are only consulted to find older attendance rows during transition.
async function transitionEventAttendance({ event, participantType, user, method = "qr", operatorUserId = null }) {
    const participantKey = `event:${event.id}:user:${user.id}`;
    const identity = { user_id: user.id };
    async function findAttendanceRecord() {
        let record = await collections.attendance.findOne({ participant_key: participantKey });
        const legacyRegistration = await collections.registrations.findOne({ user_id: user.id, event_id: event.id });
        if (!record && legacyRegistration) {
            record = await collections.attendance.findOne({ registration_id: legacyRegistration.id, participant_key: { $exists: false } }, { sort: { time_in: -1 } });
            if (record) {
                const existingType = record.participant_type || "student";
                await collections.attendance.updateOne({ id: record.id }, { $set: { participant_key: participantKey, participant_type: existingType, event_id: event.id, user_id: user.id } });
                record = { ...record, participant_key: participantKey, participant_type: existingType, event_id: event.id, user_id: user.id };
            }
        }
        return record;
    }

    return transitionAttendanceRecord({
        findExisting: findAttendanceRecord,
        createRecord: async () => {
            const now = new Date();
            return { id: await nextId("attendance"), participant_key: participantKey, participant_type: participantType, event_id: event.id, ...identity, time_in: now, time_out: null, checkin_method: method, checkout_method: null, recorded_by: operatorUserId, created_at: now };
        },
        insertRecord: (record) => collections.attendance.insertOne(record),
        checkOutRecord: async (record) => {
            const timeOut = new Date();
            const update = await collections.attendance.updateOne({ id: record.id, time_out: null }, { $set: { time_out: timeOut, checkout_method: method, checkout_recorded_by: operatorUserId } });
            const latest = update.modifiedCount ? { ...record, time_out: timeOut } : await collections.attendance.findOne({ participant_key: participantKey });
            return { modified: Boolean(update.modifiedCount), record: latest };
        }
    });
}

async function resolveAttendanceParticipant(qrValue, event) {
    const staticIdentity = /^AUSSC:IDENTITY:([A-Za-z0-9-]{3,24}):([A-Za-z0-9_-]{43})$/.exec(qrValue);
    if (staticIdentity) {
        const user = await collections.users.findOne({ student_id: staticIdentity[1] });
        const unsignedValue = `AUSSC:IDENTITY:${staticIdentity[1]}`;
        const expectedSignature = crypto.createHmac("sha256", qrSigningSecret).update(unsignedValue).digest("base64url");
        const supplied = Buffer.from(staticIdentity[2]);
        const expected = Buffer.from(expectedSignature);
        if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return { error: "This council identity QR is invalid or has been altered." };
        if (!user || !isAuthorizedCouncilMember(user, councilPositions, councilCommittees)) return { error: "This reusable identity QR is for council members. Students must use the QR generated for this event." };
        return { type: "council", user };
    }
    const studentEventQr = readStudentEventQr(qrValue);
    if (!studentEventQr) return { error: "This is not a valid council identity QR or student event QR." };
    if (studentEventQr.event_id !== event.id) return { error: "This student QR belongs to a different event. Generate a QR from the selected event page.", wrongEvent: true };
    if (studentEventQr.title !== event.title || studentEventQr.description !== event.description) return { error: "The event details changed after this QR was generated. Ask the student to generate a fresh QR.", staleEventQr: true };
    const user = await collections.users.findOne({ student_id: studentEventQr.student_id });
    if (!user || user.role !== "student" || isAuthorizedCouncilMember(user, councilPositions, councilCommittees)) return { error: "No active student account matches this event QR." };
    const participation = await collections.studentEventParticipations.findOne({ event_id: event.id, user_id: user.id, status: "accepted" }, { projection: { id: 1 } });
    if (!participation) return { error: "The student must agree to participate before this event QR can be used." };
    return { type: "student", user };
}

async function handleAttendanceScan({ eventId, qrValue, operatorUserId, method = "qr", selfUserId = null, selfParticipantType = "" }) {
    const event = await collections.events.findOne({ id: eventId });
    if (!event || event.status === "cancelled" || event.publication_status === "cancelled") return { error: "This event is cancelled or unavailable." };
    let participant;
    if (selfUserId) {
        const user = await collections.users.findOne({ id: Number(selfUserId) });
        if (!user) return { error: "Your account could not be found." };
        const useCouncilIdentity = selfParticipantType === "council" || (!selfParticipantType && user.role !== "student");
        if (useCouncilIdentity) {
            if (!isAuthorizedCouncilMember(user, councilPositions, councilCommittees)) return { error: "A current council appointment or committee assignment is required." };
            participant = { type: "council", user };
        } else if (user.role === "student") {
            participant = { type: "student", user };
        } else {
            return { error: "Choose the account type for your self-service attendance." };
        }
    } else {
        participant = await resolveAttendanceParticipant(qrValue, event);
        if (participant.error) return participant;
    }
    const key = `event:${event.id}:user:${participant.user.id}`;
    let current = await collections.attendance.findOne({ participant_key: key });
    if (!current) {
        const registration = await collections.registrations.findOne({ user_id: participant.user.id, event_id: event.id });
        if (registration) current = await collections.attendance.findOne({ registration_id: registration.id }, { sort: { time_in: -1 } });
    }
    const expectedAction = attendanceScanAction(current);
    const now = new Date();
    if (selfUserId && ((expectedAction === "time_in" && now < new Date(event.start_date)) || now > new Date(event.end_date))) {
        return { error: "Self-service attendance is available only while this event is in progress." };
    }
    if (selfUserId && ((expectedAction === "time_in" && !event.self_service_checkin) || (expectedAction === "time_out" && !event.self_service_checkout))) {
        return { error: expectedAction === "time_in" ? "Self check-in is disabled for this event. Ask an attendance officer to scan your pass." : "Self check-out is disabled for this event. Ask an attendance officer to scan your pass." };
    }
    const transition = await transitionEventAttendance({ event, participantType: participant.type, user: participant.user, method, operatorUserId });
    return {
        ...transition,
        participant_type: transition.record?.participant_type || participant.type,
        participant_key: key,
        registration_code: null,
        attendee: {
            name: `${participant.user.first_name || ""} ${participant.user.last_name || ""}`.trim(),
            student_id: participant.user.student_id || "—", email: participant.user.email || "—",
            course: participant.user.course || null, year_level: participant.user.year_level || null,
            contact: participant.user.contact || null, council_position: participant.user.council_position || null,
            committee_assignment: participant.user.committee_assignment || null
        },
        event: { id: event.id, title: event.title, location: event.location, start_date: event.start_date, end_date: event.end_date },
        time_in: transition.record?.time_in || null, time_out: transition.record?.time_out || null
    };
}

app.get("/api/admin/attendance", adminOnly, async (req, res, next) => {
    const eventId = req.query.event_id ? Number(req.query.event_id) : null;
    if (eventId !== null && (!Number.isInteger(eventId) || eventId < 1)) return fail(res, 422, "Choose a valid event.");
    const from = text(req.query.from).trim(), to = text(req.query.to).trim();
    try {
        const query = {};
        if (eventId) query.event_id = eventId;
        if (from || to) {
            query.time_in = {};
            if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) query.time_in.$gte = new Date(`${from}T00:00:00+08:00`);
            if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) { const endOfDay = new Date(`${to}T00:00:00+08:00`); endOfDay.setTime(endOfDay.getTime() + 24 * 60 * 60 * 1000); query.time_in.$lt = endOfDay; }
        }
        const records = await collections.attendance.find(query).sort({ time_in: -1 }).limit(10000).toArray();
        const registrationIds = [...new Set(records.map((record) => record.registration_id).filter(Number.isInteger))];
        const directUserIds = records.map((record) => record.user_id).filter(Number.isInteger);
        const userIds = [...new Set([...directUserIds])];
        const eventIds = [...new Set(records.map((record) => record.event_id).filter(Number.isInteger))];
        const registrations = await collections.registrations.find({ id: { $in: registrationIds } }).toArray();
        const joinedUserIds = [...new Set([...userIds, ...registrations.map((registration) => registration.user_id)])];
        const joinedEventIds = [...new Set([...eventIds, ...registrations.map((registration) => registration.event_id)])];
        const [users, events] = await Promise.all([
            collections.users.find({ id: { $in: joinedUserIds } }, { projection: { id: 1, first_name: 1, last_name: 1, student_id: 1, email: 1, course: 1, year_level: 1, council_position: 1, council_department: 1, committee_assignment: 1 } }).toArray(),
            collections.events.find({ id: { $in: joinedEventIds } }, { projection: { id: 1, title: 1, start_date: 1 } }).toArray()
        ]);
        const registrationMap = new Map(registrations.map((item) => [item.id, item]));
        const userMap = new Map(users.map((item) => [item.id, item]));
        const eventMap = new Map(events.map((item) => [item.id, item]));
        const rows = records.map((record) => {
            const registration = registrationMap.get(record.registration_id);
            const user = userMap.get(record.user_id || registration?.user_id);
            const event = eventMap.get(record.event_id || registration?.event_id);
            if (!user || !event) return null;
            const snapshot = registration?.participant_snapshot || {};
            return {
                id: record.id, participant_type: record.participant_type || "student", time_in: record.time_in, time_out: record.time_out || null,
                currently_present: !record.time_out, registration_id: registration?.id || null, registration_code: registration?.registration_code || null,
                event_id: event.id, event_title: event.title, event_start: event.start_date,
                status: registration?.status || "recorded", first_name: snapshot.first_name || user.first_name, last_name: snapshot.last_name || user.last_name,
                student_id: snapshot.student_id || user.student_id, email: snapshot.email || user.email, course: snapshot.course || user.course,
                year_level: snapshot.year_level || user.year_level, contact: snapshot.contact || null, council_position: user.council_position || null,
                council_department: user.council_department || null, committee_assignment: user.committee_assignment || null
            };
        }).filter(Boolean);
        const studentRows = rows.filter((row) => row.participant_type === "student");
        const councilRows = rows.filter((row) => row.participant_type === "council");
        const groupCounts = (subset, field, fallback = "Not specified") => Object.entries(subset.reduce((counts, row) => {
            const key = row[field] || fallback; counts[key] = (counts[key] || 0) + 1; return counts;
        }, {})).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
        const byEvent = groupCounts(rows, "event_title");
        const byMonth = groupCounts(rows.map((row) => ({ month: row.time_in ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit" }).format(new Date(row.time_in)) : "Unknown" })), "month");
        const summary = {
            total_sessions: rows.length, students: studentRows.length, council_members: councilRows.length,
            currently_present: rows.filter((row) => row.currently_present).length,
            checked_out: rows.filter((row) => row.time_out).length
        };
        return ok(res, null, { rows, student_rows: studentRows, council_rows: councilRows, count: rows.length, event_id: eventId, from, to, summary, analytics: { by_event: byEvent, by_course: groupCounts(studentRows, "course"), by_year_level: groupCounts(studentRows, "year_level"), by_council_position: groupCounts(councilRows, "council_position"), by_committee: groupCounts(councilRows, "committee_assignment"), by_month: byMonth }, limit: 10000 });
    } catch (error) { return next(error); }
});

app.get("/api/admin/attendance/lookup", adminOnly, async (req, res, next) => {
    const eventId = Number(req.query.event_id);
    const query = text(req.query.q).trim().slice(0, 100);
    if (!Number.isInteger(eventId) || eventId < 1 || query.length < 2) return fail(res, 422, "Choose an event and enter at least two search characters.");
    try {
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const users = await collections.users.find({ $or: [
            { student_id: { $regex: `^${escaped}`, $options: "i" } }, { email: { $regex: `^${escaped}`, $options: "i" } },
            { first_name: { $regex: escaped, $options: "i" } }, { last_name: { $regex: escaped, $options: "i" } }
        ] }, { projection: { id: 1, role: 1, first_name: 1, last_name: 1, student_id: 1, email: 1, course: 1, year_level: 1, council_position: 1, council_department: 1, committee_assignment: 1 } }).limit(40).toArray();
        const ids = users.map((user) => user.id);
        const registrations = await collections.registrations.find({ user_id: { $in: ids }, event_id: eventId, status: { $in: ["registered", "attended"] } }).toArray();
        const registrationMap = new Map(registrations.map((registration) => [registration.user_id, registration]));
        const userMap = new Map(users.map((user) => [user.id, user]));
        const matches = users.filter((user) => user.role === "student" && !isAuthorizedCouncilMember(user, councilPositions, councilCommittees)).map((user) => {
            const registration = registrationMap.get(user.id); const snapshot = registration?.participant_snapshot || {};
            return { participant_type: "student", registration_id: registration?.id || null, user_id: user.id, status: registration?.status || "eligible", name: `${snapshot.first_name || user.first_name} ${snapshot.last_name || user.last_name}`, student_id: snapshot.student_id || user.student_id, email: snapshot.email || user.email, course: snapshot.course || user.course, year_level: snapshot.year_level || user.year_level, contact: snapshot.contact || null };
        });
        for (const user of users.filter((item) => isAuthorizedCouncilMember(item, councilPositions, councilCommittees))) {
            matches.push({ participant_type: "council", user_id: user.id, status: "eligible", name: `${user.first_name} ${user.last_name}`, student_id: user.student_id, email: user.email, council_position: user.council_position, committee_assignment: user.committee_assignment });
        }
        const annotatedMatches = await Promise.all(matches.slice(0, 30).map(async (match) => {
            const attendanceConditions = [{ participant_key: `event:${eventId}:user:${match.user_id}` }, { user_id: match.user_id, event_id: eventId }];
            if (match.registration_id) attendanceConditions.push({ participant_key: `student:${match.registration_id}` }, { registration_id: match.registration_id });
            const record = await collections.attendance.findOne({ $or: attendanceConditions }, { sort: { time_in: -1 } });
            return { ...match, attendance_state: !record ? "not_started" : record.time_out ? "completed" : "present" };
        }));
        return ok(res, null, { matches: annotatedMatches });
    } catch (error) { return next(error); }
});

app.post("/api/attendance/checkin", adminOnly, async (req, res, next) => {
    const qrValue = text(req.body.qr_value || req.body.registration_code).trim();
    const eventId = Number(req.body.event_id);
    if (!qrValue || qrValue.length > studentEventQrMaxLength) return fail(res, 422, "The QR code is empty or invalid.");
    if (!Number.isInteger(eventId) || eventId < 1) return fail(res, 422, "Choose the event the attendance team is serving.");
    try {
        const result = await handleAttendanceScan({ eventId, qrValue, operatorUserId: Number(req.session.userId) });
        if (result.error) return ok(res, result.error, { success: false, wrong_event: Boolean(result.wrongEvent), invalid: !result.wrongEvent });
        return ok(res, result.message, result);
    } catch (error) { return next(error); }
});

app.post("/api/attendance/self", signedIn, async (req, res, next) => {
    const eventId = Number(req.body.event_id);
    if (!Number.isInteger(eventId) || eventId < 1) return fail(res, 422, "Choose a valid event.");
    const participantType = text(req.body.participant_type).trim();
    if (participantType && !["student", "council"].includes(participantType)) return fail(res, 422, "Choose a valid participant type.");
    try {
        const result = await handleAttendanceScan({ eventId, operatorUserId: Number(req.session.userId), selfUserId: Number(req.session.userId), selfParticipantType: participantType, method: "self_service" });
        if (result.error) return fail(res, 403, result.error);
        return ok(res, result.message, result);
    } catch (error) { return next(error); }
});

app.get("/api/attendance/mine", signedIn, async (req, res, next) => {
    try {
        const userId = Number(req.session.userId);
        const registrations = await collections.registrations.find({ user_id: userId }, { projection: { id: 1 } }).toArray();
        const registrationIds = registrations.map((registration) => registration.id);
        const records = await collections.attendance.find({ $or: [
            { user_id: userId },
            ...(registrationIds.length ? [{ registration_id: { $in: registrationIds } }] : [])
        ] }).sort({ time_in: -1 }).limit(500).toArray();
        const eventIds = [...new Set(records.map((record) => record.event_id).filter(Number.isInteger))];
        const events = await collections.events.find({ id: { $in: eventIds } }, { projection: { id: 1, title: 1, location: 1, start_date: 1, end_date: 1 } }).toArray();
        const eventMap = new Map(events.map((event) => [event.id, event]));
        return ok(res, null, { attendance: records.map((record) => ({
            event: eventMap.get(record.event_id) || null, time_in: record.time_in, time_out: record.time_out || null,
            duration_ms: record.time_out ? Math.max(0, new Date(record.time_out).getTime() - new Date(record.time_in).getTime()) : null
        })).filter((record) => record.event) });
    } catch (error) { return next(error); }
});

app.post("/api/admin/attendance/manual", adminOnly, async (req, res, next) => {
    const eventId = Number(req.body.event_id), participantType = text(req.body.participant_type);
    const registrationId = Number(req.body.registration_id), userId = Number(req.body.user_id);
    if (!Number.isInteger(eventId) || eventId < 1 || !["student", "council"].includes(participantType)) return fail(res, 422, "Choose a valid event and attendee.");
    try {
        let participant;
        if (participantType === "student") {
            const user = Number.isSafeInteger(userId) && userId > 0 ? await collections.users.findOne({ id: userId, role: "student" }) : null;
            if (!user || isAuthorizedCouncilMember(user, councilPositions, councilCommittees)) return fail(res, 404, "No active student account matches this event.");
            const registration = await collections.registrations.findOne({ id: registrationId, user_id: user.id, event_id: eventId, status: { $in: ["registered", "attended"] } });
            participant = { type: "student", ...(registration ? { registration } : {}), user };
        } else {
            const user = await getAuthorizedCouncilCredentialUser(userId);
            if (!user) return fail(res, 404, "This account is no longer on the authorized council roster.");
            participant = { type: "council", user };
        }
        const event = await collections.events.findOne({ id: eventId });
        if (!event || event.status === "cancelled") return fail(res, 404, "Event not found or cancelled.");
        const transition = await transitionEventAttendance({ event, participantType: participant.type, registration: participant.registration, user: participant.user, method: "manual", operatorUserId: Number(req.session.userId) });
        await collections.attendanceAudit.insertOne({ id: await nextId("attendance_audit"), action: transition.action === "time_out" ? "manual_time_out" : transition.action === "time_in" ? "manual_time_in" : "manual_duplicate", participant_type: participant.type, event_id: eventId, registration_id: participant.registration?.id || null, user_id: participant.user.id, attendance_id: transition.record?.id || null, operator_user_id: Number(req.session.userId), created_at: new Date() });
        return ok(res, transition.message, { ...transition, participant_type: participant.type, event: { id: event.id, title: event.title, location: event.location, start_date: event.start_date }, time_in: transition.record?.time_in || null, time_out: transition.record?.time_out || null, attendee: { name: `${participant.user.first_name} ${participant.user.last_name}`, student_id: participant.user.student_id || "—", email: participant.user.email || "—" } });
    } catch (error) { return next(error); }
});

app.use("/api", (req, res) => fail(res, 404, "API route not found. Confirm the backend is running the current application version.", { code: "API_ROUTE_NOT_FOUND" }));

app.use((error, req, res, _next) => {
    if (res.headersSent) return;
    const requestId = req.requestId || crypto.randomUUID();
    console.error(`[${requestId}] ${req.method} ${req.path} failed (${error?.name || "Error"}, code ${error?.code ?? "n/a"}).`);
    if (error?.code === 13 || error?.codeName === "Unauthorized") {
        databaseReady = false;
        return fail(res, 503, "The database account lacks permission to access sign-in data. Grant it read/write access to the configured database.", {
            code: "DATABASE_PERMISSION_DENIED",
            database: "mongodb",
            request_id: requestId
        });
    }
    const mongoConnectionErrors = new Set([
        "MongoNetworkError",
        "MongoServerSelectionError",
        "MongoNotConnectedError",
        "MongoTopologyClosedError",
        "MongoPoolClearedError",
        "MongoWaitQueueTimeoutError"
    ]);
    if (mongoConnectionErrors.has(error?.name)) {
        databaseReady = false;
        return fail(res, 503, "The sign-in database is temporarily unavailable. Please try again shortly.", {
            code: "DATABASE_UNAVAILABLE",
            database: "mongodb",
            request_id: requestId
        });
    }
    return fail(res, 500, "The request could not be completed. Please try again.", {
        code: "INTERNAL_SERVER_ERROR",
        request_id: requestId
    });
});

async function connectDatabase() {
    await mongoClient.connect();
    db = mongoClient.db(databaseName);
    eventCovers = new GridFSBucket(db, { bucketName: "event_covers" });
    profileMedia = new GridFSBucket(db, { bucketName: "profile_media" });
    committeeSubmissionFiles = new GridFSBucket(db, { bucketName: "committee_submissions" });
    collections = {
        users: db.collection("users"), events: db.collection("events"),
        registrations: db.collection("registrations"), attendance: db.collection("attendance"),
        publicAnnouncements: db.collection("public_announcements"),
        councilMemberCredentials: db.collection("council_member_credentials"), attendanceAudit: db.collection("attendance_audit"),
        eventResponses: db.collection("event_responses"), studentEventParticipations: db.collection("student_event_participations"), councilClassSchedules: db.collection("council_class_schedules"),
        event_highlights: db.collection("event_highlights"), event_schedules: db.collection("event_schedules"),
        eventAssignments: db.collection("event_assignments"), committeeWorkItems: db.collection("committee_work_items"), notifications: db.collection("notifications"), financialRecords: db.collection("financial_records"),
        governanceMeetings: db.collection("governance_meetings"), councilAttendance: db.collection("council_attendance"),
        councilAttendancePasses: db.collection("council_attendance_passes"), councilExcuses: db.collection("council_excuses"),
        councilReports: db.collection("council_committee_reports"), councilInventory: db.collection("council_inventory"),
        passwordResetOtps: db.collection("password_reset_otps"),
        sessions: db.collection("sessions"), counters: db.collection("counters"), rateLimits: db.collection("auth_rate_limits")
    };
    await Promise.all([
        collections.users.createIndex({ id: 1 }, { unique: true }),
        collections.users.createIndex({ email: 1 }, { unique: true }),
        collections.users.createIndex({ student_id: 1 }, { unique: true }),
        collections.events.createIndex({ id: 1 }, { unique: true }),
        collections.events.createIndex({ status: 1, start_date: 1 }),
        collections.publicAnnouncements.createIndex({ id: 1 }, { unique: true }),
        collections.publicAnnouncements.createIndex({ status: 1, public_updated_at: -1 }),
        collections.registrations.createIndex({ id: 1 }, { unique: true }),
        collections.registrations.createIndex({ user_id: 1, event_id: 1 }, { unique: true }),
        collections.registrations.createIndex({ registration_code: 1 }, { unique: true }),
        collections.registrations.createIndex({ event_id: 1, status: 1 }),
        collections.attendance.createIndex({ id: 1 }, { unique: true }),
        collections.attendance.createIndex({ registration_id: 1, time_in: -1 }),
        collections.registrations.createIndex({ pass_id: 1 }, { unique: true, sparse: true }),
        collections.councilMemberCredentials.createIndex({ user_id: 1 }, { unique: true }),
        collections.councilMemberCredentials.createIndex({ pass_id: 1 }, { unique: true, sparse: true }),
        collections.attendance.createIndex({ participant_key: 1 }, { unique: true, sparse: true }),
        collections.attendance.createIndex({ event_id: 1, participant_type: 1, time_in: -1 }),
        collections.attendanceAudit.createIndex({ id: 1 }, { unique: true }),
        collections.attendanceAudit.createIndex({ event_id: 1, created_at: -1 }),
        collections.attendanceAudit.createIndex({ operator_user_id: 1, created_at: -1 }),
        collections.event_highlights.createIndex({ id: 1 }, { unique: true }),
        collections.event_highlights.createIndex({ event_id: 1, created_at: -1 }),
        collections.event_schedules.createIndex({ id: 1 }, { unique: true }),
        collections.event_schedules.createIndex({ event_id: 1 }),
        collections.eventAssignments.createIndex({ id: 1 }, { unique: true }),
        collections.eventAssignments.createIndex({ user_id: 1, event_id: 1 }, { unique: true }),
        collections.eventAssignments.createIndex({ event_id: 1, status: 1 }),
        collections.eventResponses.createIndex({ id: 1 }, { unique: true }),
        collections.eventResponses.createIndex({ event_id: 1, user_id: 1 }, { unique: true }),
        collections.eventResponses.createIndex({ user_id: 1, created_at: -1 }),
        collections.eventResponses.createIndex({ event_id: 1, status: 1 }),
        collections.studentEventParticipations.createIndex({ id: 1 }, { unique: true }),
        collections.studentEventParticipations.createIndex({ event_id: 1, user_id: 1 }, { unique: true }),
        collections.studentEventParticipations.createIndex({ user_id: 1, updated_at: -1 }),
        collections.councilClassSchedules.createIndex({ user_id: 1, academic_period: 1 }, { unique: true }),
        collections.committeeWorkItems.createIndex({ id: 1 }, { unique: true }),
        collections.committeeWorkItems.createIndex({ committee: 1, status: 1, due_at: 1 }),
        collections.committeeWorkItems.createIndex({ committee: 1, kind: 1, assignee_user_id: 1, due_at: 1 }),
        collections.notifications.createIndex({ user_id: 1, dedupe_key: 1 }, { unique: true }),
        collections.notifications.createIndex({ user_id: 1, read_at: 1, created_at: -1 }),
        collections.financialRecords.createIndex({ id: 1 }, { unique: true }),
        collections.financialRecords.createIndex({ public_status: 1, period: -1 }),
        collections.governanceMeetings.createIndex({ id: 1 }, { unique: true }),
        collections.governanceMeetings.createIndex({ academic_period: 1, start_at: -1 }),
        collections.councilAttendance.createIndex({ id: 1 }, { unique: true }),
        collections.councilAttendance.createIndex({ meeting_id: 1, user_id: 1 }, { unique: true }),
        collections.councilAttendancePasses.createIndex({ token_hash: 1 }, { unique: true }),
        collections.councilAttendancePasses.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        collections.councilAttendancePasses.createIndex({ meeting_id: 1, user_id: 1 }),
        collections.councilExcuses.createIndex({ id: 1 }, { unique: true }),
        collections.councilExcuses.createIndex({ meeting_id: 1, user_id: 1 }, { unique: true }),
        collections.councilReports.createIndex({ id: 1 }, { unique: true }),
        collections.councilReports.createIndex({ academic_period: 1, committee: 1, submitted_at: -1 }),
        collections.councilInventory.createIndex({ id: 1 }, { unique: true }),
        collections.councilInventory.createIndex({ condition: 1, item_name: 1 }),
        collections.passwordResetOtps.createIndex({ email: 1 }, { unique: true }),
        collections.passwordResetOtps.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        collections.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        collections.rateLimits.createIndex({ resetAt: 1 }, { expireAfterSeconds: 0 })
    ]);
    sessionStore.collection = collections.sessions;
    databaseReady = true;
}

async function start() {
    const server = app.listen(port, () => console.log(`University events API listening at http://localhost:${port}`));
    // Start listening immediately so health checks and login receive a useful
    // 503 during an Atlas outage instead of a refused connection. Retry with
    // bounded exponential backoff; once Atlas/network access is restored the
    // normal routes become available without a manual process restart.
    void connectWithRetry();
    const shutdown = async () => {
        server.close(async () => {
            databaseReady = false;
            await mongoClient.close();
            process.exit(0);
        });
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

async function ensureDatabaseConnection() {
    if (databaseReady && collections) return;
    if (!databaseConnectionPromise) {
        databaseConnectionPromise = connectDatabase().catch(async (error) => {
            databaseReady = false;
            await mongoClient.close().catch(() => {});
            mongoClient = new MongoClient(mongoUri, mongoOptions);
            throw error;
        }).finally(() => { databaseConnectionPromise = undefined; });
    }
    return databaseConnectionPromise;
}

async function connectWithRetry() {
    let attempt = 0;
    while (!databaseReady) {
        try {
            await ensureDatabaseConnection();
            console.log(`MongoDB connected (${databaseName}).`);
            return;
        } catch (error) {
            databaseReady = false;
            attempt += 1;
            const delayMs = Math.min(30_000, 1_000 * (2 ** Math.min(attempt - 1, 5)));
            console.error(`MongoDB connection attempt ${attempt} failed (${error.name || "Error"}, ${mongoFailureCode(error)}).`);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }
}

const isDirectExecution = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
    start().catch((error) => {
        console.error("The API could not start:", error.name || "Error", error.code || "");
        process.exitCode = 1;
    });
}

export default app;
