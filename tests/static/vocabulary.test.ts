// Forbidden-vocabulary scan of 05 §9 (and "sync" claims, AC-HEALTH-07) over production source strings.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const FORBIDDEN: RegExp[] = [
  /\blucky\b/i,
  /\bhot streak\b/i,
  /\bwin big\b/i,
  /\bjackpot\b/i,
  /\bwin(?:ning)? (?:it )?back\b/i,
  /\brecover(?:y|ing)? (?:your )?losses\b/i,
  /\byou'?re due\b/i,
  /\bjust one more\b/i,
  /\bcongratulations\b/i,
  /\bconfetti\b/i,
  /\bcloud sync\b/i,
  /\bsynced\b/i,
  /\bbacked up\b/i,
];

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* sourceFiles(p);
    else if (/\.(ts|tsx|css|html)$/.test(name) && !/\.test\.tsx?$/.test(name)) yield p;
  }
}

describe('forbidden vocabulary (05 §9)', () => {
  it('does not appear in production source', () => {
    const hits: string[] = [];
    for (const file of sourceFiles('src')) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        for (const re of FORBIDDEN) if (re.test(line)) hits.push(`${file}:${i + 1} ${re}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
