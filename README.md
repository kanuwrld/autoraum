# Autoraum

A minimal, self-hosted vehicle sourcing workspace for independent dealerships.
Search, evaluate a purchase, and assign the next step in one place.

German interface · Next.js / TypeScript · shadcn/ui · SQLite by default · ISC license

## Start locally

Requires **Node.js 24+**, npm, Git and curl on macOS or Linux (Windows: WSL2).
Allow about 2 GB of free disk space for dependencies and the first build.
No domain, cloud account, paid service, or marketplace account is required.

**Install and start with one command:**

```sh
curl -fsSL https://raw.githubusercontent.com/kanuwrld/autoraum/main/install.sh | bash
```

The [installer](install.sh) clones the public code into `~/autoraum`; it never overwrites
an unrelated directory. Review the script before running downloaded code. It installs
locked dependencies, generates private credentials, builds the app and starts web + worker.

**Already cloned the repository?** Run this from its directory:

```sh
npm run local
```

Open the URL printed by the launcher, usually **[localhost:3000](http://localhost:3000)**.
A new installation automatically chooses a free port between 3000 and 3020. Use
`npm run local -- --port 3181` to choose a different port on first setup. Read your generated login details
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

Repeated `npm run local` preserves your data and credentials and reuses unchanged dependencies
and builds. After changing source code or `.env.local`, run it again to rebuild/restart as needed.
To move an existing installation, change `APP_URL` in `.env.local` first.
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

**Search works immediately after a new installation:** the public-page adapters for
**AutoScout24, Kleinanzeigen, PKW.de, Autohero, markt.de, Quoka and auto.de** are enabled.
Sign in, choose your filters and click `Jetzt suchen`. No account, API key or cookie from
the project author is used. Each installation makes requests from its own machine.

An older installation's explicit setting is preserved. To enable its public sources:

```sh
npm run local -- --enable-public-search
```

To opt out, set `PUBLIC_MARKETPLACE_SEARCH=0` in `.env.local` and run `npm run local` again.
Enabled means the adapter will be tried; it does not promise that every source is reachable
or has matching vehicles. Source terms and permissions still apply.

The **mobile.de Search API** adapter needs separately obtained credentials. No credentials
or marketplace sessions are bundled. The code license does not grant rights to third-party
listings or photographs. Public sources may change, limit or block access; the UI reports
errors, partial results and cached data. See [Data sources](docs/DATA_SOURCES.md).

## Keep your data private

- `.env.local`, databases, passwords, backups, logs and test output are ignored by Git.
- Setup disables optional Next.js telemetry. There is no application telemetry or hosted control plane.
- The operator controls the database. Marketplace requests and listing images contact third parties from that user's own network.
- The launcher ignores unrelated application credentials inherited from the shell; only this installation's `.env.local` supplies app configuration. There is no author-owned gateway or shared account.
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
GitHub Actions checks lint, types, tests, production build, browser flows, publication hygiene
and a clean one-command installation with no preinstalled project dependencies.
Gitleaks checks the Git history for secrets. No runtime credentials are needed by CI.

## Self-hosting and backups

The quick start is a local installation, not a public hosted service. For a shared internet-facing
installation, configure your own HTTPS hostname, PostgreSQL, process supervision and backups.
Each business gets a workspace at `/w/<slug>` on the same installation; it does not need its own deployment.
See [Operations](docs/OPERATIONS.md). GitHub Pages cannot run this server application.

## License and contributions

[ISC](LICENSE). Contributions are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).
Report security issues using [SECURITY.md](SECURITY.md).
