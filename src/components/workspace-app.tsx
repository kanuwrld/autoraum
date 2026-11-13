"use client";

import { NativeSelect } from "./ui/native-select";
import { Input } from "./ui/input";
import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowDownLeft,
  Bookmark,
  CarFront,
  Download,
  FileUp,
  History,
  BookOpen,
  Inbox,
  ListTodo,
  Plug,
  Plus,
  Radar,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import type {
  Filters,
  Listing,
  SavedSearch,
  SourceResult,
  Workspace,
  Task,
} from "@/lib/types";
import { sourceName, sourceNames } from "@/lib/types";
import { Modal, Notice, number, request, Spinner } from "./ui";
import { Shell } from "./shell";
import { SearchPanel } from "./search-panel";
import { SearchJobs, SearchActivity } from "./search-history";
import { ListingEditor } from "./listing-editor";
import { TaskBoard, TaskEditor } from "./task-board";
import { VehicleInbox } from "./vehicle-inbox";
import { WorkspaceNotifications } from "./workspace-notifications";
import { SearchResults } from "./search-results";
import { SourceStatus } from "./source-status";
import { SourcesSettings, TeamSettings } from "./settings";
import { WorkspaceHelp } from "./workspace-help";

const views: Record<
  string,
  { title: string; subtitle: string; eyebrow: string }
> = {
  search: {
    title: "Fahrzeuge finden",
    subtitle:
      "Aktuelle Angebote recherchieren und den nächsten Ankauf vorbereiten.",
    eyebrow: "FAHRZEUGRECHERCHE",
  },
  searches: {
    title: "Suchaufträge",
    subtitle: "Gespeicherte Kriterien. Regelmäßige Suchen. Neue Möglichkeiten.",
    eyebrow: "SUCHAUFTRÄGE",
  },
  saved: {
    title: "Merkliste & Ankauf",
    subtitle: "Ihre Auswahl und der nächste Schritt — für das ganze Team.",
    eyebrow: "MERKLISTE & ANKAUF",
  },
  activity: {
    title: "Aktivitäten",
    subtitle: "Ergebnisse, Datenquellen und Probleme auf einen Blick.",
    eyebrow: "AKTIVITÄTEN",
  },
  inbox: {
    title: "Neue Fahrzeuge",
    subtitle:
      "Passende Angebote aus Ihren Suchprofilen. Ein Eingang für den nächsten Ankauf.",
    eyebrow: "EINGANG",
  },
  tasks: {
    title: "Aufgaben",
    subtitle: "Wer kümmert sich um welches Fahrzeug — und bis wann?",
    eyebrow: "NÄCHSTE SCHRITTE",
  },
  sources: {
    title: "Datenquellen",
    subtitle: "Verbinden Sie die Datenquellen Ihres Betriebs.",
    eyebrow: "DATENQUELLEN",
  },
  team: {
    title: "Team & Zugang",
    subtitle: "Ihr Team und Ihre persönlichen Zugangsdaten.",
    eyebrow: "TEAM & ZUGANG",
  },
  help: {
    title: "So funktioniert Autoraum",
    subtitle: "Vom ersten Suchprofil bis zur nächsten Aufgabe.",
    eyebrow: "HILFE & START",
  },
};
export function WorkspaceApp({ initial }: { initial: Workspace }) {
  const [data, setData] = useState(initial);
  const [view, setView] = useState("search");
  const [filters, setFilters] = useState<Filters>({});
  const [applied, setApplied] = useState<Filters>({});
  const [listings, setListings] = useState(initial.listings);
  const [total, setTotal] = useState(initial.total);
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [stage, setStage] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saveModal, setSaveModal] = useState(false);
  const [importModal, setImportModal] = useState(false);
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [editing, setEditing] = useState<Listing | null>(null);
  const [taskEditing, setTaskEditing] = useState<{
    task?: Task;
    listing?: Pick<Listing, "id" | "title">;
  } | null>(null);
  const [connectionError, setConnectionError] = useState(false);
  const [deleteSearch, setDeleteSearch] = useState<SavedSearch | null>(null);
  const base = `/api/w/${data.tenant.slug}`;
  const canManageSources = data.user.role === "platform_admin";
  const schedulerActive =
    !!data.schedulerHeartbeat && data.asOf - data.schedulerHeartbeat < 180_000;
  const heading = views[view];

  useEffect(() => {
    let active = true;
    let pending = false;
    const update = async () => {
      if (pending) return;
      pending = true;
      try {
        const next = await request<Workspace>(`${base}/workspace`);
        if (active) {
          setData((current) => (next.asOf >= current.asOf ? next : current));
          setConnectionError(false);
        }
      } catch {
        if (active) setConnectionError(true);
      } finally {
        pending = false;
      }
    };
    const timer = setInterval(() => void update(), 15_000);
    const onFocus = () => {
      if (!document.hidden) void update();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [base]);
  async function refresh() {
    const next = await request<Workspace>(`${base}/workspace`);
    setData((current) => (next.asOf >= current.asOf ? next : current));
  }
  function editListing(id: string) {
    void action("vehicle", async () =>
      setEditing(await request<Listing>(`${base}/listing/${id}`)),
    );
  }
  async function loadListings(
    options: {
      filter?: Filters;
      saved?: boolean;
      newSort?: string;
      newPage?: number;
      newStage?: string;
    } = {},
  ) {
    const params = new URLSearchParams({
      filters: JSON.stringify(options.filter ?? applied),
      saved: (options.saved ?? view === "saved") ? "1" : "0",
      sort: options.newSort ?? sort,
      page: String(options.newPage ?? page),
      stage: options.newStage ?? stage,
    });
    const response = await request<{ listings: Listing[]; total: number }>(
      `${base}/listings?${params}`,
    );
    setListings(response.listings);
    setTotal(response.total);
  }
  async function action(name: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(name);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Die Aktion ist fehlgeschlagen.",
      );
    } finally {
      setBusy("");
    }
  }
  function changeView(next: string) {
    if (busy) return;
    if (next === "sources" && !canManageSources) return;
    setView(next);
    setError("");
    setNotice("");
    if (next === "search" || next === "saved") {
      setPage(1);
      setStage("");
      void action("load", () =>
        loadListings({
          saved: next === "saved",
          filter: next === "saved" ? {} : applied,
          newPage: 1,
          newStage: "",
        }),
      );
    }
  }
  function search(saved?: SavedSearch) {
    const nextFilters = saved?.filters || filters;
    void action("search", async () => {
      const response = await request<{
        listings: Listing[];
        total: number;
        newMatches: number;
        results: SourceResult[];
      }>(
        `${base}/search`,
        "POST",
        saved ? { searchId: saved.id } : { filters: nextFilters },
      );
      setFilters(nextFilters);
      setApplied(nextFilters);
      setListings(response.listings);
      setTotal(response.total);
      setPage(1);
      setSort("newest");
      setStage("");
      setView("search");
      await refresh();
    });
  }
  async function saveSearch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    void action("save-search", async () => {
      await request(`${base}/searches`, "POST", {
        name: form.get("name"),
        filters,
        enabled: form.get("enabled") === "on",
        intervalMinutes: Number(form.get("interval")),
      });
      setSaveModal(false);
      setNotice("Suchauftrag gespeichert. Sie finden ihn unter Suchaufträge.");
      await refresh();
    });
  }
  function importFile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void action("import", async () => {
      const result = await request<{ added: number; updated: number }>(
        `${base}/import`,
        "POST",
        { csv },
      );
      await refresh();
      await loadListings();
      setImportModal(false);
      setCsv("");
      setFileName("");
      setNotice(
        `${result.added} Anzeigen importiert, ${result.updated} bestehende Anzeigen aktualisiert.`,
      );
    });
  }
  function bookmark(listing: Listing) {
    void action(listing.id, async () => {
      await request(`${base}/saved/${listing.id}`, "PUT", {
        stage: "saved",
        notes: "",
      });
      await refresh();
      if (view === "search" || view === "saved") await loadListings();
      setNotice("Fahrzeug zur Merkliste hinzugefügt.");
    });
  }
  const nav = [
    { id: "search", label: "Fahrzeugrecherche", icon: Search },
    { id: "inbox", label: "Eingang", icon: Inbox, count: data.inbox.unread },
    {
      id: "searches",
      label: "Suchaufträge",
      icon: Radar,
      count: data.searches.length,
    },
    {
      id: "saved",
      label: "Merkliste & Ankauf",
      icon: Bookmark,
      count: data.stats.saved,
    },
    { id: "activity", label: "Aktivitäten", icon: History },
    {
      id: "tasks",
      label: "Aufgaben",
      icon: ListTodo,
      count: data.taskStats.open,
    },
    ...(canManageSources
      ? [
          {
            id: "sources",
            label: "Datenquellen",
            icon: Plug,
            group: "EINSTELLUNGEN",
          },
        ]
      : []),
    {
      id: "team",
      label: "Team & Zugang",
      icon: Users,
      group: canManageSources ? undefined : "EINSTELLUNGEN",
    },
    { id: "help", label: "Hilfe & Start", icon: BookOpen },
  ];
  return (
    <Shell
      name={data.tenant.name}
      subtitle="HÄNDLER-ARBEITSBEREICH"
      user={data.user}
      nav={nav}
      active={view}
      setActive={changeView}
      adminLink={data.user.role === "platform_admin"}
      toolbar={
        <WorkspaceNotifications
          tenantId={data.tenant.id}
          userId={data.user.id}
          latestKey={data.inbox.latestKey}
          unread={data.inbox.unread}
          onOpen={() => changeView("inbox")}
        />
      }
    >
      <div className="page-heading">
        <div>
          <div className="eyebrow">{heading.eyebrow}</div>
          <h1>{heading.title}</h1>
          <p>{heading.subtitle}</p>
        </div>
        {["search", "saved"].includes(view) && (
          <button
            className="button secondary"
            onClick={() => setImportModal(true)}
          >
            <Plus size={17} />
            Daten importieren
          </button>
        )}
        {view === "searches" && (
          <button
            className="button primary"
            onClick={() => changeView("search")}
          >
            <Plus size={17} />
            Neue Suche
          </button>
        )}
      </div>
      {error && !saveModal && !importModal && (
        <Notice message={error} error onClose={() => setError("")} />
      )}
      {notice && <Notice message={notice} onClose={() => setNotice("")} />}
      {connectionError && (
        <Notice
          error
          message="Automatische Aktualisierung unterbrochen. Neue Hinweise erscheinen wieder, sobald die Verbindung zurück ist."
        />
      )}
      {view === "search" && (
        <>
          <div className="stats-grid">
            <div className="stat">
              <span>
                Anzeigen im Arbeitsbereich
                <CarFront size={17} />
              </span>
              <strong>{number(data.stats.listings)}</strong>
              <small>Aus Ihren Datenquellen</small>
            </div>
            <div className="stat">
              <span>
                Neu hinzugekommen
                <ArrowDownLeft size={17} />
              </span>
              <strong>{number(data.stats.newToday)}</strong>
              <small>In den letzten 24 Stunden</small>
            </div>
            <div className="stat">
              <span>
                Auf Ihrer Merkliste
                <Bookmark size={17} />
              </span>
              <strong>{number(data.stats.saved)}</strong>
              <small>Für den nächsten Schritt</small>
            </div>
            <div className="stat">
              <span>
                Automatische Suchaufträge
                <Radar size={17} />
              </span>
              <strong>
                {data.stats.searches}
                <span
                  className={`stat-indicator ${schedulerActive ? "active" : ""}`}
                />
              </strong>
              <small>
                {schedulerActive
                  ? "Planer aktiv"
                  : "Planer derzeit nicht aktiv"}
              </small>
            </div>
          </div>
          <SearchPanel
            externalSources={data.externalSources}
            filters={filters}
            setFilters={setFilters}
            busy={!!busy}
            onSearch={() => search()}
            onSave={() => {
              setError("");
              setSaveModal(true);
            }}
          />
          <SourceStatus
            data={data}
            filters={filters}
            onImport={() => setImportModal(true)}
            onManage={
              canManageSources ? () => changeView("sources") : undefined
            }
          />
        </>
      )}
      {(view === "search" || view === "saved") && (
        <SearchResults
          externalSources={data.externalSources}
          savedOnly={view === "saved"}
          inventoryCount={data.stats.listings}
          asOf={data.asOf}
          listings={listings}
          total={total}
          busy={!!busy}
          stage={stage}
          sort={sort}
          page={page}
          onStageChange={(next) => {
            setStage(next);
            setPage(1);
            void action("load", () =>
              loadListings({ filter: {}, newStage: next, newPage: 1 }),
            );
          }}
          onSortChange={(next) => {
            setSort(next);
            setPage(1);
            void action("load", () =>
              loadListings({
                filter: view === "saved" ? {} : applied,
                newSort: next,
                newPage: 1,
              }),
            );
          }}
          onPageChange={(next) => {
            setPage(next);
            void action("load", () =>
              loadListings({
                filter: view === "saved" ? {} : applied,
                newPage: next,
              }),
            );
          }}
          onBookmark={bookmark}
          onEdit={(listing) => editListing(listing.id)}
          onTask={(listing) => setTaskEditing({ listing })}
          onResearch={() => changeView("search")}
          onSources={canManageSources ? () => changeView("sources") : undefined}
          onImport={() => setImportModal(true)}
        />
      )}

      {view === "searches" && (
        <SearchJobs
          searches={data.searches}
          heartbeat={data.schedulerHeartbeat}
          schedulerActive={schedulerActive}
          busy={busy}
          onRun={search}
          onDelete={setDeleteSearch}
          onNew={() => changeView("search")}
          onLoad={(nextFilters) => {
            setFilters(nextFilters);
            setView("search");
          }}
          onToggle={(saved) =>
            void action(saved.id, async () => {
              await request(`${base}/searches/${saved.id}`, "PATCH", {
                enabled: !saved.enabled,
                intervalMinutes: saved.interval_minutes,
              });
              await refresh();
            })
          }
        />
      )}
      {view === "activity" && (
        <SearchActivity
          runs={data.runs}
          busy={!!busy}
          onRefresh={() => void action("refresh", refresh)}
        />
      )}
      {view === "inbox" && (
        <VehicleInbox
          data={data}
          base={base}
          busy={!!busy}
          onBookmark={bookmark}
          onEdit={(listing) => editListing(listing.id)}
          onTask={(listing) => setTaskEditing({ listing })}
          onRefresh={refresh}
          onSearches={() => changeView("searches")}
        />
      )}
      {view === "tasks" && (
        <>
          <div className="workflow-summary">
            <span>{data.taskStats.mine} für mich</span>
            <span>{data.taskStats.overdue} überfällig im Team</span>
          </div>
          <TaskBoard
            base={base}
            revision={data.asOf}
            onCreate={() => setTaskEditing({})}
            onEdit={(task) => setTaskEditing({ task })}
            onVehicle={editListing}
            onRefresh={refresh}
          />
        </>
      )}

      {view === "sources" && canManageSources && (
        <SourcesSettings
          data={data}
          onRefresh={refresh}
          onImport={() => {
            setError("");
            setImportModal(true);
          }}
        />
      )}
      {view === "team" && <TeamSettings data={data} />}
      {view === "help" && <WorkspaceHelp onNavigate={changeView} />}
      {saveModal && (
        <Modal
          title="Suchauftrag speichern"
          onClose={() => {
            if (!busy) setSaveModal(false);
          }}
        >
          <p className="modal-intro">
            Die aktuell eingestellten Filter werden gespeichert. Automatische
            Suchen laufen auf dem Server.
          </p>
          <form className="form-stack" onSubmit={saveSearch}>
            <label>
              Name der Suche
              <Input
                name="name"
                placeholder="z. B. Kombis bis 20.000 €"
                defaultValue={[filters.make, filters.model]
                  .filter(Boolean)
                  .join(" ")}
                required
                minLength={2}
                maxLength={80}
              />
            </label>
            <label>
              Suchintervall
              <NativeSelect
                aria-label="Suchintervall"
                name="interval"
                defaultValue="60"
              >
                <option value="15">Alle 15 Minuten</option>
                <option value="30">Alle 30 Minuten</option>
                <option value="60">Jede Stunde</option>
                <option value="180">Alle 3 Stunden</option>
                <option value="1440">Einmal täglich</option>
              </NativeSelect>
            </label>
            <label className="checkbox-label">
              <input type="checkbox" name="enabled" />
              <span>
                Automatische Suche aktivieren
                <small>
                  {schedulerActive
                    ? "Der Server-Planer ist bereit."
                    : "Startet, sobald der Server-Planer aktiv ist."}
                </small>
              </span>
            </label>
            {error && <Notice message={error} error />}
            <div className="modal-actions">
              <button
                type="button"
                className="button secondary"
                disabled={!!busy}
                onClick={() => setSaveModal(false)}
              >
                Abbrechen
              </button>
              <button className="button primary" disabled={!!busy}>
                {busy ? <Spinner /> : <Bookmark size={16} />}Suchauftrag
                speichern
              </button>
            </div>
          </form>
        </Modal>
      )}
      {importModal && (
        <Modal
          title="Fahrzeugdaten importieren"
          wide
          onClose={() => {
            if (!busy) setImportModal(false);
          }}
        >
          <p className="modal-intro">
            Importieren Sie eigene oder zur Nutzung freigegebene Anzeigen.
            Bestehende Einträge derselben Quelle und Anzeigen-ID werden
            aktualisiert.
          </p>
          <a className="text-link" href="/import-template.csv" download>
            <Download size={15} />
            Leere CSV-Vorlage herunterladen
          </a>
          <form className="form-stack import-form" onSubmit={importFile}>
            <label className="file-drop">
              <FileUp size={26} />
              <strong>{fileName || "CSV-Datei auswählen"}</strong>
              <span>Bis zu 500 Fahrzeuge · UTF-8 · Komma oder Semikolon</span>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 1_000_000) {
                    setError("Bitte eine Datei unter 1 MB auswählen.");
                    return;
                  }
                  setFileName(file.name);
                  setCsv(await file.text());
                  setError("");
                }}
              />
            </label>
            <label>
              CSV-Inhalt
              <textarea
                className="code-input"
                rows={6}
                value={csv}
                onChange={(e) => setCsv(e.target.value)}
                maxLength={1000000}
                placeholder="externalId,source,url,title,make,model,price,year,mileage,…"
                required
              />
            </label>
            <p className="helper">
              Pflichtspalten: externalId, url, title, make, model, price. source
              ist optional (Standard: csv). Preise in EUR, Dezimalpunkt; source:{" "}
              {Object.keys(sourceNames).join(", ")}. Keine automatische
              Aktualisierung ohne Feed.
            </p>
            {error && <Notice message={error} error />}
            <div className="modal-actions">
              <button
                type="button"
                className="button secondary"
                disabled={!!busy}
                onClick={() => setImportModal(false)}
              >
                Abbrechen
              </button>
              <button className="button primary" disabled={!!busy || !csv}>
                {busy ? <Spinner /> : <FileUp size={16} />}Daten importieren
              </button>
            </div>
          </form>
        </Modal>
      )}
      {editing && (
        <ListingEditor
          sourceLabel={sourceName(editing.source, data.externalSources)}
          listing={editing}
          slug={data.tenant.slug}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await refresh();
            if (view === "search" || view === "saved")
              await loadListings({ filter: view === "saved" ? {} : applied });
          }}
        />
      )}
      {taskEditing && (
        <TaskEditor
          task={taskEditing.task}
          listing={taskEditing.listing}
          members={data.members}
          userId={data.user.id}
          base={base}
          onClose={() => setTaskEditing(null)}
          onSaved={refresh}
        />
      )}
      {deleteSearch && (
        <Modal
          title="Suchauftrag löschen?"
          onClose={() => setDeleteSearch(null)}
        >
          <p className="modal-intro">
            „{deleteSearch.name}“ wird entfernt. Fahrzeuge und Ihre Merkliste
            bleiben erhalten.
          </p>
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => setDeleteSearch(null)}
            >
              Abbrechen
            </button>
            <button
              className="button primary"
              disabled={!!busy}
              onClick={() =>
                void action("delete", async () => {
                  await request(
                    `${base}/searches/${deleteSearch.id}`,
                    "DELETE",
                    {},
                  );
                  setDeleteSearch(null);
                  await refresh();
                })
              }
            >
              <Trash2 size={15} />
              Suchauftrag löschen
            </button>
          </div>
        </Modal>
      )}
    </Shell>
  );
}
