# Met a jour le serveur cloud Pro-Pass (cloud/server.js) puis le redemarre.
# A lancer depuis la racine du projet, sur le PC Windows :
#   powershell -ExecutionPolicy Bypass -File .\scripts\update_cloud_server.ps1
#
# Utilise ssh/scp integres a Windows 10/11 (OpenSSH).
# Une copie de l'ancien server.js est gardee sur le serveur (server.js.bak-<date>).

$server     = "87.106.233.224"
$user       = "root"
$sshKey     = "$env:USERPROFILE\.ssh\id_propass"
$remoteDir  = "/root/pro-pass/cloud"
$localFile  = Join-Path $PSScriptRoot "..\cloud\server.js"

$ErrorActionPreference = "Stop"

if (-not (Test-Path $localFile)) { throw "Fichier introuvable : $localFile" }
if (-not (Test-Path $sshKey))    { throw "Cle SSH introuvable : $sshKey" }

$target = "$user@$server"
$stamp  = Get-Date -Format "yyyyMMdd-HHmmss"

Write-Output "1/3 Sauvegarde de l'ancien server.js sur le serveur..."
ssh -i $sshKey $target "cp $remoteDir/server.js $remoteDir/server.js.bak-$stamp"
if ($LASTEXITCODE -ne 0) { throw "Sauvegarde impossible (connexion SSH ?)" }

Write-Output "2/3 Envoi du nouveau server.js..."
scp -i $sshKey $localFile "${target}:$remoteDir/server.js"
if ($LASTEXITCODE -ne 0) { throw "Envoi impossible" }

Write-Output "3/3 Verification et redemarrage du serveur..."
# Verifie la syntaxe avant de redemarrer ; en cas d'erreur, remet l'ancienne version.
$restart = @"
cd $remoteDir || exit 1
if ! node --check server.js; then
  cp server.js.bak-$stamp server.js
  echo 'ERREUR de syntaxe : ancienne version restauree'
  exit 1
fi
if pm2 describe pro-pass-cloud >/dev/null 2>&1; then
  pm2 restart pro-pass-cloud
elif pm2 describe pro-pass >/dev/null 2>&1; then
  pm2 restart pro-pass
else
  pm2 start server.js --name pro-pass-cloud && pm2 save
fi
"@
ssh -i $sshKey $target ($restart -replace "`r", "")
if ($LASTEXITCODE -ne 0) { throw "Redemarrage echoue" }

Write-Output ""
Write-Output "Serveur cloud mis a jour. En cas de probleme :"
Write-Output "  ssh -i $sshKey $target `"cp $remoteDir/server.js.bak-$stamp $remoteDir/server.js && (pm2 restart pro-pass-cloud || pm2 restart pro-pass)`""
