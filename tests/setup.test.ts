import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { parseEnv } from "node:util";
import { verifyPassword } from "../src/lib/security";

const root = resolve(import.meta.dirname, "..");
const setup = (directory: string) => {
  const env = { ...process.env };
  for (const key of [
    "APP_URL",
    "DATABASE_URL",
    "SQLITE_PATH",
    "ALLOW_LOCAL_DB",
    "PUBLIC_MARKETPLACE_SEARCH",
    "NEXT_TELEMETRY_DISABLED",
    "DATA_ENCRYPTION_KEY",
    "CRON_SECRET",
    "ADMIN_NAME",
    "ADMIN_EMAIL",
    "VERCEL",
  ])
    delete env[key];
  return execFileSync(
    process.execPath,
    [
      join(root, "node_modules/tsx/dist/cli.mjs"),
      join(root, "scripts/setup.ts"),
    ],
    {
      cwd: directory,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
};

test("fresh setup creates private unique credentials and an empty workspace; reruns preserve access", async () => {
  const directory = mkdtempSync(join(tmpdir(), "autoraum-setup-test-"));
  try {
    const output = setup(directory);
    const envPath = join(directory, ".env.local");
    const envText = readFileSync(envPath, "utf8");
    const env = parseEnv(envText);
    assert.match(env.DATA_ENCRYPTION_KEY || "", /^[a-f0-9]{64}$/);
    assert.match(env.CRON_SECRET || "", /^[a-f0-9]{64}$/);
    assert.notEqual(env.DATA_ENCRYPTION_KEY, env.CRON_SECRET);
    assert.equal(env.PUBLIC_MARKETPLACE_SEARCH, "0");
    assert.equal(env.NEXT_TELEMETRY_DISABLED, "1");
    assert.equal(statSync(envPath).mode & 0o777, 0o600);
    assert.equal(statSync(join(directory, ".local")).mode & 0o777, 0o700);
    const accessPath = join(directory, ".local/access.txt");
    const access = readFileSync(accessPath, "utf8");
    const passwords = [...access.matchAll(/^Password: (.+)$/gm)].map(
      (m) => m[1],
    );
    assert.equal(passwords.length, 2);
    assert.notEqual(passwords[0], passwords[1]);
    assert.ok(
      passwords.every(
        (password) => password.length >= 24 && !output.includes(password),
      ),
    );
    assert.equal(statSync(accessPath).mode & 0o777, 0o600);
    assert.ok(env.SQLITE_PATH);
    const db = new DatabaseSync(join(directory, env.SQLITE_PATH));
    try {
      assert.equal(
        db.prepare("SELECT COUNT(*) AS n FROM listings").get()?.n,
        0,
      );
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users").get()?.n, 2);
      const admin = db
        .prepare(
          "SELECT name,password_hash FROM users WHERE role='platform_admin'",
        )
        .get();
      assert.equal(admin?.name, "Administrator");
      assert.ok(
        await verifyPassword(passwords[0], String(admin?.password_hash)),
      );
      assert.match(setup(directory), /already complete/);
      assert.equal(readFileSync(envPath, "utf8"), envText);
      assert.equal(readFileSync(accessPath, "utf8"), access);
      assert.equal(
        readdirSync(join(directory, ".local")).filter((f) =>
          f.startsWith("access"),
        ).length,
        1,
      );
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users").get()?.n, 2);
    } finally {
      db.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("setup completes a copied environment template while preserving operator settings", () => {
  const directory = mkdtempSync(join(tmpdir(), "autoraum-setup-template-"));
  try {
    const template = readFileSync(join(root, ".env.example"), "utf8")
      .replace("APP_URL=http://localhost:3000", "APP_URL=http://localhost:3987")
      .replace("PUBLIC_MARKETPLACE_SEARCH=0", "PUBLIC_MARKETPLACE_SEARCH=1")
      .replace("DATA_ENCRYPTION_KEY=", `DATA_ENCRYPTION_KEY=${"a".repeat(64)}`);
    writeFileSync(join(directory, ".env.local"), template);
    setup(directory);
    const env = parseEnv(readFileSync(join(directory, ".env.local"), "utf8"));
    assert.equal(env.APP_URL, "http://localhost:3987");
    assert.equal(env.PUBLIC_MARKETPLACE_SEARCH, "1");
    assert.equal(env.DATA_ENCRYPTION_KEY, "a".repeat(64));
    assert.match(env.CRON_SECRET || "", /^[a-f0-9]{64}$/);
    assert.equal(
      readFileSync(join(directory, ".env.local"), "utf8").split("CRON_SECRET=")
        .length,
      2,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
