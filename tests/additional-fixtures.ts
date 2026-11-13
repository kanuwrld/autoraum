// Synthetic contract fixtures only; these are never loaded into a real workspace.
export const pkwAd = {
  id: "TEST-pkw",
  name: "Audi A4 TEST",
  url: "https://suche.pkw.de/fahrzeuge/details/TEST-pkw",
  brand: { name: "Audi" },
  model: { name: "A4" },
  text_variant: "Avant",
  price: { customer: 19900, netto: 16722, monthly: 199 },
  initial_registration: "2020-05-01",
  mileage: 80000,
  fueltype: { name: "Diesel" },
  geartype: { name: "Automatik" },
  location: { country: "DEU", city: "Regensburg", zip: "93047" },
  owner: { type: "dealer" },
  main_image: {
    original: "https://fixtures.example.test/original.jpg",
    full: "https://fixtures.example.test/thumb.jpg",
  },
};
export const pkwPage = (ads: unknown[] = [pkwAd], pages = 1) =>
  JSON.stringify({
    page: 1,
    total: { count: ads.length, pages },
    results: ads,
  });

export const heroAd = {
  id: "b6a14c20-a056-4d87-863a-582c86fc36a2",
  manufacturer: "Audi",
  model: "A4",
  carUrlTitle: "audi-a-4",
  countryCode: "DE",
  subType: "Avant TEST",
  firstRegistrationYear: 2020,
  offerPrice: {
    amountMinorUnits: 1990000,
    conversionMajor: 100,
    currency: "EUR",
  },
  mileage: { distance: 80000, unit: "KM" },
  monthlyInstallment: 199,
  fuelType: 1040,
  gearType: 1139,
  isComingSoon: false,
  mainImageUrl: "https://fixtures.example.test/{size}car.jpg",
  esBranch: { city: "Regensburg", zipcode: "93047" },
};
export const heroPage = (ads: unknown[] = [heroAd], total = ads.length) =>
  `<script>window.__APOLLO_STATE__ = ${JSON.stringify(JSON.stringify({ ROOT_QUERY: { "searchAdV9AdsV2:{}": { total, data: ads } } }))};</script>`;

export const quokaPage = `<main><article class="article-item"><div class="article-title"><a href="https://www.quoka.de/anzeigen/auto-motorrad/automarkt/anzeige/test/TEST-quoka.html">Audi A4 TEST</a></div><div class="article-short-info">2020 | diesel | 80.000 km</div><div class="article-price">19 900 EUR</div><div class="article-location">93047 Regensburg, Bayern</div><div class="art-img"><img src="https://fixtures.example.test/quoka.webp"></div></article></main>`;
export const marktPage = `<main><article class="clsy-c-result-list-item"><a class="clsy-c-result-list-item__link" href="https://www.markt.de/test/a/aabbccdd/"><h2 class="clsy-c-result-list-item__title">Audi A4 TEST</h2></a><div class="clsy-c-result-list-item__price-amount">19.900 €</div><div class="clsy-c-result-list-item__description">Allgemeine Daten: Erstzulassung: 2020-05-01 Kilometerstand: 80000 Leistung: 150 PS Getriebe: automatic Kraftstoff: petrol</div><div class="clsy-c-result-list-item__location">93047 Regensburg</div><img class="clsy-c-result-list-item__thumbnail-img" src="https://fixtures.example.test/signed.jpg?signature=keep"></article></main>`;

export const autoAd = {
  id: "a129e4b4-49a4-41b8-8f4d-5fb893e9f246",
  title: { make: "Audi", model: "A4", subModel: "Avant TEST" },
  price: {
    itemCurrency: "Euro",
    currentSalesPrice: 19900,
    historyPriceDifference: 3000,
    monthlyInstallment: 199,
  },
  info: {
    regDate: 1577836800,
    mileage: 80000,
    fuelType: "Benzin",
    vehicleTransmission: "Automatik",
  },
  slider: { mainImageUrl: "https://fixtures.example.test/car.jpg" },
};
export const autoPage = (ads: unknown[] = [autoAd], total = ads.length) =>
  `<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { searchList: ads, total, alternativesList: [autoAd] } } })}</script>`;
