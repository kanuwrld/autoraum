import { randomUUID } from "node:crypto";
import { db, closeDb } from "../src/lib/db";
import { hashPassword } from "../src/lib/security";
if (!process.env.SQLITE_PATH?.includes("test-results/"))
  throw new Error("E2E seed requires an isolated test-results database");
const password = await hashPassword("E2E-only-password-12345");
await db.query(
  "INSERT INTO users(id,email,name,role,password_hash,created_at) VALUES($1,'admin@example.test','TEST Administrator','platform_admin',$2,$3)",
  [randomUUID(), password, Date.now()],
);
await closeDb();
