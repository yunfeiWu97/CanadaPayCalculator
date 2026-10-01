import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import tax2026 from '../src/data/tax2026.json';
import fixtures from './fixtures/regression-cases.json';
import { basicPersonalAmount, bracketTax, calculate, PayrollError } from '../src/payroll/calculator';
import { Decimal, decimal as d, money, truncate } from '../src/payroll/decimal';
import {
  defaultInput, payPeriods, type Contribution, type ContributionKey, type PayFrequency,
  type PayrollInput, type TaxYear,
} from '../src/payroll/models';

type InputPatch = Partial<Omit<PayrollInput, 'deductions'>> & {
  deductions?: Partial<Record<ContributionKey, Partial<Contribution>>>;
};
function inputWith(patch: InputPatch = {}): PayrollInput {
  const input = defaultInput();
  Object.assign(input, { ...patch, deductions: input.deductions });
  for (const [key, value] of Object.entries(patch.deductions ?? {})) {
    if (value) Object.assign(input.deductions[key as ContributionKey], value);
  }
  return input;
}
function eq(actual: Decimal | number | unknown, expected: string | number, label?: string): void {
  if (actual instanceof Decimal) assert.ok(actual.eq(expected), `${label ?? 'amount'}: ${actual.toString()} != ${expected}`);
  else assert.equal(String(actual), String(expected), label ?? 'amount');
}
function valueAt(value: unknown, path: string): unknown {
  return path.split('.').reduce((item: unknown, key) => (item as Record<string, unknown>)[key], value);
}
function rejects(input: PayrollInput, code: string): void {
  assert.throws(() => calculate(input), error => error instanceof PayrollError && error.code === code);
}

// The native test file is the source of truth for regression figures. Keeping
// this check makes edited/copied fixtures fail if they drift from those cases.
test('canonical regression fixtures retain existing Swift literal assertions', () => {
  const source = readFileSync(new URL(`../../${fixtures.sourceFile}`, import.meta.url), 'utf8');
  for (const fixture of fixtures.cases) {
    const method = source.match(new RegExp(`func ${fixture.sourceTest}\\(\\)[\\s\\S]*?(?=\\r?\\n    func |\\r?\\n\\}\\s*$)`))?.[0];
    assert.ok(method, `Missing native source: ${fixture.sourceTest}`);
    const expected: Record<string, string> = {};
    const pattern = /XCTAssertEqual\(((?:result|pay)\.[\w.\[\]?]+),\s*(?:d\("([^\"]+)"\)|([\d_]+))\)/g;
    for (const match of method.matchAll(pattern)) {
      const count = payPeriods[(fixture.input as InputPatch).frequency ?? 'semiMonthly'];
      const path = match[1].replace(/^pay\./, 'currentPeriod.').replace(/^result\./, '')
        .replace(/\[(\d+)\]/g, '.$1').replace(/^periods\.count$/, 'periods.length')
        .replace(/periods\.last\?/g, `periods.${count - 1}`);
      expected[path] = match[2] ?? match[3].replaceAll('_', '');
    }
    assert.deepEqual(fixture.expected, expected, fixture.sourceTest);
  }
});
for (const fixture of fixtures.cases) {
  test(`native regression: ${fixture.sourceTest}`, () => {
    const result = calculate(inputWith(fixture.input as InputPatch));
    for (const [path, expected] of Object.entries(fixture.expected)) eq(valueAt(result, path), expected, path);
  });
}

test('reference salary is not special-cased', () => {
  const reference = calculate(defaultInput());
  const changed = calculate(inputWith({ annualSalary: '65001' }));
  assert.ok(!changed.currentPeriod.gross.eq(reference.currentPeriod.gross));
  assert.ok(!changed.currentPeriod.net.eq(reference.currentPeriod.net));
  eq(changed.annual.gross, '65001');
});
test('CPP2 threshold/timing and caps use the existing native schedule', () => {
  const below = calculate(inputWith({ annualSalary: '74600' }));
  const above = calculate(inputWith({ annualSalary: '74700' }));
  eq(below.annual.cpp2, 0);
  eq(above.annual.cpp2, 4);
  assert.ok(above.periods.slice(0, -1).every(period => period.cpp2.eq(0)));
  const high = calculate(inputWith({ annualSalary: '120000' }));
  assert.equal(high.periods.find(period => period.cpp2.gt(0))?.periodNumber, 15);
  assert.ok(!high.periods[0].net.eq(high.periods[23].net));
});
test('selected cheque uses its schedule; annual totals are independent of selection', () => {
  const first = calculate(inputWith({ annualSalary: '120000' }));
  const last = calculate(inputWith({ annualSalary: '120000', selectedPayPeriod: 24 }));
  assert.deepEqual(last.currentPeriod, last.periods[23]);
  assert.deepEqual(last.annual, first.annual);
  eq(last.currentPeriod.cpp, 0);
  assert.ok(first.currentPeriod.cpp.gt(0));
  assert.ok(!first.currentPeriod.cpp.eq(money(first.annual.cpp.div(24))));
});
test('RPP deductions reduce withholding without reducing CPP or EI', () => {
  const baseline = calculate(defaultInput());
  const rpp = calculate(inputWith({ deductions: { pension: { isEnabled: true, amount: '5' } } }));
  assert.ok(rpp.annual.incomeTax.lt(baseline.annual.incomeTax));
  eq(rpp.annual.cpp, baseline.annual.cpp.toString());
  eq(rpp.annual.ei, baseline.annual.ei.toString());
});
test('employer pension contributions are independent savings and never reduce net', () => {
  const baseline = calculate(defaultInput());
  const employer = calculate(inputWith({ deductions: { employerMatch: { isEnabled: true, amount: '5' } } }));
  assert.ok(employer.currentPeriod.employerMatch.gt(0));
  eq(employer.annual.net, baseline.annual.net.toString());
  eq(employer.annual.incomeTax, baseline.annual.incomeTax.toString());
  const pension = calculate(inputWith({ deductions: { pension: { isEnabled: true, amount: '5' } } }));
  const matched = calculate(inputWith({ deductions: {
    pension: { isEnabled: true, amount: '5' }, employerMatch: { isEnabled: true, amount: '5' },
  } }));
  eq(matched.annual.employerMatch, matched.annual.pension.toString());
  eq(matched.annual.net, pension.annual.net.toString());
  eq(matched.annual.incomeTax, pension.annual.incomeTax.toString());
});
test('after-tax/authorized pre-tax deductions keep native tax treatments', () => {
  const baseline = calculate(defaultInput());
  const after = calculate(inputWith({ deductions: {
    health: { isEnabled: true, mode: 'fixedPerPeriod', amount: '50' },
    otherAfterTax: { isEnabled: true, mode: 'fixedPerPeriod', amount: '20' },
  } }));
  eq(after.currentPeriod.incomeTax, baseline.currentPeriod.incomeTax.toString());
  eq(after.currentPeriod.net, baseline.currentPeriod.net.minus(70).toString());
  const before = calculate(inputWith({ deductions: {
    unionDues: { isEnabled: true, mode: 'fixedPerPeriod', amount: '30' },
    otherPreTax: { isEnabled: true, mode: 'fixedPerPeriod', amount: '20' },
  } }));
  eq(before.currentPeriod.annualizedTaxableIncome, baseline.currentPeriod.annualizedTaxableIncome.minus(1200).toString());
  assert.ok(before.currentPeriod.incomeTax.lt(baseline.currentPeriod.incomeTax));
  eq(before.annual.cpp, baseline.annual.cpp.toString());
  eq(before.annual.ei, baseline.annual.ei.toString());
  assert.equal(before.warnings.length, 1);
});
test('all frequencies preserve annual salary and reconcile every cheque', () => {
  for (const frequency of Object.keys(payPeriods) as PayFrequency[]) {
    const result = calculate(inputWith({ annualSalary: '65123.45', frequency }));
    assert.equal(result.periods.length, payPeriods[frequency]);
    eq(result.annual.gross, '65123.45');
    eq(result.annual.net, result.periods.reduce((total, pay) => total.plus(pay.net), d(0)).toString());
    for (const pay of result.periods) {
      eq(pay.gross, pay.net.plus(pay.totalDeductions).toString());
      eq(pay.gross, pay.regularGross.plus(pay.overtimeGross).toString());
      assert.ok(pay.net.gte(0));
    }
    const cheque = d(1234);
    eq(cheque.times(payPeriods[frequency]).div(payPeriods[frequency]), cheque.toString());
  }
  assert.notEqual(payPeriods.biweekly, payPeriods.semiMonthly);
});
test('statutory maxima stay capped across all frequencies', () => {
  for (const frequency of Object.keys(payPeriods) as PayFrequency[]) {
    const result = calculate(inputWith({ annualSalary: '500000', frequency }));
    eq(result.annual.cpp, '4230.45');
    eq(result.annual.cpp2, 416);
    eq(result.annual.ei, '1123.07');
    assert.ok(result.periods.every(pay => pay.cpp.gte(0) && pay.cpp2.gte(0) && pay.ei.gte(0)));
  }
});
test('sub-dollar salary never creates a negative final cheque', () => {
  const result = calculate(inputWith({ annualSalary: '0.26', frequency: 'weekly' }));
  assert.ok(result.periods.every(pay => pay.gross.gte(0) && pay.net.gte(0)));
});
test('below CPP exemption still pays EI', () => {
  assert.ok(calculate(inputWith({ annualSalary: '3000' })).annual.ei.gt(0));
});
test('BPA phaseout preserves native expected values', () => {
  const federal = tax2026.federal.basicPersonalAmount;
  eq(basicPersonalAmount('181440', federal), '16452');
  eq(basicPersonalAmount('219961', federal), '15640.50');
  eq(basicPersonalAmount('258482', federal), '14829');
  eq(basicPersonalAmount('400000', federal), '14829');
  const provincial = tax2026.provinces.manitoba.basicPersonalAmount;
  eq(basicPersonalAmount('200000', provincial), '15780');
  eq(basicPersonalAmount('300000', provincial), '7890');
  eq(basicPersonalAmount('400000', provincial), '0');
  eq(basicPersonalAmount('500000', provincial), '0');
  assert.ok(calculate(inputWith({ annualSalary: '300000' })).currentPeriod.provincialTax.gt(1000));
});
test('exclusive bracket boundaries preserve the published native payroll constants', () => {
  for (const [income, expected] of [['58523', '8193.22'], ['58523.01', '8193.21705'],
    ['117045', '20190.225'], ['117045.01', '20190.7026'], ['181440', '36933.40'], ['258482', '59274.78']]) {
    eq(bracketTax(income, tax2026.federal.brackets), expected);
  }
  for (const [income, expected] of [['47000', '5076'], ['47000.01', '5075.501275'],
    ['100000', '11833'], ['46999', '5075.892']]) {
    eq(bracketTax(income, tax2026.provinces.manitoba.brackets), expected);
  }
});
test('cent rounding is half-up and exemption truncation discards fractional cents', () => {
  eq(money('1.004'), '1.00');
  eq(money('1.005'), '1.01');
  eq(money('1.015'), '1.02');
  eq(truncate('145.833333'), '145.83');
  eq(truncate('291.666666'), '291.66');
});
test('inactive draft values are preserved and ignored', () => {
  const baseline = calculate(defaultInput());
  const inactive = inputWith({ hourlyRate: '-100', overtimeMultiplier: '', deductions: {
    pension: { amount: '-20' }, rrsp: { amount: 'NaN' }, employerMatch: { amount: '-1' },
  } });
  assert.deepEqual(calculate(inactive), baseline);
  assert.deepEqual(calculate(inputWith({ incomeType: 'hourly', overtimeMultiplier: '' })),
    calculate(inputWith({ incomeType: 'hourly' })));
});
test('negative/NaN/blank active income and excessive values are rejected', () => {
  for (const annualSalary of ['-1', 'NaN', '', '.', '100000001', 'Infinity']) {
    rejects(inputWith({ annualSalary }), 'invalidValue');
  }
  rejects(inputWith({ incomeType: 'hourly', hourlyRate: '-1' }), 'invalidValue');
});
test('active contribution percentages and excessive deductions are rejected', () => {
  for (const amount of ['-1', '101', '']) {
    rejects(inputWith({ deductions: { rrsp: { isEnabled: true, amount } } }), 'invalidValue');
  }
  rejects(inputWith({ deductions: { rrsp: { isEnabled: true, mode: 'fixedPerPeriod', amount: '2700' } } }),
    'excessiveDeductions');
});
test('unsupported province and invalid pay period are rejected', () => {
  rejects(inputWith({ province: 'ontario' }), 'unsupportedProvince');
  for (const selectedPayPeriod of [0, 25, 1.5, NaN]) rejects(inputWith({ selectedPayPeriod }), 'invalidPayPeriod');
});
test('unrealistic hours and invalid active overtime multiplier are rejected', () => {
  rejects(inputWith({ incomeType: 'hourly', hoursPerWeek: '169' }), 'invalidValue');
  rejects(inputWith({ incomeType: 'hourly', overtimeHours: '1', overtimeMultiplier: '0.5' }), 'invalidValue');
  rejects(inputWith({ incomeType: 'hourly', overtimeHours: '-1' }), 'invalidValue');
});
test('input persistence round-trips decimal strings and optional settings', () => {
  const input = inputWith({ annualSalary: '65001.27', selectedPayPeriod: 12, deductions: {
    pension: { isEnabled: true, amount: '4.25' },
    otherAfterTax: { isEnabled: true, mode: 'fixedPerPeriod', amount: '20.13' },
  } });
  assert.deepEqual(JSON.parse(JSON.stringify(input)), input);
  assert.deepEqual(calculate(JSON.parse(JSON.stringify(input))), calculate(input));
});
test('tax configuration is injected rather than hardcoded', () => {
  const custom: TaxYear = { ...structuredClone(tax2026), year: 2030,
    ei: { rate: '0', maximumInsurableEarnings: '0', maximumPremium: '0' } };
  const result = calculate(defaultInput(), custom);
  assert.equal(result.taxYear, 2030);
  eq(result.annual.ei, 0);
});
test('invalid order and mixed-year rate/maxima configurations are rejected', () => {
  const invalid: TaxYear = structuredClone(tax2026);
  invalid.federal.brackets.reverse();
  assert.throws(() => calculate(defaultInput(), invalid), error =>
    error instanceof PayrollError && error.code === 'invalidConfiguration');
  const stale: TaxYear = { ...structuredClone(tax2026), year: 2030,
    ei: { rate: '0.01', maximumInsurableEarnings: '68900', maximumPremium: '1123.07' } };
  assert.throws(() => calculate(defaultInput(), stale), error =>
    error instanceof PayrollError && error.code === 'invalidConfiguration');
});
