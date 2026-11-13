export const schema = `
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1, created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, tenant_id TEXT REFERENCES tenants(id), email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('platform_admin','owner','buyer')),
  password_hash TEXT, created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE TABLE IF NOT EXISTS invitations (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL, used_at BIGINT
);
CREATE TABLE IF NOT EXISTS searches (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL,
  filters_json TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
  interval_minutes INTEGER NOT NULL DEFAULT 60, next_run_at BIGINT, last_run_at BIGINT,
  created_at BIGINT NOT NULL, UNIQUE(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS searches_due_idx ON searches(enabled,next_run_at);
CREATE INDEX IF NOT EXISTS searches_tenant_idx ON searches(tenant_id);
CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), source TEXT NOT NULL,
  external_id TEXT NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL, make TEXT NOT NULL, model TEXT NOT NULL,
  price_cents BIGINT NOT NULL CHECK(price_cents >= 0), year INTEGER, mileage INTEGER,
  fuel TEXT NOT NULL, transmission TEXT NOT NULL, city TEXT NOT NULL, postal_code TEXT NOT NULL,
  seller_type TEXT NOT NULL, image_url TEXT, damaged INTEGER, first_seen BIGINT NOT NULL,
  last_seen BIGINT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(tenant_id,source,external_id), UNIQUE(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS listings_filter_idx ON listings(tenant_id,active,make,price_cents);
CREATE INDEX IF NOT EXISTS listings_seen_idx ON listings(tenant_id,last_seen);
CREATE TABLE IF NOT EXISTS saved_listings (
  tenant_id TEXT NOT NULL, listing_id TEXT NOT NULL, stage TEXT NOT NULL DEFAULT 'saved',
  notes TEXT NOT NULL DEFAULT '', target_price_cents BIGINT, costs_cents BIGINT, sale_price_cents BIGINT,
  updated_at BIGINT NOT NULL, PRIMARY KEY(tenant_id,listing_id),
  FOREIGN KEY(tenant_id,listing_id) REFERENCES listings(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS search_matches (
  tenant_id TEXT NOT NULL, search_id TEXT NOT NULL, listing_id TEXT NOT NULL, first_seen BIGINT NOT NULL,
  PRIMARY KEY(search_id,listing_id),
  FOREIGN KEY(tenant_id,search_id) REFERENCES searches(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,listing_id) REFERENCES listings(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS search_runs (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), search_id TEXT REFERENCES searches(id) ON DELETE SET NULL,
  status TEXT NOT NULL, started_at BIGINT NOT NULL, finished_at BIGINT,
  matches INTEGER NOT NULL DEFAULT 0, new_matches INTEGER NOT NULL DEFAULT 0, results_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS runs_tenant_idx ON search_runs(tenant_id,started_at);
CREATE TABLE IF NOT EXISTS provider_configs (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id), mobile_credentials TEXT,
  mobile_updated_at BIGINT, feed_token_hash TEXT UNIQUE, last_feed_at BIGINT
);
CREATE TABLE IF NOT EXISTS external_sources (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL, website TEXT NOT NULL, token_hash TEXT UNIQUE,
  last_feed_at BIGINT, created_at BIGINT NOT NULL, UNIQUE(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS external_sources_tenant_idx ON external_sources(tenant_id);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY, actor_id TEXT, tenant_id TEXT, action TEXT NOT NULL, created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS job_locks (id TEXT PRIMARY KEY, token TEXT NOT NULL, expires_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS system_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS public_search_cache (
  cache_key TEXT PRIMARY KEY, source TEXT NOT NULL, payload_json TEXT NOT NULL,
  fetched_at BIGINT NOT NULL, expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS public_search_cache_expiry_idx ON public_search_cache(expires_at);
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at BIGINT NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS users_tenant_id_unique ON users(tenant_id,id);
CREATE TABLE IF NOT EXISTS inbox_items (
  tenant_id TEXT NOT NULL, listing_id TEXT NOT NULL, created_at BIGINT NOT NULL,
  search_name TEXT NOT NULL, PRIMARY KEY(tenant_id,listing_id),
  FOREIGN KEY(tenant_id,listing_id) REFERENCES listings(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS inbox_created_idx ON inbox_items(tenant_id,created_at,listing_id);
CREATE TABLE IF NOT EXISTS inbox_reads (
  tenant_id TEXT NOT NULL, listing_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, read_at BIGINT NOT NULL,
  PRIMARY KEY(tenant_id,listing_id,user_id),
  FOREIGN KEY(tenant_id,listing_id) REFERENCES inbox_items(tenant_id,listing_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS inbox_reads_user_idx ON inbox_reads(tenant_id,user_id);
CREATE TABLE IF NOT EXISTS purchase_plans (
  tenant_id TEXT NOT NULL, listing_id TEXT NOT NULL,
  transport_cents BIGINT CHECK(transport_cents >= 0), repairs_cents BIGINT CHECK(repairs_cents >= 0),
  preparation_cents BIGINT CHECK(preparation_cents >= 0), fees_cents BIGINT CHECK(fees_cents >= 0),
  reserve_cents BIGINT CHECK(reserve_cents >= 0), desired_profit_cents BIGINT CHECK(desired_profit_cents >= 0),
  PRIMARY KEY(tenant_id,listing_id),
  FOREIGN KEY(tenant_id,listing_id) REFERENCES saved_listings(tenant_id,listing_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), listing_id TEXT,
  title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', assignee_id TEXT NOT NULL,
  due_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','done')),
  version INTEGER NOT NULL DEFAULT 1, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  completed_at BIGINT, created_by TEXT NOT NULL REFERENCES users(id),
  FOREIGN KEY(tenant_id,listing_id) REFERENCES listings(tenant_id,id),
  FOREIGN KEY(tenant_id,assignee_id) REFERENCES users(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS tasks_due_idx ON tasks(tenant_id,status,due_date,id);
CREATE INDEX IF NOT EXISTS tasks_assignee_idx ON tasks(tenant_id,assignee_id,status,due_date);
CREATE INDEX IF NOT EXISTS tasks_listing_idx ON tasks(tenant_id,listing_id);
CREATE TABLE IF NOT EXISTS blocked_users (
  user_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL,
  blocked_at BIGINT NOT NULL, blocked_by TEXT NOT NULL REFERENCES users(id),
  FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id) ON DELETE CASCADE
);
`;
