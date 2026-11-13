# Security

Autoraum is self-hosted. Operators are responsible for access to their host, HTTPS,
database backups, dependency updates and source permissions. The local quick start
binds to loopback and is not a public deployment recipe.

## Reporting a vulnerability

Use GitHub's **Report a vulnerability** option on this repository's Security tab:
[private advisory](https://github.com/kanuwrld/autoraum/security/advisories/new).
Do not post credentials, customer records or live exploit details in a public issue.
Include affected versions and a minimal reproduction using synthetic data.
If private reporting is unavailable on a fork, contact its maintainer through a private channel.

Security fixes target the current default branch; there is no guaranteed response time or hosted SLA.

## Built-in controls

- Server-side authentication and workspace authorization, role checks and session invalidation.
- Scrypt password hashes and hashed activation/session tokens.
- AES-256-GCM for stored integration credentials; the operator supplies the encryption key.
- Origin checks for browser writes, input validation, request size limits and rate limits.
- Bounded source requests, caching, backoff and honest source error status.
- Local backups with checksum, integrity and restore verification.

These controls and automated tests do not replace an independent audit. Never expose a development
server publicly. Do not publish database files, `.env.local`, access files or generated exports.
