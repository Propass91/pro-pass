# IONOS SSL Deployment (ProPass)

## 1) Security first
- Never commit private keys.
- This repo now ignores `certs/`, `*.key`, `*.crt`, `*.cer`, `*.pem`, `*.p12`, `*.pfx`.
- If a private key was shared in chat/email, rotate/reissue certificate immediately.

## 2) Prepare cert bundle on your workstation
Use the helper script (PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\prepare_ionos_certs.ps1 `
  -LeafCertPath "C:\path\to\certificate.crt" `
  -Intermediate1Path "C:\path\to\intermediate1.cer" `
  -Intermediate2Path "C:\path\to\intermediate2.cer" `
  -PrivateKeyPath "C:\path\to\private.key"
```

Output files:
- `certs/ionos/pro-pass.key`
- `certs/ionos/pro-pass.fullchain.crt`

## 3) Copy certs to IONOS server

```bash
scp certs/ionos/pro-pass.key user@your-server:/tmp/
scp certs/ionos/pro-pass.fullchain.crt user@your-server:/tmp/
```

Then on server:

```bash
sudo mkdir -p /etc/ssl/pro-pass
sudo mv /tmp/pro-pass.key /etc/ssl/pro-pass/pro-pass.key
sudo mv /tmp/pro-pass.fullchain.crt /etc/ssl/pro-pass/pro-pass.fullchain.crt
sudo chmod 600 /etc/ssl/pro-pass/pro-pass.key
sudo chmod 644 /etc/ssl/pro-pass/pro-pass.fullchain.crt
```

## 4) Nginx reverse proxy
This repo includes `deploy/nginx/pro-pass.conf`.

Install and enable:

```bash
sudo apt update
sudo apt install -y nginx
sudo cp deploy/nginx/pro-pass.conf /etc/nginx/sites-available/pro-pass
sudo ln -sf /etc/nginx/sites-available/pro-pass /etc/nginx/sites-enabled/pro-pass
sudo nginx -t
sudo systemctl reload nginx
```

## 5) Run ProPass cloud backend
ProPass cloud listens on port `8787` by default.

Example with PM2:

```bash
pm2 start cloud/server.js --name pro-pass-cloud --env production
pm2 save
pm2 startup
```

## 6) Validation checklist
- `curl -I http://pro-pass.app` returns 301 to HTTPS.
- `curl -I https://pro-pass.app` returns 200/302 without certificate warning.
- Browser lock icon is valid.
