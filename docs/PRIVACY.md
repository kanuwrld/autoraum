# Privacy and publication

## What is stored locally

The default installation stores user emails and password hashes, sessions, workspace
records, listings, notes, calculations, tasks and audit records in SQLite under `.local/`.
Provider credentials are encrypted using `DATA_ENCRYPTION_KEY`. The database itself
and local backups are **not encrypted at rest**; use disk encryption and protect OS access.

Setup generates `.env.local` and `.local/access.txt` with owner-only file permissions,
and creates `.local/` with owner-only directory permissions. The access file contains
initial passwords in plaintext for the operator. Once the passwords have been changed
and stored safely, the operator can remove that file.

No customer database, real listings, contact list, offer, private key, saved session,
local configuration or earlier private Git history is included in this public repository.
Examples and tests use synthetic records and reserved example addresses.

## What leaves the machine

| Action                                     | Network traffic                                                                  |
| ------------------------------------------ | -------------------------------------------------------------------------------- |
| Install dependencies                       | npm registry / dependency download hosts                                         |
| Use only local inventory                   | Browser communicates with this installation                                      |
| Search public sources (enabled by default) | Server sends search filters and its network IP to the selected platforms         |
| Configure mobile.de                        | Server sends queries and the configured API credentials to mobile.de             |
| View an external listing photo             | Browser requests the image from its host; the host sees the browser's network IP |
| Open an original listing                   | Browser navigates to that platform                                               |
| Supplier ingestion                         | Supplier sends data to the installation's authenticated ingestion endpoint       |

There is no application analytics, automatic email, remote error reporting or hosted control plane.
Setup writes `NEXT_TELEMETRY_DISABLED=1`, the [documented Next.js opt-out](https://nextjs.org/telemetry).
Browser notifications require permission and an open tab; no third-party push service is used.

Each installation generates independent credentials and a separate database. The one-command
launcher ignores unrelated application credentials inherited from the shell; it reads only
its own `.env.local`. No runtime request goes through the project author's accounts or server.
GitHub is contacted to download the code; npm is contacted to download dependencies.

Self-hosting and using no personal marketplace account **does not make network traffic anonymous**.
The network providing the installation is visible to data sources. Host on infrastructure you control
when you need separation from a personal computer; this repository does not provision or pay for hosting.

## Before publishing your changes

1. Run `git diff --cached` and `npm run privacy:check`.
2. Run `gitleaks git --redact` if Gitleaks is installed.
3. Confirm your commit identity uses a GitHub-provided `noreply` email; configure it for this repository only.
4. Share synthetic examples. Check screenshots, browser tabs, terminal output and file metadata too.

`.gitignore` does not remove files already tracked by Git, and a deleted file may remain in history.
Never attach `.env.local`, `.local/`, exports, backups or a copy of your production database to an issue.
Publication checks help detect mistakes but cannot prove the absence of all sensitive information.

A public repository is connected to its GitHub owner and public profile. The owner's username and
public profile information remain visible. A `noreply` commit email hides a private email in new
commits; it does not hide the account or rewrite earlier commits. See [GitHub's guidance](https://docs.github.com/en/account-and-profile/how-tos/email-preferences/setting-your-commit-email-address).

If a credential is exposed, revoke/rotate it first; deleting a file does not revoke access.
