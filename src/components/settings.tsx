"use client";

import { NativeSelect } from "./ui/native-select";
import { Input } from "./ui/input";
import { useEffect, useState, type FormEvent } from "react";
import {
  Check,
  Download,
  FileUp,
  KeyRound,
  Link2,
  LockKeyhole,
  Plug,
  Plus,
  ShieldCheck,
  Users,
} from "lucide-react";
import { publicSourceIds, sourceNames, type Workspace } from "@/lib/types";
import { ExternalSources } from "./external-sources";
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

export function PasswordForm() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    const form = e.currentTarget;
    const values = new FormData(form);
    try {
      if (values.get("password") !== values.get("confirm"))
        throw new Error("Die Passwörter stimmen nicht überein.");
      await request("/api/auth/password", "POST", {
        currentPassword: values.get("currentPassword"),
        password: values.get("password"),
      });
      setError(false);
      setMessage("Passwort geändert. Andere Sitzungen wurden abgemeldet.");
      form.reset();
    } catch (e) {
      setError(true);
      setMessage(e instanceof Error ? e.message : "Änderung fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel settings-panel">
      <div className="panel-heading">
        <div>
          <h2>
            <LockKeyhole size={18} />
            Passwort ändern
          </h2>
          <p>
            Mindestens 12 Zeichen. Verwenden Sie ein eigenes Passwort für
            Autoraum.
          </p>
        </div>
      </div>
      <form className="form-stack padded" onSubmit={submit}>
        <label>
          Aktuelles Passwort
          <Input
            type="password"
            name="currentPassword"
            autoComplete="current-password"
            required
            maxLength={128}
          />
        </label>
        <div className="form-grid two">
          <label>
            Neues Passwort
            <Input
              type="password"
              name="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
            />
          </label>
          <label>
            Neues Passwort wiederholen
            <Input
              type="password"
              name="confirm"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
            />
          </label>
        </div>
        {message && <Notice message={message} error={error} />}
        <div>
          <button className="button primary" disabled={busy}>
            {busy ? <Spinner /> : <KeyRound size={16} />}Passwort speichern
          </button>
        </div>
      </form>
    </section>
  );
}

export function SourcesSettings({
  data,
  onRefresh,
  onImport,
}: {
  data: Workspace;
  onRefresh: () => Promise<void>;
  onImport: () => void;
}) {
  const base = `/api/w/${data.tenant.slug}`;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [key, setKey] = useState("");
  const [confirmRotate, setConfirmRotate] = useState(false);
  const canManage = data.user.role === "platform_admin";
  async function action(name: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(name);
    setMessage("");
    try {
      await fn();
      await onRefresh();
      setError(false);
    } catch (e) {
      setError(true);
      setMessage(e instanceof Error ? e.message : "Verbindung fehlgeschlagen.");
    } finally {
      setBusy("");
    }
  }
  function mobileSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const values = new FormData(form);
    void action("mobile", async () => {
      await request(`${base}/providers`, "PUT", {
        username: values.get("username"),
        password: values.get("password"),
      });
      setMessage(
        "Zugang sicher gespeichert. Starten Sie eine Suche, um den Abruf zu prüfen.",
      );
      form.reset();
      setMobileOpen(false);
    });
  }
  function generateKey() {
    void action("feed", async () => {
      const result = await request<{ token: string }>(
        `${base}/feed-key`,
        "POST",
        {},
      );
      setKey(result.token);
      setConfirmRotate(false);
    });
  }
  return (
    <div className="settings-stack">
      {message && (
        <Notice
          message={message}
          error={error}
          onClose={() => setMessage("")}
        />
      )}
      <div className="info-banner">
        <ShieldCheck size={22} />
        <div>
          <strong>Datenversorgung durch Autoraum</strong>
          <p>
            Nur die Plattformverwaltung richtet Verbindungen ein. Kunden
            benötigen keine eigenen Zugangsdaten zu den Fahrzeugbörsen.
          </p>
        </div>
      </div>
      <section className="panel source-panel">
        <div className="source-panel-top">
          <div className="source-identity">
            <span className="source-logo mobile-logo">m</span>
            <div>
              <h2>mobile.de</h2>
              <p>Offizielle Search API</p>
            </div>
          </div>
          <Badge tone={data.providers.mobile ? "green" : "neutral"}>
            {data.providers.mobile ? "Zugang hinterlegt" : "Nicht verbunden"}
          </Badge>
        </div>
        <p>
          {data.providers.mobileProject
            ? "Projektzugang ist serverseitig konfiguriert. Der Anzeigenumfang und die Nutzung für mehrere Betriebe richten sich nach dem Vertrag."
            : "Projektzugang über die Server-Konfiguration oder einen separaten Zugang für diesen Betrieb hinterlegen. Der verfügbare Anzeigenumfang richtet sich nach dem Vertrag."}
        </p>
        <div className="source-actions">
          <ExternalLink href="https://services.mobile.de/docs/search-api.html">
            API-Dokumentation
          </ExternalLink>
          {canManage && (
            <button
              className="button secondary small"
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              <Plug size={15} />
              {data.providers.mobileProject
                ? "Separaten Betriebszugang hinterlegen"
                : data.providers.mobile
                  ? "Zugang bearbeiten"
                  : "Zugang verbinden"}
            </button>
          )}
        </div>
        {mobileOpen && canManage && (
          <form className="form-stack source-form" onSubmit={mobileSubmit}>
            <div className="form-grid two">
              <label>
                API-Benutzername
                <Input
                  name="username"
                  autoComplete="off"
                  required
                  maxLength={200}
                />
              </label>
              <label>
                API-Passwort
                <Input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  maxLength={500}
                />
              </label>
            </div>
            <div className="button-row">
              <button className="button primary small" disabled={!!busy}>
                {busy === "mobile" ? <Spinner /> : <LockKeyhole size={15} />}
                Zugang speichern
              </button>
              {data.providers.mobile && !data.providers.mobileProject && (
                <button
                  type="button"
                  className="button secondary small"
                  disabled={!!busy}
                  onClick={() =>
                    void action("disconnect", async () => {
                      await request(`${base}/providers`, "DELETE", {});
                      setMobileOpen(false);
                      setMessage(
                        "Zugang entfernt. Gespeicherte Anzeigen bleiben erhalten.",
                      );
                    })
                  }
                >
                  Verbindung entfernen
                </button>
              )}
            </div>
            <p className="helper">
              Zugangsdaten werden verschlüsselt gespeichert und nie an den
              Browser zurückgegeben.
            </p>
          </form>
        )}
      </section>
      <div className="source-pair">
        {publicSourceIds.map((source) => (
          <section className="panel source-panel" key={source}>
            <div className="source-identity">
              <div>
                <h2>{sourceNames[source]}</h2>
                <p>
                  {source === "pkw"
                    ? "Öffentliche Fahrzeugsuche (JSON)"
                    : "Öffentliche Suchseiten"}
                </p>
              </div>
            </div>
            <p>
              {data.providers.publicSearch
                ? "Anzeigen werden ohne Anmeldung abgerufen und lokal nach den Suchkriterien gefiltert. Nicht genannte Fahrzeugdaten bleiben unbestätigt."
                : "Die öffentliche Suche ist in dieser Installation deaktiviert."}
            </p>
            <Badge>
              {data.providers.publicSearch ? "Suche aktiviert" : "Deaktiviert"}
            </Badge>
          </section>
        ))}
      </div>
      <p className="helper">
        Öffentliche Suche: eine Ergebnisseite bei Autohero, markt.de und
        auto.de; bis zu zwei bei den übrigen Quellen. Fünf Minuten
        Zwischenspeicher. Die Verfügbarkeit hängt von der Plattform ab. Ein
        Abruf ist keine Lizenz zur kommerziellen Weiterverwertung; dafür einen
        freigegebenen Datenzugang vereinbaren.
      </p>
      {canManage && (
        <ExternalSources
          sources={data.externalSources}
          slug={data.tenant.slug}
          onRefresh={onRefresh}
        />
      )}
      <section className="panel source-panel" id="partner-feed">
        <div className="source-panel-top">
          <div className="source-identity">
            <span className="source-logo feed-logo">
              <Link2 size={21} />
            </span>
            <div>
              <h2>Partner-Feed</h2>
              <p>Ein Eingang für weitere Datenanbieter</p>
            </div>
          </div>
          <Badge tone={data.providers.lastFeed ? "green" : "neutral"}>
            {data.providers.lastFeed
              ? "Daten empfangen"
              : data.providers.feed
                ? "Schlüssel bereit"
                : "Nicht eingerichtet"}
          </Badge>
        </div>
        <p>
          Ein autorisierter Anbieter kann normalisierte Fahrzeugdaten an Ihren
          Betrieb liefern. Duplikate derselben Quelle werden aktualisiert.
        </p>
        <div className="feed-endpoint">
          <span>POST</span>
          <code>/api/ingest</code>
        </div>
        <div className="source-actions">
          <span className="helper">
            Letzter Empfang: {dateTime(data.providers.lastFeed)}
          </span>
          {canManage && (
            <div className="button-row">
              {data.providers.feed && (
                <button
                  className="button secondary small"
                  disabled={!!busy}
                  onClick={() =>
                    void action("revoke", async () => {
                      await request(`${base}/feed-key`, "DELETE", {});
                      setKey("");
                      setMessage("Feed-Schlüssel widerrufen.");
                    })
                  }
                >
                  Widerrufen
                </button>
              )}
              <button
                className="button secondary small"
                disabled={!!busy}
                onClick={() =>
                  data.providers.feed ? setConfirmRotate(true) : generateKey()
                }
              >
                {busy === "feed" ? <Spinner /> : <KeyRound size={15} />}
                {data.providers.feed
                  ? "Schlüssel erneuern"
                  : "Schlüssel erstellen"}
              </button>
            </div>
          )}
        </div>
        {key && (
          <div className="secret-block">
            <strong>Schlüssel jetzt sicher speichern</strong>
            <p>
              Er wird nur einmal angezeigt. Übergabe als{" "}
              <code>Authorization: Bearer …</code>.
            </p>
            <CopyBox value={key} secret />
          </div>
        )}
      </section>
      <section className="panel source-panel">
        <div className="source-panel-top">
          <div className="source-identity">
            <span className="source-logo csv-logo">
              <FileUp size={21} />
            </span>
            <div>
              <h2>CSV-Import</h2>
              <p>Eigene oder autorisierte Fahrzeugdaten</p>
            </div>
          </div>
          <button className="button secondary small" onClick={onImport}>
            <FileUp size={15} />
            Datei importieren
          </button>
        </div>
        <p>
          Bis zu 500 Anzeigen pro Datei. Preise, Verfügbarkeit und
          Fahrzeugdetails können mit derselben Anzeigen-ID aktualisiert werden.
        </p>
      </section>
      {confirmRotate && (
        <Modal
          title="Feed-Schlüssel erneuern?"
          onClose={() => setConfirmRotate(false)}
        >
          <p className="modal-intro">
            Der bisherige Schlüssel wird sofort ungültig. Ihr Datenanbieter
            benötigt anschließend den neuen Schlüssel.
          </p>
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => setConfirmRotate(false)}
            >
              Abbrechen
            </button>
            <button
              className="button primary"
              disabled={!!busy}
              onClick={generateKey}
            >
              Schlüssel erneuern
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: string;
  activated: number;
  blocked: number;
};
export function TeamSettings({ data }: { data: Workspace }) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState("");
  const [accessChange, setAccessChange] = useState<TeamMember | null>(null);
  const [recovery, setRecovery] = useState<TeamMember | null>(null);
  const base = `/api/w/${data.tenant.slug}/team`;
  const canManage = data.user.role !== "buyer";
  async function updateAccess(member: TeamMember, recover: boolean) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (recover) {
        const result = await request<{ invitationUrl: string }>(
          `${base}/${member.id}/recover`,
          "POST",
          {},
        );
        setRecovery(null);
        setInvite(result.invitationUrl);
      } else {
        await request(`${base}/${member.id}`, "PATCH", {
          blocked: !member.blocked,
        });
        setAccessChange(null);
      }
      setMembers(await request<TeamMember[]>(base));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Zugang konnte nicht geändert werden.",
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (canManage)
      request<TeamMember[]>(base)
        .then(setMembers)
        .catch((e) => setError(e.message));
  }, [base, canManage]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const values = new FormData(e.currentTarget);
    try {
      const result = await request<{ invitationUrl: string }>(base, "POST", {
        name: values.get("name"),
        email: values.get("email"),
        role: values.get("role"),
      });
      setOpen(false);
      setInvite(result.invitationUrl);
      setMembers(await request<TeamMember[]>(base));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Einladung fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-stack">
      {error && !open && <Notice message={error} error />}
      {canManage && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>
                <Users size={18} />
                Ihr Team
              </h2>
              <p>Zugänge für {data.tenant.name}</p>
            </div>
            <button
              className="button secondary small"
              onClick={() => setOpen(true)}
            >
              <Plus size={15} />
              Mitglied einladen
            </button>
          </div>
          {members.map((m) => (
            <div className="team-row" key={m.id}>
              <span className="avatar">{m.name[0].toUpperCase()}</span>
              <div>
                <strong>{m.name}</strong>
                <small>{m.email}</small>
              </div>
              <span className="team-role">
                {m.role === "owner" ? "Administrator" : "Einkauf"}
              </span>
              <Badge
                tone={m.blocked ? "neutral" : m.activated ? "green" : "amber"}
              >
                {m.blocked ? "Gesperrt" : m.activated ? "Aktiv" : "Eingeladen"}
              </Badge>
              {m.id !== data.user.id && (
                <div className="team-access-actions">
                  <button
                    className="button secondary small"
                    disabled={busy || !!m.blocked}
                    aria-label={`Zugangslink für ${m.name}`}
                    onClick={() => {
                      setError("");
                      setRecovery(m);
                    }}
                  >
                    <KeyRound size={14} />
                    Zugangslink
                  </button>
                  <button
                    className="button secondary small"
                    disabled={busy}
                    aria-label={`${m.name}: ${m.blocked ? "Freigeben" : "Sperren"}`}
                    onClick={() => {
                      setError("");
                      setAccessChange(m);
                    }}
                  >
                    {m.blocked ? "Freigeben" : "Sperren"}
                  </button>
                </div>
              )}
            </div>
          ))}
        </section>
      )}
      <PasswordForm />
      {canManage && (
        <section className="panel workspace-export">
          <div>
            <h2>Ihre Arbeitsdaten</h2>
            <p>
              Suchprofile, Merkliste mit Notizen und Kalkulationen sowie
              Aufgaben als JSON-Datei. Ohne Passwörter und Zugangsschlüssel.
              Dies ist kein vollständiges Datenbank-Backup.
            </p>
          </div>
          <a
            className="button secondary small"
            href={`/api/w/${data.tenant.slug}/export`}
            download={`autoraum-${data.tenant.slug}.json`}
          >
            <Download size={15} />
            Arbeitsdaten exportieren
          </a>
        </section>
      )}
      {accessChange && (
        <Modal
          title={
            accessChange.blocked ? "Zugang freigeben?" : "Teamzugang sperren?"
          }
          onClose={() => {
            if (!busy) setAccessChange(null);
          }}
        >
          <p className="modal-intro">
            {accessChange.name}:{" "}
            {accessChange.blocked
              ? "Die Anmeldung mit dem vorhandenen Passwort wird wieder möglich. Ein neuer Link kann anschließend erstellt werden."
              : "Alle Sitzungen und offenen Zugangslinks werden widerrufen. Vorhandene Aufgaben und Notizen bleiben erhalten. Offene Aufgaben bitte neu zuweisen."}
          </p>
          {error && <Notice message={error} error />}
          <div className="modal-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setAccessChange(null)}
            >
              Abbrechen
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void updateAccess(accessChange, false)}
            >
              {busy ? <Spinner /> : null}
              {accessChange.blocked ? "Zugang freigeben" : "Zugang sperren"}
            </button>
          </div>
        </Modal>
      )}
      {recovery && (
        <Modal
          title="Neuen Zugangslink erstellen?"
          onClose={() => {
            if (!busy) setRecovery(null);
          }}
        >
          <p className="modal-intro">
            {recovery.name} kann über den Link ein neues Passwort wählen.
            Frühere unbenutzte Links werden ungültig. Beim Einlösen werden
            bestehende Sitzungen beendet. Den Link nur der geprüften
            Kontaktperson übergeben.
          </p>
          {error && <Notice message={error} error />}
          <div className="modal-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setRecovery(null)}
            >
              Abbrechen
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void updateAccess(recovery, true)}
            >
              {busy ? <Spinner /> : <KeyRound size={16} />}Zugangslink erstellen
            </button>
          </div>
        </Modal>
      )}
      {open && (
        <Modal
          title="Teammitglied einladen"
          onClose={() => {
            if (!busy) setOpen(false);
          }}
        >
          <form className="form-stack" onSubmit={submit}>
            <label>
              Name
              <Input name="name" required minLength={2} maxLength={100} />
            </label>
            <label>
              E-Mail
              <Input name="email" type="email" required />
            </label>
            <label>
              Rolle
              <NativeSelect name="role" defaultValue="buyer">
                <option value="buyer">
                  Einkauf · Suchen, Anzeigen und Merkliste
                </option>
                <option value="owner">
                  Administrator · zusätzlich Teamzugänge
                </option>
              </NativeSelect>
            </label>
            {error && <Notice message={error} error />}
            <div className="modal-actions">
              <button className="button primary" disabled={busy}>
                {busy ? <Spinner /> : <Plus size={16} />}Einladungslink
                erstellen
              </button>
            </div>
          </form>
        </Modal>
      )}
      {invite && (
        <Modal title="Einladung vorbereitet" onClose={() => setInvite("")}>
          <div className="success-symbol">
            <Check size={26} />
          </div>
          <p className="modal-intro">
            Diesen einmaligen Link persönlich weitergeben. Gültig für 72
            Stunden. Es wurde keine E-Mail versendet.
          </p>
          <CopyBox value={invite} />
        </Modal>
      )}
    </div>
  );
}
