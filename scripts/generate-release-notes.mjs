#!/usr/bin/env node
/**
 * Release-notes & version generator (zero dependencies).
 *
 * Reads the Conventional Commits since the previous tag, computes the next
 * semantic version, and produces grouped release notes + a CHANGELOG entry.
 *
 * Usage:
 *   node scripts/generate-release-notes.mjs            # notes only (no writes to version)
 *   node scripts/generate-release-notes.mjs --bump     # also write next version to package.json
 *   node scripts/generate-release-notes.mjs --from v0.2.0 --to HEAD
 *   node scripts/generate-release-notes.mjs --stdout   # print notes to stdout only
 *
 * Bump rules:  BREAKING CHANGE → major · feat → minor · fix/perf/refactor/revert → patch.
 *
 * CI integration: when GITHUB_OUTPUT / GITHUB_STEP_SUMMARY are set (GitHub
 * Actions), the computed version/tag/changed flag are exported and the notes
 * are appended to the job summary. Called on every push by release.yml.
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { capture } from './lib/shell.mjs';

// ---- args -----------------------------------------------------------------
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const doBump = has('--bump');
const stdoutOnly = has('--stdout');
const toRef = val('--to', 'HEAD');

// ---- section definitions --------------------------------------------------
const SECTIONS = [
  { key: 'feat', title: '🚀 Features' },
  { key: 'fix', title: '🐛 Bug Fixes' },
  { key: 'perf', title: '⚡ Performance' },
  { key: 'refactor', title: '♻️ Refactoring' },
  { key: 'revert', title: '⏪ Reverts' },
  { key: 'docs', title: '📝 Documentation' },
  { key: 'build', title: '📦 Build System' },
  { key: 'ci', title: '🤖 CI' },
  { key: 'test', title: '✅ Tests' },
  { key: 'style', title: '💅 Styles' },
  { key: 'chore', title: '🧹 Chores' },
];
const MINOR = new Set(['feat']);
const PATCH = new Set(['fix', 'perf', 'refactor', 'revert']);

// ---- repo url (for links) -------------------------------------------------
function repoSlug() {
  const url = capture('git', ['config', '--get', 'remote.origin.url']);
  if (!url) return null;
  const m = url.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/i);
  return m ? `${m[1]}/${m[2]}` : null;
}
const slug = repoSlug();
const commitUrl = (h) => (slug ? `https://github.com/${slug}/commit/${h}` : null);

// ---- previous tag + commit range -----------------------------------------
const fromRef =
  val('--from', '') || capture('git', ['describe', '--tags', '--abbrev=0', `${toRef}^`]) || '';
const range = fromRef ? `${fromRef}..${toRef}` : toRef;

// Record/field separators that won't appear in commit text.
const RS = '\x1e';
const FS = '\x1f';
const rawLog = capture('git', [
  'log',
  range,
  '--no-merges',
  `--pretty=format:%h${FS}%H${FS}%s${FS}%an${FS}%b${RS}`,
]);

const commits = rawLog
  .split(RS)
  .map((r) => r.trim())
  .filter(Boolean)
  .map((r) => {
    const [short, full, subject, author, body = ''] = r.split(FS);
    return { short, full, subject, author, body };
  });

// ---- parse conventional commits ------------------------------------------
const re = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;
const groups = Object.create(null);
const breaking = [];
let hasMinor = false;
let hasPatch = false;

for (const c of commits) {
  const m = c.subject.match(re);
  if (!m) continue;
  const [, type, scope, bang, desc] = m;
  const isBreaking = Boolean(bang) || /BREAKING CHANGE/.test(c.body);
  const entry = { ...c, type, scope, desc, isBreaking };

  (groups[type] ||= []).push(entry);
  if (isBreaking) breaking.push(entry);
  if (MINOR.has(type)) hasMinor = true;
  if (PATCH.has(type)) hasPatch = true;
}

// ---- compute next version -------------------------------------------------
// Baseline is the last released tag when present (tag-driven releases stay
// correct across repeated pushes); otherwise fall back to package.json.
const pkgPath = new URL('../package.json', import.meta.url);
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const tagSemver = fromRef.replace(/^v/, '');
const baseVersion = /^\d+\.\d+\.\d+$/.test(tagSemver) ? tagSemver : String(pkg.version);
const [maj, min, pat] = baseVersion.split('.').map((n) => parseInt(n, 10));

let bump = 'none';
if (breaking.length) bump = 'major';
else if (hasMinor) bump = 'minor';
else if (hasPatch) bump = 'patch';
else if (commits.length) bump = 'patch'; // docs/chore/etc still ship a release

const next =
  bump === 'major'
    ? `${maj + 1}.0.0`
    : bump === 'minor'
      ? `${maj}.${min + 1}.0`
      : bump === 'patch'
        ? `${maj}.${min}.${pat + 1}`
        : pkg.version;

const tag = `v${next}`;
const date = new Date().toISOString().slice(0, 10);
const changed = commits.length > 0;

// ---- render notes ---------------------------------------------------------
function render() {
  const out = [];
  const compare =
    slug && fromRef ? ` ([compare](https://github.com/${slug}/compare/${fromRef}...${tag}))` : '';
  out.push(`## ${tag} (${date})${compare}`, '');

  if (!changed) {
    out.push('_No changes since the previous release._', '');
    return out.join('\n');
  }

  if (breaking.length) {
    out.push('### ⚠️ BREAKING CHANGES', '');
    for (const e of breaking) {
      const note = (e.body.match(/BREAKING CHANGE:\s*([\s\S]+)/) || [, e.desc])[1].trim();
      out.push(`- ${e.scope ? `**${e.scope}:** ` : ''}${note.split('\n')[0]}`);
    }
    out.push('');
  }

  for (const s of SECTIONS) {
    const items = groups[s.key];
    if (!items || items.length === 0) continue;
    out.push(`### ${s.title}`, '');
    for (const e of items) {
      const scope = e.scope ? `**${e.scope}:** ` : '';
      const link = commitUrl(e.full) ? ` ([${e.short}](${commitUrl(e.full)}))` : ` (${e.short})`;
      out.push(`- ${scope}${e.desc}${link}`);
    }
    out.push('');
  }

  const authors = [...new Set(commits.map((c) => c.author))].sort();
  if (authors.length) out.push(`### 👥 Contributors`, '', authors.map((a) => `- ${a}`).join('\n'), '');

  return out.join('\n');
}

const notes = render();

// ---- outputs --------------------------------------------------------------
if (stdoutOnly) {
  process.stdout.write(notes + '\n');
} else {
  // Latest-release notes (used by CI to attach to a GitHub Release).
  writeFileSync('RELEASE_NOTES.md', notes + '\n');

  // Prepend to CHANGELOG.md, preserving history.
  const header = '# Changelog\n\nAll notable changes, generated from Conventional Commits.\n';
  let existing = '';
  if (existsSync('CHANGELOG.md')) {
    existing = readFileSync('CHANGELOG.md', 'utf8').replace(/^# Changelog[\s\S]*?\n\n/, '');
  }
  writeFileSync('CHANGELOG.md', `${header}\n${notes}\n\n${existing}`.trimEnd() + '\n');

  if (doBump && changed && bump !== 'none') {
    pkg.version = next;
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  }
}

// ---- GitHub Actions integration ------------------------------------------
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    [
      `version=${next}`,
      `tag=${tag}`,
      `bump=${bump}`,
      `changed=${changed}`,
      `previous=${fromRef}`,
    ].join('\n') + '\n',
  );
}
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `# Release notes — ${tag}\n\n${notes}\n`);
}

// ---- console summary ------------------------------------------------------
if (!stdoutOnly) {
  console.error(`Previous: ${fromRef || '(none)'}  →  Next: ${tag}  (bump: ${bump}, commits: ${commits.length})`);
}
