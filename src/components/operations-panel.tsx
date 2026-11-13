"use client";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { OperationsStatus } from "@/lib/operations";
import { Badge, dateTime, Notice, request, Spinner } from "./ui";

export function OperationsPanel() {
  const [data, setData] = useState<OperationsStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      setData(await request<OperationsStatus>("/api/admin/operations"));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Status nicht verfügbar.");
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    let active = true;
    request<OperationsStatus>("/api/admin/operations")
      .then((next) => {
        if (active) setData(next);
      })
      .catch((e: unknown) => {
        if (active)
          setError(e instanceof Error ? e.message : "Status nicht verfügbar.");
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <div className="settings-stack">
      <div className="section-toolbar">
        <span className="helper">Nur für die Plattformverwaltung</span>
        <button
          className="button secondary small"
          onClick={() => void refresh()}
          disabled={busy}
        >
          {busy ? <Spinner /> : <RefreshCw size={15} />}Status aktualisieren
        </button>
      </div>
      {error && <Notice message={error} error />}
      {data && (
        <>
          <section className="panel operations-card">
            <div>
              <h2>Automatische Suche</h2>
              <Badge tone={data.worker.healthy ? "green" : "amber"}>
                {data.worker.healthy
                  ? "Suchdienst erreichbar"
                  : "Suchdienst prüfen"}
              </Badge>
            </div>
            <p>Letztes Lebenszeichen: {dateTime(data.worker.heartbeat)}</p>
            <p>
              {data.worker.activeSearches} aktive Suchaufträge · Datenbank:{" "}
              {data.database}
            </p>
            {!data.worker.healthy && (
              <p className="helper">
                Der Suchdienst hat sich seit mehr als drei Minuten nicht
                gemeldet oder wurde noch nicht gestartet. Automatische Suchen
                können verzögert sein.
              </p>
            )}
          </section>
          <section className="panel operations-card">
            <div>
              <h2>Datensicherung</h2>
              <Badge tone={data.backup.healthy ? "green" : "amber"}>
                {data.backup.healthy
                  ? "Lokal gesichert"
                  : data.backup.local
                    ? "Sicherung prüfen"
                    : "Extern zu konfigurieren"}
              </Badge>
            </div>
            <p>
              Letzte erfolgreiche Sicherung: {dateTime(data.backup.lastSuccess)}
            </p>
            <p>
              Wiederherstellung geprüft:{" "}
              {dateTime(data.backup.restoreVerifiedAt)}
            </p>
            {data.backup.lastError && (
              <p>
                Letzter fehlgeschlagener Versuch:{" "}
                {dateTime(data.backup.lastError)}
              </p>
            )}
            <p className="helper">
              {data.backup.local
                ? "Der Suchdienst erstellt täglich eine konsistente Kopie und prüft die Wiederherstellung in eine separate Datei. Die letzten 14 automatischen Kopien bleiben erhalten. Kopien auf demselben Gerät schützen nicht vor dessen Verlust."
                : "PostgreSQL-Sicherungen und Wiederherstellung müssen im gewählten Betrieb eingerichtet und separat überwacht werden."}
            </p>
          </section>
          <section className="panel operations-card">
            <h2>Suchläufe der letzten 24 Stunden</h2>
            <div className="operations-run-counts">
              {data.runs.length ? (
                data.runs.map((run) => (
                  <span key={run.status}>
                    <strong>{run.count}</strong>{" "}
                    {(
                      {
                        completed: "abgeschlossen",
                        partial: "teilweise",
                        failed: "fehlgeschlagen",
                        interrupted: "unterbrochen",
                        running: "laufend",
                        success: "erfolgreich",
                      } as Record<string, string>
                    )[run.status] || run.status}
                  </span>
                ))
              ) : (
                <p>Noch keine Suchläufe.</p>
              )}
            </div>
            <p className="helper">
              Teilweise kann auch einen nicht verbundenen Anbieter bedeuten.
              Einzelne Quellen und deren Datenstand stehen unter Aktivitäten im
              jeweiligen Betrieb. Diese lokale Ansicht ist kein externer
              Ausfallalarm.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
