import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Pool, types as pgTypes } from "pg";
import { schema } from "./schema";

type Param = string | number | null;
export interface Queryable {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: Param[],
  ): Promise<T[]>;
}
type State = {
  pool?: Pool;
  sqlite?: DatabaseSync;
  ready?: Promise<void>;
  queue: Promise<unknown>;
};
const globalDb = globalThis as unknown as { autoraumDb?: State };
const state = (globalDb.autoraumDb ??= { queue: Promise.resolve() });
pgTypes.setTypeParser(20, Number);

async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const work = state.queue.then(fn, fn);
  state.queue = work.then(
    () => undefined,
    () => undefined,
  );
  return work;
}

async function initialize() {
  if (process.env.DATABASE_URL) {
    state.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 20000,
    });
    // Serialize startup DDL across replicas. New numbered migrations belong here.
    const client = await state.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(71923145)");
      await client.query(schema);
      await client.query(
        "INSERT INTO schema_migrations(version,applied_at) VALUES(1,$1),(2,$1),(3,$1),(4,$1),(5,$1) ON CONFLICT DO NOTHING",
        [Date.now()],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } else {
    if (
      process.env.VERCEL ||
      (process.env.NODE_ENV === "production" &&
        process.env.ALLOW_LOCAL_DB !== "1")
    ) {
      throw new Error(
        "DATABASE_URL is required for production. Local standalone servers may opt into persistent SQLite with ALLOW_LOCAL_DB=1.",
      );
    }
    const { DatabaseSync: SQLite } = await import("node:sqlite");
    const path = resolve(
      /* turbopackIgnore: true */ process.env.SQLITE_PATH ||
        ".local/autoraum.sqlite",
    );
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    state.sqlite = new SQLite(path);
    state.sqlite.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
    );
    state.sqlite.exec(schema);
    state.sqlite
      .prepare(
        "INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(1,?),(2,?),(3,?),(4,?),(5,?)",
      )
      .run(Date.now(), Date.now(), Date.now(), Date.now(), Date.now());
  }
}
async function ready() {
  state.ready ??= initialize().catch((error) => {
    state.ready = undefined;
    throw error;
  });
  await state.ready;
}
function sqliteQuery<T>(sql: string, params: Param[] = []): T[] {
  const ordered: Param[] = [];
  const normalized = sql.replace(/\$(\d+)/g, (_, n: string) => {
    ordered.push(params[Number(n) - 1]);
    return "?";
  });
  const statement = state.sqlite!.prepare(normalized);
  if (/^\s*(SELECT|WITH|PRAGMA)/i.test(sql) || /\bRETURNING\b/i.test(sql))
    return statement.all(...ordered).map((row) => ({ ...row })) as T[];
  statement.run(...ordered);
  return [];
}
export const db: Queryable & {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
} = {
  async query<T>(sql: string, params: Param[] = []) {
    await ready();
    if (state.pool) return (await state.pool.query(sql, params)).rows as T[];
    return exclusive(async () => sqliteQuery<T>(sql, params));
  },
  async transaction<T>(fn: (tx: Queryable) => Promise<T>) {
    await ready();
    if (state.pool) {
      const client = await state.pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({
          query: async <R>(sql: string, params: Param[] = []) =>
            (await client.query(sql, params)).rows as R[],
        });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
    return exclusive(async () => {
      state.sqlite!.exec("BEGIN IMMEDIATE");
      try {
        const result = await fn({
          query: async <R>(sql: string, params: Param[] = []) =>
            sqliteQuery<R>(sql, params),
        });
        state.sqlite!.exec("COMMIT");
        return result;
      } catch (error) {
        state.sqlite!.exec("ROLLBACK");
        throw error;
      }
    });
  },
};
export async function closeDb() {
  await state.pool?.end();
  state.sqlite?.close();
  state.pool = undefined;
  state.sqlite = undefined;
  state.ready = undefined;
}
