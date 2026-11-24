/**
 * Create (or reset the password of) a dashboard account.
 *
 *   pnpm --filter @relay/api create-user <email> <viewer|operator>
 *
 * The password is read from a hidden prompt (or the RELAY_PASSWORD env var for scripting), never
 * from the command line, so it doesn't end up in shell history or the process list.
 */
import pg from 'pg';
import { isRole } from '@relay/types';
import { loadDotEnv } from './env';
import { hashPassword, passwordProblem } from './password';

loadDotEnv();

async function readHidden(prompt: string): Promise<string> {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) {
    throw new Error('No terminal to prompt on. Set RELAY_PASSWORD to run this non-interactively.');
  }
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          stdin.setRawMode(false);
          stdout.write('\n');
          reject(new Error('Cancelled'));
          return;
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function main(): Promise<void> {
  const [emailArg, roleArg] = process.argv.slice(2);
  if (!emailArg || !roleArg || !isRole(roleArg)) {
    console.error('Usage: pnpm --filter @relay/api create-user <email> <viewer|operator>');
    process.exit(1);
  }
  const email = emailArg.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error(`✗ "${emailArg}" doesn't look like an email address.`);
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('✗ DATABASE_URL is not set (checked env and repo-root .env).');
    process.exit(1);
  }

  let password = process.env.RELAY_PASSWORD;
  if (password === undefined) {
    password = await readHidden('Password: ');
    const again = await readHidden('Repeat password: ');
    if (password !== again) {
      console.error('✗ Passwords do not match.');
      process.exit(1);
    }
  }
  const problem = passwordProblem(password);
  if (problem) {
    console.error(`✗ ${problem}.`);
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const hash = await hashPassword(password);
    const { rows } = await client.query<{ inserted: boolean }>(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role
       RETURNING (xmax = 0) AS inserted`,
      [email, hash, roleArg],
    );
    console.log(`✓ ${rows[0]?.inserted ? 'Created' : 'Updated'} ${roleArg} account ${email}`);
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(`✗ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
