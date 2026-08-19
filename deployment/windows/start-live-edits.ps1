param(
  [string]$NodePath = 'node.exe'
)

$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$serverRoot = Join-Path $repositoryRoot 'server'
$logRoot = Join-Path $serverRoot 'logs'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
Set-Location $serverRoot

$logFile = Join-Path $logRoot 'live-edits.log'
if ([System.IO.Path]::IsPathRooted($NodePath)) {
  if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) {
    throw "The configured Node.js executable does not exist: $NodePath"
  }
  $node = (Resolve-Path -LiteralPath $NodePath).Path
} else {
  $node = (Get-Command $NodePath -ErrorAction Stop).Source
}
& $node 'src\index.js' *>> $logFile
exit $LASTEXITCODE
