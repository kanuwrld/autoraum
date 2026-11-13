# Contributing

Use Node.js 24 and the committed npm lockfile. Keep changes focused and follow the existing
TypeScript, React and shadcn/ui patterns.

Before opening a pull request:

```sh
npm ci
npm run check
npm run privacy:check
```

Run the browser acceptance suite for changes to user workflows. Add a meaningful regression test
for business logic or security fixes. Do not make marketplace network requests in tests;
use synthetic fixtures and an isolated database.

Use example addresses and fictitious vehicle IDs in fixtures. Never submit real credentials,
customer data, database snapshots, scraped inventories or screenshots of a private workspace.
Use a GitHub `noreply` commit email if you want to keep your personal email private.

Pull requests should explain what changed, why, which checks actually ran, and any changes to
environment variables, database migrations or authentication. Use short Conventional Commit titles.

See [SECURITY.md](SECURITY.md) for private vulnerability reports.
