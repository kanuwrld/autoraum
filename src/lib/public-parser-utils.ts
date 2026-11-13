import type { ListingInput } from "./validation";

export type ParsedPage = {
  items: ListingInput[];
  more: boolean;
  skipped: number;
};

export const digits = (value: string | undefined) =>
  value && /\d/.test(value) ? Number(value.replace(/[^\d]/g, "")) : undefined;
export function fuelType(value: string) {
  if (/hybrid|elektro\/(benzin|diesel)/i.test(value)) return "HYBRID";
  if (/benzin|\bpetrol\b/i.test(value)) return "PETROL";
  if (/diesel/i.test(value)) return "DIESEL";
  if (/elektro|\belectric\b/i.test(value)) return "ELECTRICITY";
  if (/autogas|erdgas|wasserstoff|ethanol|sonstige|andere/i.test(value))
    return "OTHER";
  return "UNKNOWN";
}
export function transmission(value: string) {
  if (/halbautomatik/i.test(value)) return "SEMIAUTOMATIC_GEAR";
  if (/automatik|\bautomatic\b|\bDKG\b|\bDSG\b/i.test(value))
    return "AUTOMATIC_GEAR";
  if (/schaltgetriebe|\bschalter\b|\bmanuell\b|\bmanual\b/i.test(value))
    return "MANUAL_GEAR";
  return "";
}
export function trustedUrl(path: string, origin: string) {
  const url = new URL(path, origin);
  if (url.origin !== origin || url.username || url.password)
    throw new Error("Unexpected listing origin");
  return url.href;
}

export const makes = [
  "Mercedes-Benz",
  "Mercedes Benz",
  "Volkswagen",
  "Alfa Romeo",
  "Land Rover",
  "Aston Martin",
  "BMW",
  "Audi",
  "Porsche",
  "Opel",
  "Ford",
  "Skoda",
  "Škoda",
  "Seat",
  "Toyota",
  "Volvo",
  "Renault",
  "Peugeot",
  "Hyundai",
  "Kia",
  "Tesla",
  "Mini",
  "Fiat",
  "Honda",
  "Mazda",
  "Nissan",
  "Citroën",
  "Citroen",
  "Dacia",
  "Cupra",
  "Suzuki",
  "Mitsubishi",
  "Smart",
  "Jeep",
  "VW",
];
