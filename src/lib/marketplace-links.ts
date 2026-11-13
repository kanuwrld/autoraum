import type { Filters, PublicSource } from "./types";

const slug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export function autoScoutUrl(filters: Filters, page = 1) {
  const make =
    filters.make === "VOLKSWAGEN" ? "volkswagen" : slug(filters.make || "");
  // The marketplace ignores `freetext` for vehicle models. Its model route is required.
  let model = slug(filters.model || "");
  if (make === "bmw" && /^\d{3}(d|i|e|xd|xi)/.test(model))
    model = model.slice(0, 3);
  if (model.includes("-"))
    model = model.replace(
      /-(competition|gti|gtd|avant|touring|limousine|coupe|sportback)(-.*)?$/,
      "",
    );
  const url = new URL(
    `https://www.autoscout24.de/lst${make ? `/${make}` : ""}${make && model ? `/${model}` : ""}`,
  );
  const p = url.searchParams;
  p.set("atype", "C");
  p.set("cy", "D");
  p.set("sort", "age");
  p.set("desc", "1");
  p.set("page", String(page));
  for (const [key, value] of Object.entries({
    pricefrom: filters.minPrice,
    priceto: filters.maxPrice,
    fregfrom: filters.minYear,
    fregto: filters.maxYear,
    kmto: filters.maxMileage,
  })) {
    if (value !== undefined) p.set(key, String(value));
  }
  const fuel: Record<string, string> = {
    PETROL: "B",
    DIESEL: "D",
    ELECTRICITY: "E",
    HYBRID: "2,3",
    OTHER: "C,H,L,M,O",
  };
  const gear: Record<string, string> = {
    AUTOMATIC_GEAR: "A",
    MANUAL_GEAR: "M",
    SEMIAUTOMATIC_GEAR: "S",
  };
  if (filters.fuel) p.set("fuel", fuel[filters.fuel]);
  if (filters.transmission) p.set("gear", gear[filters.transmission]);
  p.set("damaged_listing", filters.undamagedOnly ? "exclude" : "include");
  return url;
}

export function kleinanzeigenUrl(filters: Filters, page = 1) {
  const query = slug([filters.make, filters.model].filter(Boolean).join(" "));
  const price =
    filters.minPrice !== undefined || filters.maxPrice !== undefined
      ? `preis:${filters.minPrice ?? ""}:${filters.maxPrice ?? ""}/`
      : "";
  const attributes: string[] = [];
  if (filters.make)
    attributes.push(`autos.marke_s:${slug(filters.make).replaceAll("-", "_")}`);
  if (filters.minYear || filters.maxYear)
    attributes.push(
      `autos.ez_i:${filters.minYear ?? ""},${filters.maxYear ?? ""}`,
    );
  if (filters.maxMileage !== undefined)
    attributes.push(`autos.km_i:,${filters.maxMileage}`);
  if (filters.undamagedOnly) attributes.push("autos.schaden_s:nein");
  const gear: Record<string, string> = {
    AUTOMATIC_GEAR: "automatik",
    MANUAL_GEAR: "manuell",
  };
  if (filters.transmission && gear[filters.transmission])
    attributes.push(`autos.shift_s:${gear[filters.transmission]}`);
  return new URL(
    `https://www.kleinanzeigen.de/s-autos/${price}${page > 1 ? `seite:${page}/` : ""}${query ? `${query}/k0` : ""}c216${attributes.map((a) => `+${a}`).join("")}`,
  );
}

export function mobileMarketplaceUrl(filters: Filters) {
  const url = new URL("https://suchen.mobile.de/fahrzeuge/search.html");
  const p = url.searchParams;
  p.set("isSearchRequest", "true");
  p.set("vc", "Car");
  p.set("cn", "DE");
  p.set("s", "Car");
  if (filters.make || filters.model)
    p.set("ft", [filters.make, filters.model].filter(Boolean).join(" "));
  for (const [key, value] of Object.entries({
    minPrice: filters.minPrice,
    maxPrice: filters.maxPrice,
    minFirstRegistrationDate: filters.minYear,
    maxFirstRegistrationDate: filters.maxYear,
    maxMileage: filters.maxMileage,
  })) {
    if (value !== undefined) p.set(key, String(value));
  }
  if (filters.undamagedOnly) p.set("dam", "false");
  return url;
}

export function pkwUrl(filters: Filters, page = 1, data = false) {
  const url = new URL(
    data
      ? "https://www.pkw.de/api/v1/cars/search/basic"
      : "https://suche.pkw.de/fahrzeuge",
  );
  const p = url.searchParams;
  p.set("page", String(page));
  p.set("sort", "created_at-desc");
  if (filters.make || filters.model)
    p.set("free_text", [filters.make, filters.model].filter(Boolean).join(" "));
  for (const [key, value] of Object.entries({
    price_from: filters.minPrice,
    price_to: filters.maxPrice,
    initial_registration_from: filters.minYear,
    initial_registration_to: filters.maxYear,
    mileage_to: filters.maxMileage,
  }))
    if (value !== undefined) p.set(key, String(value));
  const fuel = {
    PETROL: "1",
    DIESEL: "2",
    ELECTRICITY: "4",
    HYBRID: "5,10",
    OTHER: "3,6,7,8,9",
  };
  const gear = {
    AUTOMATIC_GEAR: "1",
    SEMIAUTOMATIC_GEAR: "2",
    MANUAL_GEAR: "3",
  };
  if (filters.fuel && filters.fuel in fuel)
    p.set("fueltype", fuel[filters.fuel as keyof typeof fuel]);
  if (filters.transmission && filters.transmission in gear)
    p.set("geartype", gear[filters.transmission as keyof typeof gear]);
  return url;
}

export function autoheroUrl(filters: Filters) {
  const url = new URL("https://www.autohero.com/de/search/");
  const p = url.searchParams;
  if (filters.make) p.set("brand0", filters.make.toLowerCase());
  if (filters.make && filters.model) {
    let model = filters.model.trim();
    if (filters.make === "BMW" && /^[1-8]\d\d\s?[ide]/i.test(model))
      model = `${model[0]}er`;
    // Trim/engine variants are still checked against the full listing locally.
    p.set(
      "models0",
      model.replace(/\s+(competition|gti|gtd|avant|touring|sportback).*$/i, ""),
    );
  }
  for (const [key, value] of Object.entries({
    priceMin: filters.minPrice,
    priceMax: filters.maxPrice,
    yearMin: filters.minYear,
    yearMax: filters.maxYear,
    mileageMax: filters.maxMileage,
  }))
    if (value !== undefined) p.set(key, String(value));
  return url;
}

export function marktUrl(filters: Filters) {
  const query = [filters.make, filters.model]
    .filter(Boolean)
    .join(" ")
    .trim()
    .toLowerCase();
  const url = new URL(
    `https://www.markt.de/fahrzeuge/autos/${query ? `suche/${encodeURIComponent(query).replaceAll("%20", "+")}/` : ""}`,
  );
  for (const [key, value] of Object.entries({
    minPrice: filters.minPrice,
    maxPrice: filters.maxPrice,
    attr_gt_yearcar: filters.minYear,
    attr_lt_yearcar: filters.maxYear,
    attr_lt_milage_vehicle: filters.maxMileage,
  }))
    if (value !== undefined) url.searchParams.set(key, String(value));
  return url;
}

export function quokaUrl(filters: Filters, page = 1) {
  const make = slug(filters.make || "");
  let model = slug(filters.model || "").replace(
    /-(competition|gti|gtd|avant|touring|sportback).*$/,
    "",
  );
  if (make === "bmw") {
    if (/^m[2-8]$/.test(model)) model = "m-modelle";
    else if (/^\d{3}[die]/.test(model)) model = model.slice(0, 3);
  }
  const url = new URL(
    `https://www.quoka.de/anzeigen/auto-motorrad/automarkt/${make ? `${make}/` : ""}${make && model ? `${model}/` : ""}`,
  );
  if (page > 1) url.searchParams.set("pag", String(page));
  return url;
}

export function autodeUrl(filters: Filters) {
  const make = slug(filters.make || "");
  const model = slug(filters.model || "").replace(
    /-(competition|gti|gtd|avant|touring|sportback).*$/,
    "",
  );
  return new URL(
    `https://www.auto.de/angebot/${make ? `${make}/` : ""}${make && model ? `${model}/` : ""}`,
  );
}

export function publicSearchUrl(
  source: PublicSource,
  filters: Filters,
  page = 1,
) {
  const builders = {
    autoscout: autoScoutUrl,
    kleinanzeigen: kleinanzeigenUrl,
    pkw: pkwUrl,
    autohero: autoheroUrl,
    markt: marktUrl,
    quoka: quokaUrl,
    autode: autodeUrl,
  };
  return builders[source](filters, page);
}
