# Karmto LINE watcher - sends every new JPG/PNG dropped into Desktop\KarmtoLINE to the Karmto intake link.
# Sent files move to KarmtoLINE\sent, rejected files to KarmtoLINE\failed. Nothing is deleted.
# Messages are ASCII on purpose (Windows PowerShell 5.1 garbles Thai in scripts without BOM). Thai guide: README.md
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$urlFile = Join-Path $here 'watcher-url.txt'
if (!(Test-Path $urlFile)) {
  Write-Host 'Missing watcher-url.txt next to this script. Put the intake link in it (one line). See README.md'
  Read-Host 'Press Enter to close'; exit 1
}
$url = (Get-Content $urlFile -Raw).Trim()
if ($url -notmatch '^https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec\?a=intake&t=[0-9a-f]{24,}$') {
  Write-Host 'The link in watcher-url.txt does not look like a Karmto intake link (must end with /exec?a=intake&t=...).'
  Read-Host 'Press Enter to close'; exit 1
}
$inbox = Join-Path ([Environment]::GetFolderPath('Desktop')) 'KarmtoLINE'
$sent = Join-Path $inbox 'sent'
$failed = Join-Path $inbox 'failed'
New-Item -ItemType Directory -Force -Path $inbox, $sent, $failed | Out-Null
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$maxBytes = 5MB

function Move-Unique($file, $dir) {
  $target = Join-Path $dir $file.Name
  if (Test-Path $target) { $target = Join-Path $dir ((Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '-' + $file.Name) }
  Move-Item -LiteralPath $file.FullName -Destination $target
}

Write-Host "Watching: $inbox"
Write-Host 'Save LINE photos into that folder. Keep this window open. Close the window to stop.'
while ($true) {
  $files = @(Get-ChildItem -LiteralPath $inbox -File | Where-Object { $_.Extension -match '^\.(jpg|jpeg|png)$' } | Sort-Object LastWriteTime)
  foreach ($f in $files) {
    if (((Get-Date) - $f.LastWriteTime).TotalSeconds -lt 3) { continue }   # still being written
    $stamp = Get-Date -Format 'HH:mm:ss'
    if ($f.Length -gt $maxBytes -or $f.Length -lt 200) { Write-Host "$stamp SKIP (size) $($f.Name)"; Move-Unique $f $failed; continue }
    try {
      $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($f.FullName))
      $json = @{ image = $b64; sender = 'AY-PC'; sentAt = $f.LastWriteTime.ToString('yyyy-MM-dd HH:mm') } | ConvertTo-Json -Compress
      $res = Invoke-RestMethod -Uri $url -Method Post -Body ([Text.Encoding]::UTF8.GetBytes($json)) -ContentType 'text/plain; charset=utf-8' -TimeoutSec 120
      if ($res.ok -and $res.dup) { Write-Host "$stamp DUP  $($f.Name)"; Move-Unique $f $sent }
      elseif ($res.ok -and $res.id) { Write-Host "$stamp SENT $($f.Name)"; Move-Unique $f $sent }
      elseif ($res.error -eq 'daily_limit') { Write-Host "$stamp daily limit reached - will retry later"; break }
      elseif ($res.error) { Write-Host "$stamp REJECTED ($($res.error)) $($f.Name)"; Move-Unique $f $failed }
      else { Write-Host "$stamp NOT ACCEPTED - check the link in watcher-url.txt (wrong secret?). File kept: $($f.Name)"; break }
    } catch {
      Write-Host "$stamp network error - will retry: $($_.Exception.Message)"
      break
    }
  }
  Start-Sleep -Seconds 10
}
