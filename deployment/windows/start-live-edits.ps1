param(
  [string]$NodePath = 'node.exe'
)

$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$serverRoot = Join-Path $repositoryRoot 'server'
$logRoot = Join-Path $serverRoot 'logs'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
Set-Location $serverRoot

$outputLog = Join-Path $logRoot 'live-edits.log'
$errorLog = Join-Path $logRoot 'live-edits-error.log'
if ([System.IO.Path]::IsPathRooted($NodePath)) {
  if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) {
    throw "The configured Node.js executable does not exist: $NodePath"
  }
  $node = (Resolve-Path -LiteralPath $NodePath).Path
} else {
  $node = (Get-Command $NodePath -ErrorAction Stop).Source
}
$process = Start-Process `
  -FilePath $node `
  -ArgumentList 'src\index.js' `
  -WorkingDirectory $serverRoot `
  -RedirectStandardOutput $outputLog `
  -RedirectStandardError $errorLog `
  -PassThru `
  -Wait

if ($process.ExitCode -ne 0) {
  Add-Content `
    -LiteralPath $errorLog `
    -Value "$(Get-Date -Format o) Node.js exited with code $($process.ExitCode)."
}
exit $process.ExitCode
