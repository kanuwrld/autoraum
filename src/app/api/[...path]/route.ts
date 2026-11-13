import { z } from "zod";
import { db } from "@/lib/db";
import {
  api,
  appUrl,
  checkOrigin,
  emailSchema,
  hashPassword,
  hashToken,
  HttpError,
  passwordSchema,
  rateLimit,
  readJson,
  safeEqual,
  verifyPassword,
} from "@/lib/security";
import {
  audit,
  createSession,
  deleteSession,
  requireAdmin,
  requireTenant,
  requireUser,
} from "@/lib/auth";
import {
  createTenant,
  getAdminData,
  reissueInvitation,
  updateTenant,
} from "@/lib/admin";
import { getWorkspace } from "@/lib/workspace";
import {
  importCsv,
  inviteTeamMember,
  rotateFeedKey,
  saveListing,
  saveProvider,
  saveSearch,
  updateSearch,
} from "@/lib/workspace-actions";
import { filtersSchema, listingInputSchema } from "@/lib/validation";
import { getListing, queryListings, upsertListings } from "@/lib/listings";
import { queryInbox, readAllInbox, setInboxRead } from "@/lib/inbox";
import {
  changeTaskStatus,
  createTask,
  queryTasks,
  updateTask,
} from "@/lib/tasks";
import { runSearch, tickScheduler } from "@/lib/search";
import { ingest } from "@/lib/ingestion";
import {
  createExternalSource,
  changeExternalSourceKey,
} from "@/lib/external-sources";
import type { User } from "@/lib/types";
import { changeTeamAccess, recoverTeamMember, teamMembers } from "@/lib/team";
import { getOperationsStatus } from "@/lib/operations";
import { exportWorkspace } from "@/lib/workspace-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;
type Context = { params: Promise<{ path: string[] }> };

async function route(request: Request, context: Context) {
  const { path } = await context.params;
  const resource = path.join("/");
  const method = request.method;
  if (resource === "health" && method === "GET") {
    await db.query("SELECT 1 AS ok");
    return { ok: true };
  }
  if (resource === "cron" && (method === "GET" || method === "POST")) {
    const secret = process.env.CRON_SECRET;
    if (
      !secret ||
      secret.length < 32 ||
      !safeEqual(request.headers.get("authorization") || "", `Bearer ${secret}`)
    )
      throw new HttpError(401, "Nicht autorisiert.");
    return tickScheduler();
  }
  if (resource === "ingest" && method === "POST") return ingest(request);
  if (method !== "GET") checkOrigin(request);
  if (resource === "auth/login" && method === "POST") {
    const input = await readJson(
      request,
      z.object({ email: emailSchema, password: z.string().min(1).max(128) }),
    );
    await rateLimit(`login:${input.email}`, 10, 15 * 60_000);
    const networkKey = process.env.VERCEL
      ? request.headers.get("x-vercel-forwarded-for") || "unknown"
      : "local";
    await rateLimit(`login-network:${networkKey}`, 100, 15 * 60_000);
    const [user] = await db.query<
      User & {
        password_hash: string | null;
        active: number | null;
        slug: string | null;
      }
    >(
      "SELECT u.*,t.active,t.slug FROM users u LEFT JOIN tenants t ON t.id=u.tenant_id WHERE u.email=$1 AND NOT EXISTS (SELECT 1 FROM blocked_users b WHERE b.user_id=u.id)",
      [input.email],
    );
    const valid = await verifyPassword(
      input.password,
      user?.password_hash || null,
    );
    if (
      !user ||
      !valid ||
      (user.role !== "platform_admin" && user.active !== 1)
    )
      throw new HttpError(
        401,
        "E-Mail oder Passwort ist nicht korrekt, oder der Zugang ist pausiert.",
      );
    await createSession(user.id);
    return {
      redirect: user.role === "platform_admin" ? "/admin" : `/w/${user.slug}`,
    };
  }
  if (resource === "auth/activate" && method === "POST") {
    const input = await readJson(
      request,
      z.object({
        token: z.string().min(32).max(150),
        password: passwordSchema,
      }),
    );
    await rateLimit(`activate:${hashToken(input.token)}`, 10, 15 * 60_000);
    const passwordHash = await hashPassword(input.password);
    const user = await db.transaction(async (tx) => {
      const [invite] = await tx.query<{ user_id: string }>(
        "UPDATE invitations SET used_at=$2 WHERE token_hash=$1 AND used_at IS NULL AND expires_at>$2 RETURNING user_id",
        [hashToken(input.token), Date.now()],
      );
      if (!invite)
        throw new HttpError(
          400,
          "Dieser Link ist abgelaufen oder wurde bereits verwendet. Bitte einen neuen Link anfordern.",
        );
      const [member] = await tx.query<User & { slug: string; active: number }>(
        "SELECT u.*,t.slug,t.active FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE u.id=$1 AND NOT EXISTS (SELECT 1 FROM blocked_users b WHERE b.user_id=u.id)",
        [invite.user_id],
      );
      if (!member || member.active !== 1)
        throw new HttpError(403, "Der Zugang ist pausiert.");
      await tx.query("UPDATE users SET password_hash=$2 WHERE id=$1", [
        member.id,
        passwordHash,
      ]);
      await tx.query("DELETE FROM sessions WHERE user_id=$1", [member.id]);
      await audit(
        member.id,
        member.tenant_id,
        "Zugang aktiviert / Passwort erneuert",
        tx,
      );
      return member;
    });
    await createSession(user.id);
    return { redirect: `/w/${user.slug}` };
  }
  if (resource === "auth/logout" && method === "POST") {
    await deleteSession();
    return { ok: true };
  }
  if (resource === "auth/password" && method === "POST") {
    const user = await requireUser();
    await rateLimit(`password:${user.id}`, 10, 3600_000);
    const input = await readJson(
      request,
      z.object({
        currentPassword: z.string().max(128),
        password: passwordSchema,
      }),
    );
    const [record] = await db.query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE id=$1",
      [user.id],
    );
    if (!(await verifyPassword(input.currentPassword, record.password_hash)))
      throw new HttpError(400, "Das aktuelle Passwort ist nicht korrekt.");
    const hash = await hashPassword(input.password);
    await db.transaction(async (tx) => {
      await tx.query("UPDATE users SET password_hash=$2 WHERE id=$1", [
        user.id,
        hash,
      ]);
      await tx.query("DELETE FROM sessions WHERE user_id=$1", [user.id]);
    });
    await createSession(user.id);
    return { ok: true };
  }
  if (path[0] === "admin") {
    const actor = await requireAdmin();
    if (resource === "admin/operations" && method === "GET")
      return getOperationsStatus();
    if (resource === "admin/tenants" && method === "GET") return getAdminData();
    if (resource === "admin/tenants" && method === "POST")
      return createTenant(request, actor);
    if (path[1] === "tenants" && path.length === 3 && method === "PATCH")
      return updateTenant(request, path[2], actor);
    if (
      path[1] === "tenants" &&
      path.length === 4 &&
      path[3] === "invite" &&
      method === "POST"
    )
      return reissueInvitation(path[2], actor);
  }
  if (path[0] === "w" && path[1]) {
    const { tenant, user } = await requireTenant(path[1]);
    const action = path[2];
    const id = path[3];
    if (action === "export" && !id && method === "GET") {
      await requireTenant(path[1], true);
      await rateLimit(`export:${tenant.id}`, 10, 3600_000);
      return exportWorkspace(tenant, user);
    }
    if (action === "workspace" && method === "GET")
      return getWorkspace(tenant, user);
    if (action === "listing" && id && method === "GET")
      return getListing(tenant.id, id);
    if (action === "inbox" && !id && method === "GET") {
      const q = new URL(request.url).searchParams;
      return queryInbox(tenant.id, user.id, {
        status: z
          .enum(["all", "unread", "read"])
          .parse(q.get("status") || "all"),
        page: z.coerce
          .number()
          .int()
          .min(1)
          .max(1000)
          .parse(q.get("page") || 1),
        searchId: z
          .string()
          .uuid()
          .optional()
          .parse(q.get("searchId") || undefined),
      });
    }
    if (action === "inbox" && id === "read-all" && method === "POST") {
      const input = await readJson(
        request,
        z.object({ before: z.number().int().nonnegative() }),
      );
      return readAllInbox(tenant.id, user.id, input.before);
    }
    if (action === "inbox" && id && method === "PATCH") {
      const input = await readJson(request, z.object({ read: z.boolean() }));
      return setInboxRead(tenant.id, user.id, id, input.read);
    }
    if (action === "tasks" && !id && method === "GET") {
      const q = new URL(request.url).searchParams;
      return queryTasks(tenant.id, user.id, {
        filter: z
          .enum(["open", "mine", "today", "overdue", "done"])
          .parse(q.get("filter") || "open"),
        page: z.coerce
          .number()
          .int()
          .min(1)
          .max(1000)
          .parse(q.get("page") || 1),
        listingId: z
          .string()
          .uuid()
          .optional()
          .parse(q.get("listingId") || undefined),
      });
    }
    if (action === "tasks" && !id && method === "POST") {
      await rateLimit(`tasks:${tenant.id}`, 120, 3600_000);
      return createTask(request, tenant.id, user.id);
    }
    if (action === "tasks" && id && method === "PUT")
      return updateTask(request, tenant.id, id);
    if (action === "tasks" && id && method === "PATCH")
      return changeTaskStatus(request, tenant.id, id);
    if (action === "external-sources") {
      await requireAdmin();
      if (!id && method === "POST")
        return createExternalSource(request, tenant, user);
      if (id && path[4] === "key" && (method === "POST" || method === "DELETE"))
        return changeExternalSourceKey(tenant, user, id, method === "DELETE");
    }
    if (action === "listings" && method === "GET") {
      const query = new URL(request.url).searchParams;
      let raw: unknown;
      try {
        raw = JSON.parse(query.get("filters") || "{}");
      } catch {
        throw new HttpError(400, "Ungültige Suchfilter.");
      }
      return queryListings(tenant.id, filtersSchema.parse(raw), {
        savedOnly: query.get("saved") === "1",
        stage: query.get("stage") || undefined,
        sort: query.get("sort") || "newest",
        page: z.coerce
          .number()
          .int()
          .min(1)
          .max(1000)
          .parse(query.get("page") || 1),
      });
    }
    if (action === "search" && method === "POST") {
      await rateLimit(`search:${tenant.id}`, 10, 60_000);
      const input = await readJson(
        request,
        z.object({
          searchId: z.string().uuid().optional(),
          filters: filtersSchema.optional(),
        }),
      );
      let filters = input.filters || {};
      if (input.searchId) {
        const [search] = await db.query<{ filters_json: string }>(
          "SELECT filters_json FROM searches WHERE id=$1 AND tenant_id=$2",
          [input.searchId, tenant.id],
        );
        if (!search) throw new HttpError(404, "Suchauftrag nicht gefunden.");
        filters = filtersSchema.parse(JSON.parse(search.filters_json));
      }
      return runSearch(tenant.id, filters, input.searchId || null);
    }
    if (action === "searches" && !id && method === "POST")
      return saveSearch(request, tenant.id);
    if (action === "searches" && id && method === "PATCH")
      return updateSearch(request, tenant.id, id);
    if (action === "searches" && id && method === "DELETE") {
      await db.query("DELETE FROM searches WHERE id=$1 AND tenant_id=$2", [
        id,
        tenant.id,
      ]);
      return { ok: true };
    }
    if (action === "saved" && id && method === "PUT")
      return saveListing(request, tenant.id, id);
    if (action === "saved" && id && method === "DELETE") {
      await db.query(
        "DELETE FROM saved_listings WHERE listing_id=$1 AND tenant_id=$2",
        [id, tenant.id],
      );
      return { ok: true };
    }
    if (action === "import" && method === "POST")
      return importCsv(request, tenant, user);
    if (action === "listing" && method === "POST") {
      const input = await readJson(request, listingInputSchema);
      return upsertListings(tenant.id, [input]);
    }
    if (["providers", "feed-key", "team"].includes(action)) {
      await requireTenant(path[1], true);
      if (action !== "team") await requireAdmin();
      if (action === "providers" && method === "PUT")
        return saveProvider(request, tenant, user);
      if (action === "providers" && method === "DELETE") {
        await db.query(
          "UPDATE provider_configs SET mobile_credentials=NULL,mobile_updated_at=NULL WHERE tenant_id=$1",
          [tenant.id],
        );
        await audit(user.id, tenant.id, "mobile.de-Zugang entfernt");
        return { ok: true };
      }
      if (action === "feed-key" && method === "POST")
        return rotateFeedKey(tenant, user);
      if (action === "feed-key" && method === "DELETE") {
        await db.query(
          "UPDATE provider_configs SET feed_token_hash=NULL WHERE tenant_id=$1",
          [tenant.id],
        );
        return { ok: true };
      }
      if (action === "team" && !id && method === "GET")
        return teamMembers(tenant.id);
      if (
        action === "team" &&
        id &&
        path[4] === "recover" &&
        path.length === 5 &&
        method === "POST"
      )
        return recoverTeamMember(tenant, user, id);
      if (action === "team" && id && path.length === 4 && method === "PATCH")
        return changeTeamAccess(request, tenant, user, id);
      if (action === "team" && !id && method === "POST")
        return inviteTeamMember(request, tenant, user);
    }
    if (action === "info" && method === "GET") return { appUrl: appUrl() };
  }
  throw new HttpError(404, "Nicht gefunden.");
}
const handler = (request: Request, context: Context) =>
  api(() => route(request, context));
export {
  handler as GET,
  handler as POST,
  handler as PUT,
  handler as PATCH,
  handler as DELETE,
};
