# PowerShell script to transfer all project files to remote server via SCP
# Requires WinSCP module (install via 'Install-Module WinSCP' if not present)

$localPath = "C:\Users\Wack\Desktop\pro-pass"
$remotePath = "/root/pro-pass"
$sshKey = "C:\Users\Wack\.ssh\id_propass"
$server = "87.106.233.224"
$user = "root"

# Check if WinSCP module is installed
if (-not (Get-Module -ListAvailable -Name WinSCP)) {
    Write-Output "Installing WinSCP PowerShell module..."
    Install-Module WinSCP -Force
}

Import-Module WinSCP

# Create session options
$sessionOptions = New-WinSCPSessionOption -HostName $server -UserName $user -SshPrivateKeyPath $sshKey -SshHostKeyFingerprint "*" # Accept any host key (for demo)

# Start session
$session = New-WinSCPSession -SessionOption $sessionOptions

# Upload all files recursively
Write-Output "Uploading project files to $server:$remotePath ..."
$transferResult = Send-WinSCPItem -WinSCPSession $session -LocalPath $localPath -RemotePath $remotePath -TransferMode "Automatic" -Recursive

if ($transferResult.IsSuccess) {
    Write-Output "Transfer completed successfully."
} else {
    Write-Output "Transfer failed. See details:"
    $transferResult.Failures | Format-Table
}

# Close session
Remove-WinSCPSession -WinSCPSession $session

Write-Output "Project files are now on the server. Continue with SSL and Nginx setup as per docs/IONOS_SSL_DEPLOY.md."
