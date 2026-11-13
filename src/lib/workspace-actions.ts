import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "./db";
import { audit, issueInvitation } from "./auth";
import {
  emailSchema,
  encrypt,
  hashToken,
  HttpError,
  newToken,
  rateLimit,
  readJson,
} from "./security";
import {
  bookmarkSchema,
  listingInputSchema,
  saveSearchSchema,
} from "./validation";
import { parseCsv, upsertListings } from "./listings";
import { assertExternalSources } from "./external-sources";
import type { Tenant, User } from "./types";
import { calculatePurchase, toCents } from "./purchase";
import { getListing } from "./listings";

export async function saveSearch(request: Request, tenantId: string) {
  const input = await readJson(request, saveSearchSchema);
  await assertExternalSources(tenantId, input.filters.sources || []);
  const [count] = await db.query<{ count: number }>(
    "SELECT COUNT(*) AS count FROM searches WHERE tenant_id=$1",
    [tenantId],
  );
  if (Number(count.count) >= 50)
    throw new HttpError(409, "Maximal 50 Suchaufträge pro Betrieb.");
  const id = randomUUID();
  await db.query(
    "INSERT INTO searches(id,tenant_id,name,filters_json,enabled,interval_minutes,next_run_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      id,
      tenantId,
      input.name,
      JSON.stringify(input.filters),
      Number(input.enabled),
      input.intervalMinutes,
      input.enabled ? Date.now() : null,
      Date.now(),
    ],
  );
  return { id };
}
export async function updateSearch(
  request: Request,
  tenantId: string,
  id: string,
) {
  const input = await readJson(
    request,
    z.object({
      enabled: z.boolean(),
      intervalMinutes: z
        .union([
          z.literal(15),
          z.literal(30),
          z.literal(60),
          z.literal(180),
          z.literal(1440),
        ])
        .default(60),
    }),
  );
  const rows = await db.query(
    "UPDATE searches SET enabled=$3,interval_minutes=$4,next_run_at=$5 WHERE id=$1 AND tenant_id=$2 RETURNING id",
    [
      id,
      tenantId,
      Number(input.enabled),
      input.intervalMinutes,
      input.enabled ? Date.now() : null,
    ],
  );
  if (!rows.length) throw new HttpError(404, "Suchauftrag nicht gefunden.");
  return { ok: true };
}
export async function saveListing(
  request: Request,
  tenantId: string,
  listingId: string,
) {
  const input = await readJson(request, bookmarkSchema);
  const exists = await db.query(
    "SELECT id FROM listings WHERE id=$1 AND tenant_id=$2",
    [listingId, tenantId],
  );
  if (!exists.length) throw new HttpError(404, "Anzeige nicht gefunden.");
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO saved_listings(tenant_id,listing_id,stage,notes,target_price_cents,costs_cents,sale_price_cents,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT(tenant_id,listing_id) DO UPDATE SET stage=$3,notes=$4,target_price_cents=$5,costs_cents=$6,sale_price_cents=$7,updated_at=$8`,
      [
        tenantId,
        listingId,
        input.stage,
        input.notes,
        toCents(input.targetPrice),
        toCents(input.costs),
        toCents(input.salePrice),
        Date.now(),
      ],
    );
    if (input.purchasePlan) {
      const p = input.purchasePlan;
      await tx.query(
        `INSERT INTO purchase_plans(tenant_id,listing_id,transport_cents,repairs_cents,preparation_cents,fees_cents,reserve_cents,desired_profit_cents)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(tenant_id,listing_id) DO UPDATE SET
       transport_cents=$3,repairs_cents=$4,preparation_cents=$5,fees_cents=$6,reserve_cents=$7,desired_profit_cents=$8`,
        [
          tenantId,
          listingId,
          toCents(p.transport),
          toCents(p.repairs),
          toCents(p.preparation),
          toCents(p.fees),
          toCents(p.reserve),
          toCents(p.desiredProfit),
        ],
      );
    }
  });
  const saved = await getListing(tenantId, listingId);
  return {
    ok: true,
    calculation: calculatePurchase(saved, saved.purchasePlan),
  };
}
export async function importCsv(request: Request, tenant: Tenant, user: User) {
  const { csv } = await readJson(
    request,
    z.object({ csv: z.string().min(10).max(1_000_000) }),
    1_050_000,
  );
  let rows: Record<string, string>[];
  try {
    rows = parseCsv(csv);
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error
        ? error.message
        : "CSV konnte nicht gelesen werden.",
    );
  }
  if (!rows.length || rows.length > 500)
    throw new HttpError(400, "Bitte 1 bis 500 Anzeigen pro Datei importieren.");
  const items = rows.map((row, index) => {
    const data: Record<string, unknown> = Object.fromEntries(
      Object.entries(row).filter(([, v]) => v !== ""),
    );
    if (data.damaged !== undefined) {
      if (data.damaged !== "true" && data.damaged !== "false")
        throw new HttpError(
          400,
          `Zeile ${index + 2}: damaged muss true oder false sein.`,
        );
      data.damaged = data.damaged === "true";
    }
    if (data.active !== undefined) {
      if (data.active !== "true" && data.active !== "false")
        throw new HttpError(
          400,
          `Zeile ${index + 2}: active muss true oder false sein.`,
        );
      data.active = data.active === "true";
    }
    data.source ||= "csv";
    const result = listingInputSchema.safeParse(data);
    if (!result.success)
      throw new HttpError(
        400,
        `Zeile ${index + 2}, ${result.error.issues[0].path.join(".")}: ${result.error.issues[0].message}`,
      );
    return result.data;
  });
  const result = await upsertListings(tenant.id, items);
  await audit(
    user.id,
    tenant.id,
    `CSV importiert · ${result.added} neu, ${result.updated} aktualisiert`,
  );
  return result;
}
export async function saveProvider(
  request: Request,
  tenant: Tenant,
  user: User,
) {
  const input = await readJson(
    request,
    z.object({
      username: z.string().trim().min(1).max(200),
      password: z.string().min(1).max(500),
    }),
  );
  const encrypted = encrypt(JSON.stringify(input));
  await db.query(
    "INSERT INTO provider_configs(tenant_id,mobile_credentials,mobile_updated_at) VALUES($1,$2,$3) ON CONFLICT(tenant_id) DO UPDATE SET mobile_credentials=$2,mobile_updated_at=$3",
    [tenant.id, encrypted, Date.now()],
  );
  await audit(user.id, tenant.id, "mobile.de-Zugang hinterlegt");
  return { ok: true };
}
export async function rotateFeedKey(tenant: Tenant, user: User) {
  const token = newToken();
  await db.query(
    "INSERT INTO provider_configs(tenant_id,feed_token_hash) VALUES($1,$2) ON CONFLICT(tenant_id) DO UPDATE SET feed_token_hash=$2",
    [tenant.id, hashToken(token)],
  );
  await audit(user.id, tenant.id, "Feed-Schlüssel erstellt / erneuert");
  return { token };
}
export async function inviteTeamMember(
  request: Request,
  tenant: Tenant,
  actor: User,
) {
  const input = await readJson(
    request,
    z.object({
      name: z.string().trim().min(2).max(100),
      email: emailSchema,
      role: z.enum(["buyer", "owner"]).default("buyer"),
    }),
  );
  await rateLimit(`invite:${tenant.id}`, 10, 3600_000);
  return db.transaction(async (tx) => {
    const existing = await tx.query("SELECT id FROM users WHERE email=$1", [
      input.email,
    ]);
    if (existing.length)
      throw new HttpError(409, "Diese E-Mail-Adresse ist bereits registriert.");
    const id = randomUUID();
    await tx.query(
      "INSERT INTO users(id,tenant_id,email,name,role,created_at) VALUES($1,$2,$3,$4,$5,$6)",
      [id, tenant.id, input.email, input.name, input.role, Date.now()],
    );
    const invitationUrl = await issueInvitation(tx, id);
    await audit(actor.id, tenant.id, "Team-Einladung vorbereitet", tx);
    return { invitationUrl };
  });
}
