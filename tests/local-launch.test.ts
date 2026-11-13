import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseEnv } from "node:util";
import {
  acquireStartupLock,
  availablePort,
  configureValue,
  localEnvironment,
} from "../scripts/local";

test("local startup ignores unrelated shell accounts, databases and browser-exposed variables", () => {
  const env = localEnvironment(
    {
      PATH: "/usr/bin",
      APP_URL: "https://unrelated.example.test",
      DATABASE_URL: "postgresql://ignored@example.test/database",
      SQLITE_PATH: "unrelated.sqlite",
      ADMIN_NAME: "SHELL_ONLY",
      ADMIN_EMAIL: "ignored@example.test",
      MOBILE_API_USERNAME: "SHELL_ONLY",
      MOBILE_API_PASSWORD: "SHELL_ONLY",
      DATA_ENCRYPTION_KEY: "SHELL_ONLY",
      CRON_SECRET: "SHELL_ONLY",
      PUBLIC_MARKETPLACE_SEARCH: "0",
      VERCEL: "1",
      VERCEL_ENV: "production",
      NEXT_PUBLIC_PRIVATE_VALUE: "SHELL_ONLY",
    },
    { APP_URL: "http://localhost:3181", PUBLIC_MARKETPLACE_SEARCH: "1" },
  );
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.APP_URL, "http://localhost:3181");
  assert.equal(env.PUBLIC_MARKETPLACE_SEARCH, "1");
  assert.equal(env.NEXT_TELEMETRY_DISABLED, "1");
  assert.equal(env.NODE_ENV, "production");
  for (const key of [
    "DATABASE_URL",
    "SQLITE_PATH",
    "ADMIN_NAME",
    "ADMIN_EMAIL",
    "MOBILE_API_USERNAME",
    "MOBILE_API_PASSWORD",
    "DATA_ENCRYPTION_KEY",
    "CRON_SECRET",
    "VERCEL",
    "VERCEL_ENV",
    "NEXT_PUBLIC_PRIVATE_VALUE",
  ])
    assert.equal(env[key], undefined, key);
});

test("an explicit source change preserves secrets and comments, including export syntax", () => {
  const before =
    "# Private configuration\nDATA_ENCRYPTION_KEY=" +
    "a".repeat(64) +
    "\nexport PUBLIC_MARKETPLACE_SEARCH=0\n";
  const changed = configureValue(before, "PUBLIC_MARKETPLACE_SEARCH", "1");
  assert.equal(parseEnv(changed).PUBLIC_MARKETPLACE_SEARCH, "1");
  assert.equal(parseEnv(changed).DATA_ENCRYPTION_KEY, "a".repeat(64));
  assert.ok(changed.startsWith("# Private configuration\n"));
  assert.equal(changed.split("PUBLIC_MARKETPLACE_SEARCH=").length, 2);
  assert.throws(() =>
    configureValue(before, "APP_URL", "bad\nDATABASE_URL=bad"),
  );
});

test("occupied ports are rejected without stopping the owning server", async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    await assert.rejects(availablePort(port), /occupied/);
    assert.ok(server.listening);
    await assert.rejects(availablePort(Number.NaN), /Port must/);
    await assert.rejects(availablePort(65536), /Port must/);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  assert.equal(await availablePort(port), port);
});

test("startup lock prevents concurrent initialization and recovers an exited process", () => {
  const directory = mkdtempSync(join(tmpdir(), "autoraum-launch-lock-"));
  try {
    const release = acquireStartupLock(directory);
    assert.throws(() => acquireStartupLock(directory), /already running/);
    release();
    const child = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
    writeFileSync(join(directory, "startup.lock"), String(child.pid));
    const nextRelease = acquireStartupLock(directory);
    assert.equal(
      readFileSync(join(directory, "startup.lock"), "utf8"),
      String(process.pid),
    );
    nextRelease();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
