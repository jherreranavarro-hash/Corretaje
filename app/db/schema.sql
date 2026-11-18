-- Esquema consolidado del sistema de corretaje (PostgreSQL 15+)
-- Multi-tenant: todas las tablas de negocio llevan empresa_id y tienen RLS forzado.
CREATE EXTENSION IF NOT EXISTS btree_gist;
DO $$ BEGIN CREATE TYPE moneda AS ENUM ('CLP','UF','USD'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===================== PLATAFORMA / ADMINISTRACION =====================
CREATE TABLE IF NOT EXISTS empresa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL, rut text UNIQUE NOT NULL, razon_social text NOT NULL,
  moneda_base moneda NOT NULL DEFAULT 'CLP', iva_pct numeric(5,2) NOT NULL DEFAULT 19.00,
  parametros jsonb NOT NULL DEFAULT '{}', activa boolean NOT NULL DEFAULT true, created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sucursal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL REFERENCES empresa,
  nombre text NOT NULL, activa boolean DEFAULT true
);
CREATE TABLE IF NOT EXISTS rol (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL REFERENCES empresa,
  nombre text NOT NULL, permisos text[] NOT NULL DEFAULT '{}',
  alcance text NOT NULL DEFAULT 'empresa' CHECK (alcance IN ('empresa','sucursal','propios')),
  UNIQUE (empresa_id, nombre)
);
CREATE TABLE IF NOT EXISTS usuario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL REFERENCES empresa,
  sucursal_id uuid REFERENCES sucursal, rol_id uuid NOT NULL REFERENCES rol,
  email text NOT NULL, nombre text NOT NULL, rut text, password_hash text NOT NULL,
  es_agente boolean NOT NULL DEFAULT false, activo boolean NOT NULL DEFAULT true,
  intentos_fallidos int NOT NULL DEFAULT 0, bloqueado_hasta timestamptz, ultimo_acceso timestamptz,
  created_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_usuario_email ON usuario (lower(email));
CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY, empresa_id uuid, usuario_id uuid, entidad text, entidad_id text, accion text,
  antes jsonb, despues jsonb, at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_audit ON audit_log (empresa_id, at DESC);
CREATE TABLE IF NOT EXISTS secuencia (
  empresa_id uuid NOT NULL REFERENCES empresa, clave text NOT NULL, siguiente bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (empresa_id, clave)
);

-- ===================== MANTENEDORES =====================
CREATE TABLE IF NOT EXISTS catalogo (
  id serial PRIMARY KEY, empresa_id uuid NOT NULL REFERENCES empresa, grupo text NOT NULL,
  codigo text NOT NULL, nombre text NOT NULL, orden int NOT NULL DEFAULT 0, activo boolean NOT NULL DEFAULT true,
  datos jsonb NOT NULL DEFAULT '{}', UNIQUE (empresa_id, grupo, codigo)
);
CREATE TABLE IF NOT EXISTS concepto (
  id serial PRIMARY KEY, empresa_id uuid NOT NULL REFERENCES empresa, codigo text NOT NULL, nombre text NOT NULL,
  naturaleza text NOT NULL CHECK (naturaleza IN ('ingreso','egreso','traspaso')),
  categoria text, afecto_iva boolean NOT NULL DEFAULT true, requiere_respaldo boolean NOT NULL DEFAULT false,
  monto_referencial numeric(18,4), activo boolean NOT NULL DEFAULT true, es_sistema boolean NOT NULL DEFAULT false,
  UNIQUE (empresa_id, codigo)
);
-- Indices economicos (UF, IPC variacion mensual %, UTM, USD): globales
CREATE TABLE IF NOT EXISTS indice_valor (
  codigo text NOT NULL, fecha date NOT NULL, valor numeric(18,6) NOT NULL,
  origen text NOT NULL DEFAULT 'manual', cargado_at timestamptz DEFAULT now(), PRIMARY KEY (codigo, fecha)
);
CREATE TABLE IF NOT EXISTS periodo (
  empresa_id uuid NOT NULL REFERENCES empresa, periodo char(7) NOT NULL,
  estado text NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto','cerrado')), cerrado_por uuid, cerrado_at timestamptz,
  PRIMARY KEY (empresa_id, periodo)
);

-- ===================== PERSONAS / PROPIEDADES =====================
CREATE TABLE IF NOT EXISTS persona (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL REFERENCES empresa,
  tipo text NOT NULL DEFAULT 'natural' CHECK (tipo IN ('natural','juridica')),
  rut text, nombre text NOT NULL, email text, telefono text, roles text[] NOT NULL DEFAULT '{}',
  no_contactar boolean NOT NULL DEFAULT false, consentimiento_datos_at timestamptz, notas text,
  agente_responsable_id uuid REFERENCES usuario, created_at timestamptz DEFAULT now(), deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_persona_rut ON persona (empresa_id, rut) WHERE rut IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS propiedad (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL REFERENCES empresa,
  sucursal_id uuid REFERENCES sucursal, codigo text NOT NULL, tipo_id int REFERENCES catalogo, comuna_id int REFERENCES catalogo,
  direccion text NOT NULL, rol_sii text, sup_util numeric(10,2), sup_terreno numeric(10,2),
  dormitorios smallint, banos smallint, estacionamientos smallint DEFAULT 0, bodegas smallint DEFAULT 0,
  amoblada boolean DEFAULT false, acepta_mascotas boolean, gasto_comun numeric(18,4), contribuciones numeric(18,4),
  descripcion text, notas_internas text,
  precio_venta numeric(18,4), moneda_venta moneda DEFAULT 'UF', precio_arriendo numeric(18,4), moneda_arriendo moneda DEFAULT 'CLP',
  estado text NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador','captada','publicada','reservada','vendida','arrendada','retirada')),
  agente_captador_id uuid REFERENCES usuario, completitud smallint NOT NULL DEFAULT 0, retirada_motivo text,
  fotos jsonb NOT NULL DEFAULT '[]', created_at timestamptz DEFAULT now(), deleted_at timestamptz,
  UNIQUE (empresa_id, codigo)
);
CREATE INDEX IF NOT EXISTS ix_prop ON propiedad (empresa_id, estado);
CREATE TABLE IF NOT EXISTS propiedad_propietario (
  empresa_id uuid NOT NULL REFERENCES empresa, propiedad_id uuid NOT NULL REFERENCES propiedad,
  persona_id uuid NOT NULL REFERENCES persona, porcentaje numeric(5,2) NOT NULL CHECK (porcentaje > 0 AND porcentaje <= 100),
  principal boolean NOT NULL DEFAULT false, PRIMARY KEY (propiedad_id, persona_id)
);
CREATE TABLE IF NOT EXISTS propiedad_historial (
  id bigserial PRIMARY KEY, empresa_id uuid NOT NULL REFERENCES empresa, propiedad_id uuid NOT NULL REFERENCES propiedad,
  tipo text NOT NULL, anterior text, nuevo text, motivo text, usuario_id uuid, at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mandato (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL REFERENCES empresa,
  propiedad_id uuid NOT NULL REFERENCES propiedad, tipo text NOT NULL CHECK (tipo IN ('venta','arriendo','administracion')),
  exclusivo boolean NOT NULL DEFAULT false, fecha_inicio date NOT NULL, fecha_fin date NOT NULL,
  comision_tipo text CHECK (comision_tipo IN ('porcentaje','monto_fijo','meses_renta')), comision_valor numeric(18,4),
  honorario_admin_pct numeric(6,3), honorario_admin_minimo numeric(18,4) DEFAULT 0,
  estado text NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente','vencido','terminado')),
  agente_id uuid REFERENCES usuario, notas text, created_at timestamptz DEFAULT now(),
  CHECK (fecha_fin > fecha_inicio)
);
ALTER TABLE mandato DROP CONSTRAINT IF EXISTS mandato_excl_no_solape;
ALTER TABLE mandato ADD CONSTRAINT mandato_excl_no_solape
  EXCLUDE USING gist (propiedad_id WITH =, tipo WITH =, daterange(fecha_inicio, fecha_fin, '[]') WITH &&)
  WHERE (exclusivo AND estado = 'vigente');

-- ===================== PUBLICACION =====================
CREATE TABLE IF NOT EXISTS publicacion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL REFERENCES empresa,
  propiedad_id uuid NOT NULL REFERENCES propiedad, operacion text NOT NULL CHECK (operacion IN ('venta','arriendo')),
  canal_id int NOT NULL REFERENCES catalogo,
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','publicada','pausada','expirada','error','retirada')),
  id_externo text, url_externa text, titulo text, descripcion text, precio numeric(18,4), moneda moneda,
  costo numeric(18,4) NOT NULL DEFAULT 0, movimiento_id uuid, publicada_at timestamptz, expira_at date,
  created_by uuid, created_at timestamptz DEFAULT now(), UNIQUE (propiedad_id, operacion, canal_id)
);

-- ===================== CRM =====================
CREATE TABLE IF NOT EXISTS lead (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL REFERENCES empresa,
  persona_id uuid NOT NULL REFERENCES persona, propiedad_id uuid REFERENCES propiedad, fuente_id int REFERENCES catalogo,
  publicacion_id uuid REFERENCES publicacion, interes text NOT NULL DEFAULT 'comprar' CHECK (interes IN ('comprar','arrendar','vender','arrendar_propiedad_propia','administrar')),
  mensaje text, estado text NOT NULL DEFAULT 'nuevo' CHECK (estado IN ('nuevo','contactado','visita','oferta','ganado','perdido')),
  motivo_perdida_id int REFERENCES catalogo, agente_id uuid REFERENCES usuario, asignado_at timestamptz,
  primer_contacto_at timestamptz, presupuesto_max numeric(18,4), moneda moneda DEFAULT 'CLP',
  created_at timestamptz DEFAULT now(), cerrado_at timestamptz
);
CREATE INDEX IF NOT EXISTS ix_lead ON lead (empresa_id, estado, agente_id);
CREATE TABLE IF NOT EXISTS interaccion (
  id bigserial PRIMARY KEY, empresa_id uuid NOT NULL REFERENCES empresa, persona_id uuid NOT NULL REFERENCES persona,
  lead_id uuid REFERENCES lead, tipo text NOT NULL DEFAULT 'nota', detalle text, usuario_id uuid, at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS visita (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL REFERENCES empresa,
  propiedad_id uuid NOT NULL REFERENCES propiedad, lead_id uuid REFERENCES lead, persona_id uuid REFERENCES persona,
  agente_id uuid NOT NULL REFERENCES usuario, inicio timestamptz NOT NULL, fin timestamptz NOT NULL,
  estado text NOT NULL DEFAULT 'agendada' CHECK (estado IN ('agendada','confirmada','realizada','no_asistio','cancelada')),
  interes_nivel smallint CHECK (interes_nivel BETWEEN 1 AND 5), feedback text, CHECK (fin > inicio)
);
ALTER TABLE visita DROP CONSTRAINT IF EXISTS visita_sin_solape;
ALTER TABLE visita ADD CONSTRAINT visita_sin_solape
  EXCLUDE USING gist (agente_id WITH =, tstzrange(inicio, fin) WITH &&) WHERE (estado IN ('agendada','confirmada'));

-- ===================== OPERACIONES =====================
CREATE TABLE IF NOT EXISTS operacion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL REFERENCES empresa,
  codigo text NOT NULL, tipo text NOT NULL CHECK (tipo IN ('venta','arriendo','captacion')),
  propiedad_id uuid NOT NULL REFERENCES propiedad, lead_id uuid REFERENCES lead,
  cliente_id uuid REFERENCES persona,  -- comprador o arrendatario
  agente_captador_id uuid REFERENCES usuario, agente_vendedor_id uuid REFERENCES usuario,
  estado text NOT NULL, precio numeric(18,4), moneda moneda NOT NULL DEFAULT 'CLP',
  detalle jsonb NOT NULL DEFAULT '{}', caida_motivo text, abierta_at timestamptz DEFAULT now(), cerrada_at timestamptz,
  UNIQUE (empresa_id, codigo)
);
CREATE INDEX IF NOT EXISTS ix_op ON operacion (empresa_id, tipo, estado);
CREATE TABLE IF NOT EXISTS operacion_historial (
  id bigserial PRIMARY KEY, empresa_id uuid NOT NULL REFERENCES empresa, operacion_id uuid NOT NULL REFERENCES operacion,
  estado_desde text, estado_hacia text NOT NULL, motivo text, usuario_id uuid, at timestamptz DEFAULT now()
);

-- ===================== FINANZAS =====================
CREATE TABLE IF NOT EXISTS regla_comision (
  id serial PRIMARY KEY, empresa_id uuid NOT NULL REFERENCES empresa, nombre text NOT NULL,
  tipo_operacion text NOT NULL CHECK (tipo_operacion IN ('venta','arriendo')),
  base text NOT NULL CHECK (base IN ('precio','canon','renta_meses','fijo')),
  pct numeric(7,4), meses numeric(5,2), monto_fijo numeric(18,4), minimo numeric(18,4), tope numeric(18,4),
  escala jsonb, afecta_iva boolean NOT NULL DEFAULT true,
  pagador text NOT NULL DEFAULT 'cliente' CHECK (pagador IN ('propietario','cliente','corredora','tercero')),
  hito_devengo text NOT NULL, reparto jsonb NOT NULL DEFAULT '{"captador":30,"vendedor":40,"corredora":30}',
  vigente_desde date NOT NULL DEFAULT current_date, vigente_hasta date, activa boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS comision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL REFERENCES empresa,
  operacion_id uuid NOT NULL REFERENCES operacion, regla_id int REFERENCES regla_comision, regla_snapshot jsonb,
  hito text NOT NULL, base_clp numeric(18,4) NOT NULL, monto_neto numeric(18,4) NOT NULL, iva numeric(18,4) NOT NULL DEFAULT 0,
  movimiento_id uuid, estado text NOT NULL DEFAULT 'devengada' CHECK (estado IN ('devengada','aprobada','pagada','anulada')),
  aprobada_por uuid, created_at timestamptz DEFAULT now(), UNIQUE (operacion_id, hito)
);
CREATE TABLE IF NOT EXISTS liquidacion_agente (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL REFERENCES empresa,
  agente_id uuid NOT NULL REFERENCES usuario, periodo char(7) NOT NULL,
  bruto numeric(18,4) NOT NULL DEFAULT 0, descuentos numeric(18,4) NOT NULL DEFAULT 0, retencion numeric(18,4) NOT NULL DEFAULT 0,
  neto numeric(18,4) NOT NULL DEFAULT 0, estado text NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador','aprobada','pagada','anulada')),
  aprobada_por uuid, created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS comision_reparto (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL REFERENCES empresa,
  comision_id uuid NOT NULL REFERENCES comision, rol text NOT NULL CHECK (rol IN ('captador','vendedor','referido','corredora')),
  beneficiario_id uuid REFERENCES usuario, pct numeric(7,4) NOT NULL, monto numeric(18,4) NOT NULL,
  liquidacion_id uuid REFERENCES liquidacion_agente
);

CREATE TABLE IF NOT EXISTS documento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL REFERENCES empresa,
  tipo text NOT NULL, titulo text NOT NULL, entidad text, entidad_id uuid,
  estado text NOT NULL DEFAULT 'generado' CHECK (estado IN ('borrador','generado','pendiente_firma','firmado','anulado')),
  contenido text, version int NOT NULL DEFAULT 1, hash text, firmado_at timestamptz, firmantes jsonb DEFAULT '[]',
  created_by uuid, created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS plantilla_documento (
  id serial PRIMARY KEY, empresa_id uuid NOT NULL REFERENCES empresa, tipo text NOT NULL, nombre text NOT NULL,
  contenido text NOT NULL, activa boolean NOT NULL DEFAULT true, revisada_legal_at date, UNIQUE (empresa_id, tipo)
);

CREATE TABLE IF NOT EXISTS movimiento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL REFERENCES empresa,
  fecha date NOT NULL, periodo char(7),
  operacion_id uuid REFERENCES operacion, propiedad_id uuid REFERENCES propiedad, contrato_id uuid, liquidacion_id uuid,
  publicacion_id uuid, documento_id uuid REFERENCES documento,
  concepto_id int NOT NULL REFERENCES concepto, tipo text NOT NULL CHECK (tipo IN ('ingreso','egreso','traspaso')),
  monto_neto numeric(18,4) NOT NULL CHECK (monto_neto >= 0), iva numeric(18,4) NOT NULL DEFAULT 0,
  monto_total numeric(18,4) GENERATED ALWAYS AS (monto_neto + iva) STORED,
  moneda moneda NOT NULL DEFAULT 'CLP', tipo_cambio numeric(18,6) NOT NULL DEFAULT 1,
  neto_clp numeric(18,4) NOT NULL, iva_clp numeric(18,4) NOT NULL DEFAULT 0, monto_clp numeric(18,4) NOT NULL,
  pagador text CHECK (pagador IN ('propietario','cliente','corredora','tercero')),
  contraparte_persona_id uuid REFERENCES persona, centro_costo_id int REFERENCES catalogo,
  estado text NOT NULL DEFAULT 'provisionado' CHECK (estado IN ('provisionado','facturado','pagado','anulado')),
  fondo text NOT NULL DEFAULT 'propio' CHECK (fondo IN ('propio','terceros')),
  fecha_pago date, medio_pago_id int REFERENCES catalogo, nro_documento text, tipo_documento_tributario text,
  requiere_aprobacion boolean NOT NULL DEFAULT false, aprobado_por uuid, aprobado_at timestamptz,
  origen text NOT NULL DEFAULT 'manual' CHECK (origen IN ('manual','evento','conciliacion','importacion')), origen_ref text,
  reversa_de uuid REFERENCES movimiento, glosa text, created_by uuid, created_at timestamptz DEFAULT now(),
  CHECK (operacion_id IS NOT NULL OR propiedad_id IS NOT NULL OR centro_costo_id IS NOT NULL OR contrato_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_mov_op ON movimiento (empresa_id, operacion_id);
CREATE INDEX IF NOT EXISTS ix_mov_prop ON movimiento (empresa_id, propiedad_id);
CREATE INDEX IF NOT EXISTS ix_mov_fecha ON movimiento (empresa_id, fecha);

CREATE OR REPLACE FUNCTION movimiento_periodo() RETURNS trigger AS $$
BEGIN NEW.periodo := to_char(NEW.fecha,'YYYY-MM'); RETURN NEW; END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_movimiento_periodo ON movimiento;
CREATE TRIGGER trg_movimiento_periodo BEFORE INSERT ON movimiento FOR EACH ROW EXECUTE FUNCTION movimiento_periodo();

-- El libro es append-only: solo pueden cambiar estado/pago/aprobacion/documento tributario
CREATE OR REPLACE FUNCTION movimiento_inmutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'El libro de movimientos no permite borrar; anule con una reversa'; END IF;
  IF (NEW.fecha, NEW.operacion_id, NEW.propiedad_id, NEW.concepto_id, NEW.tipo, NEW.monto_neto, NEW.iva, NEW.moneda,
      NEW.tipo_cambio, NEW.neto_clp, NEW.iva_clp, NEW.monto_clp, NEW.fondo, NEW.pagador)
     IS DISTINCT FROM
     (OLD.fecha, OLD.operacion_id, OLD.propiedad_id, OLD.concepto_id, OLD.tipo, OLD.monto_neto, OLD.iva, OLD.moneda,
      OLD.tipo_cambio, OLD.neto_clp, OLD.iva_clp, OLD.monto_clp, OLD.fondo, OLD.pagador) THEN
    RAISE EXCEPTION 'Movimiento inmutable: anule y registre uno nuevo';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_movimiento_inmutable ON movimiento;
CREATE TRIGGER trg_movimiento_inmutable BEFORE UPDATE OR DELETE ON movimiento FOR EACH ROW EXECUTE FUNCTION movimiento_inmutable();

CREATE TABLE IF NOT EXISTS liquidacion_agente_detalle (
  id bigserial PRIMARY KEY, empresa_id uuid NOT NULL REFERENCES empresa, liquidacion_id uuid NOT NULL REFERENCES liquidacion_agente,
  tipo text NOT NULL, comision_reparto_id uuid, operacion_id uuid, monto numeric(18,4) NOT NULL, glosa text
);

-- ===================== ARRIENDOS Y ADMINISTRACION =====================
CREATE TABLE IF NOT EXISTS contrato_arriendo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL REFERENCES empresa,
  operacion_id uuid NOT NULL REFERENCES operacion, propiedad_id uuid NOT NULL REFERENCES propiedad,
  arrendatario_id uuid NOT NULL REFERENCES persona, aval_id uuid REFERENCES persona,
  fecha_inicio date NOT NULL, fecha_termino date NOT NULL,
  canon_inicial numeric(18,4) NOT NULL, canon_vigente numeric(18,4) NOT NULL, canon_moneda moneda NOT NULL DEFAULT 'CLP',
  dia_pago smallint NOT NULL DEFAULT 5 CHECK (dia_pago BETWEEN 1 AND 28),
  reajuste_tipo text NOT NULL DEFAULT 'ipc' CHECK (reajuste_tipo IN ('ipc','uf','porcentaje_fijo','monto_fijo','ninguno')),
  reajuste_periodicidad_meses smallint DEFAULT 12, reajuste_valor numeric(10,4), proximo_reajuste date,
  garantia_monto numeric(18,4) NOT NULL DEFAULT 0,
  garantia_estado text NOT NULL DEFAULT 'pendiente' CHECK (garantia_estado IN ('pendiente','recibida','devuelta','retenida_parcial','retenida_total')),
  interes_mora_pct numeric(6,3) NOT NULL DEFAULT 0, dias_gracia smallint NOT NULL DEFAULT 0,
  administrado boolean NOT NULL DEFAULT true,
  estado text NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador','firmado','vigente','terminado','cerrado')),
  created_at timestamptz DEFAULT now(), CHECK (fecha_termino > fecha_inicio)
);
ALTER TABLE contrato_arriendo DROP CONSTRAINT IF EXISTS contrato_sin_solape;
ALTER TABLE contrato_arriendo ADD CONSTRAINT contrato_sin_solape
  EXCLUDE USING gist (propiedad_id WITH =, daterange(fecha_inicio, fecha_termino, '[]') WITH &&)
  WHERE (estado IN ('firmado','vigente'));
ALTER TABLE contrato_arriendo ADD COLUMN IF NOT EXISTS cobra_gasto_comun boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS contrato_reajuste (
  id bigserial PRIMARY KEY, empresa_id uuid NOT NULL REFERENCES empresa, contrato_id uuid NOT NULL REFERENCES contrato_arriendo,
  fecha_aplicacion date NOT NULL, canon_anterior numeric(18,4), canon_nuevo numeric(18,4), tipo text, variacion_pct numeric(10,6),
  detalle text, aplicado_por uuid, at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cargo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL REFERENCES empresa,
  contrato_id uuid NOT NULL REFERENCES contrato_arriendo, propiedad_id uuid NOT NULL REFERENCES propiedad,
  arrendatario_id uuid NOT NULL REFERENCES persona, periodo char(7) NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('canon','gasto_comun','servicio_basico','multa','interes_mora','reparacion','garantia','ajuste','otro')),
  descripcion text NOT NULL DEFAULT '', monto_original numeric(18,4) NOT NULL, moneda moneda NOT NULL DEFAULT 'CLP',
  valor_indice numeric(18,6) NOT NULL DEFAULT 1, monto_clp numeric(18,4) NOT NULL, saldo_clp numeric(18,4) NOT NULL CHECK (saldo_clp >= 0),
  emision date NOT NULL, vencimiento date NOT NULL,
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','parcial','pagado','vencido','anulado')),
  destino text NOT NULL DEFAULT 'propietario' CHECK (destino IN ('propietario','corredora','tercero')),
  anulado_motivo text, created_at timestamptz DEFAULT now(), UNIQUE (contrato_id, periodo, tipo, descripcion)
);
CREATE INDEX IF NOT EXISTS ix_cargo ON cargo (empresa_id, estado, vencimiento);
CREATE TABLE IF NOT EXISTS pago (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL REFERENCES empresa,
  contrato_id uuid NOT NULL REFERENCES contrato_arriendo, arrendatario_id uuid NOT NULL REFERENCES persona,
  fecha date NOT NULL, monto numeric(18,4) NOT NULL CHECK (monto > 0), medio_pago_id int REFERENCES catalogo,
  referencia text, estado text NOT NULL DEFAULT 'conciliado' CHECK (estado IN ('registrado','conciliado','revertido')),
  sin_asignar numeric(18,4) NOT NULL DEFAULT 0, movimiento_id uuid, registrado_por uuid, created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS liquidacion_propietario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL REFERENCES empresa,
  propiedad_id uuid NOT NULL REFERENCES propiedad, propietario_id uuid NOT NULL REFERENCES persona,
  contrato_id uuid REFERENCES contrato_arriendo, periodo char(7) NOT NULL,
  ingresos numeric(18,4) NOT NULL DEFAULT 0, honorario_neto numeric(18,4) NOT NULL DEFAULT 0, honorario_iva numeric(18,4) NOT NULL DEFAULT 0,
  gastos numeric(18,4) NOT NULL DEFAULT 0, saldo_anterior numeric(18,4) NOT NULL DEFAULT 0, neto_a_pagar numeric(18,4) NOT NULL,
  estado text NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador','revisada','aprobada','pagada','anulada')),
  aprobada_por uuid, pagada_at timestamptz, created_at timestamptz DEFAULT now(),
  UNIQUE (propiedad_id, propietario_id, periodo)
);
CREATE TABLE IF NOT EXISTS liquidacion_propietario_detalle (
  id bigserial PRIMARY KEY, empresa_id uuid NOT NULL REFERENCES empresa,
  liquidacion_id uuid NOT NULL REFERENCES liquidacion_propietario, tipo text NOT NULL, descripcion text, monto numeric(18,4) NOT NULL
);
CREATE TABLE IF NOT EXISTS pago_aplicacion (
  empresa_id uuid NOT NULL REFERENCES empresa, pago_id uuid NOT NULL REFERENCES pago, cargo_id uuid NOT NULL REFERENCES cargo,
  monto numeric(18,4) NOT NULL CHECK (monto > 0), liquidacion_id uuid REFERENCES liquidacion_propietario, PRIMARY KEY (pago_id, cargo_id)
);
ALTER TABLE movimiento DROP CONSTRAINT IF EXISTS movimiento_liq_fk;
CREATE TABLE IF NOT EXISTS orden_trabajo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL REFERENCES empresa, codigo text NOT NULL,
  propiedad_id uuid NOT NULL REFERENCES propiedad, contrato_id uuid REFERENCES contrato_arriendo,
  origen text NOT NULL DEFAULT 'corredora', categoria text, prioridad text NOT NULL DEFAULT 'media' CHECK (prioridad IN ('baja','media','alta','urgente')),
  descripcion text NOT NULL, proveedor_id uuid REFERENCES persona,
  estado text NOT NULL DEFAULT 'solicitada' CHECK (estado IN ('solicitada','pendiente_aprobacion','aprobada','en_ejecucion','terminada','rechazada','cancelada')),
  costo_estimado numeric(18,4), costo_real numeric(18,4),
  cargo_a text CHECK (cargo_a IN ('propietario','arrendatario','corredora')), aprobada_por uuid, aprobada_at timestamptz,
  fecha_solicitud timestamptz DEFAULT now(), fecha_termino date, movimiento_id uuid, created_by uuid,
  UNIQUE (empresa_id, codigo)
);

-- ===================== INTEGRACIONES =====================
CREATE TABLE IF NOT EXISTS integracion (
  id serial PRIMARY KEY, empresa_id uuid NOT NULL REFERENCES empresa, codigo text NOT NULL,
  activa boolean NOT NULL DEFAULT false, config jsonb NOT NULL DEFAULT '{}',   -- datos no sensibles (urls, ids)
  secretos text,                                                               -- JSON cifrado AES-256-GCM (iv.tag.dato en base64)
  estado text NOT NULL DEFAULT 'sin_configurar' CHECK (estado IN ('sin_configurar','configurada','conectada','error')),
  ultimo_resultado text, ultimo_test_at timestamptz, ultimo_exito_at timestamptz, actualizado_por uuid, actualizado_at timestamptz DEFAULT now(),
  UNIQUE (empresa_id, codigo)
);
CREATE TABLE IF NOT EXISTS integracion_log (
  id bigserial PRIMARY KEY, empresa_id uuid NOT NULL REFERENCES empresa, codigo text NOT NULL, operacion text NOT NULL,
  ok boolean NOT NULL, http_status int, duracion_ms int, detalle text, usuario_id uuid, at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_integracion_log ON integracion_log (empresa_id, codigo, at DESC);

-- ===================== SEGURIDAD: RLS =====================
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT c.table_name FROM information_schema.columns c
           JOIN information_schema.tables tb ON tb.table_name=c.table_name AND tb.table_schema=c.table_schema AND tb.table_type='BASE TABLE'
           WHERE c.table_schema='public' AND c.column_name='empresa_id' AND c.table_name NOT IN ('usuario','sucursal','rol')
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_iso ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_iso ON %I USING (empresa_id = nullif(current_setting('app.empresa_id', true),'')::uuid) WITH CHECK (empresa_id = nullif(current_setting('app.empresa_id', true),'')::uuid)$p$, t);
  END LOOP;
END $$;
