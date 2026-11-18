# Sistema de Corretaje Inmobiliario — Estudio de mercado y Prompts

## 1. Hallazgos del estudio (resumen)

Fuentes revisadas: Brokerage Engine, TotalBrokerage, SkySlope, Propertybase, Buildout, Rex, BMBY (corretaje/CRM/transacciones); Buildium, TenantCloud, DoorLoop, Rentec Direct (administración de propiedades); BReal, Cloudbase (Chile); Portal Inmobiliario / Mercado Libre.

Patrones comunes:
- **Corretaje**: CRM + captación + publicaciones + transacciones (checklists) + **comisiones y back office contable**.
- **Administración de propiedades**: cobro de renta, liquidaciones al propietario, mantenciones, portal arrendatario/propietario, contabilidad con fondos de terceros.
- **Brecha de mercado**: pocas herramientas unen corretaje + administración + **finanzas por cada acción** (costo de documentos, comisiones, gastos). Ese es el diferencial del proyecto.
- **Chile**: no se verificó integración pública con Portal Inmobiliario; asumir que requiere acuerdo comercial / feed / API privada. Diseñar el módulo de portales con **adaptadores desacoplados** (API, feed XML/CSV o publicación asistida). Validar con cada portal.

## 2. Mapa de módulos

| # | Módulo | Propósito |
|---|---|---|
| 1 | Propiedades y captación | Ficha, propietario, mandato/exclusividad, fotos, documentos |
| 2 | Publicación y difusión | Portales (Portal Inmobiliario, Yapo, Toctoc…), RRSS (Meta, Instagram), web propia, WhatsApp |
| 3 | CRM y leads | Contactos, embudo, seguimiento, visitas, agenda |
| 4 | Gestión de ventas | Oferta, reserva, promesa, escritura, cierre, checklists |
| 5 | Gestión de arriendos | Postulación, evaluación, contrato, garantía, entrega/devolución |
| 6 | Administración de propiedades | Cobros, reajustes, morosidad, liquidaciones, mantenciones, gastos comunes |
| 7 | **Finanzas y costos por operación** | Ingreso de montos, comisiones, costos de documentos, centro de costo por operación, rentabilidad |
| 8 | Documentos y firma | Plantillas de contratos, generación, firma electrónica, repositorio |
| 9 | Portales de cliente | Propietario, arrendatario, comprador |
| 10 | Reportes y BI | KPIs, rentabilidad, embudo, cartera |
| 11 | Administración | Usuarios, roles, sucursales, auditoría, configuración |
| 12 | Mantenedores | Catálogos parametrizables (tipos, estados, comunas, tasas, conceptos) |
| 13 | Integraciones y notificaciones | Email, WhatsApp, SII/facturación, bancos, UF/IPC, calendario |

## 3. PROMPT MAESTRO (arquitectura general)

```
Actúa como arquitecto de software senior y analista de negocio inmobiliario en Chile.
Diseña un sistema web (SaaS multi-empresa) de corretaje inmobiliario cuyo foco es:
(a) VENTA, (b) ARRIENDO y (c) ADMINISTRACIÓN de propiedades, con trazabilidad
financiera completa de cada acción.

Entrega:
1. Visión, alcance y actores (corredor, agente, administrador, contador, propietario,
   arrendatario, comprador, super-admin).
2. Mapa de módulos (propiedades, publicación, CRM, ventas, arriendos, administración,
   finanzas, documentos/firma, portales de cliente, reportes, administración,
   mantenedores, integraciones) con dependencias entre ellos.
3. Modelo de datos (entidades, atributos, relaciones, claves, estados) en formato
   ERD textual + DDL PostgreSQL. Todo monto con moneda (CLP/UF/USD), valor UF a la fecha
   y decimales correctos. Multi-tenant (empresa/sucursal) y auditoría en todas las tablas.
4. Principio rector: TODA acción de negocio (captación, publicación, visita, reserva,
   contrato, cobro, liquidación, mantención) puede tener costos e ingresos asociados
   ingresables manualmente (monto, concepto, proveedor, documento de respaldo, IVA,
   quién paga: propietario/cliente/corredora). Define un "libro de movimientos" único
   enlazado a la operación.
5. Roles y permisos (RBAC) por módulo y acción, con aprobaciones para montos sobre umbral.
6. Arquitectura técnica recomendada (backend, frontend, colas, almacenamiento, jobs
   programados, integraciones por adaptadores), seguridad (Ley 19.628/21.719 de datos
   personales), respaldos y observabilidad.
7. Roadmap por fases (MVP → v1 → v2) con criterios de aceptación.
8. Riesgos y supuestos a validar (p.ej. integración con Portal Inmobiliario, SII).

Formato: secciones numeradas, tablas y diagramas en Mermaid. No escribas código de
aplicación todavía.
```

## 4. PROMPTS POR MÓDULO

### 4.1 Propiedades y captación
```
Diseña el módulo "Propiedades y captación" para un sistema de corretaje chileno.
Incluye: ficha de propiedad (tipo, operación venta/arriendo/ambas, dirección normalizada
con región/comuna, rol SII, superficies, dormitorios/baños, estacionamiento/bodega,
amenities, gastos comunes, contribuciones, estado legal), propietario(s) con
porcentaje de dominio, mandato de corretaje (exclusividad, vigencia, comisión pactada,
renovación), galería de fotos/planos/video/tour 360 con orden y portada, documentos
(escritura, certificado de dominio, hipotecas y gravámenes, avalúo), historial de
precios y estados (borrador, captada, publicada, reservada, vendida/arrendada, retirada).
Entrega: casos de uso, pantallas, validaciones (RUT, rol, precio en CLP/UF), reglas de
negocio, entidades, API REST, y alertas (mandato por vencer, documentos faltantes).
```

### 4.2 Publicación y difusión (portales y redes sociales)
```
Diseña el módulo "Publicación y difusión multicanal".
Canales: Portal Inmobiliario, Yapo, Toctoc, MercadoLibre Inmuebles, sitio web propio
(con SEO y sitemap), Facebook/Instagram (Meta Graph API y catálogo), WhatsApp Business,
Google Business Profile, email marketing.
Requisitos:
- Patrón adaptador por canal (API, feed XML/CSV o publicación asistida) con estado por
  publicación: pendiente, publicada, error, pausada, expirada.
- Publicar una vez y distribuir a N canales; plantillas de título/descripción por canal;
  generación de textos con IA editable; mapeo de campos propios → campos del portal.
- Sincronización de cambios (precio, estado, retiro), re-publicación, destacados/pagados.
- Registro de COSTO por publicación (plan de portal, destacado, pauta en Meta) imputado
  a la propiedad y a la operación.
- Captura de leads entrantes desde cada canal hacia el CRM con la fuente (UTM).
- Métricas por publicación: vistas, contactos, costo por lead.
- Manejo de errores, reintentos, límites de API y auditoría.
Entrega: diagrama de componentes, contrato del adaptador, entidades, flujos y riesgos
(términos de uso de cada portal, necesidad de convenio comercial).
```

### 4.3 CRM y leads
```
Diseña el módulo CRM inmobiliario: contactos (persona/empresa, RUT, rol: propietario,
comprador, arrendatario, aval, inversionista), leads con fuente y campaña, embudo
configurable (nuevo, contactado, visita, oferta, cierre, perdido con motivo),
asignación automática (round-robin/por zona), tareas y recordatorios, agenda de visitas
con calendario y confirmación por WhatsApp/email, historial de interacciones,
matching automático propiedad↔demanda (criterios guardados del cliente), plantillas de
mensajes, secuencias de seguimiento, deduplicación y consentimiento de datos.
Entrega: entidades, estados, reglas, pantallas (kanban, ficha 360), KPIs
(tasa de conversión, tiempo de respuesta) y eventos que dispara hacia otros módulos.
```

### 4.4 Gestión de ventas
```
Diseña el módulo "Ventas": flujo oferta → reserva → promesa de compraventa → crédito
hipotecario/tasación/estudio de títulos → escritura → inscripción CBR → entrega → cierre.
Incluye checklists por etapa con documentos requeridos y responsables, plazos y alertas,
múltiples partes (compradores, vendedores, abogado, notaría, banco), contraofertas,
bitácora y estados de la operación.
FINANZAS por operación: precio, pie, monto crédito, comisión de venta (% o monto fijo,
parte vendedor/comprador, IVA), reparto entre corredora, agente captador y agente
vendedor (split configurable), costos asociados (estudio de títulos, notaría, CBR,
tasación, impuestos, publicidad, gastos de gestión) ingresables manualmente con
respaldo, y quién los asume. Calcula utilidad neta de la operación.
Entrega: máquina de estados, entidades, reglas de cálculo con ejemplos numéricos y
pantallas.
```

### 4.5 Gestión de arriendos
```
Diseña el módulo "Arriendos": postulación (formulario online, documentos: liquidaciones,
cédula, antecedentes), evaluación/scoring configurable, aval o seguro, aprobación del
propietario, contrato (plazo, canon en CLP o UF, reajuste IPC/UF/fijo y periodicidad,
garantía, día de pago, multas, cláusulas), acta de entrega con inventario y fotos,
renovación, término anticipado, restitución y devolución de garantía con descuentos.
FINANZAS: comisión de arriendo (ej. % o meses de renta, IVA, quién paga), costo de
contrato/notaría/firma, informes comerciales, mes de garantía, gastos de publicación,
todo ingresable por monto y concepto, asociado al arriendo.
Entrega: estados, entidades, reglas de reajuste con ejemplos, alertas de vencimiento
y pantallas.
```

### 4.6 Administración de propiedades
```
Diseña el módulo de administración de cartera arrendada:
- Mandato de administración (honorario % sobre canon, mínimo, mantención extra).
- Generación mensual automática de cobros (canon reajustado, gastos comunes, servicios
  básicos, multas, intereses por mora), conciliación de pagos (transferencia, webpay,
  depósito, cheque) y estado de cuenta del arrendatario.
- Morosidad: aging, recordatorios escalonados, cartas, gestión de cobranza.
- Liquidación mensual al propietario: ingresos − honorario − gastos (mantenciones,
  contribuciones, seguros, reparaciones) − retenciones, con PDF y transferencia;
  cuenta corriente por propietario (fondos de terceros separados de los propios).
- Mantenciones: solicitud desde portal, cotizaciones, aprobación del propietario por
  monto, orden de trabajo, proveedor, costo real, evidencia fotográfica.
- Inspecciones periódicas, vencimientos (seguros, contribuciones), proveedores.
Entrega: flujos, entidades, asientos contables generados, reportes y pantallas.
```

### 4.7 Finanzas y costos por operación (módulo clave)
```
Diseña el módulo financiero transversal. Objetivo: registrar y analizar ingresos y
costos de CADA acción de negocio (captación, publicación, venta, arriendo, administración).
Incluye:
- Libro de movimientos: fecha, operación/propiedad asociada, tipo (ingreso/egreso/
  traspaso), concepto (mantenedor), monto neto, IVA, total, moneda (CLP/UF/USD) y valor
  UF del día, quién paga, estado (provisionado, facturado, pagado), proveedor/cliente,
  documento de respaldo (boleta, factura, comprobante adjunto) y centro de costo.
- Comisiones: reglas configurables por tipo de operación, escalas por monto o
  producción acumulada, splits entre captador/vendedor/corredora/referido, tope y
  mínimo, devengo al hito (reserva, escritura, pago), liquidación a agentes con
  descuentos (gastos, anticipos) y estado (pendiente, aprobada, pagada).
- Costos de documentos y trámites (certificados, notaría, CBR, tasación, firma
  electrónica): catálogo con valor referencial y valor real ingresable.
- Cuentas por cobrar/pagar, caja y bancos, conciliación bancaria (carga de cartola),
  fondos de terceros vs propios, plan de cuentas simplificado y exportación contable.
- Facturación/boletas de honorarios (integración SII vía proveedor), IVA débito/crédito.
- Presupuesto vs real, flujo de caja proyectado, rentabilidad por operación, agente,
  sucursal y canal de captación.
Entrega: modelo de datos, reglas de cálculo con 3 ejemplos numéricos (venta, arriendo,
administración), validaciones, permisos, auditoría inmutable y reportes.
```

### 4.8 Documentos y firma
```
Diseña el módulo documental: repositorio por entidad (propiedad, cliente, operación),
tipos documentales y vencimientos (mantenedor), plantillas de contratos con variables
(corretaje, promesa, arriendo, administración, mandato, acta de entrega), generación PDF,
versionado, firma electrónica (simple/avanzada vía proveedor) con trazabilidad y
estados, almacenamiento seguro, OCR opcional y registro del COSTO de cada documento
(firma, notaría) hacia el módulo financiero.
```

### 4.9 Portales de cliente
```
Diseña portales web/móvil para propietario (estado de su propiedad, visitas, ofertas,
liquidaciones, documentos, aprobar mantenciones), arrendatario (estado de cuenta, pagar
en línea, solicitudes, contrato, comunicaciones) y comprador (favoritos, visitas, estado
de su operación). Incluye autenticación, notificaciones y permisos de visibilidad.
```

### 4.10 Reportes y BI
```
Define dashboards y reportes: embudo y conversión por canal, tiempo en el mercado,
cartera por estado, ocupación y vacancia, morosidad, comisiones por agente, ingresos vs
costos por operación, rentabilidad por canal/sucursal, flujo de caja proyectado,
forecast de cierres. Para cada uno: métrica, fórmula, dimensiones, filtros, roles con
acceso y exportación (Excel/PDF). Incluye diseño de vistas SQL o modelo dimensional.
```

### 4.11 Administración del sistema
```
Diseña el módulo de administración: empresas y sucursales (multi-tenant), usuarios, roles
y permisos granulares (RBAC), equipos, aprobaciones por monto, configuración general
(moneda base, IVA, zona horaria, numeración), parámetros de comisión por defecto,
plantillas de notificación, auditoría (quién, qué, cuándo, valor anterior/nuevo),
logs de integraciones, respaldos, 2FA y políticas de contraseñas, importación/
exportación masiva (Excel).
```

### 4.12 Mantenedores
```
Diseña la capa de mantenedores (CRUD parametrizable con activación/desactivación,
orden, vigencia y auditoría) para: regiones/comunas, tipos de propiedad, tipos de
operación, estados de propiedad/operación/lead/contrato, fuentes de lead, motivos de
pérdida, amenities, monedas, índices (UF, IPC, UTM) con carga automática y manual,
bancos y tipos de cuenta, medios de pago, conceptos de ingreso y egreso, centros de
costo, tipos de documento, plantillas, proveedores y categorías, tipos de comisión y
escalas, checklists por etapa, impuestos (IVA), canales de publicación y sus costos,
roles. Define esquema genérico reutilizable y reglas de integridad (no borrar si tiene
uso).
```

### 4.13 Integraciones y notificaciones
```
Diseña la capa de integraciones: portales inmobiliarios, Meta/WhatsApp Business,
Google Calendar, correo, proveedor de facturación electrónica SII, pasarela de pago,
bancos (cartolas), indicadores UF/IPC (mindicador/CMF), firma electrónica. Define
adaptadores, colas con reintentos, webhooks, almacenamiento seguro de credenciales,
monitoreo y plan de contingencia. Incluye notificaciones multicanal con plantillas y
preferencias del usuario.
```

## 5. Prompt de implementación (después del diseño)
```
Con el diseño aprobado, implementa la Fase MVP: [módulos]. Stack: [definir].
Entrega por iteraciones pequeñas: migraciones, modelos, API, pruebas automatizadas,
UI y datos semilla de mantenedores. Cada iteración debe compilar, tener tests y un
README de cómo ejecutarla.
```

## 6. Orden recomendado
1. Maestro → 2. Mantenedores + Administración → 3. Propiedades → 4. Finanzas → 5. CRM → 6. Arriendos y Ventas → 7. Administración de propiedades → 8. Publicación/portales → 9. Documentos/firma → 10. Portales de cliente → 11. Reportes → 12. Integraciones.

> Puntos a validar: reglas tributarias (IVA sobre comisiones, boletas/facturas), Ley de datos personales, y disponibilidad real de API/feeds de cada portal.
