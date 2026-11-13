# Data sources

Autoraum starts with no listings and no external credentials. Adapter availability
means the code exists; it is not a guarantee of live access, coverage or permission.

| Source                                     | How it works                                                                           | Default                                  |
| ------------------------------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------- |
| CSV                                        | Upload inventory through `Daten importieren`; use `public/import-template.csv`         | Available, empty                         |
| Supplier feeds                             | A supplier sends normalized JSON to `/api/ingest` with a scoped bearer token           | Requires configuration and data delivery |
| mobile.de                                  | Official Search API, using server-side operator credentials or workspace configuration | Disconnected                             |
| AutoScout24, Kleinanzeigen                 | Public page parsing                                                                    | Disabled                                 |
| PKW.de, Autohero, markt.de, Quoka, auto.de | Public page/JSON adapters                                                              | Disabled                                 |

## Public adapters

Set `PUBLIC_MARKETPLACE_SEARCH=1` in `.env.local` and restart web and worker to opt in.
Use only sources and data you have permission to access and reuse. The ISC code license
does not cover marketplace content or photos. No login cookies, browser profiles,
personal marketplace accounts or proxy services are included.

Requests run on the installation's server. Equivalent requests share a five-minute
cache across workspaces; shared leases limit concurrency to two requests per source.
Fetches have a 25-second deadline, response size limits and one- or two-page caps.
Sources enter a cooldown after blocks or rate limits. The app does not bypass login walls
or challenges. This is bounded research, not an exhaustive real-time market index.

The source status shows fresh/cached results, partial coverage, disconnected sources or
errors. A recent cached response may be used during an outage and is marked stale.
Availability and price must be checked in the original listing before a purchase.
Cross-platform VIN deduplication is not implemented.

## mobile.de

Obtain suitable Search API access separately. Configure `MOBILE_API_USERNAME` and
`MOBILE_API_PASSWORD` in `.env.local` for a shared installation only if your provider
agreement covers those workspaces. Alternatively, the platform admin can configure
workspace-specific access. Restart web and worker after changing environment variables.
Leaving credentials unset keeps the source disconnected.

## Supplier ingestion

In the platform admin's workspace data-source controls, create a named supplier and
save the one-time token. The website field is a reference link; entering a URL does
not connect or crawl that supplier automatically.

Send `POST /api/ingest` with `Authorization: Bearer <source-token>` and
`Content-Type: application/json`. For named suppliers, omit `source`; the token
determines the workspace and source identity.

```json
{
  "listings": [
    {
      "externalId": "EXAMPLE-1",
      "url": "https://inventory.example.com/vehicles/EXAMPLE-1",
      "title": "EXAMPLE BMW 320d",
      "make": "BMW",
      "model": "320d",
      "price": 18000,
      "year": 2020,
      "mileage": 80000,
      "fuel": "DIESEL",
      "transmission": "AUTOMATIC_GEAR",
      "active": true
    }
  ]
}
```

This is a synthetic format example, not bundled inventory. Up to 500 listings and
1.5 MB per request are accepted. The same source ID plus external ID updates an
existing listing. Imports are incremental: omitted records are not deleted.
Send `active: false` for a withdrawn vehicle. Source tokens can be rotated/revoked;
they cannot write to another supplier or workspace. Suppliers must arrange delivery
or a format adapter separately.

## Scheduled search

Saved profiles support 15, 30, 60, 180 and 1440-minute intervals. The worker checks due
profiles every minute. Search results create inbox items without repeating the same
vehicle for overlapping profiles. Notifications are in-app or browser notifications
while a workspace tab is open; there is no email, SMS or background web-push service.

An asleep or offline computer cannot fetch new data. A publicly hosted installation
needs its own always-running worker and monitoring; see [Operations](OPERATIONS.md).
