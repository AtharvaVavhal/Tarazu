// Traceability gate of 07 §6: every spec ID referenced in code/tests must exist, and every ID of a
// completed milestone (scripts/milestones.json) must have a non-todo test.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = (f) => readFileSync(join(root, f), 'utf8');

const defs = new Set();
const add = (re, text) => {
  for (const m of text.matchAll(re)) defs.add(m[1]);
};
add(/^#{3,4} .*?\b(FR-\d{3})\b/gm, read('01_PRD.md'));
add(/^\| (AC-[A-Z]+-\d\d) \|/gm, read('01_PRD.md'));
add(/^\| (INV-ACC-\d\d) \|/gm, read('02_ACCOUNTING_SPEC.md'));
add(/^\| (EX-\d\d) \|/gm, read('02_ACCOUNTING_SPEC.md'));
add(/^\| (INV-DB-\d\d) \|/gm, read('03_DATABASE_SCHEMA.md'));
add(/^\| (SEC-\d\d) \|/gm, read('06_SECURITY_AND_PRIVACY.md'));

const ID_RE = /\b(AC-[A-Z]+-\d\d|INV-ACC-\d\d|INV-DB-\d\d|SEC-\d\d|EX-\d\d)\b/g;
const SCAN_DIRS = ['src', 'tests', 'supabase/tests', 'scripts'];
const SKIP = new Set(['node_modules', 'dist', 'coverage', 'playwright-report', 'test-results']);
const SELF = 'scripts/check-ac-traceability.mjs';

function* walk(dir) {
  const abs = join(root, dir);
  if (!existsSync(abs)) return;
  for (const name of readdirSync(abs)) {
    if (SKIP.has(name)) continue;
    const rel = join(dir, name);
    if (statSync(join(root, rel)).isDirectory()) yield* walk(rel);
    else yield rel;
  }
}

const isTestFile = (f) => /\.(test|spec)\.[tj]sx?$/.test(f) || /^supabase\/tests\/.*\.sql$/.test(f);
const refs = new Map(); // id -> { real: n, todo: n }
const unknown = [];
for (const dir of SCAN_DIRS) {
  for (const file of walk(dir)) {
    if (file === SELF || !['.ts', '.tsx', '.sql', '.json', '.mjs'].includes(extname(file)))
      continue;
    if (file.startsWith('tests/lint/')) continue; // lint-rule tests quote IDs inside source snippets
    const lines = read(file).split('\n');
    for (const line of lines) {
      for (const m of line.matchAll(ID_RE)) {
        const id = m[1];
        if (!defs.has(id)) unknown.push(`${file}: ${id}`);
        if (!isTestFile(file)) continue;
        const entry = refs.get(id) ?? { real: 0, todo: 0 };
        if (/\.todo\(|\.skip\(|\bxit\(|\bxtest\(/.test(line)) entry.todo += 1;
        else entry.real += 1;
        refs.set(id, entry);
      }
    }
  }
}

const milestones = JSON.parse(read('scripts/milestones.json'));
const completed = new Set(Object.values(milestones.completed).flat());
let failed = false;
if (unknown.length) {
  failed = true;
  console.error('Unknown spec IDs referenced (typo or stale):\n  ' + unknown.join('\n  '));
}
const missing = [...completed].filter((id) => !(refs.get(id)?.real > 0));
if (missing.length) {
  failed = true;
  console.error('Completed-milestone IDs without a non-todo test:\n  ' + missing.join('\n  '));
}
const unknownCompleted = [...completed].filter((id) => !defs.has(id));
if (unknownCompleted.length) {
  failed = true;
  console.error('milestones.json lists IDs not in the specs:\n  ' + unknownCompleted.join('\n  '));
}
const pending = [...defs].filter((id) => !id.startsWith('FR-') && !completed.has(id)).length;
console.log(
  `check-ac-traceability: ${defs.size} spec IDs defined, ${completed.size} required by completed milestones, ${pending} not yet required (warn-only).`,
);
process.exit(failed ? 1 : 0);
