import { z } from "zod";
import { db } from "./db";
import { upsertListings } from "./listings";
import { hashToken, HttpError, rateLimit, readJson } from "./security";
import { listingInputSchema, sourceSchema } from "./validation";
import type { ExternalSourceId } from "./types";

export async function ingest(request: Request) {
  const token =
    request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  if (token.length < 32 || token.length > 150)
    throw new HttpError(401, "Ungültiger Feed-Schlüssel.");
  const [config] = await db.query<{
    tenant_id: string;
    source_id: ExternalSourceId | null;
  }>(
    `SELECT p.tenant_id,NULL AS source_id FROM provider_configs p JOIN tenants t ON t.id=p.tenant_id WHERE p.feed_token_hash=$1 AND t.active=1
     UNION ALL
     SELECT s.tenant_id,s.id AS source_id FROM external_sources s JOIN tenants t ON t.id=s.tenant_id WHERE s.token_hash=$1 AND t.active=1`,
    [hashToken(token)],
  );
  if (!config) throw new HttpError(401, "Ungültiger Feed-Schlüssel.");
  await rateLimit(`feed:${config.tenant_id}`, 30, 60_000);
  const input = await readJson(
    request,
    z.object({
      listings: z
        .array(listingInputSchema.extend({ source: sourceSchema.optional() }))
        .min(1)
        .max(500),
    }),
    1_500_000,
  );
  const items = input.listings.map((item) => {
    if (config.source_id && item.source && item.source !== config.source_id)
      throw new HttpError(
        400,
        "Dieser Schlüssel darf nur seinen eigenen Datenanbieter aktualisieren.",
      );
    return listingInputSchema.parse({
      ...item,
      source: config.source_id || item.source,
    });
  });
  const result = await upsertListings(config.tenant_id, items);
  if (config.source_id)
    await db.query("UPDATE external_sources SET last_feed_at=$2 WHERE id=$1", [
      config.source_id,
      Date.now(),
    ]);
  else
    await db.query(
      "UPDATE provider_configs SET last_feed_at=$2 WHERE tenant_id=$1",
      [config.tenant_id, Date.now()],
    );
  return result;
}
