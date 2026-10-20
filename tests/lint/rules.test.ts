// M0 test-first item (08): the layering and float rules of 04 §3 must actually fire.
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';

const eslint = new ESLint({
  overrideConfigFile: 'eslint.config.js',
  // Virtual files are not in the TS project, so lint them without type information.
  overrideConfig: [tseslint.configs.disableTypeChecked],
});

async function messages(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => `${m.ruleId ?? 'parse'}: ${m.message}`);
}

describe('lint rules (04 §3)', () => {
  it('bans float constructs in domain code', async () => {
    for (const code of [
      'export const a = parseFloat("1.5");',
      'export const a = (1.5).toFixed(2);',
      'export const a = Math.round(1.5);',
      'export const a = Number("1");',
      'export const a = Number.parseFloat("1");',
    ]) {
      const m = await messages('src/domain/accounting/x.ts', code);
      expect(
        m.some((x) => x.startsWith('no-restricted-syntax')),
        code,
      ).toBe(true);
    }
  });

  it('allows Number(...) inside domain/money but still bans parseFloat/toFixed/Math.round', async () => {
    expect(await messages('src/domain/money/x.ts', 'export const a = Number(1n);')).toEqual([]);
    for (const code of ['parseFloat("1")', '(1).toFixed(2)', 'Math.round(1.5)']) {
      const m = await messages('src/domain/money/x.ts', `export const a = ${code};`);
      expect(
        m.some((x) => x.startsWith('no-restricted-syntax')),
        code,
      ).toBe(true);
    }
  });

  it('allows Number(...) in ui/charts only', async () => {
    expect(await messages('src/ui/charts/x.ts', 'export const a = Number(1n);')).toEqual([]);
    const m = await messages('src/features/x.ts', 'export const a = Number(1n);');
    expect(m.some((x) => x.startsWith('no-restricted-syntax'))).toBe(true);
  });

  it('forbids the domain layer from reading the clock or using randomness', async () => {
    for (const code of ['Date.now()', 'new Date()', 'Math.random()']) {
      const m = await messages('src/domain/accounting/x.ts', `export const a = ${code};`);
      expect(
        m.some((x) => x.startsWith('no-restricted-syntax')),
        code,
      ).toBe(true);
    }
    expect(await messages('src/domain/accounting/x.ts', 'export const a = new Date(0);')).toEqual(
      [],
    );
  });

  it('forbids domain from importing React, Supabase, or upper layers', async () => {
    for (const spec of [
      'react',
      '@supabase/supabase-js',
      '@/data/client',
      '@/ui/MoneyText',
      '@/features/x',
      '@/app/App',
    ]) {
      const m = await messages(
        'src/domain/accounting/x.ts',
        `import x from '${spec}';\nexport default x;`,
      );
      expect(
        m.some((x) => x.startsWith('no-restricted-imports')),
        spec,
      ).toBe(true);
    }
  });

  it('confines luxon to domain/time', async () => {
    const code = "import { DateTime } from 'luxon';\nexport const a = DateTime;";
    expect(
      (await messages('src/domain/accounting/x.ts', code)).some((x) =>
        x.startsWith('no-restricted-imports'),
      ),
    ).toBe(true);
    expect(await messages('src/domain/time/x.ts', code)).toEqual([]);
  });

  it('keeps data, features, and ui in their layers', async () => {
    const bad: [string, string][] = [
      ['src/data/x.ts', '@/features/a'],
      ['src/data/x.ts', '@/ui/a'],
      ['src/features/x.ts', '@/app/a'],
      ['src/ui/x.ts', '@/data/a'],
      ['src/ui/x.ts', '@/domain/accounting'],
    ];
    for (const [file, spec] of bad) {
      const m = await messages(file, `import x from '${spec}';\nexport default x;`);
      expect(
        m.some((x) => x.startsWith('no-restricted-imports')),
        `${file} <- ${spec}`,
      ).toBe(true);
    }
    const ok = await messages('src/ui/x.ts', "import x from '@/domain/money';\nexport default x;");
    expect(ok.some((x) => x.startsWith('no-restricted-imports'))).toBe(false);
  });

  it('bans any, non-null assertions, and console', async () => {
    const m1 = await messages('src/domain/x.ts', 'export const a: any = 1;');
    expect(m1.some((x) => x.includes('no-explicit-any'))).toBe(true);
    const m2 = await messages(
      'src/domain/x.ts',
      'declare const v: string | null;\nexport const a = v!;',
    );
    expect(m2.some((x) => x.includes('no-non-null-assertion'))).toBe(true);
    const m3 = await messages('src/features/x.ts', 'console.log(1);');
    expect(m3.some((x) => x.startsWith('no-console'))).toBe(true);
  });
});
