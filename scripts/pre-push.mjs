#!/usr/bin/env node
/**
 * Pre-push gate: run the full verification before code leaves the machine.
 * This is the same suite CI runs, so a push that would turn CI red is caught
 * locally first. Skipped cleanly when dependencies aren't installed yet.
 */
import { log, run, hasLocalBin } from './lib/shell.mjs';

if (!hasLocalBin('turbo')) {
  log.skip('pre-push: dependencies not installed — skipping full verify.');
  process.exit(0);
}

const code = run('node', ['scripts/verify.mjs']);
if (code !== 0) {
  log.err('Push aborted — verification failed.');
  log.skip('(Bypass in a real emergency only: git push --no-verify)');
  process.exit(1);
}
process.exit(0);
