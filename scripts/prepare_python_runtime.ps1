$ErrorActionPreference = 'Stop'

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$runtimeRoot = Join-Path $projectRoot 'runtime'
$runtimePython = Join-Path $runtimeRoot 'python'

Write-Host "[python-runtime] projectRoot=$projectRoot"

$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCmd) {
  throw "Python n'est pas installé sur la machine de build. Installe Python 3.11+ puis relance npm run dist."
}

$buildPython = $pythonCmd.Source
$sourcePrefix = (& $buildPython -c "import sys; print(sys.base_prefix)").Trim()
if (-not $sourcePrefix -or -not (Test-Path $sourcePrefix)) {
  throw "Impossible de détecter sys.base_prefix depuis $buildPython"
}

Write-Host "[python-runtime] buildPython=$buildPython"
Write-Host "[python-runtime] sourcePrefix=$sourcePrefix"

New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
if (Test-Path $runtimePython) {
  Remove-Item -Recurse -Force $runtimePython
}
New-Item -ItemType Directory -Force -Path $runtimePython | Out-Null

$null = robocopy $sourcePrefix $runtimePython /MIR /XD __pycache__ tcl Tools Doc "Lib\test" "Lib\tkinter" /XF *.pyc
if ($LASTEXITCODE -ge 8) {
  throw "robocopy a échoué (code=$LASTEXITCODE)"
}

$bundledPython = Join-Path $runtimePython 'python.exe'
if (-not (Test-Path $bundledPython)) {
  throw "python.exe non trouvé dans le runtime embarqué: $bundledPython"
}

Write-Host "[python-runtime] ensure pip"
& $bundledPython -m ensurepip --upgrade | Out-Host

Write-Host "[python-runtime] install pyscard"
& $bundledPython -m pip install --upgrade pip setuptools wheel pyscard | Out-Host

Write-Host "[python-runtime] validate smartcard import"
& $bundledPython -c "from smartcard.System import readers; print('SMARTCARD_OK', len(readers()))" | Out-Host

Write-Host "[python-runtime] OK -> $runtimePython"
