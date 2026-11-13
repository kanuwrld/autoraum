"use client";

import { Input } from "./ui/input";
import { useState, type FormEvent } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  Check,
  CirclePause,
  Clock3,
  KeyRound,
  Plus,
  Settings2,
  ShieldCheck,
  Activity,
  Users,
} from "lucide-react";
import type { AdminTenant } from "@/lib/admin";
import type { User } from "@/lib/types";
import {
  Badge,
  CopyBox,
  dateTime,
  Modal,
  Notice,
  request,
  Spinner,
} from "./ui";
import { Shell } from "./shell";
import { PasswordForm } from "./settings";
import { OperationsPanel } from "./operations-panel";

type AdminData = {
  tenants: AdminTenant[];
  logs: { id: string; action: string; created_at: number; name: string }[];
};
export function AdminApp({
  initial,
  user,
}: {
  initial: AdminData;
  user: User;
}) {
  const [data, setData] = useState(initial);
  const [view, setView] = useState("tenants");
  const [modal, setModal] = useState(false);
  const [invitation, setInvitation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const refresh = async () =>
    setData(await request<AdminData>("/api/admin/tenants"));
  async function action(id: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(id);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Aktion fehlgeschlagen.");
    } finally {
      setBusy("");
    }
  }
  function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    void action("create", async () => {
      const result = await request<{ invitationUrl: string }>(
        "/api/admin/tenants",
        "POST",
        {
          name,
          slug,
          ownerName: form.get("ownerName"),
          email: form.get("email"),
        },
      );
      setModal(false);
      setInvitation(result.invitationUrl);
      setName("");
      setSlug("");
      setSlugEdited(false);
    });
  }
  return (
    <Shell
      name="Autoraum Verwaltung"
      subtitle="PLATTFORM"
      user={user}
      active={view}
      setActive={setView}
      nav={[
        {
          id: "tenants",
          label: "Betriebe",
          icon: Building2,
          count: data.tenants.length,
        },
        { id: "activity", label: "Aktivitäten", icon: Clock3 },
        { id: "operations", label: "Betrieb & Sicherung", icon: Activity },
        {
          id: "account",
          label: "Mein Zugang",
          icon: Settings2,
          group: "VERWALTUNG",
        },
      ]}
    >
      <div className="page-heading">
        <div>
          <div className="eyebrow">PLATTFORM-VERWALTUNG</div>
          <h1>
            {view === "tenants"
              ? "Ein Zuhause für Ihre Kunden."
              : view === "operations"
                ? "Betrieb & Sicherung"
                : view === "activity"
                  ? "Alles im Blick."
                  : "Ihr Zugang."}
          </h1>
          <p>
            {view === "tenants"
              ? "Betriebe anlegen, Zugänge verwalten und gemeinsam wachsen."
              : view === "operations"
                ? "Suchdienst, Datensicherung und aktuelle Suchläufe."
                : view === "activity"
                  ? "Die letzten Änderungen an Ihrer Plattform."
                  : "Verwalten Sie Ihr persönliches Passwort."}
          </p>
        </div>
        {view === "tenants" && (
          <button className="button primary" onClick={() => setModal(true)}>
            <Plus size={17} />
            Betrieb anlegen
          </button>
        )}
      </div>
      {error && !modal && (
        <Notice message={error} error onClose={() => setError("")} />
      )}
      {view === "tenants" && (
        <>
          <div className="stats-grid">
            <div className="stat">
              <span>
                Betriebe gesamt
                <Building2 size={17} />
              </span>
              <strong>{data.tenants.length}</strong>
              <small>Eigene Arbeitsbereiche</small>
            </div>
            <div className="stat">
              <span>
                Aktive Zugänge
                <ShieldCheck size={17} />
              </span>
              <strong>{data.tenants.filter((t) => t.active).length}</strong>
              <small>Für Kunden freigeschaltet</small>
            </div>
            <div className="stat">
              <span>
                Teammitglieder
                <Users size={17} />
              </span>
              <strong>
                {data.tenants.reduce((s, t) => s + Number(t.user_count), 0)}
              </strong>
              <small>In allen Betrieben</small>
            </div>
            <div className="stat">
              <span>
                Aktive Suchaufträge
                <ArrowDownRight size={17} />
              </span>
              <strong>
                {data.tenants.reduce((s, t) => s + Number(t.search_count), 0)}
              </strong>
              <small>Mit automatischer Suche</small>
            </div>
          </div>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>
                  Ihre Betriebe{" "}
                  <span className="count-pill">{data.tenants.length}</span>
                </h2>
                <p>Ein System. Ein eigener Zugang für jeden Kunden.</p>
              </div>
            </div>
            {!data.tenants.length ? (
              <div className="empty-state">
                <span className="empty-icon">
                  <Building2 size={32} />
                </span>
                <h3>Der erste Betrieb beginnt hier.</h3>
                <p>
                  Firmenname, Kontaktperson und E-Mail eingeben.
                  <br />
                  Der geschützte Arbeitsbereich ist sofort bereit.
                </p>
                <button
                  className="button primary"
                  onClick={() => setModal(true)}
                >
                  <Plus size={16} />
                  Ersten Betrieb anlegen
                </button>
              </div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Betrieb</th>
                      <th>Status</th>
                      <th>Kontakt</th>
                      <th>Daten / Suchen</th>
                      <th>Zugang</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.tenants.map((t) => (
                      <tr key={t.id}>
                        <td>
                          <a className="table-name" href={`/w/${t.slug}`}>
                            {t.name}
                            <ArrowUpRight size={14} />
                          </a>
                          <small className="muted">/w/{t.slug}</small>
                        </td>
                        <td>
                          <Badge tone={t.active ? "green" : "neutral"}>
                            {t.active ? "Aktiv" : "Pausiert"}
                          </Badge>
                        </td>
                        <td>
                          <span className="table-email">{t.owner_email}</span>
                          <small className="muted">
                            {t.user_count} Mitglied
                            {Number(t.user_count) === 1 ? "" : "er"}
                          </small>
                        </td>
                        <td>
                          {t.listing_count} Anzeigen
                          <small className="muted">
                            {t.search_count} automatisch
                          </small>
                        </td>
                        <td>
                          <div className="row-actions">
                            <button
                              className="icon-button bordered"
                              disabled={!!busy || !t.active}
                              title="Neuen Aktivierungslink erstellen"
                              aria-label={`Aktivierungslink für ${t.name}`}
                              onClick={() =>
                                void action(t.id, async () => {
                                  const result = await request<{
                                    invitationUrl: string;
                                  }>(
                                    `/api/admin/tenants/${t.id}/invite`,
                                    "POST",
                                    {},
                                  );
                                  setInvitation(result.invitationUrl);
                                })
                              }
                            >
                              <KeyRound size={16} />
                            </button>
                            <button
                              className="icon-button bordered"
                              disabled={!!busy}
                              title={
                                t.active
                                  ? "Zugang pausieren"
                                  : "Zugang aktivieren"
                              }
                              aria-label={`${t.name}: Zugang ${t.active ? "pausieren" : "aktivieren"}`}
                              onClick={() =>
                                void action(t.id, async () => {
                                  await request(
                                    `/api/admin/tenants/${t.id}`,
                                    "PATCH",
                                    { active: !t.active },
                                  );
                                })
                              }
                            >
                              {t.active ? (
                                <CirclePause size={16} />
                              ) : (
                                <Check size={16} />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <div className="info-banner">
            <ShieldCheck size={22} />
            <div>
              <strong>Ein Link. Ein eigener Arbeitsbereich.</strong>
              <p>
                Jeder Betrieb hat getrennte Fahrzeuge, Suchaufträge und
                Teamzugänge. Neue Kunden benötigen keinen separaten Server.
              </p>
            </div>
          </div>
        </>
      )}
      {view === "activity" && (
        <section className="panel">
          <div className="panel-heading">
            <h2>Protokoll</h2>
          </div>
          {data.logs.length ? (
            data.logs.map((log) => (
              <div className="activity-row" key={log.id}>
                <span className="activity-icon">
                  <Clock3 size={16} />
                </span>
                <div>
                  <strong>{log.action}</strong>
                  <p>{log.name || "Plattform"}</p>
                </div>
                <time>{dateTime(log.created_at)}</time>
              </div>
            ))
          ) : (
            <div className="empty-state">
              <p>Noch keine Änderungen protokolliert.</p>
            </div>
          )}
        </section>
      )}
      {view === "account" && <PasswordForm />}
      {view === "operations" && <OperationsPanel />}
      {modal && (
        <Modal
          title="Neuen Betrieb anlegen"
          onClose={() => {
            if (!busy) {
              setModal(false);
              setError("");
            }
          }}
        >
          <p className="modal-intro">
            Der Firmenname erscheint im Kundenbereich. Die Kontaktperson erhält
            einen eigenen Zugang über einen Aktivierungslink.
          </p>
          <form className="form-stack" onSubmit={create}>
            <label>
              Firmenname
              <Input
                autoComplete="organization"
                value={name}
                placeholder="z. B. Autohaus Weber"
                required
                minLength={2}
                maxLength={100}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slugEdited)
                    setSlug(
                      e.target.value
                        .toLowerCase()
                        .normalize("NFKD")
                        .replace(/[\u0300-\u036f]/g, "")
                        .replace(/ß/g, "ss")
                        .replace(/[^a-z0-9]+/g, "-")
                        .replace(/^-|-$/g, ""),
                    );
                }}
              />
            </label>
            <label>
              Adresse des Arbeitsbereichs
              <div className="input-prefix">
                <span>/w/</span>
                <Input
                  value={slug}
                  required
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  minLength={3}
                  maxLength={60}
                  onChange={(e) => {
                    setSlugEdited(true);
                    setSlug(e.target.value);
                  }}
                />
              </div>
            </label>
            <div className="form-grid two">
              <label>
                Kontaktperson
                <Input
                  name="ownerName"
                  placeholder="Vor- und Nachname"
                  required
                  minLength={2}
                />
              </label>
              <label>
                E-Mail-Adresse
                <Input
                  name="email"
                  type="email"
                  placeholder="name@example.com"
                  required
                />
              </label>
            </div>
            {error && <Notice error message={error} />}
            <div className="modal-actions">
              <button
                type="button"
                className="button secondary"
                disabled={!!busy}
                onClick={() => setModal(false)}
              >
                Abbrechen
              </button>
              <button className="button primary" disabled={!!busy}>
                {busy ? <Spinner /> : <Plus size={16} />}Betrieb erstellen
              </button>
            </div>
          </form>
        </Modal>
      )}
      {invitation && (
        <Modal
          title="Der Zugang ist vorbereitet."
          onClose={() => setInvitation("")}
        >
          <div className="success-symbol">
            <Check size={26} />
          </div>
          <p className="modal-intro">
            Diesen persönlichen Link an die Kontaktperson weitergeben. Er ist 72
            Stunden gültig und kann einmal verwendet werden. Es wurde keine
            E-Mail versendet.
          </p>
          <CopyBox value={invitation} />
          <p className="helper">
            Über den Link legt der Kunde sein Passwort selbst fest. Bei
            bestehenden Konten wird das Passwort erneuert.
          </p>
          <div className="modal-actions">
            <button
              className="button primary"
              onClick={() => setInvitation("")}
            >
              Fertig
            </button>
          </div>
        </Modal>
      )}
    </Shell>
  );
}
