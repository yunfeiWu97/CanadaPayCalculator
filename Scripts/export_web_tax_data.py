#!/usr/bin/env python3
"""Export the existing Swift tax configuration, without maintaining another rate table.

The parser intentionally accepts only the explicit literals used by the current
configuration. A new Swift expression fails loudly instead of silently exporting
stale data. Native runtime code remains unchanged.
"""
from pathlib import Path
import argparse
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'Sources/PayrollCore/TaxConfiguration.swift'
DESTINATION = ROOT / 'Web/src/data/tax2026.json'


def number(expression):
    expression = expression.strip()
    wrapped = re.fullmatch(r'd\("([0-9.]+)"\)', expression)
    if wrapped:
        return wrapped.group(1)
    if re.fullmatch(r'[0-9_]+(?:\.[0-9]+)?', expression):
        return expression.replace('_', '')
    raise ValueError(f'Unsupported Swift numeric expression: {expression}')


def fields(text, names):
    result = {}
    for name in names:
        pattern = rf'\b{name}:\s*(d\("[0-9.]+"\)|[0-9_]+(?:\.[0-9]+)?)'
        matches = re.findall(pattern, text)
        if len(matches) != 1:
            raise ValueError(f'Expected one literal for {name}, found {len(matches)}')
        result[name] = number(matches[0])
    return result


def tax_parameters(text, federal=False):
    brackets = []
    literal = r'(d\("[0-9.]+"\)|[0-9_]+(?:\.[0-9]+)?)'
    pattern = rf'TaxBracket\(lowerBound:\s*{literal},\s*rate:\s*{literal},\s*payrollConstant:\s*{literal}\)'
    for lower, rate, constant in re.findall(pattern, text):
        brackets.append(dict(lowerBound=number(lower), rate=number(rate), payrollConstant=number(constant)))
    if not brackets:
        raise ValueError('No Swift tax brackets found')
    result = dict(brackets=brackets, basicPersonalAmount=fields(
        text, ['maximum', 'minimum', 'phaseoutStart', 'phaseoutEnd']))
    if federal:
        result.update(fields(text, ['employmentAmount']))
    return result


def export():
    source = SOURCE.read_text(encoding='utf-8-sig')
    configuration = source.split('public static let canada2026: TaxYear =', 1)[1]
    federal = configuration.split('federal: FederalTaxParameters(', 1)[1].split('provinces:', 1)[0]
    manitoba = configuration.split('.manitoba: ProvincialTaxParameters(', 1)[1].split('cpp: CPPParameters(', 1)[0]
    cpp = configuration.split('cpp: CPPParameters(', 1)[1].split('ei: EIParameters(', 1)[0]
    ei = configuration.split('ei: EIParameters(', 1)[1].split('sourceURLs:', 1)[0]
    source_urls = re.findall(r'"(https://[^"\s]+)"', configuration.split('sourceURLs:', 1)[1])
    year = int(re.search(r'year:\s*(\d+)', configuration).group(1))
    return {
        '_generatedFrom': SOURCE.relative_to(ROOT).as_posix(),
        '_sourceSHA256': hashlib.sha256(source.encode('utf-8')).hexdigest(),
        'year': year,
        'federal': tax_parameters(federal, federal=True),
        'provinces': {'manitoba': tax_parameters(manitoba)},
        'cpp': fields(cpp, [
            'annualBasicExemption', 'yearlyMaximumPensionableEarnings',
            'yearlyAdditionalMaximumPensionableEarnings', 'baseRate',
            'firstAdditionalRate', 'secondAdditionalRate', 'maximumBaseContribution',
            'maximumFirstAdditionalContribution', 'maximumSecondAdditionalContribution',
        ]),
        'ei': fields(ei, ['rate', 'maximumInsurableEarnings', 'maximumPremium']),
        'sourceURLs': source_urls,
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Fail when the checked-in export is stale')
    args = parser.parse_args()
    expected = json.dumps(export(), indent=2) + '\n'
    if args.check:
        if not DESTINATION.is_file() or DESTINATION.read_text(encoding='utf-8-sig') != expected:
            raise SystemExit('Web tax export is stale. Run: python Scripts/export_web_tax_data.py')
        print('PASS: Web tax data matches the existing Swift configuration')
    else:
        DESTINATION.parent.mkdir(parents=True, exist_ok=True)
        DESTINATION.write_text(expected, encoding='utf-8', newline='\n')
        print(f'Exported {DESTINATION.relative_to(ROOT)} from the existing Swift configuration')
