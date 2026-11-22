#!/usr/bin/env node
/**
 * Commit-message validator (Conventional Commits).
 *
 * Invoked by the `commit-msg` git hook with the path to the commit message file.
 *
 * Behaviour:
 *   1. If commitlint is installed locally, delegate to it (single source of truth).
 *   2. Otherwise fall back to a built-in, zero-dependency validator that mirrors
 *      commitlint.config.cjs — so commits are still blocked on a bad message even
 *      before `pnpm install` has run.
 *
 * Exit code 0 = valid (commit proceeds). Non-zero = invalid (commit is aborted).
 */
import { readFileSync } from 'node:fs';
import { log, run, hasLocalBin, colors } from './lib/shell.mjs';

const TYPES = [
  'feat',
  'fix',
  'perf',
  'refactor',
  'docs',
  'test',
  'build',
  'ci',
  'chore',
  'style',
  'revert',
];
const SCOPES = ['web', 'api', 'worker', 'packages', 'infra', 'db', 'ci', 'release', 'deps', 'repo'];
const HEADER_MAX = 100;

const msgPath = process.argv[2];
if (!msgPath) {
  log.err('No commit message file passed to validator.');
  process.exit(1);
}

// Delegate to commitlint when available — keeps local and CI identical.
if (hasLocalBin('commitlint')) {
  const code = run('pnpm', ['exec', 'commitlint', '--edit', msgPath]);
  process.exit(code);
}

// ---- Built-in fallback validator ----------------------------------------
const raw = readFileSync(msgPath, 'utf8');
const lines = raw
  .split('\n')
  .filter((l) => !l.startsWith('#')) // strip git comment lines
  .join('\n')
  .trim()
  .split('\n');

const header = (lines[0] || '').trim();
const errors = [];

// Allow merge / revert / fixup commits through untouched.
const bypass = /^(Merge |Revert "|fixup!|squash!)/.test(header);

if (!bypass) {
  // type(scope)!: subject
  const re = /^(\w+)(?:\(([\w$.\-*/ ]+)\))?(!)?: (.+)$/;
  const m = header.match(re);

  if (!m) {
    errors.push(
      'Header must match "type(scope): subject", e.g. "feat(worker): add batch inserts".',
    );
  } else {
    const [, type, scope, , subject] = m;

    if (!TYPES.includes(type)) {
      errors.push(`Type "${type}" is not allowed. Use one of: ${TYPES.join(', ')}.`);
    }
    if (scope && !SCOPES.includes(scope)) {
      errors.push(
        `Scope "${scope}" is not allowed. Use one of: ${SCOPES.join(', ')} (or omit it).`,
      );
    }
    if (!subject || subject.trim().length === 0) {
      errors.push('Subject must not be empty.');
    }
    if (subject && subject.endsWith('.')) {
      errors.push('Subject must not end with a period.');
    }
    if (subject && /^[A-Z]/.test(subject)) {
      errors.push('Subject must start lower-case (no sentence-case / PascalCase).');
    }
  }

  if (header.length > HEADER_MAX) {
    errors.push(`Header is ${header.length} chars; keep it ≤ ${HEADER_MAX}.`);
  }

  // Body must be separated from the header by a blank line, when present.
  if (lines.length > 1 && lines[1].trim() !== '') {
    errors.push('Leave a blank line between the header and the body.');
  }
}

if (errors.length > 0) {
  const bar = (s) => (process.stdout.isTTY ? `${colors.red}${s}${colors.reset}` : s);
  console.error(`\n${bar('✗ Invalid commit message')}\n`);
  console.error(`  ${header || '(empty)'}\n`);
  for (const e of errors) console.error(`  • ${e}`);
  console.error('\n  Convention: https://www.conventionalcommits.org/');
  console.error('  Examples:');
  console.error('    feat(api): add sendCommand mutation with audit trail');
  console.error('    fix(worker): dedupe telemetry on (device_id, ts, metric)');
  console.error('    perf(api)!: switch reads to replica (BREAKING)\n');
  console.error('  Tip: run `pnpm commit` for a guided prompt.\n');
  process.exit(1);
}

log.ok('Commit message OK');
process.exit(0);
