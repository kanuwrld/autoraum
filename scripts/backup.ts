import { resolve } from "node:path";
import { closeDb, db } from "../src/lib/db";
import {
  createLocalBackup,
  pruneLocalBackups,
  restoreLocalBackup,
  verifyBackupRestore,
  writeBackupReceipt,
} from "../src/lib/local-backup";
import { recordOperation } from "../src/lib/operations";

export async function scheduledBackup(force = false) {
  if (process.env.DATABASE_URL)
    return {
      skipped: true,
      reason: "PostgreSQL requires its own backup configuration",
    };
  const [last] = await db.query<{ value: string }>(
    "SELECT value FROM system_state WHERE key='backup_last_success'",
  );
  if (!force && last && Date.now() - Number(last.value) < 24 * 3600_000)
    return { skipped: true };
  const directory = resolve(".local/backups/automatic");
  try {
    const result = await createLocalBackup(
      process.env.SQLITE_PATH || ".local/autoraum.sqlite",
      directory,
    );
    await verifyBackupRestore(result.path);
    const verifiedAt = Date.now();
    await writeBackupReceipt(resolve(".local/backups/latest-verified.json"), {
      backup: result.path,
      createdAt: result.manifest.createdAt,
      verifiedAt,
      tableCounts: result.manifest.tableCounts,
      schemaVersions: result.manifest.schemaVersions,
    });
    await recordOperation("backup_last_success", verifiedAt);
    await recordOperation("backup_restore_verified", verifiedAt);
    await pruneLocalBackups(directory);
    return { skipped: false, backup: result.path, verifiedAt };
  } catch (error) {
    await recordOperation("backup_last_error");
    throw error;
  }
}

// Kept separate from the worker entry point so it can reuse the same routine.
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve("scripts/backup.ts")
) {
  try {
    const [command = "create", source, destination] = process.argv.slice(2);
    if (command === "create")
      console.log(JSON.stringify(await scheduledBackup(true)));
    else if (command === "verify" && source)
      console.log(JSON.stringify(await verifyBackupRestore(source)));
    else if (command === "restore" && source && destination)
      console.log(
        JSON.stringify(await restoreLocalBackup(source, destination)),
      );
    else
      throw new Error(
        "Usage: backup.ts create | verify BACKUP | restore BACKUP NEW_FILE",
      );
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Backup failed");
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}
