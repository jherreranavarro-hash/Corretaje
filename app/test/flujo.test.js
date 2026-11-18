// Pruebas de extremo a extremo contra una base de datos temporal (corretaje_test).
// Verifican los ejemplos numericos del diseno: venta (utilidad 945.000), reajuste IPC (625.200), mora (3.600) y liquidacion al propietario (487.020).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { Client } = require('pg');

const BASE = process.env.TEST_ADMIN_URL || 'postgres://corretaje:corretaje_dev@127.0.0.1:5432/postgres';
const TESTDB = 'corretaje_test';
process.env.DATABASE_URL = BASE.replace(/\/[^/]*$/, '/' + TESTDB);
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123456';

let app, S = {}, tok = {};
const hoy = new Date().toISOString().slice(0, 10);
const mes = hoy.slice(0, 7);
const call = async (method, url, token, body) => {
  const r = await app.inject({ method, url, headers: token ? { authorization: 'Bearer ' + token } : {}, payload: body });
  let json; try { json = r.json(); } catch { json = r.body; }
  return { status: r.statusCode, body: json };
};
const ok = async (method, url, token, body) => {
  const r = await call(method, url, token, body);
  assert.ok(r.status >= 200 && r.status < 300, `${method} ${url} -> ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

before(async () => {
  const adm = new Client({ connectionString: BASE }); await adm.connect();
  await adm.query(`drop database if exists ${TESTDB} with (force)`); await adm.query(`create database ${TESTDB}`); await adm.end();
  const c = new Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
  await c.query(fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8')); await c.end();
  const { tx } = require('../server/lib/db');
  const { seedEmpresa } = require('../db/seed');
  S.A = await tx(null, c => seedEmpresa(c, { slug: 'alfa', razon: 'Alfa SpA', rut: '76.111.111-1', demo: false, password: 'Clave-Segura-123' }));
  S.B = await tx(null, c => seedEmpresa(c, { slug: 'beta', razon: 'Beta SpA', rut: '76.222.222-2', demo: false, password: 'Clave-Segura-123' }));
  const { build } = require('../server/index');
  app = build(); await app.ready();
  for (const [k, e] of [['ger', 'admin@alfa.cl'], ['ana', 'ana@alfa.cl'], ['luis', 'luis@alfa.cl'], ['adm', 'adm@alfa.cl'], ['fin', 'finanzas@alfa.cl'], ['lec', 'lectura@alfa.cl'], ['gerB', 'admin@beta.cl']])
    tok[k] = (await ok('POST', '/api/auth/login', null, { email: e, password: 'Clave-Segura-123' })).token;
  // indices de prueba: UF = 39.000
  for (const d of [hoy]) await ok('PUT', `/api/indices/UF/${d}`, tok.ger, { valor: 39000 });
  await ok('PUT', '/api/parametros', tok.ger, { parametros: { min_fotos: 1, completitud_minima: 0 } });
});
after(async () => { await app.close(); await require('../server/lib/db').pool.end(); });

const cat = async (g, cod) => (await ok('GET', `/api/catalogos/${g}`, tok.ger)).find(x => x.codigo === cod).id;
const concepto = async cod => (await ok('GET', '/api/conceptos', tok.ger)).find(x => x.codigo === cod).id;
async function crearPropiedad(token, { codigoTipo = 'DEPARTAMENTO', dir, venta, arriendo, agente, gc }) {
  const p = await ok('POST', '/api/propiedades', token, { direccion: dir, tipo_id: await cat('tipo_propiedad', codigoTipo), comuna_id: await cat('comuna', 'PROVIDENCIA'), rol_sii: '100-1', sup_util: 70,
    dormitorios: 3, banos: 2, precio_venta: venta, moneda_venta: 'UF', precio_arriendo: arriendo, moneda_arriendo: 'CLP', agente_captador_id: agente, gasto_comun: gc, descripcion: 'Propiedad de prueba con descripcion suficientemente larga para el test.' });
  await ok('POST', `/api/propiedades/${p.id}/fotos`, token, { data_url: PNG });
  return p;
}

test('autenticacion, permisos y bloqueo', async () => {
  assert.equal((await call('POST', '/api/auth/login', null, { email: 'ana@alfa.cl', password: 'mala' })).status, 401);
  assert.equal((await call('GET', '/api/propiedades')).status, 401);
  assert.equal((await call('POST', '/api/usuarios', tok.ana, { email: 'x@y.cl', nombre: 'x', rol_id: S.A.usuarios.ger, password: '1234567890' })).status, 403);
  assert.equal((await call('POST', '/api/propiedades', tok.lec, { direccion: 'x' })).status, 403);
  assert.equal((await call('POST', '/api/reglas-comision', tok.ana, {})).status, 403);
  for (let i = 0; i < 5; i++) await call('POST', '/api/auth/login', null, { email: 'lectura@alfa.cl', password: 'mala' });
  const bloq = await call('POST', '/api/auth/login', null, { email: 'lectura@alfa.cl', password: 'Clave-Segura-123' });
  assert.equal(bloq.status, 423, 'cuenta bloqueada tras 5 intentos');
});

test('aislamiento entre empresas (RLS)', async () => {
  const p = await crearPropiedad(tok.ger, { dir: 'Aislada 1', venta: 1000, agente: S.A.usuarios.ana });
  const listaB = await ok('GET', '/api/propiedades', tok.gerB);
  assert.equal(listaB.length, 0);
  assert.equal((await call('GET', `/api/propiedades/${p.id}`, tok.gerB)).status, 404);
  assert.equal((await ok('GET', '/api/personas', tok.gerB)).length, 0);
});

test('VENTA: comision 2%+IVA, reparto, costos y utilidad = 945.000', async () => {
  const owner = await ok('POST', '/api/personas', tok.ger, { nombre: 'Dueña Venta', rut: '12.345.678-5', roles: ['propietario'] });
  const comp = await ok('POST', '/api/personas', tok.ger, { nombre: 'Comprador Uno', rut: '9.876.543-3', roles: ['comprador'] });
  assert.equal((await call('POST', '/api/personas', tok.ger, { nombre: 'RUT malo', rut: '12.345.678-9' })).status, 422);
  const p = await crearPropiedad(tok.ana, { dir: 'Venta 100', venta: 5000, agente: S.A.usuarios.ana });
  await ok('PUT', `/api/propiedades/${p.id}/propietarios`, tok.ana, { propietarios: [{ persona_id: owner.id, porcentaje: 100 }] });
  assert.equal((await call('POST', '/api/operaciones', tok.ana, { tipo: 'venta', propiedad_id: p.id })).status, 422, 'sin mandato no hay operacion');
  const hoyMas = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  await ok('POST', `/api/propiedades/${p.id}/mandatos`, tok.ana, { tipo: 'venta', exclusivo: true, fecha_inicio: hoyMas(-1), fecha_fin: hoyMas(180), comision_tipo: 'porcentaje', comision_valor: 2 });
  assert.equal((await call('POST', `/api/propiedades/${p.id}/mandatos`, tok.ana, { tipo: 'venta', exclusivo: true, fecha_inicio: hoyMas(10), fecha_fin: hoyMas(90) })).status, 409, 'mandatos exclusivos no se solapan');
  await ok('POST', `/api/propiedades/${p.id}/estado`, tok.ana, { estado: 'captada' });
  await ok('POST', `/api/propiedades/${p.id}/estado`, tok.ana, { estado: 'publicada' });
  const sitio = await cat('canal', 'SITIO_WEB'), portal = await cat('canal', 'PORTAL_INMOBILIARIO');
  const pubs = await ok('POST', `/api/propiedades/${p.id}/publicaciones`, tok.ana, { operacion: 'venta', canales: [{ canal_id: sitio }, { canal_id: portal, costo: 120000 }] });
  assert.equal(pubs.find(x => x.canal === 'Sitio web propio').estado, 'publicada');
  assert.equal(pubs.find(x => x.canal === 'Portal Inmobiliario').estado, 'pendiente', 'portal sin API: publicacion asistida');
  S.venta = { p, owner, comp };

  const op = await ok('POST', '/api/operaciones', tok.ana, { tipo: 'venta', propiedad_id: p.id });
  assert.match(op.codigo, /^V-\d{4}-\d{5}$/);
  await ok('PATCH', `/api/operaciones/${op.id}`, tok.ana, { cliente_id: comp.id, agente_vendedor_id: S.A.usuarios.luis });
  assert.equal((await call('POST', `/api/operaciones/${op.id}/avanzar`, tok.ana, { estado_hacia: 'cerrada' })).status, 422, 'transicion invalida');
  const sim = await ok('POST', `/api/operaciones/${op.id}/comision/simular`, tok.ana, {});
  assert.equal(sim.monto_neto, 3900000); assert.equal(sim.iva, 741000);
  await ok('POST', `/api/operaciones/${op.id}/avanzar`, tok.ana, { estado_hacia: 'reserva' });
  const pr = await ok('GET', `/api/propiedades/${p.id}`, tok.ana);
  assert.equal(pr.estado, 'reservada');
  assert.ok(pr.publicaciones.filter(x => x.estado === 'pausada').length >= 1, 'reserva pausa publicaciones activas');

  const e1 = await ok('POST', `/api/operaciones/${op.id}/avanzar`, tok.ana, { estado_hacia: 'promesa' });
  assert.equal(e1.comision_devengada, null, 'promesa no devenga (hito=escritura)');
  const esc = await ok('POST', `/api/operaciones/${op.id}/avanzar`, tok.ana, { estado_hacia: 'escritura' });
  assert.ok(esc.comision_devengada, 'escritura devenga la comision');
  const base = { operacion_id: op.id, propiedad_id: p.id, pagador: 'corredora' };
  for (const [cod, monto] of [['FOTOGRAFIA', 80000], ['FIRMA_ELECTRONICA', 25000]]) await ok('POST', '/api/movimientos', tok.ana, { ...base, concepto_codigo: cod, monto_neto: monto });
  await ok('POST', '/api/movimientos', tok.ana, { ...base, concepto_codigo: 'PUB_PORTAL', monto_neto: 120000, glosa: 'Plan portal' });
  await ok('POST', '/api/movimientos', tok.ana, { operacion_id: op.id, propiedad_id: p.id, pagador: 'propietario', concepto_codigo: 'ESTUDIO_TITULOS', monto_neto: 180000 });

  const r = await ok('GET', `/api/operaciones/${op.id}`, tok.ger);
  assert.equal(r.ingresos, 3900000);
  assert.equal(r.costos, 225000, 'costos de la corredora (el estudio de titulos lo paga el propietario)');
  assert.equal(r.comisiones_agentes, 1170000 + 1560000);
  assert.equal(r.utilidad, 945000);
  assert.equal(r.margen_pct, 24.2);
  const reparto = Object.fromEntries(r.comisiones[0].reparto.map(x => [x.rol, x.monto]));
  assert.deepEqual(reparto, { captador: 1170000, corredora: 1170000, vendedor: 1560000 });
  S.venta.op = op; S.venta.com = r.comisiones[0];
});

test('comision: no se aprueba hasta cobrada; liquidacion y pago a agentes sin doble conteo', async () => {
  const { op, com } = S.venta;
  assert.equal((await call('POST', `/api/comisiones/${com.id}/aprobar`, tok.fin)).status, 422, 'aun no cobrada al cliente');
  await ok('POST', `/api/movimientos/${com.movimiento_id}/estado`, tok.fin, { estado: 'pagado' });
  await ok('POST', `/api/comisiones/${com.id}/aprobar`, tok.fin);
  assert.equal((await call('POST', '/api/liquidaciones-agente/generar', tok.ana, { periodo: mes })).status, 403);
  const liqs = await ok('POST', '/api/liquidaciones-agente/generar', tok.fin, { periodo: mes });
  const porAg = Object.fromEntries(liqs.map(l => [l.agente_id, l.neto]));
  assert.equal(porAg[S.A.usuarios.ana], 1170000); assert.equal(porAg[S.A.usuarios.luis], 1560000);
  for (const l of liqs) { await ok('POST', `/api/liquidaciones-agente/${l.id}/aprobar`, tok.fin); await ok('POST', `/api/liquidaciones-agente/${l.id}/pagar`, tok.fin); }
  assert.equal((await call('POST', `/api/liquidaciones-agente/${liqs[0].id}/pagar`, tok.fin)).status, 422, 'no se paga dos veces');
  const r = await ok('GET', `/api/operaciones/${op.id}`, tok.ger);
  assert.equal(r.utilidad, 945000, 'pagar a agentes no altera la utilidad');
  assert.equal(r.comisiones[0].estado, 'pagada');
  for (const e of ['inscripcion', 'entregada', 'cerrada']) await ok('POST', `/api/operaciones/${op.id}/avanzar`, tok.ana, { estado_hacia: e });
  const pr = await ok('GET', `/api/propiedades/${S.venta.p.id}`, tok.ana);
  assert.equal(pr.estado, 'vendida');
  assert.ok(pr.publicaciones.every(x => x.estado === 'retirada'), 'al cerrar se retiran todas las publicaciones');
});

test('LIBRO: inmutable, anulacion con reversa, aprobacion y periodo cerrado', async () => {
  const p = S.venta.p;
  const m = await ok('POST', '/api/movimientos', tok.fin, { propiedad_id: p.id, concepto_codigo: 'GASTO_GENERAL', monto_neto: 100000, pagador: 'corredora' });
  assert.equal(m.iva, 19000, 'IVA 19% automatico');
  assert.equal((await call('POST', '/api/movimientos', tok.fin, { propiedad_id: p.id, concepto_codigo: 'GASTO_GENERAL', monto_neto: 100000, iva: 5 })).status, 422, 'IVA distinto exige glosa');
  assert.equal((await call('POST', '/api/movimientos', tok.fin, { concepto_codigo: 'GASTO_GENERAL', monto_neto: 1000 })).status, 422, 'debe vincularse');
  assert.equal((await call('POST', `/api/movimientos/${m.id}/estado`, tok.fin, { estado: 'pagado' })).status, 422, 'exige respaldo');
  await ok('POST', `/api/movimientos/${m.id}/estado`, tok.fin, { estado: 'pagado', nro_documento: 'F-123' });
  // trigger de inmutabilidad en BD
  const { tx } = require('../server/lib/db');
  await assert.rejects(tx(S.A.empresa_id, c => c.query('update movimiento set monto_neto=1 where id=$1', [m.id])), /inmutable/i);
  await assert.rejects(tx(S.A.empresa_id, c => c.query('delete from movimiento where id=$1', [m.id])), /no permite borrar/i);
  const an = await ok('POST', `/api/movimientos/${m.id}/anular`, tok.fin, { motivo: 'Error de digitacion' });
  assert.ok(an.reversa);
  assert.equal((await call('POST', `/api/movimientos/${m.id}/anular`, tok.fin, {})).status, 422, 'motivo obligatorio / ya anulado');
  // aprobacion por umbral
  const g = await ok('POST', '/api/movimientos', tok.fin, { propiedad_id: p.id, concepto_codigo: 'GASTO_GENERAL', monto_neto: 600000, pagador: 'corredora', nro_documento: 'F-9' });
  assert.equal(g.requiere_aprobacion, true);
  assert.equal((await call('POST', `/api/movimientos/${g.id}/estado`, tok.fin, { estado: 'pagado' })).status, 422, 'requiere aprobacion');
  assert.equal((await call('POST', `/api/movimientos/${g.id}/aprobar`, tok.fin)).status, 422, 'quien registra no aprueba');
  await ok('POST', `/api/movimientos/${g.id}/aprobar`, tok.ger);
  await ok('POST', `/api/movimientos/${g.id}/estado`, tok.fin, { estado: 'pagado' });
  // cierre de periodo
  await ok('POST', `/api/periodos/${mes}/cerrar`, tok.fin);
  assert.equal((await call('POST', '/api/movimientos', tok.fin, { propiedad_id: p.id, concepto_codigo: 'GASTO_GENERAL', monto_neto: 1000, pagador: 'corredora' })).status, 422, 'periodo cerrado');
  await ok('POST', `/api/periodos/${mes}/reabrir`, tok.ger, { motivo: 'Continuar pruebas' });
  await ok('POST', '/api/movimientos', tok.fin, { propiedad_id: p.id, concepto_codigo: 'GASTO_GENERAL', monto_neto: 1000, pagador: 'corredora' });
});

test('ARRIENDO + ADMINISTRACION: comision, cargos, pago, OT, liquidacion al propietario = 487.020, reajuste IPC = 625.200 y mora = 3.600', async () => {
  const owner = await ok('POST', '/api/personas', tok.adm, { nombre: 'Propietario Arriendo', rut: '7.654.321-6', roles: ['propietario'] });
  const arr = await ok('POST', '/api/personas', tok.adm, { nombre: 'Arrendatario Uno', rut: '15.111.222-6', roles: ['arrendatario'] });
  const p = await crearPropiedad(tok.ger, { dir: 'Arriendo 200', arriendo: 600000, agente: S.A.usuarios.ana, gc: 60000 });
  await ok('PUT', `/api/propiedades/${p.id}/propietarios`, tok.ger, { propietarios: [{ persona_id: owner.id, porcentaje: 100 }] });
  const f = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  await ok('POST', `/api/propiedades/${p.id}/mandatos`, tok.ger, { tipo: 'arriendo', fecha_inicio: f(-1), fecha_fin: f(365) });
  await ok('POST', `/api/propiedades/${p.id}/mandatos`, tok.ger, { tipo: 'administracion', fecha_inicio: f(-1), fecha_fin: f(365), honorario_admin_pct: 7 });
  await ok('POST', `/api/propiedades/${p.id}/estado`, tok.ger, { estado: 'captada' });
  await ok('POST', `/api/propiedades/${p.id}/estado`, tok.ger, { estado: 'publicada' });
  const op = await ok('POST', '/api/operaciones', tok.ger, { tipo: 'arriendo', propiedad_id: p.id, agente_vendedor_id: S.A.usuarios.luis });
  await ok('PATCH', `/api/operaciones/${op.id}`, tok.ger, { cliente_id: arr.id });
  await ok('POST', `/api/operaciones/${op.id}/avanzar`, tok.ger, { estado_hacia: 'aprobada' });
  const inicio = mes + '-01';
  const termino = `${Number(mes.slice(0, 4)) + 1}-${mes.slice(5, 7)}-01`;
  const k = await ok('POST', `/api/operaciones/${op.id}/contrato`, tok.adm, { fecha_inicio: inicio, fecha_termino: termino, dia_pago: 5, garantia_monto: 600000, interes_mora_pct: 1.5, reajuste_tipo: 'ipc', cobra_gasto_comun: true });
  const firmado = await ok('POST', `/api/operaciones/${op.id}/avanzar`, tok.ger, { estado_hacia: 'contrato_firmado' });
  assert.equal(firmado.comision_devengada.hito, 'contrato_firmado');
  const res = await ok('GET', `/api/operaciones/${op.id}`, tok.ger);
  assert.equal(res.comisiones[0].monto_neto, 600000); assert.equal(res.comisiones[0].iva, 114000);
  assert.deepEqual(Object.fromEntries(res.comisiones[0].reparto.map(x => [x.rol, x.monto])), { captador: 240000, vendedor: 240000, corredora: 120000 });
  await ok('POST', `/api/operaciones/${op.id}/avanzar`, tok.ger, { estado_hacia: 'vigente' });

  // garantia: fondos de terceros
  await ok('POST', `/api/contratos/${k.id}/garantia`, tok.adm, {});
  const movG = (await ok('GET', `/api/movimientos?propiedad_id=${p.id}`, tok.fin)).find(m => m.concepto_codigo === undefined && m.concepto.startsWith('Garant'));
  assert.equal(movG.fondo, 'terceros');
  // cargos del mes (idempotente)
  const g1 = await ok('POST', '/api/cargos/generar', tok.adm, { periodo: mes });
  assert.equal(g1.cargos_creados, 0, 'ya se generaron al firmar: idempotente');
  let ec = await ok('GET', `/api/contratos/${k.id}`, tok.adm);
  assert.deepEqual(ec.cargos.map(c => c.monto_clp).sort(), [60000, 600000]);
  // pago de 660.000 cubre canon + gasto comun
  const pago = await ok('POST', '/api/pagos', tok.adm, { contrato_id: k.id, monto: 660000, referencia: 'TRX-1' });
  assert.equal(pago.sin_asignar, 0);
  ec = await ok('GET', `/api/contratos/${k.id}`, tok.adm);
  assert.equal(ec.saldo_pendiente, 0);
  // mantencion 85.000 (bajo umbral) y contribucion 38.000 por cuenta del propietario
  const ot = await ok('POST', '/api/ordenes-trabajo', tok.adm, { propiedad_id: p.id, descripcion: 'Reparacion calefon', costo_estimado: 85000, cargo_a: 'propietario' });
  assert.equal(ot.estado, 'solicitada');
  await ok('POST', `/api/ordenes-trabajo/${ot.id}/iniciar`, tok.adm, {});
  await ok('POST', `/api/ordenes-trabajo/${ot.id}/terminar`, tok.adm, { costo_real: 85000, nro_documento: 'FAC-77' });
  await ok('POST', '/api/movimientos', tok.adm, { propiedad_id: p.id, contrato_id: k.id, concepto_codigo: 'CONTRIBUCIONES', monto_neto: 38000, pagador: 'propietario', fondo: 'terceros', estado: 'pagado', nro_documento: 'TGR-1' });
  // OT sobre el umbral requiere aprobacion
  const otG = await ok('POST', '/api/ordenes-trabajo', tok.adm, { propiedad_id: p.id, descripcion: 'Cambio de techumbre', costo_estimado: 900000 });
  assert.equal(otG.estado, 'pendiente_aprobacion');
  assert.equal((await call('POST', `/api/ordenes-trabajo/${otG.id}/iniciar`, tok.adm, {})).status, 422);
  assert.equal((await call('POST', `/api/ordenes-trabajo/${otG.id}/aprobar`, tok.adm, {})).status, 403, 'adm. de propiedades no aprueba sobre umbral');
  await ok('POST', `/api/ordenes-trabajo/${otG.id}/aprobar`, tok.ger, {});
  // liquidacion al propietario
  const liqs = await ok('POST', '/api/liquidaciones-propietario/generar', tok.adm, { periodo: mes, propiedad_id: p.id });
  assert.equal(liqs.length, 1);
  const L = liqs[0];
  assert.equal(L.ingresos, 660000); assert.equal(L.honorario_neto, 42000); assert.equal(L.honorario_iva, 7980); assert.equal(L.gastos, 123000);
  assert.equal(L.neto_a_pagar, 487020, 'liquidacion del ejemplo');
  assert.equal((await call('POST', `/api/liquidaciones-propietario/${L.id}/aprobar`, tok.adm)).status, 403, 'solo finanzas/gerencia aprueban');
  await ok('POST', `/api/liquidaciones-propietario/${L.id}/aprobar`, tok.fin);
  const det = await ok('GET', `/api/liquidaciones-propietario/${L.id}`, tok.fin);
  assert.equal(det.detalle.reduce((s, d) => s + d.monto, 0), 487020, 'el detalle reproduce el neto');
  await ok('POST', `/api/liquidaciones-propietario/${L.id}/pagar`, tok.fin);
  // pagos ya liquidados no se pueden revertir; no se vuelve a liquidar lo mismo
  assert.equal((await call('POST', `/api/pagos/${pago.pago.id}/revertir`, tok.adm, { motivo: 'x' })).status, 422);
  assert.equal((await ok('POST', '/api/liquidaciones-propietario/generar', tok.adm, { periodo: mes, propiedad_id: p.id })).length, 0);
  // fondos de terceros vs propios: honorario en propios, traspaso en terceros
  const movs = await ok('GET', `/api/movimientos?propiedad_id=${p.id}&limit=100`, tok.fin);
  const hon = movs.find(m => m.concepto.startsWith('Honorario'));
  assert.equal(hon.fondo, 'propio'); assert.equal(hon.neto_clp, 42000);
  assert.equal(movs.find(m => m.concepto === 'Pago de liquidación al propietario').fondo, 'terceros');

  // reajuste IPC: 11 meses en 0% y uno en 4,2% => 1,042 => 625.200
  const prox = (await ok('GET', `/api/contratos/${k.id}`, tok.adm)).contrato.proximo_reajuste;
  assert.equal((await call('GET', `/api/contratos/${k.id}/reajuste`, tok.adm)).status, 422, 'sin IPC cargado no se puede reajustar');
  const [py, pm] = prox.split('-').map(Number);
  for (let i = 1; i <= 12; i++) { const d = new Date(Date.UTC(py, pm - 1 - i, 1)).toISOString().slice(0, 10); await ok('PUT', `/api/indices/IPC/${d}`, tok.fin, { valor: i === 1 ? 4.2 : 0 }); }
  const prop = await ok('GET', `/api/contratos/${k.id}/reajuste`, tok.adm);
  assert.equal(prop.canon_nuevo, 625200); assert.equal(prop.variacion_pct, 4.2);
  await ok('POST', `/api/contratos/${k.id}/reajuste`, tok.adm);
  assert.equal((await ok('GET', `/api/contratos/${k.id}`, tok.adm)).contrato.canon_vigente, 625200);

  // mora: cargo vencido hace 12 dias, 1,5% mensual => 3.600
  const venc = new Date(Date.now() - 12 * 864e5).toISOString().slice(0, 10);
  await ok('POST', '/api/cargos', tok.adm, { contrato_id: k.id, tipo: 'canon', descripcion: 'Canon atrasado', monto: 600000, vencimiento: venc });
  const mora = await ok('POST', '/api/cobranza/calcular-mora', tok.adm, {});
  assert.equal(mora.intereses_calculados, 1);
  assert.equal((await ok('POST', '/api/cobranza/calcular-mora', tok.adm, {})).intereses_calculados, 1, 'idempotente');
  ec = await ok('GET', `/api/contratos/${k.id}`, tok.adm);
  assert.equal(ec.cargos.filter(c => c.tipo === 'interes_mora').length, 1, 'un unico cargo de interes');
  assert.equal(ec.cargos.find(c => c.tipo === 'interes_mora').monto_clp, 3600);
  const morosidad = await ok('GET', '/api/reportes/morosidad', tok.fin);
  assert.ok(morosidad.find(r => r.arrendatario === 'Arrendatario Uno').d1_30 >= 600000);
});

test('PUBLICO: sitio, consultas y proteccion de datos', async () => {
  const lista = await ok('GET', '/public/alfa/propiedades');
  assert.ok(Array.isArray(lista.propiedades));
  assert.ok(lista.propiedades.every(x => !('direccion' in x) && !('notas_internas' in x)), 'no expone datos internos');
  assert.equal((await call('GET', '/public/inexistente/propiedades')).status, 404);
  assert.equal((await call('POST', '/public/alfa/contacto', null, { nombre: 'Sin consentimiento', email: 'a@b.cl' })).status, 422);
  const okc = await ok('POST', '/public/alfa/contacto', null, { nombre: 'Interesado', email: 'int@example.com', consentimiento: true, mensaje: 'Hola' });
  assert.ok(okc.referencia);
  const leads = await ok('GET', '/api/leads', tok.ger);
  const l = leads.find(x => x.email === 'int@example.com');
  assert.ok(l && l.agente, 'lead asignado a un agente');
  assert.equal((await ok('GET', '/api/leads', tok.gerB)).length, 0);
  // transiciones de lead
  assert.equal((await call('POST', `/api/leads/${l.id}/estado`, tok.ger, { estado: 'ganado' })).status, 422);
  assert.equal((await call('POST', `/api/leads/${l.id}/estado`, tok.ger, { estado: 'perdido' })).status, 422, 'exige motivo');
  const nuevo = await ok('POST', `/api/leads/${l.id}/estado`, tok.ger, { estado: 'contactado' });
  assert.ok(nuevo.primer_contacto_at);
});

test('DOCUMENTOS, mantenedores, auditoria y reportes', async () => {
  const props = await ok('GET', '/api/propiedades?q=Arriendo 200', tok.ger);
  const pr = await ok('GET', `/api/propiedades/${props[0].id}`, tok.ger);
  const man = pr.mandatos.find(m => m.tipo === 'arriendo');
  const doc = await ok('POST', '/api/documentos/generar', tok.ger, { plantilla_tipo: 'mandato_arriendo', entidad: 'mandato', entidad_id: man.id });
  assert.ok(doc.advertencia, 'plantilla sin revision legal advierte');
  const html = (await app.inject({ method: 'GET', url: `/api/documentos/${doc.id}/html`, headers: { authorization: 'Bearer ' + tok.ger } })).body;
  assert.match(html, /Propietario Arriendo/);
  await ok('POST', `/api/documentos/${doc.id}/firmar`, tok.ger, { firmantes: [{ nombre: 'Propietario Arriendo', rol: 'mandante' }] });
  assert.equal((await call('POST', `/api/documentos/${doc.id}/firmar`, tok.ger, { firmantes: [{ nombre: 'x' }] })).status, 422, 'firmado es inmutable');
  assert.equal((await call('POST', '/api/documentos/generar', tok.ger, { plantilla_tipo: 'contrato_arriendo', entidad: 'mandato', entidad_id: man.id })).status, 422, 'faltan variables');
  // mantenedor: no se borra lo que esta en uso, si se desactiva
  const sitio = await cat('canal', 'SITIO_WEB');
  assert.equal((await call('DELETE', `/api/catalogos/canal/${sitio}`, tok.ger)).status, 409);
  const nuevoC = await ok('POST', '/api/catalogos/medio_pago', tok.ger, { codigo: 'bizum', nombre: 'Bizum' });
  assert.equal(nuevoC.codigo, 'BIZUM');
  await ok('DELETE', `/api/catalogos/medio_pago/${nuevoC.id}`, tok.ger);
  // el ultimo administrador no puede desactivarse
  assert.equal((await call('PATCH', `/api/usuarios/${S.A.usuarios.ger}`, tok.ger, { activo: false })).status, 422);
  // auditoria y reportes
  const aud = await ok('GET', '/api/auditoria?entidad=comision', tok.ger);
  assert.ok(aud.length >= 2);
  const dash = await ok('GET', '/api/reportes/dashboard', tok.ger);
  assert.ok(dash.arriendos.contratos_vigentes >= 1);
  const res = await ok('GET', '/api/reportes/resultado-operaciones', tok.ger);
  assert.equal(res.find(r => r.tipo === 'venta').utilidad, 945000);
  const csv = (await app.inject({ method: 'GET', url: '/api/reportes/resultado-operaciones?formato=csv', headers: { authorization: 'Bearer ' + tok.ger } })).body;
  assert.match(csv, /codigo,tipo/);
  const ctrl = await ok('GET', '/api/reportes/control-movimientos', tok.fin);
  assert.ok(Array.isArray(ctrl));
  // un agente solo ve sus propios datos
  const misOps = await ok('GET', '/api/operaciones', tok.luis);
  assert.ok(misOps.every(o => [S.A.usuarios.luis].includes(o.agente_vendedor_id) || o.agente_captador_id === S.A.usuarios.luis));
});

test('INTEGRACIONES: credenciales cifradas, nunca expuestas, prueba y activacion', async () => {
  const SECRETO = 'clave-super-secreta-12345';
  assert.equal((await call('GET', '/api/integraciones', tok.ana)).status, 403, 'solo gerencia');
  const lista = await ok('GET', '/api/integraciones', tok.ger);
  assert.ok(lista.length >= 10 && lista.every(i => i.estado === 'sin_configurar'));
  assert.equal((await call('PUT', '/api/integraciones/portal_inmobiliario', tok.ger, { valores: { usuario: 'corredora', password: SECRETO, url_prueba: 'http://insegura.example/x' } })).status, 422, 'solo https');
  assert.equal((await call('PUT', '/api/integraciones/portal_inmobiliario', tok.ger, { valores: { usuario: 'corredora', password: SECRETO, url_prueba: 'https://localhost/x' } })).status, 422, 'bloquea destinos internos');
  assert.equal((await call('PUT', '/api/integraciones/portal_inmobiliario', tok.ger, { valores: { usuario: 'corredora' } })).status, 422, 'falta contrasena');
  const g = await ok('PUT', '/api/integraciones/portal_inmobiliario', tok.ger, { valores: { usuario: 'corredora', password: SECRETO } });
  assert.equal(g.estado, 'configurada');
  assert.ok(!JSON.stringify(g).includes(SECRETO) && !JSON.stringify(await ok('GET', '/api/integraciones', tok.ger)).includes(SECRETO), 'la API nunca devuelve secretos');
  assert.equal(g.campos.find(c => c.n === 'password').cargado, true);
  const { tx } = require('../server/lib/db');
  const raw = (await tx(S.A.empresa_id, c => c.query("select secretos, config from integracion where codigo='portal_inmobiliario'"))).rows[0];
  assert.ok(!raw.secretos.includes(SECRETO) && !JSON.stringify(raw.config).includes(SECRETO), 'cifrado en reposo');
  assert.deepEqual(require('../server/lib/secretos').descifrar(raw.secretos), { password: SECRETO, ...{} }.password ? require('../server/lib/secretos').descifrar(raw.secretos) : {});
  assert.equal(require('../server/lib/secretos').descifrar(raw.secretos).password, SECRETO);
  // aislamiento entre empresas
  assert.equal((await ok('GET', '/api/integraciones', tok.gerB)).find(i => i.codigo === 'portal_inmobiliario').estado, 'sin_configurar');
  // sin URL de prueba: guardada pero sin verificar, no se puede activar
  assert.equal((await ok('POST', '/api/integraciones/portal_inmobiliario/probar', tok.ger)).estado, 'configurada');
  // con URL de prueba (fetch simulado): 401 => error; 200 => conectada => activable
  const realFetch = global.fetch; let status = 401, visto;
  global.fetch = async (u, o) => { visto = { u: String(u), auth: o && o.headers && o.headers.Authorization }; return new Response('{}', { status }); };
  try {
    await ok('PUT', '/api/integraciones/portal_inmobiliario', tok.ger, { valores: { url_prueba: 'https://api.portal.example/health' } });
    const r401 = await ok('POST', '/api/integraciones/portal_inmobiliario/probar', tok.ger);
    assert.equal(r401.estado, 'error'); assert.match(r401.detalle, /rechazadas/);
    assert.equal((await call('POST', '/api/integraciones/portal_inmobiliario/activar', tok.ger, { activa: true })).status, 422, 'no se activa con error');
    status = 200;
    assert.equal((await ok('POST', '/api/integraciones/portal_inmobiliario/probar', tok.ger)).estado, 'conectada');
    assert.equal(visto.auth, 'Basic ' + Buffer.from('corredora:' + SECRETO).toString('base64'), 'usa las credenciales guardadas');
    await ok('POST', '/api/integraciones/portal_inmobiliario/activar', tok.ger, { activa: true });
    assert.equal((await ok('GET', '/api/integraciones', tok.ger)).find(i => i.codigo === 'portal_inmobiliario').activa, true);
    // cambiar credenciales desactiva y exige nueva prueba; vacio conserva el secreto
    const g2 = await ok('PUT', '/api/integraciones/portal_inmobiliario', tok.ger, { valores: { usuario: 'otro', password: '' } });
    assert.equal(g2.activa, false); assert.equal(g2.estado, 'configurada');
    assert.equal(require('../server/lib/secretos').descifrar((await tx(S.A.empresa_id, c => c.query("select secretos from integracion where codigo='portal_inmobiliario'"))).rows[0].secretos).password, SECRETO);
    // error de red: el mensaje no filtra secretos
    global.fetch = async () => { throw new Error('fallo con ' + SECRETO); };
    const rn = await ok('POST', '/api/integraciones/portal_inmobiliario/probar', tok.ger);
    assert.equal(rn.estado, 'error'); assert.ok(!rn.detalle.includes(SECRETO));
  } finally { global.fetch = realFetch; }
  const logs = await ok('GET', '/api/integraciones/portal_inmobiliario/logs', tok.ger);
  assert.ok(logs.length >= 3 && !JSON.stringify(logs).includes(SECRETO));
  const aud = JSON.stringify(await ok('GET', '/api/auditoria?entidad=integracion', tok.ger));
  assert.ok(aud.includes('configurar') && !aud.includes(SECRETO), 'auditoria sin secretos');
  await ok('DELETE', '/api/integraciones/portal_inmobiliario/credenciales', tok.ger);
  assert.equal((await ok('GET', '/api/integraciones', tok.ger)).find(i => i.codigo === 'portal_inmobiliario').estado, 'sin_configurar');
});
