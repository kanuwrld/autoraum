import { db } from "./db";
import { queryListings } from "./listings";
import { projectMobileCredentials } from "./providers";
import { getExternalSources } from "./external-sources";
import type { SavedSearch, SearchRun, Tenant, User, Workspace } from "./types";
import { inboxSummary } from "./inbox";
import { taskMembers, taskSummary } from "./tasks";

export async function getWorkspace(
  tenant: Tenant,
  user: User,
): Promise<Workspace> {
  const [
    searches,
    listings,
    count,
    savedCount,
    newCount,
    config,
    runs,
    heartbeat,
    externalSources,
    inbox,
    members,
    taskStats,
  ] = await Promise.all([
    db.query<Omit<SavedSearch, "filters"> & { filters_json: string }>(
      `SELECT s.*,(SELECT COUNT(*) FROM search_matches m WHERE m.search_id=s.id) AS match_count FROM searches s WHERE s.tenant_id=$1 ORDER BY s.created_at DESC`,
      [tenant.id],
    ),
    queryListings(tenant.id),
    db.query<{ count: number }>(
      "SELECT COUNT(*) AS count FROM listings WHERE tenant_id=$1 AND active=1",
      [tenant.id],
    ),
    db.query<{ count: number }>(
      "SELECT COUNT(*) AS count FROM saved_listings WHERE tenant_id=$1 AND stage!='rejected'",
      [tenant.id],
    ),
    db.query<{ count: number }>(
      "SELECT COUNT(*) AS count FROM listings WHERE tenant_id=$1 AND first_seen>=$2 AND active=1",
      [tenant.id, Date.now() - 86400_000],
    ),
    db.query<{
      mobile_credentials: string | null;
      mobile_updated_at: number | null;
      feed_token_hash: string | null;
      last_feed_at: number | null;
    }>("SELECT * FROM provider_configs WHERE tenant_id=$1", [tenant.id]),
    db.query<Omit<SearchRun, "results"> & { results_json: string }>(
      "SELECT r.*,s.name AS search_name FROM search_runs r LEFT JOIN searches s ON s.id=r.search_id WHERE r.tenant_id=$1 ORDER BY r.started_at DESC LIMIT 20",
      [tenant.id],
    ),
    db.query<{ value: string }>(
      "SELECT value FROM system_state WHERE key='scheduler_heartbeat'",
    ),
    getExternalSources(tenant.id),
    inboxSummary(tenant.id, user.id),
    taskMembers(tenant.id),
    taskSummary(tenant.id, user.id),
  ]);
  return {
    asOf: Date.now(),
    tenant,
    user,
    searches: searches.map(({ filters_json, ...s }) => ({
      ...s,
      filters: JSON.parse(filters_json),
    })),
    ...listings,
    stats: {
      listings: Number(count[0].count),
      saved: Number(savedCount[0].count),
      searches: searches.filter((s) => s.enabled).length,
      newToday: Number(newCount[0].count),
    },
    providers: {
      publicSearch: process.env.PUBLIC_MARKETPLACE_SEARCH === "1",
      mobile: !!config[0]?.mobile_credentials || !!projectMobileCredentials(),
      mobileProject:
        !config[0]?.mobile_credentials && !!projectMobileCredentials(),
      feed: !!config[0]?.feed_token_hash,
      mobileUpdated: config[0]?.mobile_updated_at || null,
      lastFeed: config[0]?.last_feed_at || null,
    },
    runs: runs.map(({ results_json, ...r }) => ({
      ...r,
      results: JSON.parse(results_json),
    })),
    schedulerHeartbeat: heartbeat[0] ? Number(heartbeat[0].value) : null,
    externalSources,
    inbox,
    members,
    taskStats,
  };
}
