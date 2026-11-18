#!/usr/bin/env bash
# Instalador del sistema de corretaje (Debian / Ubuntu).
# Instala Node.js y PostgreSQL si faltan, crea la base y el usuario, genera los secretos, instala la aplicación,
# la deja como servicio y programa respaldos diarios.
#
#   sudo ./instalar.sh                       instalación interactiva (pide empresa, RUT y correo del administrador)
#   sudo ./instalar.sh --demo                con datos y usuarios de ejemplo (para conocer el sistema)
#   sudo ./instalar.sh --empresa "Mi Corredora SpA" --rut 76.123.456-7 --admin-email yo@correo.cl
#   sudo ./instalar.sh                       (de nuevo) = ACTUALIZAR: copia el código nuevo, aplica el esquema y reinicia, sin tocar datos
#   sudo ./instalar.sh --desinstalar [--borrar-datos]
#
# Opciones: --puerto 3000  --dir /opt/corretaje  --db corretaje  --db-user corretaje  --servicio corretaje
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PUERTO=3000; DIR=/opt/corretaje; DB=corretaje; DBUSER=corretaje; SERVICIO=corretaje
EMPRESA=""; RUT=""; ADMIN_EMAIL=""; DEMO=0; DESINSTALAR=0; BORRAR=0

while [ $# -gt 0 ]; do
  case "$1" in
    --empresa) EMPRESA="$2"; shift 2;; --rut) RUT="$2"; shift 2;; --admin-email) ADMIN_EMAIL="$2"; shift 2;;
    --puerto) PUERTO="$2"; shift 2;; --dir) DIR="$2"; shift 2;; --db) DB="$2"; shift 2;; --db-user) DBUSER="$2"; shift 2;;
    --servicio) SERVICIO="$2"; shift 2;; --demo) DEMO=1; shift;; --desinstalar) DESINSTALAR=1; shift;; --borrar-datos) BORRAR=1; shift;;
    -h|--help) sed -n '2,15p' "$0"; exit 0;;
    *) echo "Opción desconocida: $1 (use --help)"; exit 1;;
  esac
done

ok()   { printf '\033[32m✔\033[0m %s\n' "$*"; }
info() { printf '\033[36m➜\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\033[31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || { command -v sudo >/dev/null && exec sudo -E bash "$0" "$@"; die "Ejecute como root (sudo ./instalar.sh)"; }
ENVDIR="/etc/$SERVICIO"; ENVF="$ENVDIR/env"; CREDF="$ENVDIR/credenciales.txt"; BKP="/var/backups/$SERVICIO"
HAY_SYSTEMD=0; [ -d /run/systemd/system ] && command -v systemctl >/dev/null && HAY_SYSTEMD=1
como_app() { runuser -u "$SERVICIO" -- env $(grep -v '^#' "$ENVF" | xargs) "$@"; }
como_pg()  { runuser -u postgres -- "$@"; }

# ------------------------------------------------------------------ desinstalar
if [ "$DESINSTALAR" -eq 1 ]; then
  info "Deteniendo y quitando el servicio $SERVICIO"
  if [ "$HAY_SYSTEMD" -eq 1 ]; then systemctl disable --now "$SERVICIO" 2>/dev/null || true; rm -f "/etc/systemd/system/$SERVICIO.service"; systemctl daemon-reload; fi
  [ -f "/run/$SERVICIO.pid" ] && kill "$(cat /run/$SERVICIO.pid)" 2>/dev/null || true
  rm -f "/etc/cron.d/$SERVICIO-backup" "/usr/local/bin/$SERVICIO-backup" "/usr/local/bin/$SERVICIO-iniciar"
  mkdir -p "$BKP"
  [ -d "$DIR/uploads" ] && { mv "$DIR/uploads" "$BKP/uploads-$(date +%Y%m%d%H%M)"; ok "Fotos conservadas en $BKP"; }
  rm -rf "$DIR"
  if [ "$BORRAR" -eq 1 ]; then
    como_pg psql -qc "DROP DATABASE IF EXISTS \"$DB\"" -c "DROP ROLE IF EXISTS \"$DBUSER\"" || true
    rm -rf "$ENVDIR"; id "$SERVICIO" >/dev/null 2>&1 && userdel "$SERVICIO" || true
    ok "Datos, base de datos y configuración eliminados"
  else warn "La base de datos y $ENVDIR se conservaron (use --borrar-datos para eliminarlos)"; fi
  ok "Desinstalado"; exit 0
fi

[ -f "$SRC/app/package.json" ] || die "No encuentro app/package.json junto al instalador ($SRC)"
command -v apt-get >/dev/null || die "Este instalador soporta Debian/Ubuntu (apt). En otros sistemas use Docker: ver docker-compose.yml"

# ------------------------------------------------------------------ datos de la empresa (solo primera instalación)
PRIMERA=1; [ -f "$ENVF" ] && PRIMERA=0
if [ "$PRIMERA" -eq 1 ] && [ "$DEMO" -eq 0 ]; then
  if [ -t 0 ]; then
    [ -n "$EMPRESA" ]     || read -rp "Nombre de la empresa: " EMPRESA
    [ -n "$RUT" ]         || read -rp "RUT de la empresa (ej. 76.123.456-7): " RUT
    [ -n "$ADMIN_EMAIL" ] || read -rp "Correo del administrador (será su usuario): " ADMIN_EMAIL
  fi
  [ -n "$EMPRESA" ] && [ -n "$RUT" ] && [ -n "$ADMIN_EMAIL" ] || die "Faltan --empresa, --rut y --admin-email (o use --demo)"
  [[ "$ADMIN_EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || die "Correo inválido: $ADMIN_EMAIL"
fi
if [ "$PRIMERA" -eq 1 ] && (ss -ltn 2>/dev/null | grep -q ":$PUERTO "); then die "El puerto $PUERTO ya está en uso; use --puerto"; fi

# ------------------------------------------------------------------ dependencias
export DEBIAN_FRONTEND=noninteractive
PAQ=""
command -v curl >/dev/null || PAQ="$PAQ curl"; command -v openssl >/dev/null || PAQ="$PAQ openssl"; [ -d /etc/ssl/certs ] || PAQ="$PAQ ca-certificates"
ls /usr/lib/postgresql/*/bin/postgres >/dev/null 2>&1 || PAQ="$PAQ postgresql postgresql-contrib"
command -v pg_dump >/dev/null || PAQ="$PAQ postgresql-client"; command -v ss >/dev/null || PAQ="$PAQ iproute2"
if [ -n "$PAQ" ]; then info "Instalando:$PAQ"; apt-get update -qq; apt-get install -y -qq $PAQ >/dev/null; fi
NODE_OK=0; if command -v node >/dev/null; then [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] && NODE_OK=1; fi
if [ "$NODE_OK" -eq 0 ]; then
  info "Instalando Node.js 22 (repositorio oficial NodeSource)"
  apt-get install -y -qq ca-certificates curl gnupg >/dev/null
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1 || die "No se pudo configurar NodeSource (¿hay internet?)"
  apt-get install -y -qq nodejs >/dev/null
fi
ok "Node $(node -v) · $(ls -d /usr/lib/postgresql/* | sort -V | tail -1 | xargs basename | sed 's/^/PostgreSQL /')"

# ------------------------------------------------------------------ PostgreSQL en marcha
if [ "$HAY_SYSTEMD" -eq 1 ]; then systemctl enable --now postgresql >/dev/null 2>&1 || true
else pg_lsclusters -h 2>/dev/null | awk '$4!="online"{print $1,$2}' | while read -r v c; do pg_ctlcluster "$v" "$c" start || true; done; fi
for _ in $(seq 1 20); do como_pg pg_isready -q && break; sleep 1; done
como_pg pg_isready -q || die "PostgreSQL no responde"
ok "PostgreSQL en ejecución"

# ------------------------------------------------------------------ usuario de sistema y código
id "$SERVICIO" >/dev/null 2>&1 || useradd --system --home-dir "$DIR" --no-create-home --shell /usr/sbin/nologin "$SERVICIO"
mkdir -p "$DIR"
info "Copiando la aplicación a $DIR"
tar -C "$SRC/app" --exclude=node_modules --exclude=uploads --exclude=.jwt_secret --exclude=.integrations_key --exclude=.env --exclude='*.log' -cf - . | tar -C "$DIR" -xf -
mkdir -p "$DIR/uploads"; chown -R "$SERVICIO":"$SERVICIO" "$DIR"; chmod 750 "$DIR"

# ------------------------------------------------------------------ configuración y secretos
mkdir -p "$ENVDIR"; chmod 750 "$ENVDIR"; chgrp "$SERVICIO" "$ENVDIR"
if [ "$PRIMERA" -eq 1 ]; then
  DBPASS="$(openssl rand -hex 16)"; ADMIN_PASS="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-14)Aa1"
  cat > "$ENVF" <<EOF
# Configuración del servicio $SERVICIO (no compartir). Generada por instalar.sh
DATABASE_URL=postgres://$DBUSER:$DBPASS@127.0.0.1:5432/$DB
JWT_SECRET=$(openssl rand -hex 48)
INTEGRATIONS_KEY=$(openssl rand -hex 32)
PORT=$PUERTO
HOST=0.0.0.0
NODE_ENV=production
TRUST_PROXY=0
EOF
  chmod 640 "$ENVF"; chgrp "$SERVICIO" "$ENVF"
  como_pg psql -qtAc "SELECT 1 FROM pg_roles WHERE rolname='$DBUSER'" | grep -q 1 || como_pg psql -qc "CREATE ROLE \"$DBUSER\" LOGIN PASSWORD '$DBPASS'"
  como_pg psql -qc "ALTER ROLE \"$DBUSER\" PASSWORD '$DBPASS'"
  como_pg psql -qtAc "SELECT 1 FROM pg_database WHERE datname='$DB'" | grep -q 1 || como_pg psql -qc "CREATE DATABASE \"$DB\" OWNER \"$DBUSER\""
  ok "Base de datos y secretos creados"
else
  PUERTO="$(grep '^PORT=' "$ENVF" | cut -d= -f2)"; ok "Instalación existente: se conserva la configuración y los datos"
fi

# ------------------------------------------------------------------ dependencias de la app, esquema y datos iniciales
info "Instalando dependencias de la aplicación (npm)"
( cd "$DIR" && runuser -u "$SERVICIO" -- env HOME="$DIR" npm ci --omit=dev --no-audit --no-fund --loglevel=error )
( cd "$DIR" && como_app node db/setup.js )
if [ "$PRIMERA" -eq 1 ]; then
  if [ "$DEMO" -eq 1 ]; then
    DEMO_PASS="Demo-$(openssl rand -hex 4)-Aa1"
    ( cd "$DIR" && como_app env DEMO_PASSWORD="$DEMO_PASS" node db/seed.js >/dev/null )
    USUARIO="admin@demo.cl"; CLAVE="$DEMO_PASS"
  else
    ( cd "$DIR" && como_app env SEED_MODE=produccion EMPRESA_NOMBRE="$EMPRESA" EMPRESA_RUT="$RUT" EMPRESA_SLUG="empresa" ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_PASSWORD="$ADMIN_PASS" node db/seed.js >/dev/null )
    USUARIO="$ADMIN_EMAIL"; CLAVE="$ADMIN_PASS"
    info "Sincronizando la UF (necesita internet; si falla se carga a mano en la aplicación)"
    ( cd "$DIR" && como_app node db/sync-indices.js ) || true
  fi
  printf 'Usuario: %s\nClave:   %s\n(Cámbiela al ingresar: menú Cuenta > Cambiar contraseña. Elimine este archivo después.)\n' "$USUARIO" "$CLAVE" > "$CREDF"; chmod 600 "$CREDF"
  ok "Datos iniciales cargados"
fi

# ------------------------------------------------------------------ servicio
cat > "/usr/local/bin/$SERVICIO-iniciar" <<EOF
#!/usr/bin/env bash
# Arranque sin systemd (contenedores): $SERVICIO-iniciar
cd "$DIR"; set -a; . "$ENVF"; set +a
exec runuser -u "$SERVICIO" -- env "DATABASE_URL=\$DATABASE_URL" "JWT_SECRET=\$JWT_SECRET" "INTEGRATIONS_KEY=\$INTEGRATIONS_KEY" "PORT=\$PORT" "HOST=\$HOST" "NODE_ENV=\$NODE_ENV" "TRUST_PROXY=\$TRUST_PROXY" node server/index.js
EOF
chmod 755 "/usr/local/bin/$SERVICIO-iniciar"
if [ "$HAY_SYSTEMD" -eq 1 ]; then
  cat > "/etc/systemd/system/$SERVICIO.service" <<EOF
[Unit]
Description=Sistema de corretaje ($SERVICIO)
After=network.target postgresql.service
Wants=postgresql.service

[Service]
User=$SERVICIO
WorkingDirectory=$DIR
EnvironmentFile=$ENVF
ExecStart=$(command -v node) server/index.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=$DIR/uploads

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload; systemctl enable "$SERVICIO" >/dev/null 2>&1; systemctl restart "$SERVICIO"
else
  [ -f "/run/$SERVICIO.pid" ] && kill "$(cat /run/$SERVICIO.pid)" 2>/dev/null || true
  sleep 1; nohup "/usr/local/bin/$SERVICIO-iniciar" > "/var/log/$SERVICIO.log" 2>&1 & echo $! > "/run/$SERVICIO.pid"
  warn "Sin systemd: el servicio se inició en segundo plano; tras reiniciar el equipo ejecute $SERVICIO-iniciar"
fi
for _ in $(seq 1 30); do curl -fs "http://127.0.0.1:$PUERTO/api/health" >/dev/null && break; sleep 1; done
curl -fs "http://127.0.0.1:$PUERTO/api/health" >/dev/null || die "El servicio no respondió. Revise los registros ($([ "$HAY_SYSTEMD" -eq 1 ] && echo "journalctl -u $SERVICIO" || echo "/var/log/$SERVICIO.log"))"
ok "Servicio activo en el puerto $PUERTO"

# ------------------------------------------------------------------ respaldos diarios (base + fotos), 14 días
mkdir -p "$BKP"; chmod 700 "$BKP"
cat > "/usr/local/bin/$SERVICIO-backup" <<EOF
#!/usr/bin/env bash
set -e
f="$BKP/\$(date +%Y%m%d-%H%M)"
runuser -u postgres -- pg_dump -Fc "$DB" > "\$f.dump"
tar -C "$DIR" -czf "\$f-fotos.tgz" uploads
find "$BKP" -maxdepth 1 -type f -mtime +14 -delete
echo "Respaldo: \$f.dump"
EOF
chmod 755 "/usr/local/bin/$SERVICIO-backup"
if [ -d /etc/cron.d ]; then echo "15 3 * * * root /usr/local/bin/$SERVICIO-backup >> /var/log/$SERVICIO-backup.log 2>&1" > "/etc/cron.d/$SERVICIO-backup"; ok "Respaldo diario programado (03:15) en $BKP"
else warn "Sin cron: ejecute $SERVICIO-backup periódicamente"; fi

# ------------------------------------------------------------------ resumen
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
printf '\n\033[1m════════ Instalación completa ════════\033[0m\n'
echo "Abra:  http://localhost:$PUERTO    o    http://${IP:-IP-del-servidor}:$PUERTO"
[ "$PRIMERA" -eq 1 ] && { echo; cat "$CREDF"; echo "(guardado también en $CREDF)"; }
echo
if [ "$HAY_SYSTEMD" -eq 1 ]; then echo "Estado:        systemctl status $SERVICIO"; echo "Registros:     journalctl -u $SERVICIO -f"
else echo "Registros:     tail -f /var/log/$SERVICIO.log"; fi
echo "Respaldo:      $SERVICIO-backup        Actualizar: git pull && sudo ./instalar.sh"
echo "Desinstalar:   sudo ./instalar.sh --desinstalar"
[ "$DEMO" -eq 0 ] && echo "Pendiente:     revise Mantenedores > Índices (UF/IPC), Comisiones (reglas de ejemplo) y Administración > Parámetros."
warn "Para usar el sistema por internet ponga un proxy con HTTPS (Caddy/Nginx) delante y use TRUST_PROXY=1 en $ENVF."
