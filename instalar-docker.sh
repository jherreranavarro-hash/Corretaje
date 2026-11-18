#!/usr/bin/env bash
# Instalador con Docker para macOS (y Linux). Requiere Docker Desktop (macOS) o Docker Engine + compose.
#   ./instalar-docker.sh                  instala (pide empresa, RUT y correo) o ACTUALIZA si ya está instalado
#   ./instalar-docker.sh --demo           con datos y usuarios de ejemplo
#   ./instalar-docker.sh --respaldo       crea un respaldo en ./respaldos
#   ./instalar-docker.sh --desinstalar [--borrar-datos]
# Opciones: --empresa "Nombre" --rut 76.123.456-7 --admin-email yo@correo.cl --puerto 3000
set -euo pipefail
cd "$(dirname "$0")"
EMPRESA=""; RUT=""; ADMIN_EMAIL=""; DEMO=0; PUERTO=3000; ACCION="instalar"; BORRAR=0
while [ $# -gt 0 ]; do case "$1" in
  --empresa) EMPRESA="$2"; shift 2;; --rut) RUT="$2"; shift 2;; --admin-email) ADMIN_EMAIL="$2"; shift 2;; --puerto) PUERTO="$2"; shift 2;;
  --demo) DEMO=1; shift;; --respaldo) ACCION="respaldo"; shift;; --desinstalar) ACCION="desinstalar"; shift;; --borrar-datos) BORRAR=1; shift;;
  -h|--help) sed -n '2,9p' "$0"; exit 0;; *) echo "Opción desconocida: $1"; exit 1;; esac; done
ok(){ printf '\033[32m✔\033[0m %s\n' "$*"; }; info(){ printf '\033[36m➜\033[0m %s\n' "$*"; }; die(){ printf '\033[31m✘ %s\033[0m\n' "$*" >&2; exit 1; }
rand_hex(){ openssl rand -hex "$1"; }

if [ "${DRY_RUN:-0}" != "1" ]; then
if ! command -v docker >/dev/null 2>&1; then
  echo "No se encontró Docker."
  if [ "$(uname)" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
    read -rp "¿Instalar Docker Desktop con Homebrew ahora? [s/N] " r
    if [[ "$r" =~ ^[sSyY] ]]; then brew install --cask docker && open -a Docker && echo "Docker se está iniciando: acepte los permisos que pida y vuelva a ejecutar este script cuando el icono de la ballena quede quieto."; exit 0; fi
  fi
  die "Instale Docker Desktop desde https://www.docker.com/products/docker-desktop y vuelva a ejecutar este script."
fi
docker info >/dev/null 2>&1 || die "Docker está instalado pero no está en ejecución. Abra Docker Desktop, espere a que inicie y reintente."
docker compose version >/dev/null 2>&1 || die "Falta 'docker compose' (Docker Desktop reciente lo incluye)."
fi

if [ "$ACCION" = "respaldo" ]; then
  mkdir -p respaldos; f="respaldos/corretaje-$(date +%Y%m%d-%H%M)"
  docker compose exec -T db pg_dump -U postgres -Fc corretaje > "$f.dump"
  docker compose exec -T app tar -czf - -C /app uploads > "$f-fotos.tgz"
  ok "Respaldo creado: $f.dump y $f-fotos.tgz"; exit 0
fi
if [ "$ACCION" = "desinstalar" ]; then
  if [ "$BORRAR" -eq 1 ]; then docker compose down -v && rm -f .env credenciales.txt && ok "Desinstalado y datos eliminados"
  else docker compose down && ok "Detenido. Los datos se conservan (use --borrar-datos para eliminarlos)"; fi; exit 0
fi

PRIMERA=1; [ -f .env ] && PRIMERA=0
if [ "$PRIMERA" -eq 1 ]; then
  if [ "$DEMO" -eq 0 ]; then
    if [ -t 0 ]; then
      [ -n "$EMPRESA" ] || read -rp "Nombre de la empresa: " EMPRESA
      [ -n "$RUT" ] || read -rp "RUT de la empresa (ej. 76.123.456-7): " RUT
      [ -n "$ADMIN_EMAIL" ] || read -rp "Correo del administrador (será su usuario): " ADMIN_EMAIL
    fi
    [ -n "$EMPRESA" ] && [ -n "$RUT" ] && [ -n "$ADMIN_EMAIL" ] || die "Faltan --empresa, --rut y --admin-email (o use --demo)"
  fi
  ADMIN_PASS="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-14)Aa1"; DEMO_PASS="Demo-$(rand_hex 4)-Aa1"
  {
    echo "POSTGRES_ADMIN_PASSWORD=$(rand_hex 16)"; echo "APP_DB_PASSWORD=$(rand_hex 16)"; echo "JWT_SECRET=$(rand_hex 48)"; echo "INTEGRATIONS_KEY=$(rand_hex 32)"
    echo "PORT=$PUERTO"
    if [ "$DEMO" -eq 1 ]; then echo "SEED_MODE=demo"; echo "DEMO_PASSWORD=$DEMO_PASS"
    else echo "SEED_MODE=produccion"; echo "EMPRESA_NOMBRE=$EMPRESA"; echo "EMPRESA_RUT=$RUT"; echo "ADMIN_EMAIL=$ADMIN_EMAIL"; echo "ADMIN_PASSWORD=$ADMIN_PASS"; fi
  } > .env; chmod 600 .env
  if [ "$DEMO" -eq 1 ]; then USUARIO="admin@demo.cl"; CLAVE="$DEMO_PASS"; else USUARIO="$ADMIN_EMAIL"; CLAVE="$ADMIN_PASS"; fi
  printf 'Usuario: %s\nClave:   %s\n(Cámbiela al ingresar: menú Cuenta > Cambiar contraseña. Elimine este archivo después.)\n' "$USUARIO" "$CLAVE" > credenciales.txt; chmod 600 credenciales.txt
  ok "Configuración generada (.env)"
else
  PUERTO="$(grep '^PORT=' .env | cut -d= -f2 || echo 3000)"; ok "Instalación existente: se conservan configuración y datos"
fi
[ "${DRY_RUN:-0}" = "1" ] && { ok "DRY_RUN: no se ejecutó docker"; exit 0; }

info "Construyendo e iniciando (la primera vez descarga imágenes: puede tardar varios minutos)"
docker compose up -d --build
info "Esperando a que el sistema responda"
for _ in $(seq 1 90); do curl -fs "http://localhost:$PUERTO/api/health" >/dev/null 2>&1 && break; sleep 2; done
curl -fs "http://localhost:$PUERTO/api/health" >/dev/null 2>&1 || die "No respondió a tiempo. Revise: docker compose logs app"
# la clave inicial ya no se necesita en .env (el administrador ya fue creado)
[ "$PRIMERA" -eq 1 ] && sed -i.bak 's/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD=/' .env && rm -f .env.bak
printf '\n\033[1m════════ Instalación completa ════════\033[0m\nAbra: http://localhost:%s\n' "$PUERTO"
[ "$PRIMERA" -eq 1 ] && { echo; cat credenciales.txt; }
echo; echo "Respaldo: ./instalar-docker.sh --respaldo    Actualizar: git pull && ./instalar-docker.sh    Detener: docker compose stop"
[ "$DEMO" -eq 0 ] && [ "$PRIMERA" -eq 1 ] && echo "Pendiente: revise Mantenedores > Índices (UF/IPC), Comisiones y Administración > Parámetros."
