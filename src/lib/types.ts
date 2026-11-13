export const sourceNames = {
  mobile: "mobile.de",
  autoscout: "AutoScout24",
  kleinanzeigen: "Kleinanzeigen",
  pkw: "PKW.de",
  autohero: "Autohero",
  markt: "markt.de",
  quoka: "Quoka",
  autode: "auto.de",
  partner: "Partner-Feed",
  csv: "CSV-Import",
} as const;
export const publicSourceIds = [
  "autoscout",
  "kleinanzeigen",
  "pkw",
  "autohero",
  "markt",
  "quoka",
  "autode",
] as const;
export type PublicSource = (typeof publicSourceIds)[number];
export type BuiltInSource = keyof typeof sourceNames;
export type ExternalSourceId = `feed:${string}`;
export type Source = BuiltInSource | ExternalSourceId;
export type ExternalSource = {
  id: ExternalSourceId;
  name: string;
  website: string;
  enabled: boolean;
  lastFeedAt: number | null;
  listingCount: number;
};
export function sourceName(
  source: Source,
  externalSources: ExternalSource[] = [],
) {
  if (source.startsWith("feed:"))
    return (
      externalSources.find((s) => s.id === source)?.name || "Externer Anbieter"
    );
  return sourceNames[source as BuiltInSource];
}
export type Role = "platform_admin" | "owner" | "buyer";
export type Stage =
  "saved" | "contacted" | "appointment" | "purchased" | "rejected";
export const stageNames: Record<Stage, string> = {
  saved: "Merkliste",
  contacted: "Kontaktiert",
  appointment: "Besichtigung",
  purchased: "Gekauft",
  rejected: "Archiviert",
};
export const fuelNames: Record<string, string> = {
  PETROL: "Benzin",
  DIESEL: "Diesel",
  ELECTRICITY: "Elektro",
  HYBRID: "Hybrid",
  OTHER: "Andere",
};
export const transmissionNames: Record<string, string> = {
  AUTOMATIC_GEAR: "Automatik",
  MANUAL_GEAR: "Schaltgetriebe",
  SEMIAUTOMATIC_GEAR: "Halbautomatik",
};
export type Filters = {
  make?: string;
  model?: string;
  minPrice?: number;
  maxPrice?: number;
  minYear?: number;
  maxYear?: number;
  maxMileage?: number;
  fuel?: string;
  transmission?: string;
  location?: string;
  sources?: Source[];
  undamagedOnly?: boolean;
};
export type Tenant = {
  id: string;
  name: string;
  slug: string;
  active: number;
  created_at: number;
};
export type User = {
  id: string;
  tenant_id: string | null;
  email: string;
  name: string;
  role: Role;
};
export type Listing = {
  id: string;
  tenant_id: string;
  source: Source;
  external_id: string;
  url: string;
  title: string;
  make: string;
  model: string;
  price_cents: number;
  year: number | null;
  mileage: number | null;
  fuel: string;
  transmission: string;
  city: string;
  postal_code: string;
  seller_type: string;
  image_url: string | null;
  damaged: number | null;
  first_seen: number;
  last_seen: number;
  active: number;
  stage?: Stage | null;
  notes?: string;
  target_price_cents?: number | null;
  costs_cents?: number | null;
  sale_price_cents?: number | null;
  purchasePlan?: PurchasePlan | null;
};
export type PurchasePlan = {
  transport_cents: number | null;
  repairs_cents: number | null;
  preparation_cents: number | null;
  fees_cents: number | null;
  reserve_cents: number | null;
  desired_profit_cents: number | null;
};
export type TaskMember = { id: string; name: string };
export type Task = {
  id: string;
  tenant_id: string;
  listing_id: string | null;
  listing_title: string | null;
  title: string;
  notes: string;
  assignee_id: string;
  assignee_name: string;
  due_date: string;
  status: "open" | "done";
  version: number;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
};
export type InboxItem = Listing & {
  received_at: number;
  read_at: number | null;
  search_name: string;
  searchNames: string[];
};
export type InboxPage = { items: InboxItem[]; total: number; asOf: number };
export type TaskPage = { tasks: Task[]; total: number; today: string };
export function berlinDate(now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export type SavedSearch = {
  id: string;
  tenant_id: string;
  name: string;
  filters: Filters;
  enabled: number;
  interval_minutes: number;
  next_run_at: number | null;
  last_run_at: number | null;
  match_count: number;
};
export type SourceResult = {
  sourceId?: Source;
  source: string;
  status: "ok" | "disconnected" | "error" | "cached";
  count: number;
  message: string;
  truncated?: boolean;
  fetchedAt?: number;
  searchUrl?: string;
  stale?: boolean;
};
export type SearchRun = {
  id: string;
  search_id: string | null;
  search_name?: string;
  status: string;
  started_at: number;
  finished_at: number | null;
  matches: number;
  new_matches: number;
  results: SourceResult[];
};
export type Workspace = {
  asOf: number;
  tenant: Tenant;
  user: User;
  searches: SavedSearch[];
  listings: Listing[];
  total: number;
  stats: {
    listings: number;
    saved: number;
    searches: number;
    newToday: number;
  };
  providers: {
    publicSearch: boolean;
    mobile: boolean;
    mobileProject: boolean;
    feed: boolean;
    mobileUpdated: number | null;
    lastFeed: number | null;
  };
  runs: SearchRun[];
  schedulerHeartbeat: number | null;
  externalSources: ExternalSource[];
  members: TaskMember[];
  inbox: { unread: number; latestKey: string };
  taskStats: { open: number; mine: number; overdue: number };
};
