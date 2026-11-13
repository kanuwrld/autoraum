import { randomUUID } from "node:crypto";
import { db, type Queryable } from "./db";
import type { Filters, Listing, PurchasePlan, Source } from "./types";
import { HttpError } from "./security";
import type { ListingInput } from "./validation";
import { assertExternalSources } from "./external-sources";

export async function upsertListings(
  tenantId: string,
  items: ListingInput[],
  observedAt = Date.now(),
) {
  const now = observedAt;
  let added = 0;
  let updated = 0;
  const unique = [
    ...new Map(
      items.map((item) => [`${item.source}:${item.externalId}`, item]),
    ).values(),
  ];
  const columns = [
    "id",
    "tenant_id",
    "source",
    "external_id",
    "url",
    "title",
    "make",
    "model",
    "price_cents",
    "year",
    "mileage",
    "fuel",
    "transmission",
    "city",
    "postal_code",
    "seller_type",
    "image_url",
    "damaged",
    "first_seen",
    "last_seen",
    "active",
  ];
  const updatedColumns = columns.filter(
    (c) =>
      !["id", "tenant_id", "source", "external_id", "first_seen"].includes(c),
  );
  await db.transaction(async (tx) => {
    await assertExternalSources(
      tenantId,
      unique.map((item) => item.source),
      tx,
    );
    for (let offset = 0; offset < unique.length; offset += 100) {
      const batch = unique.slice(offset, offset + 100);
      const params: (string | number | null)[] = [];
      const newIds = new Set<string>();
      const values = batch.map((item) => {
        const id = randomUUID();
        newIds.add(id);
        const row = [
          id,
          tenantId,
          item.source,
          item.externalId,
          canonicalUrl(item.url),
          item.title,
          item.make,
          item.model,
          Math.round(item.price * 100),
          item.year ?? null,
          item.mileage ?? null,
          item.fuel,
          item.transmission,
          item.city,
          item.postalCode,
          item.sellerType,
          item.imageUrl ?? null,
          item.damaged === undefined ? null : Number(item.damaged),
          now,
          now,
          Number(item.active),
        ];
        return `(${row
          .map((value) => {
            params.push(value);
            return `$${params.length}`;
          })
          .join(",")})`;
      });
      const rows = await tx.query<{ id: string }>(
        `INSERT INTO listings(${columns.join(",")}) VALUES ${values.join(",")}
        ON CONFLICT(tenant_id,source,external_id) DO UPDATE SET ${updatedColumns.map((c) => `${c}=excluded.${c}`).join(",")}
        WHERE excluded.last_seen >= listings.last_seen RETURNING id`,
        params,
      );
      const inserted = rows.filter((row) => newIds.has(row.id)).length;
      added += inserted;
      updated += rows.length - inserted;
    }
  });
  return { added, updated, total: items.length };
}
export function canonicalUrl(value: string) {
  const u = new URL(value);
  u.hash = "";
  for (const key of [...u.searchParams.keys()])
    if (/^utm_|^(source|ref|referrer)$/i.test(key)) u.searchParams.delete(key);
  return u.toString();
}
function whereClause(
  tenantId: string,
  f: Filters,
  savedOnly: boolean,
  stage?: string,
) {
  const params: (string | number | null)[] = [tenantId];
  const clauses = ["l.tenant_id=$1"];
  const add = (sql: string, value: string | number) => {
    params.push(value);
    clauses.push(sql.replace("?", `$${params.length}`));
  };
  if (savedOnly) clauses.push("s.stage IS NOT NULL");
  else clauses.push("l.active=1");
  if (stage) add("s.stage=?", stage);
  if (f.make) add("LOWER(l.make)=LOWER(?)", f.make);
  if (f.model) {
    // M2 must not match M235i, and A4 must not match A45.
    if (/^[a-z]\d{1,2}$/i.test(f.model))
      add(
        "LOWER(' ' || REPLACE(REPLACE(l.model,'-',' '),'/',' ') || ' ') LIKE LOWER(?) ESCAPE '\\'",
        `% ${escapeLike(f.model)} %`,
      );
    else
      add(
        "LOWER(l.model) LIKE LOWER(?) ESCAPE '\\'",
        `%${escapeLike(f.model)}%`,
      );
  }
  if (f.minPrice !== undefined) add("l.price_cents>=?", f.minPrice * 100);
  if (f.maxPrice !== undefined) add("l.price_cents<=?", f.maxPrice * 100);
  if (f.minYear !== undefined) add("l.year>=?", f.minYear);
  if (f.maxYear !== undefined) add("l.year<=?", f.maxYear);
  if (f.maxMileage !== undefined) add("l.mileage<=?", f.maxMileage);
  if (f.fuel) add("l.fuel=?", f.fuel);
  if (f.transmission) add("l.transmission=?", f.transmission);
  if (f.undamagedOnly) clauses.push("l.damaged=0");
  if (f.location) {
    params.push(`%${escapeLike(f.location)}%`);
    clauses.push(
      `(LOWER(l.city) LIKE LOWER($${params.length}) ESCAPE '\\' OR l.postal_code LIKE $${params.length} ESCAPE '\\')`,
    );
  }
  if (f.sources?.length) {
    const placeholders = f.sources.map((s: Source) => {
      params.push(s);
      return `$${params.length}`;
    });
    clauses.push(`l.source IN (${placeholders.join(",")})`);
  }
  return { where: clauses.join(" AND "), params };
}
function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}
export async function queryListings(
  tenantId: string,
  filters: Filters = {},
  options: {
    savedOnly?: boolean;
    sort?: string;
    page?: number;
    stage?: string;
    limit?: number;
  } = {},
  tx: Queryable = db,
) {
  const { where, params } = whereClause(
    tenantId,
    filters,
    !!options.savedOnly,
    options.stage,
  );
  const sort =
    {
      newest: "l.first_seen DESC,l.id",
      price_asc: "l.price_cents ASC,l.id",
      price_desc: "l.price_cents DESC,l.id",
      mileage: "l.mileage ASC,l.id",
    }[options.sort || "newest"] || "l.first_seen DESC,l.id";
  const joins =
    "FROM listings l LEFT JOIN saved_listings s ON s.listing_id=l.id AND s.tenant_id=l.tenant_id";
  const [count] = await tx.query<{ count: number }>(
    `SELECT COUNT(*) AS count ${joins} WHERE ${where}`,
    params,
  );
  const limit = Math.min(options.limit || 24, 2000);
  const offset = (Math.max(options.page || 1, 1) - 1) * limit;
  const rows = await tx.query<Listing>(
    `SELECT l.*,s.stage,s.notes,s.target_price_cents,s.costs_cents,s.sale_price_cents ${joins} WHERE ${where} ORDER BY ${sort} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );
  return { listings: rows, total: Number(count.count) };
}

export async function getListing(
  tenantId: string,
  listingId: string,
): Promise<Listing> {
  const [listing] = await db.query<Listing>(
    `SELECT l.*,s.stage,s.notes,s.target_price_cents,s.costs_cents,s.sale_price_cents
     FROM listings l LEFT JOIN saved_listings s ON s.tenant_id=l.tenant_id AND s.listing_id=l.id
     WHERE l.tenant_id=$1 AND l.id=$2`,
    [tenantId, listingId],
  );
  if (!listing) throw new HttpError(404, "Fahrzeug nicht gefunden.");
  const [plan] = await db.query<PurchasePlan>(
    "SELECT transport_cents,repairs_cents,preparation_cents,fees_cents,reserve_cents,desired_profit_cents FROM purchase_plans WHERE tenant_id=$1 AND listing_id=$2",
    [tenantId, listingId],
  );
  return { ...listing, purchasePlan: plan || null };
}

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const raw = text.replace(/^\uFEFF/, "");
  const delimiter = raw.split(/\r?\n/)[0].includes(";") ? ";" : ",";
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (char === '"') {
      if (quoted && raw[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && raw[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (quoted)
    throw new Error("CSV enthält ein nicht geschlossenes Anführungszeichen.");
  row.push(cell);
  if (row.some(Boolean)) rows.push(row);
  const headers = rows.shift()?.map((h) => h.trim());
  if (!headers || new Set(headers).size !== headers.length)
    throw new Error("CSV-Kopfzeile fehlt oder enthält doppelte Spalten.");
  return rows.map((r, i) => {
    if (r.length !== headers.length)
      throw new Error(`CSV-Zeile ${i + 2}: Anzahl der Spalten stimmt nicht.`);
    return Object.fromEntries(headers.map((h, j) => [h, r[j].trim()]));
  });
}
