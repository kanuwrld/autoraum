# Autoraum

A minimal, self-hosted vehicle sourcing workspace for independent dealerships.
Search, evaluate a purchase, and assign the next step in one place.

German interface · Next.js / TypeScript · shadcn/ui · SQLite by default · ISC license

## Start locally

Requires **Node.js 24**, npm, and macOS or Linux. Use WSL2 on Windows.
No domain, cloud account, paid service, or marketplace account is required to run the app.

```sh
git clone https://github.com/kanuwrld/autoraum.git
cd autoraum
npm ci
npm run setup
npm run build
npm run local:service -- start
```

Open **[localhost:3000](http://localhost:3000)**. Read your generated login details
in `.local/access.txt` on your own machine; never commit or share this file.

- **Workspace owner:** search, import your inventory, manage purchases and team tasks.
- **Platform admin:** create separate workspaces, generate activation links, manage access and inspect worker/backup health.

Setup creates an empty database, random passwords and encryption keys. Running it again
preserves existing accounts and passwords. All runtime data stays in `.local/` unless
you configure a different database. The app binds to `127.0.0.1`.

```sh
npm run local:service -- status
npm run local:service -- stop
# Start again after a reboot; the local supervisor is not an OS startup service.
```

Change `APP_URL` in `.env.local` if port 3000 is occupied, then restart the service.
Both the web app and background worker run under the local supervisor.
The computer must remain awake for scheduled searches to run.

## What works

| Workflow          | Included                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------- |
| Search            | Filters, source status, pagination and saved search profiles                                  |
| Incoming vehicles | Scheduled searches, unread inbox, per-user read state                                         |
| Notifications     | In-app alerts and browser notifications with an open tab and permission                       |
| Purchasing        | Shortlist, notes, stages and a purchase ceiling from your target sale price, costs and margin |
| Team              | Tasks with assignee, deadline and status; owners and buyers; activation and recovery links    |
| Operations        | Workspace isolation, JSON export, worker health, daily local backups and restore verification |

The purchase calculator uses your assumptions; it does not estimate market value or tax liability.
There are no seeded vehicles, bundled customer accounts, email delivery, payment processing or analytics services.

## Where listings come from

**A new install starts empty.** CSV import works immediately with data you supply.
An empty [CSV header template](public/import-template.csv) is included.
You can also connect a supplier feed with a per-source token.

Public-page adapters are included for **AutoScout24, Kleinanzeigen, PKW.de, Autohero,
markt.de, Quoka and auto.de**. They are **off by default**. To enable them on an installation
with appropriate source permissions, set `PUBLIC_MARKETPLACE_SEARCH=1` in `.env.local`
and run `npm run local:service -- restart`.

The **mobile.de Search API** adapter needs separately obtained credentials. No credentials
or marketplace sessions are bundled. The code license does not grant rights to third-party
listings or photographs. Public sources may change, limit or block access; the UI reports
errors, partial results and cached data. See [Data sources](docs/DATA_SOURCES.md).

## Keep your data private

- `.env.local`, databases, passwords, backups, logs and test output are ignored by Git.
- Setup disables optional Next.js telemetry. There is no application telemetry or hosted control plane.
- The operator controls the database. Marketplace requests and listing images still contact third parties when used.
- This repository contains code and synthetic tests, not a working installation's data.

Read [Privacy](docs/PRIVACY.md) before sharing logs, screenshots or a fork.

## Develop and verify

```sh
npm run dev
# In a second terminal, if you need scheduled searches:
npm run worker

npm run check
npm run privacy:check
```

Stop the local service before starting development on the same port.
The tests use temporary databases and synthetic source responses; they do not contact vehicle marketplaces.

Optional browser acceptance tests (after `npm run build`):

```sh
python3 -m venv .venv
. .venv/bin/activate
pip install -r tests/requirements.txt
python -m playwright install chromium
npm run test:e2e
```

`npm run test:postgres` runs the contract suite against a disposable PostgreSQL 17 Docker container.
GitHub Actions checks lint, types, tests, production build, browser flows and publication hygiene.
Gitleaks checks the Git history for secrets. No runtime credentials are needed by CI.

## Self-hosting and backups

The quick start is a local installation, not a public hosted service. For a shared internet-facing
installation, configure your own HTTPS hostname, PostgreSQL, process supervision and backups.
Each business gets a workspace at `/w/<slug>` on the same installation; it does not need its own deployment.
See [Operations](docs/OPERATIONS.md). GitHub Pages cannot run this server application.

## License and contributions

[ISC](LICENSE). Contributions are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).
Report security issues using [SECURITY.md](SECURITY.md).
