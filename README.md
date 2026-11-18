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

## Otros sistemas (Windows / macOS): Docker

`cp .env.docker.example .env`, edite los valores y ejecute `docker compose up -d --build` (**no probado** en el entorno de desarrollo).
