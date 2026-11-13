"use client";

import { useState, type FormEvent } from "react";
import { Bookmark, X } from "lucide-react";
import { NativeSelect } from "./ui/native-select";
import { Input } from "./ui/input";
import {
  type Listing,
  type PurchasePlan,
  type Stage,
  stageNames,
} from "@/lib/types";
import { calculatePurchase, purchaseFields } from "@/lib/purchase";
import { euros, Modal, Notice, request, Spinner } from "./ui";

const amountText = (n: number | null | undefined) =>
  n === null || n === undefined ? "" : String(n / 100);
function inputCents(value: string) {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 5_000_000
    ? Math.round(n * 100)
    : null;
}

export function ListingEditor({
  listing,
  sourceLabel,
  slug,
  onClose,
  onSaved,
}: {
  listing: Listing;
  sourceLabel: string;
  slug: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [stage, setStage] = useState<Stage>(listing.stage || "saved");
  const [target, setTarget] = useState(amountText(listing.target_price_cents));
  const [costs, setCosts] = useState(amountText(listing.costs_cents));
  const [sale, setSale] = useState(amountText(listing.sale_price_cents));
  const [plan, setPlan] = useState<
    Record<(typeof purchaseFields)[number]["key"], string>
  >(
    () =>
      Object.fromEntries(
        purchaseFields.map((f) => [
          f.key,
          amountText(listing.purchasePlan?.[f.column]),
        ]),
      ) as Record<(typeof purchaseFields)[number]["key"], string>,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const calculated = calculatePurchase(
    {
      sale_price_cents: inputCents(sale),
      target_price_cents: inputCents(target),
      costs_cents: inputCents(costs),
      price_cents: listing.price_cents,
    },
    Object.fromEntries(
      purchaseFields.map((f) => [f.column, inputCents(plan[f.key])]),
    ) as PurchasePlan,
  );
  // Preserve the old three-field planning view until itemized costs have been completed.
  const legacyDifference =
    purchaseFields.every((f) => plan[f.key] === "") && sale && costs !== ""
      ? inputCents(sale)! -
        (inputCents(target) ?? listing.price_cents) -
        inputCents(costs)!
      : null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const values = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await request(`/api/w/${slug}/saved/${listing.id}`, "PUT", {
        stage,
        notes: values.get("notes"),
        targetPrice: target,
        costs,
        salePrice: sale,
        purchasePlan: plan,
      });
      await onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Ankauf bearbeiten"
      wide
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="editor-vehicle">
        <div>
          <span className="eyebrow">{sourceLabel}</span>
          <h3>{listing.title}</h3>
        </div>
        <strong>{euros(listing.price_cents)}</strong>
      </div>
      <form className="form-stack" onSubmit={submit}>
        <label>
          Status
          <NativeSelect
            aria-label="Status"
            value={stage}
            onChange={(e) => setStage(e.target.value as Stage)}
            disabled={busy}
          >
            {Object.entries(stageNames).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label>
          Notizen
          <textarea
            name="notes"
            rows={3}
            maxLength={5000}
            defaultValue={listing.notes || ""}
            placeholder="Gespräch, Zustand, Besichtigung …"
            disabled={busy}
          />
        </label>
        <div className="form-grid three">
          <label>
            Geplanter Einkauf (€)
            <Input
              type="number"
              min="0"
              max="5000000"
              step="0.01"
              value={target}
              disabled={busy}
              placeholder={String(listing.price_cents / 100)}
              onChange={(e) => setTarget(e.target.value)}
            />
          </label>
          <label>
            Weitere Kosten (€)
            <Input
              type="number"
              min="0"
              max="5000000"
              step="0.01"
              value={costs}
              disabled={busy}
              placeholder="Sonstige Kosten"
              onChange={(e) => setCosts(e.target.value)}
            />
          </label>
          <label>
            Geplanter Verkauf (€)
            <Input
              type="number"
              min="0"
              max="5000000"
              step="0.01"
              value={sale}
              disabled={busy}
              placeholder="Ihre Schätzung"
              onChange={(e) => setSale(e.target.value)}
            />
          </label>
        </div>
        <section className="purchase-section" aria-labelledby="purchase-title">
          <div className="section-heading">
            <div>
              <h3 id="purchase-title">Maximaler Einkaufspreis</h3>
              <p>Ihr Limit aus Verkauf, Kosten und gewünschtem Überschuss.</p>
            </div>
          </div>
          <p className="helper">
            Weitere Kosten bleiben zusätzlich erhalten. Bereits dort erfasste
            Ausgaben nicht erneut eintragen.
          </p>
          <div className="form-grid three">
            {purchaseFields.map((field) => (
              <label key={field.key}>
                {field.label}
                <Input
                  type="number"
                  min="0"
                  max="5000000"
                  step="0.01"
                  value={plan[field.key]}
                  disabled={busy}
                  placeholder="Noch offen"
                  onChange={(e) =>
                    setPlan({ ...plan, [field.key]: e.target.value })
                  }
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => {
              setCosts((v) => v || "0");
              setPlan((p) => ({
                ...p,
                ...Object.fromEntries(
                  purchaseFields
                    .filter((f) => f.key !== "desiredProfit")
                    .map((f) => [f.key, p[f.key] || "0"]),
                ),
              }));
            }}
          >
            Offene Kosten bewusst mit 0 € ansetzen
          </button>
          <div className="purchase-limit" role="status" aria-live="polite">
            <span>Maximaler Einkaufspreis</span>
            <strong>
              {calculated.maxPurchaseCents === null
                ? "—"
                : euros(calculated.maxPurchaseCents)}
            </strong>
            <small>
              {calculated.missing
                ? `${calculated.missing} ${calculated.missing === 1 ? "Betrag fehlt" : "Beträge fehlen"}. Leere Felder gelten als unbekannt.`
                : "Verkauf − sämtliche Kosten − Reserve − gewünschter Überschuss"}
            </small>
          </div>
          {calculated.maxPurchaseCents !== null && (
            <p className="helper">
              {calculated.maxPurchaseCents < 0
                ? "Mit diesen Annahmen ist kein positiver Einkaufspreis möglich."
                : `${target ? "Geplanter Einkauf" : "Angebotspreis"}: ${euros(inputCents(target) ?? listing.price_cents)} · ${euros(Math.abs((inputCents(target) ?? listing.price_cents) - calculated.maxPurchaseCents))} ${(inputCents(target) ?? listing.price_cents) > calculated.maxPurchaseCents ? "über" : "unter"} Ihrem Limit.`}
            </p>
          )}
        </section>
        <div className="calculation">
          <span>
            {calculated.missing
              ? "Bisherige Preisdifferenz (ohne offene Einzelkosten)"
              : "Überschuss nach Kosten & Reserve"}
          </span>
          <strong>
            {(calculated.differenceCents ?? legacyDifference) === null
              ? "—"
              : euros((calculated.differenceCents ?? legacyDifference)!)}
          </strong>
        </div>
        <p className="helper">
          Eigene Planung vor Steuern und nicht erfassten Kosten. Beträge auf
          derselben Preisbasis eingeben; keine automatische Steuerberechnung
          oder Gewinnprognose.
        </p>
        {error && <Notice message={error} error />}
        <div className="modal-actions spread">
          {listing.stage && (
            <button
              type="button"
              className="text-button danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await request(
                    `/api/w/${slug}/saved/${listing.id}`,
                    "DELETE",
                    {},
                  );
                  await onSaved();
                  onClose();
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Fehler");
                  setBusy(false);
                }
              }}
            >
              <X size={14} />
              Aus Merkliste entfernen
            </button>
          )}
          <button className="button primary" disabled={busy}>
            {busy ? <Spinner /> : <Bookmark size={16} />}Änderungen speichern
          </button>
        </div>
      </form>
    </Modal>
  );
}
