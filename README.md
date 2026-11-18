# Sistema de corretaje inmobiliario

Venta, arriendo y administración de propiedades con trazabilidad financiera de cada operación. Diseño en los `0*.md`; la aplicación está en `app/` (detalles y límites en `app/README.md`).

## Instalar (Ubuntu / Debian)

```bash
git clone https://github.com/jherreranavarro-hash/Corretaje.git
cd Corretaje
sudo ./instalar.sh            # pide empresa, RUT y correo del administrador
# o, para conocerlo con datos de ejemplo:
sudo ./instalar.sh --demo
```
El instalador deja todo operativo: instala Node 22 y PostgreSQL si faltan, crea la base y un usuario de sistema, genera los secretos y la clave del administrador,
registra el servicio (systemd), programa un respaldo diario (14 días) y muestra la dirección y las credenciales. Volver a ejecutarlo **actualiza** sin tocar los datos.
`sudo ./instalar.sh --desinstalar [--borrar-datos]` lo retira. Opciones: `--puerto`, `--dir`, `--db`, `--db-user`, `--servicio`.

## Windows y macOS (con Docker)

Requiere **Docker Desktop**; si no lo tiene, el script ofrece instalarlo (winget en Windows, Homebrew en macOS).

**Windows** (PowerShell, dentro de la carpeta del proyecto):
```powershell
.\instalar-docker.ps1            # o  .\instalar-docker.ps1 -Demo
```
Si Windows bloquea el script: `powershell -ExecutionPolicy Bypass -File .\instalar-docker.ps1`

**macOS** (Terminal):
```bash
./instalar-docker.sh            # o  ./instalar-docker.sh --demo
```
Hacen lo mismo: generan `.env` con claves aleatorias, levantan PostgreSQL y la aplicación, esperan a que responda y muestran la dirección (`http://localhost:3000`)
y la clave del administrador (también en `credenciales.txt`). Volver a ejecutarlos **actualiza** conservando los datos; `--respaldo` / `-Respaldo` genera un respaldo en `respaldos/`;
`--desinstalar` / `-Desinstalar` lo detiene (`--borrar-datos` / `-BorrarDatos` elimina también los datos).
Por defecto solo se abre desde el mismo equipo (`BIND=127.0.0.1` en `.env`); use `BIND=0.0.0.0` para la red local.

> Estado de pruebas: la generación de configuración del script de macOS/Linux se probó en seco; **la ejecución con Docker y el script de Windows no se han probado** (el entorno de desarrollo no tiene Docker ni PowerShell).
