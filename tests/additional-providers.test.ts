import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parsePkw,
  parseAutohero,
  parseMarkt,
  parseQuoka,
  parseAutode,
} from "../src/lib/additional-providers";
import {
  pkwUrl,
  autoheroUrl,
  marktUrl,
  quokaUrl,
  autodeUrl,
} from "../src/lib/marketplace-links";
import { filtersSchema } from "../src/lib/validation";
import {
  pkwAd,
  pkwPage,
  heroAd,
  heroPage,
  marktPage,
  quokaPage,
  autoAd,
  autoPage,
} from "./additional-fixtures";

test("PKW imports German gross purchase prices and original photos, excluding foreign/deleted/unsafe offers", () => {
  const result = parsePkw(
    pkwPage([
      pkwAd,
      { ...pkwAd, deleted: true },
      { ...pkwAd, location: { country: "AUT" } },
      { ...pkwAd, url: "https://evil.example.test/" },
    ]),
  );
  assert.equal(result.items.length, 1);
  const item = result.items[0];
  assert.equal(item.price, 19900);
  assert.equal(item.year, 2020);
  assert.equal(item.mileage, 80000);
  assert.equal(item.sellerType, "DEALER");
  assert.equal(item.imageUrl, pkwAd.main_image.original);
  assert.equal(result.skipped, 3);
});
test("Autohero reads serialized JSON without needing a rendered card and converts minor units", () => {
  const result = parseAutohero(
    heroPage([
      heroAd,
      { ...heroAd, countryCode: "AT" },
      { ...heroAd, isComingSoon: true },
    ]),
  );
  assert.equal(result.items.length, 1);
  const item = result.items[0];
  assert.equal(item.price, 19900);
  assert.equal(item.year, 2020);
  assert.equal(item.fuel, "DIESEL");
  assert.equal(item.transmission, "AUTOMATIC_GEAR");
  assert.equal(item.damaged, undefined);
  assert.equal(item.imageUrl, "https://fixtures.example.test/768x432-car.jpg");
  assert.equal(new URL(item.url).pathname, `/de/audi-a-4/id/${heroAd.id}/`);
  assert.equal(
    parseAutohero(heroPage([{ ...heroAd, carUrlTitle: "../../evil" }])).items
      .length,
    0,
  );
});
test("Quoka accepts grouped and current discounted prices, excluding monthly payments and wanted ads", () => {
  const item = parseQuoka(quokaPage).items[0];
  assert.equal(item.price, 19900);
  assert.equal(
    item.year,
    undefined,
    "Baujahr must not become first registration",
  );
  assert.equal(item.mileage, 80000);
  assert.equal(item.sellerType, "UNKNOWN");
  assert.equal(
    parseQuoka(
      quokaPage.replace(
        "19 900 EUR",
        '<del>22000 EUR</del><span class="new-price">17950.0 EUR</span>',
      ),
    ).items[0].price,
    17950,
  );
  for (const html of [
    quokaPage.replace("19 900 EUR", "199 EUR monatlich"),
    quokaPage.replace("Audi A4 TEST", "Audi A4 gesucht"),
    quokaPage.replace("2020 | diesel | 80.000 km", "Ersatzteile"),
    quokaPage.replace(
      "https://www.quoka.de/anzeigen/",
      "https://evil.example.test/anzeigen/",
    ),
  ])
    assert.equal(parseQuoka(html).items.length, 0);
});
test("markt keeps explicit registration and full prices, not lease offers or inspection years", () => {
  const item = parseMarkt(marktPage).items[0];
  assert.equal(item.price, 19900);
  assert.equal(item.year, 2020);
  assert.equal(item.fuel, "PETROL");
  assert.equal(item.transmission, "AUTOMATIC_GEAR");
  assert.equal(item.damaged, undefined);
  assert.equal(
    parseMarkt(marktPage.replace("Erstzulassung: 2020-05-01", "Baujahr: 2020"))
      .items[0].year,
    undefined,
  );
  assert.equal(
    parseMarkt(marktPage.replace("Erstzulassung: 2020-05-01", "TÜV: 2027"))
      .items[0].year,
    undefined,
  );
  assert.equal(
    parseMarkt(marktPage.replace("Audi A4 TEST", "Audi A4 Leasingübernahme"))
      .items.length,
    0,
  );
  assert.equal(
    parseMarkt(
      marktPage.replace("https://www.markt.de/", "https://evil.example.test/"),
    ).items.length,
    0,
  );
});
test("auto.de uses sales price and Unix registration date, never discounts or unrelated recommendations", () => {
  const item = parseAutode(autoPage()).items[0];
  assert.equal(item.price, 19900);
  assert.equal(item.year, 2020);
  assert.equal(
    parseAutode(
      autoPage([{ ...autoAd, info: { ...autoAd.info, regDate: null } }]),
    ).items[0].year,
    undefined,
  );
  assert.equal(
    parseAutode(
      autoPage([
        { ...autoAd, price: { ...autoAd.price, itemCurrency: "USD" } },
      ]),
    ).items.length,
    0,
  );
  assert.equal(parseAutode(autoPage([])).items.length, 0);
});
test("new sources distinguish real empty responses from unrecognized or challenge pages", () => {
  for (const parse of [
    parsePkw,
    parseAutohero,
    parseMarkt,
    parseQuoka,
    parseAutode,
  ])
    assert.throws(() => parse("<html>Verify you are human</html>"));
  for (const [parse, body] of [
    [parsePkw, pkwPage([])],
    [parseAutohero, heroPage([])],
    [parseMarkt, "<main>Keine Anzeigen gefunden</main>"],
    [parseQuoka, "<main>Keine Anzeigen gefunden</main>"],
    [parseAutode, autoPage([])],
  ] as const)
    assert.equal(parse(body).items.length, 0);
});
test("new source builders encode known upstream filters; all new IDs pass search validation", () => {
  const f = filtersSchema.parse({
    make: "BMW",
    model: "M2 Competition",
    minPrice: 0,
    maxPrice: 60000,
    minYear: 2017,
    maxMileage: 100000,
    sources: ["pkw", "autohero", "markt", "quoka", "autode"],
  });
  const pkw = pkwUrl(f, 2, true);
  assert.equal(pkw.origin, "https://www.pkw.de");
  assert.equal(pkw.searchParams.get("free_text"), "BMW M2 Competition");
  assert.equal(pkw.searchParams.get("price_from"), "0");
  assert.equal(pkw.searchParams.get("price_to"), "60000");
  assert.equal(pkw.searchParams.get("page"), "2");
  assert.equal(autoheroUrl(f).searchParams.get("models0"), "M2");
  assert.equal(autoheroUrl(f).searchParams.get("brand0"), "bmw");
  assert.equal(
    autoheroUrl({ make: "BMW", model: "320d" }).searchParams.get("models0"),
    "3er",
  );
  assert.equal(
    marktUrl(f).pathname,
    "/fahrzeuge/autos/suche/bmw+m2+competition/",
  );
  assert.equal(marktUrl(f).searchParams.get("maxPrice"), "60000");
  assert.equal(
    quokaUrl(f).pathname,
    "/anzeigen/auto-motorrad/automarkt/bmw/m-modelle/",
  );
  assert.equal(quokaUrl(f, 2).searchParams.get("pag"), "2");
  assert.equal(autodeUrl(f).pathname, "/angebot/bmw/m2/");
});
