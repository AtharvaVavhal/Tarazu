// Golden fixture of 02 §12 (EX-01 … EX-16). Expected values live in tests/fixtures/accounting/example-01.json;
// this file also guards that fixture against drifting from the markdown tables of the spec.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { localDateOf } from '../time';
import { platformDelta, bankDelta } from './contribution';
import { diagnostics } from './diagnostics';
import { betResults } from './bets';
import { evaluate } from '../../../tests/support/runAssertions';
import { readFixture, toLedgerData } from '../../../tests/support/fixtureLoader';

const raw = readFixture('example-01.json');
const spec = readFileSync(join(process.cwd(), '02_ACCOUNTING_SPEC.md'), 'utf8');

const EX_IDS = [
  'EX-01',
  'EX-02',
  'EX-03',
  'EX-04',
  'EX-05',
  'EX-06',
  'EX-07',
  'EX-08',
  'EX-09',
  'EX-10',
  'EX-11',
  'EX-12',
  'EX-13',
  'EX-14',
  'EX-15',
  'EX-16',
];

describe('example-01: every EX row is asserted', () => {
  it('fixture has at least one assertion for each of EX-01 … EX-16', () => {
    const covered = new Set(raw.assertions.map((a) => a.ex));
    for (const id of EX_IDS) expect(covered.has(id), id).toBe(true);
  });

  for (const a of raw.assertions) {
    it(`${a.ex ?? a.kind}: ${a.kind}${a.variant ? ` (${a.variant})` : ''}${a.platforms ? ` [${a.platforms.join(',')}]` : ''}`, () => {
      const checks = evaluate(raw, a);
      expect(checks.length).toBeGreaterThan(0);
      for (const c of checks) expect(c.actual, c.label).toBe(c.expected);
    });
  }
});

describe('example-01: integrity', () => {
  it('has no diagnostics findings, with or without the EX-16 correction', () => {
    expect(diagnostics(toLedgerData(raw))).toEqual([]);
    expect(diagnostics(toLedgerData(raw, 'correction'))).toEqual([]);
  });

  it('bet outcomes match §12.2', () => {
    const r = betResults(toLedgerData(raw));
    expect(r.get('B1')).toMatchObject({
      stake: 100000n,
      payout: 180000n,
      result: 80000n,
      outcome: 'WIN',
    });
    expect(r.get('B2')).toMatchObject({
      stake: 50000n,
      payout: 0n,
      result: -50000n,
      outcome: 'LOSS',
    });
    expect(r.get('B3')).toMatchObject({
      stake: 70000n,
      refund: 70000n,
      result: 0n,
      outcome: 'VOID',
    });
    expect(r.get('B4')).toMatchObject({
      stake: 40000n,
      payout: 0n,
      result: -40000n,
      outcome: 'LOSS',
    });
    expect(r.get('B5')).toMatchObject({
      stake: 30000n,
      payout: 90000n,
      result: 60000n,
      outcome: 'WIN',
    });
    expect(r.get('B1')?.commission).toBe(5000n);
  });
});

// ---- drift guard against the markdown tables in 02 §12 -------------------------------------------

function tableRows(heading: string): string[][] {
  const start = spec.indexOf(heading);
  if (start < 0) throw new Error(`Heading not found: ${heading}`);
  const rows: string[][] = [];
  for (const line of spec.slice(start).split('\n').slice(1)) {
    if (line.startsWith('#')) break;
    if (!line.startsWith('|')) {
      if (rows.length > 0) break;
      continue;
    }
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    rows.push(cells);
  }
  return rows.slice(1); // drop header
}

const rupees = (s: string): bigint => {
  const t = s.replace(/[,+\s]/g, '').replace('−', '-');
  if (t === '') return 0n;
  const [i = '0', f = '0'] = t.replace('-', '').split('.');
  const v = BigInt(i) * 100n + BigInt(f.padEnd(2, '0'));
  return t.startsWith('-') ? -v : v;
};
const mmdd = (instantMs: number) => localDateOf(instantMs, 'Asia/Kolkata').slice(5);

describe('example-01.json matches the 02 §12 markdown tables', () => {
  const data = toLedgerData(raw);

  it('§12.1 ledger: ids, dates, platform, type, amount, fee, links, and both deltas', () => {
    const rows = tableRows('### 12.1 Ledger');
    expect(rows).toHaveLength(data.entries.length);
    for (const [id, date, plat, typeCell, amount, fee, link, dPlat, dBank] of rows) {
      const e = data.entries.find((x) => x.id === id);
      expect(e, `entry ${id}`).toBeDefined();
      if (!e) continue;
      const m = /^([A-Z_]+)(?: \(([A-Z_]+)\))?$/.exec(typeCell ?? '');
      expect(e.type, id).toBe(m?.[1]);
      expect(e.feeKind, id).toBe(m?.[2] ?? null);
      expect(e.platformId, id).toBe(plat);
      expect(mmdd(e.occurredAt), id).toBe(date);
      expect(e.amount, `${id} amount`).toBe(rupees(amount ?? ''));
      expect(e.fee, `${id} fee`).toBe(rupees(fee ?? ''));
      expect(e.betId ?? e.transferGroupId ?? e.checkpointId ?? '', `${id} link`).toBe(link ?? '');
      expect(platformDelta(e), `${id} platform Δ`).toBe(rupees(dPlat ?? ''));
      expect(bankDelta(e), `${id} bank Δ`).toBe(rupees(dBank ?? ''));
    }
  });

  it('§12.2 bets: platform, placed/settled dates, status, stake, payout/refund', () => {
    const rows = tableRows('### 12.2 Bets');
    expect(rows).toHaveLength(data.bets.length);
    const results = betResults(data);
    for (const [id, plat, placed, status, settled, stake, payout, refund] of rows) {
      const b = data.bets.find((x) => x.id === id);
      expect(b, `bet ${id}`).toBeDefined();
      if (!b) continue;
      expect(b.platformId).toBe(plat);
      expect(mmdd(b.placedAt)).toBe(placed);
      expect(b.status).toBe(status);
      expect(mmdd(b.settledAt ?? 0)).toBe(settled);
      const r = results.get(id ?? '');
      expect(r?.stake, `${id} stake`).toBe(rupees(stake ?? ''));
      expect(r?.payout, `${id} payout`).toBe(/^0/.test(payout ?? '') ? 0n : rupees(payout ?? ''));
      expect(r?.refund, `${id} refund`).toBe(rupees(refund ?? ''));
    }
  });

  it('§12.3 expected values: every numeric expectation in the fixture appears in its EX row', () => {
    const rows = new Map(
      tableRows('### 12.3 Rows to assert').map((r) => [r[0], r.join(' | ').replace(/−/g, '-')]),
    );
    const fmt = (paise: bigint) => {
      const neg = paise < 0n;
      const abs = neg ? -paise : paise;
      const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return `${neg ? '-' : ''}${whole}.${(abs % 100n).toString().padStart(2, '0')}`;
    };
    let checked = 0;
    for (const a of raw.assertions.filter((x) => x.derived !== true)) {
      const text = rows.get(a.ex ?? '');
      expect(text, a.ex).toBeDefined();
      if (!text) continue;
      const values: [string, string][] = [];
      const collect = (k: string, v: unknown) => {
        if (v !== null && typeof v === 'object') {
          for (const [kk, vv] of Object.entries(v as Record<string, unknown>)) collect(kk, vv);
        } else if (typeof v === 'string' && /^-?\d+$/.test(v)) values.push([k, v]);
      };
      for (const [k, v] of Object.entries(a.expect)) collect(k, v);
      for (const [key, v] of values) {
        // Money values appear as rupees; counts/bps/zero are checked loosely.
        if (/Bps$/.test(key)) {
          expect(text, `${a.ex} ${key}`).toContain(v);
        } else if (/count|Count|wins|losses|betsPlaced/i.test(key)) {
          expect(text, `${a.ex} ${key}`).toMatch(new RegExp(`\\b${v}\\b`));
        } else if (BigInt(v) !== 0n) {
          const p = BigInt(v) < 0n ? -BigInt(v) : BigInt(v);
          const withDecimals = fmt(p);
          const whole = p % 100n === 0n ? fmt(p).replace(/\.00$/, '') : null;
          const found =
            text.includes(withDecimals) ||
            (whole !== null && new RegExp(`(?<![\\d,.])${whole}(?![\\d,]|\\.\\d)`).test(text));
          expect(found, `${a.ex} ${key}=${v} (${withDecimals}) in "${text}"`).toBe(true);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(30);
  });
});
