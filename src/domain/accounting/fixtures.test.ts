// Additional hand-derived fixtures of 07 §3. Each JSON file documents its derivation in `_comment`.
import { readdirSync } from 'node:fs';
import { FIXTURE_DIR, readFixture } from '../../../tests/support/fixtureLoader';
import { evaluate } from '../../../tests/support/runAssertions';

const files = readdirSync(FIXTURE_DIR).filter(
  (f) => f.endsWith('.json') && f !== 'example-01.json' && f !== 'delta-table.json',
);

const REQUIRED = [
  'reversal-chain',
  'transfers-single-platform-filter',
  'cross-period-bets',
  'empty-ledger',
  'negative-balance-diagnostic',
  'cash-out-above-and-below-stake',
  'void-after-settle',
  'bonus-forfeit-fee-refund',
  'tz-boundary',
  'max-amounts',
];

describe('additional accounting fixtures', () => {
  it('include every fixture required by 07 §3', () => {
    for (const name of REQUIRED) expect(files, name).toContain(`${name}.json`);
  });

  for (const file of files) {
    const raw = readFixture(file);
    describe(file, () => {
      it('documents its hand derivation', () => {
        expect(raw._comment?.length ?? 0).toBeGreaterThan(40);
      });
      raw.assertions.forEach((a, i) => {
        it(`assertion ${i + 1}: ${a.kind}`, () => {
          const checks = evaluate(raw, a);
          expect(checks.length).toBeGreaterThan(0);
          for (const c of checks) expect(c.actual, `${file} ${c.label}`).toBe(c.expected);
        });
      });
    });
  }
});
