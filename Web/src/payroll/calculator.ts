import tax2026 from '../data/tax2026.json';
import { Decimal, decimal as d, money, truncate } from './decimal';
import {
  breakdownKeys, contributionKeys, payPeriods, defaultEarnings,
  type AdditionalEarnings, type BasicPersonalAmount, type BreakdownAmounts, type ContributionKey,
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
  const incomeTax = sum(amounts.federalTax, amounts.provincialTax, amounts.vacationIncomeTax);
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

interface ValidatedInput {
  annualRegular: Decimal;
  annualOvertime: Decimal;
  contributions: Record<ContributionKey, Decimal>;
  earnings: AdditionalEarnings;
  controlledTips: Decimal;
  statHoliday: Decimal;
  vacationAmount: Decimal;
}
function validateInput(input: PayrollInput): ValidatedInput {
  if (!Object.hasOwn(payPeriods, input.frequency) || !Number.isInteger(input.selectedPayPeriod) ||
      input.selectedPayPeriod < 1 || input.selectedPayPeriod > payPeriods[input.frequency]) {
    throw new PayrollError('invalidPayPeriod');
  }
  const weeklyHours = () => {
    const hours = parseNonnegative(input.hoursPerWeek, 'hours per week');
    const overtime = parseNonnegative(input.overtimeHours, 'overtime hours');
    if (hours.plus(overtime).gt(168)) throw new PayrollError('invalidValue', 'weekly hours (maximum 168)');
    let multiplier = d(1);
    if (overtime.gt(0)) {
      multiplier = parseNonnegative(input.overtimeMultiplier, 'overtime multiplier (1 to 10)');
      if (multiplier.lt(1) || multiplier.gt(10)) throw new PayrollError('invalidValue', 'overtime multiplier (1 to 10)');
    }
    return { hours, weightedOvertime: overtime.times(multiplier) };
  };
  let annualRegular: Decimal;
  let annualOvertime = zero();
  if (input.incomeType === 'annualSalary') {
    const annual = parseNonnegative(input.annualSalary, 'annual salary');
    annualRegular = annual;
    if (input.linkedIncome) {
      const { hours, weightedOvertime } = weeklyHours();
      const paidHours = hours.plus(weightedOvertime);
      if (annual.gt(0) && paidHours.isZero()) {
        throw new PayrollError('invalidValue', 'weekly hours (greater than zero for linked salary)');
      }
      annualRegular = paidHours.gt(0) ? money(annual.times(hours).div(paidHours)) : zero();
      annualOvertime = money(annual).minus(annualRegular);
    }
  } else if (input.incomeType === 'hourly') {
    const rate = parseNonnegative(input.hourlyRate, 'hourly rate');
    const { hours, weightedOvertime } = weeklyHours();
    annualRegular = rate.times(hours).times(52);
    annualOvertime = rate.times(weightedOvertime).times(52);
    if (annualRegular.plus(annualOvertime).gt(100_000_000)) throw new PayrollError('invalidValue', 'annual earnings');
    if (input.linkedIncome) {
      const annual = money(annualRegular.plus(annualOvertime));
      annualRegular = money(annualRegular);
      annualOvertime = annual.minus(annualRegular);
    }
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
  const earnings = input.earnings ?? defaultEarnings();
  const controlledTips = earnings.controlledTips.isEnabled ?
    money(parseNonnegative(earnings.controlledTips.amount, 'controlled tips per paycheque')) : zero();
  const statHoliday = earnings.statHolidayPay.isEnabled ?
    money(parseNonnegative(earnings.statHolidayPay.amount, 'statutory holiday pay')) : zero();
  if (earnings.statHolidayPay.isEnabled && !['selectedPeriod', 'everyPeriod'].includes(earnings.statHolidayPay.scope)) {
    throw new PayrollError('invalidValue', 'statutory holiday pay scope');
  }
  const vacationAmount = earnings.vacationPay.isEnabled ?
    parseNonnegative(earnings.vacationPay.amount, 'vacation pay') : zero();
  if (earnings.vacationPay.isEnabled) {
    if (!['percentOfEligibleEarnings', 'fixedPerPeriod'].includes(earnings.vacationPay.mode)) {
      throw new PayrollError('invalidValue', 'vacation pay mode');
    }
    if (earnings.vacationPay.mode === 'percentOfEligibleEarnings' && vacationAmount.gt(100)) {
      throw new PayrollError('invalidValue', 'vacation pay percentage (0 to 100)');
    }
  }
  return { annualRegular, annualOvertime, contributions, earnings, controlledTips, statHoliday, vacationAmount };
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

function annualTaxes(income: Decimal, baseCPP: Decimal, annualEI: Decimal, employmentIncome: Decimal,
  taxYear: TaxYear, province: ProvincialTaxParameters): { federal: Decimal; provincial: Decimal } {
  const federalBPA = basicPersonalAmount(income, taxYear.federal.basicPersonalAmount);
  const provincialBPA = basicPersonalAmount(income, province.basicPersonalAmount);
  const federalCredits = d(taxYear.federal.brackets[0].rate).times(
    sum(federalBPA, baseCPP, annualEI, min(employmentIncome, taxYear.federal.employmentAmount)));
  const provincialCredits = d(province.brackets[0].rate).times(sum(provincialBPA, baseCPP, annualEI));
  return {
    federal: max(0, bracketTax(income, taxYear.federal.brackets).minus(federalCredits)),
    provincial: max(0, bracketTax(income, province.brackets).minus(provincialCredits)),
  };
}

export interface VacationBonusFactors {
  periodicTaxableIncome: Decimal.Value;
  currentGross: Decimal.Value;
  currentTaxableIncome: Decimal.Value;
  priorTaxableIncome: Decimal.Value;
  annualRegularBaseCPP: Decimal.Value;
  annualRegularEI: Decimal.Value;
  currentBaseCPP: Decimal.Value;
  currentEI: Decimal.Value;
  priorBaseCPP: Decimal.Value;
  priorEI: Decimal.Value;
  annualPeriodicGross: Decimal.Value;
  priorGross: Decimal.Value;
}
/** CRA T4127 Option 1 regular bonus method, using the same configured taxes.
 * https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4127-payroll-deductions-formulas/t4127-jan/t4127-jan-payroll-deductions-formulas-computer-programs.html
 * F5A/F5B are kept identical for the regular payment and both bonus steps.
 * The entire bonus withholding is returned separately, including the combined
 * 15% rule for annual taxable income <= $5,000 (no invented province split).
 */
export function vacationBonusWithholding(factors: VacationBonusFactors, taxYear: TaxYear = tax2026 as TaxYear,
  province: ProvincialTaxParameters = taxYear.provinces.manitoba!): {
    total: Decimal; federalDifference: Decimal; provincialDifference: Decimal;
  } {
  const withoutIncome = d(factors.periodicTaxableIncome).plus(factors.priorTaxableIncome);
  const withIncome = withoutIncome.plus(factors.currentTaxableIncome);
  if (withIncome.lte(5000)) {
    return { total: money(d(factors.currentGross).times('0.15')), federalDifference: zero(), provincialDifference: zero() };
  }
  const withoutCPP = min(taxYear.cpp.maximumBaseContribution,
    sum(factors.annualRegularBaseCPP, factors.priorBaseCPP));
  const withoutEI = min(taxYear.ei.maximumPremium, sum(factors.annualRegularEI, factors.priorEI));
  const withCPP = min(taxYear.cpp.maximumBaseContribution, withoutCPP.plus(factors.currentBaseCPP));
  const withEI = min(taxYear.ei.maximumPremium, withoutEI.plus(factors.currentEI));
  const without = annualTaxes(withoutIncome, withoutCPP, withoutEI,
    d(factors.annualPeriodicGross).plus(factors.priorGross), taxYear, province);
  const withBonus = annualTaxes(withIncome, withCPP, withEI,
    sum(factors.annualPeriodicGross, factors.priorGross, factors.currentGross), taxYear, province);
  const federalDifference = withBonus.federal.minus(without.federal);
  const provincialDifference = withBonus.provincial.minus(without.provincial);
  return { total: money(max(0, federalDifference.plus(provincialDifference))), federalDifference, provincialDifference };
}

/** The existing Swift payroll method is unchanged when extra earnings are off.
 * Continuous vacation payouts use CRA's bonus method, not periodic wages:
 * https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/special-payments/vacation-pay-public-holidays.html
 */
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
  const baseShare = d(cppParameters.baseRate).div(totalRate);
  const maximumCPP = d(cppParameters.maximumBaseContribution).plus(cppParameters.maximumFirstAdditionalContribution);
  const exemption = truncate(d(cppParameters.annualBasicExemption).div(count));
  let cppYTD = zero();
  let cpp2YTD = zero();
  let eiYTD = zero();
  let earningsYTD = zero();
  let periodicCPPYTD = zero();
  let periodicEIYTD = zero();
  let vacationCPPYTD = zero();
  let vacationEIYTD = zero();
  let vacationTaxableYTD = zero();
  let vacationYTD = zero();
  const periods: PayrollPeriodResult[] = [];

  for (let index = 1; index <= count; index += 1) {
    const regularGross = scheduledAmount(annualRegular, regular, index, count);
    const overtimeGross = scheduledAmount(annualOvertime, overtime, index, count);
    const controlledTipsGross = validated.controlledTips;
    const statHolidayGross = validated.earnings.statHolidayPay.scope === 'everyPeriod' || index === input.selectedPayPeriod ?
      validated.statHoliday : zero();
    const eligibleVacation = sum(regularGross, statHolidayGross,
      validated.earnings.vacationPay.includeControlledTips ? controlledTipsGross : 0);
    const vacationGross = !validated.earnings.vacationPay.isEnabled ? zero() :
      money(validated.earnings.vacationPay.mode === 'percentOfEligibleEarnings' ?
        eligibleVacation.times(validated.vacationAmount).div(100) : validated.vacationAmount);
    const periodicGross = sum(regularGross, overtimeGross, controlledTipsGross, statHolidayGross);
    const gross = periodicGross.plus(vacationGross);
    // Same-cheque vacation pay shares the single regular CPP exemption. A
    // vacation-only payment has no periodic wages and receives no exemption.
    const cpp = max(0, min(maximumCPP.minus(cppYTD), money(
      (periodicGross.gt(0) || vacationGross.isZero() ? max(0, gross.minus(exemption)) : gross).times(totalRate))));
    const periodicCPP = min(cpp,
      money(max(0, periodicGross.minus(exemption)).times(totalRate)));
    const vacationCPP = cpp.minus(periodicCPP);
    const cpp2Earnings = max(0, earningsYTD.plus(gross).minus(max(earningsYTD, cppParameters.yearlyMaximumPensionableEarnings)));
    const cpp2 = max(0, min(d(cppParameters.maximumSecondAdditionalContribution).minus(cpp2YTD),
      money(cpp2Earnings.times(cppParameters.secondAdditionalRate))));
    const ei = max(0, min(d(taxYear.ei.maximumPremium).minus(eiYTD), money(gross.times(taxYear.ei.rate))));
    const periodicEI = min(ei, money(periodicGross.times(taxYear.ei.rate)));
    const vacationEI = ei.minus(periodicEI);
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
    // F5A + F5B reconciles to the actual enhanced CPP cents on the cheque.
    const bonusEnhancedCPP = gross.gt(0) ? money(enhancedCPP.times(vacationGross).div(gross)) : zero();
    const regularEnhancedCPP = enhancedCPP.minus(bonusEnhancedCPP);
    // Percentage deductions follow all gross earnings. Fixed pre-tax amounts
    // are taken from periodic wages first; any excess is assigned to vacation.
    const preTaxEntries: [ContributionKey, Decimal][] = [
      ['pension', pension], ['rrsp', rrsp], ['unionDues', unionDues], ['otherPreTax', otherPreTax],
    ];
    let bonusPercentagePreTax = zero();
    let regularPercentagePreTax = zero();
    let fixedPreTax = zero();
    for (const [key, amount] of preTaxEntries) {
      if (input.deductions[key].mode === 'percentOfGross') {
        const bonusPart = gross.gt(0) ? money(amount.times(vacationGross).div(gross)) : zero();
        bonusPercentagePreTax = bonusPercentagePreTax.plus(bonusPart);
        regularPercentagePreTax = regularPercentagePreTax.plus(amount.minus(bonusPart));
      } else fixedPreTax = fixedPreTax.plus(amount);
    }
    const bonusPreTax = bonusPercentagePreTax.plus(max(0,
      fixedPreTax.minus(max(0, periodicGross.minus(regularPercentagePreTax)))));
    const regularPreTax = preTax.minus(bonusPreTax);
    const taxableIncome = max(0, periodicGross.minus(regularPreTax).minus(regularEnhancedCPP).times(count));
    const periodicCPPProjection = max(periodicCPP.times(count), periodicCPPYTD);
    const periodicEIProjection = max(periodicEI.times(count), periodicEIYTD);
    const annualBaseCPP = cppYTD.plus(cpp).gte(maximumCPP) ? d(cppParameters.maximumBaseContribution) :
      min(cppParameters.maximumBaseContribution, periodicCPPProjection.times(baseShare));
    const annualEI = eiYTD.plus(ei).gte(taxYear.ei.maximumPremium) ? d(taxYear.ei.maximumPremium) :
      min(taxYear.ei.maximumPremium, periodicEIProjection);
    const regularTaxes = annualTaxes(taxableIncome, annualBaseCPP, annualEI, periodicGross.times(count), taxYear, province);
    const regularIncomeTax = money(regularTaxes.federal.plus(regularTaxes.provincial).div(count));
    const federalTax = money(regularTaxes.federal.div(count));
    const provincialTax = regularIncomeTax.minus(federalTax);
    const currentVacationTaxable = max(0, vacationGross.minus(bonusPreTax).minus(bonusEnhancedCPP));
    const vacationIncomeTax = vacationGross.isZero() ? zero() : vacationBonusWithholding({
      periodicTaxableIncome: taxableIncome, currentGross: vacationGross,
      currentTaxableIncome: currentVacationTaxable, priorTaxableIncome: vacationTaxableYTD,
      annualRegularBaseCPP: periodicCPPProjection.times(baseShare), annualRegularEI: periodicEIProjection,
      currentBaseCPP: vacationCPP.times(baseShare), currentEI: vacationEI,
      priorBaseCPP: vacationCPPYTD.times(baseShare), priorEI: vacationEIYTD,
      annualPeriodicGross: periodicGross.times(count), priorGross: vacationYTD,
    }, taxYear, province).total;
    const incomeTax = regularIncomeTax.plus(vacationIncomeTax);
    const net = gross.minus(sum(incomeTax, cpp, cpp2, ei, preTax, afterTax));
    if (net.lt(0)) throw new PayrollError('excessiveDeductions');
    periods.push(withTotals({
      periodNumber: index, gross, regularGross, overtimeGross, controlledTipsGross, statHolidayGross, vacationGross,
      federalTax, provincialTax, vacationIncomeTax, cpp, cpp2, ei,
      pension, rrsp, unionDues, health, otherPreTax, otherAfterTax, employerMatch, net,
      annualizedTaxableIncome: taxableIncome, cppEnhancedTaxDeduction: enhancedCPP,
    }));
    cppYTD = cppYTD.plus(cpp);
    cpp2YTD = cpp2YTD.plus(cpp2);
    eiYTD = eiYTD.plus(ei);
    earningsYTD = earningsYTD.plus(gross);
    periodicCPPYTD = periodicCPPYTD.plus(periodicCPP);
    periodicEIYTD = periodicEIYTD.plus(periodicEI);
    vacationCPPYTD = vacationCPPYTD.plus(vacationCPP);
    vacationEIYTD = vacationEIYTD.plus(vacationEI);
    vacationTaxableYTD = vacationTaxableYTD.plus(currentVacationTaxable);
    vacationYTD = vacationYTD.plus(vacationGross);
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
  if (validated.earnings.vacationPay.isEnabled) {
    warnings.push('Vacation pay is paid out with each cheque, not accrued. Income tax uses CRA’s bonus method with simulated vacation pay received earlier in the year.');
    warnings.push('Earlier earnings and vacation payouts are simulated from the first cheque of the year. Your employer’s actual year-to-date amounts can change withholding.');
  }
  return {
    currentPeriod: periods[input.selectedPayPeriod - 1], annual, monthlyNet: money(annual.net.div(12)),
    effectiveDeductionRate: annual.gross.gt(0) ? annual.totalDeductions.div(annual.gross) : zero(),
    periods, taxYear: taxYear.year, warnings,
  };
}
