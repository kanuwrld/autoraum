import { db } from "./db";

export type OperationsStatus = Awaited<ReturnType<typeof getOperationsStatus>>;
export async function getOperationsStatus() {
  const [values, runs, active] = await Promise.all([
    db.query<{ key: string; value: string }>(
      "SELECT key,value FROM system_state WHERE key IN ('scheduler_heartbeat','backup_last_success','backup_last_error','backup_restore_verified')",
    ),
    db.query<{ status: string; count: number }>(
      "SELECT status,COUNT(*) AS count FROM search_runs WHERE started_at>$1 GROUP BY status",
      [Date.now() - 86400_000],
    ),
    db.query<{ count: number }>(
      "SELECT COUNT(*) AS count FROM searches s JOIN tenants t ON t.id=s.tenant_id WHERE s.enabled=1 AND t.active=1",
    ),
  ]);
  const state = Object.fromEntries(
    values.map((row) => [row.key, Number(row.value)]),
  );
  const now = Date.now();
  const local = !process.env.DATABASE_URL;
  const heartbeat = state.scheduler_heartbeat || null;
  const backup = state.backup_last_success || null;
  return {
    checkedAt: now,
    database: local ? "SQLite" : "PostgreSQL",
    worker: {
      heartbeat,
      healthy: !!heartbeat && now - heartbeat < 180_000,
      activeSearches: Number(active[0].count),
    },
    backup: {
      local,
      lastSuccess: backup,
      lastError: state.backup_last_error || null,
      restoreVerifiedAt: state.backup_restore_verified || null,
      healthy:
        local &&
        !!backup &&
        now - backup < 26 * 3600_000 &&
        (!state.backup_last_error || state.backup_last_error < backup),
    },
    runs: runs.map((row) => ({ status: row.status, count: Number(row.count) })),
  };
}

export async function recordOperation(key: string, time = Date.now()) {
  await db.query(
    "INSERT INTO system_state(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2",
    [key, String(time)],
  );
}
