#!/usr/bin/env node
/**
 * Full verification: format check → lint → typecheck → test → build.
 * Used by CI (ci.yml) and by the pre-push hook. Exits non-zero on the first
 * failure so a broken tree never reaches the remote or a green CI badge.
 */
import { log, run, hasLocalBin } from './lib/shell.mjs';

let failed = false;
function gate(name, cmd, args) {
  log.step(`» ${name}`);
  const code = run(cmd, args);
  if (code !== 0) {
    log.err(`${name} failed.`);
    failed = true;
    return false;
  }
  log.ok(`${name} passed.`);
  return true;
}

if (!hasLocalBin('turbo')) {
  log.err('Dependencies are not installed. Run `pnpm install` first.');
  process.exit(1);
}

if (hasLocalBin('prettier')) {
  gate('Format check', 'pnpm', ['exec', 'prettier', '--check', '.']);
}
gate('Lint', 'pnpm', ['turbo', 'run', 'lint']);
gate('Typecheck', 'pnpm', ['turbo', 'run', 'typecheck']);
gate('Test', 'pnpm', ['turbo', 'run', 'test']);
gate('Build', 'pnpm', ['turbo', 'run', 'build']);

if (failed) {
  log.err('\nVerification failed.');
  process.exit(1);
}
log.ok('\nAll checks passed.');
