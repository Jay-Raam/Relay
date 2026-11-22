#!/usr/bin/env node
/**
 * Pre-commit gate.
 *
 * Enforces the rule: "if any error, warning, or bug is found, do not commit".
 *   1. Format staged files with Prettier and re-stage them.
 *   2. Lint    — `turbo run lint` (package lint scripts run eslint with 0 warnings).
 *   3. Typecheck — `turbo run typecheck` (tsc --noEmit per package).
 *   4. Tests   — `turbo run test` (unit tests). Skip with SKIP_TESTS=1.
 *
 * Each step is skipped *cleanly* when its tooling isn't installed yet (e.g. the
 * very first commit, before `pnpm install`), so the scaffold itself is
 * committable. Once dependencies and package scripts exist, every gate is live.
 * Any non-zero step aborts the commit.
 */
import { log, run, capture, hasLocalBin } from './lib/shell.mjs';

const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|ya?ml)$/i;

function stagedFiles() {
  const out = capture('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR']);
  return out ? out.split('\n').filter(Boolean) : [];
}

function fail(msg) {
  log.err(msg);
  log.err('Commit aborted. Fix the problems above and try again.');
  log.skip('(Bypass in a real emergency only: git commit --no-verify)');
  process.exit(1);
}

const files = stagedFiles();
if (files.length === 0) {
  log.skip('pre-commit: nothing staged.');
  process.exit(0);
}

log.step('Running pre-commit checks…');

// 1) Format staged files, then re-stage them.
if (hasLocalBin('prettier')) {
  const toFormat = files.filter((f) => EXT.test(f));
  if (toFormat.length > 0) {
    log.info('Formatting staged files (prettier)…');
    if (run('pnpm', ['exec', 'prettier', '--write', '--ignore-unknown', ...toFormat]) !== 0) {
      fail('Prettier failed.');
    }
    run('git', ['add', ...toFormat]);
    log.ok('Formatting applied');
  }
} else {
  log.skip('prettier not installed — run `pnpm install` to enable formatting.');
}

// 2) Lint (0 warnings allowed — warnings block the commit).
if (hasLocalBin('turbo')) {
  log.info('Linting (turbo run lint)…');
  if (run('pnpm', ['turbo', 'run', 'lint']) !== 0) {
    fail('Lint reported errors or warnings.');
  }
  log.ok('Lint clean');

  // 3) Typecheck.
  log.info('Type-checking (turbo run typecheck)…');
  if (run('pnpm', ['turbo', 'run', 'typecheck']) !== 0) {
    fail('Type errors found.');
  }
  log.ok('Types clean');

  // 4) Tests (unit) — opt out with SKIP_TESTS=1 for trivial commits.
  if (process.env.SKIP_TESTS === '1') {
    log.skip('Tests skipped (SKIP_TESTS=1).');
  } else {
    log.info('Running tests (turbo run test)…');
    if (run('pnpm', ['turbo', 'run', 'test']) !== 0) {
      fail('Tests failed (a bug was found).');
    }
    log.ok('Tests passed');
  }
} else {
  log.skip('turbo not installed — run `pnpm install` to enable lint/typecheck/test gates.');
}

log.ok('Pre-commit checks passed.');
process.exit(0);
