import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createLocalBackup,
  inspectSqlite,
  pruneLocalBackups,
  restoreLocalBackup,
  verifyBackupRestore,
} from "../src/lib/local-backup";

const root = await mkdtemp(join(tmpdir(), "autoraum-backup-test-"));
after(async () => {
  await rm(root, { recursive: true, force: true });
});

test("live WAL snapshot restores byte-identical business data without replacing the running database", async () => {
  const source = join(root, "source.sqlite");
  const connection = new DatabaseSync(source);
  try {
    connection.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY); INSERT INTO schema_migrations VALUES(5); CREATE TABLE notes(id INTEGER PRIMARY KEY,note TEXT); INSERT INTO notes VALUES(1,'TEST Unicode € ä 🚘');",
    );
    const result = await createLocalBackup(source, join(root, "snapshots"));
    connection.exec("INSERT INTO notes VALUES(2,'After snapshot');");
    const destination = join(root, "restored.sqlite");
    const restored = await restoreLocalBackup(result.path, destination);
    assert.equal(restored.tableCounts.notes, 1);
    assert.equal(inspectSqlite(source).tableCounts.notes, 2);
    assert.deepEqual(await readFile(destination), await readFile(result.path));
    const copy = new DatabaseSync(destination, { readOnly: true });
    assert.equal(
      copy.prepare("SELECT note FROM notes WHERE id=1").get()?.note,
      "TEST Unicode € ä 🚘",
    );
    copy.close();
    await assert.rejects(restoreLocalBackup(result.path, source), /exist/i);
    await assert.rejects(
      restoreLocalBackup(result.path, destination),
      /exist/i,
    );
    assert.deepEqual(await verifyBackupRestore(result.path), restored);
    await assert.rejects(
      createLocalBackup(join(root, "missing.sqlite"), join(root, "snapshots")),
      /ENOENT/,
    );
  } finally {
    connection.close();
  }
});

test("backup verification rejects tampering; retention preserves manual snapshots and incomplete files", async () => {
  const directory = join(root, "retention");
  const source = join(root, "source.sqlite");
  const a = await createLocalBackup(source, directory);
  await writeFile(a.path, "corrupted snapshot");
  await assert.rejects(verifyBackupRestore(a.path), /checksum/);
  const b = await createLocalBackup(source, directory);
  await createLocalBackup(source, directory);
  await writeFile(join(directory, "manual-important.sqlite"), "operator copy");
  await pruneLocalBackups(directory, 1);
  assert.ok((await readdir(directory)).includes("manual-important.sqlite"));
  assert.equal(
    (await readdir(directory)).filter(
      (f) => f.endsWith(".sqlite") && f.startsWith("autoraum-"),
    ).length,
    1,
  );
  await assert.rejects(pruneLocalBackups(directory, 0), /At least one/);
  assert.ok(b.manifest.schemaVersions.includes(5));
});
