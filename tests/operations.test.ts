import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { db, closeDb } from "../src/lib/db";
import {
  changeTeamAccess,
  recoverTeamMember,
  teamMembers,
} from "../src/lib/team";
import { hashToken } from "../src/lib/security";
import { taskMembers, createTask } from "../src/lib/tasks";
import { exportWorkspace } from "../src/lib/workspace-export";
import { getOperationsStatus } from "../src/lib/operations";
import type { Tenant, User } from "../src/lib/types";

const directory = mkdtempSync(join(tmpdir(), "autoraum-operations-"));
process.env.SQLITE_PATH = join(directory, "test.sqlite");
process.env.APP_URL = "http://localhost:3107";
if (process.env.TEST_DATABASE_URL)
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
else delete process.env.DATABASE_URL;
delete process.env.VERCEL;
const tenant: Tenant = {
  id: randomUUID(),
  name: "TEST Operations",
  slug: `ops-${randomUUID()}`,
  active: 1,
  created_at: Date.now(),
};
const owner: User = {
  id: randomUUID(),
  tenant_id: tenant.id,
  email: `${randomUUID()}@example.test`,
  name: "TEST Owner",
  role: "owner",
};
const buyer: User = {
  ...owner,
  id: randomUUID(),
  email: `${randomUUID()}@example.test`,
  name: "TEST Buyer",
  role: "buyer",
};
const admin: User = {
  ...owner,
  id: randomUUID(),
  email: `${randomUUID()}@example.test`,
  tenant_id: null,
  role: "platform_admin",
};
const other: Tenant = {
  ...tenant,
  id: randomUUID(),
  slug: `other-${randomUUID()}`,
};
const otherBuyer: User = {
  ...buyer,
  id: randomUUID(),
  email: `${randomUUID()}@example.test`,
  tenant_id: other.id,
};
const jsonRequest = (body: unknown) =>
  new Request("http://localhost:3107/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

before(async () => {
  for (const t of [tenant, other])
    await db.query(
      "INSERT INTO tenants(id,name,slug,created_at) VALUES($1,$2,$3,$4)",
      [t.id, t.name, t.slug, t.created_at],
    );
  for (const u of [owner, buyer, admin, otherBuyer])
    await db.query(
      "INSERT INTO users(id,tenant_id,email,name,role,password_hash,created_at) VALUES($1,$2,$3,$4,$5,'TEST hash',$6)",
      [u.id, u.tenant_id, u.email, u.name, u.role, Date.now()],
    );
});
after(async () => {
  await closeDb();
  rmSync(directory, { recursive: true, force: true });
});

test("team suspension revokes sessions and invitations, excludes new assignments, preserves existing tasks", async () => {
  const task = await createTask(
    jsonRequest({
      title: "TEST retained action",
      notes: "Keep this",
      assigneeId: buyer.id,
      dueDate: "2026-11-20",
    }),
    tenant.id,
    owner.id,
  );
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)",
    [randomUUID(), buyer.id, Date.now() + 60000],
  );
  await recoverTeamMember(tenant, owner, buyer.id);
  await changeTeamAccess(
    jsonRequest({ blocked: true }),
    tenant,
    owner,
    buyer.id,
  );
  assert.equal(
    (await db.query("SELECT * FROM sessions WHERE user_id=$1", [buyer.id]))
      .length,
    0,
  );
  assert.equal(
    (
      await db.query(
        "SELECT * FROM invitations WHERE user_id=$1 AND used_at IS NULL",
        [buyer.id],
      )
    ).length,
    0,
  );
  assert.equal(
    (await teamMembers(tenant.id)).find((u) => u.id === buyer.id)?.blocked,
    1,
  );
  assert.equal(
    (await taskMembers(tenant.id)).some((u) => u.id === buyer.id),
    false,
  );
  assert.equal(
    (await db.query("SELECT * FROM tasks WHERE id=$1", [task.id])).length,
    1,
  );
  await assert.rejects(
    createTask(
      jsonRequest({
        title: "Blocked assignee",
        assigneeId: buyer.id,
        dueDate: "2026-11-20",
      }),
      tenant.id,
      owner.id,
    ),
    /aktiviertes Teammitglied/,
  );
  await assert.rejects(
    recoverTeamMember(tenant, owner, buyer.id),
    /Aktiver Zugang/,
  );
  await changeTeamAccess(
    jsonRequest({ blocked: false }),
    tenant,
    owner,
    buyer.id,
  );
  assert.equal(
    (await taskMembers(tenant.id)).some((u) => u.id === buyer.id),
    true,
  );
});

test("access management denies cross-company changes, buyers, self suspension and the last administrator", async () => {
  const body = jsonRequest({ blocked: true });
  await assert.rejects(
    changeTeamAccess(body, tenant, otherBuyer, buyer.id),
    /Nur die Verwaltung/,
  );
  await assert.rejects(
    changeTeamAccess(jsonRequest({ blocked: true }), tenant, buyer, owner.id),
    /Nur die Verwaltung/,
  );
  await assert.rejects(
    changeTeamAccess(
      jsonRequest({ blocked: true }),
      tenant,
      owner,
      otherBuyer.id,
    ),
    /nicht gefunden/,
  );
  await assert.rejects(
    changeTeamAccess(jsonRequest({ blocked: true }), tenant, owner, owner.id),
    /eigenen Zugang/,
  );
  await assert.rejects(
    changeTeamAccess(jsonRequest({ blocked: true }), tenant, admin, owner.id),
    /Mindestens ein/,
  );
  assert.equal(
    (
      await db.query("SELECT * FROM blocked_users WHERE tenant_id=$1", [
        tenant.id,
      ])
    ).length,
    0,
  );
  await assert.rejects(
    recoverTeamMember(tenant, buyer, owner.id),
    /Nur die Verwaltung/,
  );
  await assert.rejects(
    recoverTeamMember(tenant, owner, otherBuyer.id),
    /nicht gefunden/,
  );
});

test("recovery rotates one-use tokens without storing plaintext or changing the password prematurely", async () => {
  const first = await recoverTeamMember(tenant, owner, buyer.id);
  const second = await recoverTeamMember(tenant, owner, buyer.id);
  const rows = await db.query<{ token_hash: string; expires_at: number }>(
    "SELECT token_hash,expires_at FROM invitations WHERE user_id=$1 AND used_at IS NULL",
    [buyer.id],
  );
  assert.equal(rows.length, 1);
  assert.equal(
    rows[0].token_hash,
    hashToken(second.invitationUrl.split("#")[1]),
  );
  assert.notEqual(
    rows[0].token_hash,
    hashToken(first.invitationUrl.split("#")[1]),
  );
  assert.ok(rows[0].expires_at > Date.now() + 71 * 3600_000);
  assert.equal(
    (
      await db.query<{ password_hash: string }>(
        "SELECT password_hash FROM users WHERE id=$1",
        [buyer.id],
      )
    )[0].password_hash,
    "TEST hash",
  );
});

test("workspace export contains business work only and enforces company and role boundaries", async () => {
  await db.query(
    "INSERT INTO searches(id,tenant_id,name,filters_json,created_at) VALUES($1,$2,'TEST Export profile','{}',$3)",
    [randomUUID(), tenant.id, Date.now()],
  );
  await db.query(
    "INSERT INTO searches(id,tenant_id,name,filters_json,created_at) VALUES($1,$2,'PRIVATE OTHER PROFILE','{}',$3)",
    [randomUUID(), other.id, Date.now()],
  );
  const result = await exportWorkspace(tenant, owner);
  assert.equal(result.company.slug, tenant.slug);
  assert.equal(result.searches.length, 1);
  assert.equal(result.tasks.length, 1);
  const text = JSON.stringify(result);
  for (const forbidden of [
    "TEST hash",
    "token_hash",
    "password",
    "PRIVATE OTHER PROFILE",
  ])
    assert.equal(text.includes(forbidden), false);
  await assert.rejects(exportWorkspace(tenant, buyer), /Nur die Verwaltung/);
  await assert.rejects(
    exportWorkspace(tenant, otherBuyer),
    /Nur die Verwaltung/,
  );
});

test("operations distinguishes fresh and stale worker, backup failure and external PostgreSQL backups", async () => {
  if (process.env.TEST_DATABASE_URL) {
    const external = await getOperationsStatus();
    assert.equal(external.database, "PostgreSQL");
    assert.equal(external.backup.local, false);
    assert.equal(external.backup.healthy, false);
    return;
  }
  const set = async (key: string, value: number) =>
    db.query(
      "INSERT INTO system_state(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2",
      [key, String(value)],
    );
  const now = Date.now();
  await set("scheduler_heartbeat", now);
  await set("backup_last_success", now);
  await set("backup_restore_verified", now);
  await set("backup_last_error", 0);
  let result = await getOperationsStatus();
  assert.equal(result.worker.healthy, true);
  assert.equal(result.backup.healthy, !process.env.DATABASE_URL);
  await set("scheduler_heartbeat", now - 181000);
  await set("backup_last_error", now + 1);
  result = await getOperationsStatus();
  assert.equal(result.worker.healthy, false);
  assert.equal(result.backup.healthy, false);
  for (const key of [
    "scheduler_heartbeat",
    "backup_last_success",
    "backup_restore_verified",
    "backup_last_error",
  ])
    await db.query("DELETE FROM system_state WHERE key=$1", [key]);
});
