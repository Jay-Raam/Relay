# Relay

Relay ingests device telemetry over MQTT, stores it as time-series, and serves it
to a live dashboard through a GraphQL API — with real-time updates and device
command control. Three independent paths (ingest, query, command) so a telemetry
flood never slows the dashboard.

Next.js + shadcn/ui frontend, GraphQL Yoga + Node.js backend, PostgreSQL +
TimescaleDB. Built for low failure rate and fast APIs. See the architecture guide
for the full design.

This repository is a **Turborepo + pnpm monorepo**:

```
apps/web        # Next.js frontend
apps/api        # GraphQL Yoga server
apps/worker     # MQTT ingestion worker
packages/*      # shared types, db migrations, Redis cache
infra/*         # dev scripts (mock publisher), hosting config
```

## Getting started

```powershell
# Windows PowerShell, from D:\ERP
pnpm install                              # installs deps + initialises husky (.husky/)
Copy-Item ci\husky\* .husky\ -Force       # activate the commit/push hooks
New-Item -ItemType Directory -Force .github\workflows | Out-Null
Copy-Item ci\workflows\* .github\workflows\ -Force      # install CI/CD workflows
Copy-Item ci\pull_request_template.md .github\ -Force
Copy-Item .env.example .env               # then fill in the hosted DB + MQTT credentials
```

No Docker needed: Relay uses a hosted TimescaleDB, a hosted MQTT broker and (optionally) a
hosted Redis. Follow
**[docs/HOSTED-SETUP.md](docs/HOSTED-SETUP.md)** to create them and fill in `.env`.

macOS/Linux equivalent:

```bash
pnpm install
cp ci/husky/* .husky/
mkdir -p .github/workflows && cp ci/workflows/* .github/workflows/
cp ci/pull_request_template.md .github/
cp .env.example .env
```

Requires **Node ≥ 20** and **pnpm ≥ 9** (`.nvmrc` pins the Node version).

## What it does today

- **Ingest** — MQTT worker validates every message and stores it in a TimescaleDB hypertable.
- **Query** — GraphQL API: `devices`, `latest`, `history`; per-request DataLoader batching, so a
  device list costs one cache lookup and at most one SQL query.
- **Live** — Redis holds the latest value per device and fans new readings out; the API
  streams them to the browser as a GraphQL subscription (Server-Sent Events). If Redis or the
  stream is down, the dashboard silently falls back to polling.
- **Dashboard** — device cards with Live/Stale status, click a device to chart it.

## Built with AI assistance

Most of this codebase was written with [Claude Code](https://claude.com/claude-code), directed
and reviewed by the repository owner. The tooling is set up so that does not lower the bar: every
change goes through an issue, a pull request, and the same CI (format, lint, typecheck, tests,
build) that human-written code does. Commit timestamps are real; nothing about the history is
staged.

> **Why the copy step?** The canonical hook and workflow sources live in `ci/` and
> you copy them into `.husky/` and `.github/` once. GitHub Actions requires
> workflows at `.github/workflows/`, and git runs hooks from `.husky/`. Keeping the
> originals in `ci/` means this scaffold can be delivered and reviewed before those
> auto-executing directories are populated — you activate them deliberately.

## Everyday commands

| Command              | What it does                                         |
| -------------------- | ---------------------------------------------------- |
| `pnpm lint`          | Lint all packages (0 warnings allowed)               |
| `pnpm typecheck`     | Type-check all packages                              |
| `pnpm test`          | Run unit tests                                       |
| `pnpm build`         | Build all packages                                   |
| `pnpm verify`        | Full suite: format → lint → typecheck → test → build |
| `pnpm format`        | Format the repo with Prettier                        |
| `pnpm commit`        | Guided Conventional Commit prompt (Commitizen)       |
| `pnpm release:notes` | Preview the next version + release notes             |

## How commits are protected

Every commit is checked locally by git hooks (installed by `pnpm install`):

- **Commit message** must be a valid [Conventional Commit](docs/COMMIT_CONVENTION.md)
  — the `commit-msg` hook rejects anything else.
- **Pre-commit** formats staged files, then runs lint (zero warnings), typecheck,
  and tests. **If any error, warning, or failing test is found, the commit is aborted.**
- **Pre-push** runs the full verification (the same thing CI runs) before code leaves your machine.

In a genuine emergency you can bypass with `git commit --no-verify`, but CI will
still enforce the same checks on the pull request.

## CI/CD

The full pipeline — CI on every PR/push and release notes on every push — is
documented in **[docs/CI-CD.md](docs/CI-CD.md)**.

## Documentation

- [docs/HOSTED-SETUP.md](docs/HOSTED-SETUP.md) — hosted TimescaleDB + MQTT setup, running the stack
- [docs/CI-CD.md](docs/CI-CD.md) — pipeline, hooks, release automation
- [docs/COMMIT_CONVENTION.md](docs/COMMIT_CONVENTION.md) — commit format + examples
- [CHANGELOG.md](CHANGELOG.md) — generated from commits
