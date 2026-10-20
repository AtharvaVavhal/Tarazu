// INV-ACC-12 / AC-BET-07: no accounting code may use odds or potential returns.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) yield p;
  }
}

describe('INV-ACC-12: the domain layer never references odds or potential winnings', () => {
  it('has no odds, potential-return, expected-value, or stake-suggestion identifiers', () => {
    const banned =
      /\b(odds|potentialWin\w*|potentialReturn\w*|expectedValue|kelly|martingale|suggestedStake)\b/i;
    const hits: string[] = [];
    for (const f of files('src/domain')) {
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (banned.test(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(hits).toEqual([]);
  });
});
