#!/bin/bash
# Script d'installation automatique pour pro-pass sur le serveur
# À lancer en root depuis /root/pro-pass

set -e

# 1. Préparer les certificats SSL
mkdir -p /etc/ssl/pro-pass
cp ./deploy/nginx/pro-pass.fullchain.crt /etc/ssl/pro-pass/
cp ./deploy/nginx/pro-pass.key /etc/ssl/pro-pass/

# 2. Installer Nginx si nécessaire
if ! command -v nginx >/dev/null; then
  echo "Installation de Nginx..."
  apt update && apt install -y nginx
fi

# 3. Copier la configuration Nginx
cp ./deploy/nginx/pro-pass.conf /etc/nginx/sites-available/pro-pass.conf
ln -sf /etc/nginx/sites-available/pro-pass.conf /etc/nginx/sites-enabled/pro-pass.conf

# 4. Tester et recharger Nginx
nginx -t && systemctl reload nginx

# 5. Installer Node.js si nécessaire
if ! command -v node >/dev/null; then
  echo "Installation de Node.js..."
  curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
  apt install -y nodejs
fi

# 6. Installer les dépendances backend
cd /root/pro-pass
npm install

# 7. Démarrer le backend (exemple avec pm2)
if ! command -v pm2 >/dev/null; then
  npm install -g pm2
fi
pm2 start npm --name pro-pass -- run start
pm2 save

# 8. Fin
echo "Déploiement terminé. Pro-pass est en ligne avec SSL et Nginx."
