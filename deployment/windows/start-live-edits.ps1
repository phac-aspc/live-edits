$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$serverRoot = Join-Path $repositoryRoot 'server'
$logRoot = Join-Path $serverRoot 'logs'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
Set-Location $serverRoot

$logFile = Join-Path $logRoot 'live-edits.log'
& node.exe 'src\index.js' *>> $logFile
exit $LASTEXITCODE
