// Libro de movimientos, comisiones, liquidaciones de agentes, administracion de cartera y reportes
const { makeReg, propios, toCsv } = require('../lib/route');
const { bad, notFound, forbidden, hoy, addDays, diasEntre, round0, audit, empresaParam } = require('../lib/util');
const fin = require('../services/finanzas');
const arr = require('../services/arriendos');

module.exports = async function (app) {
  const reg = makeReg(app);

  // =============== MOVIMIENTOS ===============
  reg('GET', '/api/movimientos', 'movimientos.ver', async ({ c, u, query }) =>
    (await c.query(
      `select m.*, co.nombre as concepto, co.categoria, o.codigo as operacion, p.codigo as propiedad, us.nombre as creado_por_nombre
       from movimiento m join concepto co on co.id=m.concepto_id left join operacion o on o.id=m.operacion_id left join propiedad p on p.id=m.propiedad_id left join usuario us on us.id=m.created_by
       where ($1::text is null or m.periodo=$1) and ($2::uuid is null or m.operacion_id=$2) and ($3::uuid is null or m.propiedad_id=$3) and ($4::text is null or m.estado=$4)
         and ($5::text is null or m.tipo=$5) and ($6::text is null or m.fondo=$6) and ($7::int is null or m.concepto_id=$7)
         and ($8::uuid is null or o.agente_captador_id=$8 or o.agente_vendedor_id=$8)
       order by m.fecha desc, m.created_at desc limit $9`,
      [query.periodo || null, query.operacion_id || null, query.propiedad_id || null, query.estado || null, query.tipo || null, query.fondo || null, query.concepto_id || null,
        propios(u) ? u.id : null, Math.min(Number(query.limit) || 300, 2000)])).rows);
  reg('POST', '/api/movimientos', 'movimientos.crear', async ({ c, u, body }) => fin.crearMovimiento(c, u, body));
  reg('POST', '/api/movimientos/:id/estado', 'movimientos.editar', async ({ c, u, params, body }) => fin.cambiarEstadoMovimiento(c, u, params.id, body));
  reg('POST', '/api/movimientos/:id/aprobar', 'movimientos.aprobar', async ({ c, u, params }) => fin.aprobarMovimiento(c, u, params.id));
  reg('POST', '/api/movimientos/:id/anular', 'movimientos.anular', async ({ c, u, params, body }) => fin.anularMovimiento(c, u, params.id, body.motivo));

  // =============== COMISIONES ===============
  reg('GET', '/api/comisiones', 'comisiones.ver', async ({ c, u, query }) =>
    (await c.query(`select cm.*, o.codigo, o.tipo as tipo_operacion, p.codigo as propiedad, mv.estado as ingreso_estado,
        (select json_agg(json_build_object('rol', r.rol, 'pct', r.pct, 'monto', r.monto, 'agente', ag.nombre, 'beneficiario_id', r.beneficiario_id) order by r.rol)
         from comision_reparto r left join usuario ag on ag.id=r.beneficiario_id where r.comision_id=cm.id) as reparto
      from comision cm join operacion o on o.id=cm.operacion_id join propiedad p on p.id=o.propiedad_id left join movimiento mv on mv.id=cm.movimiento_id
      where ($1::text is null or cm.estado=$1) and ($2::uuid is null or o.agente_captador_id=$2 or o.agente_vendedor_id=$2) order by cm.created_at desc limit 300`,
      [query.estado || null, propios(u) ? u.id : null])).rows);
  reg('POST', '/api/comisiones/:id/aprobar', 'comisiones.aprobar', async ({ c, u, params }) => fin.aprobarComision(c, u, params.id));
  reg('PATCH', '/api/comisiones/:id/reparto', 'comisiones.aprobar', async ({ c, u, params, body }) => { await fin.overrideReparto(c, u, params.id, body.reparto || [], body.motivo); });
  reg('GET', '/api/reglas-comision', 'comisiones.ver', async ({ c }) => (await c.query('select * from regla_comision order by tipo_operacion, vigente_desde desc')).rows);
  reg('POST', '/api/reglas-comision', 'comisiones.reglas', async ({ c, u, body }) => {
    if (!body.nombre || !['venta', 'arriendo'].includes(body.tipo_operacion) || !body.base || !body.hito_devengo) throw bad('nombre, tipo_operacion, base y hito_devengo son obligatorios');
    const suma = Object.values(body.reparto || { x: 100 }).reduce((s, v) => s + Number(v), 0);
    if (Math.abs(suma - 100) > 0.0001) throw bad(`El reparto suma ${suma}%, debe sumar 100%`);
    // nueva version: se cierra la vigente anterior del mismo tipo/hito, nunca se modifica una regla ya aplicada
    await c.query("update regla_comision set vigente_hasta=current_date-1, activa=false where tipo_operacion=$1 and hito_devengo=$2 and activa and $3", [body.tipo_operacion, body.hito_devengo, body.reemplaza !== false]);
    const r = await c.query(`insert into regla_comision (empresa_id, nombre, tipo_operacion, base, pct, meses, monto_fijo, minimo, tope, escala, afecta_iva, pagador, hito_devengo, reparto)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,
      [u.empresa_id, body.nombre, body.tipo_operacion, body.base, body.pct ?? null, body.meses ?? null, body.monto_fijo ?? null, body.minimo ?? null, body.tope ?? null,
        body.escala ? JSON.stringify(body.escala) : null, body.afecta_iva !== false, body.pagador || 'cliente', body.hito_devengo, JSON.stringify(body.reparto || { captador: 30, vendedor: 40, corredora: 30 })]);
    await audit(c, u, 'regla_comision', r.rows[0].id, 'crear', null, r.rows[0]);
    return r.rows[0];
  });

  // =============== LIQUIDACIONES DE AGENTES ===============
  reg('GET', '/api/liquidaciones-agente', 'liquidaciones.ver', async ({ c, u }) =>
    (await c.query(`select l.*, ag.nombre as agente from liquidacion_agente l join usuario ag on ag.id=l.agente_id where ($1::uuid is null or l.agente_id=$1) order by l.created_at desc limit 200`, [propios(u) ? u.id : null])).rows);
  reg('GET', '/api/liquidaciones-agente/:id', 'liquidaciones.ver', async ({ c, params }) => {
    const l = (await c.query('select l.*, ag.nombre as agente from liquidacion_agente l join usuario ag on ag.id=l.agente_id where l.id=$1', [params.id])).rows[0];
    if (!l) throw notFound();
    return { ...l, detalle: (await c.query('select * from liquidacion_agente_detalle where liquidacion_id=$1 order by id', [params.id])).rows };
  });
  reg('POST', '/api/liquidaciones-agente/generar', 'liquidaciones.crear', async ({ c, u, body }) => fin.generarLiquidacionesAgente(c, u, { periodo: body.periodo || hoy().slice(0, 7), agente_id: body.agente_id }));
  reg('POST', '/api/liquidaciones-agente/:id/aprobar', 'liquidaciones.aprobar', async ({ c, u, params }) => { await fin.aprobarLiquidacionAgente(c, u, params.id); });
  reg('POST', '/api/liquidaciones-agente/:id/pagar', 'liquidaciones.pagar', async ({ c, u, params }) => { await fin.pagarLiquidacionAgente(c, u, params.id); });

  // =============== ADMINISTRACION DE CARTERA ===============
  reg('GET', '/api/contratos', 'contratos.ver', async ({ c, query }) =>
    (await c.query(`select k.*, p.codigo as propiedad, p.direccion, pe.nombre as arrendatario,
        (select coalesce(sum(saldo_clp),0) from cargo where contrato_id=k.id and estado<>'anulado') as saldo_pendiente
      from contrato_arriendo k join propiedad p on p.id=k.propiedad_id join persona pe on pe.id=k.arrendatario_id
      where ($1::text is null or k.estado=$1) order by k.created_at desc limit 300`, [query.estado || null])).rows);
  reg('GET', '/api/contratos/:id', 'contratos.ver', async ({ c, params }) => {
    const ec = await arr.estadoCuenta(c, params.id);
    const [rj, ot] = await Promise.all([
      c.query('select * from contrato_reajuste where contrato_id=$1 order by fecha_aplicacion desc', [params.id]),
      c.query('select * from orden_trabajo where contrato_id=$1 order by fecha_solicitud desc', [params.id]),
    ]);
    return { ...ec, reajustes: rj.rows, ordenes_trabajo: ot.rows };
  });
  reg('POST', '/api/contratos/:id/garantia', 'contratos.editar', async ({ c, u, params, body }) => arr.registrarGarantia(c, u, params.id, body));
  reg('GET', '/api/contratos/:id/reajuste', 'contratos.ver', async ({ c, params }) => arr.proponerReajuste(c, params.id));
  reg('POST', '/api/contratos/:id/reajuste', 'contratos.editar', async ({ c, u, params }) => arr.aplicarReajuste(c, u, params.id));
  reg('POST', '/api/cargos/generar', 'cargos.crear', async ({ c, u, body }) => arr.generarCargos(c, u, { periodo: body.periodo || hoy().slice(0, 7), contrato_id: body.contrato_id }));
  reg('POST', '/api/cargos', 'cargos.crear', async ({ c, u, body }) => arr.crearCargoManual(c, u, body));
  reg('POST', '/api/cargos/:id/anular', 'cargos.editar', async ({ c, u, params, body }) => { await arr.anularCargo(c, u, params.id, body.motivo); });
  reg('POST', '/api/cobranza/calcular-mora', 'cargos.editar', async ({ c, u, body }) => arr.calcularMora(c, u, body));
  reg('POST', '/api/pagos', 'pagos.crear', async ({ c, u, body }) => arr.registrarPago(c, u, body));
  reg('POST', '/api/pagos/:id/revertir', 'pagos.editar', async ({ c, u, params, body }) => { await arr.revertirPago(c, u, params.id, body.motivo); });

  reg('GET', '/api/ordenes-trabajo', 'ot.ver', async ({ c, query }) =>
    (await c.query(`select ot.*, p.codigo as propiedad, p.direccion, pr.nombre as proveedor from orden_trabajo ot join propiedad p on p.id=ot.propiedad_id left join persona pr on pr.id=ot.proveedor_id
      where ($1::text is null or ot.estado=$1) order by ot.fecha_solicitud desc limit 300`, [query.estado || null])).rows);
  reg('POST', '/api/ordenes-trabajo', 'ot.crear', async ({ c, u, body }) => arr.crearOT(c, u, body));
  reg('POST', '/api/ordenes-trabajo/:id/:accion', 'ot.editar', async ({ c, u, params, body }) => {
    if (params.accion === 'aprobar' && !(u.permisos.includes('*') || u.permisos.includes('ot.aprobar'))) throw forbidden('Sin permiso (ot.aprobar)');
    return arr.accionOT(c, u, params.id, params.accion, body);
  });

  reg('GET', '/api/liquidaciones-propietario', 'liquidaciones.ver', async ({ c, query }) =>
    (await c.query(`select l.*, p.codigo as propiedad, p.direccion, pe.nombre as propietario from liquidacion_propietario l join propiedad p on p.id=l.propiedad_id join persona pe on pe.id=l.propietario_id
      where ($1::text is null or l.periodo=$1) and ($2::text is null or l.estado=$2) order by l.periodo desc, p.codigo limit 300`, [query.periodo || null, query.estado || null])).rows);
  reg('GET', '/api/liquidaciones-propietario/:id', 'liquidaciones.ver', async ({ c, params }) => {
    const l = (await c.query(`select l.*, p.codigo as propiedad, p.direccion, pe.nombre as propietario from liquidacion_propietario l join propiedad p on p.id=l.propiedad_id join persona pe on pe.id=l.propietario_id where l.id=$1`, [params.id])).rows[0];
    if (!l) throw notFound();
    return { ...l, detalle: (await c.query('select * from liquidacion_propietario_detalle where liquidacion_id=$1 order by id', [params.id])).rows };
  });
  reg('POST', '/api/liquidaciones-propietario/generar', 'liquidaciones.crear', async ({ c, u, body }) => arr.generarLiquidaciones(c, u, { periodo: body.periodo || hoy().slice(0, 7), propiedad_id: body.propiedad_id }));
  reg('POST', '/api/liquidaciones-propietario/:id/:accion', 'liquidaciones.editar', async ({ c, u, params }) => {
    const need = { aprobar: 'liquidaciones.aprobar', pagar: 'liquidaciones.pagar' }[params.accion];
    if (need && !(u.permisos.includes('*') || u.permisos.includes(need) || u.permisos.includes('liquidaciones.*'))) throw forbidden(`Sin permiso (${need})`);
    return arr.cambiarLiquidacion(c, u, params.id, params.accion);
  });
  reg('GET', '/api/cuenta-corriente/:persona_id', 'liquidaciones.ver', async ({ c, params }) =>
    (await c.query(`select l.periodo, p.codigo as propiedad, l.ingresos, l.honorario_neto + l.honorario_iva as honorario, l.gastos, l.neto_a_pagar, l.estado
      from liquidacion_propietario l join propiedad p on p.id=l.propiedad_id where l.propietario_id=$1 and l.estado<>'anulada' order by l.periodo desc`, [params.persona_id])).rows);

  // =============== REPORTES ===============
  const rep = (nombre, perm, fn) => reg('GET', `/api/reportes/${nombre}`, perm || 'reportes.ver', async ({ c, u, query, reply }) => {
    const out = await fn({ c, u, query });
    if (query.formato === 'csv') { reply.type('text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${nombre}.csv"`); return toCsv(Array.isArray(out) ? out : (out.filas || [])); }
    return out;
  });
  const rango = q => [q.desde || '1900-01-01', q.hasta || '2999-12-31'];

  rep('dashboard', 'reportes.ver', async ({ c, u }) => {
    const mes = hoy().slice(0, 7);
    const q1 = async (sql, p = []) => (await c.query(sql, p)).rows[0];
    const prop = await q1(`select count(*) filter (where estado='publicada')::int publicadas, count(*) filter (where estado in ('captada','publicada'))::int cartera,
      count(*) filter (where estado='arrendada')::int arrendadas, count(*) filter (where estado='vendida')::int vendidas from propiedad where deleted_at is null`);
    const leads = await q1(`select count(*) filter (where estado='nuevo')::int nuevos, count(*) filter (where estado not in ('ganado','perdido'))::int abiertos,
      count(*) filter (where created_at>=date_trunc('month',now()))::int del_mes from lead`);
    const opa = await q1(`select count(*) filter (where tipo='venta' and estado not in ('cerrada','caida'))::int ventas_abiertas, count(*) filter (where tipo='arriendo' and estado not in ('cerrada','caida','rechazada'))::int arriendos_abiertos from operacion`);
    const cobr = await q1(`select coalesce(sum(monto_clp) filter (where periodo=$1),0) as cobrado_mes from movimiento where concepto_id=(select id from concepto where codigo='COBRO_ARRIENDO') and estado='pagado'`, [mes]);
    const fact = await q1(`select coalesce(sum(monto_clp) filter (where periodo=$1),0) facturado_mes, coalesce(sum(saldo_clp) filter (where estado in ('vencido') ),0) vencido, coalesce(sum(saldo_clp),0) pendiente from cargo where estado<>'anulado'`, [mes]);
    const com = await q1(`select coalesce(sum(neto_clp) filter (where tipo='ingreso' and fondo='propio' and periodo=$1),0) ingresos_mes, coalesce(sum(neto_clp) filter (where tipo='egreso' and fondo='propio' and pagador='corredora' and periodo=$1),0) costos_mes
      from movimiento where estado<>'anulado'`, [mes]);
    const cp = await q1(`select count(*)::int n, coalesce(sum(cm.monto_neto),0) monto from comision cm where cm.estado='devengada'`);
    const contr = await q1(`select count(*) filter (where estado in ('firmado','vigente'))::int vigentes from contrato_arriendo`);
    const ot = await q1(`select count(*) filter (where estado in ('solicitada','pendiente_aprobacion','aprobada','en_ejecucion'))::int abiertas, count(*) filter (where estado='pendiente_aprobacion')::int por_aprobar from orden_trabajo`);
    const mov = await q1(`select count(*) filter (where requiere_aprobacion and aprobado_por is null and estado<>'anulado')::int por_aprobar from movimiento`);
    return { periodo: mes, propiedades: prop, leads, operaciones: opa, arriendos: { ...cobr, ...fact, contratos_vigentes: contr.vigentes, morosidad_pct: fact.facturado_mes ? Math.round(fact.vencido / Math.max(fact.facturado_mes, 1) * 1000) / 10 : 0 },
      finanzas: { ...com, utilidad_bruta_mes: com.ingresos_mes - com.costos_mes, comisiones_por_cobrar_o_pagar: cp }, mantenciones: ot, movimientos_por_aprobar: mov.por_aprobar };
  });
  rep('resultado-operaciones', 'reportes.ver', async ({ c, u, query }) => {
    const [d, h] = rango(query);
    const rows = (await c.query(
      `select o.codigo, o.tipo, o.estado, p.codigo as propiedad, ag.nombre as agente, o.abierta_at::date as abierta,
         coalesce((select sum(neto_clp) from movimiento m where m.operacion_id=o.id and m.tipo='ingreso' and m.fondo='propio' and m.estado<>'anulado'),0) as ingresos,
         coalesce((select sum(m.neto_clp) from movimiento m join concepto co on co.id=m.concepto_id where m.operacion_id=o.id and m.tipo='egreso' and m.fondo='propio' and m.pagador='corredora' and co.categoria<>'comision_agente' and m.estado<>'anulado'),0) as costos,
         coalesce((select sum(r.monto) from comision cm join comision_reparto r on r.comision_id=cm.id where cm.operacion_id=o.id and cm.estado<>'anulada' and r.beneficiario_id is not null and r.rol in ('captador','vendedor','referido')),0) as comisiones_agentes
       from operacion o join propiedad p on p.id=o.propiedad_id left join usuario ag on ag.id=o.agente_vendedor_id
       where o.abierta_at::date between $1 and $2 and ($3::uuid is null or o.agente_captador_id=$3 or o.agente_vendedor_id=$3) order by o.abierta_at desc`, [d, h, propios(u) ? u.id : null])).rows;
    return rows.map(r => ({ ...r, utilidad: r.ingresos - r.costos - r.comisiones_agentes, margen_pct: r.ingresos ? Math.round((r.ingresos - r.costos - r.comisiones_agentes) / r.ingresos * 1000) / 10 : null }));
  });
  rep('rentabilidad', 'reportes.ver', async ({ c, u, query }) => {
    const por = ['agente', 'tipo'].includes(query.por) ? query.por : 'agente';
    const rows = (await c.query(
      `select ${por === 'agente' ? "coalesce(ag.nombre,'(sin agente)')" : 'o.tipo'} as grupo, count(*)::int operaciones,
         coalesce(sum((select sum(neto_clp) from movimiento m where m.operacion_id=o.id and m.tipo='ingreso' and m.fondo='propio' and m.estado<>'anulado')),0) ingresos,
         coalesce(sum((select sum(m.neto_clp) from movimiento m join concepto co on co.id=m.concepto_id where m.operacion_id=o.id and m.tipo='egreso' and m.fondo='propio' and m.pagador='corredora' and co.categoria<>'comision_agente' and m.estado<>'anulado')),0) costos,
         coalesce(sum((select sum(r.monto) from comision cm join comision_reparto r on r.comision_id=cm.id where cm.operacion_id=o.id and cm.estado<>'anulada' and r.beneficiario_id is not null and r.rol in ('captador','vendedor','referido'))),0) comisiones_agentes
       from operacion o left join usuario ag on ag.id=o.agente_vendedor_id where o.estado<>'caida' group by 1 order by 1`)).rows;
    return rows.map(r => ({ ...r, utilidad: r.ingresos - r.costos - r.comisiones_agentes }));
  });
  rep('comisiones', 'comisiones.ver', async ({ c }) =>
    (await c.query(`select o.codigo, cm.hito, cm.estado, cm.monto_neto, cm.iva, mv.estado as cobro_cliente,
       (select string_agg(ag.nombre||': '||r.monto, ' | ') from comision_reparto r left join usuario ag on ag.id=r.beneficiario_id where r.comision_id=cm.id) as reparto
      from comision cm join operacion o on o.id=cm.operacion_id left join movimiento mv on mv.id=cm.movimiento_id order by cm.created_at desc`)).rows);
  rep('morosidad', 'reportes.ver', async ({ c, query }) => {
    const fecha = query.fecha || hoy();
    const rows = (await c.query(
      `select pe.nombre as arrendatario, p.codigo as propiedad, k.id as contrato_id,
         sum(cg.saldo_clp) filter (where $1::date - cg.vencimiento between 1 and 30)::numeric as d1_30,
         sum(cg.saldo_clp) filter (where $1::date - cg.vencimiento between 31 and 60)::numeric as d31_60,
         sum(cg.saldo_clp) filter (where $1::date - cg.vencimiento between 61 and 90)::numeric as d61_90,
         sum(cg.saldo_clp) filter (where $1::date - cg.vencimiento > 90)::numeric as d90_mas,
         sum(cg.saldo_clp) filter (where cg.vencimiento >= $1::date)::numeric as por_vencer, sum(cg.saldo_clp)::numeric as total
       from cargo cg join contrato_arriendo k on k.id=cg.contrato_id join persona pe on pe.id=cg.arrendatario_id join propiedad p on p.id=cg.propiedad_id
       where cg.estado in ('pendiente','parcial','vencido') and cg.saldo_clp>0 group by pe.nombre, p.codigo, k.id order by total desc`, [fecha])).rows;
    return rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === null ? 0 : v])));
  });
  rep('cartera', 'reportes.ver', async ({ c }) => {
    const rows = (await c.query(
      `select p.codigo, p.direccion, p.estado, pe.nombre as arrendatario, k.canon_vigente, k.canon_moneda, k.fecha_termino, k.proximo_reajuste, k.estado as contrato,
         coalesce((select sum(saldo_clp) from cargo where contrato_id=k.id and estado in ('pendiente','parcial','vencido')),0) as saldo
       from propiedad p left join contrato_arriendo k on k.propiedad_id=p.id and k.estado in ('firmado','vigente') left join persona pe on pe.id=k.arrendatario_id
       where p.deleted_at is null and (k.id is not null or p.estado in ('arrendada')) order by p.codigo`)).rows;
    return rows;
  });
  rep('flujo-caja', 'reportes.ver', async ({ c }) => {
    const cobros = (await c.query(`select date_trunc('week', vencimiento)::date as semana, sum(saldo_clp)::numeric as cobros from cargo where estado in ('pendiente','parcial','vencido') and saldo_clp>0 group by 1 order by 1`)).rows;
    const pagos = (await c.query(`select date_trunc('week', fecha)::date as semana, sum(monto_clp)::numeric as pagos from movimiento where tipo='egreso' and estado in ('provisionado','facturado') group by 1 order by 1`)).rows;
    const m = new Map();
    cobros.forEach(r => m.set(r.semana, { semana: r.semana, cobros: r.cobros, pagos: 0 }));
    pagos.forEach(r => m.set(r.semana, { ...(m.get(r.semana) || { semana: r.semana, cobros: 0 }), pagos: r.pagos }));
    return [...m.values()].sort((a, b) => String(a.semana).localeCompare(String(b.semana))).map(r => ({ ...r, neto: r.cobros - r.pagos }));
  });
  rep('control-movimientos', 'reportes.ver', async ({ c }) =>
    (await c.query(`select m.fecha, co.nombre as concepto, m.tipo, m.monto_clp, m.estado, case
        when m.requiere_aprobacion and m.aprobado_por is null then 'Pendiente de aprobacion'
        when m.tipo='egreso' and m.documento_id is null and m.nro_documento is null then 'Sin respaldo'
        when m.estado in ('provisionado','facturado') and m.fecha < current_date - 30 then 'Provisionado hace mas de 30 dias' end as alerta, m.glosa
      from movimiento m join concepto co on co.id=m.concepto_id where m.estado<>'anulado' and (
        (m.requiere_aprobacion and m.aprobado_por is null) or (m.tipo='egreso' and m.documento_id is null and m.nro_documento is null) or (m.estado in ('provisionado','facturado') and m.fecha < current_date - 30))
      order by m.fecha desc limit 500`)).rows);
  rep('libro-iva', 'reportes.ver', async ({ c, query }) => {
    const rows = (await c.query(`select periodo, sum(iva_clp) filter (where tipo='ingreso' and estado<>'anulado' and fondo='propio') as iva_debito,
        sum(iva_clp) filter (where tipo='egreso' and estado<>'anulado') as iva_credito,
        sum(neto_clp) filter (where tipo='ingreso' and estado<>'anulado' and fondo='propio') as ventas_netas, sum(neto_clp) filter (where tipo='egreso' and estado<>'anulado' and fondo='propio') as compras_netas
      from movimiento where ($1::text is null or periodo=$1) group by periodo order by periodo desc`, [query.periodo || null])).rows;
    return rows.map(r => ({ ...r, iva_debito: r.iva_debito || 0, iva_credito: r.iva_credito || 0, iva_a_pagar: (r.iva_debito || 0) - (r.iva_credito || 0), ventas_netas: r.ventas_netas || 0, compras_netas: r.compras_netas || 0 }));
  });
  rep('publicaciones', 'reportes.ver', async ({ c }) =>
    (await c.query(`select ca.nombre as canal, count(pu.*)::int publicaciones, count(*) filter (where pu.estado='publicada')::int activas, coalesce(sum(pu.costo),0) as costo_total,
        (select count(*)::int from lead l join publicacion x on x.id=l.publicacion_id where x.canal_id=ca.id) as leads,
        case when (select count(*) from lead l join publicacion x on x.id=l.publicacion_id where x.canal_id=ca.id)>0
          then round(coalesce(sum(pu.costo),0)/(select count(*) from lead l join publicacion x on x.id=l.publicacion_id where x.canal_id=ca.id)) end as costo_por_lead
       from catalogo ca left join publicacion pu on pu.canal_id=ca.id where ca.grupo='canal' group by ca.id, ca.nombre order by ca.nombre`)).rows);
  rep('leads-embudo', 'reportes.ver', async ({ c }) =>
    (await c.query(`select f.nombre as fuente, count(*)::int leads, count(*) filter (where l.estado in ('visita','oferta','ganado'))::int con_visita, count(*) filter (where l.estado='ganado')::int ganados,
      round(avg(extract(epoch from (l.primer_contacto_at - l.asignado_at))/60)::numeric,1) as min_primera_respuesta from lead l left join catalogo f on f.id=l.fuente_id group by f.nombre order by leads desc`)).rows);
};
