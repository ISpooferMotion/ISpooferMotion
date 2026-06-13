import { execFileSync } from 'node:child_process';

const ps = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$appId = 'com.github.IncrediDev.ISpooferMotion'
$targets = @(
  "$env:APPDATA\$appId",
  "$env:LOCALAPPDATA\$appId",
  "$env:LOCALAPPDATA\ispoofermotion-updater",
  "$env:LOCALAPPDATA\Temp\ISpooferMotion-Audio"
)

Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -like "*$appId*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

Start-Sleep -Milliseconds 250

$allowedRoots = @($env:APPDATA, $env:LOCALAPPDATA) | ForEach-Object {
  [System.IO.Path]::GetFullPath($_)
}

foreach ($target in $targets) {
  if (-not (Test-Path -LiteralPath $target)) { continue }
  $fullPath = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $target).Path)
  $allowed = $false
  foreach ($root in $allowedRoots) {
    if ($fullPath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
      $allowed = $true
    }
  }
  if (-not $allowed) { throw "Refusing to delete outside app data: $fullPath" }
  Remove-Item -LiteralPath $fullPath -Recurse -Force
}

Write-Host 'Cleared ISpooferMotion generated dev state.'
`;

execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
  stdio: 'inherit',
});
