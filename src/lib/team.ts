import { z } from "zod";
import { db } from "./db";
import { audit, issueInvitation } from "./auth";
import { HttpError, rateLimit, readJson } from "./security";
import type { Tenant, User } from "./types";

function assertManager(tenant: Tenant, actor: User) {
  if (
    actor.role !== "platform_admin" &&
    (actor.role !== "owner" || actor.tenant_id !== tenant.id)
  )
    throw new HttpError(403, "Nur die Verwaltung kann Zugänge ändern.");
}

export async function teamMembers(tenantId: string) {
  return db.query<{
    id: string;
    name: string;
    email: string;
    role: string;
    activated: number;
    blocked: number;
  }>(
    `SELECT u.id,u.name,u.email,u.role,
    CASE WHEN u.password_hash IS NULL THEN 0 ELSE 1 END AS activated,
    CASE WHEN b.user_id IS NULL THEN 0 ELSE 1 END AS blocked
    FROM users u LEFT JOIN blocked_users b ON b.user_id=u.id
    WHERE u.tenant_id=$1 ORDER BY u.created_at,u.id`,
    [tenantId],
  );
}

export async function recoverTeamMember(
  tenant: Tenant,
  actor: User,
  id: string,
) {
  assertManager(tenant, actor);
  await rateLimit(`team-recovery:${tenant.id}`, 30, 3600_000);
  return db.transaction(async (tx) => {
    // Serialize access changes, including recovery, for this company.
    await tx.query("UPDATE tenants SET active=active WHERE id=$1", [tenant.id]);
    const [member] = await tx.query<{ id: string }>(
      `SELECT u.id FROM users u JOIN tenants t ON t.id=u.tenant_id
       WHERE u.id=$1 AND u.tenant_id=$2 AND t.active=1
       AND NOT EXISTS (SELECT 1 FROM blocked_users b WHERE b.user_id=u.id)`,
      [id, tenant.id],
    );
    if (!member) throw new HttpError(404, "Aktiver Zugang nicht gefunden.");
    const invitationUrl = await issueInvitation(tx, member.id);
    await audit(
      actor.id,
      tenant.id,
      "Wiederherstellungslink für Teamzugang vorbereitet",
      tx,
    );
    return { invitationUrl };
  });
}

export async function changeTeamAccess(
  request: Request,
  tenant: Tenant,
  actor: User,
  id: string,
) {
  assertManager(tenant, actor);
  const { blocked } = await readJson(
    request,
    z.object({ blocked: z.boolean() }),
  );
  if (id === actor.id)
    throw new HttpError(
      400,
      "Den eigenen Zugang können Sie hier nicht sperren.",
    );
  return db.transaction(async (tx) => {
    await tx.query("UPDATE tenants SET active=active WHERE id=$1", [tenant.id]);
    const [member] = await tx.query<{ role: string }>(
      "SELECT role FROM users WHERE id=$1 AND tenant_id=$2",
      [id, tenant.id],
    );
    if (!member) throw new HttpError(404, "Teammitglied nicht gefunden.");
    if (blocked && member.role === "owner") {
      const others = await tx.query(
        `SELECT u.id FROM users u WHERE u.tenant_id=$1 AND u.id!=$2 AND u.role='owner'
         AND u.password_hash IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM blocked_users b WHERE b.user_id=u.id)`,
        [tenant.id, id],
      );
      if (!others.length)
        throw new HttpError(
          409,
          "Mindestens ein aktivierter Administrator muss erreichbar bleiben.",
        );
    }
    if (blocked) {
      await tx.query(
        `INSERT INTO blocked_users(user_id,tenant_id,blocked_at,blocked_by)
        VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO NOTHING`,
        [id, tenant.id, Date.now(), actor.id],
      );
      await tx.query("DELETE FROM sessions WHERE user_id=$1", [id]);
      await tx.query(
        "DELETE FROM invitations WHERE user_id=$1 AND used_at IS NULL",
        [id],
      );
    } else {
      await tx.query(
        "DELETE FROM blocked_users WHERE user_id=$1 AND tenant_id=$2",
        [id, tenant.id],
      );
    }
    await audit(
      actor.id,
      tenant.id,
      blocked
        ? "Teamzugang gesperrt · Sitzungen widerrufen"
        : "Teamzugang freigegeben",
      tx,
    );
    return { ok: true };
  });
}
