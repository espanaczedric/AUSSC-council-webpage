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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const uploadRoot = path.resolve(process.env.UPLOAD_DIR || path.join(rootDir, "uploads"));
const port = Number(process.env.PORT || 3000);
const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const databaseName = process.env.MONGODB_DATABASE || "university_events";
const allowedOrigins = [
    ...(process.env.FRONTEND_ORIGINS || "http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174").split(","),
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "",
    process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : ""
].map((origin) => origin.trim()).filter(Boolean);

const mongoOptions = {
    serverSelectionTimeoutMS: Number(process.env.MONGODB_CONNECT_TIMEOUT_MS || 10000),
    maxPoolSize: Number(process.env.MONGODB_MAX_POOL_SIZE || 10)
};
let mongoClient = new MongoClient(mongoUri, mongoOptions);
let db;
let collections;
let eventCovers;
let profileMedia;
let databaseReady = false;
let databaseConnectionPromise;
const passwordResetIpWindows = new Map();

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((req, res, next) => cors({
    origin(origin, callback) {
        const requestOrigin = `${req.protocol}://${req.get("host")}`;
        let isLocalViteOrigin = false;
        if (origin) {
            try {
                const parsedOrigin = new URL(origin);
                const portNumber = Number(parsedOrigin.port);
                isLocalViteOrigin = parsedOrigin.protocol === "http:" &&
                    ["localhost", "127.0.0.1"].includes(parsedOrigin.hostname) &&
                    portNumber >= 5173 && portNumber <= 5199;
            } catch { /* Invalid origins are rejected below. */ }
        }
        if (!origin || origin === requestOrigin || allowedOrigins.includes(origin) || isLocalViteOrigin) return callback(null, true);
        return callback(new Error("Origin is not allowed."));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
})(req, res, next));
app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
    req.requestId = crypto.randomUUID();
    res.setHeader("X-Request-ID", req.requestId);
    next();
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
    secret: process.env.SESSION_SECRET || "local-development-secret-change-before-deployment",
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.SESSION_COOKIE_SECURE === "true" || process.env.VERCEL === "1",
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
const ok = (res, message, extra = {}) => res.status(200).json(toApi({ success: true, ...(message ? { message } : {}), ...extra }));
const fail = (res, status, message, extra = {}) => res.status(status).json({ success: false, message, ...extra });
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
    if (event.status === "cancelled") return "cancelled";
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

function resetRequestLimit(ip) {
    const now = Date.now();
    if (passwordResetIpWindows.size > 5000) {
        for (const [key, window] of passwordResetIpWindows) {
            if (now - window.startedAt >= 60 * 60 * 1000) passwordResetIpWindows.delete(key);
        }
    }
    const window = passwordResetIpWindows.get(ip);
    if (!window || now - window.startedAt >= 60 * 60 * 1000) {
        passwordResetIpWindows.set(ip, { startedAt: now, count: 1 });
        return false;
    }
    window.count += 1;
    return window.count > 12;
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

app.get("/api/health", async (_req, res, next) => {
    if (!db) return fail(res, 503, "MongoDB is not connected.", { status: "not_ready", database: "mongodb" });
    try {
        await db.command({ ping: 1 });
        await collections.users.findOne({}, { projection: { _id: 1 } });

        // Exercise the collection operations used by login sessions without
        // touching a real user's session. A TTL expiry cleans up if deletion fails.
        const probeId = `health-${crypto.randomUUID()}`;
        let probeInserted = false;
        try {
            await collections.sessions.insertOne({
                _id: probeId,
                data: {},
                expiresAt: new Date(Date.now() + 60_000)
            });
            probeInserted = true;
            await collections.sessions.findOne({ _id: probeId }, { projection: { _id: 1 } });
            await collections.sessions.updateOne({ _id: probeId }, { $set: { updatedAt: new Date() } });
        } finally {
            if (probeInserted) await collections.sessions.deleteOne({ _id: probeId }).catch(() => {});
        }

        databaseReady = true;
        return ok(res, null, { status: "ready", database: "mongodb" });
    } catch (error) {
        databaseReady = false;
        return next(error);
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
    if (password.length < 8) return fail(res, 422, "Password must be at least 8 characters.");
    try {
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
    try {
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
    if (resetRequestLimit(req.ip || req.socket.remoteAddress || "unknown")) return fail(res, 429, "Too many reset requests. Please try again later.");

    try {
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
            console.error("Password reset email could not be sent:", emailError.message);
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
    if (password.length < 8) return fail(res, 422, "Password must be at least 8 characters.");
    try {
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
        res.clearCookie("university_events.sid", { httpOnly: true, sameSite: "lax", secure: process.env.SESSION_COOKIE_SECURE === "true" });
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
        const event = await collections.events.findOne({ id, status: { $ne: "cancelled" }, ...publishedEventQuery() });
        if (!event) return fail(res, 404, "Event not found.");
        return ok(res, null, { event: withEventStatus(event) });
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

// Event registration and member passes
app.post("/api/registration/create", signedIn, async (req, res, next) => {
    const eventId = Number(req.body.event_id);
    if (!Number.isInteger(eventId) || eventId < 1) return fail(res, 422, "A valid event is required.");
    if (req.session.role !== "student") return fail(res, 403, "Only student accounts can register for events.");
    try {
        const event = await collections.events.findOne({ id: eventId, ...publishedEventQuery() });
        if (!event) return fail(res, 404, "Event not found.");
        const now = new Date();
        if (event.status === "cancelled" || event.start_date <= now || (event.registration_deadline && event.registration_deadline < now)) {
            return fail(res, 422, "Registration for this event is closed.");
        }
        const reservation = await collections.events.updateOne(
            {
                id: eventId,
                publication_status: { $in: ["published", null] },
                status: { $ne: "cancelled" },
                start_date: { $gt: now },
                $and: [
                    { $or: [{ registration_deadline: null }, { registration_deadline: { $exists: false } }, { registration_deadline: { $gte: now } }] },
                    { $or: [{ capacity: { $lte: 0 } }, { $expr: { $lt: [{ $ifNull: ["$registration_count", 0] }, "$capacity"] } }] }
                ]
            },
            { $inc: { registration_count: 1 } }
        );
        if (!reservation.modifiedCount) {
            const refreshed = await collections.events.findOne({ id: eventId });
            if (refreshed && Number(refreshed.capacity) > 0 && Number(refreshed.registration_count || 0) >= Number(refreshed.capacity)) return fail(res, 409, "This event is already full.");
            return fail(res, 422, "Registration for this event is closed.");
        }
        const code = registrationCode();
        const registration = {
            id: await nextId("registrations"), user_id: Number(req.session.userId), event_id: eventId,
            registration_code: code, status: "registered", registered_at: new Date()
        };
        try {
            await collections.registrations.insertOne(registration);
        } catch (error) {
            await collections.events.updateOne({ id: eventId }, { $inc: { registration_count: -1 } });
            if (duplicateKey(error)) return fail(res, 409, "You are already registered for this event.");
            throw error;
        }
        return ok(res, "Registration successful.", { registration_code: code });
    } catch (error) { return next(error); }
});

app.get("/api/registration/my", signedIn, async (req, res, next) => {
    try {
        const registrations = await collections.registrations.find({ user_id: Number(req.session.userId) }).sort({ registered_at: -1 }).toArray();
        const eventIds = registrations.map((registration) => registration.event_id);
        const events = await collections.events.find({ id: { $in: eventIds } }).toArray();
        const eventMap = new Map(events.map((event) => [event.id, event]));
        const rows = registrations.map((registration) => {
            const event = eventMap.get(registration.event_id);
            if (!event) return null;
            return {
                registration_id: registration.id, registration_code: registration.registration_code,
                status: registration.status, registered_at: registration.registered_at,
                event_id: event.id, title: event.title, description: event.description,
                location: event.location, start_date: event.start_date, end_date: event.end_date,
                cover_image: event.cover_image, event_status: event.status
            };
        }).filter(Boolean);
        return ok(res, null, { events: rows });
    } catch (error) { return next(error); }
});

// Council member event assignments. Duplicate sign-ups are blocked by the unique MongoDB index.
app.get("/api/participation/mine", signedIn, async (req, res, next) => {
    try {
        const assignments = await collections.eventAssignments.find({ user_id: Number(req.session.userId) }).sort({ created_at: -1 }).toArray();
        const eventIds = [...new Set(assignments.map((assignment) => assignment.event_id))];
        const events = await collections.events.find({ id: { $in: eventIds } }).toArray();
        const eventMap = new Map(events.map((event) => [event.id, event]));
        return ok(res, null, { assignments: assignments.map((assignment) => {
            const event = eventMap.get(assignment.event_id);
            return event ? { ...assignment, event: { id: event.id, title: event.title, location: event.location, start_date: event.start_date, end_date: event.end_date, participation_requirements: event.participation_requirements, display_status: displayStatus(event) } } : null;
        }).filter(Boolean) });
    } catch (error) { return next(error); }
});

app.post("/api/participation/signup", signedIn, async (req, res, next) => {
    if (req.session.role !== "student") return fail(res, 403, "Only student members can sign up for event assignments.");
    const eventId = Number(req.body.event_id);
    if (!Number.isInteger(eventId) || eventId < 1) return fail(res, 422, "Choose a valid event.");
    try {
        const event = await collections.events.findOne({ id: eventId, ...publishedEventQuery() });
        const now = new Date();
        if (!event || event.participation_open === false || event.status === "cancelled" || event.start_date <= now || (event.registration_deadline && event.registration_deadline < now)) {
            return fail(res, 422, "Sign-ups for this event are closed.");
        }
        const user = await collections.users.findOne({ id: Number(req.session.userId) }, { projection: { id: 1, first_name: 1, last_name: 1, email: 1, student_id: 1, course: 1, year_level: 1 } });
        if (!user) return fail(res, 401, "Your account could not be found. Please sign in again.");
        const eligibleCourses = event.eligible_courses || [];
        const eligibleYears = event.eligible_year_levels || [];
        if ((eligibleCourses.length && !eligibleCourses.some((course) => course.toLowerCase() === text(user.course).toLowerCase())) || (eligibleYears.length && !eligibleYears.includes(text(user.year_level)))) return fail(res, 403, "Your course or year level does not meet this event’s participation requirements.");
        if (event.require_event_registration && !await collections.registrations.findOne({ user_id: user.id, event_id: event.id, status: { $in: ["registered", "attended"] } }, { projection: { id: 1 } })) return fail(res, 403, "Register for this event before requesting an official assignment.");
        const assignment = { id: await nextId("event_assignments"), user_id: user.id, event_id: event.id, status: "pending", created_at: now };
        const assignmentCapacity = Number(event.assignment_capacity || 0);
        if (assignmentCapacity > 0) {
            const reservation = await collections.events.updateOne({ id: eventId, $or: [{ assignment_count: { $lt: assignmentCapacity } }, { assignment_count: { $exists: false } }] }, { $inc: { assignment_count: 1 } });
            if (!reservation.modifiedCount) return fail(res, 409, "All event assignment positions are filled.");
        }
        try { await collections.eventAssignments.insertOne(assignment); }
        catch (error) {
            if (assignmentCapacity > 0) await collections.events.updateOne({ id: eventId }, { $inc: { assignment_count: -1 } });
            if (duplicateKey(error)) return fail(res, 409, "You already signed up for this event assignment.");
            throw error;
        }
        return ok(res, "Your event assignment sign-up was submitted.", { assignment: { ...assignment, event: { id: event.id, title: event.title, start_date: event.start_date, location: event.location, participation_requirements: event.participation_requirements } } });
    } catch (error) {
        if (duplicateKey(error)) return fail(res, 409, "You already signed up for this event assignment.");
        return next(error);
    }
});

app.get("/api/registration/by-code", signedIn, async (req, res, next) => {
    const code = text(req.query.code).trim();
    if (!code) return fail(res, 422, "Registration code is required.");
    try {
        const registration = await collections.registrations.findOne({ registration_code: code, user_id: Number(req.session.userId) });
        if (!registration) return fail(res, 404, "Registration not found.");
        const [user, event] = await Promise.all([
            collections.users.findOne({ id: registration.user_id }),
            collections.events.findOne({ id: registration.event_id })
        ]);
        if (!user || !event) return fail(res, 404, "Registration not found.");
        return ok(res, null, { registration: {
            registration_id: registration.id, registration_code: registration.registration_code,
            status: registration.status, registered_at: registration.registered_at,
            student_id: user.student_id, first_name: user.first_name, last_name: user.last_name,
            email: user.email, course: user.course, year_level: user.year_level,
            event_id: event.id, title: event.title, description: event.description,
            location: event.location, start_date: event.start_date, end_date: event.end_date,
            cover_image: event.cover_image
        } });
    } catch (error) { return next(error); }
});

// Admin event and account management
app.get("/api/admin/events", adminOnly, async (_req, res, next) => {
    try {
        const [events, eventCount, activeEventCount, registrationCount, studentCount] = await Promise.all([
            collections.events.find({}).sort({ start_date: -1 }).toArray(),
            collections.events.countDocuments({}),
            collections.events.countDocuments({ status: { $in: ["upcoming", "ongoing"] }, $or: [{ publication_status: "published" }, { publication_status: { $exists: false } }] }),
            collections.registrations.countDocuments({ status: { $ne: "cancelled" } }),
            collections.users.countDocuments({ role: "student" })
        ]);
        const counts = await collections.registrations.aggregate([
            { $match: { status: { $ne: "cancelled" } } },
            { $group: { _id: "$event_id", total: { $sum: 1 } } }
        ]).toArray();
        const countMap = new Map(counts.map(({ _id, total }) => [_id, total]));
        return ok(res, null, {
            events: events.map((event) => ({ ...withEventStatus(event), registration_count: countMap.get(event.id) || 0 })),
            stats: { event_count: eventCount, active_event_count: activeEventCount, registration_count: registrationCount, student_count: studentCount }
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
const meetingIdFrom = (value) => Number(value);
const attendancePassHash = (token) => crypto.createHash("sha256").update(token).digest("hex");

app.post("/api/admin/council/roster", adminOnly, async (req, res, next) => {
    const userId = Number(req.body.user_id);
    const position = text(req.body.council_position).trim();
    const department = text(req.body.council_department).trim().toUpperCase();
    if (!Number.isInteger(userId) || userId < 1 || (position && !councilPositions.has(position))) return fail(res, 422, "Choose a valid account and council appointment.");
    if (position === "department_representative" && !councilDepartments.has(department)) return fail(res, 422, "Choose the represented department.");
    try {
        const user = await collections.users.findOne({ id: userId }, { projection: { id: 1 } });
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
const workStatuses = new Set(["Request Submitted", "Requirements Review", "Assigned", "In Design", "Internal Review", "Revisions Requested", "Awaiting Approval", "Approved", "Scheduled", "Published", "Archived", "Not Started", "In Progress", "Blocked", "Complete"]);
const workCommittees = new Set(["executive", "publication", "production", "program"]);

app.get("/api/admin/dashboard", adminOnly, async (_req, res, next) => {
    try {
        const now = new Date();
        const period = periodForDate(now);
        const manilaMonth = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit" }).formatToParts(now).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
        const trendStart = new Date(Date.UTC(Number(manilaMonth.year), Number(manilaMonth.month) - 6, 1) - 8 * 60 * 60 * 1000);
        const [
            studentCount,
            studentCourseRows,
            studentRegistrationRows,
            totalEventCount,
            activeEventCount,
            publicationRows,
            eventRows,
            eventRegistrationRows,
            councilMetricsRows,
            meetings,
            reports,
            pendingAssignmentCount,
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
            collections.registrations.aggregate([
                { $lookup: { from: "users", localField: "user_id", foreignField: "id", as: "account" } },
                { $unwind: "$account" },
                { $match: { "account.role": "student", status: { $ne: "cancelled" } } },
                { $facet: {
                    summary: [{ $group: { _id: null, registrations: { $sum: 1 }, checked_in: { $sum: { $cond: [{ $eq: ["$status", "attended"] }, 1, 0] } } } }],
                    trend: [
                        { $match: { registered_at: { $gte: trendStart } } },
                        { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$registered_at", timezone: "Asia/Manila" } }, registrations: { $sum: 1 }, checked_in: { $sum: { $cond: [{ $eq: ["$status", "attended"] }, 1, 0] } } } },
                        { $sort: { _id: 1 } }
                    ]
                } }
            ]).toArray(),
            collections.events.countDocuments({}),
            collections.events.countDocuments({ status: { $in: ["upcoming", "ongoing"] }, $or: [{ publication_status: "published" }, { publication_status: { $exists: false } }] }),
            collections.events.aggregate([{ $group: { _id: { $ifNull: ["$publication_status", "published"] }, count: { $sum: 1 } } }]).toArray(),
            collections.events.find({ status: { $in: ["upcoming", "ongoing"] }, $or: [{ publication_status: "published" }, { publication_status: { $exists: false } }] }, { projection: { id: 1, title: 1, start_date: 1, end_date: 1, location: 1, cover_image: 1, capacity: 1, status: 1, publication_status: 1 } }).sort({ start_date: 1 }).limit(4).toArray(),
            collections.registrations.aggregate([{ $match: { status: { $ne: "cancelled" } } }, { $group: { _id: "$event_id", count: { $sum: 1 } } }]).toArray(),
            collections.users.aggregate([{ $facet: {
                roster: [{ $match: { council_position: { $in: [...councilPositions] } } }, { $count: "count" }],
                voting: [{ $match: { council_position: { $in: votingCouncilPositions } } }, { $count: "count" }],
                executive: [{ $match: { $or: [{ committee_assignment: "executive" }, { council_position: { $in: [...executiveCouncilPositions] } }] } }, { $count: "count" }],
                committees: [{ $match: { committee_assignment: { $in: [...workCommittees] } } }, { $group: { _id: "$committee_assignment", count: { $sum: 1 } } }]
            } }]).toArray(),
            collections.governanceMeetings.find({ academic_period: period }, { projection: { id: 1, title: 1, meeting_type: 1, mandatory: 1, status: 1, start_at: 1, end_at: 1, quorum_waiver_rationale: 1, minutes_status: 1 } }).sort({ start_at: 1 }).toArray(),
            collections.councilReports.find({ academic_period: period }, { projection: { committee: 1, status: 1 } }).toArray(),
            collections.eventAssignments.countDocuments({ status: "pending" }),
            collections.committeeWorkItems.countDocuments({ committee: "executive", kind: "approval", status: { $nin: ["Approved", "Complete", "Archived"] } }),
            collections.financialRecords.find({ $or: [{ type: "allocation", status: { $in: ["proposed", "approved"] } }, { type: "expense", status: { $in: ["pending", "recorded"] } }] }, { projection: { type: 1, status: 1, amount: 1 } }).toArray()
        ]);

        const studentRegistrationStats = studentRegistrationRows[0] || { summary: [], trend: [] };
        const studentSummary = studentRegistrationStats.summary[0] || { registrations: 0, checked_in: 0 };
        const studentRegistrations = Number(studentSummary.registrations || 0);
        const studentCheckIns = Number(studentSummary.checked_in || 0);
        const publication = Object.fromEntries(publicationRows.map(({ _id, count }) => [_id, count]));
        const eventRegistrationCount = new Map(eventRegistrationRows.map(({ _id, count }) => [_id, count]));
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
        const pendingApprovals = publicationPending + reportsPending + minutesPending + pendingExcuseReviews + pendingAssignmentCount + pendingApprovalWorkCount;

        return ok(res, null, {
            dashboard: {
                academic_period: period,
                students: {
                    account_count: studentCount,
                    registration_count: studentRegistrations,
                    check_in_count: studentCheckIns,
                    check_in_rate: studentRegistrations ? Math.round(studentCheckIns / studentRegistrations * 100) : 0,
                    course_distribution: studentCourseRows.map((row) => ({ course: row._id, count: row.count })),
                    registration_trend: studentRegistrationStats.trend.map((month) => ({ month: month._id, registrations: month.registrations, checked_in: month.checked_in }))
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
                    event_assignments_pending: pendingAssignmentCount,
                    approval_queue_count: pendingApprovals,
                    finance: { ...finance, available_balance: finance.approved_allocations - finance.recorded_expenses }
                }
            },
            events: eventRows.map((event) => ({ ...withEventStatus(event), registration_count: eventRegistrationCount.get(event.id) || 0 }))
        });
    } catch (error) { return next(error); }
});

app.get("/api/admin/committee-work", committeeWorkspaceAccess, async (req, res, next) => {
    const committee = req.workspaceCommittee || text(req.query.committee).trim().toLowerCase();
    if (committee && !workCommittees.has(committee)) return fail(res, 422, "Choose a valid committee workspace.");
    try {
        const isExecutive = !req.workspaceCommittee;
        const query = committee && committee !== "executive" ? { committee } : {};
        const visibleEventsQuery = isExecutive
            ? {}
            : { status: { $ne: "cancelled" }, $or: [{ publication_status: "published" }, { publication_status: { $exists: false } }] };
        const usersQuery = isExecutive
            ? { $or: [
                { committee_assignment: committee || "executive" },
                { committee_assignment: "executive" },
                { role: "admin" },
                { council_position: { $in: [...executiveCouncilPositions] } }
            ] }
            : { committee_assignment: req.workspaceCommittee };
        const [items, events, users, eventCount, activeEventCount, registrationCount, attendanceCount, workApprovalCount, assignmentQueue, pendingEvents, financeRecords] = await Promise.all([
            collections.committeeWorkItems.find(query).sort({ due_at: 1, updated_at: -1 }).toArray(),
            collections.events.find(visibleEventsQuery, { projection: { id: 1, title: 1, start_date: 1, status: 1 } }).sort({ start_date: -1 }).toArray(),
            collections.users.find(usersQuery, { projection: { id: 1, first_name: 1, last_name: 1, email: 1, role: 1 } }).sort({ first_name: 1 }).toArray(),
            isExecutive ? collections.events.countDocuments({}) : Promise.resolve(0),
            isExecutive ? collections.events.countDocuments({ status: { $in: ["upcoming", "ongoing"] } }) : Promise.resolve(0),
            isExecutive ? collections.registrations.countDocuments({ status: { $ne: "cancelled" } }) : Promise.resolve(0),
            isExecutive ? collections.attendance.countDocuments({}) : Promise.resolve(0),
            isExecutive ? collections.committeeWorkItems.countDocuments({ committee: "executive", kind: "approval", status: { $nin: ["Approved", "Complete", "Archived"] } }) : Promise.resolve(0),
            isExecutive && committee === "executive" ? collections.eventAssignments.find({ status: "pending" }).sort({ created_at: 1 }).toArray() : Promise.resolve([]),
            isExecutive && committee === "executive" ? collections.events.find({ publication_status: "pending_approval" }, { projection: { id: 1, title: 1, description: 1, start_date: 1, end_date: 1, location: 1, cover_image: 1 } }).sort({ start_date: 1 }).toArray() : Promise.resolve([]),
            isExecutive && committee === "executive" ? collections.financialRecords.find({ $or: [{ type: "allocation", status: "approved" }, { type: "expense", status: "recorded" }] }, { projection: { type: 1, amount: 1 } }).toArray() : Promise.resolve([])
        ]);
        const eventMap = new Map(events.map((event) => [event.id, event.title]));
        const userMap = new Map(users.map((user) => [user.id, `${user.first_name} ${user.last_name}`.trim()]));
        const financeSummary = financeRecords.reduce((summary, item) => { if (item.type === "allocation") summary.allocated += Number(item.amount); if (item.type === "expense") summary.expenses += Number(item.amount); return summary; }, { allocated: 0, expenses: 0 });
        let assignmentQueueRows = [];
        if (assignmentQueue.length) {
            const [allEvents, assignmentUsers] = await Promise.all([
                collections.events.find({ id: { $in: [...new Set(assignmentQueue.map((item) => item.event_id))] } }, { projection: { id: 1, title: 1, start_date: 1 } }).toArray(),
                collections.users.find({ id: { $in: [...new Set(assignmentQueue.map((item) => item.user_id))] } }, { projection: { id: 1, first_name: 1, last_name: 1, student_id: 1, email: 1 } }).toArray()
            ]);
            const assignmentEventMap = new Map(allEvents.map((item) => [item.id, item]));
            const assignmentUserMap = new Map(assignmentUsers.map((item) => [item.id, item]));
            assignmentQueueRows = assignmentQueue.map((item) => ({ ...item, event: assignmentEventMap.get(item.event_id), member: assignmentUserMap.get(item.user_id) })).filter((item) => item.event && item.member);
        }
        return ok(res, null, { items: items.map((item) => ({ ...item, event_title: eventMap.get(item.event_id) || "—", assignee_name: userMap.get(item.assignee_user_id) || "Unassigned" })), events, users, assignment_queue: assignmentQueueRows, event_queue: pendingEvents, overview: isExecutive ? { event_count: eventCount, active_event_count: activeEventCount, registration_count: registrationCount, attendance_count: attendanceCount, pending_approval_count: workApprovalCount + assignmentQueueRows.length + pendingEvents.length, approved_allocation_total: financeSummary.allocated, recorded_expense_total: financeSummary.expenses } : null });
    } catch (error) { return next(error); }
});

app.post("/api/admin/committee-work/save", committeeWorkspaceAccess, async (req, res, next) => {
    const id = Number(req.body.id || 0);
    const committee = req.workspaceCommittee || text(req.body.committee).trim().toLowerCase();
    const kind = text(req.body.kind).trim().toLowerCase();
    const title = text(req.body.title).trim();
    const details = text(req.body.details).trim();
    const status = text(req.body.status).trim();
    const priority = text(req.body.priority || "normal").trim().toLowerCase();
    const eventId = req.body.event_id ? Number(req.body.event_id) : null;
    const assigneeId = req.body.assignee_user_id ? Number(req.body.assignee_user_id) : null;
    const dueAt = req.body.due_at ? parseDate(text(req.body.due_at)) : null;
    const attachmentUrl = text(req.body.attachment_url).trim();
    const timeSlot = text(req.body.time_slot).trim();
    const duration = req.body.duration_minutes ? Number(req.body.duration_minutes) : null;
    const checklistLabels = text(req.body.checklist_text).split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 40);
    const validKinds = new Set(["pubmat", "program", "production", "approval", "task"]);
    const kindsByCommittee = { executive: ["approval", "task"], publication: ["pubmat", "task"], program: ["program", "task"], production: ["production", "task"] };
    if (!workCommittees.has(committee) || !validKinds.has(kind) || !kindsByCommittee[committee]?.includes(kind) || !title || title.length > 180 || details.length > 4000 || !workStatuses.has(status) || !["low", "normal", "high", "urgent"].includes(priority)) return fail(res, 422, "Review the work item fields and status.");
    if (req.body.due_at && !dueAt) return fail(res, 422, "Enter a valid deadline.");
    if (timeSlot && !/^([01]\d|2[0-3]):[0-5]\d$/.test(timeSlot)) return fail(res, 422, "Enter a valid local start time.");
    if (duration !== null && (!Number.isInteger(duration) || duration < 1 || duration > 1440)) return fail(res, 422, "Duration must be between 1 and 1,440 minutes.");
    if (eventId !== null && (!Number.isInteger(eventId) || eventId < 1)) return fail(res, 422, "Choose a valid event.");
    if (assigneeId !== null && (!Number.isInteger(assigneeId) || assigneeId < 1)) return fail(res, 422, "Choose a valid assignee.");
    if (attachmentUrl && (!/^https?:\/\//i.test(attachmentUrl) || attachmentUrl.length > 1000)) return fail(res, 422, "Attachments must use a valid HTTPS or HTTP URL.");
    try {
        const now = new Date();
        if (eventId && !await collections.events.findOne({ id: eventId }, { projection: { id: 1 } })) return fail(res, 404, "Event not found.");
        if (assigneeId) {
            const assigneeQuery = req.workspaceCommittee
                ? { id: assigneeId, committee_assignment: req.workspaceCommittee }
                : { id: assigneeId, $or: [
                    { committee_assignment: committee },
                    { committee_assignment: "executive" },
                    { role: "admin" },
                    { council_position: { $in: [...executiveCouncilPositions] } }
                ] };
            if (!await collections.users.findOne(assigneeQuery, { projection: { id: 1 } })) {
                return fail(res, 422, req.workspaceCommittee ? "You can assign work only to members of your committee." : "Assignee must belong to this committee or the Executive Committee.");
            }
        }
        if (!id && ((kind === "pubmat" && status !== "Request Submitted") || (kind !== "pubmat" && !["Not Started", "Request Submitted"].includes(status)))) return fail(res, 422, "New items must start at the first step in their workflow.");
        if (id) {
            const existing = await collections.committeeWorkItems.findOne({ id });
            if (!existing) return fail(res, 404, "Work item not found.");
            if (existing.committee !== committee || existing.kind !== kind) return fail(res, 422, "A work item cannot be moved between committee workflows or types after creation.");
            const pubmatNext = { "Request Submitted": ["Requirements Review"], "Requirements Review": ["Assigned", "Request Submitted"], "Assigned": ["In Design", "Revisions Requested"], "In Design": ["Internal Review", "Revisions Requested"], "Internal Review": ["Revisions Requested", "Awaiting Approval"], "Revisions Requested": ["In Design"], "Awaiting Approval": ["Approved", "Revisions Requested"], "Approved": ["Scheduled", "Archived"], "Scheduled": ["Published", "Archived"], "Published": ["Archived"], "Archived": [] };
            const taskNext = { "Not Started": ["In Progress", "Blocked"], "In Progress": ["Blocked", "Complete"], "Blocked": ["In Progress"], "Complete": [] };
            const transitions = existing.kind === "pubmat" ? pubmatNext : taskNext;
            if (status !== existing.status && !(transitions[existing.status] || []).includes(status)) return fail(res, 422, "That status change is not allowed in this workflow.");
            const completed = new Map((existing.checklist || []).map((item) => [item.label, item.done]));
            req.body.checklist = checklistLabels.map((label) => ({ label, done: Boolean(completed.get(label)) }));
        } else {
            req.body.checklist = checklistLabels.map((label) => ({ label, done: false }));
        }
        const values = { committee, kind, title, details, status, priority, event_id: eventId, assignee_user_id: assigneeId, due_at: dueAt, attachment_url: attachmentUrl, checklist: req.body.checklist, time_slot: timeSlot, duration_minutes: duration, updated_at: now };
        if (id) {
            const result = await collections.committeeWorkItems.updateOne({ id }, { $set: values, $push: { activity: { at: now, actor_id: Number(req.session.userId), status } } });
            if (!result.matchedCount) return fail(res, 404, "Work item not found.");
            return ok(res, "Work item updated.", { id });
        }
        const newId = await nextId("committee_work_items");
        await collections.committeeWorkItems.insertOne({ id: newId, ...values, created_at: now, created_by: Number(req.session.userId) });
        return ok(res, "Work item created.", { id: newId });
    } catch (error) { return next(error); }
});

app.post("/api/admin/committee-work/delete", committeeWorkspaceAccess, async (req, res, next) => {
    const id = Number(req.body.id);
    if (!Number.isInteger(id) || id < 1) return fail(res, 422, "Choose a valid work item.");
    try {
        const result = await collections.committeeWorkItems.deleteOne({ id });
        if (!result.deletedCount) return fail(res, 404, "Work item not found.");
        return ok(res, "Work item deleted.");
    } catch (error) { return next(error); }
});

app.post("/api/admin/committee-work/checklist", committeeWorkspaceAccess, async (req, res, next) => {
    const id = Number(req.body.id);
    const label = text(req.body.label).trim();
    if (!Number.isInteger(id) || id < 1 || !label || label.length > 180 || typeof req.body.done !== "boolean") return fail(res, 422, "Choose a checklist item and completion status.");
    try {
        const result = await collections.committeeWorkItems.updateOne({ id, checklist: { $elemMatch: { label } } }, { $set: { "checklist.$.done": req.body.done, updated_at: new Date() } });
        if (!result.matchedCount) return fail(res, 404, "Checklist item not found.");
        return ok(res, "Checklist updated.");
    } catch (error) { return next(error); }
});

app.post("/api/admin/participation/review", adminOnly, async (req, res, next) => {
    const id = Number(req.body.id);
    const status = text(req.body.status).trim();
    if (!Number.isInteger(id) || id < 1 || !["approved", "rejected"].includes(status)) return fail(res, 422, "Choose a valid assignment decision.");
    try {
        const assignment = await collections.eventAssignments.findOne({ id, status: "pending" });
        if (!assignment) return fail(res, 404, "The pending event assignment could not be found.");
        const result = await collections.eventAssignments.updateOne({ id, status: "pending" }, { $set: { status, reviewed_by: Number(req.session.userId), reviewed_at: new Date() } });
        if (!result.modifiedCount) return fail(res, 409, "This assignment was already reviewed.");
        if (status === "rejected") await collections.events.updateOne({ id: assignment.event_id, assignment_capacity: { $gt: 0 }, assignment_count: { $gt: 0 } }, { $inc: { assignment_count: -1 } });
        return ok(res, status === "approved" ? "Assignment approved." : "Assignment declined.");
    } catch (error) { return next(error); }
});

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

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 1 } });
const imageMiddleware = (req, res, next) => upload.single("cover_image")(req, res, (error) => {
    if (error) return fail(res, 422, "Choose an image smaller than 4 MB.");
    next();
});

const profileUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 2 } });
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
    const publicationStatus = text(body.publication_status || (creating ? "draft" : "published")).trim();
    const participationRequirements = text(body.participation_requirements).trim();
    const eligibleCourses = text(body.eligible_courses).split(",").map((item) => item.trim()).filter(Boolean).slice(0, 30);
    const eligibleYearLevels = text(body.eligible_year_levels).split(",").map((item) => item.trim()).filter(Boolean).slice(0, 10);
    if (!title || title.length > 255 || !description || !location || location.length > 255) return { error: "Enter a title, event description, and location." };
    if (!start || !end || end <= start) return { error: "Enter valid start and end times; the end must be after the start." };
    if (body.registration_deadline && (!deadline || deadline > start)) return { error: "The registration deadline must be valid and no later than the event start." };
    if (!Number.isInteger(capacity) || capacity < 1) return { error: "Capacity must be at least one attendee." };
    if (!Number.isInteger(assignmentCapacity) || assignmentCapacity < 0 || assignmentCapacity > 10000) return { error: "Assignment capacity must be zero (unlimited) or between 1 and 10,000." };
    if (participationRequirements.length > 1000) return { error: "Participation requirements must be under 1,000 characters." };
    if (!(creating ? ["upcoming", "ongoing"] : ["upcoming", "ongoing", "completed", "cancelled"]).includes(status)) return { error: "Choose a valid event status." };
    if (!(["draft", "pending_approval", "published", "cancelled", "archived"].includes(publicationStatus))) return { error: "Choose a valid publication status." };
    if (creating && !["draft", "pending_approval"].includes(publicationStatus)) return { error: "New events must be saved as a draft or submitted for approval." };
    return { title, description, location, start_date: start, end_date: end, registration_deadline: deadline, capacity, status, publication_status: publicationStatus, assignment_capacity: assignmentCapacity, participation_open: body.participation_open !== "false", participation_requirements: participationRequirements, eligible_courses: eligibleCourses, eligible_year_levels: eligibleYearLevels, require_event_registration: body.require_event_registration === "true" };
}

app.post("/api/admin/events/create", adminOnly, imageMiddleware, async (req, res, next) => {
    const event = validateEventFields(req.body, true);
    if (event.error) return fail(res, 422, event.error);
    let cover;
    try { cover = await storeCover(req.file); }
    catch (error) { return fail(res, 422, error.message); }
    try {
        const id = await nextId("events");
        await collections.events.insertOne({ id, ...event, cover_image: cover, registration_count: 0, assignment_count: 0, created_at: new Date() });
        return ok(res, "Event created successfully.", { event_id: id });
    } catch (error) {
        await fs.unlink(path.join(uploadRoot, cover.slice("/uploads/".length))).catch(() => {});
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
        await collections.events.updateOne({ id }, { $set: { ...event, cover_image: cover, registration_count: registrationCount } });
        if (req.file && existing.cover_image !== cover) await removeLocalCover(existing.cover_image);
        return ok(res, "Event updated successfully.", { event_id: id });
    } catch (error) { return next(error); }
});

app.post("/api/admin/events/review", adminOnly, async (req, res, next) => {
    const id = Number(req.body.event_id);
    const decision = text(req.body.decision).trim();
    if (!Number.isInteger(id) || id < 1 || !["approve", "return"].includes(decision)) return fail(res, 422, "Choose a valid event approval decision.");
    try {
        const publicationStatus = decision === "approve" ? "published" : "draft";
        const result = await collections.events.updateOne({ id, publication_status: "pending_approval" }, { $set: { publication_status: publicationStatus, reviewed_by: Number(req.session.userId), reviewed_at: new Date(), updated_at: new Date() }, $push: { publication_history: { status: publicationStatus, decision, reviewer_id: Number(req.session.userId), at: new Date() } } });
        if (!result.modifiedCount) return fail(res, 404, "This event is no longer awaiting approval.");
        return ok(res, decision === "approve" ? "Event published." : "Event returned to draft.");
    } catch (error) { return next(error); }
});

async function removeLocalCover(cover) {
    if (!/^\/uploads\/events\/event-[a-f0-9]{24}\.(jpg|png|webp)$/.test(cover || "")) return;
    const stillReferenced = await collections.events.countDocuments({ cover_image: cover });
    if (stillReferenced) return;
    if (process.env.VERCEL === "1") {
        const id = new ObjectId(cover.match(/event-([a-f0-9]{24})/)[1]);
        await eventCovers.delete(id).catch(() => {});
        return;
    }
    await fs.unlink(path.join(uploadRoot, "events", path.basename(cover))).catch(() => {});
}

app.post("/api/admin/events/delete", adminOnly, async (req, res, next) => {
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

// Attendance check-in
app.get("/api/admin/attendance", adminOnly, async (req, res, next) => {
    const eventId = req.query.event_id ? Number(req.query.event_id) : null;
    if (eventId !== null && (!Number.isInteger(eventId) || eventId < 1)) return fail(res, 422, "Choose a valid event.");
    try {
        const attendanceRows = await collections.attendance.find({}).sort({ time_in: -1 }).toArray();
        const registrationIds = [...new Set(attendanceRows.map((record) => record.registration_id))];
        const registrations = await collections.registrations.find({ id: { $in: registrationIds } }).toArray();
        const registrationMap = new Map(registrations.map((registration) => [registration.id, registration]));
        const userIds = [...new Set(registrations.map((registration) => registration.user_id))];
        const eventIds = [...new Set(registrations.map((registration) => registration.event_id))];
        const [users, events] = await Promise.all([
            collections.users.find({ id: { $in: userIds } }, { projection: { id: 1, first_name: 1, last_name: 1, student_id: 1, email: 1, course: 1, year_level: 1 } }).toArray(),
            collections.events.find({ id: { $in: eventIds } }, { projection: { id: 1, title: 1, start_date: 1 } }).toArray()
        ]);
        const userMap = new Map(users.map((user) => [user.id, user]));
        const eventMap = new Map(events.map((event) => [event.id, event]));
        const rows = attendanceRows.map((record) => {
            const registration = registrationMap.get(record.registration_id);
            const user = registration && userMap.get(registration.user_id);
            const event = registration && eventMap.get(registration.event_id);
            if (!registration || !user || !event) return null;
            return { id: record.id, time_in: record.time_in, registration_code: registration.registration_code, event_id: event.id, event_title: event.title, event_start: event.start_date, status: registration.status, first_name: user.first_name, last_name: user.last_name, student_id: user.student_id, email: user.email, course: user.course, year_level: user.year_level };
        }).filter((row) => row && (!eventId || row.event_id === eventId));
        return ok(res, null, { rows, count: rows.length, event_id: eventId });
    } catch (error) { return next(error); }
});

app.get("/api/admin/attendance/lookup", adminOnly, async (req, res, next) => {
    const eventId = Number(req.query.event_id);
    const query = text(req.query.q).trim().slice(0, 100);
    if (!Number.isInteger(eventId) || eventId < 1 || query.length < 2) return fail(res, 422, "Choose an event and enter at least two search characters.");
    try {
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const users = await collections.users.find({ $or: [
            { student_id: { $regex: `^${escaped}`, $options: "i" } },
            { email: { $regex: `^${escaped}`, $options: "i" } },
            { first_name: { $regex: escaped, $options: "i" } },
            { last_name: { $regex: escaped, $options: "i" } }
        ] }, { projection: { id: 1, first_name: 1, last_name: 1, student_id: 1, email: 1 } }).limit(20).toArray();
        const ids = users.map((user) => user.id);
        const registrations = await collections.registrations.find({ user_id: { $in: ids }, event_id: eventId, status: { $in: ["registered", "attended"] } }).toArray();
        const userMap = new Map(users.map((user) => [user.id, user]));
        return ok(res, null, { matches: registrations.map((registration) => { const user = userMap.get(registration.user_id); return { registration_code: registration.registration_code, status: registration.status, name: `${user.first_name} ${user.last_name}`, student_id: user.student_id, email: user.email }; }) });
    } catch (error) { return next(error); }
});

app.post("/api/attendance/checkin", adminOnly, async (req, res, next) => {
    const code = text(req.body.registration_code).trim();
    const expectedEventId = req.body.event_id ? Number(req.body.event_id) : null;
    if (!code || code.length > 100) return fail(res, 422, "The QR code is empty or invalid.");
    if (expectedEventId !== null && (!Number.isInteger(expectedEventId) || expectedEventId < 1)) return fail(res, 422, "Choose a valid event.");
    try {
        const registration = await collections.registrations.findOne({ registration_code: code });
        if (!registration) return fail(res, 404, "No registration matches this QR code.");
        const [user, event] = await Promise.all([
            collections.users.findOne({ id: registration.user_id }),
            collections.events.findOne({ id: registration.event_id })
        ]);
        if (!user || !event) return fail(res, 404, "The registration data is incomplete.");
        const attendee = { name: `${user.first_name} ${user.last_name}`, student_id: user.student_id, email: user.email, course: user.course, year_level: user.year_level };
        const eventInfo = { title: event.title, location: event.location, start_date: event.start_date, end_date: event.end_date };
        if (expectedEventId && event.id !== expectedEventId) return ok(res, "This QR pass is for a different event.", { success: false, wrong_event: true, attendee, event: eventInfo, registration_code: code, registration_status: registration.status });
        if (registration.status === "cancelled") return ok(res, "This registration was cancelled and cannot be checked in.", { success: false, attendee, event: eventInfo, registration_code: code, registration_status: "cancelled" });
        if (registration.status === "attended") {
            const priorAttendance = await collections.attendance.findOne({ registration_id: registration.id }, { sort: { time_in: -1 } });
            return ok(res, "This student has already checked in.", { success: false, already_checked_in: true, attendee, event: eventInfo, registration_code: code, registration_status: "attended", time_in: priorAttendance?.time_in || null });
        }
        const update = await collections.registrations.updateOne({ id: registration.id, status: "registered" }, { $set: { status: "attended" } });
        if (!update.modifiedCount) {
            const latest = await collections.attendance.findOne({ registration_id: registration.id }, { sort: { time_in: -1 } });
            return ok(res, "This student has already checked in.", { success: false, already_checked_in: true, attendee, event: eventInfo, registration_code: code, registration_status: "attended", time_in: latest?.time_in || null });
        }
        const timeIn = new Date();
        await collections.attendance.insertOne({ id: await nextId("attendance"), registration_id: registration.id, time_in: timeIn, time_out: null });
        return ok(res, "Registration verified. Attendance recorded.", { attendee, event: eventInfo, registration_code: code, registration_status: "attended", time_in: timeIn });
    } catch (error) { return next(error); }
});

app.use((error, req, res, _next) => {
    if (res.headersSent) return;
    const requestId = req.requestId || crypto.randomUUID();
    console.error(`[${requestId}] ${req.method} ${req.path} failed:`, error);
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
    collections = {
        users: db.collection("users"), events: db.collection("events"),
        registrations: db.collection("registrations"), attendance: db.collection("attendance"),
        event_highlights: db.collection("event_highlights"), event_schedules: db.collection("event_schedules"),
        eventAssignments: db.collection("event_assignments"), committeeWorkItems: db.collection("committee_work_items"), financialRecords: db.collection("financial_records"),
        governanceMeetings: db.collection("governance_meetings"), councilAttendance: db.collection("council_attendance"),
        councilAttendancePasses: db.collection("council_attendance_passes"), councilExcuses: db.collection("council_excuses"),
        councilReports: db.collection("council_committee_reports"), councilInventory: db.collection("council_inventory"),
        passwordResetOtps: db.collection("password_reset_otps"),
        sessions: db.collection("sessions"), counters: db.collection("counters")
    };
    await Promise.all([
        collections.users.createIndex({ id: 1 }, { unique: true }),
        collections.users.createIndex({ email: 1 }, { unique: true }),
        collections.users.createIndex({ student_id: 1 }, { unique: true }),
        collections.events.createIndex({ id: 1 }, { unique: true }),
        collections.events.createIndex({ status: 1, start_date: 1 }),
        collections.registrations.createIndex({ id: 1 }, { unique: true }),
        collections.registrations.createIndex({ user_id: 1, event_id: 1 }, { unique: true }),
        collections.registrations.createIndex({ registration_code: 1 }, { unique: true }),
        collections.registrations.createIndex({ event_id: 1, status: 1 }),
        collections.attendance.createIndex({ id: 1 }, { unique: true }),
        collections.attendance.createIndex({ registration_id: 1, time_in: -1 }),
        collections.event_highlights.createIndex({ id: 1 }, { unique: true }),
        collections.event_highlights.createIndex({ event_id: 1, created_at: -1 }),
        collections.event_schedules.createIndex({ id: 1 }, { unique: true }),
        collections.event_schedules.createIndex({ event_id: 1 }),
        collections.eventAssignments.createIndex({ id: 1 }, { unique: true }),
        collections.eventAssignments.createIndex({ user_id: 1, event_id: 1 }, { unique: true }),
        collections.eventAssignments.createIndex({ event_id: 1, status: 1 }),
        collections.committeeWorkItems.createIndex({ id: 1 }, { unique: true }),
        collections.committeeWorkItems.createIndex({ committee: 1, status: 1, due_at: 1 }),
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
        collections.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
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
            console.error(`MongoDB connection attempt ${attempt} failed: ${error.message}`);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }
}

async function vercelHandler(req, res) {
    const missingConfiguration = [];
    if (!process.env.MONGODB_URI?.trim()) missingConfiguration.push("MONGODB_URI");
    if ((process.env.SESSION_SECRET || "").trim().length < 32) missingConfiguration.push("SESSION_SECRET (at least 32 characters)");
    if (missingConfiguration.length) {
        return fail(res, 503, "The API deployment is missing required environment variables.", {
            code: "DEPLOYMENT_CONFIGURATION_MISSING",
            missing_environment_variables: missingConfiguration
        });
    }

    try {
        await ensureDatabaseConnection();
        return app(req, res);
    } catch (error) {
        console.error("Vercel API could not connect to MongoDB:", error.message);
        return fail(res, 503, "The database is temporarily unavailable. Check the MongoDB Atlas network access and API environment settings.", {
            code: "DATABASE_UNAVAILABLE",
            database: "mongodb"
        });
    }
}

const isDirectExecution = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
    start().catch((error) => {
        console.error("The API could not start:", error.message);
        process.exitCode = 1;
    });
}

export default vercelHandler;
