import { z } from "zod";
import { db } from "./db";
import { decrypt, HttpError } from "./security";
import { listingInputSchema, publicUrl, type ListingInput } from "./validation";
import type { Filters, SourceResult } from "./types";
import { mobileMarketplaceUrl } from "./marketplace-links";

const mobileAdSchema = z.object({
  mobileAdId: z.union([z.string(), z.number()]).transform(String),
  make: z.string(),
  model: z.string().optional(),
  modelDescription: z.string().optional(),
  firstRegistration: z.union([z.string(), z.number()]).optional(),
  mileage: z.number().optional(),
  fuel: z.string().optional(),
  gearbox: z.string().optional(),
  damageUnrepaired: z.boolean().optional(),
  detailPageUrl: z.string(),
  images: z.array(z.unknown()).optional(),
  price: z.object({
    consumerPriceGross: z.union([z.string(), z.number()]),
    currency: z.string(),
  }),
  seller: z
    .object({
      type: z.string().optional(),
      address: z
        .object({ city: z.string().optional(), zipcode: z.string().optional() })
        .optional(),
    })
    .optional(),
});
const mobileResponseSchema = z.object({
  total: z.number(),
  maxPages: z.number(),
  ads: z.array(z.unknown()),
});
export function projectMobileCredentials() {
  const username = process.env.MOBILE_API_USERNAME;
  const password = process.env.MOBILE_API_PASSWORD;
  return username && password ? { username, password } : null;
}

function mobileImageUrl(images: unknown[] = []) {
  for (const value of images) {
    const image = z.record(z.string(), z.unknown()).safeParse(value);
    if (!image.success) continue;
    for (const size of ["xxxl", "xxl", "xl", "l", "m", "s"]) {
      const url = publicUrl.safeParse(image.data[size]);
      if (url.success) return url.data;
    }
  }
}

const mobileFuels = new Map<string, ListingInput["fuel"]>([
  ["PETROL", "PETROL"],
  ["DIESEL", "DIESEL"],
  ["ELECTRICITY", "ELECTRICITY"],
  ["HYBRID", "HYBRID"],
  ["HYBRID_DIESEL", "HYBRID"],
  ["LPG", "OTHER"],
  ["CNG", "OTHER"],
  ["HYDROGENIUM", "OTHER"],
  ["ETHANOL", "OTHER"],
  ["OTHER", "OTHER"],
]);

export function normalizeMobileAd(value: unknown): ListingInput | null {
  const parsed = mobileAdSchema.safeParse(value);
  if (!parsed.success || parsed.data.price.currency !== "EUR") return null;
  const ad = parsed.data;
  const year = ad.firstRegistration
    ? Number(String(ad.firstRegistration).slice(0, 4))
    : undefined;
  const normalized = listingInputSchema.safeParse({
    externalId: ad.mobileAdId,
    source: "mobile",
    url: ad.detailPageUrl,
    title: `${ad.make} ${ad.modelDescription || ad.model || ""}`.trim(),
    make: ad.make,
    // A model code such as 320 must retain the 320d variant for local filters.
    model:
      [...new Set([ad.model, ad.modelDescription].filter(Boolean))]
        .join(" ")
        .slice(0, 100) || "Unbekannt",
    price: Number(ad.price.consumerPriceGross),
    year,
    mileage: ad.mileage,
    fuel: mobileFuels.get(ad.fuel || "") || "UNKNOWN",
    imageUrl: mobileImageUrl(ad.images),
    transmission:
      ad.gearbox &&
      /^(AUTOMATIC_GEAR|MANUAL_GEAR|SEMIAUTOMATIC_GEAR)$/.test(ad.gearbox)
        ? ad.gearbox
        : "",
    city: ad.seller?.address?.city || "",
    postalCode: ad.seller?.address?.zipcode || "",
    sellerType:
      ad.seller?.type === "DEALER"
        ? "DEALER"
        : ad.seller?.type === "PRIVATE"
          ? "PRIVATE"
          : "UNKNOWN",
    damaged: ad.damageUnrepaired,
  });
  return normalized.success ? normalized.data : null;
}
export function mobileSearchUrl(filters: Filters, page: number) {
  const url = new URL("https://services.mobile.de/search-api/search");
  const params = url.searchParams;
  params.set("country", "DE");
  params.set("classification", "refdata/classes/Car");
  params.set("page.size", "100");
  params.set("page.number", String(page));
  params.set("sort.field", "modificationTime");
  params.set("sort.order", "DESCENDING");
  if (filters.make)
    params.set(
      "classification",
      `refdata/classes/Car/makes/${encodeURIComponent(filters.make.toUpperCase() === "VOLKSWAGEN" ? "VW" : filters.make.toUpperCase())}`,
    );
  if (filters.model) params.set("modelDescription", filters.model);
  if (filters.minPrice !== undefined)
    params.set("price.min", String(filters.minPrice));
  if (filters.maxPrice !== undefined)
    params.set("price.max", String(filters.maxPrice));
  if (filters.minYear)
    params.set("firstRegistrationDate.min", `${filters.minYear}-01`);
  if (filters.maxYear)
    params.set("firstRegistrationDate.max", `${filters.maxYear}-12`);
  if (filters.maxMileage !== undefined)
    params.set("mileage.max", String(filters.maxMileage));
  if (filters.fuel)
    params.set(
      "fuel",
      filters.fuel === "HYBRID"
        ? "HYBRID,HYBRID_DIESEL"
        : filters.fuel === "OTHER"
          ? "LPG,CNG,HYDROGENIUM,ETHANOL,OTHER"
          : filters.fuel,
    );
  if (filters.transmission) params.set("gearbox", filters.transmission);
  if (filters.undamagedOnly) params.set("damageUnrepaired", "false");
  // City/partial postal code is applied locally; it is not silently converted into a radius.
  return url;
}

export async function fetchMobile(
  tenantId: string,
  filters: Filters,
): Promise<{ items: ListingInput[]; result: SourceResult }> {
  const [config] = await db.query<{ mobile_credentials: string | null }>(
    "SELECT mobile_credentials FROM provider_configs WHERE tenant_id=$1",
    [tenantId],
  );
  const credentials = config?.mobile_credentials
    ? z
        .object({ username: z.string(), password: z.string() })
        .parse(JSON.parse(decrypt(config.mobile_credentials)))
    : projectMobileCredentials();
  if (!credentials)
    return {
      items: [],
      result: {
        sourceId: "mobile",
        source: "mobile.de",
        status: "disconnected",
        count: 0,
        message:
          "Für Ergebnisse in Autoraum wird ein Search-API-Zugang benötigt. Die Suche auf mobile.de ist direkt verfügbar.",
        searchUrl: mobileMarketplaceUrl(filters).href,
      },
    };
  const items: ListingInput[] = [];
  let skipped = 0;
  let truncated = false;
  const deadline = Date.now() + 40_000;
  for (let page = 1; page <= 5; page++) {
    if (Date.now() >= deadline) {
      truncated = true;
      break;
    }
    const response = await fetch(mobileSearchUrl(filters, page), {
      headers: {
        Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`,
        Accept: "application/vnd.de.mobile.api+json",
        "Accept-Language": "de",
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(Math.min(10_000, deadline - Date.now())),
    });
    if (response.status === 401 || response.status === 403)
      throw new HttpError(
        502,
        "mobile.de hat den Zugriff abgelehnt. API-Zugang und Berechtigungen prüfen.",
      );
    if (response.status === 429)
      throw new HttpError(
        502,
        "Das mobile.de-Abfragelimit ist erreicht. Bitte später erneut versuchen.",
      );
    if (!response.ok)
      throw new HttpError(
        502,
        `mobile.de ist momentan nicht verfügbar (HTTP ${response.status}).`,
      );
    const raw = await response.text();
    if (raw.length > 5_000_000)
      throw new HttpError(502, "Die Antwort der Datenquelle ist zu groß.");
    const body = mobileResponseSchema.parse(JSON.parse(raw));
    for (const item of body.ads) {
      const listing = normalizeMobileAd(item);
      if (listing) items.push(listing);
      else skipped++;
    }
    truncated = body.maxPages > page;
    if (page >= body.maxPages || body.ads.length === 0) break;
  }
  return {
    items,
    result: {
      sourceId: "mobile",
      source: "mobile.de",
      status: "ok",
      count: items.length,
      truncated,
      message: `${items.length} Anzeigen abgerufen.${skipped ? ` ${skipped} unvollständige oder nicht in EUR angebotene Anzeigen übersprungen.` : ""}${truncated ? " Abruf auf 500 Anzeigen bzw. 40 Sekunden begrenzt. Filter eingrenzen." : ""}`,
    },
  };
}
