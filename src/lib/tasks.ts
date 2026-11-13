import { randomUUID } from "node:crypto";
import { db, type Queryable } from "./db";
import { HttpError, readJson } from "./security";
import {
  taskCreateSchema,
  taskStatusSchema,
  taskUpdateSchema,
} from "./validation";
import type { Task, TaskMember, TaskPage } from "./types";
import { berlinDate } from "./types";

export async function taskMembers(tenantId: string) {
  return db.query<TaskMember>(
    "SELECT id,name FROM users u WHERE tenant_id=$1 AND role IN ('owner','buyer') AND password_hash IS NOT NULL AND NOT EXISTS (SELECT 1 FROM blocked_users b WHERE b.user_id=u.id) ORDER BY name,id",
    [tenantId],
  );
}

export async function taskSummary(tenantId: string, userId: string) {
  const [row] = await db.query<{
    open: number;
    mine: number | null;
    overdue: number | null;
  }>(
    `SELECT COUNT(*) AS open,SUM(CASE WHEN assignee_id=$2 THEN 1 ELSE 0 END) AS mine,
     SUM(CASE WHEN due_date<$3 THEN 1 ELSE 0 END) AS overdue FROM tasks WHERE tenant_id=$1 AND status='open'`,
    [tenantId, userId, berlinDate()],
  );
  return {
    open: Number(row.open),
    mine: Number(row.mine || 0),
    overdue: Number(row.overdue || 0),
  };
}

export async function queryTasks(
  tenantId: string,
  userId: string,
  options: {
    filter: "open" | "mine" | "today" | "overdue" | "done";
    page: number;
    listingId?: string;
  },
): Promise<TaskPage> {
  const today = berlinDate();
  const params: (string | number)[] = [tenantId];
  const clauses = [
    "t.tenant_id=$1",
    options.filter === "done" ? "t.status='done'" : "t.status='open'",
  ];
  if (options.filter === "mine") {
    params.push(userId);
    clauses.push(`t.assignee_id=$${params.length}`);
  }
  if (options.filter === "today" || options.filter === "overdue") {
    params.push(today);
    clauses.push(
      `t.due_date${options.filter === "today" ? "=" : "<"}$${params.length}`,
    );
  }
  if (options.listingId) {
    params.push(options.listingId);
    clauses.push(`t.listing_id=$${params.length}`);
  }
  const where = clauses.join(" AND ");
  const [count] = await db.query<{ count: number }>(
    `SELECT COUNT(*) AS count FROM tasks t WHERE ${where}`,
    params,
  );
  const tasks = await db.query<Task>(
    `SELECT t.*,u.name AS assignee_name,l.title AS listing_title FROM tasks t
     JOIN users u ON u.id=t.assignee_id AND u.tenant_id=t.tenant_id
     LEFT JOIN listings l ON l.id=t.listing_id AND l.tenant_id=t.tenant_id
     WHERE ${where} ORDER BY t.due_date,t.created_at,t.id LIMIT 24 OFFSET $${params.length + 1}`,
    [...params, (options.page - 1) * 24],
  );
  return { tasks, total: Number(count.count), today };
}

async function checkReferences(
  tx: Queryable,
  tenantId: string,
  assigneeId: string,
  listingId: string | null,
) {
  const assignee = await tx.query(
    "SELECT id FROM users u WHERE tenant_id=$1 AND id=$2 AND role IN ('owner','buyer') AND password_hash IS NOT NULL AND NOT EXISTS (SELECT 1 FROM blocked_users b WHERE b.user_id=u.id)",
    [tenantId, assigneeId],
  );
  if (!assignee.length)
    throw new HttpError(
      400,
      "Bitte ein aktiviertes Teammitglied dieses Betriebs auswählen.",
    );
  if (listingId) {
    const listing = await tx.query(
      "SELECT id FROM listings WHERE tenant_id=$1 AND id=$2",
      [tenantId, listingId],
    );
    if (!listing.length) throw new HttpError(404, "Fahrzeug nicht gefunden.");
  }
}

export async function createTask(
  request: Request,
  tenantId: string,
  actorId: string,
) {
  const input = await readJson(request, taskCreateSchema);
  return db.transaction(async (tx) => {
    await checkReferences(tx, tenantId, input.assigneeId, input.listingId);
    const id = input.requestId || randomUUID();
    const inserted = await tx.query(
      `INSERT INTO tasks(id,tenant_id,listing_id,title,notes,assignee_id,due_date,created_at,updated_at,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$9) ON CONFLICT(id) DO NOTHING RETURNING id`,
      [
        id,
        tenantId,
        input.listingId,
        input.title,
        input.notes,
        input.assigneeId,
        input.dueDate,
        Date.now(),
        actorId,
      ],
    );
    if (!inserted.length) {
      const [prior] = await tx.query<Task & { created_by: string }>(
        "SELECT * FROM tasks WHERE tenant_id=$1 AND id=$2",
        [tenantId, id],
      );
      if (
        !prior ||
        prior.created_by !== actorId ||
        prior.title !== input.title ||
        prior.notes !== input.notes ||
        prior.listing_id !== input.listingId ||
        prior.assignee_id !== input.assigneeId ||
        prior.due_date !== input.dueDate
      ) {
        throw new HttpError(
          409,
          "Diese Anfrage wurde bereits anders verarbeitet. Bitte die Aufgaben aktualisieren.",
        );
      }
    }
    return { id };
  });
}

async function assertUpdated(
  rows: unknown[],
  tx: Queryable,
  tenantId: string,
  id: string,
) {
  if (rows.length) return;
  const exists = await tx.query(
    "SELECT id FROM tasks WHERE tenant_id=$1 AND id=$2",
    [tenantId, id],
  );
  if (!exists.length) throw new HttpError(404, "Aufgabe nicht gefunden.");
  throw new HttpError(
    409,
    "Diese Aufgabe wurde inzwischen geändert. Bitte schließen, aktualisieren und erneut öffnen.",
  );
}

export async function updateTask(
  request: Request,
  tenantId: string,
  id: string,
) {
  const input = await readJson(request, taskUpdateSchema);
  return db.transaction(async (tx) => {
    await checkReferences(tx, tenantId, input.assigneeId, input.listingId);
    const rows = await tx.query(
      `UPDATE tasks SET title=$3,notes=$4,assignee_id=$5,due_date=$6,listing_id=$7,updated_at=$8,version=version+1
       WHERE tenant_id=$1 AND id=$2 AND version=$9 RETURNING id`,
      [
        tenantId,
        id,
        input.title,
        input.notes,
        input.assigneeId,
        input.dueDate,
        input.listingId,
        Date.now(),
        input.version,
      ],
    );
    await assertUpdated(rows, tx, tenantId, id);
    return { ok: true };
  });
}

export async function changeTaskStatus(
  request: Request,
  tenantId: string,
  id: string,
) {
  const input = await readJson(request, taskStatusSchema);
  return db.transaction(async (tx) => {
    const now = Date.now();
    const rows = await tx.query(
      `UPDATE tasks SET status=$3,updated_at=$4,completed_at=$5,version=version+1
       WHERE tenant_id=$1 AND id=$2 AND version=$6 RETURNING id`,
      [
        tenantId,
        id,
        input.status,
        now,
        input.status === "done" ? now : null,
        input.version,
      ],
    );
    await assertUpdated(rows, tx, tenantId, id);
    return { ok: true };
  });
}
