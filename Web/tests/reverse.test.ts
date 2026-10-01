import assert from 'node:assert/strict';
import test from 'node:test';
import { calculate, PayrollError } from '../src/payroll/calculator';
import { decimal as d } from '../src/payroll/decimal';
import { defaultInput, payPeriods, type PayFrequency, type PayrollInput, type PayrollResult } from '../src/payroll/models';
import { ReversePayrollError, solveGrossForNet, type NetBasis } from '../src/payroll/reverse';
import fixtures from './fixtures/regression-cases.json';

const metric = (result: PayrollResult, basis: NetBasis) => basis === 'annual' ? result.annual.net :
  basis === 'monthly' ? result.monthlyNet : result.currentPeriod.net;
function roundTrip(input: PayrollInput, basis: NetBasis): void {
  const forward = calculate(input);
  const target = metric(forward, basis).toFixed(2);
  const solved = solveGrossForNet(input, target, basis);
  assert.ok(solved.achievedNet.minus(target).abs().lte('0.01'), `${basis}: ${solved.achievedNet} differs from ${target}`);
  assert.equal(solved.annualSalary.decimalPlaces() <= 2, true);
  assert.ok(solved.annualSalary.gte(0) && solved.annualSalary.lte('100000000'));
  const actual = calculate({ ...input, incomeType: 'annualSalary', annualSalary: solved.annualSalary.toFixed(2) });
  assert.deepEqual(solved.result, actual);
  assert.ok(solved.achievedNet.eq(metric(actual, basis)));
  assert.ok(solved.targetNet.eq(target));
}

test('reverse default per-pay, annual and monthly targets reuse native regression figures', () => {
  const fixture = fixtures.cases.find(item => item.id === 'manitoba-65000-semi-monthly')!;
  const input = defaultInput();
  for (const [basis, path] of [['perPay', 'currentPeriod.net'], ['annual', 'annual.net'],
    ['monthly', 'monthlyNet']] as const) {
    const target = fixture.expected[path];
    assert.ok(target);
    const solved = solveGrossForNet(input, target, basis);
    assert.ok(solved.achievedNet.minus(target).abs().lte('0.01'));
    assert.ok(solved.annualSalary.minus('65000').abs().lte(5));
  }
});
test('reverse all pay frequencies supports the reconciled final cheque sawtooth', () => {
  for (const frequency of Object.keys(payPeriods) as PayFrequency[]) {
    const input = { ...defaultInput(), annualSalary: '65123.45', frequency,
      selectedPayPeriod: payPeriods[frequency] };
    roundTrip(input, 'perPay');
  }
});
test('reverse capped schedules use selected cheque and real annual total', () => {
  const input = { ...defaultInput(), annualSalary: '120000' };
  roundTrip(input, 'annual');
  roundTrip({ ...input, selectedPayPeriod: 24 }, 'perPay');
  const first = solveGrossForNet(input, '2500', 'perPay');
  const final = solveGrossForNet({ ...input, selectedPayPeriod: 24 }, '2500', 'perPay');
  assert.ok(!first.annualSalary.eq(final.annualSalary));
});
test('reverse fixed deductions searches past infeasible low salaries', () => {
  const input = defaultInput();
  input.deductions.rrsp = { isEnabled: true, mode: 'fixedPerPeriod', amount: '2700' };
  assert.throws(() => calculate(input), error => error instanceof PayrollError && error.code === 'excessiveDeductions');
  const solved = solveGrossForNet(input, '2000', 'perPay');
  assert.ok(solved.annualSalary.gt(input.annualSalary));
  assert.ok(solved.achievedNet.minus('2000').abs().lte('0.01'));
  assert.ok(solved.result.currentPeriod.rrsp.eq('2700'));
});
test('reverse keeps percentage deductions, benefits and independent employer savings', () => {
  const input = defaultInput();
  input.deductions.pension = { isEnabled: true, mode: 'percentOfGross', amount: '5' };
  input.deductions.health = { isEnabled: true, mode: 'fixedPerPeriod', amount: '50' };
  roundTrip(input, 'annual');
  const withoutMatch = solveGrossForNet(input, '2000', 'perPay');
  input.deductions.employerMatch = { isEnabled: true, mode: 'percentOfGross', amount: '100' };
  const withMatch = solveGrossForNet(input, '2000', 'perPay');
  assert.ok(withMatch.annualSalary.eq(withoutMatch.annualSalary));
  assert.ok(withMatch.result.currentPeriod.employerMatch.gt(0));
});
test('reverse does not mutate original input or parse inactive hourly drafts', () => {
  const input = defaultInput();
  input.incomeType = 'hourly';
  input.hourlyRate = '';
  input.hoursPerWeek = '-1';
  input.overtimeMultiplier = 'NaN';
  input.deductions.rrsp.amount = 'NaN';
  const snapshot = structuredClone(input);
  const solved = solveGrossForNet(input, '2034.56', 'perPay');
  assert.deepEqual(input, snapshot);
  assert.ok(solved.achievedNet.eq('2034.56'));
});
test('reverse rejects malformed targets and invalid active settings', () => {
  for (const target of ['', '0', '-1', 'NaN', '1.001', 'Infinity']) {
    assert.throws(() => solveGrossForNet(defaultInput(), target, 'perPay'), error =>
      error instanceof ReversePayrollError && error.code === 'invalidTarget');
  }
  const invalid = defaultInput();
  invalid.deductions.rrsp = { isEnabled: true, mode: 'percentOfGross', amount: '-1' };
  assert.throws(() => solveGrossForNet(invalid, '2000', 'perPay'), error =>
    error instanceof PayrollError && error.code === 'invalidValue');
  assert.throws(() => solveGrossForNet({ ...defaultInput(), selectedPayPeriod: 25 }, '2000', 'perPay'), error =>
    error instanceof PayrollError && error.code === 'invalidPayPeriod');
});
test('reverse rejects unreachable targets and unsupported percentage deductions clearly', () => {
  assert.throws(() => solveGrossForNet(defaultInput(), '100000001', 'annual'), error =>
    error instanceof ReversePayrollError && error.code === 'unreachableTarget');
  const excessivePercent = defaultInput();
  excessivePercent.deductions.health = { isEnabled: true, mode: 'percentOfGross', amount: '90' };
  assert.throws(() => solveGrossForNet(excessivePercent, '200', 'annual'), error =>
    error instanceof ReversePayrollError && error.code === 'unsupportedDeductions');
  const excessiveFixed = defaultInput();
  excessiveFixed.deductions.health = { isEnabled: true, mode: 'fixedPerPeriod', amount: '100000000' };
  assert.throws(() => solveGrossForNet(excessiveFixed, '2000', 'perPay'), error =>
    error instanceof ReversePayrollError && error.code === 'unreachableTarget');
});
test('reverse returned estimate has no fractional salary cents', () => {
  const solved = solveGrossForNet(defaultInput(), '2034.57', 'perPay');
  assert.ok(solved.annualSalary.times(100).eq(solved.annualSalary.times(100).floor()));
  assert.ok(d(solved.result.currentPeriod.net).minus('2034.57').abs().lte('0.01'));
});
