import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { db, type Queryable } from "./db";
import { appUrl, hashToken, HttpError, newToken } from "./security";
import type { Tenant, User } from "./types";

const cookieName = "autoraum_session";
export async function getUser(): Promise<User | null> {
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  const [user] = await db.query<User>(
    `SELECT u.id,u.tenant_id,u.email,u.name,u.role FROM sessions s
    JOIN users u ON u.id=s.user_id LEFT JOIN tenants t ON t.id=u.tenant_id
    WHERE s.token_hash=$1 AND s.expires_at>$2 AND (u.role='platform_admin' OR t.active=1)
    AND NOT EXISTS (SELECT 1 FROM blocked_users b WHERE b.user_id=u.id)`,
    [hashToken(token), Date.now()],
  );
  return user || null;
}
export async function requireUser() {
  const user = await getUser();
  if (!user) throw new HttpError(401, "Bitte anmelden.");
  return user;
}
export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "platform_admin") throw new HttpError(403, "Kein Zugriff.");
  return user;
}
export async function requireTenant(slug: string, owner = false) {
  const user = await requireUser();
  const [tenant] = await db.query<Tenant>(
    "SELECT * FROM tenants WHERE slug=$1 AND active=1",
    [slug],
  );
  if (
    !tenant ||
    (user.role !== "platform_admin" && user.tenant_id !== tenant.id)
  )
    throw new HttpError(404, "Arbeitsbereich nicht gefunden.");
  if (owner && user.role === "buyer")
    throw new HttpError(
      403,
      "Nur die Verwaltung kann diese Einstellung ändern.",
    );
  return { user, tenant };
}
export async function createSession(userId: string) {
  const token = newToken();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)",
    [hashToken(token), userId, expires.getTime()],
  );
  (await cookies()).set(cookieName, token, {
    httpOnly: true,
    secure: appUrl().startsWith("https:"),
    sameSite: "lax",
    path: "/",
    expires,
  });
}
export async function deleteSession() {
  const jar = await cookies();
  const token = jar.get(cookieName)?.value;
  if (token)
    await db.query("DELETE FROM sessions WHERE token_hash=$1", [
      hashToken(token),
    ]);
  jar.delete(cookieName);
}
export async function issueInvitation(tx: Queryable, userId: string) {
  const token = newToken();
  await tx.query(
    "DELETE FROM invitations WHERE user_id=$1 AND used_at IS NULL",
    [userId],
  );
  await tx.query(
    "INSERT INTO invitations(token_hash,user_id,expires_at) VALUES($1,$2,$3)",
    [hashToken(token), userId, Date.now() + 72 * 60 * 60 * 1000],
  );
  return `${appUrl()}/activate#${token}`;
}
export async function audit(
  actor: string | null,
  tenant: string | null,
  action: string,
  tx: Queryable = db,
) {
  await tx.query(
    "INSERT INTO audit_log(id,actor_id,tenant_id,action,created_at) VALUES($1,$2,$3,$4,$5)",
    [randomUUID(), actor, tenant, action, Date.now()],
  );
}
