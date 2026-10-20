// bigint safety beyond 2^53 and the 04 §10 performance budget (benchmarked; generous bound to avoid CI flakes).
import { performance } from 'node:perf_hooks';
import { MAX_AMOUNT_PAISE } from '../money';
import { LedgerBuilder } from '../../../tests/support/ledgerBuilder';
import { metricsFor } from './metrics';
import { positionAt } from './position';

describe('INV-ACC-01: bounded per-entry amounts sum exactly beyond 2^53', () => {
  it('sums 9,008 max-size deposits (> 2^53 paise) without precision loss', () => {
    const b = new LedgerBuilder().addPlatform('A');
    const n = 9_008;
    for (let i = 0; i < n; i++) b.deposit('A', MAX_AMOUNT_PAISE, 0n, 1000 + i);
    const expected = MAX_AMOUNT_PAISE * BigInt(n); // 9,008e12 > 9,007,199,254,740,992
    expect(expected > 9_007_199_254_740_992n).toBe(true);
    const m = metricsFor(b.data(), { from: 0, to: 1_000_000 });
    expect(m.external.deposited).toBe(expected);
    expect(m.position.end.total.balance).toBe(expected);
    expect(positionAt(b.data(), 1_000_000).total.equity).toBe(expected);
    expect(m.external.netCash).toBe(-expected);
  });
});

describe('performance (04 §10)', () => {
  it('computes metricsFor and positionAt over 50,000 entries within budget×10 (soft guard; actuals printed)', () => {
    const b = new LedgerBuilder().addPlatform('A').addPlatform('B');
    b.opening('A', 1_000_000n, 0);
    b.opening('B', 1_000_000n, 0);
    for (let i = 0; i < 14_000; i++) {
      const p = i % 2 === 0 ? 'A' : 'B';
      b.deposit(p, 1000n, 10n, 10 + i);
      const id = b.placeBet(p, 100n, 10 + i);
      b.settle(id, i % 3 === 0 ? 0n : 250n, 10 + i);
      b.platformFee(p, 5n, 10 + i);
    }
    const data = b.data();
    expect(data.entries.length).toBeGreaterThanOrEqual(50_000);
    const t0 = performance.now();
    const m = metricsFor(data, { from: 0, to: 100_000 });
    const t1 = performance.now();
    const p = positionAt(data, 100_000);
    const t2 = performance.now();
    process.stdout.write(
      `\n[bench] ${data.entries.length} entries: metricsFor ${(t1 - t0).toFixed(1)} ms, positionAt ${(t2 - t1).toFixed(1)} ms (budgets 150 / 50)\n`,
    );
    expect(m.betting.settledCount).toBe(14_000);
    expect(p.total.balance).toBe(m.position.end.total.balance);
    expect(t1 - t0).toBeLessThan(1500);
    expect(t2 - t1).toBeLessThan(500);
  });
});
