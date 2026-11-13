"use client";

import { NativeSelect } from "./ui/native-select";
import { Input } from "./ui/input";
import {
  BookmarkPlus,
  RotateCcw,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "./ui/button";
import type { ExternalSource, Filters, Source } from "@/lib/types";
import { fuelNames, sourceNames, transmissionNames } from "@/lib/types";
import { Spinner } from "./ui";

export function SearchPanel({
  filters,
  setFilters,
  busy,
  onSearch,
  onSave,
  externalSources,
}: {
  filters: Filters;
  setFilters: (f: Filters) => void;
  busy: boolean;
  onSearch: () => void;
  onSave: () => void;
  externalSources: ExternalSource[];
}) {
  const sources: { id: Source; name: string }[] = [
    ...Object.entries(sourceNames).map(([id, name]) => ({
      id: id as Source,
      name,
    })),
    ...externalSources.filter(
      (s) => s.listingCount > 0 || filters.sources?.includes(s.id),
    ),
  ];
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters({ ...filters, [key]: value });
  const numeric = (
    key: "minPrice" | "maxPrice" | "minYear" | "maxYear" | "maxMileage",
    label: string,
    placeholder: string,
    max: number,
  ) => (
    <label>
      {label}
      <Input
        type="number"
        min="0"
        max={max}
        step="1"
        placeholder={placeholder}
        value={filters[key] ?? ""}
        onChange={(e) =>
          set(key, e.target.value === "" ? undefined : Number(e.target.value))
        }
      />
    </label>
  );
  return (
    <section className="panel search-panel">
      <div className="search-panel-header">
        <div>
          <h2>Suchkriterien</h2>
        </div>
        <span className="filter-caption">
          <SlidersHorizontal size={15} />
          Deutschland
        </span>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSearch();
        }}
      >
        <div className="form-grid four">
          <label>
            Marke
            <NativeSelect
              aria-label="Marke"
              value={filters.make || ""}
              onChange={(e) =>
                setFilters({ ...filters, make: e.target.value, model: "" })
              }
            >
              <option value="">Alle Marken</option>
              {[
                "AUDI",
                "BMW",
                "MERCEDES-BENZ",
                "VOLKSWAGEN",
                "PORSCHE",
                "OPEL",
                "FORD",
                "SKODA",
                "SEAT",
                "TOYOTA",
                "VOLVO",
                "RENAULT",
                "PEUGEOT",
                "HYUNDAI",
                "KIA",
                "TESLA",
                "MINI",
                "FIAT",
              ].map((make) => (
                <option key={make} value={make}>
                  {make === "MERCEDES-BENZ"
                    ? "Mercedes-Benz"
                    : make === "VOLKSWAGEN"
                      ? "Volkswagen"
                      : make.length > 5
                        ? make.charAt(0) + make.slice(1).toLowerCase()
                        : make}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label>
            Modell
            <Input
              placeholder="z. B. Golf, 320d, A4"
              value={filters.model || ""}
              disabled={!filters.make}
              maxLength={100}
              onChange={(e) => set("model", e.target.value)}
            />
          </label>
          {numeric("minPrice", "Preis ab (€)", "Keine Untergrenze", 5000000)}
          {numeric("maxPrice", "Preis bis (€)", "Keine Obergrenze", 5000000)}
          {numeric("minYear", "Erstzulassung ab", "z. B. 2019", 2100)}
          {numeric("maxYear", "Erstzulassung bis", "Alle Baujahre", 2100)}
          {numeric("maxMileage", "Kilometer bis", "z. B. 100000", 3000000)}
          <label>
            Kraftstoff
            <NativeSelect
              aria-label="Kraftstoff"
              value={filters.fuel || ""}
              onChange={(e) => set("fuel", e.target.value)}
            >
              <option value="">Alle Kraftstoffe</option>
              {Object.entries(fuelNames).map(([v, l]) => (
                <option value={v} key={v}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </label>
        </div>
        <details className="extra-filters">
          <summary>
            Weitere Filter <span>Getriebe, Ort, Datenquellen</span>
          </summary>
          <div className="form-grid four">
            <label>
              Getriebe
              <NativeSelect
                aria-label="Getriebe"
                value={filters.transmission || ""}
                onChange={(e) => set("transmission", e.target.value)}
              >
                <option value="">Alle Getriebe</option>
                {Object.entries(transmissionNames).map(([v, l]) => (
                  <option value={v} key={v}>
                    {l}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label>
              Ort oder PLZ
              <Input
                placeholder="z. B. München oder 930"
                value={filters.location || ""}
                maxLength={100}
                onChange={(e) => set("location", e.target.value)}
              />
              <small>Teilwortsuche, kein Entfernungsradius.</small>
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={!!filters.undamagedOnly}
                onChange={(e) => set("undamagedOnly", e.target.checked)}
              />
              <span>
                Nur ohne unreparierte Schäden
                <small>Anzeigen ohne Angabe ausblenden.</small>
              </span>
            </label>
          </div>
          <div className="source-checkboxes">
            <span>Quellen</span>
            {sources.map(({ id: key, name: label }) => (
              <label key={key} className="max-w-full">
                <input
                  type="checkbox"
                  checked={filters.sources?.includes(key) || false}
                  onChange={(e) =>
                    set(
                      "sources",
                      e.target.checked
                        ? [...(filters.sources || []), key]
                        : filters.sources?.filter((s) => s !== key),
                    )
                  }
                />
                <span className="min-w-0 break-words">{label}</span>
              </label>
            ))}
            <small>Keine Auswahl = alle Quellen</small>
          </div>
        </details>
        <div className="search-panel-footer">
          <div className="button-row">
            <Button className="search-button h-10" disabled={busy}>
              {busy ? <Spinner /> : <Search size={17} />}Jetzt suchen
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-10"
              disabled={busy}
              onClick={onSave}
            >
              <BookmarkPlus size={17} />
              Suche speichern
            </Button>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => setFilters({})}
          >
            <RotateCcw size={14} />
            Zurücksetzen
          </Button>
        </div>
      </form>
    </section>
  );
}
