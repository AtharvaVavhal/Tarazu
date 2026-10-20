// Evaluates the `assertions` of a JSON fixture against the engine. Expected values come only from the
// fixture file (hand-derived from the spec); this runner never computes expectations.
import {
  betResults,
  checkpointLedgerBalance,
  checkpointStatus,
  diagnostics,
  metricsFor,
  positionAt,
} from '@/domain/accounting';
import { instant, toLedgerData, type RawAssertion, type RawFixture } from './fixtureLoader';

function get(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}
const str = (v: unknown): string => (typeof v === 'object' ? JSON.stringify(v) : String(v));
const show = (v: unknown): string | null | undefined =>
  v === null ? null : v === undefined ? undefined : str(v);

export interface Check {
  label: string;
  actual: string | null | undefined;
  expected: string | null;
}

function compareAll(a: RawAssertion, subject: unknown, prefix = ''): Check[] {
  return Object.entries(a.expect).map(([path, expected]) => ({
    label: `${a.ex ?? a.kind} ${prefix}${path}`,
    actual: show(get(subject, path)),
    expected: expected === null ? null : str(expected),
  }));
}

export function evaluate(raw: RawFixture, a: RawAssertion): Check[] {
  const data = toLedgerData(raw, a.variant);
  const platformIds = a.platforms;
  switch (a.kind) {
    case 'position': {
      const snap = positionAt(data, instant(a.at ?? ''), platformIds);
      return compareAll(a, snap);
    }
    case 'metrics': {
      const m = metricsFor(data, {
        ...(platformIds ? { platformIds } : {}),
        from: instant(a.from ?? ''),
        to: instant(a.to ?? ''),
      });
      return compareAll(a, m);
    }
    case 'identity': {
      const m = metricsFor(data, {
        ...(platformIds ? { platformIds } : {}),
        from: instant(a.from ?? ''),
        to: instant(a.to ?? ''),
      });
      const delta = m.position.end.total.equity - m.position.start.total.equity;
      const comps: Record<string, bigint> = {
        O: m.neutral.openings,
        DminusW: m.external.netDeposited,
        T: m.neutral.transfersNet,
        G: m.betting.grossBettingResult,
        Cb: -m.betting.betCommissions,
        Cp: -m.costs.platformFees,
        Bn: m.costs.bonusesNet,
        A: m.costs.adjustmentsNet,
      };
      const expectedComps = a.expect['components'] as Record<string, string>;
      const sum = Object.values(comps).reduce((x, y) => x + y, 0n);
      return [
        {
          label: `${a.ex} ΔEquity`,
          actual: String(delta),
          expected: String(a.expect['deltaEquity']),
        },
        { label: `${a.ex} Σcomponents = ΔEquity`, actual: String(sum), expected: String(delta) },
        ...Object.entries(expectedComps).map(([k, v]) => ({
          label: `${a.ex} component ${k}`,
          actual: String(comps[k]),
          expected: v,
        })),
      ];
    }
    case 'identityAllIn': {
      const m = metricsFor(data, {
        ...(platformIds ? { platformIds } : {}),
        from: instant(a.from ?? ''),
        to: instant(a.to ?? ''),
      });
      const delta = m.position.end.total.equity - m.position.start.total.equity;
      const rhs = m.external.netCash + delta - m.neutral.openings - m.neutral.transfersNet;
      return [
        {
          label: `${a.ex} allIn`,
          actual: String(m.allIn.total),
          expected: String(a.expect['allIn']),
        },
        {
          label: `${a.ex} allIn = netCash + ΔEquity − O − T`,
          actual: String(rhs),
          expected: String(m.allIn.total),
        },
        {
          label: `${a.ex} netCash`,
          actual: String(m.external.netCash),
          expected: String(a.expect['netCash']),
        },
        {
          label: `${a.ex} equityEnd`,
          actual: String(m.position.end.total.equity),
          expected: String(a.expect['equityEnd']),
        },
        {
          label: `${a.ex} openings`,
          actual: String(m.neutral.openings),
          expected: String(a.expect['openings']),
        },
        {
          label: `${a.ex} equity − openings`,
          actual: String(delta - m.neutral.openings),
          expected: String(a.expect['equityMinusOpenings']),
        },
      ];
    }
    case 'checkpoint': {
      const cp = data.checkpoints?.find((c) => c.id === a.checkpoint);
      if (!cp) throw new Error(`Unknown checkpoint ${a.checkpoint}`);
      const status = checkpointStatus(data, cp);
      const recomputed = checkpointLedgerBalance(data, cp.platformId, cp.asOf, cp.id);
      return compareAll(a, { ...status, recomputedLedger: recomputed });
    }
    case 'betResult': {
      const r = betResults(data).get(a.bet ?? '');
      return compareAll(a, r);
    }
    case 'diagnostics': {
      const rules = diagnostics(data)
        .map((v) => v.rule)
        .sort();
      return [
        {
          label: 'diagnostics rules',
          actual: JSON.stringify(rules),
          expected: JSON.stringify([...(a.expect['rules'] as string[])].sort()),
        },
      ];
    }
  }
}
