import { after, before, beforeEach, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, closeDb } from "../src/lib/db";
import {
  parseAutoScout,
  parseKleinanzeigen,
  fetchPublic,
} from "../src/lib/public-providers";
import { autoScoutUrl, kleinanzeigenUrl } from "../src/lib/marketplace-links";
import { upsertListings } from "../src/lib/listings";
import { listingImageSources } from "../src/lib/listing-images";
import { runSearch } from "../src/lib/search";
import {
  pkwPage,
  heroPage,
  marktPage,
  quokaPage,
  autoPage,
} from "./additional-fixtures";

const directory = mkdtempSync(join(tmpdir(), "autoraum-public-tests-"));
process.env.SQLITE_PATH = join(directory, "test.sqlite");
process.env.PUBLIC_MARKETPLACE_SEARCH = "1";
if (process.env.TEST_DATABASE_URL)
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
else delete process.env.DATABASE_URL;
delete process.env.VERCEL;
const originalFetch = globalThis.fetch;
const ad = {
  id: "test-scout-id",
  title: "BMW M2",
  url: "/angebote/test-scout-id",
  price: { priceRaw: 39990 },
  images: ["https://images.example.test/car.jpg"],
  vehicle: {
    make: "BMW",
    model: "M2",
    modelVersionInput: "Competition",
    fuel: "Benzin",
    transmission: "Automatik",
    mileageInKm: "54.000 km",
    isCurrentlyDamaged: false,
  },
  location: { countryCode: "DE", zip: "93055", city: "Regensburg" },
  seller: { type: "Dealer" },
  vehicleDetails: [{ iconName: "calendar", data: "06/2020" }],
};
const scoutPage = (ads: unknown[] = [ad], total = ads.length) =>
  `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { listings: ads, numberOfResults: total, numberOfPages: total > ads.length ? 3 : 1 } } })}</script>`;
const kleinPage = `<main><article data-adid="test-klein-id" data-href="/s-anzeige/test/123-216-1"><h3>BMW M2 Competition</h3><p>39.900 € VB</p><p><span>57.400 km</span><span>EZ 12/2020</span></p><div><svg data-title="locationOutline"></svg><span>93055 Regensburg</span></div><img src="https://images.example.test/car.jpg"></article></main>`;
before(async () => {
  await db.query(
    "INSERT INTO tenants(id,name,slug,created_at) VALUES('public-test','TEST','public-test',$1)",
    [Date.now()],
  );
});
beforeEach(async () => {
  await db.query("DELETE FROM system_state WHERE key LIKE 'source-pause:%'");
});
after(async () => {
  globalThis.fetch = originalFetch;
  await closeDb();
  rmSync(directory, { recursive: true, force: true });
});

test("public pages normalize prices, registration, mileage and unknown facts conservatively", () => {
  const a = parseAutoScout(scoutPage()).items[0];
  assert.equal(a.price, 39990);
  assert.equal(a.year, 2020);
  assert.equal(a.mileage, 54000);
  assert.equal(a.damaged, false);
  assert.equal(a.fuel, "PETROL");
  const k = parseKleinanzeigen(kleinPage).items[0];
  assert.equal(k.price, 39900);
  assert.equal(k.year, 2020);
  assert.equal(k.mileage, 57400);
  assert.equal(k.city, "Regensburg");
  assert.equal(k.damaged, undefined);
  assert.equal(k.sellerType, "UNKNOWN");
  assert.equal(k.transmission, "");
});
test("a challenge or changed markup is a source error, never a zero-result success", () => {
  assert.throws(() =>
    parseAutoScout("<html><h1>Verify you are human</h1></html>"),
  );
  assert.throws(() =>
    parseKleinanzeigen("<html><h1>Access denied</h1></html>"),
  );
  assert.equal(parseAutoScout(scoutPage([])).items.length, 0);
  assert.equal(
    parseKleinanzeigen("<main>Keine Anzeigen gefunden</main>").items.length,
    0,
  );
});
test("external navigation and malformed prices cannot become imported listings", () => {
  const parsed = parseAutoScout(
    scoutPage([
      ad,
      { ...ad, id: "evil", url: "https://evil.example.test/" },
      { ...ad, id: "negative", price: { priceRaw: -100 } },
    ]),
  );
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.skipped, 2);
  assert.equal(
    parseKleinanzeigen(
      kleinPage.replace(
        "/s-anzeige/test/123-216-1",
        "https://evil.example.test/",
      ),
    ).items.length,
    0,
  );
  assert.equal(
    parseKleinanzeigen(kleinPage.replace("39.900 € VB", "399 € monatlich"))
      .items.length,
    0,
  );
});
test("model routes filter AutoScout; visual packages do not turn a 228i into an M2", () => {
  const url = autoScoutUrl({
    make: "BMW",
    model: "m2",
    maxPrice: 60000,
    maxMileage: 80000,
  });
  assert.equal(url.pathname, "/lst/bmw/m2");
  assert.equal(url.searchParams.get("priceto"), "60000");
  assert.equal(url.searchParams.get("kmto"), "80000");
  assert.equal(
    autoScoutUrl({ make: "BMW", model: "320d" }).pathname,
    "/lst/bmw/320",
  );
  assert.equal(
    autoScoutUrl({ make: "VOLKSWAGEN", model: "Golf GTI" }).pathname,
    "/lst/volkswagen/golf",
  );
  assert.ok(
    kleinanzeigenUrl({
      make: "BMW",
      model: "m2",
      maxPrice: 60000,
    }).href.includes("preis::60000"),
  );
  assert.equal(
    parseKleinanzeigen(
      kleinPage.replace("BMW M2 Competition", "BMW F22 228i M2 Optik"),
    ).items[0].model,
    "228i",
  );
});
test("cache prevents repeat network requests and preserves the real observation time", async () => {
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    assert.equal(options?.redirect, "error");
    return new Response(scoutPage(), {
      headers: { "Content-Type": "text/html" },
    });
  };
  const f = { make: "BMW", model: "m2", maxPrice: 49991 };
  const first = await fetchPublic("autoscout", f);
  const second = await fetchPublic("autoscout", f);
  assert.equal(calls, 1);
  assert.equal(first.result.status, "ok");
  assert.equal(second.result.status, "cached");
  assert.equal(first.observedAt, second.observedAt);
  await upsertListings("public-test", second.items, second.observedAt);
  const [row] = await db.query<{ last_seen: number }>(
    "SELECT last_seen FROM listings WHERE tenant_id='public-test'",
  );
  assert.equal(row.last_seen, first.observedAt);
});
test("403 and 429 stop immediately without bypass or successful empty cache", async () => {
  for (const status of [403, 429]) {
    await db.query(
      "DELETE FROM system_state WHERE key='source-pause:autoscout'",
    );
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response("Access denied", { status });
    };
    await assert.rejects(
      fetchPublic("autoscout", { make: "BMW", maxPrice: status }),
      /HTTP (403|429)/,
    );
    assert.equal(calls, 1);
  }
});

test("an interrupted public GET retries once without credentials while retaining the deadline", async () => {
  let calls = 0;
  let signal: AbortSignal | null | undefined;
  globalThis.fetch = async (_url, options) => {
    calls++;
    if (calls === 1) {
      signal = options?.signal;
      throw new TypeError("fetch failed", {
        cause: Object.assign(new Error("socket interrupted"), {
          code: "ECONNRESET",
        }),
      });
    }
    assert.equal(options?.signal, signal);
    return new Response(pkwPage(), {
      headers: { "Content-Type": "application/json" },
    });
  };
  const result = await fetchPublic("pkw", {
    make: "AUDI",
    model: "A4",
    maxPrice: 19999,
  });
  assert.equal(calls, 2);
  assert.equal(result.items.length, 1);
  assert.equal(result.result.status, "ok");
});

test("simultaneous identical searches share one fetch and observation timestamp", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    await delay(50);
    return new Response(scoutPage(), {
      headers: { "Content-Type": "text/html" },
    });
  };
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      fetchPublic("autoscout", { make: "BMW", maxPrice: 51001 }),
    ),
  );
  assert.equal(calls, 1);
  assert.equal(results.filter((r) => r.result.status === "ok").length, 1);
  assert.equal(new Set(results.map((r) => r.observedAt)).size, 1);
  assert.equal(
    (await db.query("SELECT id FROM job_locks WHERE id LIKE 'public-%'"))
      .length,
    0,
  );
});

test("different searches obey the shared two-request concurrency limit", async () => {
  let current = 0;
  let peak = 0;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    current++;
    peak = Math.max(peak, current);
    await delay(80);
    current--;
    return new Response(scoutPage(), {
      headers: { "Content-Type": "text/html" },
    });
  };
  await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      fetchPublic("autoscout", { make: "BMW", maxPrice: 52001 + i }),
    ),
  );
  assert.equal(calls, 5);
  assert.equal(peak, 2);
});

test("source cooldown applies to other searches and honors Retry-After", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response("Rate limited", {
      status: 429,
      headers: { "Retry-After": "3600" },
    });
  };
  const started = Date.now();
  await assert.rejects(
    fetchPublic("autoscout", { maxPrice: 53001 }),
    /HTTP 429/,
  );
  await assert.rejects(
    fetchPublic("autoscout", { maxPrice: 53002 }),
    /pausiert/,
  );
  assert.equal(calls, 1);
  const [pause] = await db.query<{ value: string }>(
    "SELECT value FROM system_state WHERE key='source-pause:autoscout'",
  );
  assert.ok(Number(pause.value) >= started + 3600_000);
});

test("source failure serves bounded stale cache without changing the observation time", async () => {
  const filters = { make: "BMW", maxPrice: 54001 };
  globalThis.fetch = async () =>
    new Response(scoutPage(), { headers: { "Content-Type": "text/html" } });
  const first = await fetchPublic("autoscout", filters);
  await db.query(
    "UPDATE public_search_cache SET expires_at=0 WHERE fetched_at=$1",
    [first.observedAt],
  );
  globalThis.fetch = async () => new Response("Unavailable", { status: 503 });
  const stale = await fetchPublic("autoscout", filters);
  assert.equal(stale.result.status, "cached");
  assert.equal(stale.result.stale, true);
  assert.equal(stale.result.truncated, true);
  assert.equal(stale.observedAt, first.observedAt);
  assert.match(stale.result.message, /Aktuelle Aktualisierung nicht möglich/);
  await db.query(
    "UPDATE public_search_cache SET fetched_at=$1 WHERE fetched_at=$2",
    [Date.now() - 25 * 3600_000, first.observedAt],
  );
  await assert.rejects(fetchPublic("autoscout", filters), /pausiert/);
});

test("image upgrades target verified CDNs, retain fallbacks and preserve unrelated URLs", () => {
  const scout =
    "https://prod.pictures.autoscout24.net/listing-images/test.jpg/250x188.webp";
  assert.deepEqual(listingImageSources(scout), [
    scout.replace("250x188", "1280x960"),
    scout,
  ]);
  const klein =
    "https://img.kleinanzeigen.de/api/v1/prod-ads/images/test?rule=$_2.AUTO";
  assert.equal(
    new URL(listingImageSources(klein)[0]).searchParams.get("rule"),
    "$_59.AUTO",
  );
  assert.equal(listingImageSources(klein)[1], klein);
  const signed = "https://photos.example.test/250x188.webp?signature=keep";
  assert.deepEqual(listingImageSources(signed), [signed]);
  assert.deepEqual(listingImageSources("javascript:alert(1)"), []);
  assert.deepEqual(listingImageSources(null), []);
});
test("second-page failure returns clearly limited first-page results", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return calls === 1
      ? new Response(scoutPage([ad], 30), {
          headers: { "Content-Type": "text/html" },
        })
      : new Response("Unavailable", { status: 503 });
  };
  const result = await fetchPublic("autoscout", {
    make: "BMW",
    model: "m2",
    maxPrice: 49992,
  });
  assert.equal(calls, 2);
  assert.equal(result.items.length, 1);
  assert.equal(result.result.truncated, true);
  assert.match(result.result.message, /Weitere Seite/);
});

test("all five new sources take part in real search orchestration, persist cars and obey source filters", async () => {
  const hosts = new Set<string>();
  const pages: Record<string, string> = {
    "www.pkw.de": pkwPage(),
    "www.autohero.com": heroPage(),
    "www.markt.de": marktPage,
    "www.quoka.de": quokaPage,
    "www.auto.de": autoPage(),
  };
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    hosts.add(url.hostname);
    assert.equal(new Headers(options?.headers).has("Authorization"), false);
    assert.equal(new Headers(options?.headers).has("Cookie"), false);
    assert.ok(pages[url.hostname]);
    return new Response(pages[url.hostname], {
      headers: {
        "Content-Type":
          url.hostname === "www.pkw.de" ? "application/json" : "text/html",
      },
    });
  };
  const sources = ["pkw", "autohero", "markt", "quoka", "autode"] as const;
  const result = await runSearch("public-test", {
    make: "AUDI",
    model: "A4",
    maxPrice: 20000,
    sources: [...sources],
  });
  assert.equal(result.total, 5);
  assert.equal(hosts.size, 5);
  assert.deepEqual(
    result.results.map((r) => r.sourceId).sort(),
    [...sources].sort(),
  );
  assert.ok(result.results.every((r) => r.status === "ok" && r.count === 1));
  const again = await runSearch("public-test", {
    make: "AUDI",
    model: "A4",
    maxPrice: 20000,
    sources: ["pkw"],
  });
  assert.equal(again.total, 1);
  assert.equal(again.results[0].status, "cached");
  assert.equal(again.listings[0].source, "pkw");
});

test("single-page sources mark larger selections limited without repeating the same page", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(heroPage(undefined, 200), {
      headers: { "Content-Type": "text/html" },
    });
  };
  const result = await fetchPublic("autohero", {
    make: "AUDI",
    model: "A4",
    maxPrice: 20001,
  });
  assert.equal(calls, 1);
  assert.equal(result.result.truncated, true);
  assert.equal(result.items.length, 1);
});
