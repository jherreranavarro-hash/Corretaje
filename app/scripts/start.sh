#!/usr/bin/env bash
# Prepara la base (idempotente), carga datos demo si esta vacia y arranca el servidor.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d node_modules ] || npm ci --omit=dev
node db/setup.js
node db/seed.js          # no hace nada si la empresa demo ya existe (SEED_DEMO=0 para solo configuracion)
exec node server/index.js
