# Commit convention

Commits follow [Conventional Commits](https://www.conventionalcommits.org/). This
is what lets the pipeline compute the next version and generate release notes
automatically — so the format is **enforced** by the `commit-msg` git hook and by
CI on every pull request.

## Format

```
type(scope): subject

[optional body]

[optional footer(s)]
```

- **type** — required, lower-case, one of the list below.
- **scope** — optional, from the list below (maps to the monorepo layout).
- **subject** — required, imperative mood, lower-case, no trailing period, ≤ 100 chars total header.

## Types → version bump

| Type       | Meaning                                   | Version bump |
| ---------- | ----------------------------------------- | ------------ |
| `feat`     | A new feature                             | **minor**    |
| `fix`      | A bug fix                                 | **patch**    |
| `perf`     | A performance improvement                 | **patch**    |
| `refactor` | Neither fixes a bug nor adds a feature    | patch        |
| `revert`   | Reverts a previous commit                 | patch        |
| `docs`     | Documentation only                        | —            |
| `test`     | Adding or fixing tests                    | —            |
| `build`    | Build system or dependencies              | —            |
| `ci`       | CI configuration                          | —            |
| `chore`    | Maintenance, tooling                      | —            |
| `style`    | Formatting, no code change                | —            |

A `!` after the type/scope, or a `BREAKING CHANGE:` footer, forces a **major** bump.

## Scopes

`web` · `api` · `worker` · `packages` · `infra` · `db` · `ci` · `release` · `deps` · `repo`

(Scope may be omitted for repo-wide changes.)

## Examples

```
feat(api): add sendCommand mutation with audit trail
fix(worker): dedupe telemetry on (device_id, ts, metric)
perf(api): read history from the replica, not the primary
refactor(web): extract device-card into a feature module
docs(repo): document the CI/CD pipeline
ci(release): tag and publish GitHub Release on main
feat(db)!: drop legacy readings table

BREAKING CHANGE: the v1 readings table is removed; use telemetry hypertable.
```

## Tips

- Run `pnpm commit` for a guided prompt (Commitizen) that builds a valid message.
- If a commit is rejected, read the error — it names exactly what to fix.
- Emergency bypass (avoid): `git commit --no-verify`.
