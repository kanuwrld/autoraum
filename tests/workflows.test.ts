import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, closeDb } from "../src/lib/db";
import {
  listingInputSchema,
  bookmarkSchema,
  taskSchema,
} from "../src/lib/validation";
import { getListing, queryListings, upsertListings } from "../src/lib/listings";
import { runSearch } from "../src/lib/search";
import { saveListing } from "../src/lib/workspace-actions";
import {
  inboxSummary,
  queryInbox,
  readAllInbox,
  recordInboxMatches,
  setInboxRead,
} from "../src/lib/inbox";
import {
  changeTaskStatus,
  createTask,
  queryTasks,
  taskMembers,
  taskSummary,
  updateTask,
} from "../src/lib/tasks";
import { calculatePurchase } from "../src/lib/purchase";
import { berlinDate, type PurchasePlan } from "../src/lib/types";

const directory = mkdtempSync(join(tmpdir(), "autoraum-workflows-"));
process.env.SQLITE_PATH = join(directory, "test.sqlite");
process.env.PUBLIC_MARKETPLACE_SEARCH = "0";
if (process.env.TEST_DATABASE_URL)
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
else delete process.env.DATABASE_URL;
delete process.env.VERCEL;
after(async () => {
  await closeDb();
  rmSync(directory, { recursive: true, force: true });
});
const jsonRequest = (body: unknown) =>
  new Request("https://app.example.test/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const car = (externalId: string) =>
  listingInputSchema.parse({
    externalId,
    source: "csv",
    url: `https://fixtures.example.test/${externalId}`,
    title: `TEST Workflow ${externalId}`,
    make: "BMW",
    model: "320d",
    price: 16000,
  });
async function fixture() {
  const tenant = randomUUID(),
    other = randomUUID(),
    owner = randomUUID(),
    buyer = randomUUID(),
    foreign = randomUUID(),
    pending = randomUUID();
  await db.query(
    "INSERT INTO tenants(id,name,slug,created_at) VALUES($1,'TEST Workflow',$1,$3),($2,'TEST Other',$2,$3)",
    [tenant, other, Date.now()],
  );
  for (const [id, company, activated, role] of [
    [owner, tenant, true, "owner"],
    [buyer, tenant, true, "buyer"],
    [pending, tenant, false, "buyer"],
    [foreign, other, true, "owner"],
  ] as const) {
    await db.query(
      "INSERT INTO users(id,tenant_id,email,name,role,password_hash,created_at) VALUES($1,$2,$3,'TEST Employee',$4,$5,$6)",
      [
        id,
        company,
        `${id}@example.test`,
        role,
        activated ? "TEST-not-a-login-hash" : null,
        Date.now(),
      ],
    );
  }
  await upsertListings(tenant, [car("one")]);
  await upsertListings(other, [car("foreign")]);
  const listing = (await queryListings(tenant)).listings[0];
  const foreignListing = (await queryListings(other)).listings[0];
  const search = async (name: string) => {
    const id = randomUUID();
    await db.query(
      "INSERT INTO searches(id,tenant_id,name,filters_json,enabled,created_at) VALUES($1,$2,$3,$4,0,$5)",
      [id, tenant, name, JSON.stringify({ sources: ["csv"] }), Date.now()],
    );
    return id;
  };
  return {
    tenant,
    other,
    owner,
    buyer,
    foreign,
    pending,
    listing,
    foreignListing,
    search,
  };
}
const costPlan = {
  transport: 400,
  repairs: 1000,
  preparation: 300,
  fees: 300,
  reserve: 500,
  desiredProfit: 2000,
};

test("saved-search inbox is unique across repeats and overlapping profiles; unsaved searches do not notify", async () => {
  const f = await fixture();
  await runSearch(f.tenant, { sources: ["csv"] });
  assert.equal((await inboxSummary(f.tenant, f.owner)).unread, 0);
  const one = await f.search("TEST BMW"),
    two = await f.search("TEST Budget");
  assert.equal(
    (await runSearch(f.tenant, { sources: ["csv"] }, one)).newMatches,
    1,
  );
  const original = await inboxSummary(f.tenant, f.owner);
  assert.equal(
    (await runSearch(f.tenant, { sources: ["csv"] }, one)).newMatches,
    0,
  );
  await runSearch(f.tenant, { sources: ["csv"] }, two);
  assert.deepEqual(await inboxSummary(f.tenant, f.owner), original);
  const result = await queryInbox(f.tenant, f.owner, {
    status: "all",
    page: 1,
  });
  assert.equal(result.total, 1);
  assert.deepEqual(
    new Set(result.items[0].searchNames),
    new Set(["TEST BMW", "TEST Budget"]),
  );
  assert.equal(
    (await queryInbox(f.other, f.foreign, { status: "all", page: 1 })).total,
    0,
  );
  await db.query("DELETE FROM searches WHERE id=$1", [one]);
  assert.ok(
    (
      await queryInbox(f.tenant, f.owner, { status: "all", page: 1 })
    ).items[0].searchNames.includes("TEST BMW"),
  );
});

test("inbox reads are per person, idempotent and tenant scoped; bulk read leaves later arrivals unread", async () => {
  const f = await fixture();
  const search = await f.search("TEST Inbox");
  await runSearch(f.tenant, { sources: ["csv"] }, search);
  await Promise.all([
    setInboxRead(f.tenant, f.owner, f.listing.id, true),
    setInboxRead(f.tenant, f.owner, f.listing.id, true),
  ]);
  assert.equal((await inboxSummary(f.tenant, f.owner)).unread, 0);
  assert.equal((await inboxSummary(f.tenant, f.buyer)).unread, 1);
  await assert.rejects(setInboxRead(f.other, f.foreign, f.listing.id, true), {
    status: 404,
  });
  await setInboxRead(f.tenant, f.owner, f.listing.id, false);
  const first = (
    await queryInbox(f.tenant, f.owner, { status: "all", page: 1 })
  ).items[0];
  await upsertListings(f.tenant, [car("later")]);
  await runSearch(f.tenant, { sources: ["csv"] }, search);
  await db.query(
    "UPDATE inbox_items SET created_at=$2 WHERE tenant_id=$1 AND listing_id<>$3",
    [f.tenant, first.received_at + 10, f.listing.id],
  );
  await readAllInbox(f.tenant, f.owner, first.received_at);
  const unread = await queryInbox(f.tenant, f.owner, {
    status: "unread",
    page: 1,
  });
  assert.equal(unread.total, 1);
  assert.equal(unread.items[0].external_id, "later");
});

test("inbox pages and profile filters remain bounded and entries roll back with failed match transactions", async () => {
  const f = await fixture();
  const search = await f.search("TEST Page");
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO search_matches(tenant_id,search_id,listing_id,first_seen) VALUES($1,$2,$3,$4)",
        [f.tenant, search, f.listing.id, Date.now()],
      );
      await recordInboxMatches(
        tx,
        f.tenant,
        search,
        [f.listing.id],
        Date.now(),
      );
      throw new Error("TEST rollback");
    }),
  );
  assert.equal((await inboxSummary(f.tenant, f.owner)).unread, 0);
  await upsertListings(
    f.tenant,
    Array.from({ length: 26 }, (_, i) => car(`page-${i}`)),
  );
  await runSearch(f.tenant, { sources: ["csv"] }, search);
  const a = await queryInbox(f.tenant, f.owner, {
    status: "all",
    page: 1,
    searchId: search,
  });
  const b = await queryInbox(f.tenant, f.owner, {
    status: "all",
    page: 2,
    searchId: search,
  });
  assert.equal(a.total, 27);
  assert.equal(a.items.length, 24);
  assert.equal(b.items.length, 3);
  assert.equal(new Set([...a.items, ...b.items].map((i) => i.id)).size, 27);
  assert.equal(
    (
      await queryInbox(f.tenant, f.owner, {
        status: "all",
        page: 1,
        searchId: randomUUID(),
      })
    ).total,
    0,
  );
});

test("purchase ceiling is calculated server-side, persists cents and preserves legacy costs", async () => {
  const f = await fixture();
  const result = await saveListing(
    jsonRequest({
      salePrice: 20000,
      targetPrice: 16000,
      costs: 0,
      purchasePlan: costPlan,
      maxPurchaseCents: 999999999,
    }),
    f.tenant,
    f.listing.id,
  );
  assert.equal(result.calculation.maxPurchaseCents, 1550000);
  assert.equal(result.calculation.differenceCents, 150000);
  const stored = await getListing(f.tenant, f.listing.id);
  assert.equal(stored.purchasePlan?.repairs_cents, 100000);
  const changed = await saveListing(
    jsonRequest({ salePrice: 20000.99, costs: 123.45 }),
    f.tenant,
    f.listing.id,
  );
  assert.equal(changed.calculation.maxPurchaseCents, 1537754);
  assert.equal(
    (await getListing(f.tenant, f.listing.id)).purchasePlan?.fees_cents,
    30000,
  );
  await assert.rejects(
    saveListing(jsonRequest({ costs: 1 }), f.other, f.listing.id),
    { status: 404 },
  );
});

test("purchase drafts do not invent missing costs, zero is explicit and an impossible ceiling stays negative", async () => {
  const f = await fixture();
  const draft = await saveListing(
    jsonRequest({
      salePrice: 20000,
      costs: 0,
      purchasePlan: { ...costPlan, repairs: "" },
    }),
    f.tenant,
    f.listing.id,
  );
  assert.equal(draft.calculation.maxPurchaseCents, null);
  assert.equal(draft.calculation.missing, 1);
  const zeroPlan: PurchasePlan = {
    transport_cents: 0,
    repairs_cents: 0,
    preparation_cents: 0,
    fees_cents: 0,
    reserve_cents: 0,
    desired_profit_cents: 500,
  };
  assert.equal(
    calculatePurchase(
      { price_cents: 100, sale_price_cents: 400, costs_cents: 0 },
      zeroPlan,
    ).maxPurchaseCents,
    -100,
  );
  assert.equal(bookmarkSchema.safeParse({ costs: -1 }).success, false);
  assert.equal(bookmarkSchema.safeParse({ costs: false }).success, false);
  assert.equal(bookmarkSchema.safeParse({ salePrice: [] }).success, false);
  assert.equal(
    bookmarkSchema.safeParse({ purchasePlan: { fees: "1.001" } }).success,
    false,
  );
  assert.equal(
    bookmarkSchema.safeParse({ purchasePlan: { fees: "Infinity" } }).success,
    false,
  );
  await db.query(
    "DELETE FROM saved_listings WHERE tenant_id=$1 AND listing_id=$2",
    [f.tenant, f.listing.id],
  );
  assert.equal((await getListing(f.tenant, f.listing.id)).purchasePlan, null);
});

test("tasks accept only active same-company assignees and same-company vehicles", async () => {
  const f = await fixture();
  const input = {
    title: "TEST Call",
    assigneeId: f.buyer,
    listingId: f.listing.id,
    dueDate: berlinDate(),
  };
  assert.equal((await taskMembers(f.tenant)).length, 2);
  await assert.rejects(
    createTask(
      jsonRequest({ ...input, assigneeId: f.foreign }),
      f.tenant,
      f.owner,
    ),
    { status: 400 },
  );
  await assert.rejects(
    createTask(
      jsonRequest({ ...input, assigneeId: f.pending }),
      f.tenant,
      f.owner,
    ),
    { status: 400 },
  );
  await assert.rejects(
    createTask(
      jsonRequest({ ...input, listingId: f.foreignListing.id }),
      f.tenant,
      f.owner,
    ),
    { status: 404 },
  );
  const { id } = await createTask(jsonRequest(input), f.tenant, f.owner);
  assert.equal(
    (await queryTasks(f.tenant, f.buyer, { filter: "mine", page: 1 })).tasks[0]
      .id,
    id,
  );
  assert.equal(
    (await queryTasks(f.other, f.foreign, { filter: "open", page: 1 })).total,
    0,
  );
  await assert.rejects(
    db.query("UPDATE tasks SET assignee_id=$2 WHERE id=$1", [id, f.foreign]),
  );
  await assert.rejects(
    db.query("UPDATE tasks SET listing_id=$2 WHERE id=$1", [
      id,
      f.foreignListing.id,
    ]),
  );
});

test("task retries are idempotent and concurrent edits cannot silently overwrite a colleague", async () => {
  const f = await fixture();
  const input = {
    requestId: randomUUID(),
    title: "TEST Retry",
    assigneeId: f.owner,
    dueDate: berlinDate(),
  };
  const [a, b] = await Promise.all([
    createTask(jsonRequest(input), f.tenant, f.owner),
    createTask(jsonRequest(input), f.tenant, f.owner),
  ]);
  assert.equal(a.id, b.id);
  assert.equal((await taskSummary(f.tenant, f.owner)).open, 1);
  await assert.rejects(
    createTask(jsonRequest({ ...input, title: "Changed" }), f.tenant, f.owner),
    { status: 409 },
  );
  const updates = await Promise.allSettled(
    ["TEST A", "TEST B"].map((title) =>
      updateTask(jsonRequest({ ...input, title, version: 1 }), f.tenant, a.id),
    ),
  );
  assert.equal(updates.filter((r) => r.status === "fulfilled").length, 1);
  const failure = updates.find((r) => r.status === "rejected");
  assert.ok(failure?.status === "rejected" && failure.reason.status === 409);
  await changeTaskStatus(
    jsonRequest({ status: "done", version: 2 }),
    f.tenant,
    a.id,
  );
  assert.equal(
    (await queryTasks(f.tenant, f.owner, { filter: "done", page: 1 })).tasks[0]
      .version,
    3,
  );
  await assert.rejects(
    changeTaskStatus(
      jsonRequest({ status: "open", version: 3 }),
      f.other,
      a.id,
    ),
    { status: 404 },
  );
  await changeTaskStatus(
    jsonRequest({ status: "open", version: 3 }),
    f.tenant,
    a.id,
  );
  assert.equal((await taskSummary(f.tenant, f.owner)).open, 1);
});

test("task deadlines use Berlin calendar days, reject nonexistent dates and filter today/overdue/done", async () => {
  const f = await fixture();
  assert.equal(berlinDate(Date.parse("2026-11-10T23:30:00Z")), "2026-11-11");
  assert.equal(berlinDate(Date.parse("2026-07-01T22:30:00Z")), "2026-07-02");
  assert.equal(
    taskSchema.safeParse({
      title: "TEST",
      assigneeId: f.owner,
      dueDate: "2026-02-31",
    }).success,
    false,
  );
  for (const dueDate of ["2020-01-01", berlinDate(), "2099-12-31"]) {
    await createTask(
      jsonRequest({ title: "TEST Deadline", assigneeId: f.owner, dueDate }),
      f.tenant,
      f.owner,
    );
  }
  assert.equal(
    (await queryTasks(f.tenant, f.owner, { filter: "today", page: 1 })).total,
    1,
  );
  assert.equal(
    (await queryTasks(f.tenant, f.owner, { filter: "overdue", page: 1 })).total,
    1,
  );
  assert.equal(
    (await queryTasks(f.tenant, f.owner, { filter: "done", page: 1 })).total,
    0,
  );
  assert.deepEqual(await taskSummary(f.tenant, f.owner), {
    open: 3,
    mine: 3,
    overdue: 1,
  });
  const versions = await db.query<{ version: number }>(
    "SELECT version FROM schema_migrations ORDER BY version",
  );
  assert.equal(versions.at(-1)?.version, 5);
});
