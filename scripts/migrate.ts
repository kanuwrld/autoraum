import { db, closeDb } from "../src/lib/db";
await db.query("SELECT 1 AS ready");
console.log("Database migrations applied.");
await closeDb();
