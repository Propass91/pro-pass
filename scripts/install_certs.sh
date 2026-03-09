#!/bin/bash
# Script d'installation des certificats SSL pour pro-pass
CERTS_DIR="$(dirname "$0")/../certs"
TARGET_DIR="/etc/ssl/pro-pass"

mkdir -p "$TARGET_DIR"
cp "$CERTS_DIR"/pro-pass.app_ssl_certificate.cer "$TARGET_DIR"/pro-pass.app_ssl_certificate.cer
cp "$CERTS_DIR"/_.pro-pass.app_private_key.key "$TARGET_DIR"/pro-pass.app_private_key.key
cp "$CERTS_DIR"/intermediate1.cer "$TARGET_DIR"/intermediate1.cer
cp "$CERTS_DIR"/intermediate2.cer "$TARGET_DIR"/intermediate2.cer

chmod 600 "$TARGET_DIR"/pro-pass.app_private_key.key
chmod 644 "$TARGET_DIR"/*.cer

echo "Certificats installés dans $TARGET_DIR"
