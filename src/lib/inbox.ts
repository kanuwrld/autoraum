import { db, type Queryable } from "./db";
import { HttpError } from "./security";
import type { InboxItem, InboxPage } from "./types";

export async function recordInboxMatches(
  tx: Queryable,
  tenantId: string,
  searchId: string,
  listingIds: string[],
  observedAt: number,
) {
  if (!listingIds.length) return;
  // Only matches committed by this run are eligible. Never backfill old matches as new alerts.
  const placeholders = listingIds.map((_, i) => `$${i + 4}`).join(",");
  await tx.query(
    `INSERT INTO inbox_items(tenant_id,listing_id,created_at,search_name)
     SELECT m.tenant_id,m.listing_id,$3,s.name FROM search_matches m
     JOIN searches s ON s.id=m.search_id AND s.tenant_id=m.tenant_id
     WHERE m.tenant_id=$1 AND m.search_id=$2 AND m.listing_id IN (${placeholders})
     ON CONFLICT(tenant_id,listing_id) DO NOTHING`,
    [tenantId, searchId, observedAt, ...listingIds],
  );
}

export async function inboxSummary(tenantId: string, userId: string) {
  const [counts, latest] = await Promise.all([
    db.query<{ count: number }>(
      `SELECT COUNT(*) AS count FROM inbox_items i LEFT JOIN inbox_reads r
       ON r.tenant_id=i.tenant_id AND r.listing_id=i.listing_id AND r.user_id=$2
       WHERE i.tenant_id=$1 AND r.read_at IS NULL`,
      [tenantId, userId],
    ),
    db.query<{ created_at: number; listing_id: string }>(
      "SELECT created_at,listing_id FROM inbox_items WHERE tenant_id=$1 ORDER BY created_at DESC,listing_id DESC LIMIT 1",
      [tenantId],
    ),
  ]);
  return {
    unread: Number(counts[0].count),
    latestKey: latest[0]
      ? `${latest[0].created_at}:${latest[0].listing_id}`
      : "",
  };
}

export async function queryInbox(
  tenantId: string,
  userId: string,
  options: {
    status: "all" | "unread" | "read";
    page: number;
    searchId?: string;
  },
): Promise<InboxPage> {
  const asOf = Date.now();
  const params: (string | number)[] = [tenantId, userId];
  const clauses = ["i.tenant_id=$1"];
  if (options.status !== "all")
    clauses.push(
      `r.read_at IS ${options.status === "unread" ? "" : "NOT "}NULL`,
    );
  if (options.searchId) {
    params.push(options.searchId);
    clauses.push(
      `EXISTS (SELECT 1 FROM search_matches m WHERE m.tenant_id=i.tenant_id AND m.listing_id=i.listing_id AND m.search_id=$${params.length})`,
    );
  }
  const joins = `FROM inbox_items i JOIN listings l ON l.tenant_id=i.tenant_id AND l.id=i.listing_id
    LEFT JOIN saved_listings s ON s.tenant_id=l.tenant_id AND s.listing_id=l.id
    LEFT JOIN inbox_reads r ON r.tenant_id=i.tenant_id AND r.listing_id=i.listing_id AND r.user_id=$2`;
  const where = clauses.join(" AND ");
  const [count] = await db.query<{ count: number }>(
    `SELECT COUNT(*) AS count ${joins} WHERE ${where}`,
    params,
  );
  const items = await db.query<InboxItem>(
    `SELECT l.*,s.stage,s.notes,s.target_price_cents,s.costs_cents,s.sale_price_cents,
     i.created_at AS received_at,i.search_name,r.read_at ${joins} WHERE ${where}
     ORDER BY i.created_at DESC,i.listing_id DESC LIMIT 24 OFFSET $${params.length + 1}`,
    [...params, (options.page - 1) * 24],
  );
  const profiles = items.length
    ? await db.query<{ listing_id: string; name: string }>(
        `SELECT m.listing_id,s.name FROM search_matches m JOIN searches s ON s.id=m.search_id AND s.tenant_id=m.tenant_id
     WHERE m.tenant_id=$1 AND m.listing_id IN (${items.map((_, i) => `$${i + 2}`).join(",")}) ORDER BY s.name`,
        [tenantId, ...items.map((i) => i.id)],
      )
    : [];
  return {
    items: items.map((item) => ({
      ...item,
      searchNames: [
        ...new Set([
          item.search_name,
          ...profiles
            .filter((p) => p.listing_id === item.id)
            .map((p) => p.name),
        ]),
      ],
    })),
    total: Number(count.count),
    asOf,
  };
}

export async function setInboxRead(
  tenantId: string,
  userId: string,
  listingId: string,
  read: boolean,
) {
  return db.transaction(async (tx) => {
    const exists = await tx.query(
      "SELECT listing_id FROM inbox_items WHERE tenant_id=$1 AND listing_id=$2",
      [tenantId, listingId],
    );
    if (!exists.length) throw new HttpError(404, "Eingang nicht gefunden.");
    if (read) {
      await tx.query(
        `INSERT INTO inbox_reads(tenant_id,listing_id,user_id,read_at) VALUES($1,$2,$3,$4)
         ON CONFLICT(tenant_id,listing_id,user_id) DO NOTHING`,
        [tenantId, listingId, userId, Date.now()],
      );
    } else {
      await tx.query(
        "DELETE FROM inbox_reads WHERE tenant_id=$1 AND listing_id=$2 AND user_id=$3",
        [tenantId, listingId, userId],
      );
    }
    return { ok: true };
  });
}

export async function readAllInbox(
  tenantId: string,
  userId: string,
  before: number,
) {
  await db.query(
    `INSERT INTO inbox_reads(tenant_id,listing_id,user_id,read_at)
     SELECT tenant_id,listing_id,$2,$3 FROM inbox_items WHERE tenant_id=$1 AND created_at<=$4
     ON CONFLICT(tenant_id,listing_id,user_id) DO NOTHING`,
    [tenantId, userId, Date.now(), Math.min(before, Date.now())],
  );
  return { ok: true };
}
