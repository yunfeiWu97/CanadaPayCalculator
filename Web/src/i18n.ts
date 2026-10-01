import { glossary, zhStrings } from './zh-content';

type Language = 'en' | 'zh';
interface OriginalText { original: string; applied: string }
interface OriginalAttribute { original: string; applied: string }
const preferenceKey = 'CanadaPayCalculator.web.language.v1';
const originals = new WeakMap<Text, OriginalText>();
const attributes = new WeakMap<Element, Map<string, OriginalAttribute>>();
let language: Language = 'en';
let initialized = false;
let tooltip: HTMLDivElement;
let openHelp: HTMLButtonElement | null = null;

const fieldNames: Record<string, string> = {
  'annual salary': '年薪', 'hourly rate': '基本时薪', 'regular hours per week': '每周正常工时',
  'hours per week': '每周正常工时', 'overtime hours': '每周加班工时',
  'overtime hours per week': '每周加班工时', 'overtime multiplier': '加班工资倍数',
  'weekly hours (maximum 168)': '每周总工时（最多 168 小时）',
  'overtime multiplier (1 to 10)': '加班工资倍数（1 至 10）', 'annual earnings': '年度税前收入',
  'income type': '收入类型', 'pension contribution': '员工养老金缴款', 'RRSP contribution': 'RRSP 缴款',
  'union dues': '工会会费', 'health benefits': '医疗及牙科福利扣款',
  'other pre-tax deduction': '其他税前扣款', 'other after-tax deduction': '其他税后扣款',
  'employer pension contribution': '雇主养老金缴款',
};

function translatedField(field: string): string {
  const percentage = field.match(/^(.+) percentage \(0 to 100\)$/);
  if (percentage) return `${translatedField(percentage[1])}比例（0% 至 100%）`;
  return fieldNames[field] ?? zhStrings[field] ?? field;
}

function translatedCore(text: string): string {
  if (Object.hasOwn(zhStrings, text)) return zhStrings[text];
  let match: RegExpMatchArray | null;
  if ((match = text.match(/^(\d+) tax year$/))) return `${match[1]} 纳税年度`;
  if ((match = text.match(/^(Weekly|Bi-weekly|Semi-monthly|Monthly) · (\d+) \/ year$/))) return `${zhStrings[match[1]] ?? match[1]} · 每年 ${match[2]} 次`;
  if ((match = text.match(/^· (Weekly|Bi-weekly|Semi-monthly|Monthly)$/))) return `· ${zhStrings[match[1]] ?? match[1]}`;
  if ((match = text.match(/^Of (\d+) paycheques · January to December$/))) return `全年共 ${match[1]} 次发薪 · 1 月至 12 月`;
  if ((match = text.match(/^(\d+) enabled$/))) return `已启用 ${match[1]} 项`;
  if ((match = text.match(/^· Paycheque (\d+) of (\d+)$/))) return `· 全年 ${match[2]} 次中的第 ${match[1]} 次`;
  if ((match = text.match(/^Calculated from your last edit: (annual salary|hourly earnings)\. Equivalent input amounts are rounded for display\.$/))) return `当前按最近编辑的${match[1] === 'annual salary' ? '年薪' : '时薪收入'}计算。换算后的输入金额会四舍五入显示。`;
  if ((match = text.match(/^Estimated take-home pay (.+) for paycheque (\d+)\.$/))) return `第 ${match[2]} 次发薪的预计到手金额为 ${match[1]}。`;
  if ((match = text.match(/^Annual amounts averaged over (.+) actual working hours \((.+) regular \+ (.+) overtime per week × 52\)\. Overtime pay is included in the average\.$/))) return `按全年实际工作 ${match[1]} 小时平均换算（每周正常工时 ${match[2]} + 加班工时 ${match[3]}，共 52 周）。此平均时薪已包含加班收入。`;
  if ((match = text.match(/^Hourly equivalents unavailable\. (.+)$/))) return `暂时无法换算时薪。${translatedCore(match[1])}`;
  if ((match = text.match(/^Enter a valid, nonnegative value for (.+)\.$/))) return `请为${translatedField(match[1])}输入有效的非负数。`;
  if ((match = text.match(/^Take-home amounts are (.+)\. The estimate is within \$0\.01 of your target; cent rounding and payroll limits can prevent an exact match\.$/))) {
    const period = match[1].match(/^for paycheque (\d+) of (\d+)$/);
    const basis = period ? `全年 ${period[2]} 次中的第 ${period[1]} 次发薪` : match[1] === 'per year' ? '全年' : '每月平均';
    return `以上到手金额对应${basis}。估算与目标相差不超过 $0.01；按分取整及工资扣款上限可能使两者无法完全一致。`;
  }
  if ((match = text.match(/^T4127 payroll formulas — (January|July) (\d+)$/))) return `CRA T4127 工资扣款公式 — ${match[2]} 年 ${match[1] === 'January' ? '1' : '7'} 月`;
  if ((match = text.match(/^Manitoba · (\d+)$/))) return `曼尼托巴省 · ${match[1]}`;
  return text;
}

function translatedText(text: string): string {
  const core = text.trim();
  if (!core) return text;
  const translated = translatedCore(core);
  return `${text.match(/^\s*/)?.[0] ?? ''}${translated}${text.match(/\s*$/)?.[0] ?? ''}`;
}

function excluded(element: Element | null): boolean {
  return !element || Boolean(element.closest('script, style, input, textarea, [data-no-translate]'));
}

function translateNode(node: Text): void {
  if (excluded(node.parentElement)) return;
  let record = originals.get(node);
  if (!record) {
    record = { original: node.data, applied: node.data };
    originals.set(node, record);
  } else if (node.data !== record.applied && node.data !== record.original) {
    record.original = node.data;
  }
  record.applied = language === 'zh' ? translatedText(record.original) : record.original;
  if (node.data !== record.applied) node.data = record.applied;
}

function translateAttributes(element: Element): void {
  if (excluded(element)) return;
  let record = attributes.get(element);
  if (!record) { record = new Map(); attributes.set(element, record); }
  for (const name of ['aria-label', 'placeholder', 'title', 'alt']) {
    const value = element.getAttribute(name);
    if (value === null) continue;
    let entry = record.get(name);
    if (!entry) { entry = { original: value, applied: value }; record.set(name, entry); }
    else if (value !== entry.applied && value !== entry.original) entry.original = value;
    entry.applied = language === 'zh' ? translatedText(entry.original) : entry.original;
    if (value !== entry.applied) element.setAttribute(name, entry.applied);
  }
}

function hideTooltip(): void {
  tooltip.hidden = true;
  openHelp?.removeAttribute('aria-describedby');
  openHelp?.setAttribute('aria-expanded', 'false');
  openHelp = null;
}

function positionTooltip(button: HTMLButtonElement): void {
  const rect = button.getBoundingClientRect();
  const width = Math.min(300, window.innerWidth - 24);
  tooltip.style.width = `${width}px`;
  tooltip.style.left = `${Math.max(12, Math.min(rect.left - width / 2 + rect.width / 2, window.innerWidth - width - 12))}px`;
  const height = tooltip.getBoundingClientRect().height;
  tooltip.style.top = `${Math.max(12, rect.bottom + height + 12 <= window.innerHeight ? rect.bottom + 8 : rect.top - height - 8)}px`;
}

function showTooltip(button: HTMLButtonElement, index: number): void {
  const concept = glossary[index];
  if (!concept) return;
  hideTooltip();
  const host = button.closest('dialog') ?? document.body;
  host.append(tooltip);
  const title = document.createElement('strong');
  title.textContent = concept.title;
  const description = document.createElement('p');
  description.textContent = concept.description;
  tooltip.replaceChildren(title, description);
  tooltip.hidden = false;
  openHelp = button;
  button.setAttribute('aria-describedby', 'concept-tooltip');
  button.setAttribute('aria-expanded', 'true');
  positionTooltip(button);
}

const contributionConcepts: Record<string, string> = {
  pension: 'pension', employerMatch: 'employerMatch', rrsp: 'rrsp',
  unionDues: 'unionDues', health: 'health', otherPreTax: 'preTax', otherAfterTax: 'afterTax',
};

function addConceptHelp(): void {
  const titleSelector = '.deductions-body .contribution-title';
  // Help belongs only to optional deduction titles. Clean up markers left in
  // other labels or paragraphs, and remove every marker in English mode.
  document.querySelectorAll<HTMLButtonElement>('.concept-help').forEach(button => {
    if (language !== 'zh' || !button.parentElement?.matches(titleSelector)) {
      if (openHelp === button) hideTooltip();
      button.remove();
    }
  });
  if (language !== 'zh') return;

  document.querySelectorAll<HTMLElement>(titleSelector).forEach(host => {
    const contribution = host.closest('.contribution');
    const input = contribution?.querySelector<HTMLInputElement>('input[data-contribution]');
    const requestedKey = host.dataset.helpConcept ?? input?.dataset.contribution ?? '';
    const key = contributionConcepts[requestedKey] ?? host.dataset.helpConcept;
    if (!key) return;
    const index = glossary.findIndex(concept => concept.key === key);
    if (index < 0) return;
    const concept = glossary[index];
    const existing = [...host.querySelectorAll<HTMLButtonElement>('.concept-help')];
    const kept = existing.find(button => button.dataset.concept === key);
    existing.filter(button => button !== kept).forEach(button => {
      if (openHelp === button) hideTooltip();
      button.remove();
    });
    if (kept) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'concept-help';
    button.dataset.concept = key;
    button.dataset.noTranslate = '';
    button.textContent = '?';
    button.setAttribute('aria-label', `解释：${concept.title}`);
    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('pointerenter', () => showTooltip(button, index));
    button.addEventListener('pointerleave', () => { if (document.activeElement !== button) hideTooltip(); });
    button.addEventListener('focus', () => showTooltip(button, index));
    button.addEventListener('blur', hideTooltip);
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      showTooltip(button, index);
    });
    host.append(button);
  });
}

/** Preserve original text and input drafts; update only display text and labels. */
export function initI18n(): void {
  if (initialized) return;
  initialized = true;
  try { language = localStorage.getItem(preferenceKey) === 'zh' ? 'zh' : 'en'; } catch { language = 'en'; }
  tooltip = document.createElement('div');
  tooltip.id = 'concept-tooltip';
  tooltip.className = 'concept-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.dataset.noTranslate = '';
  tooltip.hidden = true;
  document.body.append(tooltip);
  const observer = new MutationObserver(() => applyLanguage());
  const observe = (): void => observer.observe(document.body, {
    subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ['aria-label', 'placeholder', 'title', 'alt'],
  });
  function applyLanguage(): void {
    observer.disconnect();
    if (openHelp && !document.contains(openHelp)) hideTooltip();
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en-CA';
    document.title = language === 'zh' ? '加拿大薪资计算器 · 曼尼托巴省 2026' : 'Canada Pay Calculator · Manitoba 2026';
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) translateNode(node as Text);
    document.querySelectorAll('[aria-label], [placeholder], [title], [alt]').forEach(translateAttributes);
    addConceptHelp();
    document.getElementById('language-zh')?.setAttribute('aria-pressed', String(language === 'zh'));
    document.getElementById('language-en')?.setAttribute('aria-pressed', String(language === 'en'));
    observe();
  }
  for (const nextLanguage of ['zh', 'en'] as const) {
    document.getElementById(`language-${nextLanguage}`)?.addEventListener('click', () => {
      hideTooltip();
      language = nextLanguage;
      try { localStorage.setItem(preferenceKey, language); } catch { /* Session choice still works. */ }
      applyLanguage();
    });
  }
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !tooltip.hidden) {
      event.preventDefault(); event.stopPropagation(); hideTooltip();
    }
  }, true);
  document.addEventListener('click', event => {
    if (!tooltip.hidden && event.target instanceof Element && !event.target.closest('.concept-help, #concept-tooltip')) hideTooltip();
  });
  const repositionOpenTooltip = (): void => {
    if (!openHelp || tooltip.hidden) return;
    const rect = openHelp.getBoundingClientRect();
    if (!document.contains(openHelp) || rect.width === 0 || rect.bottom < 0 || rect.top > window.innerHeight) {
      hideTooltip();
      return;
    }
    // Keyboard focus and browser auto-scroll can follow pointerenter. Keep the
    // explanation attached to its visible control instead of closing it.
    positionTooltip(openHelp);
  };
  window.addEventListener('resize', repositionOpenTooltip);
  window.addEventListener('scroll', repositionOpenTooltip, true);
  document.addEventListener('close', hideTooltip, true);
  applyLanguage();
}
