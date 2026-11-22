/**
 * Commitlint configuration — Conventional Commits.
 *
 * This is the shared source of truth used by:
 *   - CI (.github/workflows/ci.yml → commitlint job on pull requests)
 *   - local editors / tooling that understand commitlint
 *
 * The local `commit-msg` git hook (scripts/validate-commit-msg.mjs) enforces
 * the same rules with zero dependencies so commits are validated even before
 * `pnpm install` has run. Keep the two in sync if you change the type/scope lists.
 *
 * Format:  type(scope): subject
 * Example: feat(worker): batch telemetry inserts into TimescaleDB
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat', // a new feature            -> minor version bump
        'fix', // a bug fix                 -> patch version bump
        'perf', // a performance improvement -> patch version bump
        'refactor', // neither fixes a bug nor adds a feature
        'docs', // documentation only
        'test', // adding or fixing tests
        'build', // build system or dependencies
        'ci', // CI configuration
        'chore', // maintenance, tooling
        'style', // formatting, no code change
        'revert', // reverts a previous commit
      ],
    ],
    // Scopes map to the monorepo layout. Empty scope is allowed for repo-wide changes.
    'scope-enum': [
      2,
      'always',
      [
        'web', // apps/web   — Next.js frontend
        'api', // apps/api   — GraphQL Yoga server
        'worker', // apps/worker — MQTT ingestion
        'packages', // shared types / config / env
        'infra', // docker, compose, nginx, observability
        'db', // migrations, schema
        'ci', // pipelines, workflows
        'release', // release tooling, changelog
        'deps', // dependency updates
        'repo', // repo-wide / tooling
      ],
    ],
    'scope-empty': [0], // allow commits with no scope
    'subject-case': [2, 'never', ['upper-case', 'pascal-case', 'start-case']],
    'subject-empty': [2, 'never'],
    'subject-full-stop': [2, 'never', '.'],
    'header-max-length': [2, 'always', 100],
    'body-leading-blank': [2, 'always'],
    'footer-leading-blank': [2, 'always'],
  },
};
