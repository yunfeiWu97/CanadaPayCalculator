import assert from 'node:assert/strict';
import test from 'node:test';
import { calculate, PayrollError, vacationBonusWithholding } from '../src/payroll/calculator';
import { decimal as d, money } from '../src/payroll/decimal';
import { defaultEarnings, defaultInput, payPeriods, type PayFrequency } from '../src/payroll/models';
import { solveGrossForNet } from '../src/payroll/reverse';

function payoutInput() {
  const input = defaultInput();
  input.earnings = defaultEarnings();
  input.earnings.vacationPay.isEnabled = true;
  return input;
}
test('new earnings disabled or absent retain existing payroll results', () => {
  const baseline = calculate(defaultInput());
  const oldInput = defaultInput();
  delete oldInput.earnings;
  assert.deepEqual(calculate(oldInput), baseline);
  const inactive = defaultInput();
  inactive.earnings!.controlledTips.amount = 'NaN';
  inactive.earnings!.vacationPay.amount = '-4';
  inactive.earnings!.statHolidayPay.amount = '';
  assert.deepEqual(calculate(inactive), baseline);
  assert.ok(baseline.annual.vacationGross.isZero());
  assert.ok(baseline.annual.vacationIncomeTax.isZero());
});
test('two supplied cheque earnings reproduce vacation amounts without including overtime', () => {
  const cases = [
    { annual: '23808.46', hours: '9.1137', overtime: '0.0434', regular: '911.37', ot: '4.34', tips: '86.33', vacation: '39.91' },
    { annual: '34869.38', hours: '13.1665', overtime: '0.2448', regular: '1316.65', ot: '24.48', tips: '125.03', vacation: '57.67' },
  ];
  for (const fixture of cases) {
    const input = payoutInput();
    input.linkedIncome = true;
    input.frequency = 'biweekly';
    input.annualSalary = fixture.annual;
    input.hoursPerWeek = fixture.hours;
    input.overtimeHours = fixture.overtime;
    input.overtimeMultiplier = '1';
    input.earnings!.controlledTips = { isEnabled: true, amount: fixture.tips };
    input.earnings!.vacationPay.includeControlledTips = true;
    const pay = calculate(input).currentPeriod;
    assert.ok(pay.regularGross.eq(fixture.regular));
    assert.ok(pay.overtimeGross.eq(fixture.ot));
    assert.ok(pay.controlledTipsGross.eq(fixture.tips));
    assert.ok(pay.vacationGross.eq(fixture.vacation));
    assert.ok(pay.gross.eq(d(fixture.regular).plus(fixture.ot).plus(fixture.tips).plus(fixture.vacation)));
    input.earnings!.vacationPay.includeControlledTips = false;
    const withoutTips = calculate(input).currentPeriod;
    assert.ok(withoutTips.vacationGross.eq(money(d(fixture.regular).times('0.04'))));
  }
});
test('linked annual and hourly drivers preserve regular/overtime vacation basis', () => {
  const hourly = payoutInput();
  hourly.linkedIncome = true;
  hourly.incomeType = 'hourly';
  hourly.overtimeHours = '5';
  hourly.frequency = 'biweekly';
  const fromHourly = calculate(hourly);
  const salary = { ...hourly, incomeType: 'annualSalary' as const, annualSalary: '58500' };
  const fromSalary = calculate(salary);
  assert.deepEqual(fromSalary, fromHourly);
  assert.ok(fromSalary.annual.regularGross.eq('48750'));
  assert.ok(fromSalary.annual.overtimeGross.eq('9750'));
  const unlinked = { ...salary, linkedIncome: false, hoursPerWeek: '', overtimeHours: 'NaN' };
  assert.ok(calculate(unlinked).annual.regularGross.eq('58500'));
  assert.ok(calculate(unlinked).annual.overtimeGross.isZero());
});
test('holiday pay defaults to the selected cheque and enters vacation eligible earnings', () => {
  const input = payoutInput();
  input.earnings!.statHolidayPay = { isEnabled: true, amount: '100', scope: 'selectedPeriod' };
  input.selectedPayPeriod = 10;
  const result = calculate(input);
  assert.ok(result.annual.statHolidayGross.eq(100));
  assert.ok(result.currentPeriod.statHolidayGross.eq(100));
  assert.ok(result.periods.every(pay => pay.statHolidayGross.eq(pay.periodNumber === 10 ? 100 : 0)));
  assert.ok(result.currentPeriod.vacationGross.eq(money(result.currentPeriod.regularGross.plus(100).times('0.04'))));
  input.earnings!.statHolidayPay.scope = 'everyPeriod';
  assert.ok(calculate(input).annual.statHolidayGross.eq(2400));
});
test('controlled tips use periodic withholding and pensionable/insurable gross', () => {
  const input = defaultInput();
  input.earnings!.controlledTips = { isEnabled: true, amount: '100' };
  const baseline = calculate(defaultInput());
  const tipped = calculate(input);
  assert.ok(tipped.annual.controlledTipsGross.eq(2400));
  assert.ok(tipped.currentPeriod.cpp.gt(baseline.currentPeriod.cpp));
  assert.ok(tipped.currentPeriod.ei.gt(baseline.currentPeriod.ei));
  assert.ok(tipped.currentPeriod.incomeTax.gt(baseline.currentPeriod.incomeTax));
  assert.ok(tipped.currentPeriod.vacationIncomeTax.isZero());
});
test('vacation payout income tax uses the official bonus difference rather than annualizing the payout', () => {
  const input = payoutInput();
  const result = calculate(input);
  const pay = result.currentPeriod;
  assert.ok(pay.vacationIncomeTax.gt(0));
  assert.ok(pay.incomeTax.eq(pay.federalTax.plus(pay.provincialTax).plus(pay.vacationIncomeTax)));
  const ordinary = calculate({ ...defaultInput(), annualSalary: '67600' });
  assert.ok(!pay.incomeTax.eq(ordinary.currentPeriod.incomeTax));
  const currentNetBonus = pay.vacationGross.minus(money(pay.cppEnhancedTaxDeduction.times(pay.vacationGross).div(pay.gross)));
  const factors = {
    periodicTaxableIncome: pay.annualizedTaxableIncome, currentGross: pay.vacationGross,
    currentTaxableIncome: currentNetBonus, priorTaxableIncome: '0',
    annualRegularBaseCPP: d('152.47').times(24).times(d('0.0495').div('0.0595')),
    annualRegularEI: d('44.15').times(24),
    currentBaseCPP: pay.cpp.minus('152.47').times(d('0.0495').div('0.0595')),
    currentEI: pay.ei.minus('44.15'), priorBaseCPP: '0', priorEI: '0',
    annualPeriodicGross: pay.regularGross.times(24), priorGross: '0',
  };
  assert.ok(pay.vacationIncomeTax.eq(vacationBonusWithholding(factors).total));
  assert.equal(result.warnings.length, 2);
});
test('CRA T4127 regular bonus worked example retains the published federal withholding', () => {
  // Official January 2026 example: $1,000 weekly wages, $2,500 current
  // bonus, $1,500 prior bonus; F5A=$9.81, F5B=$24.52, prior F5B=$14.60.
  const result = vacationBonusWithholding({
    periodicTaxableIncome: d(1000).minus('9.81').times(52),
    currentGross: '2500', currentTaxableIncome: d(2500).minus('24.52'),
    priorTaxableIncome: d(1500).minus('14.60'),
    annualRegularBaseCPP: money(d('55.50').times(d('0.0495').div('0.0595'))).times(52),
    annualRegularEI: d('16.30').times(52),
    currentBaseCPP: d('148.75').times(d('0.0495').div('0.0595')),
    currentEI: '40.75', priorBaseCPP: d('89.25').times(d('0.0495').div('0.0595')),
    priorEI: '24.45', annualPeriodicGross: '52000', priorGross: '1500',
  });
  assert.ok(money(result.federalDifference).eq('323.54'));
});
test('bonus withholding responds to current/prior payouts crossing a tax bracket', () => {
  const common = {
    periodicTaxableIncome: '58400', currentGross: '200', currentTaxableIncome: '200',
    annualRegularBaseCPP: '0', annualRegularEI: '0', currentBaseCPP: '0', currentEI: '0',
    priorBaseCPP: '0', priorEI: '0', annualPeriodicGross: '58400', priorGross: '0',
  };
  const crossing = vacationBonusWithholding({ ...common, priorTaxableIncome: '0' });
  const higher = vacationBonusWithholding({ ...common, priorTaxableIncome: '1000', priorGross: '1000' });
  assert.ok(higher.total.gt(crossing.total));
  assert.ok(crossing.total.gt(d(200).times('0.14').plus(d(200).times('0.1275'))));
});
test('low annual income applies the CRA combined 15% vacation withholding', () => {
  const input = payoutInput();
  input.annualSalary = '3000';
  const result = calculate(input);
  for (const pay of result.periods) {
    assert.ok(pay.vacationIncomeTax.eq(money(pay.vacationGross.times('0.15'))));
    assert.ok(pay.federalTax.isZero() && pay.provincialTax.isZero());
  }
  assert.ok(result.annual.vacationIncomeTax.eq('18'));
  assert.ok(result.annual.incomeTax.eq(result.annual.vacationIncomeTax));
});
test('same-cheque vacation shares one CPP exemption; vacation-only pay gets no second exemption', () => {
  const input = payoutInput();
  input.annualSalary = '2400';
  input.earnings!.vacationPay.mode = 'fixedPerPeriod';
  input.earnings!.vacationPay.amount = '50';
  const together = calculate(input).currentPeriod;
  assert.ok(together.cpp.eq(money(d(150).minus('145.83').times('0.0595'))));
  input.annualSalary = '0';
  const vacationOnly = calculate(input).currentPeriod;
  assert.ok(vacationOnly.cpp.eq(money(d(50).times('0.0595'))));
});
test('earnings and taxes reconcile across frequencies and preserve statutory annual caps', () => {
  for (const frequency of Object.keys(payPeriods) as PayFrequency[]) {
    const input = payoutInput();
    input.frequency = frequency;
    input.annualSalary = '120000';
    input.earnings!.controlledTips = { isEnabled: true, amount: '100' };
    input.earnings!.statHolidayPay = { isEnabled: true, amount: '200', scope: 'selectedPeriod' };
    const result = calculate(input);
    assert.ok(result.annual.cpp.eq('4230.45'));
    assert.ok(result.annual.cpp2.eq(416));
    assert.ok(result.annual.ei.eq('1123.07'));
    assert.ok(result.annual.statHolidayGross.eq(200));
    assert.ok(result.annual.controlledTipsGross.eq(100 * payPeriods[frequency]));
    for (const pay of result.periods) {
      assert.ok(pay.gross.eq(pay.regularGross.plus(pay.overtimeGross).plus(pay.controlledTipsGross)
        .plus(pay.statHolidayGross).plus(pay.vacationGross)));
      assert.ok(pay.gross.eq(pay.net.plus(pay.totalDeductions)));
      assert.ok(pay.incomeTax.eq(pay.federalTax.plus(pay.provincialTax).plus(pay.vacationIncomeTax)));
    }
    assert.ok(result.annual.net.eq(result.periods.reduce((total, pay) => total.plus(pay.net), d(0))));
  }
});
test('reverse preserves earnings while treating the solved salary as total base earnings', () => {
  const input = payoutInput();
  input.linkedIncome = true;
  input.earnings!.controlledTips = { isEnabled: true, amount: '100' };
  input.earnings!.statHolidayPay = { isEnabled: true, amount: '150', scope: 'selectedPeriod' };
  const target = calculate({ ...input, linkedIncome: false }).currentPeriod.net.toFixed(2);
  const solved = solveGrossForNet(input, target, 'perPay');
  assert.ok(solved.achievedNet.minus(target).abs().lte('0.01'));
  assert.ok(solved.result.currentPeriod.controlledTipsGross.eq(100));
  assert.ok(solved.result.currentPeriod.statHolidayGross.eq(150));
  assert.ok(solved.result.currentPeriod.vacationGross.gt(0));
  assert.deepEqual(solved.result, calculate({ ...input, linkedIncome: false, incomeType: 'annualSalary',
    annualSalary: solved.annualSalary.toFixed(2) }));
});
test('invalid active extra earnings and linked weekly hours are rejected', () => {
  for (const key of ['controlledTips', 'vacationPay', 'statHolidayPay'] as const) {
    const input = defaultInput();
    input.earnings![key].isEnabled = true;
    input.earnings![key].amount = '-1';
    assert.throws(() => calculate(input), error => error instanceof PayrollError && error.code === 'invalidValue');
  }
  const excessivePercent = payoutInput();
  excessivePercent.earnings!.vacationPay.amount = '101';
  assert.throws(() => calculate(excessivePercent), error => error instanceof PayrollError && error.code === 'invalidValue');
  const noHours = { ...defaultInput(), linkedIncome: true, hoursPerWeek: '0' };
  assert.throws(() => calculate(noHours), error => error instanceof PayrollError && error.code === 'invalidValue');
});
