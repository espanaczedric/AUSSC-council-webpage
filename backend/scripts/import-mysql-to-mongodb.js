import "dotenv/config";
import mysql from "mysql2/promise";
import { MongoClient } from "mongodb";

const mongo = new MongoClient(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017");
const sql = await mysql.createConnection({
    host: process.env.MYSQL_HOST || process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.MYSQL_PORT || process.env.DB_PORT || 3306),
    user: process.env.MYSQL_USER || process.env.DB_USER || "root",
    password: process.env.MYSQL_PASSWORD ?? process.env.DB_PASSWORD ?? "",
    database: process.env.MYSQL_DATABASE || process.env.DB_NAME || "university_events",
    dateStrings: true,
    charset: "utf8mb4"
});
const database = (process.env.MONGODB_DATABASE || "university_events");

function convertDate(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    const source = String(value).replace(" ", "T");
    return new Date(source.length === 16 ? `${source}:00+08:00` : `${source}+08:00`);
}

function convertRows(rows, fields = []) {
    return rows.map((source) => {
        const row = { ...source };
        for (const field of fields) row[field] = convertDate(row[field]);
        return row;
    });
}

async function copyTable(table, collection, dateFields = [], transform = (row) => row) {
    const [rows] = await sql.query(`SELECT * FROM \`${table}\``);
    const documents = convertRows(rows, dateFields).map(transform);
    if (documents.length) {
        await collection.bulkWrite(documents.map((document) => ({
            replaceOne: { filter: { id: document.id }, replacement: document, upsert: true }
        })), { ordered: false });
    }
    console.log(`${table}: copied ${documents.length} records`);
    return documents;
}

try {
    await mongo.connect();
    const db = mongo.db(database);
    const users = db.collection("users");
    const events = db.collection("events");
    const registrations = db.collection("registrations");
    const attendance = db.collection("attendance");
    const highlights = db.collection("event_highlights");
    const schedules = db.collection("event_schedules");

    await Promise.all([
        users.createIndex({ id: 1 }, { unique: true }), users.createIndex({ email: 1 }, { unique: true }), users.createIndex({ student_id: 1 }, { unique: true }),
        events.createIndex({ id: 1 }, { unique: true }), registrations.createIndex({ id: 1 }, { unique: true }),
        registrations.createIndex({ user_id: 1, event_id: 1 }, { unique: true }), registrations.createIndex({ registration_code: 1 }, { unique: true }),
        attendance.createIndex({ id: 1 }, { unique: true }), highlights.createIndex({ id: 1 }, { unique: true }), schedules.createIndex({ id: 1 }, { unique: true })
    ]);

    await copyTable("users", users, ["created_at"], (row) => {
        const { password, ...user } = row;
        return { ...user, email: String(user.email).toLowerCase(), passwordHash: password };
    });
    const eventRows = await copyTable("events", events, ["start_date", "end_date", "registration_deadline", "created_at"], (row) => ({ ...row, registration_count: 0 }));
    const registrationRows = await copyTable("registrations", registrations, ["registered_at"]);
    await copyTable("attendance", attendance, ["time_in", "time_out"]);
    await copyTable("event_highlights", highlights, ["created_at"]);
    await copyTable("event_schedules", schedules);

    const counts = new Map();
    for (const registration of registrationRows) {
        if (registration.status !== "cancelled") counts.set(registration.event_id, (counts.get(registration.event_id) || 0) + 1);
    }
    await Promise.all(eventRows.map((event) => events.updateOne({ id: event.id }, { $set: { registration_count: counts.get(event.id) || 0 } })));

    const maxima = {
        users: Math.max(0, ...await users.distinct("id")),
        events: Math.max(0, ...await events.distinct("id")),
        registrations: Math.max(0, ...await registrations.distinct("id")),
        attendance: Math.max(0, ...await attendance.distinct("id")),
        event_highlights: Math.max(0, ...await highlights.distinct("id")),
        event_schedules: Math.max(0, ...await schedules.distinct("id"))
    };
    for (const [name, value] of Object.entries(maxima)) {
        await db.collection("counters").updateOne({ _id: name }, { $max: { value } }, { upsert: true });
    }
    console.log(`Import complete. Existing MongoDB documents without matching SQL IDs were left intact. Target: ${database}`);
} finally {
    await sql.end().catch(() => {});
    await mongo.close().catch(() => {});
}
