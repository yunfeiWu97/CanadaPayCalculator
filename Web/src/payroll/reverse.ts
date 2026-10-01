import tax2026 from '../data/tax2026.json';
import { calculate, PayrollError } from './calculator';
import { Decimal, decimal as d, money } from './decimal';
import { payPeriods, type ContributionKey, type PayrollInput, type PayrollResult } from './models';

export type NetBasis = 'annual' | 'monthly' | 'perPay';
export interface ReversePayrollResult {
  annualSalary: Decimal;
  result: PayrollResult;
  targetNet: Decimal;
  achievedNet: Decimal;
}
export type ReversePayrollErrorCode = 'invalidTarget' | 'unreachableTarget' | 'unsupportedDeductions';
export class ReversePayrollError extends Error {
  constructor(public readonly code: ReversePayrollErrorCode, message: string) {
    super(message);
    this.name = 'ReversePayrollError';
  }
}

const maximumSalaryCents = 10_000_000_000; // Same $100m input limit as the forward engine.
const oneCent = d('0.01');
function targetAmount(raw: string): Decimal {
  if (typeof raw !== 'string' || !/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(raw.trim())) {
    throw new ReversePayrollError('invalidTarget', 'Enter a positive take-home amount with at most two decimal places.');
  }
  const target = d(raw.trim());
  if (!target.isFinite() || target.lte(0)) {
    throw new ReversePayrollError('invalidTarget', 'Enter a take-home amount greater than zero.');
  }
  return target;
}
function netFor(result: PayrollResult, basis: NetBasis): Decimal {
  if (basis === 'annual') return result.annual.net;
  if (basis === 'monthly') return result.monthlyNet;
  if (basis === 'perPay') return result.currentPeriod.net;
  throw new ReversePayrollError('invalidTarget', 'Select a valid take-home period.');
}

/**
 * Percentage deductions can make net pay fall as salary rises. Reject settings
 * outside a conservative positive-slope bound rather than guessing a root.
 * This bound uses the current engine's configuration; it is not a tax formula.
 * Fixed deductions do not change the slope and remain supported.
 */
function requireSupportedPercentages(input: PayrollInput): void {
  const percentage = (keys: ContributionKey[]): Decimal => keys.reduce((total, key) => {
    const contribution = input.deductions[key];
    return contribution.isEnabled && contribution.mode === 'percentOfGross' ?
      total.plus(d(contribution.amount).div(100)) : total;
  }, d(0));
  const before = percentage(['pension', 'rrsp', 'unionDues', 'otherPreTax']);
  const after = percentage(['health', 'otherAfterTax']);
  const federal = tax2026.federal;
  const province = tax2026.provinces.manitoba;
  const bpaSlope = (parameters: typeof federal | typeof province): Decimal =>
    d(parameters.basicPersonalAmount.maximum).minus(parameters.basicPersonalAmount.minimum)
      .div(d(parameters.basicPersonalAmount.phaseoutEnd).minus(parameters.basicPersonalAmount.phaseoutStart))
      .times(parameters.brackets[0].rate);
  const largestIncomeTaxSlope = Decimal.max(...federal.brackets.map(bracket => d(bracket.rate)))
    .plus(Decimal.max(...province.brackets.map(bracket => d(bracket.rate))))
    .plus(bpaSlope(federal)).plus(bpaSlope(province));
  const statutorySlope = d(tax2026.cpp.baseRate).plus(tax2026.cpp.firstAdditionalRate)
    .plus(tax2026.cpp.secondAdditionalRate).plus(tax2026.ei.rate);
  const minimumSlope = d(1).minus(before).times(d(1).minus(largestIncomeTaxSlope)).minus(after).minus(statutorySlope);
  if (minimumSlope.lte('0.02')) {
    throw new ReversePayrollError('unsupportedDeductions',
      'These deduction percentages are too high for a reliable reverse estimate. Reduce percentage deductions or use the forward calculator.');
  }
}

/**
 * Estimate annual gross using the existing forward calculator, to within one
 * cent of the requested net. Every returned result is a real forward result.
 * Cent rounding and the reconciled final cheque create small nonmonotonic
 * steps, so a binary estimate is refined with actual cent-valued salaries.
 * The result is an estimate, not a promise of a global minimum annual salary.
 * The caller should display achievedNet and apply the salary explicitly.
 */
export function solveGrossForNet(input: PayrollInput, rawTarget: string, basis: NetBasis): ReversePayrollResult {
  const targetNet = targetAmount(rawTarget);
  // Annual gross is the reverse driver. Inactive hourly drafts stay untouched.
  const probeInput: PayrollInput = { ...input, incomeType: 'annualSalary', linkedIncome: false };
  const cache = new Map<number, PayrollResult | null>();
  const probe = (salaryCents: number): PayrollResult | null => {
    if (cache.has(salaryCents)) return cache.get(salaryCents)!;
    let result: PayrollResult | null;
    try {
      result = calculate({ ...probeInput, annualSalary: d(salaryCents).div(100).toFixed(2) });
    } catch (error) {
      // Fixed deductions can make low salaries infeasible. Search above them.
      if (error instanceof PayrollError && error.code === 'excessiveDeductions') result = null;
      else throw error;
    }
    cache.set(salaryCents, result);
    return result;
  };
  const high = probe(maximumSalaryCents);
  // The high probe validates all active settings before reading percentages.
  requireSupportedPercentages(input);
  if (!high) {
    throw new ReversePayrollError('unreachableTarget',
      'Optional deductions leave no achievable take-home pay within the $100,000,000 annual salary limit.');
  }
  // Validate basis even when a target lies outside the available range.
  netFor(high, basis);
  const count = payPeriods[input.frequency];
  let lower = 0;
  let upper = maximumSalaryCents;
  while (lower < upper) {
    const midpoint = Math.floor((lower + upper) / 2);
    const result = probe(midpoint);
    if (result && netFor(result, basis).gte(targetNet)) upper = midpoint;
    else lower = midpoint + 1;
  }

  // A bucket contains count salaries in cents with the same ordinary cheque.
  // Scan neighboring buckets because the final cheque resets at their edges.
  const start = Math.max(0, lower - count);
  const end = Math.min(maximumSalaryCents, lower + count);
  let closest: { salaryCents: number; result: PayrollResult; achieved: Decimal; difference: Decimal } | undefined;
  for (let salaryCents = start; salaryCents <= end; salaryCents += 1) {
    const result = probe(salaryCents);
    if (!result) continue;
    const achieved = netFor(result, basis);
    const difference = achieved.minus(targetNet).abs();
    if (difference.gt(oneCent)) continue;
    const above = achieved.gte(targetNet);
    const previousAbove = closest?.achieved.gte(targetNet) ?? false;
    if (!closest || (above && !previousAbove) ||
        (above === previousAbove && (difference.lt(closest.difference) ||
          (difference.eq(closest.difference) && salaryCents < closest.salaryCents)))) {
      closest = { salaryCents, result, achieved, difference };
    }
  }
  if (!closest) {
    throw new ReversePayrollError('unreachableTarget',
      'This target cannot be reached within one cent using these settings and the annual salary limit. Try a nearby amount or adjust deductions.');
  }
  return {
    annualSalary: money(d(closest.salaryCents).div(100)), result: closest.result,
    targetNet, achievedNet: closest.achieved,
  };
}
