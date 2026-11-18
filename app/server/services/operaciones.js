// Operaciones de venta y arriendo: maquina de estados, efectos sobre propiedad/publicaciones y devengo de comisiones.
const { bad, notFound, nextSeq, audit, empresaParam, hoy } = require('../lib/util');
const fin = require('./finanzas');
const arr = require('./arriendos');

const FLUJOS = {
  venta: {
    inicial: 'oferta',
    sig: { oferta: ['reserva', 'caida'], reserva: ['promesa', 'escritura', 'caida'], promesa: ['escritura', 'caida'],
      escritura: ['inscripcion'], inscripcion: ['entregada'], entregada: ['cerrada'], cerrada: [], caida: [] },
  },
  arriendo: {
    inicial: 'postulacion',
    sig: { postulacion: ['aprobada', 'rechazada'], aprobada: ['contrato_firmado', 'caida'], contrato_firmado: ['vigente'],
      vigente: ['termino'], termino: ['cerrada'], cerrada: [], rechazada: [], caida: [] },
  },
};

async function crear(c, u, d) {
  const tipo = d.tipo;
  if (!FLUJOS[tipo]) throw bad('tipo debe ser venta o arriendo');
  const prop = (await c.query('select * from propiedad where id=$1 and deleted_at is null', [d.propiedad_id])).rows[0];
  if (!prop) throw notFound('Propiedad no encontrada');
  if (['vendida', 'arrendada', 'retirada'].includes(prop.estado)) throw bad(`La propiedad esta ${prop.estado}`);
  const par = await empresaParam(c, u.empresa_id);
  if (par.exigir_mandato !== false) {
    const m = await c.query(`select 1 from mandato where propiedad_id=$1 and tipo=$2 and estado='vigente' and fecha_inicio<=current_date and fecha_fin>=current_date`, [prop.id, tipo]);
    if (!m.rows[0]) throw bad(`La propiedad no tiene un mandato de ${tipo} vigente`);
  }
  const abierta = await c.query(`select codigo from operacion where propiedad_id=$1 and tipo=$2 and estado not in ('cerrada','caida','rechazada')`, [prop.id, tipo]);
  if (abierta.rows[0]) throw bad(`Ya existe una operacion de ${tipo} abierta (${abierta.rows[0].codigo}) para la propiedad`);
  const precio = d.precio ?? (tipo === 'venta' ? prop.precio_venta : prop.precio_arriendo);
  const moneda = d.moneda || (tipo === 'venta' ? prop.moneda_venta : prop.moneda_arriendo) || 'CLP';
  if (!(precio > 0)) throw bad('Indique un precio mayor a cero');
  const n = await nextSeq(c, u.empresa_id, 'op-' + tipo);
  const codigo = `${tipo === 'venta' ? 'V' : 'A'}-${new Date().getFullYear()}-${String(n).padStart(5, '0')}`;
  const r = (await c.query(
    `insert into operacion (empresa_id, codigo, tipo, propiedad_id, lead_id, cliente_id, agente_captador_id, agente_vendedor_id, estado, precio, moneda, detalle)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
    [u.empresa_id, codigo, tipo, prop.id, d.lead_id || null, d.cliente_id || null, prop.agente_captador_id,
      d.agente_vendedor_id || (u.es_agente ? u.id : prop.agente_captador_id), FLUJOS[tipo].inicial, precio, moneda, d.detalle || {}])).rows[0];
  await c.query('insert into operacion_historial (empresa_id, operacion_id, estado_hacia, usuario_id) values ($1,$2,$3,$4)', [u.empresa_id, r.id, r.estado, u.id]);
  await audit(c, u, 'operacion', r.id, 'crear', null, { codigo, tipo });
  return r;
}

async function avanzar(c, u, id, { estado_hacia, motivo, precio_cierre }) {
  const op = (await c.query('select * from operacion where id=$1 for update', [id])).rows[0];
  if (!op) throw notFound('Operacion no encontrada');
  const flujo = FLUJOS[op.tipo];
  const permitidos = flujo.sig[op.estado] || [];
  if (!permitidos.includes(estado_hacia)) throw bad(`Transicion no permitida: ${op.estado} -> ${estado_hacia}. Permitidas: ${permitidos.join(', ') || 'ninguna'}`);
  if (['caida', 'rechazada'].includes(estado_hacia) && !motivo) throw bad('Indique el motivo');
  if (op.tipo === 'arriendo' && estado_hacia === 'contrato_firmado') {
    const k = await c.query("select 1 from contrato_arriendo where operacion_id=$1 and estado='borrador'", [id]);
    if (!k.rows[0]) throw bad('Cree el contrato de arriendo (borrador) antes de marcarlo firmado');
  }
  if (op.tipo === 'venta' && estado_hacia === 'escritura' && !op.cliente_id) throw bad('Asigne el comprador a la operacion antes de la escritura');
  if (precio_cierre && ['reserva', 'promesa', 'escritura'].includes(estado_hacia)) {
    await c.query('update operacion set precio=$2 where id=$1', [id, precio_cierre]); op.precio = precio_cierre;
  }
  const cerrada = ['cerrada', 'caida', 'rechazada'].includes(estado_hacia);
  const up = (await c.query(
    `update operacion set estado=$2, caida_motivo=$3, cerrada_at=case when $4 then now() else cerrada_at end where id=$1 returning *`,
    [id, estado_hacia, ['caida', 'rechazada'].includes(estado_hacia) ? motivo : null, cerrada])).rows[0];
  await c.query('insert into operacion_historial (empresa_id, operacion_id, estado_desde, estado_hacia, motivo, usuario_id) values ($1,$2,$3,$4,$5,$6)',
    [u.empresa_id, id, op.estado, estado_hacia, motivo || null, u.id]);

  // --- efectos sobre propiedad y publicaciones ---
  const setProp = async (estado, motivoH) => {
    const p = (await c.query('select estado from propiedad where id=$1', [op.propiedad_id])).rows[0];
    if (p.estado !== estado) {
      await c.query('update propiedad set estado=$2 where id=$1', [op.propiedad_id, estado]);
      await c.query("insert into propiedad_historial (empresa_id, propiedad_id, tipo, anterior, nuevo, motivo, usuario_id) values ($1,$2,'estado',$3,$4,$5,$6)",
        [u.empresa_id, op.propiedad_id, p.estado, estado, motivoH, u.id]);
    }
  };
  const pubs = async (estado, desde) => c.query('update publicacion set estado=$2 where propiedad_id=$1 and operacion=$3 and estado = any($4)',
    [op.propiedad_id, estado, op.tipo, desde]);
  if (op.tipo === 'venta') {
    if (estado_hacia === 'reserva') { await setProp('reservada', 'Reserva ' + op.codigo); await pubs('pausada', ['publicada']); }
    if (estado_hacia === 'cerrada') { await setProp('vendida', 'Cierre ' + op.codigo); await pubs('retirada', ['publicada', 'pausada', 'pendiente']); }
  } else {
    if (estado_hacia === 'contrato_firmado') {
      await setProp('arrendada', 'Contrato firmado ' + op.codigo); await pubs('retirada', ['publicada', 'pausada', 'pendiente']);
      const kf = (await c.query("update contrato_arriendo set estado='firmado' where operacion_id=$1 and estado='borrador' returning id, fecha_inicio", [id])).rows[0];
      if (kf) await arr.generarCargos(c, u, { periodo: kf.fecha_inicio.slice(0, 7), contrato_id: kf.id });
    }
    if (estado_hacia === 'vigente') await c.query("update contrato_arriendo set estado='vigente' where operacion_id=$1 and estado='firmado'", [id]);
    if (estado_hacia === 'termino') await c.query("update contrato_arriendo set estado='terminado' where operacion_id=$1 and estado in ('firmado','vigente')", [id]);
    if (estado_hacia === 'cerrada') {
      await c.query("update contrato_arriendo set estado='cerrado' where operacion_id=$1", [id]);
      await setProp('publicada', 'Termino de arriendo ' + op.codigo);
    }
  }
  if (estado_hacia === 'caida') {
    await fin.anularComisionesOperacion(c, u, id, motivo);
    const p = (await c.query('select estado from propiedad where id=$1', [op.propiedad_id])).rows[0];
    if (p.estado === 'reservada') {
      const m = await c.query(`select 1 from mandato where propiedad_id=$1 and tipo=$2 and estado='vigente' and fecha_fin>=current_date`, [op.propiedad_id, op.tipo]);
      await setProp(m.rows[0] ? 'publicada' : 'captada', 'Caida ' + op.codigo);
      await c.query("update publicacion set estado='publicada' where propiedad_id=$1 and estado='pausada'", [op.propiedad_id]);
    }
  }
  // --- hito de devengo de comision ---
  const com = await fin.devengarComision(c, u, up, estado_hacia);
  await audit(c, u, 'operacion', id, 'avanzar', { estado: op.estado }, { estado: estado_hacia, comision: com ? com.id : null });
  return { operacion: up, comision_devengada: com };
}

module.exports = { FLUJOS, crear, avanzar };
