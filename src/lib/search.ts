import { randomUUID } from "node:crypto";
import { db } from "./db";
import { fetchMobile } from "./providers";
import { fetchPublic } from "./public-providers";
import { publicSearchUrl } from "./marketplace-links";
import { queryListings, upsertListings } from "./listings";
import { HttpError } from "./security";
import { filtersSchema } from "./validation";
import { acquireLock, releaseLock } from "./locks";
import { assertExternalSources, getExternalSources } from "./external-sources";
import { recordInboxMatches } from "./inbox";
export { acquireLock, releaseLock } from "./locks";
import {
  sourceNames,
  sourceName,
  publicSourceIds,
  type Source,
  type Filters,
  type SavedSearch,
  type SourceResult,
} from "./types";

export async function runSearch(
  tenantId: string,
  filters: Filters,
  searchId: string | null = null,
) {
  await assertExternalSources(tenantId, filters.sources || []);
  const lockId = `search:${tenantId}`;
  const token = await acquireLock(lockId, 90_000);
  if (!token)
    throw new HttpError(
      409,
      "Für diesen Betrieb läuft bereits eine Suche. Bitte kurz warten.",
    );
  const runId = randomUUID();
  let created = false;
  const results: SourceResult[] = [];
  try {
    await db.query(
      "INSERT INTO search_runs(id,tenant_id,search_id,status,started_at) VALUES($1,$2,$3,'running',$4)",
      [runId, tenantId, searchId, Date.now()],
    );
    created = true;
    if (!filters.sources?.length || filters.sources.includes("mobile")) {
      try {
        const mobile = await fetchMobile(tenantId, filters);
        if (mobile.items.length) await upsertListings(tenantId, mobile.items);
        results.push(mobile.result);
      } catch (error) {
        results.push({
          sourceId: "mobile",
          source: "mobile.de",
          status: "error",
          count: 0,
          message:
            error instanceof HttpError
              ? error.message
              : "Die Datenquelle konnte nicht abgefragt werden. Gespeicherte Anzeigen bleiben verfügbar.",
        });
      }
    }
    const publicSources = publicSourceIds.filter(
      (source) => !filters.sources?.length || filters.sources.includes(source),
    );
    const publicResults = await Promise.allSettled(
      publicSources.map((source) => fetchPublic(source, filters)),
    );
    for (const [index, outcome] of publicResults.entries()) {
      const source = publicSources[index];
      if (outcome.status === "fulfilled") {
        const response = outcome.value;
        if (response.items.length)
          await upsertListings(tenantId, response.items, response.observedAt);
        results.push(response.result);
      } else {
        results.push({
          sourceId: source,
          source: sourceNames[source],
          status: "error",
          count: 0,
          searchUrl: publicSearchUrl(source, filters).href,
          message:
            outcome.reason instanceof HttpError
              ? outcome.reason.message
              : "Die öffentliche Suche ist momentan nicht erreichbar. Gespeicherte Anzeigen bleiben verfügbar.",
        });
      }
    }
    const externalSources = await getExternalSources(tenantId);
    const cached = await db.query<{
      source: Source;
      count: number;
    }>(
      "SELECT source,COUNT(*) AS count FROM listings WHERE tenant_id=$1 AND active=1 GROUP BY source",
      [tenantId],
    );
    for (const source of [
      "partner",
      "csv",
      ...externalSources.map((s) => s.id),
    ] as Source[]) {
      if (filters.sources?.length && !filters.sources.includes(source))
        continue;
      const count = Number(cached.find((c) => c.source === source)?.count || 0);
      if (!count && !filters.sources?.length) continue;
      results.push({
        sourceId: source,
        source: sourceName(source, externalSources),
        status: count ? "cached" : "disconnected",
        count,
        message: count
          ? "Gespeicherte Daten durchsucht. Stand je Anzeige beachten."
          : source.startsWith("feed:")
            ? "Von diesem Anbieter wurden noch keine Anzeigen geliefert."
            : source === "csv"
              ? "Noch keine Datei importiert."
              : "Kein Feed verbunden. Zugriff auf die Plattform ist separat erforderlich.",
      });
    }
    const matched = await queryListings(tenantId, filters, { limit: 2000 });
    let added = 0;
    await db.transaction(async (tx) => {
      if (searchId) {
        if (matched.listings.length) {
          const placeholders = matched.listings
            .map((_, i) => `$${i + 4}`)
            .join(",");
          const matchedAt = Date.now();
          const rows = await tx.query<{ listing_id: string }>(
            `INSERT INTO search_matches(tenant_id,search_id,listing_id,first_seen)
            SELECT tenant_id,$2,id,$3 FROM listings WHERE tenant_id=$1 AND id IN (${placeholders}) ON CONFLICT DO NOTHING RETURNING listing_id`,
            [
              tenantId,
              searchId,
              matchedAt,
              ...matched.listings.map((l) => l.id),
            ],
          );
          added = rows.length;
          await recordInboxMatches(
            tx,
            tenantId,
            searchId,
            rows.map((r) => r.listing_id),
            matchedAt,
          );
        }
        await tx.query(
          "UPDATE searches SET last_run_at=$3 WHERE id=$1 AND tenant_id=$2",
          [searchId, tenantId, Date.now()],
        );
      }
      const hasError = results.some((r) => r.status === "error" || r.truncated);
      const hasData = results.some(
        (r) => r.status === "ok" || r.status === "cached",
      );
      await tx.query(
        "UPDATE search_runs SET status=$2,finished_at=$3,matches=$4,new_matches=$5,results_json=$6 WHERE id=$1",
        [
          runId,
          hasError ? "partial" : hasData ? "completed" : "no_sources",
          Date.now(),
          matched.total,
          added,
          JSON.stringify(results),
        ],
      );
    });
    return {
      ...matched,
      listings: matched.listings.slice(0, 24),
      runId,
      newMatches: added,
      results,
    };
  } catch (error) {
    if (created)
      await db.query(
        "UPDATE search_runs SET status='failed',finished_at=$2 WHERE id=$1",
        [runId, Date.now()],
      );
    throw error;
  } finally {
    await releaseLock(lockId, token);
  }
}

export async function tickScheduler() {
  const token = await acquireLock("scheduler", 240_000);
  if (!token) return { skipped: true, processed: 0 };
  let processed = 0;
  let failed = 0;
  try {
    const now = Date.now();
    await db.query(
      "INSERT INTO system_state(key,value) VALUES('scheduler_heartbeat',$1) ON CONFLICT(key) DO UPDATE SET value=$1",
      [String(now)],
    );
    await db.query(
      "UPDATE search_runs SET status='interrupted',finished_at=$1 WHERE status='running' AND started_at<$2",
      [now, now - 120_000],
    );
    const searches = await db.query<SavedSearch & { filters_json: string }>(
      `SELECT s.* FROM searches s JOIN tenants t ON t.id=s.tenant_id
      WHERE s.enabled=1 AND t.active=1 AND s.next_run_at<=$1 ORDER BY s.next_run_at LIMIT 3`,
      [now],
    );
    for (const search of searches) {
      try {
        const filters = filtersSchema.parse(JSON.parse(search.filters_json));
        await runSearch(search.tenant_id, filters, search.id);
        processed++;
        await db.query("UPDATE searches SET next_run_at=$2 WHERE id=$1", [
          search.id,
          Date.now() + search.interval_minutes * 60_000,
        ]);
      } catch {
        failed++;
        await db.query("UPDATE searches SET next_run_at=$2 WHERE id=$1", [
          search.id,
          Date.now() + 5 * 60_000,
        ]);
      }
    }
    await db.query("DELETE FROM sessions WHERE expires_at<$1", [now]);
    await db.query("DELETE FROM invitations WHERE expires_at<$1", [
      now - 7 * 86400_000,
    ]);
    await db.query("DELETE FROM rate_limits WHERE reset_at<$1", [
      now - 86400_000,
    ]);
    await db.query("DELETE FROM search_runs WHERE started_at<$1", [
      now - 90 * 86400_000,
    ]);
    return { processed, failed };
  } finally {
    await releaseLock("scheduler", token);
  }
}
