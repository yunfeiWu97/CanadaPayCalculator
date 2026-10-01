import tax2026 from '../data/tax2026.json';
import { Decimal, decimal as d, money, truncate } from './decimal';
import {
  breakdownKeys, contributionKeys, payPeriods,
  type BasicPersonalAmount, type BreakdownAmounts, type ContributionKey,
  type PayrollBreakdown, type PayrollInput, type PayrollPeriodResult, type PayrollResult,
  type ProvincialTaxParameters, type TaxBracket, type TaxYear,
} from './models';

export type PayrollErrorCode = 'unsupportedProvince' | 'invalidValue' | 'invalidPayPeriod' |
  'excessiveDeductions' | 'invalidConfiguration';
export class PayrollError extends Error {
  constructor(public readonly code: PayrollErrorCode, field = '') {
    const messages: Record<PayrollErrorCode, string> = {
      unsupportedProvince: `${field} payroll rules are not available yet. Select Manitoba.`,
      invalidValue: `Enter a valid, nonnegative value for ${field}.`,
      invalidPayPeriod: "Select a pay period within the selected frequency's annual schedule.",
      excessiveDeductions: 'Optional deductions exceed the pay available after taxes. Reduce the contributions.',
      invalidConfiguration: 'The tax configuration is incomplete or invalid.',
    };
    super(messages[code]);
    this.name = 'PayrollError';
  }
}

const zero = () => d(0);
const sum = (...amounts: Decimal.Value[]): Decimal => amounts.reduce<Decimal>((total, item) => total.plus(item), zero());
const max = (...amounts: Decimal.Value[]): Decimal => Decimal.max(...amounts);
const min = (...amounts: Decimal.Value[]): Decimal => Decimal.min(...amounts);
const contributionLabels: Record<ContributionKey, string> = {
  pension: 'pension contribution', rrsp: 'RRSP contribution', unionDues: 'union dues',
  health: 'health benefits', otherPreTax: 'other pre-tax deduction',
  otherAfterTax: 'other after-tax deduction', employerMatch: 'employer pension contribution',
};

/** Same exclusive boundaries and payroll constants as PayrollCalculator.swift. */
export function bracketTax(income: Decimal.Value, brackets: TaxBracket[]): Decimal {
  const amount = d(income);
  const bracket = [...brackets].reverse().find(item => amount.gt(item.lowerBound));
  return bracket ? max(0, amount.times(bracket.rate).minus(bracket.payrollConstant)) : zero();
}

export function basicPersonalAmount(income: Decimal.Value, parameters: BasicPersonalAmount): Decimal {
  const amount = d(income);
  if (amount.lte(parameters.phaseoutStart)) return d(parameters.maximum);
  if (amount.gte(parameters.phaseoutEnd)) return d(parameters.minimum);
  return money(d(parameters.maximum).minus(amount.minus(parameters.phaseoutStart).times(
    d(parameters.maximum).minus(parameters.minimum).div(d(parameters.phaseoutEnd).minus(parameters.phaseoutStart)),
  )));
}

function withTotals<T extends BreakdownAmounts>(amounts: T): T & PayrollBreakdown {
  const incomeTax = amounts.federalTax.plus(amounts.provincialTax);
  const statutoryDeductions = sum(incomeTax, amounts.cpp, amounts.cpp2, amounts.ei);
  const preTaxDeductions = sum(amounts.pension, amounts.rrsp, amounts.unionDues, amounts.otherPreTax);
  const afterTaxDeductions = sum(amounts.health, amounts.otherAfterTax);
  const optionalDeductions = preTaxDeductions.plus(afterTaxDeductions);
  return {
    ...amounts, incomeTax, statutoryDeductions, preTaxDeductions, afterTaxDeductions,
    optionalDeductions, totalDeductions: statutoryDeductions.plus(optionalDeductions),
    employeeRetirementContributions: amounts.pension.plus(amounts.rrsp),
  };
}

function parseNonnegative(raw: string, field: string): Decimal {
  // Incomplete drafts (including an empty field) are errors, never silently zero.
  if (typeof raw !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw.trim())) {
    throw new PayrollError('invalidValue', field);
  }
  const value = d(raw.trim());
  if (!value.isFinite() || value.lt(0) || value.gt(100_000_000)) throw new PayrollError('invalidValue', field);
  return value;
}

function validateInput(input: PayrollInput): {
  annualRegular: Decimal; annualOvertime: Decimal; contributions: Record<ContributionKey, Decimal>;
} {
  if (!Object.hasOwn(payPeriods, input.frequency) || !Number.isInteger(input.selectedPayPeriod) ||
      input.selectedPayPeriod < 1 || input.selectedPayPeriod > payPeriods[input.frequency]) {
    throw new PayrollError('invalidPayPeriod');
  }
  let annualRegular: Decimal;
  let annualOvertime = zero();
  if (input.incomeType === 'annualSalary') {
    annualRegular = parseNonnegative(input.annualSalary, 'annual salary');
  } else if (input.incomeType === 'hourly') {
    const rate = parseNonnegative(input.hourlyRate, 'hourly rate');
    const hours = parseNonnegative(input.hoursPerWeek, 'hours per week');
    const overtime = parseNonnegative(input.overtimeHours, 'overtime hours');
    if (hours.plus(overtime).gt(168)) throw new PayrollError('invalidValue', 'weekly hours (maximum 168)');
    annualRegular = rate.times(hours).times(52);
    if (overtime.gt(0)) {
      const multiplier = parseNonnegative(input.overtimeMultiplier, 'overtime multiplier (1 to 10)');
      if (multiplier.lt(1) || multiplier.gt(10)) throw new PayrollError('invalidValue', 'overtime multiplier (1 to 10)');
      annualOvertime = rate.times(overtime).times(multiplier).times(52);
    }
    if (annualRegular.plus(annualOvertime).gt(100_000_000)) throw new PayrollError('invalidValue', 'annual earnings');
  } else {
    throw new PayrollError('invalidValue', 'income type');
  }
  const contributions = {} as Record<ContributionKey, Decimal>;
  for (const key of contributionKeys) {
    const contribution = input.deductions[key];
    if (!contribution.isEnabled) { contributions[key] = zero(); continue; }
    const amount = parseNonnegative(contribution.amount, contributionLabels[key]);
    if (contribution.mode !== 'percentOfGross' && contribution.mode !== 'fixedPerPeriod') {
      throw new PayrollError('invalidValue', contributionLabels[key]);
    }
    if (contribution.mode === 'percentOfGross' && amount.gt(100)) {
      throw new PayrollError('invalidValue', `${contributionLabels[key]} percentage (0 to 100)`);
    }
    contributions[key] = amount;
  }
  return { annualRegular, annualOvertime, contributions };
}

function validateConfiguration(year: TaxYear, province: ProvincialTaxParameters): void {
  try {
    const finiteNonnegative = (value: string): boolean => d(value).isFinite() && d(value).gte(0);
    const validRate = (value: string): boolean => finiteNonnegative(value) && d(value).lte(1);
    const validBrackets = (brackets: TaxBracket[]): boolean => brackets.length > 0 &&
      d(brackets[0].lowerBound).eq(0) && d(brackets[0].payrollConstant).eq(0) &&
      brackets.every((bracket, index) => finiteNonnegative(bracket.lowerBound) && validRate(bracket.rate) &&
        finiteNonnegative(bracket.payrollConstant) && (index === 0 || d(brackets[index - 1].lowerBound).lt(bracket.lowerBound)));
    const validBPA = (bpa: BasicPersonalAmount): boolean =>
      [bpa.maximum, bpa.minimum, bpa.phaseoutStart, bpa.phaseoutEnd].every(finiteNonnegative) &&
      d(bpa.maximum).gte(bpa.minimum) && d(bpa.phaseoutEnd).gt(bpa.phaseoutStart);
    const cpp = year.cpp;
    const totalRate = d(cpp.baseRate).plus(cpp.firstAdditionalRate);
    const pensionable = d(cpp.yearlyMaximumPensionableEarnings).minus(cpp.annualBasicExemption);
    const secondPensionable = d(cpp.yearlyAdditionalMaximumPensionableEarnings).minus(cpp.yearlyMaximumPensionableEarnings);
    const valid = Number.isInteger(year.year) && year.year > 0 &&
      validBrackets(year.federal.brackets) && validBrackets(province.brackets) &&
      validBPA(year.federal.basicPersonalAmount) && validBPA(province.basicPersonalAmount) &&
      [cpp.annualBasicExemption, cpp.yearlyMaximumPensionableEarnings, cpp.yearlyAdditionalMaximumPensionableEarnings,
        cpp.maximumBaseContribution, cpp.maximumFirstAdditionalContribution, cpp.maximumSecondAdditionalContribution,
        year.ei.maximumInsurableEarnings, year.ei.maximumPremium, year.federal.employmentAmount].every(finiteNonnegative) &&
      [cpp.baseRate, cpp.firstAdditionalRate, cpp.secondAdditionalRate, year.ei.rate].every(validRate) &&
      totalRate.gt(0) && totalRate.lte(1) && pensionable.gte(0) && secondPensionable.gte(0) &&
      d(cpp.maximumBaseContribution).eq(money(pensionable.times(cpp.baseRate))) &&
      d(cpp.maximumFirstAdditionalContribution).eq(money(pensionable.times(cpp.firstAdditionalRate))) &&
      d(cpp.maximumSecondAdditionalContribution).eq(money(secondPensionable.times(cpp.secondAdditionalRate))) &&
      d(year.ei.maximumPremium).eq(money(d(year.ei.maximumInsurableEarnings).times(year.ei.rate)));
    if (!valid) throw new Error('invalid');
  } catch {
    throw new PayrollError('invalidConfiguration');
  }
}

function scheduledAmount(annual: Decimal, regular: Decimal, index: number, count: number): Decimal {
  if (regular.times(count - 1).gt(annual)) {
    return money(annual.times(index).div(count)).minus(money(annual.times(index - 1).div(count)));
  }
  return index === count ? annual.minus(regular.times(count - 1)) : regular;
}

/** Direct decimal port of the existing Swift engine, including its full-year schedule. */
export function calculate(input: PayrollInput, taxYear: TaxYear = tax2026 as TaxYear): PayrollResult {
  const province = taxYear.provinces[input.province];
  if (!province) throw new PayrollError('unsupportedProvince', input.province);
  const validated = validateInput(input);
  validateConfiguration(taxYear, province);
  const count = payPeriods[input.frequency];
  const annualRegular = money(validated.annualRegular);
  const annualOvertime = money(validated.annualOvertime);
  const regular = money(annualRegular.div(count));
  const overtime = money(annualOvertime.div(count));
  const cppParameters = taxYear.cpp;
  const totalRate = d(cppParameters.baseRate).plus(cppParameters.firstAdditionalRate);
  const maximumCPP = d(cppParameters.maximumBaseContribution).plus(cppParameters.maximumFirstAdditionalContribution);
  const exemption = truncate(d(cppParameters.annualBasicExemption).div(count));
  let cppYTD = zero();
  let cpp2YTD = zero();
  let eiYTD = zero();
  let earningsYTD = zero();
  const periods: PayrollPeriodResult[] = [];

  for (let index = 1; index <= count; index += 1) {
    const regularGross = scheduledAmount(annualRegular, regular, index, count);
    const overtimeGross = scheduledAmount(annualOvertime, overtime, index, count);
    const gross = regularGross.plus(overtimeGross);
    const cpp = max(0, min(maximumCPP.minus(cppYTD), money(max(0, gross.minus(exemption)).times(totalRate))));
    const cpp2Earnings = max(0, earningsYTD.plus(gross).minus(max(earningsYTD, cppParameters.yearlyMaximumPensionableEarnings)));
    const cpp2 = max(0, min(d(cppParameters.maximumSecondAdditionalContribution).minus(cpp2YTD),
      money(cpp2Earnings.times(cppParameters.secondAdditionalRate))));
    const ei = max(0, min(d(taxYear.ei.maximumPremium).minus(eiYTD), money(gross.times(taxYear.ei.rate))));
    const contribution = (key: ContributionKey): Decimal => input.deductions[key].isEnabled ?
      money(input.deductions[key].mode === 'percentOfGross' ? gross.times(validated.contributions[key]).div(100) :
        validated.contributions[key]) : zero();
    const pension = contribution('pension');
    const rrsp = contribution('rrsp');
    const unionDues = contribution('unionDues');
    const health = contribution('health');
    const otherPreTax = contribution('otherPreTax');
    const otherAfterTax = contribution('otherAfterTax');
    const employerMatch = contribution('employerMatch');
    const preTax = sum(pension, rrsp, unionDues, otherPreTax);
    const afterTax = health.plus(otherAfterTax);
    if (preTax.plus(afterTax).gt(gross)) throw new PayrollError('excessiveDeductions');
    const enhancedCPP = money(cpp.times(d(cppParameters.firstAdditionalRate).div(totalRate)).plus(cpp2));
    const taxableIncome = max(0, gross.minus(preTax).minus(enhancedCPP).times(count));
    const annualBaseCPP = cppYTD.plus(cpp).gte(maximumCPP) ? d(cppParameters.maximumBaseContribution) :
      min(cppParameters.maximumBaseContribution, max(cpp.times(count), cppYTD).times(d(cppParameters.baseRate).div(totalRate)));
    const annualEI = eiYTD.plus(ei).gte(taxYear.ei.maximumPremium) ? d(taxYear.ei.maximumPremium) :
      min(taxYear.ei.maximumPremium, max(ei.times(count), eiYTD));
    const federalBPA = basicPersonalAmount(taxableIncome, taxYear.federal.basicPersonalAmount);
    const provincialBPA = basicPersonalAmount(taxableIncome, province.basicPersonalAmount);
    const federalCredits = d(taxYear.federal.brackets[0].rate).times(
      sum(federalBPA, annualBaseCPP, annualEI, min(gross.times(count), taxYear.federal.employmentAmount)));
    const provincialCredits = d(province.brackets[0].rate).times(sum(provincialBPA, annualBaseCPP, annualEI));
    const annualFederal = max(0, bracketTax(taxableIncome, taxYear.federal.brackets).minus(federalCredits));
    const annualProvincial = max(0, bracketTax(taxableIncome, province.brackets).minus(provincialCredits));
    const incomeTax = money(annualFederal.plus(annualProvincial).div(count));
    const federalTax = money(annualFederal.div(count));
    const provincialTax = incomeTax.minus(federalTax);
    const net = gross.minus(sum(incomeTax, cpp, cpp2, ei, preTax, afterTax));
    if (net.lt(0)) throw new PayrollError('excessiveDeductions');
    periods.push(withTotals({
      periodNumber: index, gross, regularGross, overtimeGross, federalTax, provincialTax, cpp, cpp2, ei,
      pension, rrsp, unionDues, health, otherPreTax, otherAfterTax, employerMatch, net,
      annualizedTaxableIncome: taxableIncome, cppEnhancedTaxDeduction: enhancedCPP,
    }));
    cppYTD = cppYTD.plus(cpp);
    cpp2YTD = cpp2YTD.plus(cpp2);
    eiYTD = eiYTD.plus(ei);
    earningsYTD = earningsYTD.plus(gross);
  }
  const annual = withTotals(Object.fromEntries(breakdownKeys.map(key => [
    key, periods.reduce((total, period) => total.plus(period[key]), zero()),
  ])) as BreakdownAmounts);
  const warnings: string[] = [];
  if (input.deductions.otherPreTax.isEnabled && validated.contributions.otherPreTax.gt(0)) {
    warnings.push('Other pre-tax deductions assume employer authorization to reduce income-tax withholding.');
  }
  if (input.deductions.rrsp.isEnabled) {
    warnings.push('RRSP contributions assume available contribution room and direct payroll remittance.');
  }
  return {
    currentPeriod: periods[input.selectedPayPeriod - 1], annual, monthlyNet: money(annual.net.div(12)),
    effectiveDeductionRate: annual.gross.gt(0) ? annual.totalDeductions.div(annual.gross) : zero(),
    periods, taxYear: taxYear.year, warnings,
  };
}
