"use client";

import { useEffect, useState } from "react";
import { CheckCheck, Inbox, Mail, MailOpen, RefreshCw } from "lucide-react";
import {
  sourceName,
  type InboxPage,
  type Listing,
  type Workspace,
} from "@/lib/types";
import { dateTime, Notice, request, Spinner } from "./ui";
import { NativeSelect } from "./ui/native-select";
import { ListingCard } from "./listing-card";
import { DesktopNotificationSettings } from "./workspace-notifications";

export function VehicleInbox({
  data,
  base,
  busy,
  onBookmark,
  onEdit,
  onTask,
  onRefresh,
  onSearches,
}: {
  data: Workspace;
  base: string;
  busy: boolean;
  onBookmark: (listing: Listing) => void;
  onEdit: (listing: Listing) => void;
  onTask: (listing: Listing) => void;
  onRefresh: () => Promise<void>;
  onSearches: () => void;
}) {
  const [status, setStatus] = useState("all");
  const [profile, setProfile] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<InboxPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const q = new URLSearchParams({ status, page: String(page) });
        if (profile) q.set("searchId", profile);
        const response = await request<InboxPage>(`${base}/inbox?${q}`);
        if (active) {
          if (page > 1 && !response.items.length)
            setPage(Math.max(1, Math.ceil(response.total / 24)));
          setResult(response);
        }
      } catch (e) {
        if (active)
          setError(
            e instanceof Error
              ? e.message
              : "Eingang konnte nicht geladen werden.",
          );
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [base, status, page, profile, data.asOf, reload]);
  async function mark(id?: string, read = true) {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await request(
        `${base}/inbox/${id || "read-all"}`,
        id ? "PATCH" : "POST",
        id ? { read } : { before: result?.asOf || 0 },
      );
      await onRefresh();
      setReload((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Änderung fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }
  const disabled = busy || saving || loading;
  return (
    <section aria-label="Fahrzeugeingang" aria-busy={loading}>
      <DesktopNotificationSettings
        tenantId={data.tenant.id}
        userId={data.user.id}
      />
      <div className="workflow-toolbar inbox-toolbar">
        <div className="workflow-filters">
          <NativeSelect
            aria-label="Eingang filtern"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">Alle Eingänge</option>
            <option value="unread">Ungelesen</option>
            <option value="read">Gelesen</option>
          </NativeSelect>
          <NativeSelect
            aria-label="Suchprofil im Eingang"
            value={profile}
            onChange={(e) => {
              setProfile(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Alle Suchprofile</option>
            {data.searches.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="button-row">
          <button
            className="button secondary"
            aria-label="Eingang aktualisieren"
            disabled={disabled}
            onClick={() => setReload((v) => v + 1)}
          >
            <RefreshCw size={16} />
          </button>
          <button
            className="button secondary"
            disabled={disabled || !data.inbox.unread || !result}
            onClick={() => void mark()}
          >
            <CheckCheck size={16} />
            Alle Eingänge als gelesen
          </button>
        </div>
      </div>
      <p className="workflow-hint">
        Neue Treffer Ihrer gespeicherten Suchen. Jede Anzeige erscheint einmal;
        gelesen gilt nur für Sie. „Eingang“ ist der Zeitpunkt der Zuordnung,
        nicht der Veröffentlichung.
      </p>
      {error && <Notice message={error} error />}
      {!result && loading && (
        <div className="workflow-empty">
          <Spinner />
          Eingang wird geladen …
        </div>
      )}
      {result && !!result.items.length && (
        <div className="listings-grid inbox-grid">
          {result.items.map((item) => (
            <div
              className={`inbox-entry ${item.read_at ? "read" : "unread"}`}
              key={item.id}
              data-inbox-id={item.id}
            >
              <div className="inbox-context">
                <span className="inbox-state">
                  {item.read_at ? <MailOpen size={15} /> : <Mail size={15} />}
                  {item.read_at ? "Gelesen" : "Ungelesen"}
                </span>
                <span>Eingang {dateTime(item.received_at)}</span>
                <strong title={item.searchNames.join(" · ")}>
                  {item.searchNames.join(" · ")}
                </strong>
              </div>
              <ListingCard
                listing={item}
                sourceLabel={sourceName(item.source, data.externalSources)}
                asOf={data.asOf}
                busy={disabled}
                onSave={() => onBookmark(item)}
                onEdit={() => onEdit(item)}
                onTask={() => onTask(item)}
              />
              <button
                className="inbox-read-button"
                disabled={disabled}
                onClick={() => void mark(item.id, !item.read_at)}
              >
                {item.read_at
                  ? "Als ungelesen markieren"
                  : "Als gelesen markieren"}
              </button>
            </div>
          ))}
        </div>
      )}
      {result && !result.total && !loading && (
        <div className="workflow-empty panel">
          <Inbox size={32} />
          <h3>
            {status === "unread"
              ? "Alles gelesen."
              : "Noch keine passenden Eingänge."}
          </h3>
          <p>
            Speichern Sie ein Suchprofil und starten Sie es manuell oder
            automatisch. Neue passende Fahrzeuge erscheinen hier.
          </p>
          <button className="button secondary" onClick={onSearches}>
            Zu den Suchaufträgen
          </button>
        </div>
      )}
      {result && !!result.total && (
        <div className="pagination">
          <span>
            {result.total} {result.total === 1 ? "Eingang" : "Eingänge"} · Seite{" "}
            {page}
          </span>
          <div className="button-row">
            <button
              className="button secondary small"
              disabled={page === 1 || disabled}
              onClick={() => setPage(page - 1)}
            >
              Zurück
            </button>
            <button
              className="button secondary small"
              disabled={page * 24 >= result.total || disabled}
              onClick={() => setPage(page + 1)}
            >
              Weiter
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
