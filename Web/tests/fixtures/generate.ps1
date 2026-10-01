$source = Get-Content -LiteralPath 'Tests/PayrollCoreTests/PayrollCalculatorTests.swift' -Raw
$definitions = @(
  @{ id='manitoba-65000-semi-monthly'; sourceTest='testManitoba65000SemiMonthlyMatchesReferencePaycheque'; input=@{} },
  @{ id='manitoba-65000-biweekly'; sourceTest='testManitoba65000BiweeklyHas26DifferentCheques'; input=@{frequency='biweekly'} },
  @{ id='hourly-25-biweekly'; sourceTest='testHourly25At37Point5HoursBiweekly'; input=@{incomeType='hourly';frequency='biweekly'} },
  @{ id='recurring-overtime'; sourceTest='testRecurringOvertimeIsAdditionalWeeklyIncome'; input=@{incomeType='hourly';overtimeHours='5';frequency='biweekly'} },
  @{ id='salary-120000-caps'; sourceTest='test120000SalaryReachesEveryStatutoryMaximum'; input=@{annualSalary='120000'} },
  @{ id='cpp2-worked-schedule'; sourceTest='testCPP2TimingMatchesCRAT4127WorkedExample'; input=@{annualSalary='100800'} },
  @{ id='rpp-five-percent'; sourceTest='testRPPPercentReducesTaxAndTakeHomeButNotCPPOrEI'; input=@{deductions=@{pension=@{isEnabled=$true;amount='5'}}} },
  @{ id='rrsp-fixed-100'; sourceTest='testRRSPFixedPayrollContributionReducesWithholding'; input=@{deductions=@{rrsp=@{isEnabled=$true;mode='fixedPerPeriod';amount='100'}}} },
  @{ id='no-optional-deductions'; sourceTest='testNoOptionalDeductionsByDefault'; input=@{} },
  @{ id='employer-only'; sourceTest='testEmployerContributionDoesNotRequireEmployeeContribution'; input=@{deductions=@{employerMatch=@{isEnabled=$true;amount='5'}}} },
  @{ id='after-tax-benefits'; sourceTest='testHealthAndOtherAfterTaxDeductWithoutReducingTax'; input=@{deductions=@{health=@{isEnabled=$true;mode='fixedPerPeriod';amount='50'};otherAfterTax=@{isEnabled=$true;mode='fixedPerPeriod';amount='20'}}} },
  @{ id='union-authorized-pre-tax'; sourceTest='testUnionAndAuthorizedPreTaxReduceTaxableIncomeOnly'; input=@{deductions=@{unionDues=@{isEnabled=$true;mode='fixedPerPeriod';amount='30'};otherPreTax=@{isEnabled=$true;mode='fixedPerPeriod';amount='20'}}} },
  @{ id='final-cheque-rounding'; sourceTest='testLastChequeReconcilesRoundingInsteadOfInventingGrossIncome'; input=@{} },
  @{ id='zero-income'; sourceTest='testZeroIncomeHasZeroTaxesAndDeductions'; input=@{annualSalary='0'} },
  @{ id='sub-dollar-salary'; sourceTest='testSubDollarSalaryNeverCreatesNegativeLastCheque'; input=@{annualSalary='0.26';frequency='weekly'} },
  @{ id='below-cpp-exemption'; sourceTest='testIncomeBelowCPPAnnualExemptionHasNoCPPAndNoIncomeTax'; input=@{annualSalary='3000'} },
  @{ id='enhanced-cpp'; sourceTest='testEnhancedCPPIsDeductionAndBaseCPPReceivesTaxCredit'; input=@{} }
)
$cases = @()
foreach ($definition in $definitions) {
  $escaped = [regex]::Escape($definition.sourceTest)
  $method = [regex]::Match($source, "func $escaped\(\)[\s\S]*?(?=\r?\n    func |\r?\n\}\s*$)").Value
  if (!$method) { throw "Missing Swift test $escaped" }
  $equalPattern = 'XCTAssertEqual\((?<path>(?:result|pay)\.[\w.\[\]?]+),\s*(?:d\("(?<decimal>[^\"]+)"\)|(?<integer>[\d_]+))\)'
  $expected = [ordered]@{}
  foreach ($match in [regex]::Matches($method, $equalPattern)) {
    $path = $match.Groups['path'].Value
    $path = $path -replace '^pay\.', 'currentPeriod.' -replace '^result\.', '' -replace '\[(\d+)\]', '.$1' -replace '^periods\.count$', 'periods.length'
    $count = if ($definition.input.frequency -eq 'weekly') { 52 } elseif ($definition.input.frequency -eq 'biweekly') { 26 } else {24}
    $path = $path -replace 'periods\.last\?', "periods.$($count - 1)"
    $value = if ($match.Groups['decimal'].Success) { $match.Groups['decimal'].Value } else {$match.Groups['integer'].Value.Replace('_','')}
    $expected[$path] = $value
  }
  if ($expected.Count -eq 0) { throw "No literal expectations in $escaped" }
  $cases += [ordered]@{id=$definition.id;sourceTest=$definition.sourceTest;input=$definition.input;expected=$expected}
}
$output = [ordered]@{sourceFile='Tests/PayrollCoreTests/PayrollCalculatorTests.swift';cases=$cases} | ConvertTo-Json -Depth 15
[System.IO.File]::WriteAllText((Join-Path (Get-Location) 'Web/tests/fixtures/regression-cases.json'), $output + "`n", [System.Text.UTF8Encoding]::new($false))
