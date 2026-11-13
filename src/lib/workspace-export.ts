import { db } from "./db";
import { audit } from "./auth";
import type { Tenant, User } from "./types";
import { HttpError } from "./security";

export async function exportWorkspace(tenant: Tenant, actor: User) {
  if (
    actor.role !== "platform_admin" &&
    (actor.role !== "owner" || actor.tenant_id !== tenant.id)
  )
    throw new HttpError(
      403,
      "Nur die Verwaltung kann Arbeitsdaten exportieren.",
    );
  return db.transaction(async (tx) => {
    const searches = await tx.query<{
      name: string;
      filters_json: string;
      enabled: number;
      interval_minutes: number;
    }>(
      "SELECT name,filters_json,enabled,interval_minutes FROM searches WHERE tenant_id=$1 ORDER BY created_at,id",
      [tenant.id],
    );
    const shortlist = await tx.query(
      `SELECT l.id,l.title,l.url,l.source,l.last_seen,s.stage,s.notes,s.target_price_cents,s.sale_price_cents,s.costs_cents,
      p.transport_cents,p.repairs_cents,p.preparation_cents,p.fees_cents,p.reserve_cents,p.desired_profit_cents
      FROM saved_listings s JOIN listings l ON l.id=s.listing_id AND l.tenant_id=s.tenant_id
      LEFT JOIN purchase_plans p ON p.tenant_id=s.tenant_id AND p.listing_id=s.listing_id
      WHERE s.tenant_id=$1 ORDER BY s.updated_at,s.listing_id`,
      [tenant.id],
    );
    const tasks = await tx.query(
      `SELECT t.title,t.notes,t.due_date,t.status,t.completed_at,t.created_at,u.name AS assignee,l.url AS vehicle_url
      FROM tasks t JOIN users u ON u.id=t.assignee_id AND u.tenant_id=t.tenant_id
      LEFT JOIN listings l ON l.id=t.listing_id AND l.tenant_id=t.tenant_id
      WHERE t.tenant_id=$1 ORDER BY t.created_at,t.id`,
      [tenant.id],
    );
    await audit(actor.id, tenant.id, "Arbeitsdaten exportiert", tx);
    return {
      format: "autoraum-workspace",
      version: 1,
      exportedAt: new Date().toISOString(),
      company: { name: tenant.name, slug: tenant.slug },
      currency: "EUR",
      moneyUnit: "cents",
      timeZone: "Europe/Berlin",
      searches: searches.map(({ filters_json, ...s }) => ({
        ...s,
        filters: JSON.parse(filters_json),
      })),
      shortlist,
      tasks,
    };
  });
}
