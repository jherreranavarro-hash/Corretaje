// Servicio de finanzas: libro de movimientos, comisiones y liquidaciones de agentes.
const { bad, notFound, round0, hoy, periodoDe, aCLP, valorIndice, audit, empresaParam } = require('../lib/util');

async function conceptoPor(c, d) {
  const r = d.concepto_id
    ? await c.query('select * from concepto where id=$1', [d.concepto_id])
    : await c.query('select * from concepto where codigo=$1', [d.concepto_codigo]);
  const con = r.rows[0];
  if (!con) throw bad('Concepto no existe');
  if (!con.activo) throw bad('Concepto desactivado');
  return con;
}
async function periodoAbierto(c, empresaId, fecha) {
  const r = await c.query('select estado from periodo where empresa_id=$1 and periodo=$2', [empresaId, periodoDe(fecha)]);
  if (r.rows[0] && r.rows[0].estado === 'cerrado') throw bad(`El periodo ${periodoDe(fecha)} esta cerrado; registre el ajuste en el periodo abierto`);
}

// Crea un movimiento en el libro aplicando todas las reglas de negocio (doc 03 §B2)
async function crearMovimiento(c, u, d) {
  const con = await conceptoPor(c, d);
  const fecha = d.fecha || hoy();
  const moneda = d.moneda || 'CLP';
  const neto = Number(d.monto_neto);
  if (!(neto >= 0)) throw bad('monto_neto debe ser un numero >= 0');
  if (!d.operacion_id && !d.propiedad_id && !d.contrato_id && !d.centro_costo_id)
    throw bad('El movimiento debe vincularse a una operacion, propiedad, contrato o centro de costo');
  await periodoAbierto(c, u.empresa_id, fecha);
  const par = await empresaParam(c, u.empresa_id);
  const ivaCalc = con.afecto_iva ? (moneda === 'CLP' ? round0(neto * par.iva_pct / 100) : Math.round(neto * par.iva_pct) / 100) : 0;
  let iva = d.iva === undefined || d.iva === null || d.iva === '' ? ivaCalc : Number(d.iva);
  if (Math.abs(iva - ivaCalc) > 1 && !d.glosa) throw bad(`IVA difiere del calculado (${ivaCalc}); agregue una glosa que lo justifique`);
  const tipo = d.tipo || con.naturaleza;
  const n = await aCLP(c, neto, moneda, fecha);
  const i = await aCLP(c, iva, moneda, fecha);
  const clpTotal = n.clp + i.clp;
  const requiereAprob = tipo === 'egreso' && clpTotal >= (par.umbral_aprobacion_gasto ?? 500000);
  const estado = d.estado || 'provisionado';
  if (estado === 'anulado') throw bad('Use la anulacion para anular un movimiento');
  if (estado === 'pagado' && con.requiere_respaldo && !d.documento_id && !d.nro_documento) throw bad('El concepto exige respaldo para marcar pagado');
  if (estado === 'pagado' && requiereAprob && !d.aprobado_por) throw bad('El monto supera el umbral y requiere aprobacion antes de pagarse');
  const fondo = d.fondo || 'propio';
  const r = await c.query(
    `insert into movimiento (empresa_id, fecha, operacion_id, propiedad_id, contrato_id, liquidacion_id, publicacion_id, documento_id,
        concepto_id, tipo, monto_neto, iva, moneda, tipo_cambio, neto_clp, iva_clp, monto_clp, pagador, contraparte_persona_id,
        centro_costo_id, estado, fondo, fecha_pago, medio_pago_id, nro_documento, tipo_documento_tributario, requiere_aprobacion,
        origen, origen_ref, glosa, created_by, aprobado_por, aprobado_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,case when $32::uuid is null then null else now() end) returning *`,
    [u.empresa_id, fecha, d.operacion_id || null, d.propiedad_id || null, d.contrato_id || null, d.liquidacion_id || null,
      d.publicacion_id || null, d.documento_id || null, con.id, tipo, neto, iva, moneda, moneda === 'CLP' ? 1 : n.tc,
      n.clp, i.clp, clpTotal, d.pagador || null, d.contraparte_persona_id || null, d.centro_costo_id || null, estado, fondo,
      estado === 'pagado' ? (d.fecha_pago || fecha) : (d.fecha_pago || null), d.medio_pago_id || null, d.nro_documento || null,
      d.tipo_documento_tributario || null, requiereAprob, d.origen || 'manual', d.origen_ref || null, d.glosa || null, u.id, requiereAprob ? (d.aprobado_por || null) : null]);
  await audit(c, u, 'movimiento', r.rows[0].id, 'crear', null, { concepto: con.codigo, tipo, neto_clp: n.clp, estado });
  return r.rows[0];
}

async function getMov(c, id) {
  const r = await c.query('select m.*, co.codigo as concepto_codigo, co.requiere_respaldo from movimiento m join concepto co on co.id=m.concepto_id where m.id=$1', [id]);
  if (!r.rows[0]) throw notFound('Movimiento no encontrado');
  return r.rows[0];
}
const ORDEN = { provisionado: 0, facturado: 1, pagado: 2 };
async function cambiarEstadoMovimiento(c, u, id, d) {
  const m = await getMov(c, id);
  if (m.estado === 'anulado') throw bad('Movimiento anulado');
  if (!(d.estado in ORDEN)) throw bad('Estado invalido');
  if (ORDEN[d.estado] <= ORDEN[m.estado]) throw bad(`No se puede pasar de ${m.estado} a ${d.estado}`);
  await periodoAbierto(c, u.empresa_id, m.fecha);
  if (d.estado === 'pagado') {
    if (m.requiere_respaldo && !m.documento_id && !(d.nro_documento || m.nro_documento)) throw bad('El concepto exige respaldo (documento o numero) para marcar pagado');
    if (m.requiere_aprobacion && !m.aprobado_por) throw bad('Requiere aprobacion antes de pagarse');
  }
  const r = await c.query(
    `update movimiento set estado=$2, fecha_pago=coalesce($3, fecha_pago, case when $2='pagado' then current_date end),
       medio_pago_id=coalesce($4, medio_pago_id), nro_documento=coalesce($5, nro_documento) where id=$1 returning *`,
    [id, d.estado, d.fecha_pago || null, d.medio_pago_id || null, d.nro_documento || null]);
  await audit(c, u, 'movimiento', id, 'estado:' + d.estado, { estado: m.estado }, { estado: d.estado });
  return r.rows[0];
}
async function aprobarMovimiento(c, u, id) {
  const m = await getMov(c, id);
  if (!m.requiere_aprobacion) throw bad('El movimiento no requiere aprobacion');
  if (m.created_by === u.id) throw bad('Separacion de funciones: quien registra no puede aprobar');
  const r = await c.query('update movimiento set aprobado_por=$2, aprobado_at=now() where id=$1 returning *', [id, u.id]);
  await audit(c, u, 'movimiento', id, 'aprobar');
  return r.rows[0];
}
async function anularMovimiento(c, u, id, motivo) {
  if (!motivo) throw bad('Indique el motivo de la anulacion');
  const m = await getMov(c, id);
  if (m.estado === 'anulado') throw bad('Ya esta anulado');
  await periodoAbierto(c, u.empresa_id, m.fecha);
  await periodoAbierto(c, u.empresa_id, hoy());
  await c.query("update movimiento set estado='anulado' where id=$1", [id]);
  const opuesto = m.tipo === 'ingreso' ? 'egreso' : m.tipo === 'egreso' ? 'ingreso' : 'traspaso';
  const rev = await c.query(
    `insert into movimiento (empresa_id, fecha, operacion_id, propiedad_id, contrato_id, liquidacion_id, publicacion_id, documento_id, concepto_id, tipo,
       monto_neto, iva, moneda, tipo_cambio, neto_clp, iva_clp, monto_clp, pagador, centro_costo_id, estado, fondo, origen, reversa_de, glosa, created_by)
     values ($1,current_date,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'anulado',$19,'manual',$20,$21,$22) returning id`,
    [m.empresa_id, m.operacion_id, m.propiedad_id, m.contrato_id, m.liquidacion_id, m.publicacion_id, m.documento_id, m.concepto_id, opuesto,
      m.monto_neto, m.iva, m.moneda, m.tipo_cambio, m.neto_clp, m.iva_clp, m.monto_clp, m.pagador, m.centro_costo_id, m.fondo, id,
      'Reversa: ' + motivo, u.id]);
  await audit(c, u, 'movimiento', id, 'anular', { estado: m.estado }, { motivo, reversa: rev.rows[0].id });
  return { anulado: id, reversa: rev.rows[0].id };
}

// ---------- Resultado por operacion ----------
async function resumenOperacion(c, opId) {
  const op = (await c.query('select * from operacion where id=$1', [opId])).rows[0];
  if (!op) throw notFound('Operacion no encontrada');
  const movs = (await c.query(
    `select m.*, co.nombre as concepto, co.categoria from movimiento m join concepto co on co.id=m.concepto_id
     where m.operacion_id=$1 order by m.fecha, m.created_at`, [opId])).rows;
  const vivos = movs.filter(m => m.estado !== 'anulado');
  const ingresos = vivos.filter(m => m.tipo === 'ingreso' && m.fondo === 'propio').reduce((s, m) => s + m.neto_clp, 0);
  const costos = vivos.filter(m => m.tipo === 'egreso' && m.fondo === 'propio' && m.pagador === 'corredora' && m.categoria !== 'comision_agente')
    .reduce((s, m) => s + m.neto_clp, 0);
  const trasladados = vivos.filter(m => m.tipo === 'egreso' && m.pagador && m.pagador !== 'corredora').reduce((s, m) => s + m.neto_clp, 0);
  const coms = (await c.query(
    `select cm.*, (select json_agg(r order by r.rol) from comision_reparto r where r.comision_id=cm.id) as reparto
     from comision cm where cm.operacion_id=$1 order by cm.created_at`, [opId])).rows;
  const comisionesAgentes = coms.filter(x => x.estado !== 'anulada').reduce((s, x) =>
    s + (x.reparto || []).filter(r => r.beneficiario_id && ['captador', 'vendedor', 'referido'].includes(r.rol)).reduce((a, r) => a + r.monto, 0), 0);
  const utilidad = ingresos - costos - comisionesAgentes;
  const cobrado = vivos.filter(m => m.tipo === 'ingreso' && m.fondo === 'propio' && m.estado === 'pagado').reduce((s, m) => s + m.neto_clp, 0);
  const sinRespaldo = vivos.filter(m => m.tipo === 'egreso' && !m.documento_id && !m.nro_documento).length;
  // costos a nivel de propiedad (captacion/publicacion) aun no asignados a una operacion
  const cp = (await c.query(
    `select coalesce(sum(m.neto_clp),0) as total from movimiento m join concepto co on co.id=m.concepto_id
     where m.propiedad_id=$1 and m.operacion_id is null and m.tipo='egreso' and m.estado<>'anulado' and m.pagador='corredora'`, [op.propiedad_id])).rows[0].total;
  return {
    operacion: op, ingresos, costos, comisiones_agentes: comisionesAgentes, utilidad,
    margen_pct: ingresos ? Math.round(utilidad / ingresos * 1000) / 10 : null,
    ingresos_cobrados: cobrado, costos_trasladados_a_terceros: trasladados, movimientos_sin_respaldo: sinRespaldo,
    costos_propiedad_no_asignados: cp, comisiones: coms, movimientos: movs,
  };
}

// ---------- Comisiones ----------
async function reglaAplicable(c, tipo, hito, fecha, reglaId) {
  if (reglaId) { const r = await c.query('select * from regla_comision where id=$1', [reglaId]); return r.rows[0]; }
  const r = await c.query(
    `select * from regla_comision where activa and tipo_operacion=$1 and ($2::text is null or hito_devengo=$2)
       and vigente_desde<=$3 and (vigente_hasta is null or vigente_hasta>=$3) order by vigente_desde desc limit 1`, [tipo, hito || null, fecha]);
  return r.rows[0];
}
async function calcularComision(c, empresaId, regla, op, over = {}) {
  const fecha = hoy();
  const precio = over.precio ?? op.precio;
  const moneda = over.moneda || op.moneda;
  const { clp: baseClp } = await aCLP(c, precio, moneda, fecha);
  let neto;
  if (regla.base === 'fijo') neto = Number(regla.monto_fijo || 0);
  else if (regla.base === 'renta_meses') neto = baseClp * Number(regla.meses || 1);
  else {
    let pct = Number(regla.pct || 0);
    if (regla.escala && Array.isArray(regla.escala.tramos)) {
      const ref = regla.escala.moneda === 'UF' ? (moneda === 'UF' ? precio : baseClp / (await valorIndice(c, 'UF', fecha))) : baseClp;
      const t = regla.escala.tramos.find(t => t.hasta === null || ref <= t.hasta);
      if (t) pct = t.pct;
    }
    neto = baseClp * pct / 100;
  }
  if (regla.minimo != null && neto < regla.minimo) neto = Number(regla.minimo);
  if (regla.tope != null && neto > regla.tope) neto = Number(regla.tope);
  neto = round0(neto);
  const par = await empresaParam(c, empresaId);
  const iva = regla.afecta_iva ? round0(neto * par.iva_pct / 100) : 0;
  const rep = regla.reparto || {};
  const suma = Object.values(rep).reduce((s, v) => s + Number(v), 0);
  if (Math.abs(suma - 100) > 0.0001) throw bad(`El reparto de la regla suma ${suma}%, debe sumar 100%`);
  const benef = { captador: op.agente_captador_id, vendedor: op.agente_vendedor_id, referido: null, corredora: null };
  let asignado = 0;
  const lineas = Object.entries(rep).map(([rol, pct]) => {
    const monto = round0(neto * Number(pct) / 100); asignado += monto;
    return { rol, pct: Number(pct), monto, beneficiario_id: benef[rol] || null };
  });
  const dif = neto - asignado; // ajuste de redondeo a la corredora
  if (dif !== 0) { const cor = lineas.find(l => l.rol === 'corredora') || lineas[lineas.length - 1]; cor.monto += dif; }
  return { base_clp: baseClp, monto_neto: neto, iva, total: neto + iva, reparto: lineas };
}

async function devengarComision(c, u, op, hito) {
  const regla = await reglaAplicable(c, op.tipo, hito, hoy());
  if (!regla || regla.hito_devengo !== hito) return null;
  const ya = await c.query('select id from comision where operacion_id=$1 and hito=$2', [op.id, hito]);
  if (ya.rows[0]) return ya.rows[0];
  const calc = await calcularComision(c, u.empresa_id, regla, op);
  const cm = (await c.query(
    `insert into comision (empresa_id, operacion_id, regla_id, regla_snapshot, hito, base_clp, monto_neto, iva)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
    [u.empresa_id, op.id, regla.id, JSON.stringify(regla), hito, calc.base_clp, calc.monto_neto, calc.iva])).rows[0];
  for (const l of calc.reparto)
    await c.query('insert into comision_reparto (empresa_id, comision_id, rol, beneficiario_id, pct, monto) values ($1,$2,$3,$4,$5,$6)',
      [u.empresa_id, cm.id, l.rol, l.beneficiario_id, l.pct, l.monto]);
  const mov = await crearMovimiento(c, u, {
    concepto_codigo: op.tipo === 'venta' ? 'COM_VENTA' : 'COM_ARRIENDO', monto_neto: calc.monto_neto, iva: calc.iva,
    operacion_id: op.id, propiedad_id: op.propiedad_id, pagador: regla.pagador, estado: 'provisionado',
    origen: 'evento', origen_ref: 'comision:' + cm.id, glosa: `Comision devengada (${hito}) - regla ${regla.nombre}`,
    contraparte_persona_id: op.cliente_id,
  });
  await c.query('update comision set movimiento_id=$2 where id=$1', [cm.id, mov.id]);
  await audit(c, u, 'comision', cm.id, 'devengar', null, { operacion: op.codigo, neto: calc.monto_neto, hito });
  return { ...cm, movimiento_id: mov.id };
}

async function aprobarComision(c, u, id) {
  const cm = (await c.query('select * from comision where id=$1', [id])).rows[0];
  if (!cm) throw notFound();
  if (cm.estado !== 'devengada') throw bad(`La comision esta ${cm.estado}`);
  const par = await empresaParam(c, u.empresa_id);
  if (par.pagar_comision_solo_si_cobrada !== false) {
    const mv = (await c.query('select estado from movimiento where id=$1', [cm.movimiento_id])).rows[0];
    if (!mv || mv.estado !== 'pagado') throw bad('La comision aun no fue cobrada al cliente (marque el ingreso como pagado) - politica pagar_comision_solo_si_cobrada');
  }
  await c.query("update comision set estado='aprobada', aprobada_por=$2 where id=$1", [id, u.id]);
  await audit(c, u, 'comision', id, 'aprobar');
  return (await c.query('select * from comision where id=$1', [id])).rows[0];
}
// Override de reparto (con motivo y auditoria)
async function overrideReparto(c, u, comisionId, lineas, motivo) {
  if (!motivo) throw bad('Indique el motivo del cambio de reparto');
  const cm = (await c.query('select * from comision where id=$1', [comisionId])).rows[0];
  if (!cm) throw notFound();
  if (cm.estado !== 'devengada') throw bad('Solo se puede modificar el reparto de una comision devengada');
  const suma = lineas.reduce((s, l) => s + Number(l.pct), 0);
  if (Math.abs(suma - 100) > 0.0001) throw bad(`El reparto suma ${suma}%, debe sumar 100%`);
  const antes = (await c.query('select rol, beneficiario_id, pct, monto from comision_reparto where comision_id=$1', [comisionId])).rows;
  await c.query('delete from comision_reparto where comision_id=$1', [comisionId]);
  let asig = 0;
  for (const l of lineas) {
    const monto = round0(cm.monto_neto * Number(l.pct) / 100); asig += monto;
    await c.query('insert into comision_reparto (empresa_id, comision_id, rol, beneficiario_id, pct, monto) values ($1,$2,$3,$4,$5,$6)',
      [u.empresa_id, comisionId, l.rol, l.beneficiario_id || null, l.pct, monto]);
  }
  const dif = cm.monto_neto - asig;
  if (dif) await c.query(`update comision_reparto set monto=monto+$2 where id=(select id from comision_reparto where comision_id=$1 order by (rol='corredora') desc, monto desc limit 1)`, [comisionId, dif]);
  await audit(c, u, 'comision', comisionId, 'override_reparto', { reparto: antes, motivo }, { reparto: lineas });
}
async function anularComisionesOperacion(c, u, opId, motivo) {
  const cms = (await c.query("select * from comision where operacion_id=$1 and estado<>'anulada'", [opId])).rows;
  for (const cm of cms) {
    if (cm.estado === 'pagada') throw bad('La comision ya fue pagada a agentes: requiere ajuste manual (clawback)');
    const mv = (await c.query('select estado from movimiento where id=$1', [cm.movimiento_id])).rows[0];
    if (mv && mv.estado === 'pagado') throw bad('La comision ya fue cobrada al cliente: requiere devolucion manual');
    if (mv && mv.estado !== 'anulado') await anularMovimiento(c, u, cm.movimiento_id, 'Operacion caida: ' + motivo);
    await c.query("update comision set estado='anulada' where id=$1", [cm.id]);
    await audit(c, u, 'comision', cm.id, 'anular', null, { motivo });
  }
}

// ---------- Liquidaciones de agentes ----------
async function generarLiquidacionesAgente(c, u, { periodo, agente_id }) {
  const par = await empresaParam(c, u.empresa_id);
  const rows = (await c.query(
    `select r.*, cm.operacion_id, o.codigo from comision_reparto r join comision cm on cm.id=r.comision_id
       join operacion o on o.id=cm.operacion_id
     where cm.estado='aprobada' and r.liquidacion_id is null and r.beneficiario_id is not null
       and r.rol in ('captador','vendedor','referido') and ($1::uuid is null or r.beneficiario_id=$1) order by r.beneficiario_id`, [agente_id || null])).rows;
  const porAgente = {};
  for (const r of rows) (porAgente[r.beneficiario_id] ||= []).push(r);
  const creadas = [];
  for (const [ag, lst] of Object.entries(porAgente)) {
    const bruto = lst.reduce((s, r) => s + r.monto, 0);
    const retencion = round0(bruto * (par.retencion_honorarios_pct || 0) / 100);
    const liq = (await c.query(
      `insert into liquidacion_agente (empresa_id, agente_id, periodo, bruto, retencion, neto) values ($1,$2,$3,$4,$5,$6) returning *`,
      [u.empresa_id, ag, periodo, bruto, retencion, bruto - retencion])).rows[0];
    for (const r of lst) {
      await c.query('insert into liquidacion_agente_detalle (empresa_id, liquidacion_id, tipo, comision_reparto_id, operacion_id, monto, glosa) values ($1,$2,$3,$4,$5,$6,$7)',
        [u.empresa_id, liq.id, 'comision', r.id, r.operacion_id, r.monto, `Comision ${r.rol} ${r.codigo}`]);
      await c.query('update comision_reparto set liquidacion_id=$2 where id=$1', [r.id, liq.id]);
    }
    creadas.push(liq);
  }
  await audit(c, u, 'liquidacion_agente', periodo, 'generar', null, { cantidad: creadas.length });
  return creadas;
}
async function aprobarLiquidacionAgente(c, u, id) {
  const l = (await c.query('select * from liquidacion_agente where id=$1', [id])).rows[0];
  if (!l) throw notFound();
  if (l.estado !== 'borrador') throw bad(`La liquidacion esta ${l.estado}`);
  await c.query("update liquidacion_agente set estado='aprobada', aprobada_por=$2 where id=$1", [id, u.id]);
  await audit(c, u, 'liquidacion_agente', id, 'aprobar');
}
async function pagarLiquidacionAgente(c, u, id) {
  const l = (await c.query('select * from liquidacion_agente where id=$1', [id])).rows[0];
  if (!l) throw notFound();
  if (l.estado !== 'aprobada') throw bad('Debe estar aprobada para pagarse');
  const det = (await c.query('select * from liquidacion_agente_detalle where liquidacion_id=$1', [id])).rows;
  for (const d of det) {
    const op = (await c.query('select propiedad_id from operacion where id=$1', [d.operacion_id])).rows[0];
    await crearMovimiento(c, u, { concepto_codigo: 'COM_AGENTE', monto_neto: d.monto, operacion_id: d.operacion_id, propiedad_id: op.propiedad_id,
      pagador: 'corredora', estado: 'pagado', origen: 'evento', origen_ref: 'liquidacion_agente:' + id, glosa: d.glosa, aprobado_por: l.aprobada_por });
  }
  await c.query("update liquidacion_agente set estado='pagada' where id=$1", [id]);
  await c.query(`update comision set estado='pagada' where id in (select cm.id from comision cm where cm.estado='aprobada'
      and not exists (select 1 from comision_reparto r where r.comision_id=cm.id and r.beneficiario_id is not null and r.rol<>'corredora' and
        (r.liquidacion_id is null or r.liquidacion_id not in (select id from liquidacion_agente where estado='pagada'))))`);
  await audit(c, u, 'liquidacion_agente', id, 'pagar', null, { neto: l.neto });
}

module.exports = { crearMovimiento, cambiarEstadoMovimiento, aprobarMovimiento, anularMovimiento, resumenOperacion,
  reglaAplicable, calcularComision, devengarComision, aprobarComision, overrideReparto, anularComisionesOperacion,
  generarLiquidacionesAgente, aprobarLiquidacionAgente, pagarLiquidacionAgente };
