param(
  [string]$VersionTag = "v13",
  [string]$JavaHome = "C:\Program Files\Eclipse Adoptium\jdk-17.0.18.8-hotspot",
  [string]$SshKey = "C:\Users\Wack\.ssh\id_propass",
  [string]$RemoteHost = "root@87.106.233.224",
  [string]$RemoteDir = "/opt/pro-pass/mobile",
  [string]$PublicBase = "https://www.pro-pass.app/mobile"
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$androidDir = Join-Path $repoRoot 'android'
$apkPath = Join-Path $androidDir 'app\build\outputs\apk\debug\app-debug.apk'
$apkName = "propass-mobile-debug-$VersionTag.apk"
$publicUrl = "$PublicBase/$apkName"
$remotePath = "$RemoteDir/$apkName"

Write-Host "[1/8] JAVA_HOME + PATH"
$env:JAVA_HOME = $JavaHome
$env:Path = "$env:JAVA_HOME\bin;$env:Path"

Write-Host "[2/8] Capacitor sync"
Set-Location $repoRoot
npx cap sync android

Write-Host "[3/8] Build APK (debug)"
Set-Location $androidDir
.\gradlew.bat assembleDebug --console=plain --no-daemon

if (!(Test-Path $apkPath)) {
  throw "APK not found: $apkPath"
}

Write-Host "[4/8] Compute SHA256"
$sha = (Get-FileHash $apkPath -Algorithm SHA256).Hash

Write-Host "[5/8] Upload APK"
scp -i $SshKey "$apkPath" "$RemoteHost`:$remotePath"

Write-Host "[6/8] Verify public URL"
$head = Invoke-WebRequest -Method Head -Uri $publicUrl -UseBasicParsing -TimeoutSec 60

Write-Host "[7/8] Optional: print remote file info"
ssh -i $SshKey $RemoteHost "ls -lh '$remotePath'"

Write-Host "[8/8] Done"
Write-Output ("PUBLIC_URL=" + $publicUrl)
Write-Output ("HTTP=" + $head.StatusCode)
Write-Output ("SHA256=" + $sha)
