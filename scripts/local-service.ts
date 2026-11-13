import { randomUUID } from "node:crypto";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const script = join(root, "scripts/local-service.ts");
const statePath = join(root, ".local/supervisor.json");
const lockPath = join(root, ".local/supervisor.lock");
const runtimePath = join(root, ".local/runtime.json");
const roles = ["server", "worker"] as const;
type Role = (typeof roles)[number];
type State = {
  pid: number;
  token: string;
  startedAt: number;
  stopping: boolean;
  server: number | null;
  worker: number | null;
};
const sleep = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const command = process.argv[2] || "status";
const origin = new URL(process.env.APP_URL || "http://localhost:3000");
const port = Number(origin.port || "80");
function readState(): State | null {
  try {
    return JSON.parse(readFileSync(statePath, "utf8")) as State;
  } catch {
    return null;
  }
}
function isSupervisor(state: State | null): state is State {
  if (
    !state ||
    !Number.isInteger(state.pid) ||
    state.pid < 2 ||
    !/^[a-f0-9-]{36}$/.test(state.token)
  )
    return false;
  try {
    const args = execFileSync(
      "ps",
      ["-p", String(state.pid), "-o", "command="],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return args.includes(script) && args.includes(`_run ${state.token}`);
  } catch {
    return false;
  }
}
function currentStatus() {
  const state = readState();
  return isSupervisor(state)
    ? { ...state, running: true, url: origin.origin }
    : { running: false, url: origin.origin };
}
function saveState(state: State) {
  const temp = `${statePath}.${state.token}.tmp`;
  writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
  renameSync(temp, statePath);
  writeFileSync(
    runtimePath,
    JSON.stringify({ server: state.server, worker: state.worker }),
    { mode: 0o600 },
  );
}
async function stopSupervisor() {
  const state = readState();
  if (!isSupervisor(state)) return;
  process.kill(state.pid, "SIGTERM");
  for (let attempt = 0; attempt < 140; attempt++) {
    if (!isSupervisor(state)) return;
    await sleep(250);
  }
  throw new Error("Supervisor did not stop; inspect .local/supervisor.log");
}
async function startSupervisor() {
  if (isSupervisor(readState())) return;
  if (
    !["localhost", "127.0.0.1"].includes(origin.hostname) ||
    origin.protocol !== "http:"
  )
    throw new Error(
      "Local services require an http://localhost or http://127.0.0.1 APP_URL",
    );
  if (!existsSync(join(root, ".next/BUILD_ID")))
    throw new Error("Run npm run build first");
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", () =>
      reject(
        new Error(
          "Local port is occupied. Stop the existing project processes first.",
        ),
      ),
    );
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve()));
  });
  mkdirSync(join(root, ".local"), { recursive: true, mode: 0o700 });
  const log = openSync(join(root, ".local/supervisor.log"), "a", 0o600);
  const child = spawn(
    process.execPath,
    ["--env-file=.env.local", "--import", "tsx", script, "_run", randomUUID()],
    {
      cwd: root,
      detached: true,
      stdio: ["ignore", log, log],
    },
  );
  child.unref();
  closeSync(log);
  let spawnError: Error | null = null;
  child.on("error", (error) => {
    spawnError = error;
  });
  for (let attempt = 0; attempt < 60; attempt++) {
    if (spawnError) throw spawnError;
    const state = readState();
    if (isSupervisor(state) && state.server && state.worker) {
      try {
        const response = await fetch(`${origin.origin}/api/health`, {
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok && (await response.json()).ok) return;
      } catch {
        /* Startup is bounded; errors remain in the local logs. */
      }
    }
    await sleep(250);
  }
  await stopSupervisor();
  throw new Error(
    "Services did not become healthy; inspect .local/server.log and .local/worker.log",
  );
}
async function supervise() {
  const token = process.argv[3];
  if (!token || !/^[a-f0-9-]{36}$/.test(token))
    throw new Error("Invalid supervisor token");
  if (existsSync(lockPath)) {
    const current = readState();
    if (isSupervisor(current)) throw new Error("Supervisor already running");
    const lock = JSON.parse(readFileSync(lockPath, "utf8")) as State;
    if (isSupervisor(lock)) throw new Error("Supervisor is starting");
    unlinkSync(lockPath);
  }
  const state: State = {
    pid: process.pid,
    token,
    startedAt: Date.now(),
    stopping: false,
    server: null,
    worker: null,
  };
  writeFileSync(lockPath, JSON.stringify(state), { flag: "wx", mode: 0o600 });
  const children: Partial<Record<Role, ChildProcess>> = {};
  const timers: Partial<Record<Role, ReturnType<typeof setTimeout>>> = {};
  const failures: Record<Role, number> = { server: 0, worker: 0 };
  let forceStop: ReturnType<typeof setTimeout> | undefined;
  const finish = () => {
    if (
      !state.stopping ||
      Object.values(children).some(
        (child) =>
          child && child.exitCode === null && child.signalCode === null,
      )
    )
      return;
    if (forceStop) clearTimeout(forceStop);
    saveState(state);
    unlinkSync(lockPath);
    process.exit(0);
  };
  const launch = (role: Role) => {
    if (state.stopping) return;
    const started = Date.now();
    const log = openSync(join(root, `.local/${role}.log`), "a", 0o600);
    const args =
      role === "server"
        ? [
            "--env-file=.env.local",
            join(root, "node_modules/next/dist/bin/next"),
            "start",
            "--hostname",
            "127.0.0.1",
            "--port",
            String(port),
          ]
        : [
            "--env-file=.env.local",
            "--import",
            "tsx",
            join(root, "scripts/worker.ts"),
          ];
    const child = spawn(process.execPath, args, {
      cwd: root,
      stdio: ["ignore", log, log],
    });
    closeSync(log);
    children[role] = child;
    state[role] = child.pid || null;
    saveState(state);
    child.on("error", (error) =>
      console.error(`${role} spawn failed: ${error.name}`),
    );
    child.on("close", () => {
      delete children[role];
      state[role] = null;
      saveState(state);
      if (state.stopping) return finish();
      failures[role] = Date.now() - started > 60000 ? 0 : failures[role] + 1;
      const delay = Math.min(30000, 1000 * 2 ** Math.min(failures[role], 5));
      console.log(
        `${new Date().toISOString()} ${role} stopped; restarting in ${delay}ms`,
      );
      timers[role] = setTimeout(() => launch(role), delay);
    });
  };
  const stop = () => {
    if (state.stopping) return;
    state.stopping = true;
    saveState(state);
    for (const timer of Object.values(timers)) clearTimeout(timer);
    for (const child of Object.values(children)) child?.kill("SIGTERM");
    forceStop = setTimeout(() => {
      for (const child of Object.values(children)) child?.kill("SIGKILL");
    }, 30000);
    finish();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  saveState(state);
  roles.forEach(launch);
}

try {
  if (command === "--help")
    console.log(
      "Usage: npm run local:service -- start|restart|status|stop\nLocal supervisor restarts web/worker on macOS and Linux. After a reboot, run start again.",
    );
  else if (command === "_run") await supervise();
  else {
    if (!["start", "restart", "status", "stop"].includes(command))
      throw new Error("Unknown command; use --help");
    if (command === "stop" || command === "restart") await stopSupervisor();
    if (command === "start" || command === "restart") await startSupervisor();
    console.log(JSON.stringify(currentStatus(), null, 2));
  }
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Local supervisor failed",
  );
  process.exitCode = 1;
}
