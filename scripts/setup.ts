import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { parseEnv } from "node:util";
import { db, closeDb } from "../src/lib/db";
import { hashPassword } from "../src/lib/security";

const envFile = resolve(".env.local");
const envExists = existsSync(envFile);
let envText = envExists ? readFileSync(envFile, "utf8") : "";
const fileValues = parseEnv(envText);
for (const [key, value] of Object.entries(fileValues)) {
  if (process.env[key] === undefined) process.env[key] = value;
}
const defaults = {
  APP_URL: "http://localhost:3000",
  DATABASE_URL: "",
  SQLITE_PATH: ".local/autoraum.sqlite",
  ALLOW_LOCAL_DB: "1",
  PUBLIC_MARKETPLACE_SEARCH: "0",
  NEXT_TELEMETRY_DISABLED: "1",
  DATA_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  CRON_SECRET: randomBytes(32).toString("hex"),
};
for (const [key, fallback] of Object.entries(defaults)) {
  const value = process.env[key] || fallback;
  process.env[key] = value;
  // Complete copied templates without rotating existing keys or rewriting comments.
  if (!fileValues[key] && value) {
    if (/[\r\n'\x00]/.test(value))
      throw new Error(`Invalid ${key}; use a single-line environment value`);
    const assignment = `${key}='${value}'`;
    const line = new RegExp(`^(?:export\\s+)?${key}\\s*=.*$`, "m");
    envText = line.test(envText)
      ? envText.replace(line, () => assignment)
      : `${envText}${envText && !envText.endsWith("\n") ? "\n" : ""}${assignment}\n`;
  }
}
if (!/^[a-f0-9]{64}$/i.test(process.env.DATA_ENCRYPTION_KEY || ""))
  throw new Error("DATA_ENCRYPTION_KEY must contain 64 hexadecimal characters");
if ((process.env.CRON_SECRET || "").length < 32)
  throw new Error("CRON_SECRET must contain at least 32 characters");
mkdirSync(".local", { recursive: true, mode: 0o700 });
chmodSync(".local", 0o700);
writeFileSync(envFile, envText, { mode: 0o600, flag: envExists ? "w" : "wx" });
chmodSync(envFile, 0o600);
const existing = await db.query(
  "SELECT id FROM users WHERE role='platform_admin' LIMIT 1",
);
if (existing.length) {
  console.log(
    "Setup already complete. Existing accounts and passwords were preserved.",
  );
  await closeDb();
  process.exit(0);
}
const adminEmail = process.env.ADMIN_EMAIL || "admin@autoraum.local";
const adminName = process.env.ADMIN_NAME || "Administrator";
const adminPassword = randomBytes(18).toString("base64url");
const workspacePassword = randomBytes(18).toString("base64url");
const adminHash = await hashPassword(adminPassword);
const workspaceHash = await hashPassword(workspacePassword);
await db.transaction(async (tx) => {
  const tenantId = randomUUID();
  await tx.query(
    "INSERT INTO users(id,email,name,role,password_hash,created_at) VALUES($1,$2,$3,'platform_admin',$4,$5)",
    [randomUUID(), adminEmail, adminName, adminHash, Date.now()],
  );
  // An empty operator workspace, not a fictional customer or seeded inventory.
  await tx.query(
    "INSERT INTO tenants(id,name,slug,created_at) VALUES($1,'Mein Arbeitsbereich','mein-arbeitsbereich',$2)",
    [tenantId, Date.now()],
  );
  await tx.query(
    "INSERT INTO users(id,tenant_id,email,name,role,password_hash,created_at) VALUES($1,$2,'workspace@autoraum.local',$3,'owner',$4,$5)",
    [randomUUID(), tenantId, adminName, workspaceHash, Date.now()],
  );
});
mkdirSync(".local", { recursive: true, mode: 0o700 });
const access = `AUTORAUM — PRIVATE LOCAL ACCESS\n\nURL: ${process.env.APP_URL || "http://localhost:3000"}\n\nPLATFORM ADMIN\nEmail: ${adminEmail}\nPassword: ${adminPassword}\n\nWORKSPACE OWNER\nURL: ${process.env.APP_URL || "http://localhost:3000"}/w/mein-arbeitsbereich\nEmail: workspace@autoraum.local\nPassword: ${workspacePassword}\n\nPasswords are random. Change them in Mein Zugang / Team & Zugang after signing in.\nKeep this file private. It is excluded from Git. Never share it with customers.\nNo sample vehicles or customer data have been added to the database.\n`;
const accessPath = existsSync(".local/access.txt")
  ? `.local/access-${randomBytes(6).toString("hex")}.txt`
  : ".local/access.txt";
writeFileSync(accessPath, access, { mode: 0o600, flag: "wx" });
console.log(
  `Setup complete. Private login details: ${accessPath}. No listing data was seeded.`,
);
await closeDb();
