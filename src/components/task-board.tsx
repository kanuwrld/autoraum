"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  CalendarDays,
  Check,
  ListTodo,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import {
  berlinDate,
  type Listing,
  type Task,
  type TaskMember,
  type TaskPage,
} from "@/lib/types";
import { Input } from "./ui/input";
import { NativeSelect } from "./ui/native-select";
import { Badge, Modal, Notice, request, Spinner } from "./ui";

export function TaskEditor({
  task,
  listing,
  members,
  userId,
  base,
  onClose,
  onSaved,
}: {
  task?: Task;
  listing?: Pick<Listing, "id" | "title"> | null;
  members: TaskMember[];
  userId: string;
  base: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState("");
  const assignee =
    task?.assignee_id ||
    members.find((m) => m.id === userId)?.id ||
    members[0]?.id ||
    "";
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending.current) return;
    sending.current = true;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await request(
        `${base}/tasks${task ? `/${task.id}` : ""}`,
        task ? "PUT" : "POST",
        {
          title: f.get("title"),
          notes: f.get("notes"),
          assigneeId: f.get("assignee"),
          dueDate: f.get("due"),
          listingId: task?.listing_id || listing?.id || null,
          ...(task ? { version: task.version } : { requestId }),
        },
      );
      await onSaved();
      onClose();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Aufgabe konnte nicht gespeichert werden.",
      );
      setBusy(false);
      sending.current = false;
    }
  }
  return (
    <Modal
      title={task ? "Aufgabe bearbeiten" : "Aufgabe erstellen"}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {(task?.listing_title || listing?.title) && (
        <p className="modal-intro">
          Fahrzeug: <strong>{task?.listing_title || listing?.title}</strong>
        </p>
      )}
      <form className="form-stack" onSubmit={submit}>
        <label>
          Nächste Aktion
          <Input
            name="title"
            required
            minLength={2}
            maxLength={160}
            defaultValue={task?.title || ""}
            placeholder="z. B. Verkäufer wegen Besichtigung anrufen"
            disabled={busy}
            autoFocus
          />
        </label>
        <div className="form-grid two">
          <label>
            Verantwortlich
            <NativeSelect
              name="assignee"
              aria-label="Verantwortlich"
              required
              defaultValue={assignee}
              disabled={busy || !members.length}
            >
              {!members.length && (
                <option value="">Kein aktiviertes Teammitglied</option>
              )}
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label>
            Fällig am
            <Input
              name="due"
              type="date"
              required
              min="2020-01-01"
              max="2100-12-31"
              defaultValue={task?.due_date || berlinDate()}
              disabled={busy}
            />
          </label>
        </div>
        <p className="helper">
          Fällig bis zum Ende des gewählten Tages, Zeitzone Europe/Berlin.
        </p>
        <label>
          Aufgabennotizen
          <textarea
            name="notes"
            rows={3}
            maxLength={2000}
            defaultValue={task?.notes || ""}
            disabled={busy}
            placeholder="Was ist vor dem nächsten Schritt zu klären?"
          />
        </label>
        {!members.length && (
          <Notice message="Zuerst ein Teammitglied einladen und den Zugang aktivieren." />
        )}
        {error && <Notice message={error} error />}
        <div className="modal-actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            Abbrechen
          </button>
          <button className="button primary" disabled={busy || !members.length}>
            {busy ? <Spinner /> : <Check size={16} />}Aufgabe speichern
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function TaskBoard({
  base,
  revision,
  onCreate,
  onEdit,
  onVehicle,
  onRefresh,
}: {
  base: string;
  revision: number;
  onCreate: () => void;
  onEdit: (task: Task) => void;
  onVehicle: (id: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const [filter, setFilter] = useState("open");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<TaskPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await request<TaskPage>(
          `${base}/tasks?${new URLSearchParams({ filter, page: String(page) })}`,
        );
        if (active) {
          if (page > 1 && !response.tasks.length)
            setPage(Math.max(1, Math.ceil(response.total / 24)));
          setResult(response);
        }
      } catch (e) {
        if (active)
          setError(e instanceof Error ? e.message : "Laden fehlgeschlagen.");
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [base, filter, page, revision, reload]);

  async function toggle(task: Task) {
    if (busy) return;
    setBusy(task.id);
    setError("");
    try {
      await request(`${base}/tasks/${task.id}`, "PATCH", {
        version: task.version,
        status: task.status === "done" ? "open" : "done",
      });
      await onRefresh();
      setReload((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Änderung fehlgeschlagen.");
    } finally {
      setBusy("");
    }
  }

  return (
    <section
      className="task-board"
      aria-label="Aufgabenliste"
      aria-busy={loading}
    >
      <div className="workflow-toolbar">
        <NativeSelect
          aria-label="Aufgaben filtern"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="open">Alle offenen Aufgaben</option>
          <option value="mine">Meine Aufgaben</option>
          <option value="today">Heute fällig</option>
          <option value="overdue">Überfällig</option>
          <option value="done">Erledigt</option>
        </NativeSelect>
        <div className="button-row">
          <button
            className="button secondary"
            disabled={loading || !!busy}
            onClick={() => setReload((v) => v + 1)}
            aria-label="Aufgaben aktualisieren"
          >
            <RefreshCw size={16} />
          </button>
          <button className="button primary" onClick={onCreate}>
            <Plus size={16} />
            Neue Aufgabe
          </button>
        </div>
      </div>
      {error && <Notice message={error} error />}
      {!result && loading && (
        <div className="workflow-empty">
          <Spinner />
          Aufgaben werden geladen …
        </div>
      )}
      {result?.tasks.map((task) => (
        <article
          className="task-row panel"
          key={task.id}
          data-task-id={task.id}
        >
          <button
            className={`task-check ${task.status === "done" ? "done" : ""}`}
            aria-label={`${task.title}: ${task.status === "done" ? "wieder öffnen" : "erledigen"}`}
            disabled={!!busy || loading}
            onClick={() => void toggle(task)}
          >
            {busy === task.id ? (
              <Spinner />
            ) : task.status === "done" ? (
              <RotateCcw size={17} />
            ) : (
              <Check size={17} />
            )}
          </button>
          <div className="task-content">
            <h3>{task.title}</h3>
            {task.listing_id && (
              <button
                className="text-button task-vehicle"
                onClick={() => onVehicle(task.listing_id!)}
              >
                {task.listing_title}
              </button>
            )}
            {task.notes && <p>{task.notes}</p>}
            <div className="task-meta">
              <span>{task.assignee_name}</span>
              <span>
                <CalendarDays size={14} />
                {task.due_date.split("-").reverse().join(".")}
              </span>
              {task.status === "done" ? (
                <Badge>Erledigt</Badge>
              ) : task.due_date < result.today ? (
                <Badge tone="red">Überfällig</Badge>
              ) : task.due_date === result.today ? (
                <Badge>Heute</Badge>
              ) : null}
            </div>
          </div>
          <button
            className="icon-button"
            aria-label={`${task.title}: bearbeiten`}
            disabled={!!busy || loading}
            onClick={() => onEdit(task)}
          >
            <Pencil size={17} />
          </button>
        </article>
      ))}
      {result && !result.total && !loading && (
        <div className="workflow-empty panel">
          <ListTodo size={30} />
          <h3>Keine Aufgaben in dieser Ansicht.</h3>
          <p>
            Planen Sie den nächsten Anruf oder eine Besichtigung. Eine
            Fahrzeugaufgabe erstellen Sie direkt an der Anzeige.
          </p>
        </div>
      )}
      {result && result.total > 0 && (
        <div className="pagination">
          <span>
            {result.total} {result.total === 1 ? "Aufgabe" : "Aufgaben"} · Seite{" "}
            {page}
          </span>
          <div className="button-row">
            <button
              className="button secondary small"
              disabled={page === 1 || loading}
              onClick={() => setPage(page - 1)}
            >
              Zurück
            </button>
            <button
              className="button secondary small"
              disabled={page * 24 >= result.total || loading}
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
