#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[1/3] Build UI bundle"
npm run build

echo "[2/3] Build macOS Apple Silicon (arm64)"
npm run dist:mac:arm64

echo "[3/3] Done"
echo "Artifacts: $ROOT_DIR/dist"
