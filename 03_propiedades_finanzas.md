# Módulos 1 (Propiedades y captación) y 7 (Finanzas y costos por operación)

Continúa de `01_arquitectura_maestro.md` y `02_mantenedores_administracion.md`. PostgreSQL 15+, multi-tenant (RLS por `empresa_id`).

---

# PARTE A — PROPIEDADES Y CAPTACIÓN

## A1. Casos de uso

| # | Caso de uso | Actor |
|---|---|---|
| P1 | Captar propiedad (alta rápida desde móvil: dirección, propietario, fotos mínimas) | Agente |
| P2 | Completar ficha y documentos | Agente |
| P3 | Registrar propietario(s) con % de dominio | Agente |
| P4 | Firmar mandato de corretaje (venta/arriendo/administración) | Agente / Propietario |
| P5 | Gestionar galería (fotos, planos, video, tour 360), orden y portada | Agente |
| P6 | Cambiar precio (con historial) | Agente / Gerente |
| P7 | Cambiar estado según transiciones | Agente |
| P8 | Alertas: mandato por vencer, documentos faltantes, ficha incompleta, precio sin revisar | Sistema |
| P9 | Buscar/filtrar cartera y exportar | Todos |
| P10 | Retirar / reactivar propiedad | Agente / Gerente |

## A2. Modelo de datos (completo del módulo)

```sql
-- Propiedad: se amplía la tabla del maestro (ALTER sobre la definición previa)
ALTER TABLE propiedad
  ADD COLUMN subtipo_id int,
  ADD COLUMN calle text, ADD COLUMN numero text, ADD COLUMN depto_oficina text,
  ADD COLUMN lat numeric(9,6), ADD COLUMN lng numeric(9,6),
  ADD COLUMN anio_construccion smallint,
  ADD COLUMN estacionamientos smallint DEFAULT 0, ADD COLUMN bodegas smallint DEFAULT 0,
  ADD COLUMN piso smallint, ADD COLUMN orientacion_id int,
  ADD COLUMN estado_legal_id int, ADD COLUMN amoblada boolean,
  ADD COLUMN descripcion text, ADD COLUMN notas_internas text,
  ADD COLUMN precio_venta numeric(18,4), ADD COLUMN moneda_venta moneda,
  ADD COLUMN precio_arriendo numeric(18,4), ADD COLUMN moneda_arriendo moneda,
  ADD COLUMN acepta_mascotas boolean, ADD COLUMN completitud smallint DEFAULT 0,  -- 0-100
  ADD COLUMN retirada_motivo text, ADD COLUMN deleted_at timestamptz;

CREATE TABLE propiedad_amenity (
  propiedad_id uuid REFERENCES propiedad ON DELETE CASCADE, amenity_id int NOT NULL,
  PRIMARY KEY (propiedad_id, amenity_id)
);

CREATE TABLE propiedad_propietario (
  propiedad_id uuid REFERENCES propiedad, persona_id uuid REFERENCES persona,
  porcentaje_dominio numeric(5,2) NOT NULL CHECK (porcentaje_dominio > 0 AND porcentaje_dominio <= 100),
  es_contacto_principal boolean DEFAULT false, representante_persona_id uuid REFERENCES persona,
  vigente_desde date DEFAULT current_date, vigente_hasta date,
  PRIMARY KEY (propiedad_id, persona_id, vigente_desde)
);

CREATE TABLE mandato (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa, propiedad_id uuid NOT NULL REFERENCES propiedad,
  tipo text NOT NULL CHECK (tipo IN ('venta','arriendo','administracion')),
  exclusivo boolean NOT NULL DEFAULT false,
  fecha_inicio date NOT NULL, fecha_fin date NOT NULL, renovacion_automatica boolean DEFAULT false,
  comision_tipo text CHECK (comision_tipo IN ('porcentaje','monto_fijo','meses_renta')),
  comision_valor numeric(18,4), comision_moneda moneda,
  comision_incluye_iva boolean DEFAULT false, pagador_comision text,
  honorario_admin_pct numeric(6,3), honorario_admin_minimo numeric(18,4),
  documento_id uuid, estado_id int NOT NULL, agente_id uuid REFERENCES usuario,
  motivo_termino text, created_at timestamptz DEFAULT now(),
  CHECK (fecha_fin > fecha_inicio)
);
-- Solo un mandato exclusivo vigente por propiedad y tipo
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE mandato ADD CONSTRAINT mandato_excl_no_solape
  EXCLUDE USING gist (propiedad_id WITH =, tipo WITH =, daterange(fecha_inicio, fecha_fin, '[]') WITH &&)
  WHERE (exclusivo AND estado_id IS NOT NULL);   -- refinar con filtro por estados vigentes

CREATE TABLE propiedad_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), propiedad_id uuid NOT NULL REFERENCES propiedad,
  tipo text CHECK (tipo IN ('foto','plano','video','tour360')),
  archivo_ref text NOT NULL, miniatura_ref text, titulo text, orden int NOT NULL DEFAULT 0,
  es_portada boolean DEFAULT false, ancho int, alto int, bytes bigint, subido_por uuid, subido_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX uq_portada ON propiedad_media (propiedad_id) WHERE es_portada;

CREATE TABLE propiedad_documento (   -- vínculo con el repositorio documental (módulo 8)
  propiedad_id uuid REFERENCES propiedad, documento_id uuid NOT NULL, tipo_documento_id int NOT NULL,
  fecha_emision date, fecha_vencimiento date, PRIMARY KEY (propiedad_id, documento_id)
);

CREATE TABLE propiedad_historial_precio (
  id bigserial PRIMARY KEY, propiedad_id uuid NOT NULL REFERENCES propiedad,
  operacion text CHECK (operacion IN ('venta','arriendo')),
  precio_anterior numeric(18,4), precio_nuevo numeric(18,4) NOT NULL, moneda moneda NOT NULL,
  motivo text, usuario_id uuid, at timestamptz DEFAULT now()
);

CREATE TABLE propiedad_historial_estado (
  id bigserial PRIMARY KEY, propiedad_id uuid NOT NULL REFERENCES propiedad,
  estado_desde int, estado_hacia int NOT NULL, motivo text, usuario_id uuid, at timestamptz DEFAULT now()
);

CREATE TABLE propiedad_alerta (
  id bigserial PRIMARY KEY, empresa_id uuid NOT NULL, propiedad_id uuid NOT NULL REFERENCES propiedad,
  tipo text NOT NULL, detalle text, severidad text DEFAULT 'media', generada_at timestamptz DEFAULT now(),
  resuelta_at timestamptz
);

CREATE INDEX ON propiedad (empresa_id, estado_id);
CREATE INDEX ON propiedad (empresa_id, comuna_id);
CREATE INDEX ON propiedad USING gin (atributos);
```

**Costos de captación:** se registran en el libro de movimientos (Parte B) con `propiedad_id` y `operacion_id` tipo `captacion`: fotografía profesional, letrero, certificados, tour 360, home staging.

## A3. Reglas de negocio

1. **Código único** por empresa, generado desde `secuencia` (ej. `V-2026-00123`; prefijo según operación).
2. **Dominio:** la suma de `porcentaje_dominio` vigente = 100 % para poder publicar; si no, queda como borrador.
3. **RUT:** validación de dígito verificador (módulo 11) en persona y representantes.
4. **Rol SII:** formato `NNNN-NNNN` (manzana-predio); advertir si falta, obligatorio para escriturar una venta.
5. **Precio:** obligatorio en la moneda elegida; si UF, mostrar equivalente CLP del día; cambios > X % (parámetro) exigen motivo y, sobre umbral, aprobación del gerente.
6. **Mandato:** un solo mandato exclusivo vigente por propiedad y tipo; para publicar una propiedad se requiere un mandato vigente (parámetro: exigir o advertir). Comisión pactada por defecto proviene de la regla de comisión vigente y puede sobrescribirse con justificación.
7. **Publicable** si: completitud ≥ umbral (ej. 70 %), ≥ N fotos, portada, dirección y comuna, precio, dominio 100 %, mandato vigente.
8. **Completitud (0–100):** ponderada: datos básicos 30, fotos 25, descripción 10, documentos obligatorios 20, mandato 15; se recalcula al guardar.
9. **Estados:** solo transiciones definidas en mantenedor (propiedad); `vendida/arrendada` se asigna automáticamente al cerrar la operación; `retirada` exige motivo.
10. **Borrado lógico**; no se elimina una propiedad con operaciones, contratos o movimientos.
11. Propiedad con arriendo vigente no puede pasar a `vendida` sin tratamiento del contrato (advertencia y tarea).
12. **Duplicados:** detectar dirección+número+depto similar y advertir antes de crear.

## A4. Alertas (job diario)

| Alerta | Regla | Destinatario |
|---|---|---|
| Mandato por vencer | `fecha_fin` − hoy ≤ `dias_alerta_mandato` (30 por defecto) | Agente, gerente |
| Mandato vencido con propiedad publicada | Estado publicada y mandato vencido | Gerente (bloquea re-publicación) |
| Documentos faltantes | Tipos obligatorios sin archivo vigente | Agente |
| Documento por vencer | `fecha_vencimiento` próxima | Agente |
| Ficha incompleta | completitud < umbral | Agente |
| Precio sin revisión | Sin cambio ni contacto en N días con pocas visitas | Agente |
| Dominio ≠ 100 % | Suma de % | Agente |

## A5. Pantallas

1. **Cartera:** tabla/tarjetas/mapa, filtros (operación, estado, comuna, precio, agente, sucursal, mandato por vencer), búsqueda por código/dirección/propietario, exportación Excel.
2. **Captación rápida (móvil):** formulario corto + cámara; guarda borrador y sincroniza.
3. **Ficha de propiedad** con pestañas: Datos · Propietarios · Mandatos · Galería · Documentos · Publicaciones · Visitas/Leads · Operaciones · **Finanzas (costos e ingresos)** · Historial.
4. **Galería:** subir múltiples, arrastrar para ordenar, definir portada, compresión y miniaturas automáticas.
5. **Mandato:** formulario con simulador de comisión y generación de PDF desde plantilla.
6. **Alertas/Tareas pendientes** del agente.

## A6. API REST

```
GET/POST        /api/propiedades               (filtros, paginación, export)
GET/PATCH/DELETE /api/propiedades/{id}
POST            /api/propiedades/{id}/estado   {estado_hacia, motivo}
POST            /api/propiedades/{id}/precio   {operacion, precio, moneda, motivo}
GET/PUT         /api/propiedades/{id}/propietarios
GET/POST        /api/propiedades/{id}/mandatos ; PATCH /api/mandatos/{id} ; POST /api/mandatos/{id}/terminar
POST            /api/propiedades/{id}/media    (subida firmada) ; PATCH orden/portada
GET             /api/propiedades/{id}/publicable   → {ok:boolean, faltantes:[...]}
GET             /api/propiedades/{id}/finanzas     → movimientos y resumen de la propiedad
GET             /api/alertas/propiedades
```

---

# PARTE B — FINANZAS Y COSTOS POR OPERACIÓN

## B1. Alcance
Registrar y analizar ingresos y costos de cada acción de negocio. Cuatro bloques:
1. **Libro de movimientos** (núcleo).
2. **Comisiones** (reglas, devengo, reparto, liquidación a agentes).
3. **Cuentas por cobrar/pagar, caja y conciliación.**
4. **Reportes de rentabilidad y flujo.**

Fuera del MVP: contabilidad completa (se exporta), emisión directa de documentos tributarios (v2 vía proveedor).

## B2. Libro de movimientos

La tabla `movimiento` está definida en el maestro. Se complementan:

```sql
-- Ampliaciones
ALTER TABLE movimiento
  ADD COLUMN cuenta_bancaria_id int,
  ADD COLUMN fecha_vencimiento date, ADD COLUMN fecha_pago date,
  ADD COLUMN medio_pago_id int, ADD COLUMN nro_documento_tributario text,
  ADD COLUMN tipo_documento_tributario text,           -- factura, boleta honorarios, boleta, nota crédito, sin documento
  ADD COLUMN requiere_aprobacion boolean DEFAULT false, ADD COLUMN aprobacion_id uuid,
  ADD COLUMN origen text NOT NULL DEFAULT 'manual'      -- manual | evento | conciliacion | importacion
        CHECK (origen IN ('manual','evento','conciliacion','importacion')),
  ADD COLUMN origen_ref text,                           -- id del evento/regla que lo generó
  ADD COLUMN conciliado boolean DEFAULT false, ADD COLUMN conciliacion_id uuid,
  ADD COLUMN periodo char(7) GENERATED ALWAYS AS (to_char(fecha,'YYYY-MM')) STORED;

-- Respaldos (varios por movimiento)
CREATE TABLE movimiento_documento (
  movimiento_id uuid REFERENCES movimiento, documento_id uuid NOT NULL, PRIMARY KEY (movimiento_id, documento_id)
);

-- Cuentas bancarias y de caja
CREATE TABLE cuenta_bancaria (
  id serial PRIMARY KEY, empresa_id uuid NOT NULL REFERENCES empresa, banco_id int, tipo text,
  numero text, titular_persona_id uuid, moneda moneda DEFAULT 'CLP',
  fondo text CHECK (fondo IN ('propio','terceros')) NOT NULL, activa boolean DEFAULT true
);

-- Cartola importada y conciliación
CREATE TABLE cartola_linea (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL, cuenta_bancaria_id int NOT NULL,
  fecha date NOT NULL, descripcion text, monto numeric(18,4) NOT NULL,   -- + abono / - cargo
  saldo numeric(18,4), referencia text, hash_linea text UNIQUE,          -- evita duplicados al re-importar
  estado text DEFAULT 'pendiente' CHECK (estado IN ('pendiente','conciliada','ignorada')), movimiento_id uuid
);
```

### Reglas
1. **Append-only:** `monto`, `concepto`, `operacion`, `fecha`, `moneda` no se modifican. Solo cambia `estado` (provisionado → facturado → pagado). Una corrección = movimiento `anulado` + movimiento nuevo (`reversa_de`).
2. **Montos:** `monto_neto ≥ 0`; el signo lo da `tipo` (ingreso/egreso). `iva` por defecto `neto × iva_pct` si el concepto es afecto; editable dentro de ±$1 de tolerancia por redondeo; si difiere más exige justificación.
3. **Moneda extranjera/UF:** `tipo_cambio` = valor del índice a la **fecha del movimiento**; `monto_clp = monto_total × tipo_cambio` (redondeo a pesos). Se congela.
4. **Quién paga** (`pagador`): propietario, cliente, corredora, tercero. Define si el movimiento afecta la utilidad de la corredora o se **traslada** a un tercero (ver B4).
5. **Fondo:** movimientos de arriendos cobrados por cuenta del propietario van en `fondo='terceros'`; no se usan para gastos propios. Una transferencia entre fondos requiere asiento `traspaso` aprobado.
6. **Aprobación:** si el monto ≥ umbral (mantenedor) queda `requiere_aprobacion`; no puede pasar a `pagado` hasta aprobarse y el aprobador ≠ creador.
7. **Respaldo:** conceptos con `requiere_respaldo` bloquean el paso a `pagado` sin documento; si no, queda marcado "sin respaldo" en reportes.
8. **Fecha:** no se admiten movimientos en períodos **cerrados** (cierre mensual por Finanzas); correcciones van al período abierto.
9. **Vinculación obligatoria:** todo movimiento tiene al menos `operacion_id` o `propiedad_id` o centro de costo (gasto general de la corredora).
10. Importes máximos y mínimos razonables (parámetro) generan advertencia.

### Pantalla de ingreso rápido de costos
Desde la ficha de la operación/propiedad: botón **"+ Costo / Ingreso"** → concepto (con monto referencial prellenado), monto neto, IVA automático, pagador, proveedor, fecha, respaldo (foto/PDF), glosa. Costos recurrentes de un checklist se **provisionan automáticamente** (ej. al pasar a "escritura" se provisiona notaría y CBR con el valor referencial, que el usuario ajusta al valor real).

## B3. Comisiones

### B3.1 Reglas configurables (`regla_comision`, ver maestro)
Parámetros: tipo de operación; base (`precio`, `canon`, `renta_meses`, `fijo`); `%` o monto; mínimo y tope; escala por tramos o por producción acumulada del agente; parte que paga vendedor/comprador/propietario/arrendatario; IVA; hito de devengo; vigencia.

Formato `escala` (JSON):
```json
{"tipo":"tramos_precio_uf","moneda":"UF",
 "tramos":[{"hasta":3000,"pct":2.0},{"hasta":8000,"pct":1.8},{"hasta":null,"pct":1.5}]}
```
Para reparto a agentes por producción acumulada:
```json
{"tipo":"produccion_acumulada_anual","moneda":"CLP",
 "tramos":[{"hasta":30000000,"agente_pct":40},{"hasta":80000000,"agente_pct":50},{"hasta":null,"agente_pct":60}]}
```

### B3.2 Reparto (`regla_reparto`)
```sql
CREATE TABLE regla_reparto (
  id serial PRIMARY KEY, empresa_id uuid NOT NULL REFERENCES empresa, nombre text NOT NULL,
  tipo_operacion text NOT NULL, activa boolean DEFAULT true, vigente_desde date NOT NULL, vigente_hasta date
);
CREATE TABLE regla_reparto_linea (
  id serial PRIMARY KEY, regla_id int NOT NULL REFERENCES regla_reparto,
  rol text NOT NULL CHECK (rol IN ('captador','vendedor','referido','corredora','gerente','otro')),
  pct numeric(7,4) NOT NULL, depende_de_escala boolean DEFAULT false, orden int
);  -- suma de pct = 100 (validación a nivel de aplicación y trigger diferido)
```
Reparto por defecto (ejemplo): captador 30 % · vendedor 40 % · corredora 30 %. Si captador = vendedor, recibe la suma. Un **override** por operación está permitido con permiso y deja auditoría.

### B3.3 Hitos de devengo
| Hito | Cuándo nace la comisión | Ejemplo |
|---|---|---|
| `reserva` | Al confirmar la reserva | Arriendo |
| `promesa` | Al firmar la promesa | Venta (parcial) |
| `escritura` | Al firmar escritura | Venta (habitual) |
| `inscripcion` | Al inscribirse en CBR | Venta conservadora |
| `primer_pago` | Primer pago del arriendo | Arriendo |
| `mensual` | Cada pago de canon | Administración |

Se permite **devengo en cuotas** (ej. 50 % en promesa, 50 % en escritura) con `comision_cuota`.

### B3.4 Ciclo de vida
`devengada → aprobada → liquidada/pagada` (o `anulada`).
- **Devengada:** generada automáticamente por el evento del hito, con reglas aplicadas (snapshot de % usados).
- **Aprobada:** Finanzas valida que la comisión fue **cobrada al cliente** (ingreso `pagado`) si la política es "se paga cuando se cobra" (parámetro: `pagar_comision_solo_si_cobrada`).
- **Liquidación a agente:** agrupa repartos aprobados del período; descuenta anticipos, costos imputables al agente y retenciones (boleta de honorarios: retención vigente — validar con contador); genera PDF y movimiento de egreso.
- **Anulación/ajuste:** si la operación cae (caída de venta, término anticipado), se revierte con contra-movimientos y se genera, si corresponde, **devolución/clawback** (parámetro por plazo).

```sql
CREATE TABLE comision_cuota (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), comision_id uuid NOT NULL REFERENCES comision,
  hito text NOT NULL, pct numeric(5,2) NOT NULL, monto_neto numeric(18,4) NOT NULL, iva numeric(18,4) NOT NULL,
  fecha_devengo date, movimiento_ingreso_id uuid, estado text DEFAULT 'pendiente'
);

CREATE TABLE liquidacion_agente (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL, agente_id uuid NOT NULL REFERENCES usuario,
  periodo char(7) NOT NULL, bruto numeric(18,4), descuentos numeric(18,4), retencion numeric(18,4), neto numeric(18,4),
  estado text DEFAULT 'borrador' CHECK (estado IN ('borrador','aprobada','pagada','anulada')),
  documento_id uuid, movimiento_pago_id uuid, aprobada_por uuid, created_at timestamptz DEFAULT now(),
  UNIQUE (agente_id, periodo, empresa_id)
);
CREATE TABLE liquidacion_agente_detalle (
  id bigserial PRIMARY KEY, liquidacion_id uuid REFERENCES liquidacion_agente,
  tipo text CHECK (tipo IN ('comision','anticipo','costo_imputado','ajuste','retencion')),
  comision_reparto_id uuid, movimiento_id uuid, monto numeric(18,4) NOT NULL, glosa text
);
CREATE TABLE anticipo_agente (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid, agente_id uuid, monto numeric(18,4),
  fecha date, saldo_pendiente numeric(18,4), movimiento_id uuid
);
```

## B4. Cómo se trata cada costo según quién paga

| Pagador | Efecto en utilidad corredora | Registro |
|---|---|---|
| Corredora | **Reduce utilidad** | Egreso propio |
| Propietario | Neutro (se cobra/descuenta) | Egreso con `pagador=propietario` + cargo en liquidación o cuenta del propietario |
| Cliente (comprador/arrendatario) | Neutro | Egreso y cobro de reembolso al cliente (ingreso pareado) |
| Tercero | Neutro | Solo informativo |

Si la corredora anticipa un costo que otro debe asumir → se crea **cuenta por cobrar** al pagador y el movimiento par queda enlazado (`reversa_de` no aplica; se usa `movimiento_relacionado_id`).

## B5. Cuentas por cobrar / pagar y conciliación

- **Por cobrar:** comisiones, reembolsos, honorarios. Estados: provisionado → facturado → pagado; aging (0-30, 31-60, 61-90, +90).
- **Por pagar:** proveedores, agentes, propietarios (liquidaciones). Calendario de pagos y generación de nómina de transferencias (archivo para banco, formato por definir).
- **Conciliación bancaria:** importar cartola (Excel/CSV/OFX, según banco) → sugerir coincidencias por monto + fecha ± días + referencia → usuario confirma. Líneas sin match → crear movimiento desde la cartola. Hash por línea evita duplicados.
- **Cierre mensual:** Finanzas cierra período (bloquea nuevos movimientos con fecha anterior). Reapertura solo con permiso especial y auditoría.
- **Exportación contable:** por período, asientos agrupados por `cuenta_contable` del concepto (formato a definir con el contador).

## B6. Impuestos
- **IVA:** conceptos afectos o exentos; IVA débito (ventas de servicios de corretaje) e IVA crédito (compras con factura). Reporte de **libro IVA** simple por período para entregar al contador.
- **Documentos tributarios:** MVP registra el número y tipo del documento emitido/recibido fuera del sistema; **v2** integra emisión vía proveedor certificado.
- **Honorarios de agentes:** si son independientes con boleta de honorarios, se calcula la retención (tasa vigente por parámetro, no fija en código).
- **Importante:** tasas y obligaciones deben validarse con un contador; el sistema debe permitir cambiarlas sin desplegar código.

## B7. Rentabilidad y reportes

Fórmulas (todas en CLP salvo indicación):

- **Ingresos operación** = Σ movimientos `ingreso` no anulados de la operación, con `pagador` distinto de traslado.
- **Costos operación** = Σ `egreso` con `pagador = corredora`.
- **Comisiones a agentes** = Σ repartos a agentes (captador, vendedor, referido).
- **Utilidad neta operación** = Ingresos − Costos − Comisiones a agentes.
- **Margen %** = Utilidad / Ingresos.
- **Costo de captación por propiedad** = Σ costos con `operacion.tipo='captacion'`.
- **Costo por lead por canal** = Costos de publicación del canal / leads del canal.
- **CAC por operación cerrada** = (Publicidad + captación) / operaciones cerradas.
- **Cartera administrada:** ingresos por honorario − costos directos de administración.

Reportes:
1. **Resultado por operación** (detalle de ingresos y costos con respaldo).
2. **Rentabilidad por agente, sucursal, canal de captación, tipo de operación.**
3. **Comisiones:** devengadas / aprobadas / pagadas / pendientes de cobro.
4. **Flujo de caja proyectado** (cobros y pagos por vencimiento, 12 semanas / 12 meses).
5. **Presupuesto vs real** por centro de costo y concepto.
6. **Cuentas por cobrar y pagar** con aging.
7. **Movimientos sin respaldo / sin conciliar / vencidos.**
8. **Libro IVA** y exportación contable.
9. **Auditoría financiera:** anulaciones, ediciones de reparto, aprobaciones.

Implementación: vistas materializadas por periodo (`mv_resultado_operacion`, `mv_flujo_caja`) refrescadas por job y al cierre.

## B8. Ejemplos numéricos

UF a $39.000, IVA 19 %, comisión neta + IVA.

**Ejemplo 1 — Venta**
Venta UF 5.000 ⇒ $195.000.000. Comisión 2 % pagada por el vendedor.
| Ítem | Neto | IVA | Total |
|---|---|---|---|
| Comisión (ingreso) | 3.900.000 | 741.000 | 4.641.000 |
Reparto del neto: captador 30 % = 1.170.000; vendedor 40 % = 1.560.000; corredora 30 % = 1.170.000.
Costos corredora: publicidad portal 120.000 + fotografía 80.000 + firma 25.000 = 225.000 (netos).
Costos pagados por el vendedor (estudio de títulos 180.000): neutros para la corredora.
**Utilidad neta** = 3.900.000 − (1.170.000 + 1.560.000) − 225.000 = **945.000** (margen 24,2 %).
*(Nota: el 30 % de corredora, 1.170.000, ya es lo que queda antes de costos; la fórmula equivale a 1.170.000 − 225.000.)*

**Ejemplo 2 — Arriendo**
Canon $600.000; comisión = 1 mes de renta (50 % arrendatario / 50 % propietario) + IVA.
Ingreso neto: 600.000 → IVA 114.000 → total 714.000 (357.000 cada parte).
Costos corredora: informe comercial 12.000, contrato/firma 15.000, publicación 30.000 = 57.000.
Reparto: captador 40 % (240.000), arrendador 40 % (240.000), corredora 20 % (120.000).
**Utilidad neta** = 600.000 − 480.000 − 57.000 = **63.000** (10,5 %). *Muestra por qué se necesita el costo real: un arriendo corto puede ser casi sin margen.*

**Ejemplo 3 — Administración (mes)**
Canon $600.000; honorario 7 % + IVA = 42.000 neto (IVA 7.980 → 49.980).
Costos propios: gestión de cobro/soporte imputado 8.000.
Mantención de $85.000 → egreso `fondo=terceros`, cargado al propietario (neutro).
Liquidación al propietario: 600.000 − 49.980 − 85.000 = **465.020**.
**Utilidad administración** = 42.000 − 8.000 = **34.000**.

*Valores ilustrativos para validar la lógica; porcentajes y retenciones reales los define cada empresa y su contador.*

## B9. Pantallas

1. **Libro de movimientos:** filtros por periodo, operación, propiedad, concepto, estado, pagador, centro de costo; totales; exportación.
2. **Alta rápida de movimiento** (modal reutilizable en toda la aplicación).
3. **Ficha financiera de la operación:** pestañas Ingresos · Costos · Comisiones · Utilidad (gráfico cascada), con alertas (sin respaldo, provisión sin confirmar).
4. **Comisiones:** reglas (simulador), devengos pendientes, aprobación, repartos override.
5. **Liquidaciones de agentes:** borrador → revisión → aprobación → pago; PDF.
6. **Cuentas por cobrar/pagar** y agenda de pagos.
7. **Conciliación:** dos columnas (cartola ↔ movimientos) con sugerencias.
8. **Cierre de período.**
9. **Dashboard financiero:** KPIs y flujo de caja.

## B10. API (resumen)

```
GET/POST   /api/movimientos            (filtros; POST valida reglas B2)
POST       /api/movimientos/{id}/anular        {motivo}          → crea reversa
POST       /api/movimientos/{id}/estado        {estado, fecha_pago?, medio_pago?}
POST       /api/movimientos/{id}/respaldos     (adjuntar documentos)
GET        /api/operaciones/{id}/finanzas      → ingresos, costos, comisiones, utilidad
POST       /api/operaciones/{id}/comisiones/calcular   → simulación sin guardar
POST       /api/operaciones/{id}/comisiones    → crea devengo + repartos (snapshot)
PATCH      /api/comisiones/{id}/reparto        (override con permiso y motivo)
POST       /api/comisiones/{id}/aprobar
GET/POST   /api/liquidaciones-agente ; POST /{id}/aprobar ; POST /{id}/pagar
GET        /api/cuentas-por-cobrar | /cuentas-por-pagar
POST       /api/conciliacion/cartola (importar) ; POST /api/conciliacion/match
POST       /api/periodos/{yyyy-mm}/cerrar | /reabrir
GET        /api/reportes/{nombre}?desde=&hasta=&...
```

## B11. Eventos de dominio que generan movimientos

| Evento | Acción en Finanzas |
|---|---|
| `publicacion.creada` | Provisión de costo según `canal_plan` (editable) |
| `operacion.hito_alcanzado` | Devenga comisión (cuota) según regla vigente |
| `checklist.item_cumplido` con costo esperado | Provisiona costo con valor referencial |
| `documento.firmado` (con costo) | Egreso de firma/notaría |
| `pago_arriendo.conciliado` | Ingreso `fondo=terceros` + cálculo de honorario |
| `liquidacion_propietario.aprobada` | Traspaso a fondos propios del honorario; egreso al propietario |
| `operacion.caida` | Reversas, evaluación de clawback |

Los eventos generan movimientos **propuestos** (`provisionado`); el usuario confirma o ajusta valores reales.

## B12. Permisos

| Acción | Gerente | Agente | Finanzas | Adm. propiedades |
|---|---|---|---|---|
| Ver movimientos de la empresa | ✔ | Solo propios | ✔ | Solo su cartera |
| Crear movimiento | ✔ | ✔ (costos de sus operaciones) | ✔ | ✔ (su cartera) |
| Anular movimiento | ✔ | ✘ | ✔ | ✘ |
| Aprobar sobre umbral | ✔ | ✘ | ✔ (si es su rol) | ✘ |
| Modificar reglas de comisión | ✔ | ✘ | ✘ | ✘ |
| Override de reparto | ✔ | ✘ | ✔ con aprobación | ✘ |
| Cerrar/reabrir período | ✘/✔ | ✘ | ✔/✘ | ✘ |
| Ver comisiones ajenas | ✔ | ✘ | ✔ | ✘ |

## B13. Criterios de aceptación (MVP)

- Registrar una venta y un arriendo completos con costos reales: la utilidad coincide con el cálculo manual de los ejemplos B8 (tolerancia $1).
- Cambiar el valor referencial de un concepto no altera movimientos existentes.
- Anular un movimiento genera una reversa y no se puede modificar el original.
- Un egreso sobre el umbral no pasa a pagado sin aprobación de otra persona.
- Una comisión devengada guarda el snapshot de la regla y no cambia si luego se modifica la regla.
- Liquidación de agente: suma comisiones, descuenta anticipo y retención, y genera PDF cuadrado.
- No se pueden crear movimientos en un período cerrado.
- Importar la misma cartola dos veces no duplica líneas.
- El reporte "movimientos sin respaldo" lista todos los egresos con respaldo obligatorio sin adjunto.

## B14. Riesgos y pendientes

| Tema | Pendiente |
|---|---|
| Retención de honorarios y tratamiento de IVA en comisiones | Validar con contador y mantener como parámetros |
| Formatos de cartola por banco / nómina de pagos | Definir bancos objetivo |
| Plan de cuentas y exportación contable | Definir formato del software contable del cliente |
| Política de clawback y plazos | Definir con la corredora |
| Fondos de terceros | Revisión legal/contable de la separación de cuentas |
| Uso de UF en comisiones | Confirmar fecha de referencia del valor UF (firma, escritura o pago) |

---

## Siguiente paso
Ejecutar **4.3 CRM**, **4.4 Ventas** y **4.5 Arriendos**, que generan los eventos que alimentan este módulo, y **4.6 Administración de propiedades** (cargos, pagos, liquidaciones al propietario).
