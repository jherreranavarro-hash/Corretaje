// Datos iniciales: empresa, roles, usuarios, mantenedores, conceptos, reglas y plantillas.
// Uso: node db/seed.js            (empresa 'demo' con datos de ejemplo)
//      SEED_DEMO=0 node db/seed.js (solo configuracion base)
const fs = require('fs'), path = require('path');
const bcrypt = require('bcryptjs');

const ROLES = {
  Gerente: { permisos: ['*'], alcance: 'empresa' },
  Agente: { alcance: 'propios', permisos: ['propiedades.*', 'personas.*', 'leads.*', 'visitas.*', 'operaciones.ver', 'operaciones.crear', 'operaciones.editar', 'publicaciones.*',
    'movimientos.ver', 'movimientos.crear', 'comisiones.ver', 'liquidaciones.ver', 'documentos.*', 'reportes.ver', 'contratos.ver', 'contratos.crear', 'catalogos.ver'] },
  'Administrador de propiedades': { alcance: 'empresa', permisos: ['propiedades.ver', 'personas.*', 'contratos.*', 'cargos.*', 'pagos.*', 'ot.*', 'liquidaciones.ver', 'liquidaciones.crear',
    'liquidaciones.editar', 'documentos.*', 'movimientos.ver', 'movimientos.crear', 'reportes.ver', 'operaciones.ver', 'catalogos.ver', 'publicaciones.ver'] },
  Finanzas: { alcance: 'empresa', permisos: ['movimientos.*', 'comisiones.*', 'liquidaciones.*', 'periodos.*', 'reportes.ver', 'propiedades.ver', 'operaciones.ver', 'contratos.ver', 'cargos.ver',
    'pagos.ver', 'catalogos.ver', 'documentos.ver', 'ot.ver', 'personas.ver', 'auditoria.ver', 'indices.editar', 'publicaciones.ver'] },
  'Solo lectura': { alcance: 'empresa', permisos: ['*.ver'] },
};
const C = (grupo, codigo, nombre, datos = {}, orden = 0) => ({ grupo, codigo, nombre, datos, orden });
const CATALOGOS = [
  ...['Casa', 'Departamento', 'Oficina', 'Local comercial', 'Terreno', 'Bodega', 'Estacionamiento', 'Parcela'].map((n, i) => C('tipo_propiedad', n.toUpperCase().replace(/ /g, '_'), n, {}, i)),
  ...['Santiago', 'Providencia', 'Las Condes', 'Vitacura', 'Lo Barnechea', 'Ñuñoa', 'La Reina', 'Macul', 'San Miguel', 'Maipú', 'La Florida', 'Peñalolén', 'Independencia', 'Recoleta', 'Quilicura', 'Viña del Mar', 'Valparaíso', 'Concepción']
    .map((n, i) => C('comuna', n.toUpperCase().replace(/[ÑÁÉÍÓÚ ]/g, m => ({ Ñ: 'N', Á: 'A', É: 'E', Í: 'I', Ó: 'O', Ú: 'U', ' ': '_' }[m])), n, {}, i)),
  C('fuente_lead', 'PORTAL_INMOBILIARIO', 'Portal Inmobiliario'), C('fuente_lead', 'YAPO', 'Yapo'), C('fuente_lead', 'INSTAGRAM', 'Instagram'), C('fuente_lead', 'FACEBOOK', 'Facebook'),
  C('fuente_lead', 'WHATSAPP', 'WhatsApp'), C('fuente_lead', 'WEB', 'Sitio web propio'), C('fuente_lead', 'REFERIDO', 'Referido'), C('fuente_lead', 'LETRERO', 'Letrero'), C('fuente_lead', 'LLAMADA', 'Llamada'),
  C('motivo_perdida', 'PRECIO', 'Precio'), C('motivo_perdida', 'COMPRO_OTRA', 'Compró/arrendó otra propiedad'), C('motivo_perdida', 'FINANCIAMIENTO', 'Financiamiento rechazado'),
  C('motivo_perdida', 'DESISTIO', 'Desistió'), C('motivo_perdida', 'SIN_RESPUESTA', 'Sin respuesta'),
  C('medio_pago', 'TRANSFERENCIA', 'Transferencia'), C('medio_pago', 'DEPOSITO', 'Depósito'), C('medio_pago', 'EFECTIVO', 'Efectivo'), C('medio_pago', 'WEBPAY', 'Tarjeta / Webpay'), C('medio_pago', 'CHEQUE', 'Cheque'),
  C('centro_costo', 'ADM_GENERAL', 'Administración general'), C('centro_costo', 'MARKETING', 'Marketing'), C('centro_costo', 'OFICINA', 'Oficina'),
  // canales: modo nativo = se publica solo; asistida = el agente publica en el portal y confirma el ID. El costo es referencial y editable por publicacion.
  C('canal', 'SITIO_WEB', 'Sitio web propio', { modo: 'nativo', costo: 0 }), C('canal', 'PORTAL_INMOBILIARIO', 'Portal Inmobiliario', { modo: 'asistida', costo: 0, nota: 'Configure el costo del plan' }),
  C('canal', 'YAPO', 'Yapo', { modo: 'asistida', costo: 0 }), C('canal', 'INSTAGRAM', 'Instagram', { modo: 'asistida', costo: 0 }), C('canal', 'FACEBOOK', 'Facebook', { modo: 'asistida', costo: 0 }),
  ...['Banco de Chile', 'BancoEstado', 'Santander', 'BCI', 'Scotiabank', 'Itaú'].map(n => C('banco', n.toUpperCase().replace(/[ÚÁ ]/g, m => ({ Ú: 'U', Á: 'A', ' ': '_' }[m])), n)),
  ...['Escritura', 'Certificado de dominio', 'Certificado de hipotecas y gravámenes', 'Avalúo fiscal', 'Cédula de identidad', 'Mandato', 'Contrato de arriendo', 'Acta de entrega'].map(n => C('tipo_documento', n.toUpperCase().replace(/[ÁÉÍÓÚ ]/g, m => ({ Á: 'A', É: 'E', Í: 'I', Ó: 'O', Ú: 'U', ' ': '_' }[m])), n)),
];
// [codigo, nombre, naturaleza, categoria, afecto_iva, requiere_respaldo, monto_referencial]
const CONCEPTOS = [
  ['COM_VENTA', 'Comisión de venta', 'ingreso', 'comision', true, false], ['COM_ARRIENDO', 'Comisión de arriendo', 'ingreso', 'comision', true, false],
  ['HONORARIO_ADMIN', 'Honorario de administración', 'ingreso', 'honorario', true, false], ['COBRO_ARRIENDO', 'Cobro de arriendo (fondos de terceros)', 'ingreso', 'cobro', false, false],
  ['GARANTIA', 'Garantía de arriendo (fondos de terceros)', 'ingreso', 'garantia', false, false],
  ['COM_AGENTE', 'Comisión pagada a agente', 'egreso', 'comision_agente', false, false],
  ['PUB_PORTAL', 'Publicación en portal / pauta', 'egreso', 'publicidad', true, false], ['FOTOGRAFIA', 'Fotografía profesional', 'egreso', 'captacion', true, true],
  ['LETRERO', 'Letrero y señalética', 'egreso', 'captacion', true, true],
  ['ESTUDIO_TITULOS', 'Estudio de títulos', 'egreso', 'documento', true, true], ['NOTARIA', 'Notaría', 'egreso', 'documento', false, true], ['CBR', 'Conservador de Bienes Raíces', 'egreso', 'documento', false, true],
  ['TASACION', 'Tasación', 'egreso', 'documento', true, true], ['CERTIFICADOS', 'Certificados', 'egreso', 'documento', false, true], ['FIRMA_ELECTRONICA', 'Firma electrónica', 'egreso', 'documento', true, true],
  ['INFORME_COMERCIAL', 'Informe comercial', 'egreso', 'documento', true, true],
  ['MANTENCION', 'Mantención / reparación (por cuenta del propietario)', 'egreso', 'mantencion', false, true], ['CONTRIBUCIONES', 'Contribuciones', 'egreso', 'contribucion', false, true],
  ['SEGURO', 'Seguro', 'egreso', 'seguro', false, true], ['GASTO_PROPIETARIO', 'Gasto por cuenta del propietario', 'egreso', 'gasto_propietario', false, true],
  ['PAGO_PROPIETARIO', 'Pago de liquidación al propietario', 'egreso', 'pago_propietario', false, false], ['DEVOLUCION_GARANTIA', 'Devolución de garantía', 'egreso', 'garantia', false, false],
  ['TRASPASO_FONDOS', 'Traspaso entre fondos', 'traspaso', 'traspaso', false, false], ['GASTO_GENERAL', 'Gasto general de la corredora', 'egreso', 'gasto_general', true, true],
];
const REGLAS = [
  { nombre: 'Venta 2% + IVA (ejemplo)', tipo_operacion: 'venta', base: 'precio', pct: 2, hito_devengo: 'escritura', pagador: 'propietario', reparto: { captador: 30, vendedor: 40, corredora: 30 } },
  { nombre: 'Arriendo 1 mes de renta + IVA (ejemplo)', tipo_operacion: 'arriendo', base: 'renta_meses', meses: 1, hito_devengo: 'contrato_firmado', pagador: 'cliente', reparto: { captador: 40, vendedor: 40, corredora: 20 } },
];
const T = (t) => `<h1>${t}</h1>`;
const PLANTILLAS = [
  ['mandato_venta', 'Mandato de venta', `${T('MANDATO DE CORRETAJE PARA LA VENTA')}<p>En {{fecha_hoy}}, entre {{propietarios}}, en adelante el Mandante, y {{empresa}}, RUT {{empresa_rut}}, en adelante la Corredora, se acuerda lo siguiente:</p><p><b>Primero.</b> El Mandante encarga a la Corredora la venta de la propiedad {{propiedad_tipo}} ubicada en {{propiedad_direccion}}, comuna de {{propiedad_comuna}}, rol {{propiedad_rol}} (código {{propiedad_codigo}}).</p><p><b>Segundo.</b> El mandato se otorga {{mandato_exclusivo}}, con vigencia desde el {{mandato_inicio}} hasta el {{mandato_fin}}.</p><p><b>Tercero.</b> La comisión pactada es {{comision}}, más IVA.</p><p><i>Borrador de apoyo: debe ser revisado por un abogado antes de su uso.</i></p>`],
  ['mandato_arriendo', 'Mandato de arriendo', `${T('MANDATO DE CORRETAJE PARA EL ARRIENDO')}<p>En {{fecha_hoy}}, {{propietarios}} (el Mandante) encarga a {{empresa}} (RUT {{empresa_rut}}) gestionar el arriendo de {{propiedad_direccion}}, {{propiedad_comuna}} (código {{propiedad_codigo}}), {{mandato_exclusivo}}, vigente del {{mandato_inicio}} al {{mandato_fin}}.</p><p>Comisión: {{comision}}, más IVA.</p><p><i>Borrador de apoyo: requiere revisión legal.</i></p>`],
  ['mandato_administracion', 'Mandato de administración', `${T('MANDATO DE ADMINISTRACIÓN DE PROPIEDAD')}<p>En {{fecha_hoy}}, {{propietarios}} (el Mandante) encarga a {{empresa}} (RUT {{empresa_rut}}) la administración de {{propiedad_direccion}}, {{propiedad_comuna}} (código {{propiedad_codigo}}), vigente del {{mandato_inicio}} al {{mandato_fin}}.</p><p>Honorario de administración: {{honorario}}, más IVA. La corredora liquidará mensualmente los valores cobrados, descontando honorarios y gastos aprobados.</p><p><i>Borrador de apoyo: requiere revisión legal.</i></p>`],
  ['contrato_arriendo', 'Contrato de arriendo', `${T('CONTRATO DE ARRENDAMIENTO')}<p>En {{fecha_hoy}}, entre {{propietarios}} (el Arrendador), representado por {{empresa}}, y {{arrendatario}}, RUT {{arrendatario_rut}} (el Arrendatario), se conviene:</p><p><b>1.</b> Se da en arriendo la propiedad {{propiedad_tipo}} ubicada en {{propiedad_direccion}}, {{propiedad_comuna}}.</p><p><b>2.</b> Plazo: desde el {{fecha_inicio}} hasta el {{fecha_termino}}.</p><p><b>3.</b> Renta mensual: {{canon}}, pagadera dentro de los primeros {{dia_pago}} días de cada mes. Reajuste: {{reajuste}}.</p><p><b>4.</b> Garantía: {{garantia}}.</p><p><b>5.</b> Mora: interés de {{interes_mora}}.</p><p><i>Borrador de apoyo: debe ser revisado por un abogado antes de su uso.</i></p>`],
  ['liquidacion_propietario', 'Liquidación al propietario', `${T('LIQUIDACIÓN DE ADMINISTRACIÓN')}<p>Propietario: <b>{{propietario}}</b><br>Propiedad: {{propiedad_codigo}} - {{propiedad_direccion}}<br>Período: {{periodo}}</p>{{detalle}}<p><b>Neto a pagar: {{neto_a_pagar}}</b></p>`],
];
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#dfe7ee"/><g fill="#8aa0b4"><rect x="250" y="170" width="300" height="200"/><polygon points="230,170 400,80 570,170"/></g><text x="400" y="420" font-family="sans-serif" font-size="28" text-anchor="middle" fill="#5b7184">Foto de ejemplo</text></svg>`;

async function seedEmpresa(c, { slug = 'demo', razon = 'Corredora Demo SpA', rut = '76.000.000-0', demo = true, password = process.env.DEMO_PASSWORD || 'Demo-Corretaje-2026' } = {}) {
  const e = (await c.query(`insert into empresa (slug, rut, razon_social, parametros) values ($1,$2,$3,$4) returning id`,
    [slug, rut, razon, { umbral_aprobacion_gasto: 500000, umbral_mantencion: 200000, exigir_mandato: true, pagar_comision_solo_si_cobrada: true, prorratear_canon: true,
      retencion_honorarios_pct: 0, min_fotos: 1, completitud_minima: 50, dias_alerta_mandato: 30, variacion_precio_max_pct: 20 }])).rows[0].id;
  await c.query("select set_config('app.empresa_id', $1, true)", [e]);
  const suc = (await c.query('insert into sucursal (empresa_id, nombre) values ($1,$2) returning id', [e, 'Casa matriz'])).rows[0].id;
  const rolId = {};
  for (const [n, r] of Object.entries(ROLES)) rolId[n] = (await c.query('insert into rol (empresa_id, nombre, permisos, alcance) values ($1,$2,$3,$4) returning id', [e, n, r.permisos, r.alcance])).rows[0].id;
  const hash = await bcrypt.hash(password, 10);
  const usr = {};
  for (const [k, nombre, email, rol, agente] of [['ger', 'Gerencia', `admin@${slug}.cl`, 'Gerente', false], ['ana', 'Ana Rojas', `ana@${slug}.cl`, 'Agente', true], ['luis', 'Luis Pérez', `luis@${slug}.cl`, 'Agente', true],
    ['adm', 'Carla Soto (Administración)', `adm@${slug}.cl`, 'Administrador de propiedades', false], ['fin', 'Pedro Díaz (Finanzas)', `finanzas@${slug}.cl`, 'Finanzas', false], ['lec', 'Lectura', `lectura@${slug}.cl`, 'Solo lectura', false]])
    usr[k] = (await c.query('insert into usuario (empresa_id, sucursal_id, rol_id, email, nombre, password_hash, es_agente) values ($1,$2,$3,$4,$5,$6,$7) returning id', [e, suc, rolId[rol], email, nombre, hash, agente])).rows[0].id;
  for (const x of CATALOGOS) await c.query('insert into catalogo (empresa_id, grupo, codigo, nombre, orden, datos) values ($1,$2,$3,$4,$5,$6)', [e, x.grupo, x.codigo, x.nombre, x.orden, x.datos]);
  for (const [cod, nom, nat, cat, iva, resp] of CONCEPTOS) await c.query('insert into concepto (empresa_id, codigo, nombre, naturaleza, categoria, afecto_iva, requiere_respaldo, es_sistema) values ($1,$2,$3,$4,$5,$6,$7,true)', [e, cod, nom, nat, cat, iva, resp]);
  for (const r of REGLAS) await c.query('insert into regla_comision (empresa_id, nombre, tipo_operacion, base, pct, meses, pagador, hito_devengo, reparto) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [e, r.nombre, r.tipo_operacion, r.base, r.pct ?? null, r.meses ?? null, r.pagador, r.hito_devengo, r.reparto]);
  for (const [tipo, nombre, contenido] of PLANTILLAS) await c.query('insert into plantilla_documento (empresa_id, tipo, nombre, contenido) values ($1,$2,$3,$4)', [e, tipo, nombre, contenido]);
  if (demo) await seedDemo(c, e, usr);
  return { empresa_id: e, usuarios: usr, password, slug };
}

async function seedDemo(c, e, usr) {
  const cat = async (g, cod) => (await c.query('select id from catalogo where grupo=$1 and codigo=$2', [g, cod])).rows[0].id;
  const up = path.join(__dirname, '../uploads/demo');
  fs.mkdirSync(up, { recursive: true });
  fs.writeFileSync(path.join(up, 'ejemplo.svg'), SVG);
  const foto = [{ url: '/uploads/demo/ejemplo.svg', titulo: 'Foto de ejemplo' }];
  const per = async (nombre, rut, email, tel, roles) => (await c.query('insert into persona (empresa_id, nombre, rut, email, telefono, roles, consentimiento_datos_at) values ($1,$2,$3,$4,$5,$6,now()) returning id', [e, nombre, rut, email, tel, roles])).rows[0].id;
  const o1 = await per('María González Lagos', '12.345.678-5', 'maria.gonzalez@example.com', '+56 9 1111 1111', ['propietario']);
  const o2 = await per('Jorge Fuentes Mora', '9.876.543-3', 'jorge.fuentes@example.com', '+56 9 2222 2222', ['propietario']);
  const arr = await per('Camila Vargas Rey', '15.111.222-6', 'camila.vargas@example.com', '+56 9 3333 3333', ['arrendatario']);
  const prop = async (cod, tipo, comuna, dir, rol, su, d, b, pv, mv, pa, ag, gc, desc) => (await c.query(
    `insert into propiedad (empresa_id, sucursal_id, codigo, tipo_id, comuna_id, direccion, rol_sii, sup_util, dormitorios, banos, precio_venta, moneda_venta, precio_arriendo, moneda_arriendo, agente_captador_id, estado, fotos, gasto_comun, descripcion)
     values ($1,(select id from sucursal where empresa_id=$1 limit 1),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'CLP',$13,'captada',$14,$15,$16) returning id`,
    [e, cod, await cat('tipo_propiedad', tipo), await cat('comuna', comuna), dir, rol, su, d, b, pv, mv, pa, ag, JSON.stringify(foto), gc, desc])).rows[0].id;
  await nextSeqSet(c, e, 'propiedad', 4);
  const p1 = await prop('P-00001', 'DEPARTAMENTO', 'PROVIDENCIA', 'Av. Ejemplo 1234, depto 501', '1234-56', 85, 3, 2, 5000, 'UF', null, usr.ana, null, 'Departamento luminoso de 3 dormitorios y 2 baños, cercano a metro y servicios. Datos de ejemplo.');
  const p2 = await prop('P-00002', 'DEPARTAMENTO', 'NUNOA', 'Calle Demo 456, depto 302', '2345-67', 52, 2, 1, null, 'UF', 600000, usr.luis, 60000, 'Departamento de 2 dormitorios en Ñuñoa, ideal para arriendo. Datos de ejemplo.');
  const p3 = await prop('P-00003', 'CASA', 'LA_FLORIDA', 'Pasaje Muestra 789', '3456-78', 120, 4, 2, 7500, 'UF', 950000, usr.ana, null, 'Casa familiar de 4 dormitorios con patio y estacionamiento. Datos de ejemplo.');
  for (const [p, o] of [[p1, o1], [p2, o2], [p3, o1]]) await c.query('insert into propiedad_propietario (empresa_id, propiedad_id, persona_id, porcentaje, principal) values ($1,$2,$3,100,true)', [e, p, o]);
  const man = (p, tipo, ex, pct, ag, honor) => c.query(`insert into mandato (empresa_id, propiedad_id, tipo, exclusivo, fecha_inicio, fecha_fin, comision_tipo, comision_valor, honorario_admin_pct, agente_id)
    values ($1,$2,$3,$4,current_date-30,current_date+335,$5,$6,$7,$8)`, [e, p, tipo, ex, tipo === 'venta' ? 'porcentaje' : tipo === 'arriendo' ? 'meses_renta' : null, tipo === 'venta' ? 2 : tipo === 'arriendo' ? 1 : null, honor, ag]);
  await man(p1, 'venta', true, 2, usr.ana, null); await man(p2, 'arriendo', false, 1, usr.luis, null); await man(p2, 'administracion', false, null, usr.luis, 7); await man(p3, 'arriendo', false, 1, usr.ana, null);
  // Indices de demostracion (reemplazar por valores oficiales: Mantenedores > Indices o sincronizar)
  await c.query(`insert into indice_valor (codigo, fecha, valor, origen) select 'UF', d::date, 39000, 'demo' from generate_series(current_date - interval '400 days', current_date + interval '120 days', interval '1 day') d on conflict do nothing`);
  await c.query(`insert into indice_valor (codigo, fecha, valor, origen) select 'IPC', date_trunc('month', d)::date, 0.3, 'demo' from generate_series(current_date - interval '30 months', current_date, interval '1 month') d on conflict do nothing`);
  // Publicacion del depto de venta en el sitio propio
  await c.query("update propiedad set estado='publicada' where id=$1", [p1]);
  const sitio = await cat('canal', 'SITIO_WEB');
  await c.query(`insert into publicacion (empresa_id, propiedad_id, operacion, canal_id, estado, titulo, descripcion, precio, moneda, publicada_at)
    select $1, id, 'venta', $3, 'publicada', 'Departamento en venta - Providencia - 3D/2B', descripcion, precio_venta, moneda_venta, now() from propiedad where id=$2`, [e, p1, sitio]);
  const web = await cat('fuente_lead', 'WEB'), portal = await cat('fuente_lead', 'PORTAL_INMOBILIARIO');
  const l1 = await per('Felipe Araya', null, 'felipe.araya@example.com', '+56 9 4444 4444', ['comprador']);
  await c.query(`insert into lead (empresa_id, persona_id, propiedad_id, fuente_id, interes, mensaje, agente_id, asignado_at) values ($1,$2,$3,$4,'comprar','Me interesa visitar el departamento.',$5,now())`, [e, l1, p1, web, usr.ana]);
  await c.query(`insert into lead (empresa_id, persona_id, propiedad_id, fuente_id, interes, mensaje, agente_id, asignado_at) values ($1,$2,$3,$4,'arrendar','Consulta por disponibilidad.',$5,now())`, [e, arr, p2, portal, usr.luis]);
  const { completitud } = require('../server/routes/negocio');
  for (const pid of [p1, p2, p3]) await completitud(c, pid);
}
async function nextSeqSet(c, e, clave, n) { await c.query('insert into secuencia (empresa_id, clave, siguiente) values ($1,$2,$3) on conflict (empresa_id, clave) do update set siguiente=$3', [e, clave, n]); }

module.exports = { seedEmpresa };

if (require.main === module) {
  const { pool, tx } = require('../server/lib/db');
  (async () => {
    const ex = await pool.query("select id from empresa where slug='demo'");
    if (ex.rows[0]) { console.log('La empresa demo ya existe: seed omitido.'); return pool.end(); }
    const r = await tx(null, c => seedEmpresa(c, { demo: process.env.SEED_DEMO !== '0' }));
    console.log(`Empresa demo creada. Ingrese en http://localhost:3000 con:
  admin@demo.cl / ${r.password}   (Gerente)
  ana@demo.cl, luis@demo.cl       (Agentes)    adm@demo.cl (Administración)    finanzas@demo.cl (Finanzas)    lectura@demo.cl (Solo lectura)
Cambie estas contraseñas antes de usar datos reales. UF/IPC cargados son valores de DEMOSTRACIÓN.`);
    await pool.end();
  })().catch(e => { console.error(e); process.exit(1); });
}
