// M1-25b: one-time setup of the local GlitchTip (error tracking that accepts the Sentry SDKs).
// Start it first: `docker compose --profile errors up -d`. Then:
//
//   node scripts/glitchtip-setup.ts
//
// Creates the admin user (password generated into the root .env), the "designroom" organization,
// a team and two projects, and writes their DSNs into apps/web/.env (VITE_SENTRY_DSN) and
// apps/server/.env (SENTRY_DSN). All three .env files are git-ignored. Prints no secret.
// Safe to re-run: it reuses what exists. Never part of `pnpm test`.

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const GLITCHTIP = 'http://localhost:8000';
const ORG = 'designroom';
const out = (line: string) => process.stdout.write(`${line}\n`);

const readEnv = (file: string): Record<string, string> =>
  existsSync(file)
    ? Object.fromEntries(
        readFileSync(file, 'utf8')
          .split('\n')
          .filter((l) => /^[A-Z_]+=/.test(l))
          .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
      )
    : {};

/** Sets `key` in a .env file, replacing an older value, keeping every other line. */
const setEnv = (file: string, key: string, value: string) => {
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n') : [];
  const kept = lines.filter((l) => !l.startsWith(`${key}=`));
  while (kept.length && kept.at(-1) === '') kept.pop();
  kept.push(`${key}=${value}`, '');
  writeFileSync(file, kept.join('\n'));
};

// 1. The admin user: credentials in the root .env, the user created inside the container.
const rootEnv = join(ROOT, '.env');
let { GLITCHTIP_ADMIN_EMAIL: email, GLITCHTIP_ADMIN_PASSWORD: password } = readEnv(rootEnv);
if (!email || !password) {
  email = 'admin@designroom.localhost';
  password = randomBytes(18).toString('base64url');
  setEnv(rootEnv, 'GLITCHTIP_ADMIN_EMAIL', email);
  setEnv(rootEnv, 'GLITCHTIP_ADMIN_PASSWORD', password);
  out('Admin credentials generated into .env (GLITCHTIP_ADMIN_EMAIL / GLITCHTIP_ADMIN_PASSWORD).');
}
try {
  execFileSync(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      '-e',
      `DJANGO_SUPERUSER_EMAIL=${email}`,
      '-e',
      `DJANGO_SUPERUSER_PASSWORD=${password}`,
      'glitchtip',
      './manage.py',
      'createsuperuser',
      '--noinput',
    ],
    { cwd: ROOT, stdio: 'pipe' },
  );
  out(`Admin user created: ${email}`);
} catch (error) {
  const said = String((error as { stderr?: Buffer }).stderr ?? error);
  if (!/already (exists|taken)/i.test(said))
    throw new Error(
      `Could not create the admin (is GlitchTip running? docker compose --profile errors up -d)\n${said}`,
      { cause: error },
    );
  out(`Admin user already exists: ${email}`);
}

// 2. Log in: GlitchTip's browser API, session cookie + CSRF token.
const jar = new Map<string, string>();
const call = async (
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> => {
  const res = await fetch(GLITCHTIP + path, {
    method,
    headers: {
      'content-type': 'application/json',
      cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
      'x-csrftoken': jar.get('csrftoken') ?? '',
      referer: `${GLITCHTIP}/`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  for (const cookie of res.headers.getSetCookie()) {
    const [pair = ''] = cookie.split(';');
    jar.set(pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1));
  }
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) as unknown };
  } catch {
    return { status: res.status, json: text };
  }
};
type Named = { slug: string };
const list = (json: unknown): Named[] => (Array.isArray(json) ? (json as Named[]) : []);

await call('GET', '/_allauth/browser/v1/config'); // sets the CSRF cookie
const login = await call('POST', '/_allauth/browser/v1/auth/login', { email, password });
if (login.status !== 200)
  throw new Error(`Login failed (${login.status}): check .env against the admin user.`);

// 3. Organization, team, projects: reuse, else create.
if (!list((await call('GET', '/api/0/organizations/')).json).some((o) => o.slug === ORG))
  await call('POST', '/api/0/organizations/', { name: ORG });
if (
  !list((await call('GET', `/api/0/organizations/${ORG}/teams/`)).json).some((t) => t.slug === ORG)
)
  await call('POST', `/api/0/organizations/${ORG}/teams/`, { slug: ORG });
const existing = list((await call('GET', `/api/0/organizations/${ORG}/projects/`)).json);

const PROJECTS = [
  {
    name: 'designroom-web',
    platform: 'javascript-react',
    env: 'apps/web/.env',
    key: 'VITE_SENTRY_DSN',
  },
  { name: 'designroom-server', platform: 'node', env: 'apps/server/.env', key: 'SENTRY_DSN' },
];
for (const p of PROJECTS) {
  if (!existing.some((x) => x.slug === p.name))
    await call('POST', `/api/0/teams/${ORG}/${ORG}/projects/`, {
      name: p.name,
      platform: p.platform,
    });
  const keys = (await call('GET', `/api/0/projects/${ORG}/${p.name}/keys/`)).json as {
    dsn?: { public?: string };
  }[];
  const dsn = keys[0]?.dsn?.public;
  if (!dsn) throw new Error(`No DSN for ${p.name}`);
  setEnv(join(ROOT, p.env), p.key, dsn);
  out(`${p.name}: DSN written to ${p.env} (${p.key})`);
}
out(`\nDone. Restart the server and rebuild/restart the web app, then open ${GLITCHTIP}`);
