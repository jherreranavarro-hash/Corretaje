# Sistema de corretaje inmobiliario

Venta, arriendo y administración de propiedades, con trazabilidad financiera de cada operación
(comisiones, costos de documentos, publicidad, mantenciones, liquidaciones). Diseño completo en `../*.md`.

## Puesta en marcha

Requisitos: Node 20+, PostgreSQL 15+ (usa `EXCLUDE ... USING gist`, `btree_gist`, RLS).

```bash
# 1) Base de datos (una vez)
createuser corretaje --pwprompt && createdb corretaje -O corretaje
# 2) Configuración
cp .env.example .env        # ajuste DATABASE_URL y secretos
# 3) Instalar, crear esquema, cargar datos y arrancar
set -a; . ./.env; set +a
./scripts/start.sh          # http://localhost:3000
```

Demo: `admin@demo.cl` / `Demo-Corretaje-2026` (Gerente). También `ana@`, `luis@` (agentes), `adm@` (administración),
`finanzas@`, `lectura@` — misma contraseña. **Cámbiela antes de usar datos reales** (`DEMO_PASSWORD` al sembrar, o menú Cuenta).
Sitio público de la empresa demo: `/sitio/demo`.

## Pruebas

```bash
npm test     # crea una base temporal corretaje_test; requiere un usuario con CREATEDB
```
Verifican de extremo a extremo: venta (utilidad $945.000), reajuste IPC ($625.200), mora ($3.600), liquidación al propietario ($487.020),
inmutabilidad del libro, aprobaciones, cierre de período, permisos y aislamiento entre empresas.

## Qué incluye

| Área | Estado |
|---|---|
| Propiedades, propietarios (% dominio), mandatos (sin solape exclusivo), fotos, historial, completitud, alertas | ✔ |
| CRM: personas (RUT validado), leads con asignación rotativa, kanban, visitas sin solape, interacciones | ✔ |
| Publicación: sitio propio automático; portales/RRSS en modo **asistido** (el agente publica y confirma el ID); costo provisionado | ✔ |
| Ventas y arriendos: máquina de estados, efectos sobre propiedad/publicaciones, comisión por hito y reparto | ✔ |
| Libro de movimientos append-only (trigger), IVA, UF/CLP, fondos propios vs terceros, aprobación por umbral, anulación con reversa, cierre de período | ✔ |
| Comisiones: reglas versionadas, simulador, override auditado, liquidación y pago a agentes | ✔ |
| Administración: contratos, cargos mensuales idempotentes, prorrateo, pagos con aplicación, mora, reajuste IPC/fijo, garantía, OT con aprobación, liquidación al propietario | ✔ |
| Documentos desde plantillas (mandatos, contrato, liquidación), hash, firma **registrada manualmente** | ✔ |
| Reportes (11) con CSV, mantenedores, usuarios/roles/permisos, parámetros, auditoría | ✔ |
| Multi-empresa con **RLS forzado** en PostgreSQL | ✔ |

## Integraciones (menú Sistema → Integraciones)

Pantalla para ingresar usuario/contraseña, API keys o tokens de cada servicio: portales (Portal Inmobiliario, Yapo, TocToc, MercadoLibre), Meta (Facebook/Instagram),
WhatsApp Business, correo SMTP, firma electrónica, facturación SII (vía proveedor), pasarela de pago, banco e indicadores (UF/IPC).
Las credenciales se guardan **cifradas (AES-256-GCM)** con la clave `INTEGRATIONS_KEY` (o `.integrations_key` autogenerada; respáldela), nunca se devuelven por la API ni aparecen en logs/auditoría.
Flujo: Configurar → Probar conexión → Activar (solo si la prueba fue exitosa). Cambiar credenciales desactiva la integración hasta una nueva prueba. Solo el rol Gerente accede.

Estado real de cada una: la prueba contra el proveedor está implementada para **MercadoLibre, Meta, WhatsApp e Indicadores** (aún no ejecutadas contra los servicios reales: este entorno no tiene salida a internet, ver más abajo).
Para las demás (portales, firma, SII, pasarela, banco) se guardan las credenciales y, si ingresa una **URL de prueba** del proveedor, se hace una llamada autenticada (Basic o Bearer);
sin URL quedan "configuradas (sin verificar)". SMTP solo comprueba que el servidor responda. **Guardar credenciales no implica que el sistema ya publique o cobre por esa vía:**
los adaptadores que usan esas conexiones (publicar en el portal, emitir facturas, cobrar en línea, enviar WhatsApp/correos) son una fase siguiente y requieren la documentación de cada proveedor.

## Limitaciones conocidas (no confundir con terminado)

- **Portales y redes sociales:** no hay integración por API (no se verificó que Portal Inmobiliario, Yapo, Meta, etc. la ofrezcan). Hoy: sitio propio + publicación asistida. Cada canal es un adaptador a construir cuando exista acceso/convenio.
- Las integraciones (firma, SII, pasarela, WhatsApp, cartolas…) tienen **configuración de credenciales y prueba de conexión**, pero todavía no operan: la conciliación es manual y los pagos se registran a mano.
- **UF/IPC de demostración** (UF fija en 39.000): reemplazar por valores oficiales (menú Mantenedores → Índices; el botón "Sincronizar UF" usa una fuente externa y requiere salida a internet).
- **Reglas de ejemplo** (comisión 2% / 1 mes de renta, repartos, honorario 7%, retención 0%): configúrelas con su corredora y valídelas con su contador.
- Las **plantillas legales son borradores de apoyo**: requieren revisión de un abogado. Plazos de aviso, garantía, mora/intereses, fondos de terceros e IVA/retenciones deben validarse con asesoría legal y contable.
- Sin 2FA, sin portales de propietario/arrendatario/comprador, sin cotizaciones múltiples de OT, sin cuotas de comisión (un hito por regla).
- Montos en `numeric(18,4)`; la aritmética del servidor usa números JS con redondeo a pesos en CLP (suficiente para este alcance; revisar si se agregan cálculos fraccionarios complejos).

## Seguridad

Contraseñas con bcrypt, bloqueo tras 5 intentos fallidos, JWT de 10 h, permisos `modulo.accion` por rol, alcance "propios" para agentes,
RLS por empresa en todas las tablas de negocio, auditoría de cambios, honeypot y límite de consultas en el sitio público,
subida de imágenes validada (tipo y tamaño). Detrás de HTTPS use `TRUST_PROXY=1` solo si hay un proxy de confianza. Respalde con `pg_dump`.
Las fotos se sirven desde `/uploads` con nombres no adivinables (UUID), sin autenticación.

## Estructura

`db/schema.sql` esquema consolidado · `db/seed.js` datos base · `server/services/*` reglas de negocio · `server/routes/*` API REST ·
`public/` interfaz (JS sin dependencias) · `test/` pruebas de extremo a extremo.
