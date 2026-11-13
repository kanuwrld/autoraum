import { z } from "zod";
import { sourceNames, type ExternalSourceId } from "./types";
export const externalSourceIdSchema = z
  .string()
  .regex(
    /^feed:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    "Ungültige Anbieter-ID.",
  )
  .transform((value) => value as ExternalSourceId);
export const sourceSchema = z.union([
  z.enum(
    Object.keys(sourceNames) as [
      keyof typeof sourceNames,
      ...(keyof typeof sourceNames)[],
    ],
  ),
  externalSourceIdSchema,
]);
const optionalNumber = (min: number, max: number) =>
  z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z.coerce.number().int().min(min).max(max).optional(),
  );
const canonicalMake = (value: string) =>
  value.toUpperCase() === "VW" ? "VOLKSWAGEN" : value.toUpperCase();
export const filtersSchema = z
  .object({
    make: z.string().trim().max(60).transform(canonicalMake).optional(),
    model: z.string().trim().max(100).optional(),
    minPrice: optionalNumber(0, 5_000_000),
    maxPrice: optionalNumber(0, 5_000_000),
    minYear: optionalNumber(1900, 2100),
    maxYear: optionalNumber(1900, 2100),
    maxMileage: optionalNumber(0, 3_000_000),
    fuel: z
      .enum(["", "PETROL", "DIESEL", "ELECTRICITY", "HYBRID", "OTHER"])
      .optional(),
    transmission: z
      .enum(["", "AUTOMATIC_GEAR", "MANUAL_GEAR", "SEMIAUTOMATIC_GEAR"])
      .optional(),
    location: z.string().trim().max(100).optional(),
    sources: z.array(sourceSchema).max(50).optional(),
    undamagedOnly: z.boolean().optional(),
  })
  .refine(
    (v) => !v.model || !!v.make,
    "Bitte zuerst eine Marke für die Modellsuche auswählen.",
  )
  .refine(
    (v) =>
      v.minPrice === undefined ||
      v.maxPrice === undefined ||
      v.minPrice <= v.maxPrice,
    "Der Mindestpreis darf nicht höher als der Höchstpreis sein.",
  )
  .refine(
    (v) =>
      v.minYear === undefined ||
      v.maxYear === undefined ||
      v.minYear <= v.maxYear,
    "Bitte den Zeitraum der Erstzulassung prüfen.",
  );

export const publicUrl = z
  .url()
  .max(2000)
  .refine((value) => {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      u.hostname.includes(".") &&
      !/^localhost$|\.local$|^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./i.test(
        u.hostname,
      ) &&
      !u.hostname.includes(":")
    );
  }, "Eine öffentliche HTTPS-Adresse eingeben.");

export const listingInputSchema = z.object({
  externalId: z.string().trim().min(1).max(150),
  source: sourceSchema,
  url: publicUrl,
  title: z.string().trim().min(2).max(250),
  make: z.string().trim().min(1).max(60).transform(canonicalMake),
  model: z.string().trim().min(1).max(100),
  price: z.coerce.number().finite().min(0).max(5_000_000),
  year: optionalNumber(1900, 2100),
  mileage: optionalNumber(0, 3_000_000),
  fuel: z
    .enum(["PETROL", "DIESEL", "ELECTRICITY", "HYBRID", "OTHER", "UNKNOWN"])
    .default("UNKNOWN"),
  transmission: z
    .enum(["AUTOMATIC_GEAR", "MANUAL_GEAR", "SEMIAUTOMATIC_GEAR", ""])
    .default(""),
  city: z.string().trim().max(100).default(""),
  postalCode: z
    .string()
    .regex(/^\d{5}$|^$/, "PLZ muss aus fünf Ziffern bestehen.")
    .default(""),
  sellerType: z.enum(["DEALER", "PRIVATE", "UNKNOWN"]).default("UNKNOWN"),
  imageUrl: publicUrl.optional(),
  damaged: z.boolean().optional(),
  active: z.boolean().default(true),
});
export type ListingInput = z.infer<typeof listingInputSchema>;
export const saveSearchSchema = z.object({
  name: z.string().trim().min(2, "Bitte einen Namen eingeben.").max(80),
  filters: filtersSchema,
  enabled: z.boolean().default(false),
  intervalMinutes: z
    .union([
      z.literal(15),
      z.literal(30),
      z.literal(60),
      z.literal(180),
      z.literal(1440),
    ])
    .default(60),
});
export const optionalMoney = z.preprocess(
  (v) => {
    if (v === undefined || v === null || (typeof v === "string" && !v.trim()))
      return undefined;
    return typeof v === "string" || typeof v === "number" ? v : Number.NaN;
  },
  z.coerce
    .number()
    .finite()
    .min(0)
    .max(5_000_000)
    .refine(
      (v) => Math.abs(v * 100 - Math.round(v * 100)) < 0.00001,
      "Maximal zwei Nachkommastellen.",
    )
    .optional(),
);
export const purchasePlanSchema = z.object({
  transport: optionalMoney,
  repairs: optionalMoney,
  preparation: optionalMoney,
  fees: optionalMoney,
  reserve: optionalMoney,
  desiredProfit: optionalMoney,
});
export const bookmarkSchema = z.object({
  stage: z
    .enum(["saved", "contacted", "appointment", "purchased", "rejected"])
    .default("saved"),
  notes: z.string().max(5000).default(""),
  targetPrice: optionalMoney,
  costs: optionalMoney,
  salePrice: optionalMoney,
  purchasePlan: purchasePlanSchema.optional(),
});

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T12:00:00Z`);
    return (
      Number.isFinite(d.getTime()) &&
      d.toISOString().slice(0, 10) === v &&
      v >= "2020-01-01" &&
      v <= "2100-12-31"
    );
  }, "Bitte ein gültiges Fälligkeitsdatum eingeben.");
export const taskSchema = z.object({
  title: z.string().trim().min(2, "Bitte eine Aufgabe beschreiben.").max(160),
  notes: z.string().trim().max(2000).default(""),
  assigneeId: z.string().min(1).max(100),
  listingId: z.string().uuid().nullable().default(null),
  dueDate: calendarDate,
});
export const taskUpdateSchema = taskSchema.extend({
  version: z.number().int().positive(),
});
export const taskCreateSchema = taskSchema.extend({
  requestId: z.string().uuid().optional(),
});
export const taskStatusSchema = z.object({
  version: z.number().int().positive(),
  status: z.enum(["open", "done"]),
});
