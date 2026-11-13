import { load } from "cheerio";
import { z } from "zod";
import { HttpError } from "./security";
import { listingInputSchema, type ListingInput } from "./validation";
import {
  digits,
  fuelType,
  transmission,
  trustedUrl,
  makes,
  type ParsedPage,
} from "./public-parser-utils";

function unreadable(source: string): never {
  throw new HttpError(
    502,
    `${source} hat keine lesbare Ergebnisliste geliefert. Bitte auf der Plattform prüfen.`,
  );
}
function append(items: ListingInput[], input: unknown) {
  const parsed = listingInputSchema.safeParse(input);
  if (parsed.success) items.push(parsed.data);
}
function identity(title: string) {
  const make = makes.find((m) =>
    title.toLowerCase().startsWith(`${m.toLowerCase()} `),
  );
  if (!make) return null;
  const words = title.slice(make.length).trim().split(/\s+/);
  const model =
    /^(F|G|E)\d{2,3}$/i.test(words[0]) && /^[A-Z]?\d/i.test(words[1] || "")
      ? words[1]
      : words[0];
  if (!model || /^(?:19|20)\d{2}$/.test(model)) return null;
  return {
    make: make
      .replace("Mercedes Benz", "Mercedes-Benz")
      .replace("Škoda", "Skoda")
      .replace("Citroën", "Citroen"),
    model,
  };
}
function euroPrice(value: string, decimalDot = false) {
  const match = value
    .replace(/\s+/g, " ")
    .replace(/(\d)\s+(?=\d)/g, "$1")
    .trim()
    .match(/^(\d[\d.,]*)\s*(?:€|EUR)(?:\s*(?:VB|VHB))?$/i);
  if (!match) return undefined;
  if (decimalDot && /^\d+(?:\.\d{1,2})?$/.test(match[1]))
    return Number(match[1]);
  if (!/^\d+(?:\.\d{3})*(?:,\d{1,2})?$/.test(match[1])) return undefined;
  return Number(match[1].replaceAll(".", "").replace(",", "."));
}
const unwanted =
  /\b(?:gesucht|suche|ankauf|mietwagen|mieten|leasingübernahme|leasinguebernahme|leasingrate|monatlich|mtl\.|monatsrate|anzahlung|prospekt|schlachtfahrzeug)\b/i;

const pkwPageSchema = z.object({
  page: z.number().int().positive(),
  total: z.object({
    count: z.number().nonnegative(),
    pages: z.number().nonnegative(),
  }),
  results: z.array(z.unknown()),
});
const pkwAdSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  price: z.object({ customer: z.number() }),
  brand: z.object({ name: z.string() }),
  model: z.object({ name: z.string() }),
  text_variant: z.string().nullish(),
  initial_registration: z.string().nullish(),
  mileage: z.number().nullish(),
  fueltype: z.object({ name: z.string() }).nullish(),
  geartype: z.object({ name: z.string() }).nullish(),
  location: z.object({
    country: z.string(),
    city: z.string().nullish(),
    zip: z.string().nullish(),
  }),
  owner: z.object({ type: z.string() }).optional(),
  deleted: z.boolean().optional(),
  main_image: z
    .object({ original: z.string().optional(), full: z.string().optional() })
    .nullish(),
});
export function parsePkw(body: string): ParsedPage {
  const page = pkwPageSchema.safeParse(JSON.parse(body));
  if (!page.success) return unreadable("PKW.de");
  const items: ListingInput[] = [];
  for (const raw of page.data.results) {
    const ad = pkwAdSchema.safeParse(raw);
    if (
      !ad.success ||
      ad.data.deleted ||
      !["DE", "DEU"].includes(ad.data.location.country)
    )
      continue;
    const a = ad.data;
    try {
      append(items, {
        externalId: a.id,
        source: "pkw",
        url: trustedUrl(a.url, "https://suche.pkw.de"),
        title: a.name,
        make: a.brand.name,
        model: `${a.model.name} ${a.text_variant || ""}`.trim().slice(0, 100),
        price: a.price.customer,
        year: a.initial_registration?.match(/^((?:19|20)\d{2})-/)?.[1],
        mileage: a.mileage ?? undefined,
        fuel: fuelType(a.fueltype?.name || ""),
        transmission: transmission(a.geartype?.name || ""),
        city: a.location.city || "",
        postalCode: a.location.zip || "",
        imageUrl: a.main_image?.original || a.main_image?.full,
        sellerType:
          a.owner?.type === "dealer"
            ? "DEALER"
            : a.owner?.type === "private"
              ? "PRIVATE"
              : "UNKNOWN",
      });
    } catch {
      /* Reject links outside the verified marketplace origin. */
    }
  }
  return {
    items,
    more: page.data.total.pages > page.data.page,
    skipped: page.data.results.length - items.length,
  };
}

// Enum values exposed by Autohero's public search application.
const heroFuels: Record<number, string> = {
  1039: "PETROL",
  1040: "DIESEL",
  1041: "OTHER",
  1042: "OTHER",
  1043: "OTHER",
  1044: "ELECTRICITY",
  1045: "OTHER",
  1046: "HYBRID",
  1047: "OTHER",
};
const heroGears: Record<number, string> = {
  1138: "MANUAL_GEAR",
  1139: "AUTOMATIC_GEAR",
  1140: "SEMIAUTOMATIC_GEAR",
};
const heroAdSchema = z.object({
  id: z.uuid(),
  manufacturer: z.string(),
  model: z.string(),
  carUrlTitle: z.string().regex(/^[a-z0-9-]+$/),
  countryCode: z.literal("DE"),
  subType: z.string().nullish(),
  subTypeExtra: z.string().nullish(),
  firstRegistrationYear: z.number().nullish(),
  offerPrice: z.object({
    amountMinorUnits: z.number(),
    conversionMajor: z.number().positive(),
    currency: z.literal("EUR"),
  }),
  mileage: z.object({ distance: z.number(), unit: z.literal("KM") }).nullish(),
  isComingSoon: z.boolean().optional(),
  fuelType: z.number().optional(),
  gearType: z.number().optional(),
  mainImageUrl: z.string().optional(),
  esBranch: z
    .object({ city: z.string().nullish(), zipcode: z.string().nullish() })
    .nullish(),
});
export function parseAutohero(html: string): ParsedPage {
  const $ = load(html);
  const script =
    $("script")
      .toArray()
      .map((e) => $(e).text())
      .find((s) => s.includes("window.__APOLLO_STATE__")) || "";
  // Read only the serialized JSON string; never execute page scripts/configuration.
  const match = script.match(
    /window\.__APOLLO_STATE__\s*=\s*("(?:[^"\\]|\\.)*")\s*;/,
  );
  if (!match) return unreadable("Autohero");
  const state = z
    .object({ ROOT_QUERY: z.record(z.string(), z.unknown()) })
    .parse(JSON.parse(JSON.parse(match[1])));
  const raw = Object.entries(state.ROOT_QUERY).find(([key]) =>
    key.startsWith("searchAdV9AdsV2:"),
  )?.[1];
  const data = z
    .object({ total: z.number().nonnegative(), data: z.array(z.unknown()) })
    .safeParse(raw);
  if (!data.success) return unreadable("Autohero");
  const cards = new Map(
    $("a[href*='/id/']")
      .toArray()
      .map((e) => [
        $(e)
          .attr("href")
          ?.match(/\/id\/([^/]+)\//)?.[1],
        $(e),
      ]),
  );
  const items: ListingInput[] = [];
  for (const raw of data.data.data) {
    const result = heroAdSchema.safeParse(raw);
    if (!result.success || result.data.isComingSoon) continue;
    const a = result.data;
    const card = cards.get(a.id);
    try {
      const url = trustedUrl(
        card?.attr("href") || `/de/${a.carUrlTitle}/id/${a.id}/`,
        "https://www.autohero.com",
      );
      const model = [a.model, a.subType, a.subTypeExtra]
        .filter(Boolean)
        .join(" ");
      append(items, {
        externalId: a.id,
        source: "autohero",
        url,
        title: `${a.manufacturer} ${model}`.slice(0, 250),
        make: a.manufacturer,
        model: model.slice(0, 100),
        price: a.offerPrice.amountMinorUnits / a.offerPrice.conversionMajor,
        year: a.firstRegistrationYear ?? undefined,
        mileage: a.mileage?.distance,
        fuel:
          heroFuels[a.fuelType ?? 0] ||
          fuelType(card?.find('[data-qa-selector="spec-fuel"]').text() || ""),
        transmission:
          heroGears[a.gearType ?? 0] ||
          transmission(
            card?.find('[data-qa-selector="spec-gear"]').text() || "",
          ),
        city: a.esBranch?.city || "",
        postalCode: a.esBranch?.zipcode || "",
        sellerType: "DEALER",
        imageUrl:
          card?.find('img[data-qa-selector="ad-image"]').first().attr("src") ||
          a.mainImageUrl?.replace("{size}", "768x432-"),
      });
    } catch {
      /* Keep only complete, public German offers. */
    }
  }
  return {
    items,
    more: data.data.total > data.data.data.length,
    skipped: data.data.data.length - items.length,
  };
}

export function parseQuoka(html: string): ParsedPage {
  const $ = load(html),
    cards = $(".article-item");
  if (
    !cards.length &&
    !/keine (anzeigen|ergebnisse|treffer)|0 anzeigen/i.test($("body").text())
  )
    return unreadable("Quoka");
  const items: ListingInput[] = [];
  cards.each((_, element) => {
    const card = $(element),
      title = card.find(".article-title").text().trim();
    const id = identity(title),
      details = card.find(".article-short-info").text().trim();
    if (!id || unwanted.test(title) || !details) return;
    // The category also contains parts/wanted ads; require an explicit vehicle year and odometer.
    const builtYear = details.match(/^\s*((?:19|20)\d{2})\s*\|/)?.[1];
    const mileage = digits(details.match(/(\d[\d.]*)\s*km\b/i)?.[1]);
    if (!builtYear || mileage === undefined) return;
    const priceNode = card.find(".article-price .new-price");
    const price = euroPrice(
      priceNode.length ? priceNode.text() : card.find(".article-price").text(),
      true,
    );
    if (price === undefined) return;
    const location = card.find(".article-location").text().trim(),
      postalCode = location.match(/\b\d{5}\b/)?.[0] || "";
    try {
      const url = trustedUrl(
        card.find(".article-title a").attr("href") || "",
        "https://www.quoka.de",
      );
      if (!new URL(url).pathname.includes("/auto-motorrad/automarkt/anzeige/"))
        return;
      append(items, {
        externalId: new URL(url).pathname.match(/\/([^/]+)\.html$/)?.[1],
        source: "quoka",
        url,
        title,
        ...id,
        price,
        // Quoka labels this year as Baujahr, not confirmed first registration.
        mileage,
        fuel: fuelType(details),
        transmission: transmission(title),
        city: location.replace(postalCode, "").trim(),
        postalCode,
        imageUrl: card.find(".art-img img").first().attr("src"),
      });
    } catch {
      /* Ignore untrusted links in external HTML. */
    }
  });
  const more = $("a[href*='pag=']")
    .toArray()
    .some((e) => $(e).text().trim() === "›");
  return { items, more, skipped: cards.length - items.length };
}

export function parseMarkt(html: string): ParsedPage {
  const $ = load(html),
    cards = $(".clsy-c-result-list-item");
  if (
    !cards.length &&
    !/keine (anzeigen|ergebnisse|treffer)|0 treffer/i.test($("main").text())
  )
    return unreadable("markt.de");
  const items: ListingInput[] = [];
  cards.each((_, element) => {
    const card = $(element),
      title = card.find(".clsy-c-result-list-item__title").text().trim();
    const details = card
      .find(".clsy-c-result-list-item__description")
      .text()
      .trim();
    const id = identity(title),
      price = euroPrice(
        card.find(".clsy-c-result-list-item__price-amount").text(),
      );
    if (!id || price === undefined || unwanted.test(`${title} ${details}`))
      return;
    const location = card
        .find(".clsy-c-result-list-item__location")
        .text()
        .trim(),
      postalCode = location.match(/\b\d{5}\b/)?.[0] || "";
    const year = details.match(
      /(?:Erstzulassung|EZ)\s*:?\s*(?:\d{1,2}[./])?((?:19|20)\d{2})\b/i,
    )?.[1];
    const mileage = digits(
      details.match(/Kilometerstand\s*:?\s*(\d[\d.]*)/i)?.[1] ||
        details.match(/(\d[\d.]*)\s*km\b/i)?.[1],
    );
    try {
      const url = trustedUrl(
        card.find(".clsy-c-result-list-item__link").attr("href") || "",
        "https://www.markt.de",
      );
      const externalId = new URL(url).pathname.match(/\/a\/([a-f0-9]+)\//)?.[1];
      if (!externalId) return;
      append(items, {
        externalId,
        source: "markt",
        url,
        title,
        ...id,
        price,
        year,
        mileage,
        fuel: fuelType(details.match(/Kraftstoff:\s*([^\n]+)/i)?.[1] || title),
        transmission: transmission(
          details.match(/Getriebe:\s*([^\n]+)/i)?.[1] || title,
        ),
        city: location.replace(postalCode, "").trim(),
        postalCode,
        imageUrl: card
          .find(".clsy-c-result-list-item__thumbnail-img")
          .first()
          .attr("src"),
      });
    } catch {
      /* Do not import arbitrary links from a search page. */
    }
  });
  return {
    items,
    more: $(".clsy-c-pagination__next").length > 0,
    skipped: cards.length - items.length,
  };
}

const autoAdSchema = z.object({
  id: z.string(),
  title: z.object({
    make: z.string(),
    model: z.string(),
    subModel: z.string().nullish(),
  }),
  price: z.object({
    itemCurrency: z.enum(["EUR", "Euro"]),
    currentSalesPrice: z.number(),
  }),
  info: z.object({
    regDate: z.union([z.string(), z.number().int().positive()]).nullish(),
    mileage: z.number().nullish(),
    fuelType: z.string().nullish(),
    vehicleTransmission: z.string().nullish(),
  }),
  slider: z.object({ mainImageUrl: z.string().optional() }).optional(),
});
export function parseAutode(html: string): ParsedPage {
  const $ = load(html),
    raw = $("script#__NEXT_DATA__").text();
  if (!raw) return unreadable("auto.de");
  const parsed = z
    .object({
      props: z.object({
        pageProps: z.object({
          total: z.number().nonnegative(),
          searchList: z.array(z.unknown()),
        }),
      }),
    })
    .safeParse(JSON.parse(raw));
  if (!parsed.success) return unreadable("auto.de");
  const data = parsed.data.props.pageProps,
    items: ListingInput[] = [];
  for (const raw of data.searchList) {
    const result = autoAdSchema.safeParse(raw);
    if (!result.success) continue;
    const a = result.data;
    if (!/^[a-f0-9-]{36}$/.test(a.id)) continue;
    append(items, {
      externalId: a.id,
      source: "autode",
      url: `https://www.auto.de/search/vehicle/${a.id}`,
      title: [a.title.make, a.title.model, a.title.subModel]
        .filter(Boolean)
        .join(" ")
        .slice(0, 250),
      make: a.title.make,
      model: [a.title.model, a.title.subModel]
        .filter(Boolean)
        .join(" ")
        .slice(0, 100),
      price: a.price.currentSalesPrice,
      year:
        typeof a.info.regDate === "number"
          ? new Date(a.info.regDate * 1000).getUTCFullYear()
          : a.info.regDate?.match(/(?:^|[./])((?:19|20)\d{2})(?:[/-]|$)/)?.[1],
      mileage: a.info.mileage ?? undefined,
      fuel: fuelType(a.info.fuelType || ""),
      transmission: transmission(a.info.vehicleTransmission || ""),
      sellerType: "DEALER",
      imageUrl: a.slider?.mainImageUrl,
    });
  }
  return {
    items,
    more: data.total > data.searchList.length,
    skipped: data.searchList.length - items.length,
  };
}
