"use client";

import { ArrowUpRight, FileUp, Settings2 } from "lucide-react";
import {
  publicSourceIds,
  sourceNames,
  type Filters,
  type SourceResult,
  type Workspace,
} from "@/lib/types";
import { mobileMarketplaceUrl, publicSearchUrl } from "@/lib/marketplace-links";
import { dateTime } from "./ui";

function statusText(
  result: SourceResult | undefined,
  enabled: boolean,
  hasRun: boolean,
) {
  if (result?.status === "error") return "Abruf fehlgeschlagen";
  if (result?.status === "disconnected" || !enabled) return "Nicht verbunden";
  if (result?.status === "cached")
    return result.stale ? "Veralteter Stand" : "Zwischenspeicher";
  if (result?.status === "ok") return "Erreicht";
  return hasRun ? "Nicht abgefragt" : "Bereit · noch nicht geprüft";
}

export function SourceStatus({
  data,
  filters,
  onImport,
  onManage,
}: {
  data: Workspace;
  filters: Filters;
  onImport: () => void;
  onManage?: () => void;
}) {
  const latestRun = data.runs[0];
  const report = latestRun?.results ?? [];
  const sources = [...publicSourceIds, "mobile" as const].map((source) => {
    const result = report.find(
      (r) => r.sourceId === source || r.source === sourceNames[source],
    );
    const enabled =
      source === "mobile" ? data.providers.mobile : data.providers.publicSearch;
    const url =
      source === "mobile"
        ? mobileMarketplaceUrl(filters)
        : publicSearchUrl(source, filters);
    return {
      source,
      result,
      enabled,
      url,
      status: statusText(result, enabled, !!latestRun),
    };
  });
  return (
    <section
      className="panel source-status"
      aria-label="Suchstatus der Quellen"
    >
      <div className="source-status-heading">
        <div>
          <h2>Quellen im Suchlauf</h2>
          <p>
            {latestRun
              ? `Letzter Suchlauf: ${dateTime(latestRun.started_at)}`
              : "Der erste Suchlauf prüft die Erreichbarkeit."}
          </p>
        </div>
        <div className="button-row">
          <button className="button secondary small" onClick={onImport}>
            <FileUp size={14} /> CSV importieren
          </button>
          {onManage && (
            <button
              className="button secondary small icon"
              aria-label="Datenquellen verwalten"
              onClick={onManage}
            >
              <Settings2 size={15} />
            </button>
          )}
        </div>
      </div>
      <div className="source-status-grid">
        {sources.map(({ source, result, enabled, url, status }) => (
          <a
            key={source}
            className="source-status-item"
            data-state={
              result?.stale
                ? "stale"
                : result?.status || (enabled ? "ready" : "disconnected")
            }
            href={url.href}
            target="_blank"
            rel="noopener noreferrer"
            title={`${sourceNames[source]} direkt öffnen`}
          >
            <strong>
              {sourceNames[source]}
              <ArrowUpRight size={13} />
            </strong>
            <span>{status}</span>
            {result &&
              (result.status === "ok" || result.status === "cached") && (
                <small>
                  {result.count} abgerufen
                  {result.truncated ? " · begrenzte Auswahl" : ""}
                </small>
              )}
          </a>
        ))}
      </div>
      <details className="source-status-details">
        <summary>Abrufdetails & Datenstand</summary>
        <p>
          „Abgerufen“ zählt Anzeigen vor Ihren lokalen Filtern. Ein
          erfolgreicher Abruf kann 0 passende Fahrzeuge liefern. Öffentliche
          Suchen zeigen einen begrenzten Ausschnitt; zusätzliche Filter werden
          in Autoraum geprüft.
        </p>
        {sources.map(({ source, result, enabled }) => (
          <div className="source-status-detail" key={source}>
            <strong>{sourceNames[source]}</strong>
            <div>
              <p>
                {result?.message ||
                  (source === "mobile" && !enabled
                    ? "Nicht im automatischen Suchlauf: Search-API-Zugang fehlt. Der Link öffnet nur die Plattform."
                    : enabled
                      ? "Bei Auswahl dieser Quelle wird sie im nächsten Suchlauf abgefragt."
                      : "Die öffentliche Suche ist in dieser Installation deaktiviert.")}
              </p>
              {result?.fetchedAt && (
                <small>Daten abgerufen: {dateTime(result.fetchedAt)}</small>
              )}
            </div>
          </div>
        ))}
        {report
          .filter((r) => !sources.some((s) => s.result === r))
          .map((result) => (
            <div
              className="source-status-detail"
              key={result.sourceId || result.source}
            >
              <strong>{result.source}</strong>
              <p>{result.message}</p>
            </div>
          ))}
      </details>
    </section>
  );
}
