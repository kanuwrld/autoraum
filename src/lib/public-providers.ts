import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { load } from "cheerio";
import { z } from "zod";
import { db } from "./db";
import { HttpError, rateLimit } from "./security";
import { listingInputSchema, type ListingInput } from "./validation";
import { publicSearchUrl, pkwUrl } from "./marketplace-links";
import {
  sourceNames,
  type PublicSource,
  type Filters,
  type SourceResult,
} from "./types";
import { acquireLock, releaseLock } from "./locks";
import {
  parsePkw,
  parseAutohero,
  parseQuoka,
  parseMarkt,
  parseAutode,
} from "./additional-providers";

import {
  digits,
  fuelType,
  transmission,
  trustedUrl,
  makes,
  type ParsedPage,
} from "./public-parser-utils";
const sourceLabels = sourceNames;
const TTL = 5 * 60_000;
const MAX_PAGES = 2;
const pageLimits: Partial<Record<PublicSource, number>> = {
  autohero: 1,
  markt: 1,
  autode: 1,
};
const CACHE_VERSION = "public-v5";
const MAX_BYTES = 6_000_000;
const DEADLINE_MS = 25_000;
const LEASE_MS = 35_000;
const MAX_STALE_MS = 24 * 3600_000;
type PublicResponse = {
  items: ListingInput[];
  observedAt: number;
  result: SourceResult;
};

class SourceUnavailable extends HttpError {
  constructor(
    message: string,
    readonly pauseMs: number,
  ) {
    super(502, message);
  }
}

async function pauseSource(source: PublicSource, duration: number) {
  await db.query(
    `INSERT INTO system_state(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE
     SET value=CASE WHEN CAST(system_state.value AS BIGINT)>CAST($2 AS BIGINT) THEN system_state.value ELSE $2 END`,
    [`source-pause:${source}`, String(Date.now() + duration)],
  );
}

async function ensureSourceReady(source: PublicSource) {
  const [pause] = await db.query<{ value: string }>(
    "SELECT value FROM system_state WHERE key=$1",
    [`source-pause:${source}`],
  );
  if (pause && Number(pause.value) > Date.now())
    throw new HttpError(
      503,
      `${sourceLabels[source]} ist vorübergehend pausiert. Nächster Abruf frühestens in ${Math.ceil((Number(pause.value) - Date.now()) / 60_000)} Min. Gespeicherte Angebote bleiben verfügbar.`,
    );
}

async function readCached(
  source: PublicSource,
  key: string,
  searchUrl: string,
  stale = false,
): Promise<PublicResponse | null> {
  const [row] = await db.query<{
    payload_json: string;
    fetched_at: number;
    expires_at: number;
  }>(
    "SELECT payload_json,fetched_at,expires_at FROM public_search_cache WHERE cache_key=$1",
    [key],
  );
  if (
    !row ||
    (stale
      ? row.fetched_at < Date.now() - MAX_STALE_MS
      : row.expires_at <= Date.now())
  )
    return null;
  let payload;
  try {
    payload = z
      .object({
        items: z.array(listingInputSchema),
        more: z.boolean(),
        skipped: z.number(),
        partial: z.boolean().optional(),
      })
      .parse(JSON.parse(row.payload_json));
  } catch {
    return null;
  }
  return {
    items: payload.items,
    observedAt: row.fetched_at,
    result: {
      sourceId: source,
      source: sourceLabels[source],
      status: "cached",
      count: payload.items.length,
      truncated: stale || payload.more || payload.partial,
      fetchedAt: row.fetched_at,
      searchUrl,
      stale,
      message: stale
        ? `${payload.items.length} gespeicherte Anzeigen. Aktuelle Aktualisierung nicht möglich; Datenstand ${new Date(row.fetched_at).toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}. Verfügbarkeit im Original prüfen.`
        : `${payload.items.length} Anzeigen aus dem letzten Abruf (maximal 5 Minuten alt).${payload.more ? " Begrenzter Ausschnitt; Filter eingrenzen." : ""}${payload.partial ? " Weitere Seite beim letzten Abruf nicht erreichbar." : ""}`,
    },
  };
}

const scoutAdSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  price: z.object({ priceRaw: z.number() }),
  images: z.array(z.string()).optional(),
  vehicle: z.object({
    make: z.string(),
    model: z.string(),
    modelVersionInput: z.string().nullish(),
    fuel: z.string().optional(),
    transmission: z.string().optional(),
    mileageInKm: z.string().optional(),
    isCurrentlyDamaged: z.boolean().optional(),
  }),
  location: z.object({
    countryCode: z.string(),
    zip: z.string().optional(),
    city: z.string().optional(),
  }),
  seller: z.object({ type: z.string() }).optional(),
  vehicleDetails: z
    .array(z.object({ iconName: z.string(), data: z.string() }))
    .optional(),
});
export function parseAutoScout(html: string, page = 1): ParsedPage {
  const $ = load(html);
  const script = $("script#__NEXT_DATA__").text();
  if (!script)
    throw new HttpError(
      502,
      "AutoScout24 hat keine lesbaren Suchergebnisse geliefert. Bitte direkt auf der Plattform prüfen.",
    );
  const body = z
    .object({
      props: z.object({
        pageProps: z.object({
          listings: z.array(z.unknown()),
          numberOfResults: z.number(),
          numberOfPages: z.number().optional(),
        }),
      }),
    })
    .parse(JSON.parse(script));
  const data = body.props.pageProps;
  const items: ListingInput[] = [];
  for (const raw of data.listings) {
    const parsed = scoutAdSchema.safeParse(raw);
    if (!parsed.success || parsed.data.location.countryCode !== "DE") continue;
    const ad = parsed.data;
    const registration = ad.vehicleDetails?.find(
      (d) => d.iconName === "calendar",
    )?.data;
    try {
      const item = listingInputSchema.safeParse({
        externalId: ad.id,
        source: "autoscout",
        url: trustedUrl(ad.url, "https://www.autoscout24.de"),
        title: `${ad.title} ${ad.vehicle.modelVersionInput || ""}`
          .trim()
          .slice(0, 250),
        make: ad.vehicle.make,
        model: `${ad.vehicle.model} ${ad.vehicle.modelVersionInput || ""}`
          .trim()
          .slice(0, 100),
        price: ad.price.priceRaw,
        year: registration?.match(/\b(19\d{2}|20\d{2})\b/)?.[1],
        mileage: digits(ad.vehicle.mileageInKm),
        fuel: fuelType(ad.vehicle.fuel || ""),
        transmission: transmission(ad.vehicle.transmission || ""),
        city: ad.location.city || "",
        postalCode: ad.location.zip || "",
        sellerType:
          ad.seller?.type === "Dealer"
            ? "DEALER"
            : ad.seller?.type === "Private"
              ? "PRIVATE"
              : "UNKNOWN",
        imageUrl: ad.images?.[0],
        damaged: ad.vehicle.isCurrentlyDamaged,
      });
      if (item.success) items.push(item.data);
    } catch {
      /* Reject untrusted listing URLs without dropping the page. */
    }
  }
  return {
    items,
    more:
      data.numberOfPages !== undefined
        ? data.numberOfPages > page
        : data.numberOfResults > data.listings.length * page,
    skipped: data.listings.length - items.length,
  };
}

export function parseKleinanzeigen(html: string): ParsedPage {
  const $ = load(html);
  const cards = $("article[data-adid][data-href]");
  // A changed layout or a challenge must never look like a successful empty search.
  if (
    !cards.length &&
    !/keine (anzeigen|ergebnisse|treffer)|0 (anzeigen|ergebnisse)/i.test(
      $("main").text(),
    )
  ) {
    throw new HttpError(
      502,
      "Kleinanzeigen hat keine lesbare Ergebnisliste geliefert. Bitte direkt auf der Plattform prüfen.",
    );
  }
  const items: ListingInput[] = [];
  cards.each((_, element) => {
    const card = $(element);
    const title = card.find("h2,h3").first().text().trim();
    const make = makes.find((m) =>
      title.toLowerCase().startsWith(`${m.toLowerCase()} `),
    );
    const priceText = card
      .find("p")
      .toArray()
      .map((e) => $(e).text().trim())
      .find((t) => /^[\d.]+(?:,\d{2})?\s*€(?:\s*VB)?$/.test(t));
    if (!make || !priceText) return;
    const text = card
      .find("p,span")
      .toArray()
      .map((e) => $(e).text())
      .join(" ");
    const location =
      card.find('[data-title="locationOutline"]').parent().text().trim() ||
      card.find(".aditem-main--top--left").text().trim();
    const postcode = location.match(/\b\d{5}\b/)?.[0] || "";
    const modelWords = title.slice(make.length).trim().split(/\s+/);
    // Do not label a 228i with "M2 Optik" as an M2.
    const model =
      /^(F|G|E)\d{2,3}$/i.test(modelWords[0]) &&
      /^[A-Z]?\d/i.test(modelWords[1] || "")
        ? modelWords[1]
        : modelWords[0];
    try {
      const parsed = listingInputSchema.safeParse({
        externalId: card.attr("data-adid"),
        source: "kleinanzeigen",
        url: trustedUrl(
          card.attr("data-href") || "",
          "https://www.kleinanzeigen.de",
        ),
        title,
        make: make
          .replace("Mercedes Benz", "Mercedes-Benz")
          .replace("Škoda", "Skoda")
          .replace("Citroën", "Citroen"),
        model,
        price: Number(
          priceText
            .replace(/\./g, "")
            .replace(",", ".")
            .replace(/[^\d.]/g, ""),
        ),
        year: text.match(/EZ\s*\d{1,2}\/(\d{4})/)?.[1],
        mileage: digits(text.match(/([\d.]+)\s*km\b/i)?.[1]),
        city: location.replace(postcode, "").trim(),
        postalCode: postcode,
        fuel: fuelType(title),
        transmission: transmission(title),
        sellerType: "UNKNOWN",
        imageUrl: card.find("img").first().attr("src"),
      });
      if (parsed.success) items.push(parsed.data);
    } catch {
      /* Reject malformed cards while preserving valid results. */
    }
  });
  const more =
    $('a[rel="next"],a[aria-label="Nächste Seite"],a.pagination-next').length >
      0 || cards.length >= 25;
  return { items, more, skipped: cards.length - items.length };
}

async function readPublicPage(url: URL, signal: AbortSignal, json = false) {
  try {
    return await readPublicPageOnce(url, signal, json);
  } catch (error) {
    const cause = error instanceof Error ? error.cause : undefined;
    const code =
      cause && typeof cause === "object" && "code" in cause
        ? cause.code
        : undefined;
    // Retry one interrupted GET within the same deadline, never a denial/challenge.
    if (
      !signal.aborted &&
      typeof code === "string" &&
      /^(ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET)$/.test(
        code,
      )
    ) {
      await delay(300, undefined, { signal });
      return readPublicPageOnce(url, signal, json);
    }
    throw error;
  }
}

async function readPublicPageOnce(
  url: URL,
  signal: AbortSignal,
  json: boolean,
) {
  // Only caller-built marketplace URLs; no proxies, browser cookies or challenge bypass.
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Autoraum/0.1 (vehicle research)",
      Accept: json ? "application/json" : "text/html",
      "Accept-Language": "de-DE,de;q=0.9",
    },
    redirect: "error",
    cache: "no-store",
    signal,
  });
  if (response.status === 403 || response.status === 429) {
    const retry = response.headers.get("retry-after");
    const requested =
      retry && /^\d+$/.test(retry)
        ? Number(retry) * 1000
        : retry
          ? Date.parse(retry) - Date.now()
          : 0;
    throw new SourceUnavailable(
      `${url.hostname} begrenzt den Abruf (HTTP ${response.status}). Bitte später versuchen oder die Plattform direkt öffnen.`,
      Math.max(15 * 60_000, Number.isFinite(requested) ? requested : 0),
    );
  }
  if (
    !response.ok ||
    !response.headers
      .get("content-type")
      ?.includes(json ? "application/json" : "text/html")
  )
    throw new HttpError(
      502,
      `Die Datenquelle antwortet nicht mit einer Suchseite (HTTP ${response.status}).`,
    );
  if (Number(response.headers.get("content-length")) > MAX_BYTES)
    throw new HttpError(502, "Die Antwort der Datenquelle ist zu groß.");
  const reader = response.body?.getReader();
  if (!reader)
    throw new HttpError(502, "Die Datenquelle hat keine Daten geliefert.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > MAX_BYTES)
        throw new HttpError(502, "Die Antwort der Datenquelle ist zu groß.");
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function fetchPublic(
  source: PublicSource,
  filters: Filters,
): Promise<PublicResponse> {
  const searchUrl = publicSearchUrl(source, filters).href;
  if (process.env.PUBLIC_MARKETPLACE_SEARCH !== "1")
    return {
      items: [],
      observedAt: Date.now(),
      result: {
        sourceId: source,
        source: sourceLabels[source],
        status: "disconnected",
        count: 0,
        message: "Öffentliche Suche ist deaktiviert.",
        searchUrl,
      },
    };
  const key = createHash("sha256")
    .update(`${CACHE_VERSION}:${source}:${searchUrl}`)
    .digest("hex");
  const deadline = Date.now() + DEADLINE_MS;
  const lockId = `public-search:${key}`;
  let token: string | null = null;
  let slot: { id: string; token: string } | null = null;
  try {
    // Other tenants and replicas wait for the same query's shared result.
    while (Date.now() < deadline) {
      const cached = await readCached(source, key, searchUrl);
      if (cached) return cached;
      await ensureSourceReady(source);
      token = await acquireLock(lockId, LEASE_MS);
      if (token) break;
      await delay(250);
    }
    if (!token)
      throw new HttpError(
        503,
        "Diese Suche wird bereits aktualisiert. Bitte gleich erneut versuchen.",
      );
    const cached = await readCached(source, key, searchUrl);
    if (cached) return cached;
    // Two concurrent fetches per marketplace across every process and tenant.
    while (!slot && Date.now() < deadline) {
      await ensureSourceReady(source);
      for (let i = 0; i < 2; i++) {
        const id = `public-source-slot:${source}:${i}`;
        const lease = await acquireLock(id, LEASE_MS);
        if (lease) {
          slot = { id, token: lease };
          break;
        }
      }
      if (!slot) await delay(250);
    }
    if (!slot || Date.now() >= deadline)
      throw new HttpError(
        503,
        "Die Suche ist ausgelastet. Bitte gleich erneut versuchen.",
      );
    await ensureSourceReady(source);
    await rateLimit(`public-source:${source}`, 120, 3600_000);
    return await loadPublic(source, filters, key, searchUrl, deadline);
  } catch (error) {
    const stale = await readCached(source, key, searchUrl, true);
    if (stale) return stale;
    throw error;
  } finally {
    if (slot) await releaseLock(slot.id, slot.token);
    if (token) await releaseLock(lockId, token);
  }
}

async function loadPublic(
  source: PublicSource,
  filters: Filters,
  key: string,
  searchUrl: string,
  deadline: number,
): Promise<PublicResponse> {
  const limit = pageLimits[source] || MAX_PAGES;
  const signal = AbortSignal.timeout(Math.max(1, deadline - Date.now()));
  const items: ListingInput[] = [];
  let more = false;
  let skipped = 0;
  let partial = false;
  const observedAt = Date.now();
  for (let page = 1; page <= limit; page++) {
    try {
      await ensureSourceReady(source);
      const url =
        source === "pkw"
          ? pkwUrl(filters, page, true)
          : publicSearchUrl(source, filters, page);
      const body = await readPublicPage(url, signal, source === "pkw");
      const parsers = {
        autoscout: parseAutoScout,
        kleinanzeigen: parseKleinanzeigen,
        pkw: parsePkw,
        autohero: parseAutohero,
        markt: parseMarkt,
        quoka: parseQuoka,
        autode: parseAutode,
      };
      const parsed = parsers[source](body, page);
      if (!parsed.items.length && parsed.skipped)
        throw new HttpError(
          502,
          `${sourceLabels[source]} hat Angebote geliefert, die nicht sicher als Fahrzeuganzeigen mit Kaufpreis gelesen werden konnten.`,
        );
      items.push(...parsed.items);
      skipped += parsed.skipped;
      more = parsed.more;
      if (!more) break;
    } catch (error) {
      // A blocked or unavailable source pauses all customers, not just this query.
      await pauseSource(
        source,
        error instanceof SourceUnavailable ? error.pauseMs : 60_000,
      );
      if (page === 1) throw error;
      partial = true;
      more = true;
      break;
    }
  }
  const unique = [
    ...new Map(items.map((item) => [item.externalId, item])).values(),
  ];
  await db.query(
    "INSERT INTO public_search_cache(cache_key,source,payload_json,fetched_at,expires_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(cache_key) DO UPDATE SET payload_json=$3,fetched_at=$4,expires_at=$5",
    [
      key,
      source,
      JSON.stringify({ items: unique, more, skipped, partial }),
      observedAt,
      observedAt + TTL,
    ],
  );
  await db.query("DELETE FROM public_search_cache WHERE expires_at<$1", [
    Date.now() - 86400_000,
  ]);
  return {
    items: unique,
    observedAt,
    result: {
      sourceId: source,
      source: sourceLabels[source],
      status: "ok",
      count: unique.length,
      truncated: more,
      fetchedAt: observedAt,
      searchUrl,
      message: `${unique.length} Anzeigen öffentlich abgerufen.${more ? ` Begrenzter Ausschnitt aus ${limit === 1 ? "einer Ergebnisseite" : `maximal ${limit} Seiten`}; weitere Treffer sind möglich.` : ""}${partial ? " Weitere Seite derzeit nicht erreichbar." : ""}${skipped ? ` ${skipped} ungeeignete oder unvollständige Angebote übersprungen.` : ""} Filter werden zusätzlich lokal geprüft.`,
    },
  };
}
