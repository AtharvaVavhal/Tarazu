// Env-leak gate of 04 §8 / 06 SEC-04: no secrets tracked, no service-role names exposed to the client.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const problems = [];

// 1. No tracked env files other than .env.example.
let tracked = [];
try {
  tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
} catch {
  console.warn('check-env: not a git checkout; skipping tracked-file check.');
}
for (const f of tracked) {
  const base = f.split('/').pop() ?? '';
  if (/^\.env(\..+)?$/.test(base) && base !== '.env.example')
    problems.push(`tracked env file: ${f}`);
}

// 2. Client-visible code/config must not name a service-role variable; the example file likewise.
const SERVICE = /service[_-]?role/i;
function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}
const clientFiles = [
  ...walk(join(root, 'src')),
  join(root, '.env.example'),
  join(root, 'vite.config.ts'),
  join(root, 'index.html'),
];
for (const f of clientFiles) {
  if (existsSync(f) && SERVICE.test(readFileSync(f, 'utf8')))
    problems.push(`service-role reference in client file: ${f.replace(root, '')}`);
}

// 3. Built output must not contain a service-role marker.
for (const f of walk(join(root, 'dist'))) {
  if (SERVICE.test(readFileSync(f, 'utf8')))
    problems.push(`service-role marker in build output: ${f.replace(root, '')}`);
}

// 4. Demo mode may never be enabled for a production build (AC-HEALTH-05).
if (
  process.env.NODE_ENV === 'production' &&
  /^(1|true|yes|on)$/i.test(process.env.VITE_ENABLE_DEMO ?? '')
) {
  problems.push('VITE_ENABLE_DEMO is truthy in a production build');
}

if (problems.length) {
  console.error('check-env failed:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log('check-env: ok');
