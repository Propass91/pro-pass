param(
  [string]$LeafCertPath = "$PSScriptRoot\..\certificate.crt",
  [string]$Intermediate1Path = "$env:USERPROFILE\Desktop\intermediate1.cer",
  [string]$Intermediate2Path = "$env:USERPROFILE\Desktop\intermediate2.cer",
  [string]$PrivateKeyPath = "$env:USERPROFILE\Downloads\_.pro-pass.app_private_key.key",
  [string]$OutputDir = "$PSScriptRoot\..\certs\ionos"
)

$ErrorActionPreference = 'Stop'

function Assert-Exists([string]$path, [string]$label) {
  if (-not (Test-Path $path)) {
    throw "$label introuvable: $path"
  }
}

function Assert-Contains([string]$path, [string]$needle, [string]$label) {
  $txt = Get-Content -Path $path -Raw -Encoding UTF8
  if ($txt -notmatch [regex]::Escape($needle)) {
    throw "$label invalide: motif '$needle' absent dans $path"
  }
}

Assert-Exists $LeafCertPath 'Certificat serveur'
Assert-Exists $Intermediate1Path 'Intermediaire 1'
Assert-Exists $Intermediate2Path 'Intermediaire 2'
Assert-Exists $PrivateKeyPath 'Cle privee'

Assert-Contains $LeafCertPath 'BEGIN CERTIFICATE' 'Certificat serveur'
Assert-Contains $Intermediate1Path 'BEGIN CERTIFICATE' 'Intermediaire 1'
Assert-Contains $Intermediate2Path 'BEGIN CERTIFICATE' 'Intermediaire 2'

# Accept PKCS#1 and PKCS#8 key headers
$k = Get-Content -Path $PrivateKeyPath -Raw -Encoding UTF8
if (($k -notmatch 'BEGIN RSA PRIVATE KEY') -and ($k -notmatch 'BEGIN PRIVATE KEY')) {
  throw "Cle privee invalide: en-tete PEM non reconnu dans $PrivateKeyPath"
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

$privOut = Join-Path $OutputDir 'pro-pass.key'
$fullChainOut = Join-Path $OutputDir 'pro-pass.fullchain.crt'

Copy-Item -Path $PrivateKeyPath -Destination $privOut -Force

$leaf = Get-Content -Path $LeafCertPath -Raw -Encoding UTF8
$int1 = Get-Content -Path $Intermediate1Path -Raw -Encoding UTF8
$int2 = Get-Content -Path $Intermediate2Path -Raw -Encoding UTF8

# Order is important for Nginx fullchain: leaf -> intermediate(s)
$fullchain = ($leaf.TrimEnd() + "`n" + $int1.TrimEnd() + "`n" + $int2.TrimEnd() + "`n")
Set-Content -Path $fullChainOut -Value $fullchain -Encoding UTF8

Write-Host "Certificats prepares:" -ForegroundColor Green
Write-Host "- Cle privee : $privOut"
Write-Host "- Full chain : $fullChainOut"
Write-Host ""
Write-Host "Prochaine etape (serveur Linux):" -ForegroundColor Yellow
Write-Host "sudo mkdir -p /etc/ssl/pro-pass"
Write-Host "sudo cp pro-pass.key /etc/ssl/pro-pass/pro-pass.key"
Write-Host "sudo cp pro-pass.fullchain.crt /etc/ssl/pro-pass/pro-pass.fullchain.crt"
Write-Host "sudo chmod 600 /etc/ssl/pro-pass/pro-pass.key"
Write-Host "sudo chmod 644 /etc/ssl/pro-pass/pro-pass.fullchain.crt"
