$ErrorActionPreference = 'Stop'

Write-Output 'STEP 1/5 Detect Java (PATH/JAVA_HOME)'
$javaCmd = Get-Command java -ErrorAction SilentlyContinue
$javaHome = $env:JAVA_HOME

function Test-Java17OrNewer {
  param([string]$JavaExe)
  try {
    $out = cmd /c ('"' + $JavaExe + '" -version 2>&1') | Out-String
    $major = $null
    if ($out -match 'version\s+["“”]?([0-9]+)') {
      $major = [int]$Matches[1]
    } elseif ($out -match '(?m)^openjdk\s+([0-9]+)') {
      $major = [int]$Matches[1]
    } elseif ($out -match '(?m)^java\s+([0-9]+)') {
      $major = [int]$Matches[1]
    }
    if ($major -ne $null) {
      return ($major -ge 17)
    }
  } catch {}
  return $false
}

function Set-JavaHomeFromExe {
  param([string]$JavaExe)
  $detectedHome = Split-Path (Split-Path $JavaExe -Parent) -Parent
  [Environment]::SetEnvironmentVariable('JAVA_HOME', $detectedHome, 'User')
  $env:JAVA_HOME = $detectedHome
  if ($env:Path -notlike "*$detectedHome\\bin*") {
    $env:Path = "$($env:Path);$detectedHome\bin"
  }
}

$javaExe = $null
if ($javaCmd) {
  $javaExe = $javaCmd.Source
}
elseif ($javaHome -and (Test-Path (Join-Path $javaHome 'bin\java.exe'))) {
  $javaExe = (Join-Path $javaHome 'bin\java.exe')
}
else {
  $existingJdk = Get-ChildItem 'C:\Program Files\Eclipse Adoptium' -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like 'jdk-17*' } |
    Sort-Object Name -Descending |
    Select-Object -First 1
  if ($existingJdk) {
    $candidate = Join-Path $existingJdk.FullName 'bin\java.exe'
    if (Test-Path $candidate) {
      $javaExe = $candidate
    }
  }
}

if (-not $javaExe -or -not (Test-Java17OrNewer -JavaExe $javaExe)) {
  Write-Output 'STEP 2/5 Java >= 17 missing, installing via winget'
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) {
    throw 'winget introuvable. Installe JDK 17 manuellement puis relance.'
  }

  winget install --id EclipseAdoptium.Temurin.17.JDK --accept-package-agreements --accept-source-agreements --silent

  $jdkRoot = 'C:\Program Files\Eclipse Adoptium'
  if (-not (Test-Path $jdkRoot)) {
    throw 'Installation Java terminée mais dossier JDK non trouvé.'
  }

  $jdkDir = Get-ChildItem $jdkRoot -Directory | Where-Object { $_.Name -like 'jdk-17*' } | Sort-Object Name -Descending | Select-Object -First 1
  if (-not $jdkDir) {
    throw 'JDK 17 non détecté après installation.'
  }

  $javaHome = $jdkDir.FullName
  $javaExe = Join-Path $javaHome 'bin\java.exe'
  if (-not (Test-Path $javaExe)) {
    throw 'java.exe introuvable après installation JDK.'
  }

  Set-JavaHomeFromExe -JavaExe $javaExe

  if (-not (Test-Java17OrNewer -JavaExe $javaExe)) {
    throw 'Java détecté mais version < 17.'
  }
}
else {
  Write-Output ('Java OK: ' + $javaExe)
  if (-not $env:JAVA_HOME) { Set-JavaHomeFromExe -JavaExe $javaExe }
}

Write-Output 'STEP 3/5 Capacitor sync android'
Push-Location (Join-Path $PSScriptRoot '..')
npx cap sync android

Write-Output 'STEP 4/5 Gradle assembleDebug'
Push-Location '.\android'
.\gradlew.bat assembleDebug
Pop-Location
Pop-Location

Write-Output 'STEP 5/5 Verify APK output'
$apk = Join-Path $PSScriptRoot '..\android\app\build\outputs\apk\debug\app-debug.apk'
$apk = (Resolve-Path $apk).Path
$hash = (Get-FileHash -Algorithm SHA256 $apk).Hash
Write-Output ('APK=' + $apk)
Write-Output ('SHA256=' + $hash)
