import { spawn } from "node:child_process";
import process from "node:process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const services = [
    { label: "API", cwd: new URL("../backend/", import.meta.url) },
    { label: "WEB", cwd: new URL("../frontend/", import.meta.url) }
];
const children = services.map(({ label, cwd }) => {
    console.log(`[${label}] starting npm run dev`);
    const child = spawn(npm, ["run", "dev"], { cwd, stdio: "inherit", shell: process.platform === "win32" });
    child.on("exit", (code) => {
        if (code && !process.killed) stopAll(code);
    });
    return child;
});

let stopping = false;
function stopAll(code = 0) {
    if (stopping) return;
    stopping = true;
    for (const child of children) if (!child.killed) child.kill("SIGTERM");
    process.exitCode = code;
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));
