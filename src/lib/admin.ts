import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "./db";
import { audit, issueInvitation } from "./auth";
import { emailSchema, HttpError, readJson } from "./security";
import type { Tenant, User } from "./types";

export type AdminTenant = Tenant & {
  owner_email: string;
  user_count: number;
  listing_count: number;
  search_count: number;
};
export async function getAdminData() {
  const tenants = await db.query<AdminTenant>(`SELECT t.*,
    (SELECT email FROM users WHERE tenant_id=t.id AND role='owner' LIMIT 1) AS owner_email,
    (SELECT COUNT(*) FROM users WHERE tenant_id=t.id) AS user_count,
    (SELECT COUNT(*) FROM listings WHERE tenant_id=t.id AND active=1) AS listing_count,
    (SELECT COUNT(*) FROM searches WHERE tenant_id=t.id AND enabled=1) AS search_count
    FROM tenants t ORDER BY t.created_at DESC`);
  const logs = await db.query<{
    id: string;
    action: string;
    created_at: number;
    name: string;
  }>(
    "SELECT a.id,a.action,a.created_at,t.name FROM audit_log a LEFT JOIN tenants t ON t.id=a.tenant_id ORDER BY a.created_at DESC LIMIT 15",
  );
  return { tenants, logs };
}
const companySchema = z.object({
  name: z.string().trim().min(2, "Bitte den Firmennamen eingeben.").max(100),
  slug: z
    .string()
    .min(3)
    .max(60)
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Die Adresse darf nur Kleinbuchstaben, Zahlen und Bindestriche enthalten.",
    ),
  email: emailSchema,
  ownerName: z.string().trim().min(2).max(100),
});
export async function createTenant(request: Request, actor: User) {
  const input = await readJson(request, companySchema);
  return db.transaction(async (tx) => {
    const existing = await tx.query("SELECT id FROM tenants WHERE slug=$1", [
      input.slug,
    ]);
    const existingUser = await tx.query("SELECT id FROM users WHERE email=$1", [
      input.email,
    ]);
    if (existing.length || existingUser.length)
      throw new HttpError(
        409,
        "Die Adresse oder E-Mail wird bereits verwendet.",
      );
    const id = randomUUID();
    const userId = randomUUID();
    await tx.query(
      "INSERT INTO tenants(id,name,slug,created_at) VALUES($1,$2,$3,$4)",
      [id, input.name, input.slug, Date.now()],
    );
    await tx.query(
      "INSERT INTO users(id,tenant_id,email,name,role,created_at) VALUES($1,$2,$3,$4,'owner',$5)",
      [userId, id, input.email, input.ownerName, Date.now()],
    );
    const invitationUrl = await issueInvitation(tx, userId);
    await audit(actor.id, id, "Betrieb erstellt · Einladung vorbereitet", tx);
    return { id, slug: input.slug, invitationUrl };
  });
}
export async function updateTenant(request: Request, id: string, actor: User) {
  const input = await readJson(request, z.object({ active: z.boolean() }));
  await db.transaction(async (tx) => {
    const rows = await tx.query(
      "UPDATE tenants SET active=$2 WHERE id=$1 RETURNING id",
      [id, Number(input.active)],
    );
    if (!rows.length) throw new HttpError(404, "Betrieb nicht gefunden.");
    if (!input.active)
      await tx.query(
        "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE tenant_id=$1)",
        [id],
      );
    await audit(
      actor.id,
      id,
      input.active ? "Betrieb aktiviert" : "Zugang pausiert",
      tx,
    );
  });
  return { ok: true };
}
export async function reissueInvitation(tenantId: string, actor: User) {
  return db.transaction(async (tx) => {
    const [owner] = await tx.query<{ id: string }>(
      "SELECT u.id FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE u.tenant_id=$1 AND u.role='owner' AND t.active=1 AND NOT EXISTS (SELECT 1 FROM blocked_users b WHERE b.user_id=u.id) ORDER BY u.created_at LIMIT 1",
      [tenantId],
    );
    if (!owner) throw new HttpError(404, "Aktiver Betrieb nicht gefunden.");
    const invitationUrl = await issueInvitation(tx, owner.id);
    await audit(actor.id, tenantId, "Neuer Aktivierungslink vorbereitet", tx);
    return { invitationUrl };
  });
}
