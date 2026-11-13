import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { parseEnv } from "node:util";
import { pathToFileURL } from "node:url";

// Built-ins only: this command runs before dependencies are installed.
const appKeys = new Set([
  "APP_URL",
  "DATABASE_URL",
  "SQLITE_PATH",
  "ALLOW_LOCAL_DB",
  "PUBLIC_MARKETPLACE_SEARCH",
  "MOBILE_API_USERNAME",
  "MOBILE_API_PASSWORD",
  "DATA_ENCRYPTION_KEY",
  "CRON_SECRET",
  "ADMIN_EMAIL",
  "ADMIN_NAME",
  "NODE_ENV",
  "NODE_OPTIONS",
]);

export function localEnvironment(
  inherited: Record<string, string | undefined>,
  configured: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const env = { ...inherited };
  for (const key of Object.keys(env)) {
    if (
      appKeys.has(key) ||
      key.startsWith("NEXT_PUBLIC_") ||
      key.startsWith("VERCEL")
    )
      delete env[key];
  }
  return {
    ...env,
    ...configured,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
  };
}

export function configureValue(text: string, key: string, value: string) {
  if (!/^[A-Z_]+$/.test(key) || /[\r\n'\x00]/.test(value))
    throw new Error("Invalid local configuration");
  const assignment = key + "='" + value + "'";
  const pattern = new RegExp("^(?:export\\s+)?" + key + "\\s*=.*$", "m");
  return pattern.test(text)
    ? text.replace(pattern, () => assignment)
    : text + (text && !text.endsWith("\n") ? "\n" : "") + assignment + "\n";
}

export async function availablePort(preferred?: number) {
  if (
    preferred !== undefined &&
    (!Number.isInteger(preferred) || preferred < 1024 || preferred > 65535)
  )
    throw new Error("Port must be an integer between 1024 and 65535");
  const ports =
    preferred === undefined
      ? Array.from({ length: 21 }, (_, i) => 3000 + i)
      : [preferred];
  for (const port of ports) {
    const free = await new Promise<boolean>((resolve, reject) => {
      const server = createServer();
      server.once("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE") resolve(false);
        else
          reject(
            new Error("Cannot bind a local port; check network permissions"),
          );
      });
      server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error(
    "Local port is occupied. Choose another with --port NUMBER; no existing process was stopped.",
  );
}

export function acquireStartupLock(directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const path = join(directory, "startup.lock");
  if (existsSync(path)) {
    const pid = Number(readFileSync(path, "utf8"));
    if (!Number.isInteger(pid) || pid < 2)
      throw new Error(
        "Invalid .local/startup.lock; inspect it before retrying",
      );
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH")
        throw new Error("Another startup may be running");
      unlinkSync(path);
    }
    if (existsSync(path))
      throw new Error(
        "Another startup is already running; wait for it to finish",
      );
  }
  writeFileSync(path, String(process.pid), { flag: "wx", mode: 0o600 });
  return () => {
    if (existsSync(path) && readFileSync(path, "utf8") === String(process.pid))
      unlinkSync(path);
  };
}

function contentHash(root: string, entries: string[]) {
  const hash = createHash("sha256").update(
    process.versions.node + ":" + process.platform + ":" + process.arch,
  );
  function add(name: string) {
    const full = join(root, name);
    if (existsSync(full)) hash.update(name).update(readFileSync(full));
  }
  function visit(name: string) {
    for (const entry of readdirSync(join(root, name), {
      withFileTypes: true,
    }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(name, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) add(path);
    }
  }
  for (const entry of entries) {
    if (entry.endsWith("/")) visit(entry);
    else add(entry);
  }
  return hash.digest("hex");
}

export async function launch(root: string, args: string[]) {
  if (args.includes("--help")) {
    console.log(
      "Usage: npm run local -- [--port NUMBER] [--enable-public-search]\nInstalls dependencies, sets up private local data, builds and starts web + worker.\nNode.js 24+, macOS/Linux (Windows: WSL2). Existing data and explicit source opt-outs are preserved.",
    );
    return;
  }
  if (Number(process.versions.node.split(".")[0]) < 24)
    throw new Error("Install Node.js 24 or newer, then retry");
  if (process.platform === "win32")
    throw new Error("Run this command inside WSL2 on Windows");
  let port: number | undefined;
  let enableSources = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) port = Number(args[++i]);
    else if (args[i] === "--enable-public-search") enableSources = true;
    else throw new Error("Unknown option; run npm run local -- --help");
  }
  if (
    port !== undefined &&
    (!Number.isInteger(port) || port < 1024 || port > 65535)
  )
    throw new Error("Port must be an integer between 1024 and 65535");
  const release = acquireStartupLock(join(root, ".local"));
  try {
    const envPath = join(root, ".env.local");
    let envText = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
    let configured = parseEnv(envText);
    if (configured.DATABASE_URL)
      throw new Error(
        "The one-command launcher is for local SQLite. Use the documented server commands for PostgreSQL.",
      );
    let origin: URL;
    if (configured.APP_URL) {
      origin = new URL(configured.APP_URL);
      if (port !== undefined && port !== Number(origin.port || "80"))
        throw new Error(
          "This installation already has an APP_URL. Change it in .env.local to move ports.",
        );
    } else origin = new URL("http://localhost:" + (await availablePort(port)));
    if (
      origin.protocol !== "http:" ||
      !["localhost", "127.0.0.1"].includes(origin.hostname) ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash
    )
      throw new Error(
        "Local startup requires an http://localhost or http://127.0.0.1 APP_URL with no path",
      );
    if (enableSources && existsSync(envPath)) {
      envText = configureValue(envText, "PUBLIC_MARKETPLACE_SEARCH", "1");
      const temp = envPath + "." + process.pid + ".tmp";
      writeFileSync(temp, envText, { mode: 0o600, flag: "wx" });
      renameSync(temp, envPath);
      configured = parseEnv(envText);
    }
    let env = localEnvironment(process.env, {
      ...configured,
      APP_URL: origin.origin,
    });
    const run = (command: string, argv: string[]) => {
      const result = spawnSync(command, argv, {
        cwd: root,
        env,
        stdio: "inherit",
      });
      if (result.error || result.status !== 0)
        throw new Error(
          "Failed: " +
            (command === process.execPath ? "node" : command) +
            " " +
            argv.join(" ") +
            ". Fix the error above and retry; your database is preserved.",
        );
    };
    const service = (action: string) =>
      run(process.execPath, [
        "--env-file=.env.local",
        "--import",
        "tsx",
        "scripts/local-service.ts",
        action,
      ]);
    const statePath = join(root, ".local/launcher.json");
    let state: { install?: string; build?: string } = {};
    if (existsSync(statePath)) {
      try {
        const saved: unknown = JSON.parse(readFileSync(statePath, "utf8"));
        if (saved && typeof saved === "object") {
          if ("install" in saved && typeof saved.install === "string")
            state.install = saved.install;
          if ("build" in saved && typeof saved.build === "string")
            state.build = saved.build;
        }
      } catch {
        /* Rebuild after an interrupted state write. */
      }
    }
    const install = contentHash(root, ["package-lock.json", "package.json"]);
    const dependenciesReady =
      existsSync(join(root, "node_modules/next/package.json")) &&
      existsSync(join(root, "node_modules/tsx/package.json"));
    if (!dependenciesReady || state.install !== install) {
      if (dependenciesReady && existsSync(envPath)) service("stop");
      console.log("Installing locked dependencies...");
      run("npm", ["ci", "--include=dev", "--no-fund", "--no-audit"]);
      state = { install };
      writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 });
    }
    run("npm", ["run", "setup"]);
    env = localEnvironment(
      process.env,
      parseEnv(readFileSync(envPath, "utf8")),
    );
    const build = contentHash(root, [
      "src/",
      "public/",
      "scripts/",
      "next.config.ts",
      "tsconfig.json",
      "postcss.config.mjs",
      "package-lock.json",
      "package.json",
      ".env.local",
    ]);
    if (state.build !== build || !existsSync(join(root, ".next/BUILD_ID"))) {
      service("stop");
      console.log("Building Autoraum...");
      run("npm", ["run", "build"]);
      writeFileSync(statePath, JSON.stringify({ install, build }), {
        mode: 0o600,
      });
    }
    service("start");
    console.log(
      [
        "\nReady: " + origin.origin,
        "Private login details: " + join(root, ".local/access.txt"),
        "Public search: " +
          (env.PUBLIC_MARKETPLACE_SEARCH === "1"
            ? "enabled — seven account-free adapters"
            : "disabled by this installation") +
          ".",
        "Your database and keys stay in this installation. Marketplace requests use your own network.",
        "Stop: npm run local:service -- stop",
      ].join("\n"),
    );
  } finally {
    release();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  launch(resolve(import.meta.dirname, ".."), process.argv.slice(2)).catch(
    (error: unknown) => {
      console.error(
        error instanceof Error ? error.message : "Local startup failed",
      );
      if ((error as NodeJS.ErrnoException)?.code === "ENOSPC")
        console.error(
          "Free disk space, then retry. Existing data has not been removed.",
        );
      process.exitCode = 1;
    },
  );
}
