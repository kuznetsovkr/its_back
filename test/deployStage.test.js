const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const deployScript = path.resolve(__dirname, '../deploy-stage.ps1');

test('fast deployment is an explicit switch and both modes use the same local gate', () => {
  const source = fs.readFileSync(deployScript, 'utf8');
  assert.match(source, /\[switch\]\$Fast,/);
  assert.doesNotMatch(source, /\[switch\]\$Fast\s*=\s*\$true/i);
  assert.match(source, /Invoke-LocalChecks -FrontendRoot \$FrontendRoot -BackendRoot \$BackendRoot -Fast:\$Fast/);
});

test('PowerShell deploy gate skips only browser tests and propagates every required failure', {
  skip: process.platform !== 'win32' && 'Windows PowerShell is a local deployment requirement',
  timeout: 30_000,
}, () => {
  // Parse the real script but execute only this function, with a recording native
  // command adapter. No npm, SSH, builds, archives or filesystem cleanup run here.
  const command = String.raw`
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$parseTokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile(
    (Join-Path $PWD 'deploy-stage.ps1'), [ref]$parseTokens, [ref]$parseErrors
)
if ($parseErrors.Count -gt 0) { throw ($parseErrors | Out-String) }
$definition = $ast.Find({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-LocalChecks'
}, $false)
if (-not $definition) { throw 'Local deployment gate not found' }
. ([scriptblock]::Create($definition.Extent.Text))
function Write-Step { param([string]$Message) }
function Invoke-NativeCommand {
    param([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory)
    $script:RecordedCalls.Add([pscustomobject]@{
        file = $FilePath; arguments = $Arguments; directory = $WorkingDirectory
    })
    if ($script:RecordedCalls.Count -eq $script:FailureAt) { throw 'simulated required check failure' }
}
$reports = @()
foreach ($isFast in @($false, $true)) {
    $script:RecordedCalls = [Collections.Generic.List[object]]::new()
    $script:FailureAt = -1
    Invoke-LocalChecks -FrontendRoot 'frontend' -BackendRoot 'backend' -Fast:$isFast -WarningAction SilentlyContinue
    $expectedCount = if ($isFast) { 4 } else { 5 }
    $calls = @($script:RecordedCalls.ToArray())
    $failuresStopped = @()
    for ($checkIndex = 1; $checkIndex -le $expectedCount; $checkIndex++) {
        $script:RecordedCalls = [Collections.Generic.List[object]]::new()
        $script:FailureAt = $checkIndex
        $caught = $false
        try {
            Invoke-LocalChecks -FrontendRoot 'frontend' -BackendRoot 'backend' -Fast:$isFast -WarningAction SilentlyContinue
        }
        catch {
            if ($_.Exception.Message -ne 'simulated required check failure') { throw }
            $caught = $true
        }
        $failuresStopped += ($caught -and $script:RecordedCalls.Count -eq $checkIndex)
    }
    $reports += [pscustomobject]@{ fast = $isFast; calls = $calls; failuresStopped = $failuresStopped }
}
$reports | ConvertTo-Json -Depth 6 -Compress
`;
  const result = spawnSync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command,
  ], { cwd: path.dirname(deployScript), encoding: 'utf8', timeout: 25_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const reports = JSON.parse(result.stdout.trim());
  const commonChecks = [
    { file: 'npm.cmd', arguments: ['test'], directory: 'frontend' },
    { file: 'npm.cmd', arguments: ['test'], directory: 'backend' },
    { file: 'npm.cmd', arguments: ['run', 'lint'], directory: 'frontend' },
    { file: 'npm.cmd', arguments: ['run', 'lint:styles'], directory: 'frontend' },
  ];
  assert.deepEqual(reports[0].calls, [
    ...commonChecks,
    { file: 'npm.cmd', arguments: ['run', 'test:e2e'], directory: 'frontend' },
  ]);
  assert.deepEqual(reports[1].calls, commonChecks);
  for (const report of reports) {
    assert.equal(report.failuresStopped.length, report.calls.length);
    assert.ok(report.failuresStopped.every(Boolean), 'Every check failure must stop later commands');
  }
});
