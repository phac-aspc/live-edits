param(
  [string]$IisSiteName = 'Default Web Site',
  [string]$ApplicationPath = '/live-edits',
  [string]$TaskName = 'Health Infobase Live Edits',
  [switch]$SkipIis
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$serverRoot = Join-Path $repositoryRoot 'server'
$envFile = Join-Path $serverRoot '.env'
$dataRoot = Join-Path $serverRoot 'data'
$logRoot = Join-Path $serverRoot 'logs'
$startScript = Join-Path $PSScriptRoot 'start-live-edits.ps1'

if (-not (Test-Path $envFile)) {
  throw "Create $envFile from server\.env.example and set unique tokens before running this installer."
}

$node = (Get-Command node.exe -ErrorAction Stop).Source
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$nodeVersion = (& $node --version).TrimStart('v').Split('.')
if ([int]$nodeVersion[0] -ne 24) {
  throw 'Node.js 24 LTS is required.'
}

New-Item -ItemType Directory -Path $dataRoot, $logRoot -Force | Out-Null
& $npm --prefix $serverRoot ci --omit=dev
if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
& $node (Join-Path $serverRoot 'src\init-db.js')
if ($LASTEXITCODE -ne 0) { throw 'Database initialization failed.' }

if (-not $SkipIis) {
  Import-Module WebAdministration -ErrorAction Stop
  $rewrite = Get-WebGlobalModule | Where-Object Name -eq 'RewriteModule'
  if (-not $rewrite) { throw 'IIS URL Rewrite is not installed.' }

  $site = Get-Website -Name $IisSiteName -ErrorAction Stop
  $applicationName = $ApplicationPath.Trim('/')
  if (-not (Get-WebApplication -Site $IisSiteName -Name $applicationName -ErrorAction SilentlyContinue)) {
    New-WebApplication -Site $IisSiteName -Name $applicationName -PhysicalPath $serverRoot -ApplicationPool $site.ApplicationPool | Out-Null
  } else {
    Set-ItemProperty "IIS:\Sites\$IisSiteName\$applicationName" -Name physicalPath -Value $serverRoot
  }
  Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -Name enabled -Value $true
}

$powerShell = (Get-Command powershell.exe -ErrorAction Stop).Source
$action = New-ScheduledTaskAction `
  -Execute $powerShell `
  -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$startScript`"" `
  -WorkingDirectory $repositoryRoot
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Days 3650)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Start-Sleep -Seconds 3
$health = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/healthz' -TimeoutSec 10
if ($health.status -ne 'ok') { throw 'The local health check did not return ok.' }

Write-Host "Live Edits installed. Local health status: $($health.status)"
Write-Host "Verify the public endpoint: https://test.infobase-dev.com/live-edits/healthz"
