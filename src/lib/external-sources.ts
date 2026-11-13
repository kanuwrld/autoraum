import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, type Queryable } from "./db";
import { audit } from "./auth";
import { hashToken, HttpError, newToken, readJson } from "./security";
import { externalSourceIdSchema, publicUrl } from "./validation";
import type {
  ExternalSource,
  ExternalSourceId,
  Source,
  Tenant,
  User,
} from "./types";

export async function getExternalSources(
  tenantId: string,
): Promise<ExternalSource[]> {
  const rows = await db.query<{
    id: ExternalSourceId;
    name: string;
    website: string;
    enabled: number;
    last_feed_at: number | null;
    listing_count: number;
  }>(
    `SELECT s.id,s.name,s.website,CASE WHEN s.token_hash IS NULL THEN 0 ELSE 1 END AS enabled,s.last_feed_at,
     (SELECT COUNT(*) FROM listings l WHERE l.tenant_id=s.tenant_id AND l.source=s.id AND l.active=1) AS listing_count
     FROM external_sources s WHERE s.tenant_id=$1 ORDER BY s.created_at,s.name`,
    [tenantId],
  );
  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    website: s.website,
    enabled: !!s.enabled,
    lastFeedAt: s.last_feed_at,
    listingCount: Number(s.listing_count),
  }));
}

export async function assertExternalSources(
  tenantId: string,
  sources: Source[],
  tx: Queryable = db,
) {
  const ids = [...new Set(sources.filter((s) => s.startsWith("feed:")))];
  if (!ids.length) return;
  const rows = await tx.query<{ id: string }>(
    `SELECT id FROM external_sources WHERE tenant_id=$1 AND id IN (${ids.map((_, i) => `$${i + 2}`).join(",")})`,
    [tenantId, ...ids],
  );
  if (rows.length !== ids.length)
    throw new HttpError(
      400,
      "Der Datenanbieter gehört nicht zu diesem Arbeitsbereich.",
    );
}

export async function createExternalSource(
  request: Request,
  tenant: Tenant,
  user: User,
) {
  const input = await readJson(
    request,
    z.object({
      name: z.string().trim().min(2).max(80),
      website: publicUrl,
    }),
  );
  const id: ExternalSourceId = `feed:${randomUUID()}`;
  const token = newToken();
  await db.query(
    "INSERT INTO external_sources(id,tenant_id,name,website,token_hash,created_at) VALUES($1,$2,$3,$4,$5,$6)",
    [id, tenant.id, input.name, input.website, hashToken(token), Date.now()],
  );
  await audit(user.id, tenant.id, "Datenanbieter eingerichtet");
  return { id, name: input.name, token };
}

export async function changeExternalSourceKey(
  tenant: Tenant,
  user: User,
  rawId: string,
  revoke: boolean,
) {
  const id = externalSourceIdSchema.parse(rawId);
  const token = revoke ? null : newToken();
  const rows = await db.query<{ name: string }>(
    "UPDATE external_sources SET token_hash=$3 WHERE id=$1 AND tenant_id=$2 RETURNING name",
    [id, tenant.id, token ? hashToken(token) : null],
  );
  if (!rows.length) throw new HttpError(404, "Datenanbieter nicht gefunden.");
  await audit(
    user.id,
    tenant.id,
    revoke ? "Anbieter-Schlüssel widerrufen" : "Anbieter-Schlüssel erneuert",
  );
  return { id, name: rows[0].name, token };
}
