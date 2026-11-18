// Arriendos y administracion de propiedades: contratos, cargos, pagos, mora, reajustes, mantenciones y liquidaciones.
const { bad, notFound, round0, hoy, periodoDe, addDays, addMonths, diasEntre, diasDelMes, nextSeq, valorIndice, audit, empresaParam } = require('../lib/util');
const fin = require('./finanzas');

const finMes = p => `${p}-${String(diasDelMes(p)).padStart(2, '0')}`;

async function crearContrato(c, u, opId, d) {
  const op = (await c.query('select * from operacion where id=$1', [opId])).rows[0];
  if (!op) throw notFound('Operacion no encontrada');
  if (op.tipo !== 'arriendo') throw bad('La operacion no es de arriendo');
  if (op.estado !== 'aprobada') throw bad('La postulacion debe estar aprobada para crear el contrato');
  if (!op.cliente_id) throw bad('Asigne el arrendatario a la operacion');
  if (!d.fecha_inicio || !d.fecha_termino) throw bad('Indique fecha de inicio y termino');
  const ya = await c.query("select 1 from contrato_arriendo where operacion_id=$1 and estado='borrador'", [opId]);
  if (ya.rows[0]) throw bad('Ya existe un contrato borrador para la operacion');
  const per = d.reajuste_periodicidad_meses ?? 12;
  const r = (await c.query(
    `insert into contrato_arriendo (empresa_id, operacion_id, propiedad_id, arrendatario_id, aval_id, fecha_inicio, fecha_termino, canon_inicial, canon_vigente,
       canon_moneda, dia_pago, reajuste_tipo, reajuste_periodicidad_meses, reajuste_valor, proximo_reajuste, garantia_monto, interes_mora_pct, dias_gracia,
       administrado, cobra_gasto_comun)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) returning *`,
    [u.empresa_id, opId, op.propiedad_id, op.cliente_id, d.aval_id || null, d.fecha_inicio, d.fecha_termino, d.canon ?? op.precio,
      d.canon_moneda || op.moneda, d.dia_pago || 5, d.reajuste_tipo || 'ipc', per, d.reajuste_valor || null,
      d.reajuste_tipo === 'ninguno' ? null : addMonths(d.fecha_inicio, per), d.garantia_monto || 0, d.interes_mora_pct || 0, d.dias_gracia || 0,
      d.administrado !== false, !!d.cobra_gasto_comun])).rows[0];
  await audit(c, u, 'contrato_arriendo', r.id, 'crear', null, { operacion: op.codigo });
  return r;
}

async function registrarGarantia(c, u, contratoId, d = {}) {
  const k = (await c.query('select * from contrato_arriendo where id=$1', [contratoId])).rows[0];
  if (!k) throw notFound();
  if (k.garantia_estado !== 'pendiente') throw bad('La garantia ya fue registrada');
  if (!(k.garantia_monto > 0)) throw bad('El contrato no tiene garantia pactada');
  const mon = k.canon_moneda;
  const mov = await fin.crearMovimiento(c, u, { concepto_codigo: 'GARANTIA', monto_neto: k.garantia_monto, moneda: mon === 'USD' ? 'CLP' : mon,
    contrato_id: k.id, propiedad_id: k.propiedad_id, pagador: 'cliente', fondo: 'terceros', estado: 'pagado', fecha: d.fecha || hoy(), glosa: 'Garantia de arriendo' });
  await c.query("update contrato_arriendo set garantia_estado='recibida' where id=$1", [k.id]);
  return mov;
}

// ---------- Cargos ----------
async function generarCargos(c, u, { periodo, contrato_id }) {
  if (!/^\d{4}-\d{2}$/.test(periodo || '')) throw bad('periodo debe tener formato YYYY-MM');
  const par = await empresaParam(c, u.empresa_id);
  const ini = periodo + '-01', fin_ = finMes(periodo), dim = diasDelMes(periodo);
  const ks = (await c.query(
    `select k.*, p.gasto_comun from contrato_arriendo k join propiedad p on p.id=k.propiedad_id
     where k.estado in ('firmado','vigente') and k.fecha_inicio<=$1 and k.fecha_termino>=$2 and ($3::uuid is null or k.id=$3)`, [fin_, ini, contrato_id || null])).rows;
  let creados = 0;
  for (const k of ks) {
    let factor = 1;
    if (par.prorratear_canon !== false) {
      const desde = k.fecha_inicio > ini ? k.fecha_inicio : ini, hasta = k.fecha_termino < fin_ ? k.fecha_termino : fin_;
      factor = (diasEntre(desde, hasta) + 1) / dim;
    }
    const venc = `${periodo}-${String(k.dia_pago).padStart(2, '0')}`;
    const fechaIdx = hoy() < venc ? hoy() : venc;
    const monto = Math.round(k.canon_vigente * factor * 10000) / 10000;
    const tc = k.canon_moneda === 'CLP' ? 1 : await valorIndice(c, k.canon_moneda === 'UF' ? 'UF' : 'USD', fechaIdx);
    const clp = round0(monto * tc);
    const desc = factor < 1 ? `Canon proporcional ${periodo}` : `Canon ${periodo}`;
    const r = await c.query(
      `insert into cargo (empresa_id, contrato_id, propiedad_id, arrendatario_id, periodo, tipo, descripcion, monto_original, moneda, valor_indice, monto_clp, saldo_clp, emision, vencimiento)
       values ($1,$2,$3,$4,$5,'canon',$6,$7,$8,$9,$10,$10,$11,$12) on conflict (contrato_id, periodo, tipo, descripcion) do nothing returning id`,
      [u.empresa_id, k.id, k.propiedad_id, k.arrendatario_id, periodo, desc, monto, k.canon_moneda, tc, clp, hoy() < ini ? ini : hoy(), venc]);
    creados += r.rowCount;
    if (k.cobra_gasto_comun && k.gasto_comun > 0) {
      const g = await c.query(
        `insert into cargo (empresa_id, contrato_id, propiedad_id, arrendatario_id, periodo, tipo, descripcion, monto_original, moneda, monto_clp, saldo_clp, emision, vencimiento)
         values ($1,$2,$3,$4,$5,'gasto_comun',$6,$7,'CLP',$7,$7,$8,$9) on conflict (contrato_id, periodo, tipo, descripcion) do nothing returning id`,
        [u.empresa_id, k.id, k.propiedad_id, k.arrendatario_id, periodo, 'Gasto comun ' + periodo, k.gasto_comun, hoy() < ini ? ini : hoy(), venc]);
      creados += g.rowCount;
    }
  }
  await audit(c, u, 'cargo', periodo, 'generar', null, { contratos: ks.length, creados });
  return { contratos: ks.length, cargos_creados: creados };
}

async function crearCargoManual(c, u, d) {
  const k = (await c.query('select * from contrato_arriendo where id=$1', [d.contrato_id])).rows[0];
  if (!k) throw notFound('Contrato no encontrado');
  const monto = Number(d.monto);
  if (!(monto > 0)) throw bad('Monto invalido');
  const periodo = d.periodo || periodoDe(hoy());
  const r = await c.query(
    `insert into cargo (empresa_id, contrato_id, propiedad_id, arrendatario_id, periodo, tipo, descripcion, monto_original, moneda, monto_clp, saldo_clp, emision, vencimiento, destino)
     values ($1,$2,$3,$4,$5,$6,$7,$8,'CLP',$8,$8,$9,$10,$11) returning *`,
    [u.empresa_id, k.id, k.propiedad_id, k.arrendatario_id, periodo, d.tipo || 'otro', d.descripcion || 'Cargo manual', monto, hoy(), d.vencimiento || hoy(), d.destino || 'propietario']);
  await audit(c, u, 'cargo', r.rows[0].id, 'crear_manual', null, { monto, tipo: d.tipo });
  return r.rows[0];
}
async function anularCargo(c, u, id, motivo) {
  if (!motivo) throw bad('Indique el motivo');
  const cg = (await c.query('select * from cargo where id=$1', [id])).rows[0];
  if (!cg) throw notFound();
  if (cg.saldo_clp !== cg.monto_clp) throw bad('El cargo tiene pagos aplicados; revierta el pago primero');
  await c.query("update cargo set estado='anulado', saldo_clp=0, anulado_motivo=$2 where id=$1", [id, motivo]);
  await audit(c, u, 'cargo', id, 'anular', null, { motivo });
}

// Marca vencidos y materializa intereses de mora (idempotente)
async function calcularMora(c, u, { fecha } = {}) {
  fecha = fecha || hoy();
  const venc = (await c.query(
    `select cg.*, k.interes_mora_pct, k.dias_gracia from cargo cg join contrato_arriendo k on k.id=cg.contrato_id
     where cg.tipo in ('canon','gasto_comun') and cg.estado in ('pendiente','parcial','vencido') and cg.saldo_clp>0 and cg.vencimiento + k.dias_gracia < $1::date`, [fecha])).rows;
  let intereses = 0;
  for (const cg of venc) {
    await c.query("update cargo set estado='vencido' where id=$1 and estado<>'vencido'", [cg.id]);
    if (cg.interes_mora_pct > 0) {
      const dias = diasEntre(cg.vencimiento, fecha);
      const monto = round0(cg.saldo_clp * cg.interes_mora_pct / 100 * dias / 30);
      if (monto > 0) {
        await c.query(
          `insert into cargo (empresa_id, contrato_id, propiedad_id, arrendatario_id, periodo, tipo, descripcion, monto_original, moneda, monto_clp, saldo_clp, emision, vencimiento, estado)
           values ($1,$2,$3,$4,$5,'interes_mora',$6,$7,'CLP',$7,$7,$8,$8,'vencido')
           on conflict (contrato_id, periodo, tipo, descripcion) do update set monto_original=excluded.monto_clp, monto_clp=excluded.monto_clp,
             saldo_clp=greatest(excluded.monto_clp-(cargo.monto_clp-cargo.saldo_clp),0), emision=excluded.emision`,
          [u.empresa_id, cg.contrato_id, cg.propiedad_id, cg.arrendatario_id, cg.periodo, 'mora:' + cg.id, monto, fecha]);
        intereses++;
      }
    }
  }
  return { cargos_vencidos: venc.length, intereses_calculados: intereses };
}

// ---------- Pagos ----------
async function registrarPago(c, u, d) {
  const k = (await c.query('select * from contrato_arriendo where id=$1', [d.contrato_id])).rows[0];
  if (!k) throw notFound('Contrato no encontrado');
  const monto = Number(d.monto);
  if (!(monto > 0)) throw bad('Monto invalido');
  const fecha = d.fecha || hoy();
  const cargos = (await c.query(
    `select * from cargo where contrato_id=$1 and estado in ('pendiente','parcial','vencido') and saldo_clp>0 and destino='propietario'
     order by case tipo when 'interes_mora' then 0 when 'multa' then 1 else 2 end, vencimiento, created_at`, [k.id])).rows;
  const pago = (await c.query(
    `insert into pago (empresa_id, contrato_id, arrendatario_id, fecha, monto, medio_pago_id, referencia, registrado_por) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
    [u.empresa_id, k.id, k.arrendatario_id, fecha, monto, d.medio_pago_id || null, d.referencia || null, u.id])).rows[0];
  let resto = monto;
  const aplic = [];
  for (const cg of cargos) {
    if (resto <= 0) break;
    const ap = Math.min(resto, cg.saldo_clp);
    await c.query('insert into pago_aplicacion (empresa_id, pago_id, cargo_id, monto) values ($1,$2,$3,$4)', [u.empresa_id, pago.id, cg.id, ap]);
    const nuevo = cg.saldo_clp - ap;
    await c.query('update cargo set saldo_clp=$2, estado=$3 where id=$1', [cg.id, nuevo, nuevo === 0 ? 'pagado' : 'parcial']);
    aplic.push({ cargo_id: cg.id, descripcion: cg.descripcion, monto: ap });
    resto -= ap;
  }
  const mov = await fin.crearMovimiento(c, u, { concepto_codigo: 'COBRO_ARRIENDO', monto_neto: monto, contrato_id: k.id, propiedad_id: k.propiedad_id,
    pagador: 'cliente', fondo: 'terceros', estado: 'pagado', fecha, medio_pago_id: d.medio_pago_id, origen: 'evento', origen_ref: 'pago:' + pago.id,
    glosa: 'Pago de arriendo' + (d.referencia ? ' ref ' + d.referencia : '') });
  await c.query('update pago set sin_asignar=$2, movimiento_id=$3 where id=$1', [pago.id, resto, mov.id]);
  await audit(c, u, 'pago', pago.id, 'registrar', null, { monto, aplicaciones: aplic.length, sin_asignar: resto });
  return { pago: { ...pago, sin_asignar: resto, movimiento_id: mov.id }, aplicaciones: aplic, sin_asignar: resto };
}
async function revertirPago(c, u, id, motivo) {
  if (!motivo) throw bad('Indique el motivo');
  const p = (await c.query('select * from pago where id=$1', [id])).rows[0];
  if (!p) throw notFound();
  if (p.estado === 'revertido') throw bad('Ya esta revertido');
  const ap = (await c.query('select * from pago_aplicacion where pago_id=$1', [id])).rows;
  if (ap.some(a => a.liquidacion_id)) throw bad('El pago ya fue liquidado al propietario; registre un ajuste');
  for (const a of ap) {
    const cg = (await c.query('select * from cargo where id=$1', [a.cargo_id])).rows[0];
    const saldo = cg.saldo_clp + a.monto;
    await c.query('update cargo set saldo_clp=$2, estado=$3 where id=$1', [cg.id, saldo, saldo === cg.monto_clp ? (cg.vencimiento < hoy() ? 'vencido' : 'pendiente') : 'parcial']);
  }
  await c.query('delete from pago_aplicacion where pago_id=$1', [id]);
  if (p.movimiento_id) await fin.anularMovimiento(c, u, p.movimiento_id, 'Pago revertido: ' + motivo);
  await c.query("update pago set estado='revertido' where id=$1", [id]);
  await audit(c, u, 'pago', id, 'revertir', null, { motivo });
}

async function estadoCuenta(c, contratoId) {
  const k = (await c.query(`select k.*, p.codigo as propiedad_codigo, p.direccion, pe.nombre as arrendatario from contrato_arriendo k join propiedad p on p.id=k.propiedad_id
    join persona pe on pe.id=k.arrendatario_id where k.id=$1`, [contratoId])).rows[0];
  if (!k) throw notFound();
  const cargos = (await c.query("select * from cargo where contrato_id=$1 and estado<>'anulado' order by vencimiento, tipo", [contratoId])).rows;
  const pagos = (await c.query("select * from pago where contrato_id=$1 and estado<>'revertido' order by fecha", [contratoId])).rows;
  const saldo = cargos.reduce((s, x) => s + x.saldo_clp, 0);
  const vencido = cargos.filter(x => x.vencimiento < hoy()).reduce((s, x) => s + x.saldo_clp, 0);
  return { contrato: k, cargos, pagos, saldo_pendiente: saldo, saldo_vencido: vencido };
}

// ---------- Reajustes ----------
async function proponerReajuste(c, contratoId) {
  const k = (await c.query('select * from contrato_arriendo where id=$1', [contratoId])).rows[0];
  if (!k) throw notFound();
  if (k.reajuste_tipo === 'ninguno' || !k.proximo_reajuste) throw bad('El contrato no tiene reajuste');
  const per = k.reajuste_periodicidad_meses || 12;
  let nuevo, variacion, detalle;
  if (k.reajuste_tipo === 'ipc') {
    const desde = addMonths(k.proximo_reajuste.slice(0, 7) + '-01', -per);
    const hasta = k.proximo_reajuste.slice(0, 7) + '-01';
    const r = (await c.query("select fecha, valor from indice_valor where codigo='IPC' and fecha>=$1 and fecha<$2 order by fecha", [desde, hasta])).rows;
    if (r.length < per) throw bad(`Faltan valores de IPC: se requieren ${per} meses entre ${desde} y ${hasta} y hay ${r.length}. Cargue los indices en Mantenedores.`);
    const factor = r.reduce((f, x) => f * (1 + x.valor / 100), 1);
    variacion = Math.round((factor - 1) * 1e6) / 1e4; nuevo = round0(k.canon_vigente * factor);
    detalle = `IPC acumulado ${per} meses (${desde} a ${hasta}) = ${variacion}%`;
  } else if (k.reajuste_tipo === 'porcentaje_fijo') {
    variacion = Number(k.reajuste_valor); nuevo = round0(k.canon_vigente * (1 + variacion / 100)); detalle = `Porcentaje fijo ${variacion}%`;
  } else if (k.reajuste_tipo === 'monto_fijo') {
    nuevo = k.canon_vigente + Number(k.reajuste_valor); variacion = Math.round((nuevo / k.canon_vigente - 1) * 1e6) / 1e4; detalle = `Monto fijo ${k.reajuste_valor}`;
  } else { // uf: el canon esta expresado en UF, el cargo se calcula con el valor UF del dia
    throw bad('Contrato indexado a UF: el canon en UF no cambia; el cargo mensual se calcula con la UF vigente');
  }
  return { contrato_id: k.id, fecha_aplicacion: k.proximo_reajuste, canon_anterior: k.canon_vigente, canon_nuevo: nuevo, variacion_pct: variacion, detalle };
}
async function aplicarReajuste(c, u, contratoId) {
  const p = await proponerReajuste(c, contratoId);
  const k = (await c.query('select reajuste_periodicidad_meses from contrato_arriendo where id=$1', [contratoId])).rows[0];
  await c.query('update contrato_arriendo set canon_vigente=$2, proximo_reajuste=$3 where id=$1', [contratoId, p.canon_nuevo, addMonths(p.fecha_aplicacion, k.reajuste_periodicidad_meses || 12)]);
  await c.query('insert into contrato_reajuste (empresa_id, contrato_id, fecha_aplicacion, canon_anterior, canon_nuevo, tipo, variacion_pct, detalle, aplicado_por) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [u.empresa_id, contratoId, p.fecha_aplicacion, p.canon_anterior, p.canon_nuevo, 'auto', p.variacion_pct, p.detalle, u.id]);
  await audit(c, u, 'contrato_arriendo', contratoId, 'reajuste', { canon: p.canon_anterior }, { canon: p.canon_nuevo });
  return p;
}

// ---------- Ordenes de trabajo ----------
async function crearOT(c, u, d) {
  const prop = (await c.query('select * from propiedad where id=$1', [d.propiedad_id])).rows[0];
  if (!prop) throw notFound('Propiedad no encontrada');
  if (!d.descripcion) throw bad('Describa el trabajo');
  const par = await empresaParam(c, u.empresa_id);
  const umbral = par.umbral_mantencion ?? 200000;
  const prioridad = d.prioridad || 'media';
  const est = Number(d.costo_estimado || 0);
  const estado = est >= umbral && prioridad !== 'urgente' ? 'pendiente_aprobacion' : 'solicitada';
  const n = await nextSeq(c, u.empresa_id, 'ot');
  const k = (await c.query("select id from contrato_arriendo where propiedad_id=$1 and estado in ('firmado','vigente') limit 1", [prop.id])).rows[0];
  const r = (await c.query(
    `insert into orden_trabajo (empresa_id, codigo, propiedad_id, contrato_id, origen, categoria, prioridad, descripcion, proveedor_id, estado, costo_estimado, cargo_a, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
    [u.empresa_id, 'OT-' + String(n).padStart(5, '0'), prop.id, d.contrato_id || (k && k.id) || null, d.origen || 'corredora', d.categoria || null, prioridad,
      d.descripcion, d.proveedor_id || null, estado, est || null, d.cargo_a || 'propietario', u.id])).rows[0];
  await audit(c, u, 'orden_trabajo', r.id, 'crear', null, { codigo: r.codigo, estado });
  return r;
}
async function accionOT(c, u, id, accion, d = {}) {
  const ot = (await c.query('select * from orden_trabajo where id=$1 for update', [id])).rows[0];
  if (!ot) throw notFound();
  if (accion === 'aprobar') {
    if (ot.estado !== 'pendiente_aprobacion' && ot.estado !== 'solicitada') throw bad(`La OT esta ${ot.estado}`);
    await c.query("update orden_trabajo set estado='aprobada', aprobada_por=$2, aprobada_at=now() where id=$1", [id, u.id]);
  } else if (accion === 'rechazar') {
    if (['terminada', 'cancelada'].includes(ot.estado)) throw bad(`La OT esta ${ot.estado}`);
    await c.query("update orden_trabajo set estado='rechazada' where id=$1", [id]);
  } else if (accion === 'iniciar') {
    if (ot.estado === 'pendiente_aprobacion') throw bad('La OT supera el umbral y requiere aprobacion antes de iniciarse');
    if (!['solicitada', 'aprobada'].includes(ot.estado)) throw bad(`La OT esta ${ot.estado}`);
    await c.query("update orden_trabajo set estado='en_ejecucion' where id=$1", [id]);
  } else if (accion === 'terminar') {
    if (ot.estado !== 'en_ejecucion') throw bad('La OT debe estar en ejecucion');
    const costo = Number(d.costo_real);
    if (!(costo >= 0)) throw bad('Indique el costo real');
    const cargoA = d.cargo_a || ot.cargo_a || 'propietario';
    const mov = await fin.crearMovimiento(c, u, { concepto_codigo: 'MANTENCION', monto_neto: costo, propiedad_id: ot.propiedad_id, contrato_id: ot.contrato_id,
      pagador: cargoA === 'corredora' ? 'corredora' : 'propietario', fondo: cargoA === 'corredora' ? 'propio' : 'terceros',
      estado: d.nro_documento ? 'pagado' : 'provisionado', nro_documento: d.nro_documento, tipo_documento_tributario: d.nro_documento ? 'factura' : null,
      contraparte_persona_id: ot.proveedor_id, origen: 'evento', origen_ref: 'ot:' + ot.id, glosa: `${ot.codigo}: ${ot.descripcion}`.slice(0, 200), aprobado_por: ot.aprobada_por });
    if (cargoA === 'arrendatario' && ot.contrato_id)
      await crearCargoManual(c, u, { contrato_id: ot.contrato_id, tipo: 'reparacion', descripcion: `${ot.codigo} ${ot.descripcion}`.slice(0, 120), monto: costo, destino: 'propietario' });
    await c.query("update orden_trabajo set estado='terminada', costo_real=$2, cargo_a=$3, fecha_termino=current_date, movimiento_id=$4 where id=$1", [id, costo, cargoA, mov.id]);
  } else throw bad('Accion invalida');
  await audit(c, u, 'orden_trabajo', id, accion);
  return (await c.query('select * from orden_trabajo where id=$1', [id])).rows[0];
}

// ---------- Liquidacion al propietario ----------
async function generarLiquidaciones(c, u, { periodo, propiedad_id }) {
  if (!/^\d{4}-\d{2}$/.test(periodo || '')) throw bad('periodo debe tener formato YYYY-MM');
  const par = await empresaParam(c, u.empresa_id);
  const fm = finMes(periodo);
  const props = (await c.query(
    `select distinct p.id from propiedad p join contrato_arriendo k on k.propiedad_id=p.id and k.administrado
     where ($1::uuid is null or p.id=$1)`, [propiedad_id || null])).rows;
  const out = [];
  for (const { id: pid } of props) {
    const lineas = (await c.query(
      `select pa.pago_id, pa.cargo_id, pa.monto, cg.tipo, cg.descripcion, cg.contrato_id from pago_aplicacion pa join pago pg on pg.id=pa.pago_id
         join cargo cg on cg.id=pa.cargo_id
       where cg.propiedad_id=$1 and pa.liquidacion_id is null and pg.estado='conciliado' and pg.fecha<=$2 and cg.destino='propietario'`, [pid, fm])).rows;
    const gastos = (await c.query(
      `select m.* , co.nombre as concepto from movimiento m join concepto co on co.id=m.concepto_id
       where m.propiedad_id=$1 and m.tipo='egreso' and m.pagador='propietario' and m.estado<>'anulado' and m.liquidacion_id is null
         and co.categoria in ('mantencion','contribucion','seguro','gasto_propietario') and m.fecha<=$2`, [pid, fm])).rows;
    if (!lineas.length && !gastos.length) continue;
    const contratoId = lineas[0]?.contrato_id || (await c.query('select id from contrato_arriendo where propiedad_id=$1 order by created_at desc limit 1', [pid])).rows[0]?.id;
    const mand = (await c.query(`select * from mandato where propiedad_id=$1 and tipo='administracion' and estado='vigente' limit 1`, [pid])).rows[0];
    const ingresos = lineas.reduce((s, l) => s + l.monto, 0);
    const canonCobrado = lineas.filter(l => l.tipo === 'canon').reduce((s, l) => s + l.monto, 0);
    let honNeto = 0;
    if (mand && canonCobrado > 0) honNeto = Math.max(round0(canonCobrado * mand.honorario_admin_pct / 100), mand.honorario_admin_minimo || 0);
    const honIva = round0(honNeto * par.iva_pct / 100);
    const totGastos = gastos.reduce((s, g) => s + g.monto_clp, 0);
    const owners = (await c.query('select persona_id, porcentaje from propiedad_propietario where propiedad_id=$1 order by principal desc, persona_id', [pid])).rows;
    if (!owners.length) throw bad('La propiedad no tiene propietarios registrados');
    let rIng = 0, rHon = 0, rIva = 0, rGas = 0;
    for (let i = 0; i < owners.length; i++) {
      const last = i === owners.length - 1, f = owners[i].porcentaje / 100;
      const sh = (tot, rest) => last ? tot - rest : round0(tot * f);
      const ing = sh(ingresos, rIng), hon = sh(honNeto, rHon), iva = sh(honIva, rIva), gas = sh(totGastos, rGas);
      rIng += ing; rHon += hon; rIva += iva; rGas += gas;
      const prev = (await c.query(`select neto_a_pagar from liquidacion_propietario where propiedad_id=$1 and propietario_id=$2 and periodo<$3 and estado<>'anulada' order by periodo desc limit 1`,
        [pid, owners[i].persona_id, periodo])).rows[0];
      const saldoAnt = prev && prev.neto_a_pagar < 0 ? prev.neto_a_pagar : 0;
      await c.query("delete from liquidacion_propietario_detalle where liquidacion_id in (select id from liquidacion_propietario where propiedad_id=$1 and propietario_id=$2 and periodo=$3 and estado='borrador')",
        [pid, owners[i].persona_id, periodo]);
      await c.query("delete from liquidacion_propietario where propiedad_id=$1 and propietario_id=$2 and periodo=$3 and estado='borrador'", [pid, owners[i].persona_id, periodo]);
      const exist = await c.query('select 1 from liquidacion_propietario where propiedad_id=$1 and propietario_id=$2 and periodo=$3', [pid, owners[i].persona_id, periodo]);
      if (exist.rows[0]) continue;
      const neto = ing - hon - iva - gas + saldoAnt;
      const liq = (await c.query(
        `insert into liquidacion_propietario (empresa_id, propiedad_id, propietario_id, contrato_id, periodo, ingresos, honorario_neto, honorario_iva, gastos, saldo_anterior, neto_a_pagar)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
        [u.empresa_id, pid, owners[i].persona_id, contratoId, periodo, ing, hon, iva, gas, saldoAnt, neto])).rows[0];
      const det = (t, d, m) => c.query('insert into liquidacion_propietario_detalle (empresa_id, liquidacion_id, tipo, descripcion, monto) values ($1,$2,$3,$4,$5)', [u.empresa_id, liq.id, t, d, m]);
      for (const l of lineas) await det(l.tipo, l.descripcion, round0(l.monto * f));
      if (hon) await det('honorario', `Honorario de administracion ${mand.honorario_admin_pct}%`, -hon);
      if (iva) await det('iva_honorario', `IVA ${par.iva_pct}% del honorario`, -iva);
      for (const g of gastos) await det('gasto', g.concepto + (g.glosa ? ': ' + g.glosa : ''), -round0(g.monto_clp * f));
      if (saldoAnt) await det('saldo_anterior', 'Saldo del periodo anterior', saldoAnt);
      out.push(liq);
    }
  }
  await audit(c, u, 'liquidacion_propietario', periodo, 'generar', null, { liquidaciones: out.length });
  return out;
}
async function cambiarLiquidacion(c, u, id, accion) {
  const l = (await c.query('select * from liquidacion_propietario where id=$1 for update', [id])).rows[0];
  if (!l) throw notFound();
  const par = await empresaParam(c, u.empresa_id);
  if (accion === 'revisar') {
    if (l.estado !== 'borrador') throw bad(`Esta ${l.estado}`);
    await c.query("update liquidacion_propietario set estado='revisada' where id=$1", [id]);
  } else if (accion === 'aprobar') {
    if (!['borrador', 'revisada'].includes(l.estado)) throw bad(`Esta ${l.estado}`);
    const sinResp = await c.query(
      `select count(*)::int n from movimiento m join concepto co on co.id=m.concepto_id where m.propiedad_id=$1 and m.liquidacion_id is null and m.tipo='egreso' and m.pagador='propietario'
         and m.estado<>'anulado' and co.requiere_respaldo and m.documento_id is null and m.nro_documento is null and co.categoria in ('mantencion','contribucion','seguro','gasto_propietario')`, [l.propiedad_id]);
    if (sinResp.rows[0].n) throw bad('Hay gastos sin respaldo: adjunte el documento antes de aprobar la liquidacion');
    const fm = finMes(l.periodo);
    await c.query(`update pago_aplicacion set liquidacion_id=$1 where liquidacion_id is null and cargo_id in (select id from cargo where propiedad_id=$2 and destino='propietario')
       and pago_id in (select id from pago where estado='conciliado' and fecha<=$3)`, [id, l.propiedad_id, fm]);
    await c.query(`update movimiento set liquidacion_id=$1 where liquidacion_id is null and propiedad_id=$2 and tipo='egreso' and pagador='propietario' and estado<>'anulado'
       and fecha<=$3 and concepto_id in (select id from concepto where categoria in ('mantencion','contribucion','seguro','gasto_propietario'))`, [id, l.propiedad_id, fm]);
    if (l.honorario_neto > 0) {
      await fin.crearMovimiento(c, u, { concepto_codigo: 'HONORARIO_ADMIN', monto_neto: l.honorario_neto, iva: l.honorario_iva, propiedad_id: l.propiedad_id, contrato_id: l.contrato_id,
        liquidacion_id: id, pagador: 'propietario', fondo: 'propio', estado: 'facturado', origen: 'evento', origen_ref: 'liquidacion:' + id, glosa: 'Honorario de administracion ' + l.periodo });
      await fin.crearMovimiento(c, u, { concepto_codigo: 'TRASPASO_FONDOS', tipo: 'traspaso', monto_neto: l.honorario_neto + l.honorario_iva, propiedad_id: l.propiedad_id, contrato_id: l.contrato_id,
        liquidacion_id: id, fondo: 'terceros', estado: 'pagado', origen: 'evento', origen_ref: 'liquidacion:' + id, glosa: 'Traspaso de honorario a fondos propios' });
    }
    await c.query("update liquidacion_propietario set estado='aprobada', aprobada_por=$2 where id=$1", [id, u.id]);
  } else if (accion === 'pagar') {
    if (l.estado !== 'aprobada') throw bad('Debe estar aprobada');
    if (l.neto_a_pagar > 0)
      await fin.crearMovimiento(c, u, { concepto_codigo: 'PAGO_PROPIETARIO', monto_neto: l.neto_a_pagar, propiedad_id: l.propiedad_id, contrato_id: l.contrato_id, liquidacion_id: id,
        pagador: 'propietario', fondo: 'terceros', estado: 'pagado', contraparte_persona_id: l.propietario_id, origen: 'evento', origen_ref: 'liquidacion:' + id, glosa: 'Liquidacion ' + l.periodo, aprobado_por: l.aprobada_por });
    await c.query("update liquidacion_propietario set estado='pagada', pagada_at=now() where id=$1", [id]);
  } else if (accion === 'anular') {
    if (!['borrador', 'revisada'].includes(l.estado)) throw bad('Solo se anulan liquidaciones no aprobadas');
    await c.query("update liquidacion_propietario set estado='anulada' where id=$1", [id]);
  } else throw bad('Accion invalida');
  await audit(c, u, 'liquidacion_propietario', id, accion);
  return (await c.query('select * from liquidacion_propietario where id=$1', [id])).rows[0];
}

module.exports = { crearContrato, registrarGarantia, generarCargos, crearCargoManual, anularCargo, calcularMora, registrarPago, revertirPago, estadoCuenta,
  proponerReajuste, aplicarReajuste, crearOT, accionOT, generarLiquidaciones, cambiarLiquidacion };
