import './styles.css';
import { Decimal } from './payroll/decimal';
import { calculate } from './payroll/calculator';
import { solveGrossForNet } from './payroll/reverse';
import {
  defaultInput, defaultEarnings, payFrequencyLabels, payPeriods, contributionKeys,
  type ContributionKey, type PayrollInput, type PayrollResult,
} from './payroll/models';
import taxConfiguration from './data/tax2026.json';
import { initPwa } from './pwa';
import { initI18n } from './i18n';

const storageKey = 'CanadaPayCalculator.web.payrollInput.v1';
const contributions: { key: ContributionKey; title: string; note: string }[] = [
  { key: 'pension', title: 'Registered Pension Plan', note: 'Employee RPP contribution · pre-tax' },
  { key: 'employerMatch', title: 'Employer pension match', note: 'Employer savings · separate from your take-home' },
  { key: 'rrsp', title: 'Payroll RRSP', note: 'Employee RRSP contribution · pre-tax' },
  { key: 'unionDues', title: 'Union dues', note: 'Income-tax deductible dues' },
  { key: 'health', title: 'Health & dental benefits', note: 'Employee premium · after-tax' },
  { key: 'otherPreTax', title: 'Other pre-tax deduction', note: 'Employer-authorized income-tax deduction' },
  { key: 'otherAfterTax', title: 'Other after-tax deduction', note: 'Deducted from take-home pay' },
];

/** Exact cents stay decimal strings; Number is never used to format money. */
function money(value: Decimal | string): string {
  const raw = typeof value === 'string' ? value : value.toFixed(2);
  const [whole, fraction = '00'] = raw.replace(/^-/, '').split('.');
  return `${raw.startsWith('-') ? '−' : ''}$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction.padEnd(2, '0')}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

function persistableNumber(raw: string, fallback: string): string {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) return fallback;
  try {
    const value = new Decimal(raw);
    return value.isFinite() && value.gte(0) ? value.toFixed() : fallback;
  } catch {
    return fallback;
  }
}

function inputNumber(raw: string, label: string): Decimal {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw.trim())) throw new Error(`Enter a valid, nonnegative value for ${label}.`);
  const value = new Decimal(raw.trim());
  if (!value.isFinite() || value.lt(0) || value.gt(100_000_000)) throw new Error(`Enter a valid, nonnegative value for ${label}.`);
  return value;
}

function workingHours(): { paidHours: Decimal; workedHours: Decimal } {
  const regular = inputNumber(input.hoursPerWeek, 'regular hours per week');
  const overtime = inputNumber(input.overtimeHours, 'overtime hours per week');
  const total = regular.plus(overtime);
  if (total.gt(168)) throw new Error('Enter no more than 168 total working hours per week.');
  let multiplier = new Decimal(1);
  if (overtime.gt(0)) {
    multiplier = inputNumber(input.overtimeMultiplier, 'overtime multiplier');
    if (multiplier.lt(1) || multiplier.gt(10)) throw new Error('Enter an overtime multiplier from 1 to 10.');
  }
  return { paidHours: regular.plus(overtime.times(multiplier)).times(52), workedHours: total.times(52) };
}

function displayInputAmount(value: Decimal, places: number): string {
  return value.toFixed(places).replace(/\.?0+$/, '');
}

function syncIncomeAmounts(): void {
  const { paidHours } = workingHours();
  if (input.incomeType === 'annualSalary') {
    const annual = inputNumber(input.annualSalary, 'annual salary');
    if (paidHours.isZero()) {
      byId<HTMLInputElement>('hourlyRate').value = '';
      return;
    }
    input.hourlyRate = annual.div(paidHours).toFixed();
    byId<HTMLInputElement>('hourlyRate').value = displayInputAmount(new Decimal(input.hourlyRate), 4);
  } else {
    input.annualSalary = inputNumber(input.hourlyRate, 'hourly rate').times(paidHours).toFixed();
    byId<HTMLInputElement>('annualSalary').value = displayInputAmount(new Decimal(input.annualSalary), 2);
  }
}

function restoreInput(): PayrollInput {
  const fallback = defaultInput();
  try {
    const stored = localStorage.getItem(storageKey);
    if (!stored || stored.length > 12_000) return fallback;
    const saved: unknown = JSON.parse(stored);
    if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) return fallback;
    const raw = saved as Record<string, unknown>;
    if (!['annualSalary', 'hourly'].includes(String(raw.incomeType)) || raw.province !== 'manitoba' ||
        !Object.hasOwn(payPeriods, String(raw.frequency)) || typeof raw.selectedPayPeriod !== 'number' ||
        !Number.isInteger(raw.selectedPayPeriod)) return fallback;
    const fields = ['annualSalary', 'hourlyRate', 'hoursPerWeek', 'overtimeHours', 'overtimeMultiplier'] as const;
    for (const field of fields) {
      if (typeof raw[field] !== 'string' || (raw[field] as string).length > 80) return fallback;
      fallback[field] = raw[field] as string;
    }
    fallback.incomeType = raw.incomeType as PayrollInput['incomeType'];
    fallback.frequency = raw.frequency as PayrollInput['frequency'];
    fallback.selectedPayPeriod = Math.max(1, Math.min(raw.selectedPayPeriod, payPeriods[fallback.frequency]));
    if (typeof raw.deductions !== 'object' || raw.deductions === null) return defaultInput();
    for (const key of contributionKeys) {
      const item = (raw.deductions as Record<string, unknown>)[key];
      if (typeof item !== 'object' || item === null) return defaultInput();
      const contribution = item as Record<string, unknown>;
      if (typeof contribution.isEnabled !== 'boolean' || typeof contribution.amount !== 'string' ||
          contribution.amount.length > 80 || !['percentOfGross', 'fixedPerPeriod'].includes(String(contribution.mode))) return defaultInput();
      fallback.deductions[key] = {
        isEnabled: contribution.isEnabled,
        mode: contribution.mode as PayrollInput['deductions'][ContributionKey]['mode'],
        amount: contribution.amount,
      };
    }
    if (raw.earnings !== undefined) {
      if (typeof raw.earnings !== 'object' || raw.earnings === null || Array.isArray(raw.earnings)) return defaultInput();
      const savedEarnings = raw.earnings as Record<string, unknown>;
      const restoredEarnings = defaultEarnings();
      for (const key of ['vacationPay', 'controlledTips', 'statHolidayPay'] as const) {
        const savedItem = savedEarnings[key];
        if (typeof savedItem !== 'object' || savedItem === null || Array.isArray(savedItem)) return defaultInput();
        const item = savedItem as Record<string, unknown>;
        if (typeof item.isEnabled !== 'boolean' || typeof item.amount !== 'string' || item.amount.length > 80) return defaultInput();
        restoredEarnings[key].isEnabled = item.isEnabled;
        restoredEarnings[key].amount = item.amount;
        if (key === 'vacationPay') {
          if (!['percentOfEligibleEarnings', 'fixedPerPeriod'].includes(String(item.mode)) || typeof item.includeControlledTips !== 'boolean') return defaultInput();
          restoredEarnings.vacationPay.mode = item.mode as typeof restoredEarnings.vacationPay.mode;
          restoredEarnings.vacationPay.includeControlledTips = item.includeControlledTips;
        }
        if (key === 'statHolidayPay') {
          if (!['selectedPeriod', 'everyPeriod'].includes(String(item.scope))) return defaultInput();
          restoredEarnings.statHolidayPay.scope = item.scope as typeof restoredEarnings.statHolidayPay.scope;
        }
      }
      fallback.earnings = restoredEarnings;
    }
    fallback.linkedIncome = true;
    calculate(fallback);
    return fallback;
  } catch {
    return defaultInput();
  }
}

let input = restoreInput();
input.linkedIncome = true;
let reverseInput = defaultInput();
reverseInput.linkedIncome = false;
const app = document.querySelector<HTMLDivElement>('#app')!;
const leaf = '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="m16 3 3.2 7 4.4-2.2-.7 6.2 6.1.2-4.3 4.4 1.4 3.8-8.5-1.2V29h-3.2v-7.8L5.9 22.4l1.4-3.8L3 14.2l6.1-.2-.7-6.2 4.4 2.2L16 3Z" fill="currentColor"/></svg>';
const chevron = '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m6 8 4 4 4-4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const info = '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.4"/><path d="M10 9v4m0-7v.3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';

function numericField(id: string, label: string, suffix: string, prefix = '', note = '', attributes = ''): string {
  return `<div class="field"><label for="${id}">${label}</label><div class="number-field">${prefix ? `<span aria-hidden="true">${prefix}</span>` : ''}<input id="${id}" name="${id}" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" maxlength="80" ${attributes}${note ? ` aria-describedby="${id}-hint"` : ''}><span class="field-unit" aria-hidden="true">${suffix}</span></div>${note ? `<p class="field-hint" id="${id}-hint">${note}</p>` : ''}</div>`;
}

function earningsMarkup(prefix = '', standalone = false): string {
  const toggle = (key: string, title: string, note: string): string => `<label class="toggle-label" for="${prefix}${key}-enabled"><span><span class="earning-title">${title}</span><span class="field-hint">${note}</span></span><span class="toggle"><input id="${prefix}${key}-enabled" type="checkbox" data-earning="${key}" data-property="isEnabled"><span aria-hidden="true"></span></span></label>`;
  return `<details class="${standalone ? 'card input-card ' : ''}additional-earnings" id="${prefix}additional-earnings-details"><summary><span>Additional earnings</span>${chevron}</summary><div class="earnings-body"><p class="field-hint">Optional amounts paid on top of your base salary or hourly earnings.</p><div class="earning-editor">${toggle('vacationPay', 'Vacation pay paid in cash', 'Extra vacation pay on each paycheque')}<div id="${prefix}vacationPay-fields" hidden><p class="field-hint">Use only vacation pay paid as extra cash on each paycheque. Leave this off for accrued vacation or paid leave already included in your salary.</p><div class="field-grid earning-fields"><div class="field"><label for="${prefix}vacationPay-mode">Amount type</label><div class="select-field"><select id="${prefix}vacationPay-mode" data-earning="vacationPay" data-property="mode"><option value="percentOfEligibleEarnings">% of eligible earnings</option><option value="fixedPerPeriod">Fixed per cheque</option></select>${chevron}</div></div>${numericField(`${prefix}vacationPay-amount`, 'Vacation pay amount', '%', '', '', 'data-earning="vacationPay" data-property="amount"')}</div><div class="vacation-presets" id="${prefix}vacation-presets"><span>Quick choice</span><button type="button" id="${prefix}vacation-four" data-vacation-preset="4">4%</button><button type="button" id="${prefix}vacation-six" data-vacation-preset="6">6%</button><span>or enter your own percentage</span></div><div id="${prefix}vacation-eligibility-fields"><p class="field-hint">Eligible earnings include regular pay and statutory holiday pay, and exclude overtime.</p><label class="check-option" for="${prefix}vacationPay-includeTips"><input id="${prefix}vacationPay-includeTips" type="checkbox" data-earning="vacationPay" data-property="includeControlledTips"><span>Include controlled tips in vacation-pay earnings</span></label><p class="field-hint">Select this only when your employer includes these tips in its vacation-pay calculation.</p></div></div></div><div class="earning-editor">${toggle('controlledTips', 'Controlled tips', 'Recurring tips paid through your employer')}<div id="${prefix}controlledTips-fields" hidden>${numericField(`${prefix}controlledTips-amount`, 'Controlled tips per paycheque', 'CAD / cheque', '$', 'Enter recurring employer-controlled tips paid through payroll. Direct tips received from customers are not included.', 'data-earning="controlledTips" data-property="amount"')}</div></div><div class="earning-editor">${toggle('statHolidayPay', 'Statutory holiday pay', 'An actual extra amount from your paystub')}<div id="${prefix}statHolidayPay-fields" hidden><div class="field-grid earning-fields">${numericField(`${prefix}statHolidayPay-amount`, 'Statutory holiday pay amount', 'CAD', '$', '', 'data-earning="statHolidayPay" data-property="amount"')}<div class="field"><label for="${prefix}statHolidayPay-scope">Apply this amount</label><div class="select-field"><select id="${prefix}statHolidayPay-scope" data-earning="statHolidayPay" data-property="scope"><option value="selectedPeriod">Selected paycheque only</option><option value="everyPeriod">Every paycheque</option></select>${chevron}</div></div></div><p class="field-hint">Enter the actual extra amount. Selected paycheque only is the default, so it is not repeated across the year. Choose Every paycheque only for a recurring amount.</p></div></div></div></details>`;
}

function reverseDeductionsMarkup(): string {
  return `<details class="card deductions-card" id="reverse-deductions-details"><summary><span class="section-heading"><span class="step-number">03</span><span class="summary-heading">Pension & other deductions</span></span><span class="deductions-summary"><span id="reverse-deductions-count">Optional</span>${chevron}</span></summary><div class="deductions-body"><p class="field-hint">Employee deductions reduce take-home pay. Employer contributions are shown separately.</p>${contributions.map(({ key, title, note }) => `<div class="contribution"><label class="toggle-label" for="reverse-${key}-enabled"><span><span class="contribution-title" data-help-concept="${key}">${title}</span><span class="field-hint">${note}</span></span><span class="toggle"><input id="reverse-${key}-enabled" data-contribution="${key}" data-property="isEnabled" type="checkbox"><span aria-hidden="true"></span></span></label><div class="contribution-fields" id="reverse-${key}-fields" hidden><div class="field-grid contribution-grid"><div class="field"><label for="reverse-${key}-mode">Amount type</label><div class="select-field"><select id="reverse-${key}-mode" data-contribution="${key}" data-property="mode"><option value="percentOfGross">% of gross</option><option value="fixedPerPeriod">Fixed per cheque</option></select>${chevron}</div></div><div class="field"><label for="reverse-${key}-amount">${title} amount</label><div class="number-field"><input id="reverse-${key}-amount" data-contribution="${key}" data-property="amount" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" maxlength="80"><span class="field-unit" id="reverse-${key}-unit" aria-hidden="true">%</span></div></div></div></div></div>`).join('')}<p class="schedule-note">Pre-tax deductions reduce income-tax withholding, not CPP or EI. Confirm eligibility and contribution limits with your employer.</p></div></details>`;
}

app.innerHTML = `
  <a class="skip-link" href="#calculator">Skip to calculator</a>
  <header class="site-header"><a class="brand" href="./" aria-label="Canada Pay Calculator home"><span class="brand-mark">${leaf}</span><span>Canada<span class="brand-light">Pay</span><small>CALCULATOR</small></span></a><div class="header-actions"><div class="language-toggle" id="language-toggle" data-no-translate role="group" aria-label="Language / 语言"><button type="button" id="language-zh" aria-pressed="false" aria-label="简体中文">简体中文</button><span aria-hidden="true">/</span><button type="button" id="language-en" aria-pressed="true" aria-label="English">ENG</button></div><span class="privacy-tag"><span class="status-dot"></span>Private by design</span><button class="button button-secondary install-button" type="button" data-install-help>Add to Home Screen</button><button class="icon-button" type="button" id="about-button" aria-label="How estimates work">${info}</button></div></header>
  <div id="pwa-update-banner" class="update-banner" hidden role="status"><span>A new version is ready.</span><button type="button" id="pwa-update-button" class="text-button">Update app</button></div>
  <main id="calculator" class="main-shell">
    <section class="introduction" aria-labelledby="page-title"><div class="eyebrow"><span class="tiny-maple">${leaf}</span>MADE FOR YOUR EVERYDAY</div><h1 id="page-title">Make sense of your pay.</h1><p>Your earnings, deductions, and take-home. Clearly.</p><div class="context-pills"><label class="province-pill" for="province"><span>Province</span><select id="province" name="province" aria-label="Province of employment"><option value="manitoba">Manitoba</option></select>${chevron}</label><span class="year-pill">${taxConfiguration.year} tax year</span><span class="currency-note">All amounts in CAD</span></div></section>
    <div class="mode-tabs" role="tablist" aria-label="Calculation mode"><button type="button" id="mode-forward" role="tab" aria-selected="true" aria-controls="forward-panel">Calculate take-home</button><button type="button" id="mode-reverse" role="tab" aria-selected="false" aria-controls="reverse-panel" tabindex="-1">Find gross pay</button></div><section id="forward-panel" role="tabpanel" aria-labelledby="mode-forward"><div class="calculator-grid">
      <form id="input-form" class="inputs" novalidate aria-label="Your payroll inputs">
        <section class="card input-card" id="income-card" aria-labelledby="income-heading"><div class="section-heading"><span class="step-number">01</span><h2 id="income-heading">Your income</h2></div><fieldset class="income-switch"><legend class="visually-hidden">Choose an amount to edit</legend><label><input type="radio" name="incomeType" value="annualSalary"><span>Edit annual salary</span></label><label><input type="radio" name="incomeType" value="hourly"><span>Edit hourly wage</span></label></fieldset><div id="salary-fields">${numericField('annualSalary', 'Annual salary', 'CAD / year', '$', 'Base annual income includes regular pay and overtime, before extra vacation pay, statutory holiday pay or controlled tips.')}</div><div id="hourly-fields" class="linked-hourly-fields">${numericField('hourlyRate', 'Base hourly rate', 'CAD / hour', '$')}<div class="field-grid hours-pair" id="regular-hours-pair">${numericField('hoursPerWeek', 'Regular hours per week', 'hours')}<div id="biweekly-hours-field" hidden>${numericField('hoursPerBiweek', 'Regular hours every two weeks', 'hours / 2 weeks')}</div></div><details class="overtime-details"><summary>Include overtime ${chevron}</summary><div class="field-grid hours-pair" id="overtime-hours-pair">${numericField('overtimeHours', 'Overtime hours per week', 'hours')}<div id="biweekly-overtime-field" hidden>${numericField('overtimeHoursPerBiweek', 'Overtime hours every two weeks', 'hours / 2 weeks')}</div></div>${numericField('overtimeMultiplier', 'Overtime multiplier', '× regular rate')}<p class="field-hint">Hours are in addition to regular weekly hours. A multiplier of 1.5 means time and a half.</p></details><p class="field-hint" id="income-basis-hint">Edit either amount to update the other. Assumes the same hours each week for 52 paid weeks.</p><p class="field-hint" id="income-driver" aria-live="polite"></p></div>${earningsMarkup()}</section>
        <div id="mobile-hero-slot" hidden></div><section class="card input-card" aria-labelledby="frequency-heading"><div class="section-heading"><span class="step-number">02</span><h2 id="frequency-heading">Your pay schedule</h2></div><div class="field"><label for="frequency">Pay frequency</label><div class="select-field"><select name="frequency" id="frequency">${Object.entries(payFrequencyLabels).map(([key, label]) => `<option value="${key}">${label} · ${payPeriods[key as keyof typeof payPeriods]} / year</option>`).join('')}</select>${chevron}</div><p class="field-hint" id="frequency-hint"></p></div><div class="period-control"><div><label for="selectedPayPeriod">Paycheque in the year</label><p id="period-count" class="field-hint"></p></div><div class="stepper"><button type="button" id="previous-period" aria-label="Previous paycheque">−</button><input id="selectedPayPeriod" name="selectedPayPeriod" type="number" min="1" step="1" inputmode="numeric" aria-describedby="period-count"><button type="button" id="next-period" aria-label="Next paycheque">+</button></div></div><p class="schedule-note">CPP, CPP2, and EI can change when annual limits are reached. This estimate starts with no earlier earnings on January 1.</p></section>
        <details class="card deductions-card" id="deductions-details"><summary><span class="section-heading"><span class="step-number">03</span><span class="summary-heading">Pension & other deductions</span></span><span class="deductions-summary"><span id="deductions-count">Optional</span>${chevron}</span></summary><div class="deductions-body"><p class="field-hint">Employee deductions reduce take-home pay. Employer contributions are shown separately.</p>${contributions.map(({ key, title, note }) => `<div class="contribution"><label class="toggle-label" for="${key}-enabled"><span><span class="contribution-title" data-help-concept="${key}">${title}</span><span class="field-hint">${note}</span></span><span class="toggle"><input id="${key}-enabled" data-contribution="${key}" data-property="isEnabled" type="checkbox"><span aria-hidden="true"></span></span></label><div class="contribution-fields" id="${key}-fields" hidden><div class="field-grid contribution-grid"><div class="field"><label for="${key}-mode">Amount type</label><div class="select-field"><select id="${key}-mode" data-contribution="${key}" data-property="mode"><option value="percentOfGross">% of gross</option><option value="fixedPerPeriod">Fixed per cheque</option></select>${chevron}</div></div><div class="field"><label for="${key}-amount">${title} amount</label><div class="number-field"><input id="${key}-amount" data-contribution="${key}" data-property="amount" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" maxlength="80"><span class="field-unit" id="${key}-unit" aria-hidden="true">%</span></div></div></div></div></div>`).join('')}<p class="schedule-note">Pre-tax deductions reduce income-tax withholding, not CPP or EI. Confirm eligibility and contribution limits with your employer.</p></div></details>
<div class="input-footer"><span id="save-status" aria-live="polite">Inputs saved on this device</span><button class="text-button" id="reset-button" type="button">Reset inputs</button></div>
      </form>
      <aside class="results-column" aria-label="Your pay estimate"><div class="sticky-result"><div id="result-content"></div><div id="validation-card" class="card validation-card" hidden role="status" aria-live="polite"><span class="validation-icon">!</span><h2>Check your inputs</h2><p id="validation-message"></p><p class="field-hint">Your estimate will appear when all active amounts are valid.</p></div><div id="calculation-announcement" class="visually-hidden" aria-live="polite" aria-atomic="true"></div></div></aside>
    </div>
    <section id="annual-summary" class="annual-summary" aria-label="Your year at a glance"></section>
    <section id="estimate-notes" class="estimate-notes" hidden aria-labelledby="notes-heading"><h2 id="notes-heading">Estimate notes</h2><ul id="notes-list"></ul></section>
    </section><section id="reverse-panel" role="tabpanel" aria-labelledby="mode-reverse" hidden><div class="calculator-grid reverse-grid"><form id="reverse-form" class="inputs" novalidate aria-label="Gross-pay estimate inputs">
<section class="card input-card reverse-card" aria-labelledby="reverse-heading"><div class="section-heading"><span class="step-number">01</span><h2 id="reverse-heading">Start with take-home pay</h2></div><p class="field-hint">Set a take-home target, then choose the pay schedule and deductions for this estimate.</p><div class="field-grid reverse-fields">${numericField('targetNet', 'Target take-home pay', 'CAD', '$')}<div class="field"><label for="targetNetBasis">Target period</label><div class="select-field"><select id="targetNetBasis" name="targetNetBasis"><option value="perPay">Per paycheque</option><option value="monthly">Average month</option><option value="annual">Full year</option></select>${chevron}</div></div></div><button class="button button-primary" type="button" id="find-gross-button">Find gross pay</button><p class="field-hint" id="reverse-status" role="status" aria-live="polite">Uses the selected paycheque when that target period is chosen.</p></section>
      <section class="card input-card" aria-labelledby="reverse-frequency-heading"><div class="section-heading"><span class="step-number">02</span><h2 id="reverse-frequency-heading">Your pay schedule</h2></div><div class="field"><label for="reverse-frequency">Pay frequency</label><div class="select-field"><select id="reverse-frequency" name="reverse-frequency">${Object.entries(payFrequencyLabels).map(([key, label]) => `<option value="${key}">${label} · ${payPeriods[key as keyof typeof payPeriods]} / year</option>`).join('')}</select>${chevron}</div><p id="reverse-frequency-hint" class="field-hint"></p></div><div class="period-control"><div><label for="reverse-selectedPayPeriod">Paycheque in the year</label><p id="reverse-period-count" class="field-hint"></p></div><div class="stepper"><button type="button" id="reverse-previous-period" aria-label="Previous paycheque">−</button><input id="reverse-selectedPayPeriod" name="reverse-selectedPayPeriod" type="number" min="1" step="1" inputmode="numeric" aria-describedby="reverse-period-count"><button type="button" id="reverse-next-period" aria-label="Next paycheque">+</button></div></div><p class="schedule-note">CPP, CPP2, and EI can change when annual limits are reached. This estimate starts with no earlier earnings on January 1.</p></section>
      ${earningsMarkup('reverse-', true)}${reverseDeductionsMarkup()}<div class="input-footer"><span class="field-hint">These settings are separate from your take-home calculation.</span><button type="button" id="reverse-reset-button" class="text-button">Reset inputs</button></div>
      </form><aside class="results-column" aria-label="Your gross-pay estimate"><div class="sticky-result"><section id="reverse-empty" class="card reverse-empty"><span class="eyebrow">START WITH YOUR GOAL</span><h2>Your gross-pay estimate</h2><p>Set your target, schedule and deductions, then select Find gross pay.</p></section><div id="reverse-result" class="reverse-output" hidden></div></div></aside></div></section>    <footer class="site-footer"><div><p>Built to bring clarity to payday.</p><span>Your inputs and calculations stay on this device. No account needed.</span></div><button id="methodology-button" class="text-button" type="button">Methodology & reference ${info}</button><p class="estimate-disclaimer">An estimate of payroll withholding. Your employer’s TD1 amounts, benefits, year-to-date earnings, and rounding can change your actual pay. Final annual income tax may differ.</p><div class="footer-status"><span id="network-status" aria-live="polite"></span><span>Manitoba · ${taxConfiguration.year}</span></div></footer>
  </main>
  <dialog id="about-dialog" aria-labelledby="about-title"><div class="dialog-header"><h2 id="about-title">About the estimate</h2><button type="button" class="icon-button close-dialog" aria-label="Close methodology">×</button></div><div class="dialog-body"><p class="dialog-intro">The same payroll rules and reference cases as CanadaPayCalculator for iPhone, available in your browser.</p><section><h3>Payroll rules</h3><dl class="simple-dl"><div><dt>Tax year</dt><dd>${taxConfiguration.year}</dd></div><div><dt>Province of employment</dt><dd>Manitoba</dd></div></dl><p>Rates checked September 30, 2026. CRA’s July update leaves Manitoba’s January payroll rules in place.</p></section><section><h3>How estimates work</h3><p>Each cheque uses CRA’s annualized withholding formulas, federal and Manitoba brackets, basic personal amounts, the Canada employment amount, and CPP and EI tax credits.</p><p>A full year of cheques is calculated in order. CPP, CPP2, and EI change as annual limits are reached. Annual take-home is the sum of those cheques; monthly take-home is that total divided by 12.</p></section><section><h3>Assumptions</h3><p>One employer, regular pensionable and insurable wages, CPP eligibility throughout the year, and basic personal tax claims. Basic personal amounts are adjusted for higher incomes.</p><p>Hourly earnings assume 52 paid weeks. Overtime hours repeat each week. Employee RPP, payroll RRSP, union dues, and authorized pre-tax deductions reduce income-tax withholding; CPP and EI still use gross wages.</p><p>Health, dental, and other after-tax deductions reduce take-home. Employer pension contributions are separate retirement savings. RRSP and pension room is not checked. Employer matching uses your configured amount; individual plan rules may differ.</p></section><section><h3>Additional earnings</h3><p>Cash vacation pay uses CRA’s bonus withholding method in this January 1 full-year simulation. Employer year-to-date payroll settings can produce a different payment.</p><p>Statutory holiday pay is an entered paystub amount, not an automatic entitlement calculation. It applies only to the selected paycheque unless you choose Every paycheque.</p><p>Enter recurring employer-controlled tips paid through payroll. Direct tips received from customers are not included.</p></section><section><h3>Reference paycheque</h3><p>$65,000 annual salary in Manitoba, paid semi-monthly: 24 cheques per year, with no optional deductions.</p><div id="reference-comparison"></div><p class="field-hint">The estimate column is calculated afresh using the shared payroll configuration.</p></section><section><h3>Official sources</h3><ul class="source-links" id="source-links"></ul><p>Payroll withholding can differ from your final tax assessment. Use CRA’s calculator and your employer’s records when checking an actual payment.</p></section><section><h3>Privacy & offline use</h3><p>Calculations run in your browser. Valid inputs are saved locally on this device. No salary or deduction data is sent to a server. GitHub Pages hosts the static app.</p><p>After your first visit, the app is available offline. Updates appear when you reconnect; you choose when to load them.</p></section></div><div class="dialog-footer"><button type="button" class="button button-primary close-dialog">Done</button></div></dialog>
  <dialog id="install-dialog" aria-labelledby="install-title"><div class="dialog-header"><h2 id="install-title">A little closer to payday.</h2><button type="button" class="icon-button close-dialog" aria-label="Close install guide">×</button></div><div class="dialog-body"><div class="install-app-mark">${leaf}</div><p class="dialog-intro">Keep Canada Pay on your Home Screen. Free, private, and ready when you are.</p><h3>On iPhone or iPad</h3><ol class="install-steps"><li><span>1</span><div>Open this site in <strong>Safari</strong>.</div></li><li><span>2</span><div>Tap <strong>Share</strong> <span class="share-icon" aria-hidden="true">↥</span>. If needed, open the <strong>Page Menu</strong> first.</div></li><li><span>3</span><div>Choose <strong>Add to Home Screen</strong>. Keep <strong>Open as Web App</strong> enabled if offered, then tap <strong>Add</strong>.</div></li></ol><p class="field-hint">If you do not see the option, scroll down in the Share menu or open the link directly in Safari.</p><h3>On Android or desktop</h3><button id="android-install" class="button button-primary" type="button" hidden>Install Canada Pay</button><p>Use your browser’s <strong>Install app</strong> or <strong>Add to Home Screen</strong> option. In browsers without installation support, bookmark this page.</p><p class="schedule-note">Visit once while online to make the calculator available offline.</p></div><div class="dialog-footer"><button type="button" class="button button-primary close-dialog">Got it</button></div></dialog>
  <dialog id="reset-dialog" class="small-dialog" aria-labelledby="reset-title"><div class="dialog-header"><h2 id="reset-title">Reset your inputs?</h2></div><div class="dialog-body"><p>Return to the $65,000 annual salary example and remove all optional contributions.</p></div><div class="dialog-footer"><button type="button" class="button button-secondary close-dialog">Cancel</button><button type="button" class="button button-primary" id="confirm-reset">Reset inputs</button></div></dialog>
`;

const byId = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const form = byId<HTMLFormElement>('input-form');
const reverseForm = byId<HTMLFormElement>('reverse-form');
const mobileLayout = window.matchMedia('(max-width: 680px)');
const salaryKeys = ['annualSalary', 'hourlyRate', 'hoursPerWeek', 'overtimeHours', 'overtimeMultiplier'] as const;
const frequencyNotes = {
  weekly: 'Once each week: 52 paycheques per year.',
  biweekly: 'Every two weeks: 26 paycheques per year. Some months have three.',
  semiMonthly: 'Twice each month: 24 paycheques per year.',
  monthly: 'Once each month: 12 paycheques per year.',
};

function syncHourPairs(): void {
  const biweekly = input.frequency === 'biweekly';
  byId('biweekly-hours-field').hidden = !biweekly;
  byId('biweekly-overtime-field').hidden = !biweekly;
  byId('regular-hours-pair').classList.toggle('is-biweekly', biweekly);
  byId('overtime-hours-pair').classList.toggle('is-biweekly', biweekly);
  for (const [weeklyKey, biweeklyId] of [['hoursPerWeek', 'hoursPerBiweek'], ['overtimeHours', 'overtimeHoursPerBiweek']] as const) {
    if (document.activeElement?.id === biweeklyId) continue;
    try { byId<HTMLInputElement>(biweeklyId).value = inputNumber(input[weeklyKey], weeklyKey).times(2).toFixed(); }
    catch { byId<HTMLInputElement>(biweeklyId).value = ''; }
  }
}

function updateEarningsControls(scenario: PayrollInput, prefix = ''): void {
  const earnings = scenario.earnings ??= defaultEarnings();
  for (const key of ['vacationPay', 'controlledTips', 'statHolidayPay'] as const) byId(`${prefix}${key}-fields`).hidden = !earnings[key].isEnabled;
  const isPercent = earnings.vacationPay.mode === 'percentOfEligibleEarnings';
  byId(`${prefix}vacation-presets`).hidden = !isPercent;
  byId(`${prefix}vacation-eligibility-fields`).hidden = !isPercent;
  byId(`${prefix}vacationPay-amount`).closest('.number-field')!.querySelector('.field-unit')!.textContent = isPercent ? '%' : 'CAD / cheque';
}

function populateEarningsControls(scenario: PayrollInput, prefix = ''): void {
  const earnings = scenario.earnings ??= defaultEarnings();
  for (const key of ['vacationPay', 'controlledTips', 'statHolidayPay'] as const) {
    byId<HTMLInputElement>(`${prefix}${key}-enabled`).checked = earnings[key].isEnabled;
    byId<HTMLInputElement>(`${prefix}${key}-amount`).value = earnings[key].amount;
  }
  byId<HTMLSelectElement>(`${prefix}vacationPay-mode`).value = earnings.vacationPay.mode;
  byId<HTMLInputElement>(`${prefix}vacationPay-includeTips`).checked = earnings.vacationPay.includeControlledTips;
  byId<HTMLSelectElement>(`${prefix}statHolidayPay-scope`).value = earnings.statHolidayPay.scope;
  if (earnings.vacationPay.isEnabled || earnings.controlledTips.isEnabled || earnings.statHolidayPay.isEnabled) byId<HTMLDetailsElement>(`${prefix}additional-earnings-details`).open = true;
  updateEarningsControls(scenario, prefix);
}

function editEarning(scenario: PayrollInput, target: HTMLInputElement | HTMLSelectElement): boolean {
  const key = target.dataset.earning;
  if (key !== 'vacationPay' && key !== 'controlledTips' && key !== 'statHolidayPay') return false;
  const earnings = scenario.earnings ??= defaultEarnings();
  if (target.dataset.property === 'isEnabled' && target instanceof HTMLInputElement) earnings[key].isEnabled = target.checked;
  else if (target.dataset.property === 'amount') earnings[key].amount = target.value.replace(/,/g, '').trim();
  else if (key === 'vacationPay' && target.dataset.property === 'mode') earnings.vacationPay.mode = target.value as typeof earnings.vacationPay.mode;
  else if (key === 'vacationPay' && target.dataset.property === 'includeControlledTips' && target instanceof HTMLInputElement) earnings.vacationPay.includeControlledTips = target.checked;
  else if (key === 'statHolidayPay' && target.dataset.property === 'scope') earnings.statHolidayPay.scope = target.value as typeof earnings.statHolidayPay.scope;
  return true;
}

function updateControlVisibility(): void {
  byId('salary-fields').hidden = false;
  byId('hourly-fields').hidden = false;
  byId('income-driver').textContent = `Calculated from your last edit: ${input.incomeType === 'annualSalary' ? 'annual salary' : 'hourly earnings'}. Equivalent input amounts are rounded for display.`;
  const periodInput = byId<HTMLInputElement>('selectedPayPeriod');
  periodInput.max = String(payPeriods[input.frequency]);
  byId('frequency-hint').textContent = frequencyNotes[input.frequency];
  byId('period-count').textContent = `Of ${payPeriods[input.frequency]} paycheques · January to December`;
  byId<HTMLButtonElement>('previous-period').disabled = input.selectedPayPeriod <= 1 || !Number.isInteger(input.selectedPayPeriod);
  byId<HTMLButtonElement>('next-period').disabled = input.selectedPayPeriod >= payPeriods[input.frequency] || !Number.isInteger(input.selectedPayPeriod);
  let enabled = 0;
  for (const key of contributionKeys) {
    const contribution = input.deductions[key];
    byId(`${key}-fields`).hidden = !contribution.isEnabled;
    byId(`${key}-unit`).textContent = contribution.mode === 'percentOfGross' ? '%' : 'CAD / pay';
    if (contribution.isEnabled) enabled += 1;
  }
  byId('deductions-count').textContent = enabled === 0 ? 'Optional' : `${enabled} enabled`;
  syncHourPairs();
  updateEarningsControls(input);
}

function populateControls(): void {
  for (const key of salaryKeys) byId<HTMLInputElement>(key).value = input[key];
  form.querySelectorAll<HTMLInputElement>('input[name="incomeType"]').forEach(radio => { radio.checked = radio.value === input.incomeType; });
  byId<HTMLSelectElement>('frequency').value = input.frequency;
  byId<HTMLInputElement>('selectedPayPeriod').value = String(input.selectedPayPeriod);
  for (const key of contributionKeys) {
    byId<HTMLInputElement>(`${key}-enabled`).checked = input.deductions[key].isEnabled;
    byId<HTMLSelectElement>(`${key}-mode`).value = input.deductions[key].mode;
    byId<HTMLInputElement>(`${key}-amount`).value = input.deductions[key].amount;
  }
  if (input.overtimeHours !== '0') form.querySelector<HTMLDetailsElement>('.overtime-details')!.open = true;
  if (contributionKeys.some(key => input.deductions[key].isEnabled)) byId<HTMLDetailsElement>('deductions-details').open = true;
  try { syncIncomeAmounts(); } catch { /* A saved salary can remain valid while its hours are corrected. */ }
  populateEarningsControls(input);
  updateControlVisibility();
}

function amountRow(label: string, value: Decimal, options: { deduction?: boolean; emphasis?: boolean; small?: boolean; id?: string } = {}): string {
  return `<div class="amount-row${options.emphasis ? ' emphasis' : ''}${options.small ? ' small' : ''}"><dt>${label}</dt><dd${options.id ? ` id="${options.id}"` : ''}>${options.deduction && !value.isZero() ? '−' : ''}${money(value)}</dd></div>`;
}

function placeTakeHomeHero(): void {
  const hero = document.getElementById('forward-take-home');
  const slot = byId('mobile-hero-slot');
  if (!hero) { slot.hidden = true; return; }
  if (mobileLayout.matches) {
    slot.hidden = false;
    slot.append(hero);
  } else {
    byId('result-content').prepend(hero);
    slot.hidden = true;
  }
}
mobileLayout.addEventListener('change', placeTakeHomeHero);

function setMode(mode: 'forward' | 'reverse'): void {
  for (const name of ['forward', 'reverse'] as const) {
    const selected = name === mode;
    byId(`${name}-panel`).hidden = !selected;
    byId(`mode-${name}`).setAttribute('aria-selected', String(selected));
    byId(`mode-${name}`).tabIndex = selected ? 0 : -1;
  }
}
for (const mode of ['forward', 'reverse'] as const) {
  byId(`mode-${mode}`).addEventListener('click', () => setMode(mode));
  byId(`mode-${mode}`).addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'forward' : event.key === 'End' ? 'reverse' : mode === 'forward' ? 'reverse' : 'forward';
    setMode(next);
    byId(`mode-${next}`).focus();
  });
}

function renderResults(result: PayrollResult): void {
  byId('mobile-hero-slot').replaceChildren();
  const pay = result.currentPeriod;
  const annual = result.annual;
  const hasExtraEarnings = !pay.vacationGross.isZero() || !pay.statHolidayGross.isZero() || !pay.controlledTipsGross.isZero();
  const grossEarningsRows = !pay.overtimeGross.isZero() || hasExtraEarnings ? `<div class="nested-amounts">${amountRow('Regular earnings', pay.regularGross, { small: true, id: 'regular-gross' })}${!pay.overtimeGross.isZero() ? amountRow('Overtime earnings', pay.overtimeGross, { small: true, id: 'overtime-gross' }) : ''}${!pay.vacationGross.isZero() ? amountRow('Vacation pay paid in cash', pay.vacationGross, { small: true, id: 'vacation-gross' }) : ''}${!pay.statHolidayGross.isZero() ? amountRow('Statutory holiday pay', pay.statHolidayGross, { small: true, id: 'stat-holiday-gross' }) : ''}${!pay.controlledTipsGross.isZero() ? amountRow('Controlled tips', pay.controlledTipsGross, { small: true, id: 'controlled-tips-gross' }) : ''}</div>` : '';
  const hasVacationTax = !pay.vacationIncomeTax.isZero();
  const taxMethodRows = amountRow(hasVacationTax ? 'Federal income tax on regular earnings' : 'Federal income tax', pay.federalTax, { deduction: true, small: true }) + amountRow(hasVacationTax ? 'Manitoba income tax on regular earnings' : 'Manitoba income tax', pay.provincialTax, { deduction: true, small: true }) + (hasVacationTax ? amountRow('Vacation payout withholding', pay.vacationIncomeTax, { deduction: true, small: true, id: 'vacation-income-tax' }) : '');
  const annualExtraEarnings = !annual.vacationGross.isZero() || !annual.statHolidayGross.isZero() || !annual.controlledTipsGross.isZero() ? `<div class="annual-extra-earnings"><dl>${amountRow('Base annual earnings', annual.regularGross.plus(annual.overtimeGross))}${!annual.vacationGross.isZero() ? amountRow('Annual cash vacation pay', annual.vacationGross, { id: 'annual-vacation-gross' }) : ''}${!annual.statHolidayGross.isZero() ? amountRow('Annual statutory holiday pay', annual.statHolidayGross, { id: 'annual-stat-holiday-gross' }) : ''}${!annual.controlledTipsGross.isZero() ? amountRow('Annual controlled tips', annual.controlledTipsGross, { id: 'annual-controlled-tips-gross' }) : ''}</dl></div>` : '';
  const annualCaption = input.earnings?.statHolidayPay.isEnabled && input.earnings.statHolidayPay.scope === 'selectedPeriod'
    ? 'Full-year forecast of base earnings, recurring extras and the selected-cheque holiday amount. Payroll withholding may differ from your final tax return.'
    : 'A full-year forecast with the same earnings and selections all year. Income tax is payroll withholding and may differ from your final tax return.';
  let hourlyEquivalents: string;
  try {
    const { workedHours } = workingHours();
    if (workedHours.isZero()) throw new Error('Enter positive working hours to see hourly equivalents.');
    hourlyEquivalents = `<div class="hourly-equivalents"><dl><div class="amount-row"><dt>Gross hourly equivalent</dt><dd id="gross-hourly-equivalent">${money(annual.gross.div(workedHours))}</dd></div><div class="amount-row emphasis"><dt>Net hourly equivalent</dt><dd id="net-hourly-equivalent">${money(annual.net.div(workedHours))}</dd></div></dl><p class="field-hint" id="worked-hours-caption">Annual amounts averaged over ${workedHours.toFixed(2).replace(/\.00$/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',')} actual working hours (${input.hoursPerWeek} regular + ${input.overtimeHours} overtime per week × 52). Overtime pay is included in the average.</p></div>`;
  } catch (error) {
    hourlyEquivalents = `<p class="field-hint hourly-unavailable" id="worked-hours-caption">Hourly equivalents unavailable. ${escapeHtml(error instanceof Error ? error.message : 'Enter valid positive working hours.')}</p>`;
  }
  const optionalRows: [string, Decimal][] = [
    ['Employee pension (RPP)', pay.pension], ['Payroll RRSP', pay.rrsp], ['Union dues', pay.unionDues],
    ['Health & dental', pay.health], ['Other pre-tax deduction', pay.otherPreTax], ['Other after-tax deduction', pay.otherAfterTax],
  ];
  const ratio = pay.gross.isZero() ? 0 : Math.max(0, Math.min(100, pay.net.div(pay.gross).times(100).toNumber()));
  byId('result-content').innerHTML = `<section class="take-home-card" id="forward-take-home" aria-labelledby="take-home-heading"><div class="hero-top"><span class="eyebrow">YOUR TAKE-HOME PAY</span><span class="estimate-pill">Estimate</span></div><h2 id="take-home-heading" class="hero-amount">${money(pay.net)}</h2><p class="hero-period">${payFrequencyLabels[input.frequency]} <span>· Paycheque ${pay.periodNumber} of ${payPeriods[input.frequency]}</span></p><div class="pay-bar" aria-hidden="true"><span style="width:${ratio.toFixed(2)}%"></span></div><div class="hero-comparison"><div><span>Gross per pay</span><strong>${money(pay.gross)}</strong></div><div><span>Total deductions</span><strong>${money(pay.totalDeductions)}</strong></div></div></section><section class="card breakdown-card" aria-labelledby="breakdown-heading"><div class="breakdown-heading"><h2 id="breakdown-heading">Where your pay goes</h2><span>CAD / cheque</span></div><dl>${amountRow('Gross pay', pay.gross, { emphasis: true })}${grossEarningsRows}</dl><div class="breakdown-divider"></div><details class="tax-detail"><summary><span>Income tax</span><strong>−${money(pay.incomeTax)}</strong>${chevron}</summary><dl class="nested-amounts">${taxMethodRows}</dl></details><dl>${amountRow('CPP', pay.cpp, { deduction: true })}${!pay.cpp2.isZero() ? amountRow('CPP2', pay.cpp2, { deduction: true }) : ''}${amountRow('EI', pay.ei, { deduction: true })}</dl>${!pay.optionalDeductions.isZero() ? `<div class="breakdown-divider"></div><p class="breakdown-subheading">Your optional deductions</p><dl>${optionalRows.filter(([, amount]) => !amount.isZero()).map(([label, amount]) => amountRow(label, amount, { deduction: true })).join('')}</dl>` : ''}<div class="breakdown-divider"></div><dl>${amountRow('Take-home pay', pay.net, { emphasis: true })}</dl>${!pay.employerMatch.isZero() ? `<div class="employer-note"><dl>${amountRow('Employer pension', pay.employerMatch)}</dl><p>Added to your pension separately. Your take-home is unchanged.</p></div>` : ''}</section>`;
  byId('annual-summary').innerHTML = `<div class="annual-title"><div><span class="eyebrow">THE BIGGER PICTURE</span><h2>Your year at a glance</h2></div><span class="annual-year">${result.taxYear}</span></div><div class="annual-grid"><div class="annual-overview"><p class="metric-label">Average monthly take-home</p><p class="monthly-amount">${money(result.monthlyNet)}</p><p class="field-hint">Annual take-home divided by 12. The number of paycheques in a month can vary.</p><dl>${amountRow('Annual gross income', annual.gross)}${amountRow('Annual take-home', annual.net, { emphasis: true })}</dl>${annualExtraEarnings}${hourlyEquivalents}</div><div class="annual-deductions"><h3>Annual deductions</h3><dl>${amountRow('Income tax withheld', annual.incomeTax, { deduction: true })}${amountRow('CPP', annual.cpp, { deduction: true })}${amountRow('CPP2', annual.cpp2, { deduction: true })}${amountRow('EI', annual.ei, { deduction: true })}${amountRow('Employee retirement', annual.employeeRetirementContributions, { deduction: true })}${amountRow('Other employee deductions', annual.unionDues.plus(annual.health).plus(annual.otherPreTax).plus(annual.otherAfterTax), { deduction: true })}</dl></div><div class="annual-savings"><h3>Beyond take-home</h3><p class="metric-label">Effective deduction rate</p><p class="rate-amount">${result.effectiveDeductionRate.times(100).toFixed(1)}<span>%</span></p><p class="field-hint">Includes income tax, statutory contributions, and optional employee deductions.</p><div class="savings-note"><span class="savings-icon">${leaf}</span><div><p class="metric-label">Employer pension contribution</p><strong>${money(annual.employerMatch)}<span> / year</span></strong><p class="field-hint">Separate retirement savings, in addition to your employee contributions.</p></div></div></div></div><p class="annual-caption">${annualCaption}</p>`;
  byId('estimate-notes').hidden = result.warnings.length === 0;
  byId('notes-list').innerHTML = result.warnings.map(warning => `<li>${escapeHtml(warning)}</li>`).join('');
  placeTakeHomeHero();
}

let announcementTimer: ReturnType<typeof setTimeout> | undefined;
let reverseJob = 0;

function clearReverse(): void {
  reverseJob += 1;
  byId('reverse-result').hidden = true;
  byId('reverse-result').replaceChildren();
  byId('reverse-empty').hidden = false;
  byId('reverse-status').textContent = 'Uses your current schedule and deductions. Select Find gross pay to update the estimate.';
  delete byId('reverse-status').dataset.state;
  byId<HTMLButtonElement>('find-gross-button').disabled = false;
}

function recalculate(): void {
  if (announcementTimer !== undefined) clearTimeout(announcementTimer);
  try {
    const result = calculate(input);
    byId('validation-card').hidden = true;
    byId('result-content').hidden = false;
    byId('annual-summary').hidden = false;
    renderResults(result);
    announcementTimer = setTimeout(() => {
      byId('calculation-announcement').textContent = `Estimated take-home pay ${money(result.currentPeriod.net)} for paycheque ${result.currentPeriod.periodNumber}.`;
    }, 500);
    try {
      const saved = structuredClone(input);
      const defaults = defaultInput();
      // Inactive half-edited drafts must not replace useful stored numbers.
      for (const key of salaryKeys) saved[key] = persistableNumber(saved[key], defaults[key]);
      for (const key of contributionKeys) saved.deductions[key].amount = persistableNumber(saved.deductions[key].amount, '0');
      if (saved.earnings) {
        for (const key of ['vacationPay', 'controlledTips', 'statHolidayPay'] as const) saved.earnings[key].amount = persistableNumber(saved.earnings[key].amount, key === 'vacationPay' ? '4' : '0');
      }
      localStorage.setItem(storageKey, JSON.stringify(saved));
      byId('save-status').textContent = 'Inputs saved on this device';
    } catch {
      byId('save-status').textContent = 'Inputs are available for this session';
    }
  } catch (error) {
    byId('mobile-hero-slot').replaceChildren();
    byId('mobile-hero-slot').hidden = true;
    byId('result-content').hidden = true;
    byId('result-content').replaceChildren();
    byId('annual-summary').hidden = true;
    byId('annual-summary').replaceChildren();
    byId('estimate-notes').hidden = true;
    byId('validation-card').hidden = false;
    byId('validation-message').textContent = error instanceof Error ? error.message : 'Enter valid amounts to see your take-home estimate.';
    byId('calculation-announcement').textContent = '';
    byId('save-status').textContent = 'Last valid inputs saved on this device';
  }
}

form.addEventListener('submit', event => event.preventDefault());
form.addEventListener('input', event => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
  if (target.name === 'incomeType') {
    // Choosing a field alone does not change payroll rounding or the saved source.
    byId<HTMLInputElement>(target.value === 'annualSalary' ? 'annualSalary' : 'hourlyRate').focus();
    return;
  }
  if (editEarning(input, target)) {
    updateEarningsControls(input);
    recalculate();
    return;
  }
  const key = target.dataset.contribution as ContributionKey | undefined;
  if (key && contributionKeys.includes(key)) {
    const contribution = input.deductions[key];
    if (target.dataset.property === 'isEnabled' && target instanceof HTMLInputElement) contribution.isEnabled = target.checked;
    else if (target.dataset.property === 'mode') contribution.mode = target.value as typeof contribution.mode;
    else if (target.dataset.property === 'amount') contribution.amount = target.value.replace(/,/g, '').trim();
  } else if (target.name === 'frequency') {
    input.frequency = target.value as PayrollInput['frequency'];
    input.selectedPayPeriod = Number.isInteger(input.selectedPayPeriod) ? Math.max(1, Math.min(input.selectedPayPeriod, payPeriods[input.frequency])) : 1;
    byId<HTMLInputElement>('selectedPayPeriod').value = String(input.selectedPayPeriod);
  } else if (target.name === 'selectedPayPeriod') input.selectedPayPeriod = target.value === '' ? NaN : Number(target.value);
  else if (salaryKeys.includes(target.name as typeof salaryKeys[number]) || target.name === 'hoursPerBiweek' || target.name === 'overtimeHoursPerBiweek') {
    const weeklyKey = target.name === 'hoursPerBiweek' ? 'hoursPerWeek' : target.name === 'overtimeHoursPerBiweek' ? 'overtimeHours' : target.name as typeof salaryKeys[number];
    let value = target.value.replace(/,/g, '').trim();
    if (target.name === 'hoursPerBiweek' || target.name === 'overtimeHoursPerBiweek') {
      try { value = inputNumber(value, target.name === 'hoursPerBiweek' ? 'regular hours every two weeks' : 'overtime hours every two weeks').div(2).toFixed(); }
      catch { value = ''; }
      byId<HTMLInputElement>(weeklyKey).value = value;
    }
    input[weeklyKey] = value;
    input.incomeType = weeklyKey === 'annualSalary' ? 'annualSalary' : 'hourly';
    form.querySelectorAll<HTMLInputElement>('input[name="incomeType"]').forEach(radio => { radio.checked = radio.value === input.incomeType; });
    try { syncIncomeAmounts(); } catch {
      byId<HTMLInputElement>(input.incomeType === 'annualSalary' ? 'hourlyRate' : 'annualSalary').value = '';
    }
  }
  updateControlVisibility();
  recalculate();
});

function stepPeriod(delta: number): void {
  input.selectedPayPeriod = Math.max(1, Math.min(payPeriods[input.frequency], input.selectedPayPeriod + delta));
  byId<HTMLInputElement>('selectedPayPeriod').value = String(input.selectedPayPeriod);
  updateControlVisibility();
  recalculate();
}
byId('previous-period').addEventListener('click', () => stepPeriod(-1));
byId('next-period').addEventListener('click', () => stepPeriod(1));

function updateReverseControls(): void {
  const periods = payPeriods[reverseInput.frequency];
  byId<HTMLInputElement>('reverse-selectedPayPeriod').max = String(periods);
  byId('reverse-frequency-hint').textContent = frequencyNotes[reverseInput.frequency];
  byId('reverse-period-count').textContent = `Of ${periods} paycheques · January to December`;
  byId<HTMLButtonElement>('reverse-previous-period').disabled = reverseInput.selectedPayPeriod <= 1 || !Number.isInteger(reverseInput.selectedPayPeriod);
  byId<HTMLButtonElement>('reverse-next-period').disabled = reverseInput.selectedPayPeriod >= periods || !Number.isInteger(reverseInput.selectedPayPeriod);
  let enabled = 0;
  for (const key of contributionKeys) {
    const contribution = reverseInput.deductions[key];
    byId(`reverse-${key}-fields`).hidden = !contribution.isEnabled;
    byId(`reverse-${key}-unit`).textContent = contribution.mode === 'percentOfGross' ? '%' : 'CAD / pay';
    if (contribution.isEnabled) enabled += 1;
  }
  byId('reverse-deductions-count').textContent = enabled === 0 ? 'Optional' : `${enabled} enabled`;
  updateEarningsControls(reverseInput, 'reverse-');
}

function populateReverseControls(): void {
  byId<HTMLSelectElement>('reverse-frequency').value = reverseInput.frequency;
  byId<HTMLInputElement>('reverse-selectedPayPeriod').value = String(reverseInput.selectedPayPeriod);
  for (const key of contributionKeys) {
    byId<HTMLInputElement>(`reverse-${key}-enabled`).checked = reverseInput.deductions[key].isEnabled;
    byId<HTMLSelectElement>(`reverse-${key}-mode`).value = reverseInput.deductions[key].mode;
    byId<HTMLInputElement>(`reverse-${key}-amount`).value = reverseInput.deductions[key].amount;
  }
  populateEarningsControls(reverseInput, 'reverse-');
  updateReverseControls();
}

reverseForm.addEventListener('submit', event => event.preventDefault());
reverseForm.addEventListener('input', event => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
  clearReverse();
  if (editEarning(reverseInput, target)) {
    updateEarningsControls(reverseInput, 'reverse-');
    return;
  }
  const key = target.dataset.contribution as ContributionKey | undefined;
  if (key && contributionKeys.includes(key)) {
    const contribution = reverseInput.deductions[key];
    if (target.dataset.property === 'isEnabled' && target instanceof HTMLInputElement) contribution.isEnabled = target.checked;
    else if (target.dataset.property === 'mode') contribution.mode = target.value as typeof contribution.mode;
    else if (target.dataset.property === 'amount') contribution.amount = target.value.replace(/,/g, '').trim();
  } else if (target.id === 'reverse-frequency') {
    reverseInput.frequency = target.value as PayrollInput['frequency'];
    reverseInput.selectedPayPeriod = Number.isInteger(reverseInput.selectedPayPeriod) ? Math.max(1, Math.min(reverseInput.selectedPayPeriod, payPeriods[reverseInput.frequency])) : 1;
    byId<HTMLInputElement>('reverse-selectedPayPeriod').value = String(reverseInput.selectedPayPeriod);
  } else if (target.id === 'reverse-selectedPayPeriod') reverseInput.selectedPayPeriod = target.value === '' ? NaN : Number(target.value);
  updateReverseControls();
});
for (const [id, delta] of [['reverse-previous-period', -1], ['reverse-next-period', 1]] as const) {
  byId(id).addEventListener('click', () => {
    clearReverse();
    reverseInput.selectedPayPeriod = Math.max(1, Math.min(payPeriods[reverseInput.frequency], reverseInput.selectedPayPeriod + delta));
    byId<HTMLInputElement>('reverse-selectedPayPeriod').value = String(reverseInput.selectedPayPeriod);
    updateReverseControls();
  });
}
byId('reverse-reset-button').addEventListener('click', () => {
  reverseInput = defaultInput();
  reverseInput.linkedIncome = false;
  byId<HTMLInputElement>('targetNet').value = '';
  byId<HTMLSelectElement>('targetNetBasis').value = 'perPay';
  byId<HTMLDetailsElement>('reverse-deductions-details').open = false;
  byId<HTMLDetailsElement>('reverse-additional-earnings-details').open = false;
  populateReverseControls();
  clearReverse();
});

for (const prefix of ['', 'reverse-']) {
  for (const [suffix, value] of [['four', '4'], ['six', '6']] as const) {
    byId(`${prefix}vacation-${suffix}`).addEventListener('click', () => {
      const scenario = prefix ? reverseInput : input;
      const earnings = scenario.earnings ??= defaultEarnings();
      earnings.vacationPay.isEnabled = true;
      earnings.vacationPay.mode = 'percentOfEligibleEarnings';
      earnings.vacationPay.amount = value;
      populateEarningsControls(scenario, prefix);
      if (prefix) clearReverse(); else recalculate();
    });
  }
}

byId('find-gross-button').addEventListener('click', async () => {
  clearReverse();
  const job = reverseJob;
  const button = byId<HTMLButtonElement>('find-gross-button');
  const status = byId('reverse-status');
  const basis = byId<HTMLSelectElement>('targetNetBasis').value as 'annual' | 'monthly' | 'perPay';
  const target = byId<HTMLInputElement>('targetNet').value.replace(/,/g, '').trim();
  button.disabled = true;
  status.textContent = 'Finding a gross salary estimate…';
  status.dataset.state = 'waiting';
  await new Promise(resolve => setTimeout(resolve, 0));
  if (job !== reverseJob) return;
  try {
    const solution = solveGrossForNet(reverseInput, target, basis);
    const label = basis === 'annual' ? 'per year' : basis === 'monthly' ? 'per average month' : `for paycheque ${reverseInput.selectedPayPeriod} of ${payPeriods[reverseInput.frequency]}`;
    byId('reverse-result').innerHTML = `<section class="take-home-card" aria-labelledby="reverse-gross-heading"><div class="hero-top"><span class="eyebrow">ESTIMATED BASE SALARY</span><span class="estimate-pill">Estimate</span></div><h2 id="reverse-gross-heading" class="hero-amount">${money(solution.annualSalary)}</h2><p class="hero-period">Base salary per year <span>· ${payFrequencyLabels[reverseInput.frequency]}</span></p><div class="hero-comparison"><div><span>Total gross per pay</span><strong id="reverse-period-gross">${money(solution.result.currentPeriod.gross)}</strong></div><div><span>Estimated take-home</span><strong id="reverse-achieved-net">${money(solution.achievedNet)}</strong></div></div></section><section class="card breakdown-card"><div class="breakdown-heading"><h2>Target comparison</h2></div><dl>${amountRow('Estimated base annual salary', solution.annualSalary, { emphasis: true })}${amountRow('Annual total gross income', solution.result.annual.gross)}${amountRow('Target take-home', solution.targetNet)}${amountRow('Estimated take-home', solution.achievedNet, { emphasis: true })}</dl><p class="field-hint">Take-home amounts are ${label}. The estimate is within $0.01 of your target; cent rounding and payroll limits can prevent an exact match.</p><p class="field-hint">Your take-home calculation has not been changed.</p></section>`;
    if (solution.result.warnings.length > 0) {
      const notes = document.createElement('section');
      notes.className = 'card breakdown-card';
      notes.setAttribute('aria-label', 'Estimate notes');
      notes.innerHTML = `<h2>Estimate notes</h2>${solution.result.warnings.map(warning => `<p class="field-hint">${escapeHtml(warning)}</p>`).join('')}`;
      byId('reverse-result').append(notes);
    }
    byId('reverse-empty').hidden = true;
    byId('reverse-result').hidden = false;
    status.textContent = 'Gross-pay estimate found.';
    status.dataset.state = 'success';
  } catch (error) {
    byId('reverse-result').hidden = true;
    byId('reverse-result').replaceChildren();
    status.textContent = error instanceof Error ? error.message : 'Unable to find an estimate. Check the target and your deductions.';
    status.dataset.state = 'error';
  } finally {
    if (job === reverseJob) button.disabled = false;
  }
});

document.querySelectorAll<HTMLDialogElement>('dialog').forEach(dialog => {
  dialog.querySelectorAll('.close-dialog').forEach(button => button.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('click', event => {
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    }
  });
});
const aboutDialog = byId<HTMLDialogElement>('about-dialog');
byId('about-button').addEventListener('click', () => aboutDialog.showModal());
byId('methodology-button').addEventListener('click', () => aboutDialog.showModal());
byId('reset-button').addEventListener('click', () => byId<HTMLDialogElement>('reset-dialog').showModal());
byId('confirm-reset').addEventListener('click', () => {
  input = defaultInput();
  input.linkedIncome = true;
  byId<HTMLDetailsElement>('additional-earnings-details').open = false;
  byId<HTMLDetailsElement>('deductions-details').open = false;
  form.querySelector<HTMLDetailsElement>('.overtime-details')!.open = false;
  populateControls();
  recalculate();
  byId<HTMLDialogElement>('reset-dialog').close();
});

const reference = calculate(defaultInput()).currentPeriod;
const referenceRows: [string, string, Decimal][] = [
  ['Gross', '2708.33', reference.gross], ['CPP', '152.47', reference.cpp], ['EI', '44.15', reference.ei],
  ['Income tax', '477.15', reference.incomeTax], ['Take-home', '2034.56', reference.net],
];
byId('reference-comparison').innerHTML = `<table class="reference-table"><caption class="visually-hidden">Supplied reference compared with a fresh estimate</caption><thead><tr><th scope="col">Per cheque</th><th scope="col">Reference</th><th scope="col">Estimate</th></tr></thead><tbody>${referenceRows.map(([label, expected, actual]) => `<tr><th scope="row">${label}</th><td>${money(expected)}</td><td>${money(actual)}</td></tr>`).join('')}</tbody></table>`;
byId('source-links').innerHTML = taxConfiguration.sourceURLs.map(source => {
  const title = source.includes('t4127-jan') ? 'T4127 payroll formulas — January 2026' : source.includes('t4127-jul') ? 'T4127 payroll formulas — July 2026' : source.includes('t4032') ? 'T4032 Manitoba payroll tables' : 'CRA payroll source';
  return `<li><a href="${escapeHtml(source)}" target="_blank" rel="noopener noreferrer">${title}<span aria-hidden="true"> ↗</span><span class="visually-hidden"> (opens in a new tab)</span></a></li>`;
}).join('') + '<li><a href="https://www.canada.ca/en/revenue-agency/services/e-services/digital-services-businesses/payroll-deductions-online-calculator.html" target="_blank" rel="noopener noreferrer">CRA Payroll Deductions Online Calculator<span aria-hidden="true"> ↗</span><span class="visually-hidden"> (opens in a new tab)</span></a></li>';
const additionalEarningsSources = [
  ['Manitoba vacation pay', 'https://www.gov.mb.ca/labour/standards/doc,vacations,factsheet.html'],
  ['Manitoba statutory holidays', 'https://www.gov.mb.ca/labour/standards/doc,gen-holidays-after-april-30-07,factsheet.html'],
  ['CRA vacation pay and public holidays', 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/special-payments/vacation-pay-public-holidays.html'],
  ['CRA controlled and direct tips', 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/calculating-deductions/determining-tax-treatment/tips.html'],
] as const;
byId('source-links').insertAdjacentHTML('beforeend', additionalEarningsSources.map(([title, url]) => `<li><a href="${url}" target="_blank" rel="noopener noreferrer">${title}<span aria-hidden="true"> ↗</span><span class="visually-hidden"> (opens in a new tab)</span></a></li>`).join(''));
populateControls();
populateReverseControls();
recalculate();
initPwa();
initI18n();
