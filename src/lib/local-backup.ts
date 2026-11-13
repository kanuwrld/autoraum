import { createHash, randomUUID } from "node:crypto";
import { backup, DatabaseSync } from "node:sqlite";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

export type BackupManifest = {
  format: 1;
  createdAt: number;
  file: string;
  sha256: string;
  schemaVersions: number[];
  tableCounts: Record<string, number>;
};
const backupPattern = /^autoraum-\d{13}-[a-f0-9-]{36}\.sqlite$/;
const checksum = async (path: string) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

export function inspectSqlite(path: string) {
  const connection = new DatabaseSync(path, { readOnly: true });
  try {
    if (
      connection.prepare("PRAGMA integrity_check").get()?.integrity_check !==
      "ok"
    )
      throw new Error("Backup integrity check failed");
    if (connection.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("Backup contains foreign key violations");
    const tables = connection
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all();
    const tableCounts: Record<string, number> = {};
    for (const table of tables) {
      const name = String(table.name);
      tableCounts[name] = Number(
        connection
          .prepare(
            `SELECT count(*) AS count FROM "${name.replaceAll('"', '""')}"`,
          )
          .get()?.count,
      );
    }
    const schemaVersions = connection
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all()
      .map((row) => Number(row.version));
    return { tableCounts, schemaVersions };
  } finally {
    connection.close();
  }
}

export async function createLocalBackup(sourcePath: string, directory: string) {
  const source = resolve(sourcePath);
  await stat(source); // Never create an empty source database on a typo.
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const createdAt = Date.now();
  const file = `autoraum-${createdAt}-${randomUUID()}.sqlite`;
  const path = join(directory, file);
  const handle = await open(path, "wx", 0o600);
  await handle.close();
  const connection = new DatabaseSync(source, { readOnly: true });
  try {
    await backup(connection, path);
    await chmod(path, 0o600);
    const manifest: BackupManifest = {
      format: 1,
      createdAt,
      file,
      sha256: await checksum(path),
      ...inspectSqlite(path),
    };
    await writeFile(`${path}.json`, JSON.stringify(manifest, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
    return { path, manifest };
  } catch (error) {
    await rm(path, { force: true });
    throw error;
  } finally {
    connection.close();
  }
}

/** Restore only to a NEW file. The live database is never replaced. */
export async function restoreLocalBackup(
  backupPath: string,
  destination: string,
) {
  const manifest = JSON.parse(
    await readFile(`${backupPath}.json`, "utf8"),
  ) as BackupManifest;
  if (
    manifest.format !== 1 ||
    manifest.file !== basename(backupPath) ||
    manifest.sha256 !== (await checksum(backupPath))
  )
    throw new Error("Backup checksum or manifest is invalid");
  await mkdir(dirname(resolve(destination)), { recursive: true, mode: 0o700 });
  // COPYFILE_EXCL also prevents replacing the source, a live DB or a symlink.
  await copyFile(backupPath, destination, constants.COPYFILE_EXCL);
  try {
    await chmod(destination, 0o600);
    if ((await checksum(destination)) !== manifest.sha256)
      throw new Error("Restored file checksum does not match");
    const restored = inspectSqlite(destination);
    if (
      JSON.stringify(restored.tableCounts) !==
        JSON.stringify(manifest.tableCounts) ||
      JSON.stringify(restored.schemaVersions) !==
        JSON.stringify(manifest.schemaVersions)
    )
      throw new Error("Restored data does not match the backup manifest");
    return restored;
  } catch (error) {
    await rm(destination, { force: true });
    throw error;
  }
}

export async function verifyBackupRestore(path: string) {
  const directory = await mkdtemp(join(tmpdir(), "autoraum-restore-"));
  try {
    return await restoreLocalBackup(path, join(directory, "restored.sqlite"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function pruneLocalBackups(directory: string, keep = 14) {
  if (!Number.isInteger(keep) || keep < 1)
    throw new Error("At least one backup must be retained");
  const files = (await readdir(directory))
    .filter((name) => backupPattern.test(name))
    .sort()
    .reverse();
  // Only this utility's complete, paired snapshots are eligible for retention.
  const complete: string[] = [];
  for (const file of files) {
    try {
      const manifest = JSON.parse(
        await readFile(join(directory, `${file}.json`), "utf8"),
      ) as BackupManifest;
      if (manifest.format === 1 && manifest.file === file) complete.push(file);
    } catch {
      /* Preserve unknown or incomplete files for operator inspection. */
    }
  }
  for (const file of complete.slice(keep)) {
    await rm(join(directory, file));
    await rm(join(directory, `${file}.json`));
  }
}

export async function writeBackupReceipt(path: string, data: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
  await rename(temporary, path);
}
