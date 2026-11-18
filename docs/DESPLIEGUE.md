# Puesta en producción como plataforma web (SaaS multi-corredora)

Objetivo: que cualquier corredora entre desde su navegador, sin instalar nada, con su propia marca y sus datos aislados, y que usted administre las cuentas y suscripciones desde `/plataforma`.

> Estado de verificación: la aplicación y su seguridad están cubiertas por 14 pruebas automáticas (`npm test`) y se recorrieron en navegador. **`docker-compose.prod.yml` y `Caddyfile` no se han podido ejecutar en el entorno de desarrollo** (no hay Docker ni dominio): revise sus logs en el primer despliegue.

## 1. Qué necesita
| Elemento | Detalle |
|---|---|
| Servidor | VPS Linux (Ubuntu 22.04/24.04), mínimo 2 vCPU y 4 GB de RAM, disco SSD ≥ 40 GB (DigitalOcean, Hetzner, AWS Lightsail, etc.) |
| Dominio | Uno propio (ej. `corretaje.midominio.cl`). Registro **A** hacia la IP del servidor. Para subdominios por corredora, agregue un registro **A** comodín `*.corretaje.midominio.cl` |
| Puertos | 80 y 443 abiertos (el resto cerrado; PostgreSQL no se publica) |
| Software | Docker y Docker Compose en el servidor |
| Correo | Un correo para avisos de certificados (`ACME_EMAIL`) |

## 2. Despliegue
```bash
# en el servidor
git clone https://github.com/jherreranavarro-hash/Corretaje.git && cd Corretaje
cp .env.prod.example .env.prod
# complete .env.prod: DOMINIO, ACME_EMAIL y 5 secretos (openssl rand -hex 32 para cada uno)
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```
Caddy obtiene y renueva los certificados HTTPS automáticamente. Compruebe: `https://SU-DOMINIO/api/health`.

## 3. Crear el administrador del sistema (una vez)
```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -e PADMIN_EMAIL=usted@midominio.cl app node db/admin-plataforma.js
```
Muestra una clave temporal. Entre a `https://SU-DOMINIO/plataforma`: deberá **activar la verificación en dos pasos** (obligatoria) y luego cambiar la clave.

## 4. Operar el servicio
1. En `/plataforma` → **Planes**: defina precios y límites (los incluidos son de ejemplo).
2. **Corredoras → Nueva corredora**: nombre, RUT, identificador, administrador y plan. Se crea un espacio aislado y se entrega **una sola vez** una clave temporal; el administrador debe cambiarla al primer ingreso.
3. Entregue a la corredora su enlace: `https://SU-DOMINIO/c/identificador` (o `https://identificador.SU-DOMINIO` si configuró el comodín). Cada corredora personaliza **nombre, logo y colores** en Administración → Marca y sitio web; su sitio público queda en `/sitio/identificador`.
4. **Suscripciones**: registre cada pago en la ficha de la corredora ("Registrar pago"); extiende la vigencia. Estados: *prueba → activa → vencida (solo lectura) → suspendida/cancelada (sin acceso, sesiones cerradas)*.
5. **Solicitudes comerciales**: el formulario público `POST /public/plataforma/solicitud` las deja en la plataforma.

## 5. Modelo de aislamiento ("instancias separadas")
- Una sola aplicación y una sola base, con **aislamiento lógico por corredora**: cada tabla de negocio tiene `empresa_id` y *Row Level Security* **forzado** en PostgreSQL; cada petición fija el contexto de su corredora dentro de la transacción, y la aplicación se conecta con un rol **sin privilegios de superusuario** (de lo contrario RLS no se aplicaría). Las pruebas verifican que una corredora no puede leer ni modificar datos de otra.
- Los administradores de plataforma usan un **realm de autenticación distinto**: un token de corredora no sirve en `/api/plataforma` y viceversa.
- Si un cliente grande exige **base de datos dedicada** (aislamiento físico), es una variante de despliegue (una instancia de la app y de PostgreSQL por cliente con este mismo código); no está automatizada.

## 6. Seguridad incluida
Contraseñas con bcrypt y política de complejidad · bloqueo por intentos y limitador por IP/correo · 2FA TOTP (obligatorio para administradores de plataforma, opcional u obligatorio por corredora) · primer ingreso con clave temporal que debe cambiarse · revocación inmediata de sesiones (cambio de clave, 2FA, suspensión) · suscripción vencida ⇒ solo lectura · credenciales de integraciones cifradas (AES-256-GCM) · cabeceras CSP/HSTS/anti-clickjacking · logos validados (sin SVG) · auditoría de plataforma y de cada corredora · respuestas sin enumeración de usuarios · HTTPS automático.

## 7. Antes de ofrecerlo a clientes (pendientes reales)
| Tema | Estado |
|---|---|
| **Cobro automático de suscripciones** (Webpay/Flow/Stripe) | No integrado: hoy los pagos se registran a mano |
| **Correo transaccional** (recuperar contraseña, invitaciones, avisos de vencimiento) | No existe: las claves temporales se entregan manualmente y el reinicio de clave lo hace el administrador desde `/plataforma` |
| **Términos de servicio, política de privacidad y contrato de encargo de datos** (Ley 19.628 / 21.719) | Deben redactarlos sus asesores legales |
| **Respaldos externos** | El respaldo diario queda en el mismo servidor: copie `respaldos` a un almacenamiento externo y pruebe una restauración |
| **Monitoreo y alertas** (caídas, disco, certificados) | No incluido |
| **Escala** | El limitador de intentos es en memoria (una instancia). Para varias instancias, use Redis o el límite del proxy |
| **Revisión de seguridad independiente** (pentest) | Recomendado antes de operar con datos reales de terceros |
| **Integraciones con portales** (publicar en Portal Inmobiliario, etc.) | Siguen pendientes (ver `app/README.md`) |

## 8. Actualizar y restaurar
```bash
git pull && docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build      # actualiza conservando datos
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T respaldo ls /respaldos     # ver respaldos
```
Restaurar: detenga `app`, cree una base vacía y use `pg_restore` con el archivo `.dump` elegido.
