"use client";
import { NativeSelect } from "./ui/native-select";
import {
  ArrowRight,
  CarFront,
  Check,
  ChevronLeft,
  ChevronRight,
  FileUp,
  LayoutGrid,
  ListFilter,
  Plug,
  Search,
} from "lucide-react";
import type { ExternalSource, Listing } from "@/lib/types";
import { sourceName, stageNames } from "@/lib/types";
import { number } from "./ui";
import { ListingCard } from "./listing-card";
export function SearchResults({
  savedOnly,
  inventoryCount,
  asOf,
  listings,
  total,
  busy,
  stage,
  sort,
  page,
  onStageChange,
  onSortChange,
  onPageChange,
  onBookmark,
  onEdit,
  onTask,
  onResearch,
  onSources,
  onImport,
  externalSources,
}: {
  savedOnly: boolean;
  inventoryCount: number;
  asOf: number;
  listings: Listing[];
  total: number;
  busy: boolean;
  stage: string;
  sort: string;
  page: number;
  onStageChange: (stage: string) => void;
  onSortChange: (sort: string) => void;
  onPageChange: (page: number) => void;
  onBookmark: (listing: Listing) => void;
  onEdit: (listing: Listing) => void;
  onTask: (listing: Listing) => void;
  onResearch: () => void;
  onSources?: () => void;
  onImport: () => void;
  externalSources: ExternalSource[];
}) {
  return (
    <section className="results-section" aria-busy={!!busy}>
      <div className="results-toolbar">
        <div className="results-title">
          <h2>{savedOnly ? "Ihre Auswahl" : "Suchergebnisse"}</h2>
          <span className="count-pill">{number(total)}</span>
        </div>
        <div className="results-controls">
          {savedOnly && (
            <NativeSelect
              aria-label="Status filtern"
              value={stage}
              disabled={!!busy}
              onChange={(e) => onStageChange(e.target.value)}
            >
              <option value="">Alle Status</option>
              {Object.entries(stageNames).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          )}
          <label className="sort-control">
            <ListFilter size={15} />
            <NativeSelect
              aria-label="Sortierung"
              value={sort}
              disabled={!!busy}
              onChange={(e) => onSortChange(e.target.value)}
            >
              <option value="newest">Neueste zuerst</option>
              <option value="price_asc">Preis aufsteigend</option>
              <option value="price_desc">Preis absteigend</option>
              <option value="mileage">Wenigste Kilometer</option>
            </NativeSelect>
          </label>
          <span className="view-icon">
            <LayoutGrid size={16} />
          </span>
        </div>
      </div>
      {listings.length ? (
        <>
          <div className="listings-grid">
            {listings.map((listing) => (
              <ListingCard
                key={listing.id}
                listing={listing}
                sourceLabel={sourceName(listing.source, externalSources)}
                asOf={asOf}
                busy={!!busy}
                onSave={() => onBookmark(listing)}
                onEdit={() => onEdit(listing)}
                onTask={() => onTask(listing)}
              />
            ))}
          </div>
          <div className="pagination">
            <span>
              {(page - 1) * 24 + 1}–{Math.min(page * 24, total)} von{" "}
              {number(total)} Anzeigen
            </span>
            <div className="button-row">
              <button
                className="button secondary small"
                disabled={page <= 1 || !!busy}
                onClick={() => onPageChange(page - 1)}
              >
                <ChevronLeft size={15} />
                Zurück
              </button>
              <button
                className="button secondary small"
                disabled={page * 24 >= total || !!busy}
                onClick={() => onPageChange(page + 1)}
              >
                Weiter
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="panel results-empty">
          <div className="empty-car">
            <div className="radar-ring" />
            <CarFront size={42} strokeWidth={1.3} />
            <span>
              <Search size={16} />
            </span>
          </div>
          <span className="eyebrow">
            {savedOnly
              ? "PLATZ FÜR GUTE ANKÄUFE"
              : inventoryCount
                ? "FILTER ANPASSEN"
                : "BEREIT FÜR IHREN ERSTEN TREFFER"}
          </span>
          <h3>
            {savedOnly
              ? "Ihre nächste Auswahl wartet."
              : inventoryCount
                ? "Keine passenden Fahrzeuge gefunden."
                : "Finden Sie Ihren nächsten Ankauf."}
          </h3>
          <p>
            {savedOnly
              ? "Merken Sie interessante Fahrzeuge in der Recherche.\nHier begleiten Sie jeden Ankauf bis zum Abschluss."
              : inventoryCount
                ? "Passen Sie Ihre Kriterien an oder starten Sie die Suche erneut."
                : "Wählen Sie Marke, Modell und Budget und starten Sie die Suche.\nDie aktivierten Quellen werden direkt abgefragt."}
          </p>
          <div className="button-row">
            {savedOnly ? (
              <button className="button primary" onClick={() => onResearch()}>
                Zur Fahrzeugrecherche
                <ArrowRight size={16} />
              </button>
            ) : (
              <>
                {onSources && (
                  <button
                    className="button secondary"
                    onClick={() => onSources()}
                  >
                    <Plug size={16} />
                    Datenquellen ansehen
                  </button>
                )}
                <button className="button secondary" onClick={() => onImport()}>
                  <FileUp size={16} />
                  CSV importieren
                </button>
              </>
            )}
          </div>
          <div className="empty-footnote">
            <Check size={13} />
            Nur Daten aus Ihren verbundenen Quellen. Keine Beispielanzeigen.
          </div>
        </div>
      )}
    </section>
  );
}
