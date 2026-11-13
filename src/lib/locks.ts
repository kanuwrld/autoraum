import { randomUUID } from "node:crypto";
import { db } from "./db";

export async function acquireLock(id: string, ttlMs: number) {
  const token = randomUUID();
  const rows = await db.query(
    "INSERT INTO job_locks(id,token,expires_at) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET token=$2,expires_at=$3 WHERE job_locks.expires_at<=$4 RETURNING id",
    [id, token, Date.now() + ttlMs, Date.now()],
  );
  return rows.length ? token : null;
}

export async function releaseLock(id: string, token: string) {
  await db.query("DELETE FROM job_locks WHERE id=$1 AND token=$2", [id, token]);
}
