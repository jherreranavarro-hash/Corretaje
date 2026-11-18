// Administracion del sistema y mantenedores
const bcrypt = require('bcryptjs');
const { makeReg } = require('../lib/route');
const { bad, notFound, audit, round0, validarClave } = require('../lib/util');
const { cuota } = require('../lib/planes');

// donde se usa cada catalogo (para impedir borrados con uso)
const USOS = {
  tipo_propiedad: [['propiedad', 'tipo_id']], comuna: [['propiedad', 'comuna_id']], fuente_lead: [['lead', 'fuente_id']],
  motivo_perdida: [['lead', 'motivo_perdida_id']], canal: [['publicacion', 'canal_id']],
  medio_pago: [['pago', 'medio_pago_id'], ['movimiento', 'medio_pago_id']], centro_costo: [['movimiento', 'centro_costo_id']],
};
const PARAMS = {
  umbral_aprobacion_gasto: 'num', umbral_mantencion: 'num', exigir_mandato: 'bool', pagar_comision_solo_si_cobrada: 'bool', prorratear_canon: 'bool',
  exigir_2fa: 'bool', retencion_honorarios_pct: 'num', min_fotos: 'num', completitud_minima: 'num', dias_alerta_mandato: 'num', variacion_precio_max_pct: 'num',
};

module.exports = async function (app) {
  const reg = makeReg(app);

  // ---------- Catalogos genericos ----------
  reg('GET', '/api/catalogos', 'catalogos.ver', async ({ c }) =>
    (await c.query('select grupo, count(*)::int total, count(*) filter (where activo)::int activos from catalogo group by grupo order by grupo')).rows);
  reg('GET', '/api/catalogos/:grupo', null, async ({ c, params, query }) =>
    (await c.query(`select * from catalogo where grupo=$1 ${query.todos ? '' : 'and activo'} order by orden, nombre`, [params.grupo])).rows);
  reg('POST', '/api/catalogos/:grupo', 'catalogos.crear', async ({ c, u, params, body }) => {
    if (!body.codigo || !body.nombre) throw bad('codigo y nombre son obligatorios');
    const r = await c.query('insert into catalogo (empresa_id, grupo, codigo, nombre, orden, datos) values ($1,$2,$3,$4,$5,$6) returning *',
      [u.empresa_id, params.grupo, String(body.codigo).trim().toUpperCase(), body.nombre, body.orden || 0, body.datos || {}]);
    await audit(c, u, 'catalogo', r.rows[0].id, 'crear', null, r.rows[0]);
    return r.rows[0];
  });
  reg('PATCH', '/api/catalogos/:grupo/:id', 'catalogos.editar', async ({ c, u, params, body }) => {
    const a = (await c.query('select * from catalogo where id=$1 and grupo=$2', [params.id, params.grupo])).rows[0];
    if (!a) throw notFound();
    const r = await c.query('update catalogo set nombre=coalesce($2,nombre), orden=coalesce($3,orden), datos=coalesce($4,datos), activo=coalesce($5,activo) where id=$1 returning *',
      [a.id, body.nombre, body.orden, body.datos, body.activo]); // el codigo es inmutable
    await audit(c, u, 'catalogo', a.id, 'editar', a, r.rows[0]);
    return r.rows[0];
  });
  reg('DELETE', '/api/catalogos/:grupo/:id', 'catalogos.eliminar', async ({ c, u, params }) => {
    const a = (await c.query('select * from catalogo where id=$1 and grupo=$2', [params.id, params.grupo])).rows[0];
    if (!a) throw notFound();
    for (const [t, col] of USOS[params.grupo] || []) {
      const n = (await c.query(`select count(*)::int n from ${t} where ${col}=$1`, [a.id])).rows[0].n;
      if (n) { const e = bad(`En uso en ${n} registro(s) de ${t}: desactivelo en lugar de borrarlo`); e.status = 409; throw e; }
    }
    await c.query('delete from catalogo where id=$1', [a.id]);
    await audit(c, u, 'catalogo', a.id, 'eliminar', a, null);
  });

  // ---------- Conceptos financieros ----------
  reg('GET', '/api/conceptos', null, async ({ c, query }) =>
    (await c.query(`select * from concepto ${query.todos ? '' : 'where activo'} order by naturaleza, categoria, nombre`)).rows);
  reg('POST', '/api/conceptos', 'catalogos.crear', async ({ c, u, body }) => {
    if (!body.codigo || !body.nombre || !['ingreso', 'egreso', 'traspaso'].includes(body.naturaleza)) throw bad('codigo, nombre y naturaleza son obligatorios');
    const r = await c.query(
      `insert into concepto (empresa_id, codigo, nombre, naturaleza, categoria, afecto_iva, requiere_respaldo, monto_referencial) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [u.empresa_id, String(body.codigo).toUpperCase(), body.nombre, body.naturaleza, body.categoria || null, body.afecto_iva !== false, !!body.requiere_respaldo, body.monto_referencial || null]);
    await audit(c, u, 'concepto', r.rows[0].id, 'crear', null, r.rows[0]);
    return r.rows[0];
  });
  reg('PATCH', '/api/conceptos/:id', 'catalogos.editar', async ({ c, u, params, body }) => {
    const a = (await c.query('select * from concepto where id=$1', [params.id])).rows[0];
    if (!a) throw notFound();
    if (a.es_sistema && (body.activo === false)) throw bad('Los conceptos de sistema no se pueden desactivar');
    const r = await c.query(
      `update concepto set nombre=coalesce($2,nombre), categoria=coalesce($3,categoria), afecto_iva=coalesce($4,afecto_iva), requiere_respaldo=coalesce($5,requiere_respaldo),
        monto_referencial=coalesce($6,monto_referencial), activo=coalesce($7,activo) where id=$1 returning *`,
      [a.id, body.nombre, body.categoria, body.afecto_iva, body.requiere_respaldo, body.monto_referencial, body.activo]);
    await audit(c, u, 'concepto', a.id, 'editar', a, r.rows[0]); // no altera movimientos ya registrados
    return r.rows[0];
  });

  // ---------- Indices economicos ----------
  reg('GET', '/api/indices/:codigo', null, async ({ c, params, query }) =>
    (await c.query('select * from indice_valor where codigo=$1 and fecha>=coalesce($2::date,fecha) and fecha<=coalesce($3::date,fecha) order by fecha desc limit 400',
      [params.codigo.toUpperCase(), query.desde || null, query.hasta || null])).rows);
  reg('GET', '/api/indices-hoy', null, async ({ c }) =>
    (await c.query(`select distinct on (codigo) codigo, fecha, valor, origen from indice_valor where fecha<=current_date order by codigo, fecha desc`)).rows);
  reg('PUT', '/api/indices/:codigo/:fecha', 'indices.editar', async ({ c, u, params, body }) => {
    const v = Number(body.valor);
    if (!(v > 0 || (params.codigo.toUpperCase() === 'IPC' && Number.isFinite(v)))) throw bad('Valor invalido');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(params.fecha)) throw bad('fecha debe ser YYYY-MM-DD');
    const r = await c.query(`insert into indice_valor (codigo, fecha, valor, origen) values ($1,$2,$3,'manual')
      on conflict (codigo, fecha) do update set valor=excluded.valor, origen='manual', cargado_at=now() returning *`, [params.codigo.toUpperCase(), params.fecha, v]);
    await audit(c, u, 'indice', params.codigo + ':' + params.fecha, 'cargar_manual', null, { valor: v });
    return r.rows[0];
  });
  // Sincroniza UF desde fuente publica; si falla se informa para cargar manualmente (contingencia)
  reg('POST', '/api/indices-sincronizar', 'indices.editar', async ({ c, u, body }) => {
    const anio = body.anio || new Date().getFullYear();
    let serie;
    try {
      const res = await fetch(`https://mindicador.cl/api/uf/${anio}`, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      serie = (await res.json()).serie;
    } catch (e) {
      const err = bad(`No se pudo obtener la UF desde la fuente externa (${e.message}). Cargue los valores manualmente en Mantenedores > Indices.`); err.status = 502; throw err;
    }
    let n = 0;
    for (const p of serie || []) {
      await c.query(`insert into indice_valor (codigo, fecha, valor, origen) values ('UF',$1,$2,'api') on conflict (codigo, fecha) do update set valor=excluded.valor, origen='api'`, [p.fecha.slice(0, 10), p.valor]);
      n++;
    }
    await audit(c, u, 'indice', 'UF', 'sincronizar', null, { valores: n });
    return { sincronizados: n };
  });

  // ---------- Parametros de empresa ----------
  reg('GET', '/api/parametros', null, async ({ c, u }) => {
    const e = (await c.query('select razon_social, rut, iva_pct, moneda_base, parametros from empresa where id=$1', [u.empresa_id])).rows[0];
    return e;
  });
  reg('PUT', '/api/parametros', 'parametros.editar', async ({ c, u, body }) => {
    const e = (await c.query('select parametros from empresa where id=$1', [u.empresa_id])).rows[0];
    const nuevo = { ...e.parametros };
    for (const [k, v] of Object.entries(body.parametros || {})) {
      if (!PARAMS[k]) throw bad(`Parametro desconocido: ${k}`);
      if (PARAMS[k] === 'num') { if (!Number.isFinite(Number(v))) throw bad(`${k} debe ser numerico`); nuevo[k] = Number(v); }
      else nuevo[k] = v === true || v === 'true';
    }
    if (body.iva_pct !== undefined) {
      if (!(Number(body.iva_pct) >= 0 && Number(body.iva_pct) <= 100)) throw bad('iva_pct invalido');
      await c.query('update empresa set iva_pct=$2 where id=$1', [u.empresa_id, Number(body.iva_pct)]);
    }
    await c.query('update empresa set parametros=$2 where id=$1', [u.empresa_id, nuevo]);
    await audit(c, u, 'parametros', u.empresa_id, 'editar', e.parametros, nuevo);
    return { parametros: nuevo };
  });

  // ---------- Usuarios y roles (tablas sin RLS: se filtra por empresa) ----------
  reg('GET', '/api/usuarios', 'usuarios.ver', async ({ c, u }) =>
    (await c.query(`select u.id, u.email, u.nombre, u.rut, u.es_agente, u.activo, u.ultimo_acceso, r.nombre as rol, r.id as rol_id, s.nombre as sucursal
      from usuario u join rol r on r.id=u.rol_id left join sucursal s on s.id=u.sucursal_id where u.empresa_id=$1 order by u.nombre`, [u.empresa_id])).rows);
  reg('GET', '/api/agentes', null, async ({ c, u }) =>
    (await c.query('select id, nombre from usuario where empresa_id=$1 and es_agente and activo order by nombre', [u.empresa_id])).rows);
  reg('POST', '/api/usuarios', 'usuarios.crear', async ({ c, u, body }) => {
    if (!body.email || !body.nombre || !body.rol_id) throw bad('email, nombre y rol son obligatorios');
    const ec = validarClave(body.password, body.email); if (ec) throw bad(ec);
    await cuota(c, u.empresa_id, 'usuarios');
    const rol = (await c.query('select id from rol where id=$1 and empresa_id=$2', [body.rol_id, u.empresa_id])).rows[0];
    if (!rol) throw bad('Rol invalido');
    // el usuario deberá definir su propia clave en el primer ingreso
    const r = await c.query('insert into usuario (empresa_id, rol_id, email, nombre, rut, password_hash, es_agente, sucursal_id, debe_cambiar_password) values ($1,$2,$3,$4,$5,$6,$7,$8,true) returning id, email, nombre',
      [u.empresa_id, rol.id, body.email.trim(), body.nombre, body.rut || null, await bcrypt.hash(body.password, 11), !!body.es_agente, body.sucursal_id || null]);
    await audit(c, u, 'usuario', r.rows[0].id, 'crear', null, { email: body.email, rol_id: body.rol_id });
    return r.rows[0];
  });
  reg('PATCH', '/api/usuarios/:id', 'usuarios.editar', async ({ c, u, params, body }) => {
    const a = (await c.query('select u.*, r.permisos from usuario u join rol r on r.id=u.rol_id where u.id=$1 and u.empresa_id=$2', [params.id, u.empresa_id])).rows[0];
    if (!a) throw notFound();
    const nuevoRol = body.rol_id ? (await c.query('select * from rol where id=$1 and empresa_id=$2', [body.rol_id, u.empresa_id])).rows[0] : null;
    if (body.rol_id && !nuevoRol) throw bad('Rol invalido');
    const dejaDeSerAdmin = a.permisos.includes('*') && ((nuevoRol && !nuevoRol.permisos.includes('*')) || body.activo === false);
    if (dejaDeSerAdmin) {
      const n = (await c.query(`select count(*)::int n from usuario u join rol r on r.id=u.rol_id where u.empresa_id=$1 and u.activo and '*'=any(r.permisos)`, [u.empresa_id])).rows[0].n;
      if (n <= 1) throw bad('No se puede desactivar ni degradar al ultimo administrador activo');
    }
    if (body.password) { const ec = validarClave(body.password, a.email); if (ec) throw bad(ec); }
    if (body.activo === true && a.activo === false) await cuota(c, u.empresa_id, 'usuarios');
    const r = await c.query(`update usuario set nombre=coalesce($2,nombre), rol_id=coalesce($3,rol_id), activo=coalesce($4,activo), es_agente=coalesce($5,es_agente),
      password_hash=coalesce($6,password_hash), intentos_fallidos=0, bloqueado_hasta=null,
      debe_cambiar_password=case when $6 is not null then true else debe_cambiar_password end,
      token_version=case when $6 is not null or $4 is false or $3 is not null then token_version+1 else token_version end where id=$1 returning id, email, nombre, activo`,
      [a.id, body.nombre, body.rol_id, body.activo, body.es_agente, body.password ? await bcrypt.hash(body.password, 11) : null]);
    await audit(c, u, 'usuario', a.id, 'editar', { rol_id: a.rol_id, activo: a.activo }, { rol_id: body.rol_id, activo: body.activo, password_cambiada: !!body.password });
    return r.rows[0];
  });
  reg('GET', '/api/roles', 'usuarios.ver', async ({ c, u }) => (await c.query('select * from rol where empresa_id=$1 order by nombre', [u.empresa_id])).rows);
  reg('POST', '/api/roles', 'usuarios.crear', async ({ c, u, body }) => {
    if (!body.nombre || !Array.isArray(body.permisos)) throw bad('nombre y permisos son obligatorios');
    const r = await c.query('insert into rol (empresa_id, nombre, permisos, alcance) values ($1,$2,$3,$4) returning *', [u.empresa_id, body.nombre, body.permisos, body.alcance || 'empresa']);
    await audit(c, u, 'rol', r.rows[0].id, 'crear', null, r.rows[0]);
    return r.rows[0];
  });
  reg('PATCH', '/api/roles/:id', 'usuarios.editar', async ({ c, u, params, body }) => {
    const a = (await c.query('select * from rol where id=$1 and empresa_id=$2', [params.id, u.empresa_id])).rows[0];
    if (!a) throw notFound();
    const r = await c.query('update rol set permisos=coalesce($2,permisos), alcance=coalesce($3,alcance) where id=$1 returning *', [a.id, body.permisos, body.alcance]);
    await audit(c, u, 'rol', a.id, 'editar_permisos', { permisos: a.permisos, alcance: a.alcance }, { permisos: r.rows[0].permisos, alcance: r.rows[0].alcance });
    return r.rows[0];
  });

  // ---------- Periodos, auditoria, sucursales ----------
  reg('GET', '/api/periodos', 'periodos.ver', async ({ c }) => (await c.query('select * from periodo order by periodo desc limit 36')).rows);
  reg('POST', '/api/periodos/:periodo/cerrar', 'periodos.cerrar', async ({ c, u, params }) => {
    if (!/^\d{4}-\d{2}$/.test(params.periodo)) throw bad('Formato YYYY-MM');
    const pend = (await c.query(`select count(*)::int n from movimiento where periodo=$1 and requiere_aprobacion and aprobado_por is null and estado<>'anulado'`, [params.periodo])).rows[0].n;
    if (pend) throw bad(`Hay ${pend} movimiento(s) pendientes de aprobacion en el periodo`);
    await c.query(`insert into periodo (empresa_id, periodo, estado, cerrado_por, cerrado_at) values ($1,$2,'cerrado',$3,now())
      on conflict (empresa_id, periodo) do update set estado='cerrado', cerrado_por=excluded.cerrado_por, cerrado_at=now()`, [u.empresa_id, params.periodo, u.id]);
    await audit(c, u, 'periodo', params.periodo, 'cerrar');
    return { periodo: params.periodo, estado: 'cerrado' };
  });
  reg('POST', '/api/periodos/:periodo/reabrir', 'periodos.reabrir', async ({ c, u, params, body }) => {
    if (!body.motivo) throw bad('Indique el motivo de la reapertura');
    await c.query(`update periodo set estado='abierto' where periodo=$1`, [params.periodo]);
    await audit(c, u, 'periodo', params.periodo, 'reabrir', null, { motivo: body.motivo });
    return { periodo: params.periodo, estado: 'abierto' };
  });
  reg('GET', '/api/auditoria', 'auditoria.ver', async ({ c, query }) =>
    (await c.query(`select a.*, u.nombre as usuario from audit_log a left join usuario u on u.id=a.usuario_id
      where ($1::text is null or a.entidad=$1) and ($2::text is null or a.entidad_id=$2) order by a.at desc limit $3`,
      [query.entidad || null, query.entidad_id || null, Math.min(Number(query.limit) || 200, 1000)])).rows);
  reg('GET', '/api/sucursales', null, async ({ c, u }) => (await c.query('select * from sucursal where empresa_id=$1 order by nombre', [u.empresa_id])).rows);
};
