# CI/CD pipeline

Implements the guide's flow:

> Lint + typecheck → unit tests → build images → integration tests → push → rolling deploy to staging → smoke tests → promote to prod. Every merge to main is deployable.

Three workflows, plus local git hooks that catch problems before they ever reach CI.

## Local gates (git hooks, via Husky)

Activated by `pnpm install` (initialises Husky) **plus** a one-time copy of the
hook sources into `.husky/` — see [One-time setup](#one-time-setup) below.

| Hook         | Runs                                                        | Blocks when…                                               |
| ------------ | ----------------------------------------------------------- | ---------------------------------------------------------- |
| `commit-msg` | `scripts/validate-commit-msg.mjs`                           | the commit message isn't a valid Conventional Commit       |
| `pre-commit` | `scripts/pre-commit.mjs` — format → lint → typecheck → test | any lint **error or warning**, type error, or failing test |
| `pre-push`   | `scripts/pre-push.mjs` → full `verify` (+ build)            | the full suite fails                                       |

Each gate **skips cleanly** when its tooling isn't installed yet, so the first
commit of a fresh clone works; once `pnpm install` has run, every gate is live.
Lint runs with zero warnings allowed — warnings block the commit, not just errors.

## `ci.yml` — on every pull request and push

- **commit-lint** (PRs) — validates every commit in the PR with commitlint.
- **verify** — format check → lint → typecheck → unit tests → build.
- **integration** — spins up the docker-compose stack (Postgres/Timescale, Redis,
  Mosquitto) and runs integration tests. Skips gracefully until `infra/compose` exists.

## `release.yml` — version + release notes on **every push**

1. Reads Conventional Commits since the last tag.
2. Computes the next semantic version (breaking → major, feat → minor, fix/perf → patch).
3. Writes `RELEASE_NOTES.md`, updates `CHANGELOG.md`, and prints the notes to the
   run summary + uploads them as an artifact — **for every push, on any branch**.
4. On `main`, when the version is new, creates the git tag and a GitHub Release.

Run it locally anytime:

```bash
pnpm release:notes          # preview notes for the next version
pnpm release:notes:bump     # also write the new version into package.json
node scripts/generate-release-notes.mjs --stdout   # print only
```

## `deploy.yml` — on release published

`build & push images → rolling deploy to staging → smoke tests → promote to prod`.
Staging and production are GitHub **Environments** — add a required reviewer to
`production` so promotion is a human gate. The deploy/smoke steps are marked
`TODO` for your infra commands (kubectl/Helm/compose). Rollouts are one node at a
time behind health checks, with expand–migrate–contract DB migrations.

## One-time setup

The canonical hook and workflow sources are committed under **`ci/`**. You copy
them into the directories git and GitHub read from, once:

```
ci/husky/{commit-msg,pre-commit,pre-push}   → .husky/
ci/workflows/{ci,release,deploy}.yml        → .github/workflows/
ci/pull_request_template.md                 → .github/pull_request_template.md
```

Windows (PowerShell), from `D:\ERP`:

```powershell
pnpm install
Copy-Item ci\husky\* .husky\ -Force
New-Item -ItemType Directory -Force .github\workflows | Out-Null
Copy-Item ci\workflows\* .github\workflows\ -Force
Copy-Item ci\pull_request_template.md .github\ -Force
```

macOS/Linux:

```bash
pnpm install
cp ci/husky/* .husky/
mkdir -p .github/workflows && cp ci/workflows/* .github/workflows/
cp ci/pull_request_template.md .github/
```

Requires Node ≥ 20 and pnpm ≥ 9 (see `.nvmrc` / `package.json`). After this,
`git commit` and `git push` run the local gates, and GitHub runs the pipelines.
