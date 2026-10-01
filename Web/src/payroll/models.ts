import type { Decimal } from './decimal';

export const payPeriods = { weekly: 52, biweekly: 26, semiMonthly: 24, monthly: 12 } as const;
export const payFrequencyLabels = {
  weekly: 'Weekly', biweekly: 'Bi-weekly', semiMonthly: 'Semi-monthly', monthly: 'Monthly',
} as const;
export type PayFrequency = keyof typeof payPeriods;
export type IncomeType = 'annualSalary' | 'hourly';
export type Province = 'alberta' | 'britishColumbia' | 'manitoba' | 'newBrunswick' |
  'newfoundlandAndLabrador' | 'northwestTerritories' | 'novaScotia' | 'nunavut' |
  'ontario' | 'princeEdwardIsland' | 'quebec' | 'saskatchewan' | 'yukon';
export type ContributionMode = 'percentOfGross' | 'fixedPerPeriod';
export interface Contribution { isEnabled: boolean; mode: ContributionMode; amount: string }
export const contributionKeys = [
  'pension', 'rrsp', 'unionDues', 'health', 'otherPreTax', 'otherAfterTax', 'employerMatch',
] as const;
export type ContributionKey = typeof contributionKeys[number];
export type OptionalDeductions = Record<ContributionKey, Contribution>;

export interface AdditionalEarnings {
  controlledTips: { isEnabled: boolean; amount: string };
  vacationPay: {
    isEnabled: boolean;
    mode: 'percentOfEligibleEarnings' | 'fixedPerPeriod';
    amount: string;
    includeControlledTips: boolean;
  };
  statHolidayPay: { isEnabled: boolean; amount: string; scope: 'selectedPeriod' | 'everyPeriod' };
}
export function defaultEarnings(): AdditionalEarnings {
  return {
    controlledTips: { isEnabled: false, amount: '0' },
    vacationPay: { isEnabled: false, mode: 'percentOfEligibleEarnings', amount: '4', includeControlledTips: false },
    statHolidayPay: { isEnabled: false, amount: '0', scope: 'selectedPeriod' },
  };
}

/** Strings preserve incomplete editing and exact decimals without Number(). */
export interface PayrollInput {
  annualSalary: string;
  /** UI-linked annual base earnings include regular and overtime earnings. */
  linkedIncome?: boolean;
  earnings?: AdditionalEarnings;
  incomeType: IncomeType;
  hourlyRate: string;
  hoursPerWeek: string;
  overtimeHours: string;
  overtimeMultiplier: string;
  province: Province;
  frequency: PayFrequency;
  selectedPayPeriod: number;
  deductions: OptionalDeductions;
}

export function defaultInput(): PayrollInput {
  return {
    linkedIncome: false, earnings: defaultEarnings(),
    annualSalary: '65000', incomeType: 'annualSalary', hourlyRate: '25', hoursPerWeek: '37.5',
    overtimeHours: '0', overtimeMultiplier: '1.5', province: 'manitoba', frequency: 'semiMonthly',
    selectedPayPeriod: 1,
    deductions: Object.fromEntries(contributionKeys.map(key => [key, {
      isEnabled: false, mode: 'percentOfGross', amount: '0',
    }])) as OptionalDeductions,
  };
}

export const breakdownKeys = [
  'gross', 'regularGross', 'overtimeGross', 'controlledTipsGross', 'vacationGross', 'statHolidayGross', 'vacationIncomeTax', 'federalTax', 'provincialTax', 'cpp', 'cpp2', 'ei',
  'pension', 'rrsp', 'unionDues', 'health', 'otherPreTax', 'otherAfterTax', 'employerMatch', 'net',
] as const;
export type BreakdownKey = typeof breakdownKeys[number];
export type BreakdownAmounts = Record<BreakdownKey, Decimal>;
export interface PayrollBreakdown extends BreakdownAmounts {
  incomeTax: Decimal;
  statutoryDeductions: Decimal;
  preTaxDeductions: Decimal;
  afterTaxDeductions: Decimal;
  optionalDeductions: Decimal;
  totalDeductions: Decimal;
  employeeRetirementContributions: Decimal;
}
export interface PayrollPeriodResult extends PayrollBreakdown {
  periodNumber: number;
  annualizedTaxableIncome: Decimal;
  cppEnhancedTaxDeduction: Decimal;
}
export type PayrollAnnualResult = PayrollBreakdown;
export interface PayrollResult {
  currentPeriod: PayrollPeriodResult;
  annual: PayrollAnnualResult;
  monthlyNet: Decimal;
  effectiveDeductionRate: Decimal;
  periods: PayrollPeriodResult[];
  taxYear: number;
  warnings: string[];
}

export interface TaxBracket { lowerBound: string; rate: string; payrollConstant: string }
export interface BasicPersonalAmount {
  maximum: string; minimum: string; phaseoutStart: string; phaseoutEnd: string;
}
export interface ProvincialTaxParameters { brackets: TaxBracket[]; basicPersonalAmount: BasicPersonalAmount }
export interface FederalTaxParameters extends ProvincialTaxParameters { employmentAmount: string }
export interface CPPParameters {
  annualBasicExemption: string;
  yearlyMaximumPensionableEarnings: string;
  yearlyAdditionalMaximumPensionableEarnings: string;
  baseRate: string;
  firstAdditionalRate: string;
  secondAdditionalRate: string;
  maximumBaseContribution: string;
  maximumFirstAdditionalContribution: string;
  maximumSecondAdditionalContribution: string;
}
export interface EIParameters { rate: string; maximumInsurableEarnings: string; maximumPremium: string }
export interface TaxYear {
  year: number;
  federal: FederalTaxParameters;
  provinces: Partial<Record<Province, ProvincialTaxParameters>>;
  cpp: CPPParameters;
  ei: EIParameters;
  sourceURLs: string[];
}
