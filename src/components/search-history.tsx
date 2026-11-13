"use client";
import {
  ArrowUpRight,
  CirclePause,
  Clock3,
  History,
  Play,
  Plus,
  Radar,
  Search,
  Trash2,
} from "lucide-react";
import type { Filters, SavedSearch, SearchRun } from "@/lib/types";
import { Badge, dateTime, number, Spinner } from "./ui";
const runLabels: Record<string, string> = {
  completed: "Abgeschlossen",
  partial: "Teilweise",
  no_sources: "Keine Datenquelle",
  failed: "Fehlgeschlagen",
  running: "Läuft",
  interrupted: "Unterbrochen",
};
export function SearchJobs({
  searches,
  heartbeat,
  schedulerActive,
  busy,
  onRun,
  onToggle,
  onLoad,
  onDelete,
  onNew,
}: {
  searches: SavedSearch[];
  heartbeat: number | null;
  schedulerActive: boolean;
  busy: string;
  onRun: (search: SavedSearch) => void;
  onToggle: (search: SavedSearch) => void;
  onLoad: (filters: Filters) => void;
  onDelete: (search: SavedSearch) => void;
  onNew: () => void;
}) {
  return (
    <>
      <div className="scheduler-banner">
        <Radar size={23} />
        <div>
          <strong>
            {schedulerActive
              ? "Ihr Suchplaner ist aktiv."
              : "Der Suchplaner ist aktuell nicht aktiv."}
          </strong>
          <p>
            {schedulerActive
              ? `Zuletzt erreichbar: ${dateTime(heartbeat)}. Suchaufträge laufen auch bei geschlossenem Browser.`
              : "Aktivierte Aufträge warten auf den Server-Planer. Die manuelle Suche ist weiterhin verfügbar."}
          </p>
        </div>
        <Badge tone={schedulerActive ? "green" : "amber"}>
          {schedulerActive ? "Aktiv" : "Wartet"}
        </Badge>
      </div>
      {searches.length ? (
        <div className="saved-searches">
          {searches.map((s) => (
            <article className="panel saved-search" key={s.id}>
              <div className="saved-search-top">
                <span className="saved-search-icon">
                  <Radar size={22} />
                </span>
                <div>
                  <h2>{s.name}</h2>
                  <p>
                    {[
                      s.filters.make,
                      s.filters.model,
                      s.filters.maxPrice !== undefined
                        ? `bis ${number(s.filters.maxPrice)} €`
                        : "",
                      s.filters.minYear ? `ab ${s.filters.minYear}` : "",
                      s.filters.maxMileage !== undefined
                        ? `bis ${number(s.filters.maxMileage)} km`
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Alle Fahrzeuge aus Ihren Quellen"}
                  </p>
                </div>
                <Badge
                  tone={s.enabled && schedulerActive ? "green" : "neutral"}
                >
                  {s.enabled
                    ? schedulerActive
                      ? "Automatisch"
                      : "Wartet auf Planer"
                    : "Manuell"}
                </Badge>
              </div>
              <div className="saved-search-meta">
                <span>
                  <Clock3 size={14} />
                  Alle{" "}
                  {s.interval_minutes === 1440
                    ? "24 Stunden"
                    : `${s.interval_minutes} Minuten`}
                </span>
                <span>Letzter Lauf: {dateTime(s.last_run_at)}</span>
                <span>Bisher zugeordnet: {number(Number(s.match_count))}</span>
              </div>
              <div className="saved-search-bottom">
                <div className="button-row">
                  <button
                    className="button primary small"
                    disabled={!!busy}
                    onClick={() => onRun(s)}
                  >
                    {busy === "search" ? <Spinner /> : <Play size={14} />}
                    Jetzt suchen
                  </button>
                  <button
                    className="button secondary small"
                    disabled={!!busy}
                    onClick={() => onToggle(s)}
                  >
                    {s.enabled ? (
                      <CirclePause size={14} />
                    ) : (
                      <Radar size={14} />
                    )}
                    {s.enabled ? "Automatik pausieren" : "Automatik aktivieren"}
                  </button>
                </div>
                <div className="button-row">
                  <button
                    className="text-button"
                    onClick={() => onLoad(s.filters)}
                  >
                    Filter laden
                    <ArrowUpRight size={13} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`${s.name} löschen`}
                    disabled={!!busy}
                    onClick={() => onDelete(s)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="panel empty-state">
          <span className="empty-icon">
            <Radar size={32} />
          </span>
          <h3>Einmal einstellen. Wiederholt finden.</h3>
          <p>
            Speichern Sie Ihre Suchkriterien und legen Sie fest,
            <br />
            wie oft die Suche ausgeführt werden soll.
          </p>
          <button className="button primary" onClick={() => onNew()}>
            <Plus size={16} />
            Erste Suche erstellen
          </button>
        </div>
      )}
    </>
  );
}
export function SearchActivity({
  runs,
  busy,
  onRefresh,
}: {
  runs: SearchRun[];
  busy: boolean;
  onRefresh: () => void;
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Letzte Suchläufe</h2>
          <p>Die letzten 20 Läufe. Das Protokoll wird 90 Tage aufbewahrt.</p>
        </div>
        <button
          className="button secondary small"
          disabled={!!busy}
          onClick={onRefresh}
        >
          Aktualisieren
        </button>
      </div>
      {runs.length ? (
        runs.map((run) => (
          <details className="run-row" key={run.id}>
            <summary>
              <span className="activity-icon">
                <Search size={16} />
              </span>
              <div>
                <strong>{run.search_name || "Manuelle Suche"}</strong>
                <p>
                  {dateTime(run.started_at)} · {run.matches} Treffer
                  {run.search_id
                    ? ` · ${run.new_matches} erstmals zugeordnet`
                    : ""}
                </p>
              </div>
              <Badge
                tone={
                  run.status === "completed"
                    ? "green"
                    : run.status === "failed"
                      ? "red"
                      : "amber"
                }
              >
                {runLabels[run.status] || run.status}
              </Badge>
            </summary>
            <div className="run-row-details">
              {run.results.map((r) => (
                <div className="source-result" key={r.source}>
                  <strong>{r.source}</strong>
                  <p>{r.message}</p>
                </div>
              ))}
            </div>
          </details>
        ))
      ) : (
        <div className="empty-state">
          <span className="empty-icon">
            <History size={32} />
          </span>
          <h3>Jede Suche hinterlässt eine Spur.</h3>
          <p>
            Nach Ihrem ersten Suchlauf sehen Sie hier Ergebnisse
            <br />
            und den Status der Datenquellen.
          </p>
        </div>
      )}
    </section>
  );
}
