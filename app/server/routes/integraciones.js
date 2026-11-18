// Configuracion de integraciones: credenciales cifradas, prueba de conexion y registro de intentos.
const { makeReg } = require('../lib/route');
const { bad, notFound, audit } = require('../lib/util');
const { cifrar, descifrar } = require('../lib/secretos');
const { DEFS, PRUEBAS, urlSegura } = require('../lib/integraciones');

const def = codigo => { const d = DEFS.find(x => x.codigo === codigo); if (!d) throw notFound('Integracion desconocida'); return d; };
// Vista sin secretos: de cada campo secreto solo se informa si esta cargado
const vista = (d, row) => {
  const sec = row && row.secretos ? descifrar(row.secretos) : {};
  return {
    codigo: d.codigo, nombre: d.nombre, grupo: d.grupo, nota: d.nota, sin_credenciales: !!d.sinCredenciales,
    campos: d.campos.map(c => ({ ...c, valor: c.secret ? '' : ((row && row.config && row.config[c.n]) ?? (sec[c.n] ?? '')), cargado: c.secret ? !!sec[c.n] : undefined })),
    activa: row ? row.activa : false, estado: row ? row.estado : 'sin_configurar', ultimo_resultado: row ? row.ultimo_resultado : null,
    ultimo_test_at: row ? row.ultimo_test_at : null, ultimo_exito_at: row ? row.ultimo_exito_at : null,
  };
};
const limpia = (txt, sec) => { let t = String(txt || ''); for (const v of Object.values(sec)) if (v && String(v).length > 3) t = t.split(String(v)).join('***'); return t.slice(0, 300); };

module.exports = async function (app) {
  const reg = makeReg(app);
  reg('GET', '/api/integraciones', 'integraciones.ver', async ({ c }) => {
    const rows = (await c.query('select * from integracion')).rows;
    return DEFS.map(d => vista(d, rows.find(r => r.codigo === d.codigo)));
  });
  reg('PUT', '/api/integraciones/:codigo', 'integraciones.editar', async ({ c, u, params, body }) => {
    const d = def(params.codigo);
    const prev = (await c.query('select * from integracion where codigo=$1', [d.codigo])).rows[0];
    const secPrev = prev && prev.secretos ? descifrar(prev.secretos) : {};
    const cfg = { ...(prev ? prev.config : {}) }, sec = { ...secPrev };
    for (const campo of d.campos) {
      const v = (body.valores || {})[campo.n];
      if (v === undefined) continue;
      if (typeof v !== 'string' || v.length > 2000) throw bad(`Valor invalido en ${campo.l}`);
      if (campo.secret) { if (v !== '') sec[campo.n] = v; }        // vacio = conservar el actual
      else cfg[campo.n] = v.trim();
    }
    for (const campo of d.campos) if (campo.req && !(campo.secret ? sec[campo.n] : cfg[campo.n])) throw bad(`Falta ${campo.l}`);
    for (const k of ['url_base', 'url_prueba']) if (cfg[k]) { try { urlSegura(cfg[k]); } catch (e) { throw bad(`${k}: ${e.message}`); } }
    const tieneSec = Object.keys(sec).length > 0;
    await c.query(
      `insert into integracion (empresa_id, codigo, activa, config, secretos, estado, actualizado_por, actualizado_at)
       values ($1,$2,$3,$4,$5,$6,$7,now()) on conflict (empresa_id, codigo) do update set config=excluded.config, secretos=excluded.secretos,
         activa=false, estado=case when integracion.estado='conectada' then 'configurada' else excluded.estado end, ultimo_resultado=null, actualizado_por=$7, actualizado_at=now()`,
      [u.empresa_id, d.codigo, false, cfg, tieneSec ? cifrar(sec) : null, 'configurada', u.id]);
    await audit(c, u, 'integracion', d.codigo, 'configurar', null, { campos_modificados: Object.keys(body.valores || {}).filter(k => (body.valores || {})[k] !== '') });  // nunca valores
    return vista(d, (await c.query('select * from integracion where codigo=$1', [d.codigo])).rows[0]);
  });
  reg('POST', '/api/integraciones/:codigo/probar', 'integraciones.editar', async ({ c, u, params }) => {
    const d = def(params.codigo);
    const row = (await c.query('select * from integracion where codigo=$1', [d.codigo])).rows[0];
    if (!row || (!row.secretos && !d.sinCredenciales && !Object.keys(row.config || {}).length)) throw bad('Primero guarde las credenciales');
    const sec = row.secretos ? descifrar(row.secretos) : {};
    const t0 = Date.now();
    let res;
    try { res = await PRUEBAS[d.modo]({ ...row.config }, { ...row.config, ...sec }); }
    catch (e) { res = { estado: 'error', detalle: 'No se pudo conectar: ' + limpia(e.cause && e.cause.code ? `${e.message} (${e.cause.code})` : e.message, sec) }; }
    const ok = res.estado === 'conectada';
    await c.query(`update integracion set estado=$2, ultimo_resultado=$3, ultimo_test_at=now(), ultimo_exito_at=case when $4 then now() else ultimo_exito_at end where codigo=$1`, [d.codigo, res.estado, res.detalle, ok]);
    await c.query('insert into integracion_log (empresa_id, codigo, operacion, ok, http_status, duracion_ms, detalle, usuario_id) values ($1,$2,$3,$4,$5,$6,$7,$8)',
      [u.empresa_id, d.codigo, 'probar', ok, res.http || null, res.ms || Date.now() - t0, res.detalle, u.id]);
    return { estado: res.estado, detalle: res.detalle };
  });
  reg('POST', '/api/integraciones/:codigo/activar', 'integraciones.editar', async ({ c, u, params, body }) => {
    const d = def(params.codigo);
    const row = (await c.query('select * from integracion where codigo=$1', [d.codigo])).rows[0];
    if (!row) throw bad('Configure la integración primero');
    if (body.activa && row.estado === 'error') throw bad('La última prueba falló: corrija las credenciales antes de activar');
    await c.query('update integracion set activa=$2 where codigo=$1', [d.codigo, !!body.activa]);
    await audit(c, u, 'integracion', d.codigo, body.activa ? 'activar' : 'desactivar');
    return { activa: !!body.activa };
  });
  reg('DELETE', '/api/integraciones/:codigo/credenciales', 'integraciones.editar', async ({ c, u, params }) => {
    const d = def(params.codigo);
    await c.query("update integracion set secretos=null, activa=false, estado='sin_configurar', ultimo_resultado=null where codigo=$1", [d.codigo]);
    await audit(c, u, 'integracion', d.codigo, 'borrar_credenciales');
  });
  reg('GET', '/api/integraciones/:codigo/logs', 'integraciones.ver', async ({ c, params }) =>
    (await c.query('select l.at, l.operacion, l.ok, l.http_status, l.duracion_ms, l.detalle, u.nombre as usuario from integracion_log l left join usuario u on u.id=l.usuario_id where l.codigo=$1 order by l.at desc limit 30', [def(params.codigo).codigo])).rows);
};
