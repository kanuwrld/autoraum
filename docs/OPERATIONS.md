# Operations

## Local installation

Use the README quick start. `npm run setup` creates `.env.local` with random secrets
and `.local/access.txt` with random initial passwords. It never seeds vehicle listings.
Set `ADMIN_EMAIL` / `ADMIN_NAME` before the first setup if you want custom admin identifiers;
email addresses are login identifiers, not a configured email delivery service.

`npm run local:service -- start` starts a loopback-only web server and worker with a
local Node supervisor. It restarts crashed child processes with bounded backoff.
Use `status`, `restart` or `stop` to manage it. Process state and logs live in `.local/`.
It requires `ps` on macOS/Linux and must be started again after an OS reboot.

Do not run two supervisors against the same directory. Do not run `next dev` on a port
already used by the production server. Restart after changing `.env.local`.

## Configuration

| Variable                                     | Purpose                                                              |
| -------------------------------------------- | -------------------------------------------------------------------- |
| `APP_URL`                                    | Exact browser origin used for links, cookies and write-origin checks |
| `SQLITE_PATH`                                | Local database path, default `.local/autoraum.sqlite`                |
| `ALLOW_LOCAL_DB=1`                           | Explicitly allows SQLite in a persistent local production process    |
| `DATABASE_URL`                               | Optional PostgreSQL connection; replaces SQLite when present         |
| `DATA_ENCRYPTION_KEY`                        | 64 hexadecimal characters for stored integration credentials         |
| `CRON_SECRET`                                | At least 32 characters; protects optional `/api/cron` calls          |
| `PUBLIC_MARKETPLACE_SEARCH`                  | `0` by default; set `1` only to opt in to public adapters            |
| `MOBILE_API_USERNAME`, `MOBILE_API_PASSWORD` | Optional operator-provided mobile.de Search API credentials          |
| `NEXT_TELEMETRY_DISABLED=1`                  | Opts out of optional Next.js telemetry                               |

Never put secrets in `NEXT_PUBLIC_*` variables. Preserve `DATA_ENCRYPTION_KEY` when
restoring a database: changing it makes existing encrypted integration credentials unreadable.
An environment template is optional; setup also fills blank secrets in a copied `.env.example`.

## Backups and recovery

The worker creates a SQLite snapshot at most once per day, verifies its checksum,
integrity and a restore to a temporary file, and retains the last 14 automatic copies.
The admin operations panel shows the latest verified backup and worker heartbeat.
Copies on the same disk are not protection against losing that disk.

```sh
npm run backup -- create
npm run backup -- verify .local/backups/automatic/BACKUP.sqlite
npm run backup -- restore .local/backups/automatic/BACKUP.sqlite .local/restored.sqlite
```

Replace `BACKUP.sqlite` with the filename printed by the create command.
Keep each `.sqlite` backup together with its `.sqlite.json` manifest. Restore refuses
to overwrite an existing destination. To use a restored copy, stop the service, set
`SQLITE_PATH=.local/restored.sqlite` in `.env.local`, then start again. Preserve the
previous database until the restored data has been verified. Store `.env.local` and
off-device backups securely; do not put them in Git.

The workspace owner can export business records as JSON. This is a portable export,
not a full database backup or an implemented JSON restore path.

## Updates

```sh
npm run backup -- create
npm run local:service -- stop
git pull --ff-only
npm ci
npm run db:migrate
npm run build
npm run local:service -- start
```

Review release changes first. Do not overwrite `.env.local` or run a destructive migration
without a verified backup. The current schema records migrations 1 through 5.

## Shared internet-facing deployment

The local supervisor intentionally refuses a public hostname. For a shared deployment:

1. Use PostgreSQL with restricted network access and your own backup/restore procedure.
2. Set `APP_URL` to your exact HTTPS origin and configure a reverse proxy for a private Node listener.
3. Run `npm run setup`, `npm run db:migrate` and `npm run build` with the server configuration.
4. Supervise `npm run start` and `npm run worker` as separate long-running processes using your host's service manager. The web listener defaults to port 3000; the proxy must forward to that port.
5. Monitor `/api/health`, authenticated admin operations, logs, worker heartbeat and PostgreSQL backups.

Do not expose development mode, database ports, `.local/` or the repository directory
as static files. A serverless host needs PostgreSQL and a suitable external scheduler;
its ephemeral filesystem cannot safely hold the local SQLite database.
Public hosting, a domain, TLS provisioning and source access are operator responsibilities,
not services provisioned by this repository.

One installation can hold several workspaces at `/w/<slug>`. An admin creates a business
and passes its one-use activation link to the owner. Access is isolated by workspace;
creating a business does not create a server, subdomain or billable resource.

## Checks

`npm run check` runs lint, TypeScript, unit/contract tests and a production build.
Browser tests create a separate temporary database and server. PostgreSQL contract
tests create and remove their own Docker container. They must not target a live database.

`npm run privacy:check` reviews tracked filenames, local home paths and contact emails.
CI also runs Gitleaks over Git history. Never publish runtime logs or test artifacts
without checking them yourself.
