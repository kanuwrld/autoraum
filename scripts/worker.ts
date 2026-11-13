import { tickScheduler } from "../src/lib/search";
import { closeDb } from "../src/lib/db";
import { scheduledBackup } from "./backup";

let stopping = false;
let nextBackupAttempt = 0;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
console.log("Autoraum worker started. Checking due searches every 60 seconds.");
while (!stopping) {
  const started = Date.now();
  try {
    const result = await tickScheduler();
    if (result.processed || result.failed)
      console.log(
        JSON.stringify({ time: new Date().toISOString(), ...result }),
      );
  } catch (error) {
    console.error(
      "Scheduler tick failed:",
      error instanceof Error ? error.name : "Unknown error",
    );
  }
  if (!stopping && Date.now() >= nextBackupAttempt) {
    nextBackupAttempt = Date.now() + 3600_000;
    try {
      const result = await scheduledBackup();
      if (!result.skipped)
        console.log("Local backup created and restoration verified.");
    } catch {
      console.error(
        "Local backup failed; check Betrieb & Sicherung. Retrying in one hour.",
      );
    }
  }
  if (process.argv.includes("--once")) break;
  const remaining = Math.max(1000, 60_000 - (Date.now() - started));
  for (let elapsed = 0; elapsed < remaining && !stopping; elapsed += 1000)
    await new Promise((resolve) => setTimeout(resolve, 1000));
}
await closeDb();
