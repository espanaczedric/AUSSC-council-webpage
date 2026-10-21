import "dotenv/config";
import bcrypt from "bcryptjs";
import { MongoClient } from "mongodb";

const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD || "";
const studentId = (process.env.ADMIN_STUDENT_ID || "ADMIN-001").trim();
const firstName = (process.env.ADMIN_FIRST_NAME || "Council").trim();
const lastName = (process.env.ADMIN_LAST_NAME || "Administrator").trim();

if (!email || !password) {
    console.error("Set ADMIN_EMAIL and ADMIN_PASSWORD in backend/.env before creating the admin account.");
    process.exit(1);
}
if (password.length < 12) {
    console.error("Use an admin password with at least 12 characters.");
    process.exit(1);
}

const client = new MongoClient(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017");
try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DATABASE || "university_events");
    const users = db.collection("users");
    await Promise.all([
        users.createIndex({ id: 1 }, { unique: true }),
        users.createIndex({ email: 1 }, { unique: true }),
        users.createIndex({ student_id: 1 }, { unique: true })
    ]);
    const existing = await users.findOne({ $or: [{ email }, { student_id: studentId }] });
    if (existing && (existing.email !== email || existing.student_id !== studentId)) {
        throw new Error("The email and student ID are already assigned to different accounts.");
    }
    const passwordHash = await bcrypt.hash(password, 12);
    if (existing) {
        await users.updateOne({ id: existing.id }, { $set: { first_name: firstName, last_name: lastName, email, student_id: studentId, role: "admin", passwordHash } });
    } else {
        const counter = await db.collection("counters").findOneAndUpdate(
            { _id: "users" }, { $inc: { value: 1 } }, { upsert: true, returnDocument: "after" }
        );
        const counterDocument = counter?.value && typeof counter.value === "object" ? counter.value : counter;
        await users.insertOne({
            id: counterDocument.value,
            student_id: studentId,
            first_name: firstName,
            last_name: lastName,
            email,
            passwordHash,
            course: "Administration",
            year_level: "N/A",
            role: "admin",
            created_at: new Date()
        });
    }
    console.log(`Admin account ready for ${email}.`);
} catch (error) {
    console.error(`Could not create admin account: ${error.message}`);
    process.exitCode = 1;
} finally {
    await client.close();
}
