#!/bin/bash
# Script de vérification du déploiement pro-pass
# À lancer sur le serveur après install_on_server.sh

set -e

# 1. Vérifier le statut Nginx
systemctl status nginx | grep Active

# 2. Vérifier le statut du backend avec pm2
pm2 list

# 3. Tester l'accès HTTPS local
curl -k https://localhost/ -I

# 4. Afficher l'adresse IP publique
ip addr | grep inet

# 5. Fin
echo "Vérification terminée. Si tout est OK, le service est en ligne."
