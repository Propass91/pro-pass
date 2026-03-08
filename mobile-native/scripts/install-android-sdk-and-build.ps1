$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$androidDir = Join-Path $root 'android'
$sdkRoot = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$cmdToolsRoot = Join-Path $sdkRoot 'cmdline-tools\latest'
$cmdlineZip = Join-Path $env:TEMP 'commandlinetools-win.zip'
$cmdlineExtract = Join-Path $env:TEMP 'commandlinetools-win'

Write-Output 'STEP 1/6 Ensure Java + env'
$javaExe = $null
$javaCandidates = @(
  'C:\Program Files\Eclipse Adoptium\jdk-17*\bin\java.exe',
  'C:\Program Files\Java\jdk-17*\bin\java.exe',
  'C:\Program Files\Android\Android Studio\jbr\bin\java.exe'
)

foreach ($p in $javaCandidates) {
  $found = Get-ChildItem -Path $p -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) { $javaExe = $found.FullName; break }
}

if (-not $javaExe) {
  winget install --id EclipseAdoptium.Temurin.17.JDK --accept-package-agreements --accept-source-agreements --silent
  $found = Get-ChildItem -Path 'C:\Program Files\Eclipse Adoptium\jdk-17*\bin\java.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) { $javaExe = $found.FullName }
}

if (-not $javaExe) { throw 'Java 17 introuvable après installation.' }

$javaHome = Split-Path (Split-Path $javaExe -Parent) -Parent
$env:JAVA_HOME = $javaHome
if ($env:Path -notlike "*$javaHome\\bin*") {
  $env:Path = "$javaHome\bin;$($env:Path)"
}

Write-Output 'STEP 2/6 Prepare Android SDK folders'
New-Item -ItemType Directory -Path $sdkRoot -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $sdkRoot 'cmdline-tools') -Force | Out-Null

Write-Output 'STEP 3/6 Download command-line tools'
Invoke-WebRequest -Uri 'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip' -OutFile $cmdlineZip
if (Test-Path $cmdlineExtract) { Remove-Item $cmdlineExtract -Recurse -Force }
Expand-Archive -Path $cmdlineZip -DestinationPath $cmdlineExtract -Force

Write-Output 'STEP 4/6 Install command-line tools into SDK'
if (Test-Path $cmdToolsRoot) { Remove-Item $cmdToolsRoot -Recurse -Force }
New-Item -ItemType Directory -Path $cmdToolsRoot -Force | Out-Null
Copy-Item (Join-Path $cmdlineExtract 'cmdline-tools\*') $cmdToolsRoot -Recurse -Force

$sdkManager = Join-Path $cmdToolsRoot 'bin\sdkmanager.bat'
if (!(Test-Path $sdkManager)) { throw 'sdkmanager introuvable après installation tools.' }

Write-Output 'STEP 5/6 Install Android platform/build-tools'
$packages = @(
  'platform-tools',
  'platforms;android-34',
  'build-tools;34.0.0'
)

cmd /c ('for /L %i in (1,1,50) do @echo y') | & $sdkManager --sdk_root="$sdkRoot" --licenses | Out-Null

foreach ($pkg in $packages) {
  cmd /c ('echo y | "' + $sdkManager + '" --sdk_root="' + $sdkRoot + '" "' + $pkg + '"') | Out-Null
}

$line = 'sdk.dir=' + ($sdkRoot -replace '\\','\\')
Set-Content -Path (Join-Path $androidDir 'local.properties') -Value $line -Encoding ASCII

Write-Output 'STEP 6/6 Build APK'
Push-Location $root
npx cap sync android
Push-Location $androidDir
.\gradlew.bat assembleDebug
Pop-Location
Pop-Location

$apk = Join-Path $androidDir 'app\build\outputs\apk\debug\app-debug.apk'
if (!(Test-Path $apk)) { throw 'APK non généré.' }
$hash = (Get-FileHash -Algorithm SHA256 $apk).Hash
Write-Output ('APK=' + $apk)
Write-Output ('SHA256=' + $hash)
