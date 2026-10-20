// Migration gate (INV-DB-14). Until M2 there are no migrations; once they exist this verifies naming order.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(new URL('..', import.meta.url).pathname, 'supabase', 'migrations');
const files = existsSync(dir)
  ? readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
  : [];
if (files.length === 0) {
  console.log('check-migrations: no migrations yet (arrive in M2).');
  process.exit(0);
}
const bad = files.filter((f) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(f));
if (bad.length) {
  console.error('check-migrations: bad migration filename(s):\n  ' + bad.join('\n  '));
  process.exit(1);
}
// TODO(M2): compare schema_version() in the latest migration with the migration count (INV-DB-14).
console.log(
  `check-migrations: ${files.length} migration file(s) named correctly. schema_version comparison is an M2 task.`,
);
