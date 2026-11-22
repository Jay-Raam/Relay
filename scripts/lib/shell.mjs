// Small zero-dependency helpers shared by the repo scripts.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
};

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (c, s) => (useColor ? `${c}${s}${colors.reset}` : s);

export const log = {
  info: (m) => console.log(`${paint(colors.blue, '›')} ${m}`),
  ok: (m) => console.log(`${paint(colors.green, '✓')} ${m}`),
  warn: (m) => console.log(`${paint(colors.yellow, '!')} ${m}`),
  err: (m) => console.error(`${paint(colors.red, '✗')} ${m}`),
  skip: (m) => console.log(`${paint(colors.gray, '·')} ${paint(colors.gray, m)}`),
  step: (m) => console.log(`\n${paint(colors.bold, m)}`),
};

/** Run a command, inheriting stdio. Returns the exit code (0 = success). */
export function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...opts,
  });
  if (res.error) return 1;
  return res.status ?? 1;
}

/** Run a command and capture stdout as a trimmed string. Empty on failure. */
export function capture(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    ...opts,
  });
  if (res.status !== 0 || res.error) return '';
  return (res.stdout || '').trim();
}

/** True when a dependency's binary is installed locally (node_modules/.bin). */
export function hasLocalBin(name) {
  const bin = process.platform === 'win32' ? `${name}.cmd` : name;
  return existsSync(join(process.cwd(), 'node_modules', '.bin', bin));
}

/** True when any file in the list exists at the repo root. */
export function anyExists(paths) {
  return paths.some((p) => existsSync(join(process.cwd(), p)));
}

/** Resolve the package runner available in this repo (pnpm preferred). */
export function pkgRunner() {
  return 'pnpm';
}
