// Property tests (07 §3.1) over random valid ledgers produced by tests/support/ledgerArb.
import fc from 'fast-check';
import { oracle } from '../../../tests/support/oracle';
import {
  BASE,
  build,
  scenarioArb,
  toWindow,
  windowArb,
  type Scenario,
} from '../../../tests/support/ledgerArb';
import { platformDelta } from './contribution';
import { diagnostics } from './diagnostics';
import { metricsFor } from './metrics';
import { positionAt } from './position';
import type { LedgerData, Metrics } from './types';

const RUNS = { numRuns: 150 };

function flatten(
  value: unknown,
  prefix = '',
  out: Record<string, string | null> = {},
): Record<string, string | null> {
  if (value === null) out[prefix] = null;
  else if (typeof value === 'bigint' || typeof value === 'number' || typeof value === 'string')
    out[prefix] = String(value);
  else if (Array.isArray(value)) out[prefix] = JSON.stringify(value);
  else if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>))
      flatten(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}
const flat = (m: Metrics) => flatten(m);

const scenarioWithWindow = scenarioArb.chain((s) => {
  const { data, end } = build(s);
  return windowArb(end, s.openings.length).map((w) => ({ s, data, w, window: toWindow(w) }));
});

function shuffle<T>(xs: readonly T[], seed: number): T[] {
  const a = [...xs];
  let state = seed >>> 0 || 1;
  const rnd = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

describe('generated ledgers are valid (builder ⇄ engine agree on the lifecycle rules)', () => {
  it('INV-ACC-07/08/09/11/13: diagnostics are empty apart from the allowed negative-balance warning', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const { data } = build(s);
        const bad = diagnostics(data).filter((v) => v.rule !== 'NEGATIVE_BALANCE');
        expect(bad).toEqual([]);
      }),
      RUNS,
    );
  });
});

describe('accounting properties', () => {
  it('INV-ACC-02: balance equals the sum of platform deltas', () => {
    fc.assert(
      fc.property(scenarioWithWindow, ({ data, window }) => {
        const t = window.to - 1;
        const snap = positionAt(data, t);
        for (const p of data.platforms) {
          const expected = data.entries
            .filter((e) => e.platformId === p.id && e.occurredAt <= t)
            .reduce((s, e) => s + platformDelta(e), 0n);
          expect(snap.byPlatform[p.id]?.balance).toBe(expected);
        }
      }),
      RUNS,
    );
  });

  it('INV-ACC-04: every metric is invariant under permutation of entries, bets and platforms', () => {
    fc.assert(
      fc.property(scenarioWithWindow, fc.integer(), ({ data, w, window }, seed) => {
        const shuffled: LedgerData = {
          platforms: shuffle(data.platforms, seed),
          entries: shuffle(data.entries, seed + 1),
          bets: shuffle(data.bets, seed + 2),
          checkpoints: data.checkpoints ?? [],
        };
        const filter = { ...window, ...(w.subset ? { platformIds: w.subset } : {}) };
        const a = flat(metricsFor(data, filter));
        const b = flat(metricsFor(shuffled, filter));
        expect(b).toEqual(a);
      }),
      RUNS,
    );
  });

  it('INV-ACC-05: equity identity holds for any window and platform filter', () => {
    fc.assert(
      fc.property(scenarioWithWindow, ({ data, w, window }) => {
        const m = metricsFor(data, { ...window, ...(w.subset ? { platformIds: w.subset } : {}) });
        const delta = m.position.end.total.equity - m.position.start.total.equity;
        const rhs =
          m.neutral.openings +
          m.external.netDeposited +
          m.neutral.transfersNet +
          m.betting.grossBettingResult -
          m.betting.betCommissions -
          m.costs.platformFees +
          m.costs.bonusesNet +
          m.costs.adjustmentsNet;
        expect(delta).toBe(rhs);
      }),
      { numRuns: 300 },
    );
  });

  it('INV-ACC-06: all-in identity holds (allIn = netCash + ΔEquity − O − T)', () => {
    fc.assert(
      fc.property(scenarioWithWindow, ({ data, w, window }) => {
        const m = metricsFor(data, { ...window, ...(w.subset ? { platformIds: w.subset } : {}) });
        const delta = m.position.end.total.equity - m.position.start.total.equity;
        expect(m.allIn.total).toBe(
          m.external.netCash + delta - m.neutral.openings - m.neutral.transfersNet,
        );
        expect(m.allIn.total).toBe(
          m.betting.grossBettingResult -
            m.betting.betCommissions -
            m.costs.platformFees +
            m.costs.bonusesNet +
            m.costs.adjustmentsNet -
            m.external.frictionFees,
        );
      }),
      { numRuns: 300 },
    );
  });

  it('INV-ACC-03: appending an entry together with its reversal changes nothing', () => {
    fc.assert(
      fc.property(
        scenarioWithWindow,
        fc.record({
          kind: fc.constantFrom(
            'DEPOSIT',
            'WITHDRAWAL',
            'BONUS_CREDIT',
            'BONUS_FORFEIT',
            'FEE',
            'FEE_REFUND',
          ),
          amount: fc.bigInt({ min: 1n, max: 1_000_000n }),
          fee: fc.bigInt({ min: 0n, max: 1_000n }),
          at: fc.integer({ min: 0, max: 100 * 3_600_000 }),
          p: fc.nat(10),
        }),
        ({ data, w, window }, x) => {
          const platform = data.platforms[x.p % data.platforms.length]?.id ?? 'P0';
          const isFee = x.kind === 'FEE' || x.kind === 'FEE_REFUND';
          const hasFee = x.kind === 'DEPOSIT' || x.kind === 'WITHDRAWAL';
          const at = BASE + x.at;
          const orig = {
            id: 'ZZ1',
            platformId: platform,
            type: x.kind,
            amount: x.amount,
            fee: hasFee ? (x.kind === 'WITHDRAWAL' ? x.fee % (x.amount + 1n) : x.fee) : 0n,
            isReversal: false,
            reversesEntryId: null,
            betId: null,
            feeKind: isFee ? ('PLATFORM_FEE' as const) : null,
            transferGroupId: null,
            checkpointId: null,
            occurredAt: at,
            recordedAt: at + 1,
            externalRef: null,
            note: null,
          } as const;
          const rev = { ...orig, id: 'ZZ2', isReversal: true, reversesEntryId: 'ZZ1' } as const;
          const filter = { ...window, ...(w.subset ? { platformIds: w.subset } : {}) };
          const before = flat(metricsFor(data, filter));
          const after = flat(
            metricsFor({ ...data, entries: [...data.entries, orig, rev] }, filter),
          );
          expect(after).toEqual(before);
        },
      ),
      RUNS,
    );
  });

  it('INV-ACC-07: a balanced transfer changes no external, betting, cost, or all-in figure, and nothing at all over all platforms', () => {
    fc.assert(
      fc.property(
        scenarioWithWindow,
        fc.record({
          amount: fc.bigInt({ min: 1n, max: 1_000_000n }),
          at: fc.integer({ min: 0, max: 100 * 3_600_000 }),
          a: fc.nat(5),
          b: fc.nat(5),
        }),
        ({ data, w, window }, x) => {
          fc.pre(data.platforms.length >= 2);
          const from = data.platforms[x.a % data.platforms.length]?.id ?? 'P0';
          const to =
            data.platforms.filter((p) => p.id !== from)[x.b % (data.platforms.length - 1)]?.id ??
            'P1';
          const at = BASE + x.at;
          const leg = {
            fee: 0n,
            isReversal: false,
            reversesEntryId: null,
            betId: null,
            feeKind: null,
            transferGroupId: 'TXG',
            checkpointId: null,
            occurredAt: at,
            recordedAt: at,
            externalRef: null,
            note: null,
            amount: x.amount,
          } as const;
          const extra = [
            { ...leg, id: 'TX1', platformId: from, type: 'TRANSFER_OUT' as const },
            { ...leg, id: 'TX2', platformId: to, type: 'TRANSFER_IN' as const },
          ];
          const augmented: LedgerData = { ...data, entries: [...data.entries, ...extra] };

          // Over all platforms a transfer moves money between platforms only: every total is unchanged
          // (per-platform balances legitimately change).
          const all = { ...window };
          const totals = (r: Record<string, string | null>) =>
            Object.fromEntries(Object.entries(r).filter(([k]) => !k.includes('.byPlatform.')));
          expect(totals(flat(metricsFor(augmented, all)))).toEqual(
            totals(flat(metricsFor(data, all))),
          );

          const filter = { ...window, ...(w.subset ? { platformIds: w.subset } : {}) };
          const keep = (r: Record<string, string | null>) =>
            Object.fromEntries(
              Object.entries(r).filter(([k]) => /^(external|betting|costs|allIn)\./.test(k)),
            );
          expect(keep(flat(metricsFor(augmented, filter)))).toEqual(
            keep(flat(metricsFor(data, filter))),
          );
        },
      ),
      RUNS,
    );
  });

  it('partition additivity: additive metrics over [a,c) equal the sum over [a,b) and [b,c)', () => {
    const additive = [
      'external.deposited',
      'external.withdrawn',
      'external.frictionFeesOnDeposits',
      'external.frictionFeesOnWithdrawals',
      'external.netCash',
      'neutral.openings',
      'neutral.transfersNet',
      'betting.grossBettingResult',
      'betting.turnover',
      'betting.betCommissions',
      'betting.betsPlaced',
      'betting.settledCount',
      'betting.voidCount',
      'betting.wins',
      'betting.losses',
      'betting.pushes',
      'costs.platformFees',
      'costs.bonusesNet',
      'costs.adjustmentsNet',
      'allIn.total',
    ];
    fc.assert(
      fc.property(
        scenarioWithWindow,
        fc.integer({ min: 1, max: 1_000_000_000 }),
        fc.integer({ min: 1, max: 1_000_000_000 }),
        ({ data, w, window }, x, y) => {
          const a = window.from;
          const b = a + x;
          const c = b + y;
          const plats = w.subset ? { platformIds: w.subset } : {};
          const whole = flat(metricsFor(data, { from: a, to: c, ...plats }));
          const left = flat(metricsFor(data, { from: a, to: b, ...plats }));
          const right = flat(metricsFor(data, { from: b, to: c, ...plats }));
          for (const k of additive)
            expect(BigInt(whole[k] ?? '0'), k).toBe(
              BigInt(left[k] ?? '0') + BigInt(right[k] ?? '0'),
            );
        },
      ),
      RUNS,
    );
  });

  it('no floats: every output is a bigint, an integer count, or null', () => {
    fc.assert(
      fc.property(scenarioWithWindow, ({ data, w, window }) => {
        const m = metricsFor(data, { ...window, ...(w.subset ? { platformIds: w.subset } : {}) });
        const walk = (v: unknown, path: string) => {
          if (v === null || typeof v === 'bigint' || typeof v === 'string') return;
          if (typeof v === 'number') return expect(Number.isInteger(v), path).toBe(true);
          if (Array.isArray(v)) return;
          if (typeof v === 'object')
            for (const [k, vv] of Object.entries(v)) walk(vv, `${path}.${k}`);
        };
        walk({ ...m, window: undefined }, 'm');
      }),
      RUNS,
    );
  });

  it('oracle: a naive reference implementation of 02 agrees with the engine on every figure', () => {
    fc.assert(
      fc.property(scenarioWithWindow, ({ data, w, window }) => {
        const engine = flat(
          metricsFor(data, { ...window, ...(w.subset ? { platformIds: w.subset } : {}) }),
        );
        const expected = oracle({ data, platformIds: w.subset, ...window });
        for (const [k, v] of Object.entries(expected)) expect(engine[k], k).toBe(v);
      }),
      { numRuns: 300 },
    );
  });

  it('INV-ACC-15: scenario outputs are deterministic across repeated calls', () => {
    const s: Scenario = {
      openings: [1000n],
      commands: [
        { k: 'place', p: 0, stake: 100n, dt: 1 },
        { k: 'settle', bet: 0, payout: 300n, dt: 1 },
      ],
    };
    const { data, end } = build(s);
    const f = { from: BASE - 1, to: end + 1 };
    expect(flat(metricsFor(data, f))).toEqual(flat(metricsFor(data, f)));
  });
});
