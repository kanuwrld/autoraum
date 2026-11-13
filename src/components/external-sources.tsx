"use client";

import { useState, type FormEvent } from "react";
import { KeyRound, Pause, Plus } from "lucide-react";
import type { ExternalSource, ExternalSourceId } from "@/lib/types";
import { Input } from "./ui/input";
import {
  Badge,
  CopyBox,
  dateTime,
  ExternalLink,
  Modal,
  Notice,
  request,
  Spinner,
} from "./ui";

type IssuedKey = { id: ExternalSourceId; name: string; token: string };

export function ExternalSources({
  sources,
  slug,
  onRefresh,
}: {
  sources: ExternalSource[];
  slug: string;
  onRefresh: () => Promise<void>;
}) {
  const base = `/api/w/${slug}/external-sources`;
  const [adding, setAdding] = useState(false);
  const [issued, setIssued] = useState<IssuedKey | null>(null);
  const [confirm, setConfirm] = useState<{
    source: ExternalSource;
    revoke: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function perform(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
      await onRefresh();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Der Anbieter konnte nicht gespeichert werden.",
      );
    } finally {
      setBusy(false);
    }
  }
  function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    void perform(async () => {
      const result = await request<IssuedKey>(base, "POST", {
        name: form.get("name"),
        website: form.get("website"),
      });
      setIssued(result);
      setAdding(false);
    });
  }
  function changeKey() {
    if (!confirm) return;
    const { source, revoke } = confirm;
    void perform(async () => {
      const result = await request<
        Omit<IssuedKey, "token"> & { token: string | null }
      >(
        `${base}/${encodeURIComponent(source.id)}/key`,
        revoke ? "DELETE" : "POST",
        {},
      );
      setIssued(result.token ? { ...result, token: result.token } : null);
      setConfirm(null);
    });
  }
  function close() {
    if (busy) return;
    setAdding(false);
    setConfirm(null);
    setIssued(null);
    setError("");
  }

  return (
    <section
      className="panel source-panel"
      aria-labelledby="external-sources-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="external-sources-title">Zusätzliche Anbieter</h2>
          <p className="helper">
            Eigene Zugänge für Börsen, Händler und Flotten.
          </p>
        </div>
        <button
          className="button secondary small"
          disabled={busy}
          onClick={() => {
            setError("");
            setAdding(true);
          }}
        >
          <Plus size={15} />
          Anbieter hinzufügen
        </button>
      </div>
      <p>
        Jeder Anbieter erhält einen eigenen Feed-Schlüssel. Er kann damit
        ausschließlich seine Anzeigen in diesem Betrieb liefern. Voraussetzung
        sind freigegebene Daten im Autoraum-Format.
      </p>
      {error && !adding && !confirm && !issued && (
        <Notice message={error} error />
      )}
      {sources.length ? (
        <div className="divide-y border-t mt-5">
          {sources.map((source) => (
            <div
              key={source.id}
              className="py-5 space-y-3"
              data-source-id={source.id}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 max-w-full break-words">
                  <strong>{source.name}</strong>
                  <div className="text-xs mt-1 break-all">
                    <ExternalLink href={source.website}>
                      {new URL(source.website).hostname}
                    </ExternalLink>
                  </div>
                </div>
                <Badge>
                  {!source.enabled
                    ? "Eingang pausiert"
                    : source.lastFeedAt
                      ? "Daten empfangen"
                      : "Wartet auf Daten"}
                </Badge>
              </div>
              <p className="helper">
                {source.listingCount} aktive Anzeigen · Letzter Empfang:{" "}
                {dateTime(source.lastFeedAt)}
              </p>
              <details className="text-xs">
                <summary className="cursor-pointer">Anschlussdetails</summary>
                <div className="mt-2 space-y-2 break-all">
                  <p>POST /api/ingest · Authorization: Bearer …</p>
                  <p>
                    Quellen-ID für CSV: <code>{source.id}</code>
                  </p>
                </div>
              </details>
              <div className="button-row flex-wrap">
                <button
                  className="button secondary small"
                  disabled={busy}
                  onClick={() => {
                    setError("");
                    setConfirm({ source, revoke: false });
                  }}
                >
                  <KeyRound size={14} />
                  {source.enabled
                    ? "Schlüssel erneuern"
                    : "Neuen Schlüssel erstellen"}
                </button>
                {source.enabled && (
                  <button
                    className="button secondary small"
                    disabled={busy}
                    onClick={() => {
                      setError("");
                      setConfirm({ source, revoke: true });
                    }}
                  >
                    <Pause size={14} />
                    Eingang pausieren
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="helper">Noch keine zusätzlichen Anbieter eingerichtet.</p>
      )}

      {adding && (
        <Modal title="Anbieter hinzufügen" onClose={close}>
          <form className="form-stack padded" onSubmit={create}>
            <p className="helper">
              Dieser Schritt richtet den Dateneingang ein. Der Anbieter muss den
              Feed anschließend beliefern; eine Website-Adresse allein startet
              keine Suche.
            </p>
            <label>
              Anbietername
              <Input
                name="name"
                required
                minLength={2}
                maxLength={80}
                placeholder="z. B. Ihr Fahrzeuglieferant"
              />
            </label>
            <label>
              Website des Anbieters
              <Input
                name="website"
                type="url"
                required
                maxLength={2000}
                placeholder="https://…"
              />
            </label>
            {error && <Notice message={error} error />}
            <div className="modal-actions">
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={close}
              >
                Abbrechen
              </button>
              <button className="button primary" disabled={busy}>
                {busy ? <Spinner /> : <Plus size={15} />}Anbieter erstellen
              </button>
            </div>
          </form>
        </Modal>
      )}
      {confirm && (
        <Modal
          title={
            confirm.revoke
              ? "Dateneingang pausieren?"
              : "Neuen Schlüssel erstellen?"
          }
          onClose={close}
        >
          <div className="form-stack padded">
            <p>
              Der bisherige Schlüssel für <strong>{confirm.source.name}</strong>{" "}
              wird sofort ungültig. Gespeicherte Anzeigen bleiben erhalten.
            </p>
            {!confirm.revoke && (
              <p className="helper">
                Den neuen Schlüssel anschließend beim Anbieter hinterlegen.
              </p>
            )}
            {error && <Notice message={error} error />}
            <div className="modal-actions">
              <button
                className="button secondary"
                disabled={busy}
                onClick={close}
              >
                Abbrechen
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={changeKey}
              >
                {busy && <Spinner />}
                {confirm.revoke ? "Jetzt pausieren" : "Schlüssel erstellen"}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {issued && (
        <Modal title="Feed-Schlüssel sichern" onClose={close}>
          <div className="form-stack padded">
            <p>
              <strong>{issued.name}</strong> kann Daten an{" "}
              <code>POST /api/ingest</code> senden. Diesen Schlüssel als{" "}
              <code>Authorization: Bearer …</code> übergeben.
            </p>
            <CopyBox value={issued.token} secret />
            <p className="helper">
              Der Schlüssel wird nur jetzt angezeigt. Er erlaubt Datenänderungen
              ausschließlich für diesen Anbieter und Betrieb.
            </p>
            <p className="helper break-all">
              Quellen-ID für CSV: <code>{issued.id}</code>
            </p>
            {error && <Notice message={error} error />}
            <div className="modal-actions">
              <button
                className="button primary"
                disabled={busy}
                onClick={close}
              >
                Fertig
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
