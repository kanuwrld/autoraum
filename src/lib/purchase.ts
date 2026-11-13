import type { Listing, PurchasePlan } from "./types";

export const purchaseFields = [
  { key: "transport", column: "transport_cents", label: "Transport (€)" },
  { key: "repairs", column: "repairs_cents", label: "Reparaturen (€)" },
  {
    key: "preparation",
    column: "preparation_cents",
    label: "Aufbereitung (€)",
  },
  { key: "fees", column: "fees_cents", label: "Gebühren (€)" },
  { key: "reserve", column: "reserve_cents", label: "Reserve (€)" },
  {
    key: "desiredProfit",
    column: "desired_profit_cents",
    label: "Gewünschter Überschuss (€)",
  },
] as const;

export const toCents = (amount: number | undefined) =>
  amount === undefined ? null : Math.round(amount * 100);

export function calculatePurchase(
  listing: Pick<
    Listing,
    "sale_price_cents" | "costs_cents" | "target_price_cents" | "price_cents"
  >,
  plan: PurchasePlan | null | undefined,
) {
  const amounts = [
    listing.sale_price_cents,
    listing.costs_cents,
    ...purchaseFields.map((f) => plan?.[f.column]),
  ];
  const missing = amounts.filter((n) => n === null || n === undefined).length;
  if (missing)
    return {
      missing,
      maxPurchaseCents: null,
      differenceCents: null,
      costsCents: null,
    };
  const costsCents =
    listing.costs_cents! +
    plan!.transport_cents! +
    plan!.repairs_cents! +
    plan!.preparation_cents! +
    plan!.fees_cents! +
    plan!.reserve_cents!;
  return {
    missing: 0,
    costsCents,
    maxPurchaseCents:
      listing.sale_price_cents! - costsCents - plan!.desired_profit_cents!,
    differenceCents:
      listing.sale_price_cents! -
      costsCents -
      (listing.target_price_cents ?? listing.price_cents),
  };
}
