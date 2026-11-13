import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, closeDb } from "../src/lib/db";
import {
  filtersSchema,
  listingInputSchema,
  publicUrl,
} from "../src/lib/validation";
import {
  canonicalUrl,
  parseCsv,
  queryListings,
  upsertListings,
} from "../src/lib/listings";
import {
  decrypt,
  encrypt,
  hashPassword,
  rateLimit,
  verifyPassword,
} from "../src/lib/security";
import {
  acquireLock,
  releaseLock,
  runSearch,
  tickScheduler,
} from "../src/lib/search";
import {
  fetchMobile,
  mobileSearchUrl,
  normalizeMobileAd,
  projectMobileCredentials,
} from "../src/lib/providers";
import {
  createExternalSource,
  changeExternalSourceKey,
  getExternalSources,
} from "../src/lib/external-sources";
import { ingest } from "../src/lib/ingestion";
import type { Tenant, User } from "../src/lib/types";

const sourceAdmin: User = {
  id: "test-source-admin",
  tenant_id: null,
  email: "sources@example.test",
  name: "TEST Admin",
  role: "platform_admin",
};
const sourceTenant = (id: string): Tenant => ({
  id,
  name: "TEST",
  slug: id,
  active: 1,
  created_at: Date.now(),
});
const sourceRequest = (name: string) =>
  new Request("https://app.example.test/api/sources", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, website: "https://supplier.example.test" }),
  });
const feedRequest = (token: string, listings: unknown[]) =>
  new Request("https://app.example.test/api/ingest", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ listings }),
  });
const feedItem = (price = 15000) => ({
  externalId: "SAME-SUPPLIER-ID",
  url: "https://supplier.example.test/car/123",
  title: "TEST Supplier car",
  make: "BMW",
  model: "M2",
  price,
});

const directory = mkdtempSync(join(tmpdir(), "autoraum-tests-"));
process.env.SQLITE_PATH = join(directory, "test.sqlite");
process.env.DATA_ENCRYPTION_KEY = "b".repeat(64);
process.env.PUBLIC_MARKETPLACE_SEARCH = "0";
delete process.env.MOBILE_API_USERNAME;
delete process.env.MOBILE_API_PASSWORD;
if (process.env.TEST_DATABASE_URL)
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
else delete process.env.DATABASE_URL;
delete process.env.VERCEL;
const example = (id: string, overrides: Record<string, unknown> = {}) =>
  listingInputSchema.parse({
    externalId: id,
    source: "csv",
    url: `https://fixtures.example.test/cars/${id}`,
    title: `TEST ONLY ${id}`,
    make: "BMW",
    model: "320d",
    price: 18000,
    year: 2020,
    mileage: 80000,
    city: "Regensburg",
    postalCode: "93047",
    fuel: "DIESEL",
    damaged: false,
    ...overrides,
  });

before(async () => {
  await db.query(
    "INSERT INTO tenants(id,name,slug,created_at) VALUES('tenant-a','Test A','test-a',$1),('tenant-b','Test B','test-b',$1),('tenant-off','Suspended','test-off',$1)",
    [Date.now()],
  );
  await db.query("UPDATE tenants SET active=0 WHERE id='tenant-off'");
});
after(async () => {
  await closeDb();
  rmSync(directory, { recursive: true, force: true });
});

test("passwords are salted, verified, and wrong passwords fail", async () => {
  const hash = await hashPassword("Unit-test-password-123");
  assert.equal(await verifyPassword("Unit-test-password-123", hash), true);
  assert.equal(await verifyPassword("incorrect", hash), false);
  assert.equal(await verifyPassword("incorrect", null), false);
  assert.notEqual(hash, await hashPassword("Unit-test-password-123"));
});
test("provider credentials use authenticated encryption", () => {
  const ciphertext = encrypt("private API credential");
  assert.equal(decrypt(ciphertext), "private API credential");
  assert.ok(!ciphertext.includes("credential"));
  const parts = ciphertext.split(".");
  parts[1] = Buffer.alloc(16).toString("base64url");
  assert.throws(() => decrypt(parts.join(".")));
});

test("project API credentials are server-managed and tenant-specific contracts retain precedence", async () => {
  const originalFetch = globalThis.fetch;
  process.env.MOBILE_API_USERNAME = "TEST-project-account";
  assert.equal(projectMobileCredentials(), null);
  process.env.MOBILE_API_PASSWORD = "TEST-project-password";
  const authorizations: string[] = [];
  globalThis.fetch = async (_url, options) => {
    authorizations.push(
      new Headers(options?.headers).get("authorization") || "",
    );
    return new Response(JSON.stringify({ ads: [], total: 0, maxPages: 0 }), {
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    await fetchMobile("tenant-a", { make: "BMW" });
    await db.query(
      "INSERT INTO provider_configs(tenant_id,mobile_credentials) VALUES('tenant-b',$1)",
      [
        encrypt(
          JSON.stringify({
            username: "TEST-tenant-account",
            password: "TEST-tenant-password",
          }),
        ),
      ],
    );
    await fetchMobile("tenant-b", { make: "BMW" });
    assert.deepEqual(authorizations, [
      `Basic ${Buffer.from("TEST-project-account:TEST-project-password").toString("base64")}`,
      `Basic ${Buffer.from("TEST-tenant-account:TEST-tenant-password").toString("base64")}`,
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.MOBILE_API_USERNAME;
    delete process.env.MOBILE_API_PASSWORD;
    await db.query("DELETE FROM provider_configs WHERE tenant_id='tenant-b'");
  }
});
test("validation rejects unsafe URLs, conflicting ranges and invalid budgets", () => {
  for (const url of [
    "javascript:alert(1)",
    "http://localhost/a",
    "https://127.0.0.1/a",
    "https://example.test@192.168.1.2/a",
  ])
    assert.equal(publicUrl.safeParse(url).success, false);
  assert.equal(
    filtersSchema.safeParse({ minPrice: 100, maxPrice: 0 }).success,
    false,
  );
  assert.equal(
    filtersSchema.safeParse({ minYear: 2024, maxYear: 2020 }).success,
    false,
  );
  assert.equal(filtersSchema.safeParse({ maxPrice: -1 }).success, false);
  assert.equal(filtersSchema.parse({ maxPrice: 0 }).maxPrice, 0);
});
test("CSV handles quoted separators, newlines, BOM, CRLF and semicolons", () => {
  assert.deepEqual(
    parseCsv('\ufeffid,title\r\n1,"Test, car"\r\n2,"two\nlines"\r\n'),
    [
      { id: "1", title: "Test, car" },
      { id: "2", title: "two\nlines" },
    ],
  );
  assert.deepEqual(parseCsv('id;title\n1;"a ""quote"""'), [
    { id: "1", title: 'a "quote"' },
  ]);
  assert.throws(() => parseCsv('id,title\n1,"unclosed'));
  assert.throws(() => parseCsv("id,title\n1,title,extra"));
  assert.throws(() => parseCsv("id,id\n1,2"));
  assert.equal(
    canonicalUrl("https://example.test/car?id=1&utm_source=x#part"),
    "https://example.test/car?id=1",
  );
});
test("upserts are tenant-scoped and retain first-seen without duplicates", async () => {
  assert.deepEqual(await upsertListings("tenant-a", [example("one")]), {
    added: 1,
    updated: 0,
    total: 1,
  });
  const first = (await queryListings("tenant-a")).listings[0];
  assert.equal(Object.getPrototypeOf(first), Object.prototype);
  assert.deepEqual(
    await upsertListings("tenant-a", [example("one", { price: 17000 })]),
    { added: 0, updated: 1, total: 1 },
  );
  await upsertListings("tenant-b", [example("one", { price: 9999 })]);
  const a = await queryListings("tenant-a");
  const b = await queryListings("tenant-b");
  assert.equal(a.total, 1);
  assert.equal(a.listings[0].price_cents, 1700000);
  assert.equal(a.listings[0].first_seen, first.first_seen);
  assert.equal(b.listings[0].price_cents, 999900);
  assert.notEqual(a.listings[0].id, b.listings[0].id);
});
test("older cached observations cannot overwrite a newer price or reactivate a removed listing", async () => {
  const listing = example("freshness", { active: false, price: 19000 });
  await upsertListings("tenant-a", [listing], 2000);
  const result = await upsertListings(
    "tenant-a",
    [{ ...listing, active: true, price: 18000 }],
    1000,
  );
  assert.equal(result.updated, 0);
  const [row] = await db.query<{
    price_cents: number;
    active: number;
    last_seen: number;
  }>(
    "SELECT price_cents,active,last_seen FROM listings WHERE tenant_id='tenant-a' AND external_id='freshness'",
  );
  assert.equal(row.price_cents, 1900000);
  assert.equal(row.active, 0);
  assert.equal(row.last_seen, 2000);
});

test("filtering respects budgets, unknown metadata, literal wildcards and source selection", async () => {
  await upsertListings("tenant-a", [
    example("two", {
      make: "AUDI",
      model: "A4",
      price: 25000,
      year: 2022,
      mileage: 50000,
    }),
    example("unknown", {
      year: undefined,
      mileage: undefined,
      damaged: undefined,
      model: "Other",
      price: 0,
    }),
    example("wildcard", { model: "100%_exact", damaged: true }),
  ]);
  assert.equal(
    (
      await queryListings("tenant-a", {
        make: "bmw",
        maxPrice: 20000,
        minYear: 2019,
        maxMileage: 90000,
        undamagedOnly: true,
      })
    ).total,
    1,
  );
  assert.equal((await queryListings("tenant-a", { model: "%_" })).total, 1);
  assert.equal((await queryListings("tenant-a", { maxPrice: 0 })).total, 1);
  assert.equal((await queryListings("tenant-a", { location: "930" })).total, 4);
  assert.equal(
    (await queryListings("tenant-a", { sources: ["mobile"] })).total,
    0,
  );
  assert.equal(
    (await queryListings("tenant-a", { make: "BMW' OR 1=1--" })).total,
    0,
  );
});
test("database composite foreign keys prevent cross-company references", async () => {
  const listing = (await queryListings("tenant-a")).listings[0];
  await assert.rejects(
    db.query(
      "INSERT INTO saved_listings(tenant_id,listing_id,updated_at) VALUES('tenant-b',$1,$2)",
      [listing.id, Date.now()],
    ),
  );
});
test("rate limiting is persisted and cannot be raced beyond the budget", async () => {
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, () => rateLimit("test-key", 4, 60_000)),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 4);
});
test("database leases permit a single owner and ignore a wrong unlock token", async () => {
  const claims = await Promise.all(
    Array.from({ length: 5 }, () => acquireLock("test-lock", 60_000)),
  );
  assert.equal(claims.filter(Boolean).length, 1);
  await releaseLock("test-lock", "wrong-token");
  assert.equal(await acquireLock("test-lock", 60_000), null);
  await releaseLock("test-lock", claims.find(Boolean)!);
  const next = await acquireLock("test-lock", 60_000);
  assert.ok(next);
  await releaseLock("test-lock", next);
});
test("mobile.de adapter maps the documented contract without inventing missing data", () => {
  const listing = normalizeMobileAd({
    mobileAdId: "TEST-123",
    make: "BMW",
    model: "320",
    modelDescription: "320d TEST",
    firstRegistration: "202007",
    mileage: 1234,
    fuel: "DIESEL",
    detailPageUrl:
      "https://suchen.mobile.de/fahrzeuge/details.html?id=TEST-123",
    price: { consumerPriceGross: "18999.99", currency: "EUR" },
    seller: {
      type: "DEALER",
      address: { city: "Regensburg", zipcode: "93047" },
    },
  });
  assert.ok(listing);
  assert.equal(listing.year, 2020);
  assert.equal(listing.price, 18999.99);
  assert.equal(listing.model, "320 320d TEST");
  assert.equal(listing.damaged, undefined);
  assert.equal(listing.imageUrl, undefined);
  assert.equal(normalizeMobileAd({ price: { currency: "USD" } }), null);
  const url = mobileSearchUrl(
    { make: "BMW", model: "320d", maxPrice: 0, minYear: 2020, maxMileage: 0 },
    2,
  );
  assert.equal(url.searchParams.get("page.number"), "2");
  assert.equal(url.searchParams.get("price.max"), "0");
  assert.equal(url.searchParams.get("mileage.max"), "0");
  assert.equal(
    mobileSearchUrl({ fuel: "HYBRID" }, 1).searchParams.get("fuel"),
    "HYBRID,HYBRID_DIESEL",
  );
});

test("mobile integration preserves documented photo sizes and distinguishes unknown fuel from other fuel", () => {
  const ad = {
    mobileAdId: "TEST-PHOTO",
    make: "BMW",
    model: "320",
    modelDescription: "320d TEST",
    detailPageUrl:
      "https://suchen.mobile.de/fahrzeuge/details.html?id=TEST-PHOTO",
    price: { consumerPriceGross: "18999", currency: "EUR" },
  };
  const withPhoto = normalizeMobileAd({
    ...ad,
    fuel: "HYBRID_DIESEL",
    images: [
      {
        s: "https://photos.example.test/small.jpg",
        xxxl: "https://photos.example.test/large.jpg",
      },
    ],
  });
  assert.equal(withPhoto?.imageUrl, "https://photos.example.test/large.jpg");
  assert.equal(withPhoto?.fuel, "HYBRID");
  const safeFallback = normalizeMobileAd({
    ...ad,
    images: [
      {
        xxxl: "https://127.0.0.1/private.jpg",
        xl: "https://photos.example.test/medium.jpg",
      },
    ],
  });
  assert.equal(
    safeFallback?.imageUrl,
    "https://photos.example.test/medium.jpg",
  );
  assert.equal(safeFallback?.fuel, "UNKNOWN");
  assert.equal(normalizeMobileAd({ ...ad, fuel: "LPG" })?.fuel, "OTHER");
  assert.equal(normalizeMobileAd({ ...ad, fuel: "NEW_FUEL" })?.fuel, "UNKNOWN");
  assert.equal(
    normalizeMobileAd({ ...ad, fuel: "constructor" })?.fuel,
    "UNKNOWN",
  );
  assert.equal(
    normalizeMobileAd({
      ...ad,
      images: [null, { xxxl: "javascript:alert(1)" }],
    })?.imageUrl,
    undefined,
  );
});
test("manual searches report source gaps honestly and persist successful cached matches", async () => {
  const result = await runSearch("tenant-a", { make: "AUDI" });
  assert.equal(result.total, 1);
  assert.equal(
    result.results.find((r) => r.source === "mobile.de")?.status,
    "disconnected",
  );
  assert.equal(
    result.results.find((r) => r.source === "CSV-Import")?.status,
    "cached",
  );
  const empty = await runSearch("tenant-off", {});
  assert.equal(empty.total, 0);
  const [run] = await db.query<{ status: string }>(
    "SELECT status FROM search_runs WHERE id=$1",
    [empty.runId],
  );
  assert.equal(run.status, "no_sources");
});
test("scheduled searches persist new matches once, advance next run, and skip suspended companies", async () => {
  await db.query(
    "INSERT INTO searches(id,tenant_id,name,filters_json,enabled,interval_minutes,next_run_at,created_at) VALUES('s-a','tenant-a','Test search',$1,1,15,$2,$2),('s-off','tenant-off','Suspended','{}',1,15,$2,$2)",
    [JSON.stringify({ make: "AUDI" }), Date.now() - 100],
  );
  const result = await tickScheduler();
  assert.equal(result.processed, 1);
  const [search] = await db.query<{ next_run_at: number; last_run_at: number }>(
    "SELECT * FROM searches WHERE id='s-a'",
  );
  assert.ok(search.next_run_at > Date.now());
  assert.ok(search.last_run_at);
  const [off] = await db.query<{ last_run_at: number | null }>(
    "SELECT last_run_at FROM searches WHERE id='s-off'",
  );
  assert.equal(off.last_run_at, null);
  const again = await runSearch("tenant-a", { make: "AUDI" }, "s-a");
  assert.equal(again.newMatches, 0);
  const [match] = await db.query<{ count: number }>(
    "SELECT COUNT(*) AS count FROM search_matches WHERE search_id='s-a'",
  );
  assert.equal(match.count, 1);
});

test("short model names exclude similarly named engines and other models", async () => {
  await upsertListings("tenant-b", [
    example("model-m2", { model: "M2 Competition" }),
    example("model-m235", { model: "M235i" }),
    example("model-m240", { model: "M240i" }),
  ]);
  const result = await queryListings("tenant-b", { make: "BMW", model: "m2" });
  assert.equal(result.total, 1);
  assert.equal(result.listings[0].model, "M2 Competition");
});

test("named providers retain distinct inventory, readable source names and private credentials", async () => {
  const tenant = sourceTenant("tenant-a");
  const first = await createExternalSource(
    sourceRequest("TEST Supplier A"),
    tenant,
    sourceAdmin,
  );
  const second = await createExternalSource(
    sourceRequest("TEST Supplier B"),
    tenant,
    sourceAdmin,
  );
  assert.deepEqual(await ingest(feedRequest(first.token, [feedItem()])), {
    added: 1,
    updated: 0,
    total: 1,
  });
  assert.deepEqual(await ingest(feedRequest(second.token, [feedItem(25000)])), {
    added: 1,
    updated: 0,
    total: 1,
  });
  assert.equal(
    (await ingest(feedRequest(first.token, [feedItem(16000)]))).updated,
    1,
  );
  const firstResult = await runSearch(
    tenant.id,
    filtersSchema.parse({ sources: [first.id] }),
  );
  const secondResult = await queryListings(tenant.id, { sources: [second.id] });
  assert.equal(firstResult.total, 1);
  assert.equal(firstResult.listings[0].price_cents, 1600000);
  assert.equal(firstResult.results[0].source, "TEST Supplier A");
  assert.equal(secondResult.listings[0].price_cents, 2500000);
  assert.notEqual(firstResult.listings[0].id, secondResult.listings[0].id);
  const sources = await getExternalSources(tenant.id);
  const meta = sources.find((source) => source.id === first.id)!;
  assert.equal(meta.listingCount, 1);
  assert.equal(meta.enabled, true);
  assert.ok(meta.lastFeedAt);
  assert.equal(JSON.stringify(sources).includes(first.token), false);
  assert.equal("token_hash" in meta, false);
  const [stored] = await db.query<{ token_hash: string }>(
    "SELECT token_hash FROM external_sources WHERE id=$1",
    [first.id],
  );
  assert.notEqual(stored.token_hash, first.token);
  assert.equal(stored.token_hash.length, 64);
  await ingest(feedRequest(first.token, [{ ...feedItem(), active: false }]));
  assert.equal(
    (await getExternalSources(tenant.id)).find((s) => s.id === first.id)
      ?.listingCount,
    0,
  );
});

test("provider credentials reject source spoofing and foreign or unknown source IDs atomically", async () => {
  const tenant = sourceTenant("tenant-a");
  const first = await createExternalSource(
    sourceRequest("TEST Limited Supplier"),
    tenant,
    sourceAdmin,
  );
  const foreign = await createExternalSource(
    sourceRequest("TEST Foreign Supplier"),
    sourceTenant("tenant-b"),
    sourceAdmin,
  );
  for (const source of ["mobile", foreign.id]) {
    await assert.rejects(
      ingest(feedRequest(first.token, [feedItem(), { ...feedItem(), source }])),
      { status: 400 },
    );
  }
  assert.equal(
    (await queryListings(tenant.id, { sources: [first.id] })).total,
    0,
  );
  const unknown = "feed:00000000-0000-0000-0000-000000000000";
  for (const source of [foreign.id, unknown] as const) {
    await assert.rejects(
      upsertListings(tenant.id, [
        example("must-not-write"),
        example("foreign-source", { source }),
      ]),
      { status: 400 },
    );
    await assert.rejects(runSearch(tenant.id, { sources: [source] }), {
      status: 400,
    });
  }
  const inserted = await db.query(
    "SELECT id FROM listings WHERE external_id='must-not-write'",
  );
  assert.equal(inserted.length, 0);
  await assert.rejects(
    changeExternalSourceKey(tenant, sourceAdmin, foreign.id, false),
    { status: 404 },
  );
  assert.equal(
    (await ingest(feedRequest(foreign.token, [feedItem()]))).added,
    1,
  );
});

test("provider key rotation and revocation take effect while suspended tenants cannot ingest", async () => {
  const tenant = sourceTenant("tenant-a");
  const source = await createExternalSource(
    sourceRequest("TEST Rotate Supplier"),
    tenant,
    sourceAdmin,
  );
  const rotated = await changeExternalSourceKey(
    tenant,
    sourceAdmin,
    source.id,
    false,
  );
  assert.ok(rotated.token);
  await assert.rejects(ingest(feedRequest(source.token, [feedItem()])), {
    status: 401,
  });
  await ingest(feedRequest(rotated.token, [feedItem()]));
  const revoked = await changeExternalSourceKey(
    tenant,
    sourceAdmin,
    source.id,
    true,
  );
  assert.equal(revoked.token, null);
  await assert.rejects(ingest(feedRequest(rotated.token, [feedItem()])), {
    status: 401,
  });
  const meta = (await getExternalSources(tenant.id)).find(
    (s) => s.id === source.id,
  )!;
  assert.equal(meta.enabled, false);
  assert.equal(meta.listingCount, 1);
  const suspended = await createExternalSource(
    sourceRequest("TEST Suspended Supplier"),
    sourceTenant("tenant-off"),
    sourceAdmin,
  );
  await assert.rejects(ingest(feedRequest(suspended.token, [feedItem()])), {
    status: 401,
  });
});
