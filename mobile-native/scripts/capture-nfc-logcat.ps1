param(
  [string]$OutFile = "nfc-logcat.txt"
)

$ErrorActionPreference = 'Stop'

Write-Host "[1/5] Check adb"
adb version | Out-Null

Write-Host "[2/5] Ensure device connected"
$devices = adb devices
$hasDevice = $false
foreach ($line in $devices) {
  if ($line -match "\tdevice$") { $hasDevice = $true; break }
}
if (-not $hasDevice) {
  throw "No Android device detected. Connect phone by USB and authorize debugging."
}

Write-Host "[3/5] Clear previous logcat buffer"
adb logcat -c

Write-Host "[4/5] Start filtered NFC capture"
Write-Host "Reproduce: open app, detect badge, press COPIER, keep badge 2-3s."
Write-Host "Press Ctrl+C to stop capture."

# Capture broad Android NFC + app logs for troubleshooting.
adb logcat -v time MainActivity:D Capacitor:D chromium:D NfcService:D NativeNfcTag:D NfcDispatcher:D *:S | Tee-Object -FilePath $OutFile

Write-Host "[5/5] Saved logs to: $OutFile"
