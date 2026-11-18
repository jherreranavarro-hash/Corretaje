// Propiedades, personas, CRM, publicaciones, operaciones y documentos
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { makeReg, propios } = require('../lib/route');
const { bad, notFound, forbidden, validarRut, normalizarRut, nextSeq, audit, empresaParam, hoy, round0 } = require('../lib/util');
const fin = require('../services/finanzas');
const ops = require('../services/operaciones');
const arr = require('../services/arriendos');

const UPLOADS = path.join(__dirname, '../../uploads');

// --------- completitud y publicable ---------
async function completitud(c, id) {
  const p = (await c.query('select * from propiedad where id=$1', [id])).rows[0];
  if (!p) return 0;
  const basicos = [p.tipo_id, p.comuna_id, p.direccion, p.rol_sii, p.sup_util, p.dormitorios, p.banos].filter(v => v !== null && v !== undefined && v !== '').length;
  const fotos = Math.min(1, (p.fotos || []).length / 5);
  const desc = (p.descripcion || '').length >= 40 ? 10 : 0;
  const docs = (await c.query("select 1 from documento where entidad='propiedad' and entidad_id=$1 limit 1", [id])).rows[0] ? 20 : 0;
  const m = (await c.query("select 1 from mandato where propiedad_id=$1 and estado='vigente' and fecha_fin>=current_date limit 1", [id])).rows[0] ? 15 : 0;
  const score = Math.round(30 * basicos / 7 + 25 * fotos + desc + docs + m);
  await c.query('update propiedad set completitud=$2 where id=$1', [id, score]);
  return score;
}
async function publicable(c, u, id, operacion) {
  const par = await empresaParam(c, u.empresa_id);
  const p = (await c.query('select * from propiedad where id=$1 and deleted_at is null', [id])).rows[0];
  if (!p) throw notFound('Propiedad no encontrada');
  const f = [];
  const comp = await completitud(c, id);
  if (comp < (par.completitud_minima ?? 50)) f.push(`Completitud ${comp}% (minimo ${par.completitud_minima ?? 50}%)`);
  if ((p.fotos || []).length < (par.min_fotos ?? 1)) f.push(`Se requieren al menos ${par.min_fotos ?? 1} foto(s)`);
  if (!p.direccion || !p.comuna_id) f.push('Falta direccion o comuna');
  const dom = (await c.query('select coalesce(sum(porcentaje),0) s from propiedad_propietario where propiedad_id=$1', [id])).rows[0].s;
  if (Math.abs(dom - 100) > 0.001) f.push(`El dominio de los propietarios suma ${dom}% (debe ser 100%)`);
  const tipos = operacion ? [operacion] : ['venta', 'arriendo'];
  const m = (await c.query("select tipo from mandato where propiedad_id=$1 and estado='vigente' and fecha_inicio<=current_date and fecha_fin>=current_date and tipo=any($2)", [id, tipos])).rows;
  if (par.exigir_mandato !== false && !m.length) f.push('No hay mandato vigente' + (operacion ? ` de ${operacion}` : ''));
  if (operacion === 'venta' && !(p.precio_venta > 0)) f.push('Falta precio de venta');
  if (operacion === 'arriendo' && !(p.precio_arriendo > 0)) f.push('Falta precio de arriendo');
  return { ok: f.length === 0, faltantes: f, completitud: comp };
}

async function asignarAgente(c, empresaId) {
  const r = await c.query(`select u.id from usuario u where u.empresa_id=$1 and u.es_agente and u.activo
    order by (select max(asignado_at) from lead l where l.agente_id=u.id) nulls first, u.nombre limit 1`, [empresaId]);
  return r.rows[0] ? r.rows[0].id : null;
}
async function crearLead(c, empresaId, u, b) {
  let personaId = b.persona_id;
  if (!personaId) {
    if (!b.nombre || !(b.email || b.telefono)) throw bad('Nombre y email o telefono son obligatorios');
    if (b.rut && !validarRut(b.rut)) throw bad('RUT invalido');
    const ex = (await c.query('select id from persona where deleted_at is null and ((email is not null and lower(email)=lower($1)) or (telefono is not null and telefono=$2) or (rut is not null and rut=$3))',
      [b.email || '', b.telefono || '', b.rut ? normalizarRut(b.rut) : ''])).rows[0];
    personaId = ex ? ex.id : (await c.query('insert into persona (empresa_id, nombre, email, telefono, rut, roles, consentimiento_datos_at) values ($1,$2,$3,$4,$5,$6,$7) returning id',
      [empresaId, b.nombre, b.email || null, b.telefono || null, b.rut ? normalizarRut(b.rut) : null, ['comprador'], b.consentimiento ? new Date() : null])).rows[0].id;
  }
  const prop = b.propiedad_id ? (await c.query('select agente_captador_id from propiedad where id=$1', [b.propiedad_id])).rows[0] : null;
  const agente = b.agente_id || (prop && prop.agente_captador_id) || (await asignarAgente(c, empresaId));
  const r = (await c.query(`insert into lead (empresa_id, persona_id, propiedad_id, fuente_id, publicacion_id, interes, mensaje, agente_id, asignado_at, presupuesto_max, moneda)
    values ($1,$2,$3,$4,$5,$6,$7,$8,now(),$9,$10) returning *`,
    [empresaId, personaId, b.propiedad_id || null, b.fuente_id || null, b.publicacion_id || null, b.interes || 'comprar', b.mensaje || null, agente, b.presupuesto_max || null, b.moneda || 'CLP'])).rows[0];
  if (b.mensaje) await c.query("insert into interaccion (empresa_id, persona_id, lead_id, tipo, detalle) values ($1,$2,$3,'sistema',$4)", [empresaId, personaId, r.id, 'Consulta: ' + b.mensaje]);
  return r;
}

const TRANS_PROP = { borrador: ['captada'], captada: ['publicada', 'retirada'], publicada: ['captada', 'retirada'], retirada: ['captada'] };

module.exports = async function (app) {
  const reg = makeReg(app);

  // =============== PERSONAS ===============
  reg('GET', '/api/personas', 'personas.ver', async ({ c, query }) =>
    (await c.query(`select * from persona where deleted_at is null and ($1::text is null or nombre ilike '%'||$1||'%' or rut ilike '%'||$1||'%' or email ilike '%'||$1||'%')
      and ($2::text is null or $2=any(roles)) order by nombre limit 300`, [query.q || null, query.rol || null])).rows);
  reg('GET', '/api/personas/:id', 'personas.ver', async ({ c, params }) => {
    const p = (await c.query('select * from persona where id=$1 and deleted_at is null', [params.id])).rows[0];
    if (!p) throw notFound();
    const [props, leads, inter, oper] = await Promise.all([
      c.query('select pr.id, pr.codigo, pr.direccion, pp.porcentaje from propiedad_propietario pp join propiedad pr on pr.id=pp.propiedad_id where pp.persona_id=$1', [p.id]),
      c.query('select l.id, l.estado, l.interes, l.created_at, pr.codigo from lead l left join propiedad pr on pr.id=l.propiedad_id where l.persona_id=$1 order by l.created_at desc', [p.id]),
      c.query('select * from interaccion where persona_id=$1 order by at desc limit 50', [p.id]),
      c.query('select id, codigo, tipo, estado from operacion where cliente_id=$1', [p.id]),
    ]);
    return { ...p, propiedades: props.rows, leads: leads.rows, interacciones: inter.rows, operaciones: oper.rows };
  });
  const validaPersona = b => {
    if (b.rut) { if (!validarRut(b.rut)) throw bad('RUT invalido (digito verificador)'); b.rut = normalizarRut(b.rut); }
    if (b.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email)) throw bad('Email invalido');
  };
  reg('POST', '/api/personas', 'personas.crear', async ({ c, u, body }) => {
    if (!body.nombre) throw bad('El nombre es obligatorio');
    validaPersona(body);
    const r = await c.query(`insert into persona (empresa_id, tipo, rut, nombre, email, telefono, roles, notas, consentimiento_datos_at, agente_responsable_id)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
      [u.empresa_id, body.tipo || 'natural', body.rut || null, body.nombre, body.email || null, body.telefono || null, body.roles || [], body.notas || null,
        body.consentimiento ? new Date() : null, u.es_agente ? u.id : null]);
    await audit(c, u, 'persona', r.rows[0].id, 'crear', null, { nombre: body.nombre });
    return r.rows[0];
  });
  reg('PATCH', '/api/personas/:id', 'personas.editar', async ({ c, u, params, body }) => {
    validaPersona(body);
    const a = (await c.query('select * from persona where id=$1', [params.id])).rows[0];
    if (!a) throw notFound();
    const r = await c.query(`update persona set nombre=coalesce($2,nombre), rut=coalesce($3,rut), email=coalesce($4,email), telefono=coalesce($5,telefono), roles=coalesce($6,roles),
      notas=coalesce($7,notas), no_contactar=coalesce($8,no_contactar), tipo=coalesce($9,tipo) where id=$1 returning *`,
      [a.id, body.nombre, body.rut, body.email, body.telefono, body.roles, body.notas, body.no_contactar, body.tipo]);
    await audit(c, u, 'persona', a.id, 'editar', a, r.rows[0]);
    return r.rows[0];
  });
  reg('POST', '/api/personas/:id/fusionar', 'personas.editar', async ({ c, u, params, body }) => {
    if (!body.destino_id || body.destino_id === params.id) throw bad('Indique una persona destino distinta');
    for (const [t, col] of [['propiedad_propietario', 'persona_id'], ['lead', 'persona_id'], ['interaccion', 'persona_id'], ['visita', 'persona_id'], ['operacion', 'cliente_id'],
      ['contrato_arriendo', 'arrendatario_id'], ['cargo', 'arrendatario_id'], ['pago', 'arrendatario_id'], ['liquidacion_propietario', 'propietario_id']]) {
      if (t === 'propiedad_propietario') {
        await c.query('delete from propiedad_propietario where persona_id=$1 and propiedad_id in (select propiedad_id from propiedad_propietario where persona_id=$2)', [params.id, body.destino_id]);
      }
      await c.query(`update ${t} set ${col}=$2 where ${col}=$1`, [params.id, body.destino_id]);
    }
    await c.query('update persona set deleted_at=now() where id=$1', [params.id]);
    await audit(c, u, 'persona', params.id, 'fusionar', null, { destino: body.destino_id });
    return { fusionada_en: body.destino_id };
  });

  // =============== PROPIEDADES ===============
  reg('GET', '/api/propiedades', 'propiedades.ver', async ({ c, u, query }) => {
    const r = await c.query(
      `select p.*, t.nombre as tipo, cm.nombre as comuna, ag.nombre as agente,
         (select string_agg(pe.nombre, ', ') from propiedad_propietario pp join persona pe on pe.id=pp.persona_id where pp.propiedad_id=p.id) as propietarios,
         (select count(*)::int from mandato m where m.propiedad_id=p.id and m.estado='vigente' and m.fecha_fin>=current_date) as mandatos_vigentes
       from propiedad p left join catalogo t on t.id=p.tipo_id left join catalogo cm on cm.id=p.comuna_id left join usuario ag on ag.id=p.agente_captador_id
       where p.deleted_at is null and ($1::text is null or p.estado=$1) and ($2::int is null or p.comuna_id=$2) and ($3::int is null or p.tipo_id=$3)
         and ($4::text is null or p.codigo ilike '%'||$4||'%' or p.direccion ilike '%'||$4||'%')
         and ($5::uuid is null or p.agente_captador_id=$5)
       order by p.created_at desc limit 500`,
      [query.estado || null, query.comuna_id || null, query.tipo_id || null, query.q || null, propios(u) ? u.id : (query.agente_id || null)]);
    return r.rows;
  });
  reg('GET', '/api/propiedades/:id', 'propiedades.ver', async ({ c, u, params }) => {
    const p = (await c.query(`select p.*, t.nombre as tipo, cm.nombre as comuna from propiedad p left join catalogo t on t.id=p.tipo_id left join catalogo cm on cm.id=p.comuna_id
      where p.id=$1 and p.deleted_at is null`, [params.id])).rows[0];
    if (!p) throw notFound();
    if (propios(u) && p.agente_captador_id !== u.id) throw forbidden();
    const [prop, man, hist, pubs, ops_, movs] = await Promise.all([
      c.query('select pp.*, pe.nombre, pe.rut, pe.email, pe.telefono from propiedad_propietario pp join persona pe on pe.id=pp.persona_id where pp.propiedad_id=$1 order by pp.principal desc', [p.id]),
      c.query('select * from mandato where propiedad_id=$1 order by fecha_inicio desc', [p.id]),
      c.query('select h.*, us.nombre as usuario from propiedad_historial h left join usuario us on us.id=h.usuario_id where h.propiedad_id=$1 order by h.at desc limit 50', [p.id]),
      c.query('select pu.*, ca.nombre as canal, ca.datos as canal_datos from publicacion pu join catalogo ca on ca.id=pu.canal_id where pu.propiedad_id=$1 order by pu.created_at desc', [p.id]),
      c.query('select id, codigo, tipo, estado, precio, moneda from operacion where propiedad_id=$1 order by abierta_at desc', [p.id]),
      c.query(`select m.*, co.nombre as concepto from movimiento m join concepto co on co.id=m.concepto_id where m.propiedad_id=$1 order by m.fecha desc, m.created_at desc limit 100`, [p.id]),
    ]);
    return { ...p, propietarios: prop.rows, mandatos: man.rows, historial: hist.rows, publicaciones: pubs.rows, operaciones: ops_.rows, movimientos: movs.rows };
  });
  reg('POST', '/api/propiedades', 'propiedades.crear', async ({ c, u, body }) => {
    if (!body.direccion) throw bad('La direccion es obligatoria');
    const n = await nextSeq(c, u.empresa_id, 'propiedad');
    const codigo = body.codigo || 'P-' + String(n).padStart(5, '0');
    const dup = await c.query(`select codigo from propiedad where direccion ilike $1 and deleted_at is null limit 1`, [body.direccion.trim()]);
    if (dup.rows[0] && !body.confirmar_duplicado) { const e = bad(`Existe una propiedad con la misma direccion (${dup.rows[0].codigo}). Confirme para crear de todas formas.`); e.status = 409; throw e; }
    const r = await c.query(
      `insert into propiedad (empresa_id, codigo, tipo_id, comuna_id, direccion, rol_sii, sup_util, sup_terreno, dormitorios, banos, estacionamientos, bodegas, amoblada, acepta_mascotas,
         gasto_comun, contribuciones, descripcion, notas_internas, precio_venta, moneda_venta, precio_arriendo, moneda_arriendo, agente_captador_id, estado, sucursal_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,'borrador',(select sucursal_id from usuario where id=$24)) returning *`,
      [u.empresa_id, codigo, body.tipo_id || null, body.comuna_id || null, body.direccion, body.rol_sii || null, body.sup_util || null, body.sup_terreno || null, body.dormitorios ?? null,
        body.banos ?? null, body.estacionamientos || 0, body.bodegas || 0, !!body.amoblada, body.acepta_mascotas ?? null, body.gasto_comun || null, body.contribuciones || null,
        body.descripcion || null, body.notas_internas || null, body.precio_venta || null, body.moneda_venta || 'UF', body.precio_arriendo || null, body.moneda_arriendo || 'CLP',
        body.agente_captador_id || (u.es_agente ? u.id : null), u.id]);
    await completitud(c, r.rows[0].id);
    await audit(c, u, 'propiedad', r.rows[0].id, 'crear', null, { codigo });
    return (await c.query('select * from propiedad where id=$1', [r.rows[0].id])).rows[0];
  });
  reg('PATCH', '/api/propiedades/:id', 'propiedades.editar', async ({ c, u, params, body }) => {
    const a = (await c.query('select * from propiedad where id=$1 and deleted_at is null', [params.id])).rows[0];
    if (!a) throw notFound();
    if (propios(u) && a.agente_captador_id !== u.id) throw forbidden();
    const campos = ['tipo_id', 'comuna_id', 'direccion', 'rol_sii', 'sup_util', 'sup_terreno', 'dormitorios', 'banos', 'estacionamientos', 'bodegas', 'amoblada', 'acepta_mascotas',
      'gasto_comun', 'contribuciones', 'descripcion', 'notas_internas', 'agente_captador_id'];
    const sets = [], vals = [a.id];
    for (const k of campos) if (k in body) { vals.push(body[k] === '' ? null : body[k]); sets.push(`${k}=$${vals.length}`); }
    if (sets.length) await c.query(`update propiedad set ${sets.join(',')} where id=$1`, vals);
    await completitud(c, a.id);
    await audit(c, u, 'propiedad', a.id, 'editar', null, body);
    return (await c.query('select * from propiedad where id=$1', [a.id])).rows[0];
  });
  reg('POST', '/api/propiedades/:id/precio', 'propiedades.editar', async ({ c, u, params, body }) => {
    const a = (await c.query('select * from propiedad where id=$1', [params.id])).rows[0];
    if (!a) throw notFound();
    const par = await empresaParam(c, u.empresa_id);
    const op = body.operacion;
    if (!['venta', 'arriendo'].includes(op) || !(Number(body.precio) > 0)) throw bad('operacion (venta|arriendo) y precio > 0 son obligatorios');
    const ant = op === 'venta' ? a.precio_venta : a.precio_arriendo;
    const monedaAnt = op === 'venta' ? a.moneda_venta : a.moneda_arriendo;
    const moneda = body.moneda || monedaAnt;
    if (ant && moneda === monedaAnt) {
      const dif = Math.abs(body.precio - ant) / ant * 100;
      if (dif > (par.variacion_precio_max_pct ?? 20) && !body.motivo) throw bad(`El cambio es de ${dif.toFixed(1)}%: indique un motivo`);
    }
    if (op === 'venta') await c.query('update propiedad set precio_venta=$2, moneda_venta=$3 where id=$1', [a.id, body.precio, moneda]);
    else await c.query('update propiedad set precio_arriendo=$2, moneda_arriendo=$3 where id=$1', [a.id, body.precio, moneda]);
    await c.query("insert into propiedad_historial (empresa_id, propiedad_id, tipo, anterior, nuevo, motivo, usuario_id) values ($1,$2,'precio_'||$3,$4,$5,$6,$7)",
      [u.empresa_id, a.id, op, ant ? `${ant} ${monedaAnt}` : null, `${body.precio} ${moneda}`, body.motivo || null, u.id]);
    const sync = await c.query("update publicacion set precio=$3, moneda=$4 where propiedad_id=$1 and operacion=$2 and estado in ('publicada','pendiente','pausada')", [a.id, op, body.precio, moneda]);
    return { precio: body.precio, moneda, publicaciones_actualizadas: sync.rowCount };
  });
  reg('POST', '/api/propiedades/:id/estado', 'propiedades.editar', async ({ c, u, params, body }) => {
    const a = (await c.query('select * from propiedad where id=$1', [params.id])).rows[0];
    if (!a) throw notFound();
    const ok = TRANS_PROP[a.estado] || [];
    if (!ok.includes(body.estado)) throw bad(`Transicion no permitida: ${a.estado} -> ${body.estado}.${ok.length ? ' Permitidas: ' + ok.join(', ') : ' Este estado cambia por operaciones.'}`);
    if (body.estado === 'retirada' && !body.motivo) throw bad('Indique el motivo del retiro');
    if (body.estado === 'publicada') { const p = await publicable(c, u, a.id, null); if (!p.ok) throw bad('La propiedad no es publicable: ' + p.faltantes.join('; ')); }
    await c.query('update propiedad set estado=$2, retirada_motivo=$3 where id=$1', [a.id, body.estado, body.estado === 'retirada' ? body.motivo : null]);
    if (body.estado === 'retirada') await c.query("update publicacion set estado='retirada' where propiedad_id=$1 and estado in ('publicada','pausada','pendiente')", [a.id]);
    await c.query("insert into propiedad_historial (empresa_id, propiedad_id, tipo, anterior, nuevo, motivo, usuario_id) values ($1,$2,'estado',$3,$4,$5,$6)", [u.empresa_id, a.id, a.estado, body.estado, body.motivo || null, u.id]);
    return { estado: body.estado };
  });
  reg('GET', '/api/propiedades/:id/publicable', 'propiedades.ver', async ({ c, u, params, query }) => publicable(c, u, params.id, query.operacion || null));
  reg('PUT', '/api/propiedades/:id/propietarios', 'propiedades.editar', async ({ c, u, params, body }) => {
    const lista = body.propietarios || [];
    const suma = lista.reduce((s, x) => s + Number(x.porcentaje), 0);
    if (!lista.length || Math.abs(suma - 100) > 0.001) throw bad(`Los porcentajes de dominio suman ${suma}%, deben sumar 100%`);
    await c.query('delete from propiedad_propietario where propiedad_id=$1', [params.id]);
    for (const [i, x] of lista.entries()) {
      await c.query('insert into propiedad_propietario (empresa_id, propiedad_id, persona_id, porcentaje, principal) values ($1,$2,$3,$4,$5)', [u.empresa_id, params.id, x.persona_id, x.porcentaje, i === 0]);
      await c.query("update persona set roles=array(select distinct unnest(roles || '{propietario}')) where id=$1", [x.persona_id]);
    }
    await completitud(c, params.id);
    await audit(c, u, 'propiedad', params.id, 'propietarios', null, lista);
    return lista;
  });
  reg('POST', '/api/propiedades/:id/fotos', 'propiedades.editar', async ({ c, u, params, body }) => {
    const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(body.data_url || '');
    if (!m) throw bad('Envie data_url de una imagen png, jpg o webp');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 5 * 1024 * 1024) throw bad('La imagen supera 5 MB');
    const magic = buf.subarray(0, 4).toString('hex');
    if (!(magic.startsWith('89504e47') || magic.startsWith('ffd8ff') || buf.subarray(0, 4).toString() === 'RIFF')) throw bad('El archivo no es una imagen valida');
    fs.mkdirSync(path.join(UPLOADS, u.empresa_id), { recursive: true });
    const nombre = crypto.randomUUID() + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]);
    fs.writeFileSync(path.join(UPLOADS, u.empresa_id, nombre), buf);
    const url = `/uploads/${u.empresa_id}/${nombre}`;
    await c.query('update propiedad set fotos = fotos || $2::jsonb where id=$1', [params.id, JSON.stringify([{ url, titulo: body.titulo || '' }])]);
    await completitud(c, params.id);
    return { url };
  });
  reg('DELETE', '/api/propiedades/:id/fotos/:idx', 'propiedades.editar', async ({ c, params }) => {
    await c.query('update propiedad set fotos = fotos - $2::int where id=$1', [params.id, Number(params.idx)]);
    await completitud(c, params.id);
  });

  // ---- Mandatos ----
  reg('POST', '/api/propiedades/:id/mandatos', 'propiedades.editar', async ({ c, u, params, body }) => {
    if (!['venta', 'arriendo', 'administracion'].includes(body.tipo)) throw bad('tipo invalido');
    if (!body.fecha_inicio || !body.fecha_fin) throw bad('Indique vigencia');
    const r = await c.query(
      `insert into mandato (empresa_id, propiedad_id, tipo, exclusivo, fecha_inicio, fecha_fin, comision_tipo, comision_valor, honorario_admin_pct, honorario_admin_minimo, agente_id, notas)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
      [u.empresa_id, params.id, body.tipo, !!body.exclusivo, body.fecha_inicio, body.fecha_fin, body.comision_tipo || null, body.comision_valor || null,
        body.honorario_admin_pct || null, body.honorario_admin_minimo || 0, body.agente_id || (u.es_agente ? u.id : null), body.notas || null]);
    await completitud(c, params.id);
    await audit(c, u, 'mandato', r.rows[0].id, 'crear', null, r.rows[0]);
    return r.rows[0];
  });
  reg('POST', '/api/mandatos/:id/terminar', 'propiedades.editar', async ({ c, u, params, body }) => {
    if (!body.motivo) throw bad('Indique el motivo');
    const r = await c.query("update mandato set estado='terminado', notas=coalesce(notas||' | ','')||$2 where id=$1 returning *", [params.id, 'Termino: ' + body.motivo]);
    if (!r.rows[0]) throw notFound();
    await audit(c, u, 'mandato', params.id, 'terminar', null, body);
    return r.rows[0];
  });
  reg('GET', '/api/alertas', 'propiedades.ver', async ({ c, u }) => {
    const par = await empresaParam(c, u.empresa_id);
    const dias = par.dias_alerta_mandato ?? 30;
    const out = [];
    const m = await c.query(`select m.id, m.tipo, m.fecha_fin, p.codigo, p.id as propiedad_id from mandato m join propiedad p on p.id=m.propiedad_id
      where m.estado='vigente' and m.fecha_fin <= current_date + $1::int order by m.fecha_fin`, [dias]);
    m.rows.forEach(x => out.push({ tipo: x.fecha_fin < hoy() ? 'mandato_vencido' : 'mandato_por_vencer', severidad: x.fecha_fin < hoy() ? 'alta' : 'media', detalle: `Mandato de ${x.tipo} de ${x.codigo} vence ${x.fecha_fin}`, propiedad_id: x.propiedad_id }));
    const k = await c.query(`select k.id, k.fecha_termino, p.codigo from contrato_arriendo k join propiedad p on p.id=k.propiedad_id where k.estado in ('firmado','vigente') and k.fecha_termino <= current_date + 90 order by k.fecha_termino`);
    k.rows.forEach(x => out.push({ tipo: 'contrato_por_vencer', severidad: 'media', detalle: `Contrato de ${x.codigo} termina ${x.fecha_termino}`, contrato_id: x.id }));
    const rj = await c.query(`select k.id, k.proximo_reajuste, p.codigo from contrato_arriendo k join propiedad p on p.id=k.propiedad_id where k.estado in ('firmado','vigente') and k.proximo_reajuste <= current_date + 30`);
    rj.rows.forEach(x => out.push({ tipo: 'reajuste_proximo', severidad: 'media', detalle: `Reajuste de ${x.codigo} el ${x.proximo_reajuste}`, contrato_id: x.id }));
    const inc = await c.query(`select id, codigo, completitud from propiedad where deleted_at is null and estado in ('captada','publicada') and completitud < $1`, [par.completitud_minima ?? 50]);
    inc.rows.forEach(x => out.push({ tipo: 'ficha_incompleta', severidad: 'baja', detalle: `${x.codigo} con ${x.completitud}% de completitud`, propiedad_id: x.id }));
    return out;
  });

  // =============== PUBLICACIONES ===============
  reg('GET', '/api/publicaciones', 'publicaciones.ver', async ({ c, query }) =>
    (await c.query(`select pu.*, ca.nombre as canal, p.codigo, p.direccion from publicacion pu join catalogo ca on ca.id=pu.canal_id join propiedad p on p.id=pu.propiedad_id
      where ($1::text is null or pu.estado=$1) order by pu.created_at desc limit 300`, [query.estado || null])).rows);
  reg('POST', '/api/propiedades/:id/publicaciones', 'publicaciones.crear', async ({ c, u, params, body }) => {
    const op = body.operacion;
    if (!['venta', 'arriendo'].includes(op)) throw bad('operacion debe ser venta o arriendo');
    const chk = await publicable(c, u, params.id, op);
    if (!chk.ok) throw bad('No es publicable: ' + chk.faltantes.join('; '));
    const p = (await c.query(`select p.*, t.nombre as tipo, cm.nombre as comuna from propiedad p left join catalogo t on t.id=p.tipo_id left join catalogo cm on cm.id=p.comuna_id where p.id=$1`, [params.id])).rows[0];
    if (['vendida', 'arrendada', 'reservada'].includes(p.estado)) throw bad(`La propiedad esta ${p.estado}`);
    const opAbierta = (await c.query("select id from operacion where propiedad_id=$1 and tipo=$2 and estado not in ('cerrada','caida','rechazada') limit 1", [p.id, op])).rows[0];
    const out = [];
    for (const ch of body.canales || []) {
      const canal = (await c.query("select * from catalogo where id=$1 and grupo='canal' and activo", [ch.canal_id])).rows[0];
      if (!canal) throw bad('Canal invalido');
      const precio = op === 'venta' ? p.precio_venta : p.precio_arriendo, moneda = op === 'venta' ? p.moneda_venta : p.moneda_arriendo;
      const titulo = ch.titulo || `${p.tipo || 'Propiedad'} en ${op === 'venta' ? 'venta' : 'arriendo'} - ${p.comuna || ''}${p.dormitorios ? ' - ' + p.dormitorios + 'D' : ''}${p.banos ? '/' + p.banos + 'B' : ''}`.trim();
      const modo = canal.datos.modo || 'asistida';
      const costo = Number(ch.costo ?? canal.datos.costo ?? 0);
      const r = await c.query(
        `insert into publicacion (empresa_id, propiedad_id, operacion, canal_id, estado, titulo, descripcion, precio, moneda, costo, publicada_at, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
        [u.empresa_id, p.id, op, canal.id, modo === 'nativo' ? 'publicada' : 'pendiente', titulo, ch.descripcion || p.descripcion, precio, moneda, costo, modo === 'nativo' ? new Date() : null, u.id]);
      if (costo > 0) {
        const mv = await fin.crearMovimiento(c, u, { concepto_codigo: 'PUB_PORTAL', monto_neto: costo, propiedad_id: p.id, operacion_id: opAbierta ? opAbierta.id : null, publicacion_id: r.rows[0].id,
          pagador: 'corredora', estado: 'provisionado', origen: 'evento', origen_ref: 'publicacion:' + r.rows[0].id, glosa: `Publicacion en ${canal.nombre}` });
        await c.query('update publicacion set movimiento_id=$2 where id=$1', [r.rows[0].id, mv.id]);
      }
      out.push({ ...r.rows[0], canal: canal.nombre, modo });
    }
    await audit(c, u, 'publicacion', params.id, 'publicar', null, { canales: out.length });
    return out;
  });
  reg('POST', '/api/publicaciones/:id/:accion', 'publicaciones.editar', async ({ c, u, params, body }) => {
    const pu = (await c.query('select * from publicacion where id=$1', [params.id])).rows[0];
    if (!pu) throw notFound();
    const map = { pausar: ['pausada', ['publicada']], retirar: ['retirada', ['publicada', 'pausada', 'pendiente', 'error']], reactivar: ['publicada', ['pausada']] };
    if (params.accion === 'confirmar-manual') {
      if (pu.estado !== 'pendiente') throw bad('Solo una publicacion pendiente puede confirmarse');
      if (!body.id_externo && !body.url) throw bad('Indique el ID o la URL de la publicacion en el portal');
      await c.query("update publicacion set estado='publicada', id_externo=$2, url_externa=$3, publicada_at=now() where id=$1", [pu.id, body.id_externo || null, body.url || null]);
    } else if (params.accion === 'renovar') {
      const costo = Number(body.costo || pu.costo);
      await c.query("update publicacion set expira_at=$2, estado=case when estado in ('expirada','pausada') then 'publicada' else estado end where id=$1", [pu.id, body.expira_at || null]);
      if (costo > 0) await fin.crearMovimiento(c, u, { concepto_codigo: 'PUB_PORTAL', monto_neto: costo, propiedad_id: pu.propiedad_id, publicacion_id: pu.id, pagador: 'corredora', origen: 'evento', glosa: 'Renovacion de publicacion' });
    } else if (map[params.accion]) {
      const [nuevo, desde] = map[params.accion];
      if (!desde.includes(pu.estado)) throw bad(`No se puede ${params.accion} una publicacion ${pu.estado}`);
      await c.query('update publicacion set estado=$2 where id=$1', [pu.id, nuevo]);
    } else throw notFound('Accion desconocida');
    await audit(c, u, 'publicacion', pu.id, params.accion);
    return (await c.query('select * from publicacion where id=$1', [pu.id])).rows[0];
  });

  // =============== CRM ===============
  reg('GET', '/api/leads', 'leads.ver', async ({ c, u, query }) =>
    (await c.query(`select l.*, pe.nombre as persona, pe.email, pe.telefono, pr.codigo as propiedad, ag.nombre as agente, f.nombre as fuente
      from lead l join persona pe on pe.id=l.persona_id left join propiedad pr on pr.id=l.propiedad_id left join usuario ag on ag.id=l.agente_id left join catalogo f on f.id=l.fuente_id
      where ($1::text is null or l.estado=$1) and ($2::uuid is null or l.agente_id=$2) order by l.created_at desc limit 500`,
      [query.estado || null, propios(u) ? u.id : (query.agente_id || null)])).rows);
  reg('POST', '/api/leads', 'leads.crear', async ({ c, u, body }) => crearLead(c, u.empresa_id, u, body));
  const TRANS_LEAD = { nuevo: ['contactado', 'perdido'], contactado: ['visita', 'oferta', 'perdido'], visita: ['oferta', 'perdido', 'contactado'], oferta: ['ganado', 'perdido', 'visita'], ganado: [], perdido: ['contactado'] };
  reg('POST', '/api/leads/:id/estado', 'leads.editar', async ({ c, u, params, body }) => {
    const l = (await c.query('select * from lead where id=$1', [params.id])).rows[0];
    if (!l) throw notFound();
    if (propios(u) && l.agente_id !== u.id) throw forbidden();
    if (!(TRANS_LEAD[l.estado] || []).includes(body.estado)) throw bad(`Transicion no permitida: ${l.estado} -> ${body.estado}`);
    if (body.estado === 'perdido' && !body.motivo_perdida_id) throw bad('Indique el motivo de perdida');
    await c.query(`update lead set estado=$2, motivo_perdida_id=$3, primer_contacto_at=coalesce(primer_contacto_at, case when $2<>'nuevo' then now() end),
       cerrado_at=case when $2 in ('ganado','perdido') then now() else null end where id=$1`, [l.id, body.estado, body.motivo_perdida_id || null]);
    await audit(c, u, 'lead', l.id, 'estado:' + body.estado, { estado: l.estado }, body);
    return (await c.query('select * from lead where id=$1', [l.id])).rows[0];
  });
  reg('POST', '/api/leads/:id/asignar', 'leads.editar', async ({ c, u, params, body }) => {
    await c.query('update lead set agente_id=$2, asignado_at=now() where id=$1', [params.id, body.agente_id]);
    await audit(c, u, 'lead', params.id, 'asignar', null, body);
  });
  reg('POST', '/api/interacciones', 'leads.editar', async ({ c, u, body }) => {
    if (!body.persona_id || !body.detalle) throw bad('persona_id y detalle son obligatorios');
    const r = await c.query('insert into interaccion (empresa_id, persona_id, lead_id, tipo, detalle, usuario_id) values ($1,$2,$3,$4,$5,$6) returning *',
      [u.empresa_id, body.persona_id, body.lead_id || null, body.tipo || 'nota', body.detalle, u.id]);
    if (body.lead_id) await c.query('update lead set primer_contacto_at=coalesce(primer_contacto_at, now()) where id=$1', [body.lead_id]);
    return r.rows[0];
  });

  // ---- Visitas ----
  reg('GET', '/api/visitas', 'visitas.ver', async ({ c, u, query }) =>
    (await c.query(`select v.*, p.codigo, p.direccion, pe.nombre as persona, ag.nombre as agente from visita v join propiedad p on p.id=v.propiedad_id
      left join persona pe on pe.id=v.persona_id join usuario ag on ag.id=v.agente_id
      where ($1::uuid is null or v.agente_id=$1) and v.inicio >= coalesce($2::timestamptz, now()-interval '30 days') order by v.inicio limit 300`,
      [propios(u) ? u.id : (query.agente_id || null), query.desde || null])).rows);
  reg('POST', '/api/visitas', 'visitas.crear', async ({ c, u, body }) => {
    if (!body.propiedad_id || !body.inicio || !body.fin) throw bad('propiedad_id, inicio y fin son obligatorios');
    const lead = body.lead_id ? (await c.query('select * from lead where id=$1', [body.lead_id])).rows[0] : null;
    try {
      const r = await c.query('insert into visita (empresa_id, propiedad_id, lead_id, persona_id, agente_id, inicio, fin) values ($1,$2,$3,$4,$5,$6,$7) returning *',
        [u.empresa_id, body.propiedad_id, body.lead_id || null, body.persona_id || (lead && lead.persona_id) || null, body.agente_id || u.id, body.inicio, body.fin]);
      if (lead && ['nuevo', 'contactado'].includes(lead.estado)) await c.query("update lead set estado='visita', primer_contacto_at=coalesce(primer_contacto_at,now()) where id=$1", [lead.id]);
      return r.rows[0];
    } catch (e) { if (e.code === '23P01') { const x = bad('El agente ya tiene una visita en ese horario'); x.status = 409; throw x; } throw e; }
  });
  reg('POST', '/api/visitas/:id/estado', 'visitas.editar', async ({ c, params, body }) => {
    if (!['confirmada', 'realizada', 'no_asistio', 'cancelada'].includes(body.estado)) throw bad('Estado invalido');
    const r = await c.query('update visita set estado=$2, feedback=coalesce($3,feedback), interes_nivel=coalesce($4,interes_nivel) where id=$1 returning *', [params.id, body.estado, body.feedback, body.interes_nivel]);
    if (!r.rows[0]) throw notFound();
    return r.rows[0];
  });

  // =============== OPERACIONES ===============
  reg('GET', '/api/operaciones', 'operaciones.ver', async ({ c, u, query }) =>
    (await c.query(`select o.*, p.codigo as propiedad, p.direccion, cl.nombre as cliente, ag.nombre as agente_vendedor
      from operacion o join propiedad p on p.id=o.propiedad_id left join persona cl on cl.id=o.cliente_id left join usuario ag on ag.id=o.agente_vendedor_id
      where ($1::text is null or o.tipo=$1) and ($2::text is null or o.estado=$2)
        and ($3::uuid is null or o.agente_captador_id=$3 or o.agente_vendedor_id=$3) order by o.abierta_at desc limit 500`,
      [query.tipo || null, query.estado || null, propios(u) ? u.id : null])).rows);
  reg('GET', '/api/operaciones/:id', 'operaciones.ver', async ({ c, u, params }) => {
    const resumen = await fin.resumenOperacion(c, params.id);
    const op = resumen.operacion;
    if (propios(u) && ![op.agente_captador_id, op.agente_vendedor_id].includes(u.id)) throw forbidden();
    const [hist, prop, cl, k] = await Promise.all([
      c.query('select h.*, us.nombre as usuario from operacion_historial h left join usuario us on us.id=h.usuario_id where h.operacion_id=$1 order by h.at', [op.id]),
      c.query('select codigo, direccion from propiedad where id=$1', [op.propiedad_id]),
      op.cliente_id ? c.query('select id, nombre, rut, email, telefono from persona where id=$1', [op.cliente_id]) : { rows: [] },
      c.query('select * from contrato_arriendo where operacion_id=$1 order by created_at desc', [op.id]),
    ]);
    return { ...resumen, historial: hist.rows, propiedad: prop.rows[0], cliente: cl.rows[0] || null, contratos: k.rows, flujo: ops.FLUJOS[op.tipo], permitidos: ops.FLUJOS[op.tipo].sig[op.estado] };
  });
  reg('POST', '/api/operaciones', 'operaciones.crear', async ({ c, u, body }) => ops.crear(c, u, body));
  reg('PATCH', '/api/operaciones/:id', 'operaciones.editar', async ({ c, u, params, body }) => {
    const a = (await c.query('select * from operacion where id=$1', [params.id])).rows[0];
    if (!a) throw notFound();
    if (['cerrada', 'caida', 'rechazada'].includes(a.estado)) throw bad('La operacion esta cerrada');
    const r = await c.query('update operacion set cliente_id=coalesce($2,cliente_id), agente_vendedor_id=coalesce($3,agente_vendedor_id), detalle=detalle||coalesce($4::jsonb,\'{}\'::jsonb) where id=$1 returning *',
      [a.id, body.cliente_id, body.agente_vendedor_id, body.detalle ? JSON.stringify(body.detalle) : null]);
    await audit(c, u, 'operacion', a.id, 'editar', null, body);
    return r.rows[0];
  });
  reg('POST', '/api/operaciones/:id/avanzar', 'operaciones.editar', async ({ c, u, params, body }) => {
    if (body.estado_hacia === 'caida' || body.retroceder) { /* caidas se permiten a editar */ }
    return ops.avanzar(c, u, params.id, body);
  });
  reg('POST', '/api/operaciones/:id/comision/simular', 'operaciones.ver', async ({ c, u, params, body }) => {
    const op = (await c.query('select * from operacion where id=$1', [params.id])).rows[0];
    if (!op) throw notFound();
    const regla = await fin.reglaAplicable(c, op.tipo, null, hoy(), body.regla_id);
    if (!regla) throw bad('No hay regla de comision aplicable');
    const calc = await fin.calcularComision(c, u.empresa_id, regla, op, { precio: body.precio, moneda: body.moneda });
    const res = await fin.resumenOperacion(c, op.id);
    const agentes = calc.reparto.filter(l => l.beneficiario_id && l.rol !== 'corredora').reduce((s, l) => s + l.monto, 0);
    return { regla: regla.nombre, hito: regla.hito_devengo, ...calc, costos_actuales: res.costos, utilidad_estimada: calc.monto_neto - agentes - res.costos };
  });
  reg('POST', '/api/operaciones/:id/contrato', 'contratos.crear', async ({ c, u, params, body }) => arr.crearContrato(c, u, params.id, body));

  // =============== DOCUMENTOS ===============
  const esc = s => String(s ?? '').replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  const fmt = n => Math.round(n).toLocaleString('es-CL');
  const fechaLarga = f => new Date(f + 'T00:00:00').toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' });
  async function variables(c, u, entidad, id) {
    const emp = (await c.query('select razon_social, rut from empresa where id=$1', [u.empresa_id])).rows[0];
    const v = { empresa: emp.razon_social, empresa_rut: emp.rut, fecha_hoy: fechaLarga(hoy()) };
    const propBase = async pid => {
      const p = (await c.query(`select p.*, t.nombre as tipo, cm.nombre as comuna from propiedad p left join catalogo t on t.id=p.tipo_id left join catalogo cm on cm.id=p.comuna_id where p.id=$1`, [pid])).rows[0];
      const own = (await c.query('select pe.nombre, pe.rut, pp.porcentaje from propiedad_propietario pp join persona pe on pe.id=pp.persona_id where pp.propiedad_id=$1 order by pp.principal desc', [pid])).rows;
      Object.assign(v, { propiedad_codigo: p.codigo, propiedad_direccion: p.direccion, propiedad_comuna: p.comuna || '', propiedad_tipo: p.tipo || '', propiedad_rol: p.rol_sii || 's/i',
        propietarios: own.map(o => `${o.nombre} (RUT ${o.rut || 's/i'}, ${o.porcentaje}%)`).join('; '), propietario_principal: own[0] ? own[0].nombre : '' });
      return p;
    };
    if (entidad === 'mandato') {
      const m = (await c.query('select * from mandato where id=$1', [id])).rows[0];
      if (!m) throw notFound('Mandato no encontrado');
      await propBase(m.propiedad_id);
      Object.assign(v, { mandato_tipo: m.tipo, mandato_exclusivo: m.exclusivo ? 'con exclusividad' : 'sin exclusividad', mandato_inicio: fechaLarga(m.fecha_inicio), mandato_fin: fechaLarga(m.fecha_fin),
        comision: m.comision_tipo === 'porcentaje' ? `${m.comision_valor}% del precio` : m.comision_tipo === 'meses_renta' ? `${m.comision_valor} mes(es) de renta` : m.comision_tipo === 'monto_fijo' ? `$${fmt(m.comision_valor)}` : 'a convenir',
        honorario: m.honorario_admin_pct ? `${m.honorario_admin_pct}% del canon cobrado` : 'no aplica' });
    } else if (entidad === 'contrato') {
      const k = (await c.query('select k.*, pe.nombre as arr, pe.rut as arr_rut from contrato_arriendo k join persona pe on pe.id=k.arrendatario_id where k.id=$1', [id])).rows[0];
      if (!k) throw notFound('Contrato no encontrado');
      await propBase(k.propiedad_id);
      Object.assign(v, { arrendatario: k.arr, arrendatario_rut: k.arr_rut || 's/i', canon: `${k.canon_moneda === 'CLP' ? '$' : ''}${fmt(k.canon_vigente)}${k.canon_moneda !== 'CLP' ? ' ' + k.canon_moneda : ''}`,
        fecha_inicio: fechaLarga(k.fecha_inicio), fecha_termino: fechaLarga(k.fecha_termino), dia_pago: k.dia_pago, garantia: `$${fmt(k.garantia_monto)}`,
        reajuste: k.reajuste_tipo === 'ipc' ? `segun variacion del IPC cada ${k.reajuste_periodicidad_meses} meses` : k.reajuste_tipo, interes_mora: k.interes_mora_pct + '% mensual' });
    } else if (entidad === 'liquidacion') {
      const l = (await c.query('select l.*, pe.nombre as prop_nombre from liquidacion_propietario l join persona pe on pe.id=l.propietario_id where l.id=$1', [id])).rows[0];
      if (!l) throw notFound('Liquidacion no encontrada');
      await propBase(l.propiedad_id);
      const det = (await c.query('select * from liquidacion_propietario_detalle where liquidacion_id=$1 order by id', [id])).rows;
      Object.assign(v, { periodo: l.periodo, propietario: l.prop_nombre, ingresos: '$' + fmt(l.ingresos), neto_a_pagar: '$' + fmt(l.neto_a_pagar),
        detalle: `<table border="1" cellpadding="6" style="border-collapse:collapse;width:100%"><tr><th align="left">Concepto</th><th align="right">Monto</th></tr>${det.map(d => `<tr><td>${esc(d.descripcion || d.tipo)}</td><td align="right">${d.monto < 0 ? '-' : ''}$${fmt(Math.abs(d.monto))}</td></tr>`).join('')}</table>` });
    } else throw bad('entidad invalida (mandato|contrato|liquidacion)');
    return v;
  }
  reg('GET', '/api/documentos', 'documentos.ver', async ({ c, query }) =>
    (await c.query(`select id, tipo, titulo, entidad, entidad_id, estado, version, firmado_at, created_at from documento where ($1::uuid is null or entidad_id=$1) order by created_at desc limit 200`, [query.entidad_id || null])).rows);
  reg('GET', '/api/plantillas', 'documentos.ver', async ({ c }) => (await c.query('select id, tipo, nombre, revisada_legal_at from plantilla_documento where activa order by nombre')).rows);
  reg('POST', '/api/documentos/generar', 'documentos.crear', async ({ c, u, body }) => {
    const pl = (await c.query('select * from plantilla_documento where tipo=$1 and activa', [body.plantilla_tipo])).rows[0];
    if (!pl) throw notFound('Plantilla no encontrada');
    const v = await variables(c, u, body.entidad, body.entidad_id);
    const faltan = [...new Set([...pl.contenido.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]))].filter(k => !(k in v));
    if (faltan.length) throw bad('Faltan variables para generar el documento: ' + faltan.join(', '));
    const html = pl.contenido.replace(/\{\{(\w+)\}\}/g, (_, k) => k === 'detalle' ? v[k] : esc(v[k]));
    const hash = crypto.createHash('sha256').update(html).digest('hex');
    const r = await c.query(`insert into documento (empresa_id, tipo, titulo, entidad, entidad_id, contenido, hash, created_by, estado) values ($1,$2,$3,$4,$5,$6,$7,$8,'generado') returning id, tipo, titulo, estado, hash`,
      [u.empresa_id, pl.tipo, `${pl.nombre} - ${v.propiedad_codigo || ''}`.trim(), body.entidad, body.entidad_id, html, hash, u.id]);
    if (body.entidad === 'mandato') { const m = (await c.query('select propiedad_id from mandato where id=$1', [body.entidad_id])).rows[0]; await completitud(c, m.propiedad_id); }
    await audit(c, u, 'documento', r.rows[0].id, 'generar', null, { plantilla: pl.tipo, plantilla_revisada_legal: !!pl.revisada_legal_at });
    return { ...r.rows[0], advertencia: pl.revisada_legal_at ? null : 'Plantilla sin revision legal: use como borrador de apoyo' };
  });
  reg('GET', '/api/documentos/:id/html', 'documentos.ver', async ({ c, params, reply }) => {
    const d = (await c.query('select * from documento where id=$1', [params.id])).rows[0];
    if (!d) throw notFound();
    reply.type('text/html; charset=utf-8');
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(d.titulo)}</title><style>body{font:14px/1.6 Georgia,serif;max-width:800px;margin:2rem auto;padding:0 1rem}h1{font-size:20px;text-align:center}.pie{margin-top:2rem;font:11px monospace;color:#666}@media print{.noprint{display:none}}</style></head><body>${d.contenido}<p class="pie">Documento ${esc(d.id)} v${d.version} · sha256 ${esc(d.hash)} · estado ${esc(d.estado)}</p></body></html>`;
  });
  reg('POST', '/api/documentos/:id/firmar', 'documentos.editar', async ({ c, u, params, body }) => {
    const d = (await c.query('select * from documento where id=$1', [params.id])).rows[0];
    if (!d) throw notFound();
    if (d.estado === 'firmado') throw bad('El documento ya esta firmado y es inmutable');
    const f = body.firmantes || [];
    if (!f.length || f.some(x => !x.nombre)) throw bad('Indique al menos un firmante con nombre');
    await c.query("update documento set estado='firmado', firmado_at=now(), firmantes=$2 where id=$1", [d.id, JSON.stringify(f.map(x => ({ nombre: x.nombre, rut: x.rut || null, rol: x.rol || null, firmado_at: new Date().toISOString(), medio: x.medio || 'registro manual' })))]);
    await audit(c, u, 'documento', d.id, 'firmar', null, { firmantes: f.length, hash: d.hash });
    return { estado: 'firmado', hash: d.hash };
  });
};
module.exports.crearLead = crearLead;
module.exports.completitud = completitud;
