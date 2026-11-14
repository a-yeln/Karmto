# Karmto check (step B0): does LINE for PC write received photos to disk by itself, and where?
# Lists only paths / sizes of JPEG/PNG files that changed while you wait. It reads no chat content and sends nothing anywhere.
# Result is saved to Desktop\karmto-line-check.txt - send that file's text back.
$ErrorActionPreference = 'SilentlyContinue'
$roots = @(
  (Join-Path $env:LOCALAPPDATA 'LINE'),
  (Join-Path $env:APPDATA 'LINE'),
  (Join-Path $env:USERPROFILE 'Documents\LINE'),
  (Join-Path $env:USERPROFILE 'Downloads'),
  (Join-Path $env:USERPROFILE 'Pictures')
) + @(Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Packages') -Directory | Where-Object { $_.Name -match 'LINE' } | ForEach-Object { $_.FullName })
$roots = @($roots | Where-Object { Test-Path $_ })
$out = Join-Path ([Environment]::GetFolderPath('Desktop')) 'karmto-line-check.txt'
$start = Get-Date
Write-Host 'Folders checked:'; $roots | ForEach-Object { Write-Host "  $_" }
Write-Host ''
Write-Host 'NOW: open LINE on this PC, open the branch group, wait until a NEW photo arrives (or ask someone to send one),'
Write-Host 'look at the photo in the chat (do not save it), then come back here.'
Read-Host 'Press Enter after the new photo has appeared in LINE'
$lines = @("Karmto LINE check  start=$($start.ToString('yyyy-MM-dd HH:mm:ss'))  end=$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))", 'Folders:') + ($roots | ForEach-Object { "  $_" }) + @('Changed files:')
$found = 0
foreach ($r in $roots) {
  Get-ChildItem -LiteralPath $r -Recurse -File | Where-Object { $_.LastWriteTime -ge $start -or $_.CreationTime -ge $start } | Select-Object -First 150 | ForEach-Object {
    $head = ''
    try { $fs = [IO.File]::Open($_.FullName, 'Open', 'Read', 'ReadWrite'); $buf = New-Object byte[] 4; $n = $fs.Read($buf, 0, 4); $fs.Close(); $head = (($buf[0..([Math]::Max(0, $n - 1))] | ForEach-Object { $_.ToString('X2') }) -join '') } catch { $head = 'locked' }
    $kind = if ($head -like 'FFD8FF*') { 'JPEG' } elseif ($head -eq '89504E47') { 'PNG' } else { 'other' }
    if ($kind -ne 'other') {   # list image files only - other private file names stay out of the report
      $lines += ("  {0}  {1} bytes  {2}" -f $_.FullName.Replace($env:USERPROFILE, '~'), $_.Length, $kind)
      $found++
    }
  }
}
if ($found -eq 0) { $lines += '  (none - LINE did not write any JPEG/PNG file while the photo arrived)' }
$lines | Set-Content -LiteralPath $out -Encoding UTF8
Write-Host ''
Write-Host "Done. $found image file(s). Result saved to: $out"
Read-Host 'Press Enter to close'
