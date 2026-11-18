// Sitio publico (canal nativo) y captura de leads. Solo expone datos publicables.
const { pool, tx } = require('../lib/db');
const { bad, notFound, HttpError } = require('../lib/util');
const { crearLead } = require('./negocio');

const intentos = new Map(); // limitador simple por IP: 10 consultas / 10 min
function limitar(ip) {
  const ahora = Date.now(), arr = (intentos.get(ip) || []).filter(t => ahora - t < 600000);
  if (arr.length >= 10) throw new HttpError(429, 'Demasiadas consultas. Intente mas tarde.');
  arr.push(ahora); intentos.set(ip, arr);
}
async function empresaPorSlug(slug) {
  const r = await pool.query('select id, razon_social, slug from empresa where slug=$1 and activa', [slug]);
  if (!r.rows[0]) throw notFound('Empresa no encontrada');
  return r.rows[0];
}
const CAMPOS = `p.codigo, t.nombre as tipo, cm.nombre as comuna, p.dormitorios, p.banos, p.sup_util, p.sup_terreno, p.estacionamientos, p.bodegas, p.amoblada, p.acepta_mascotas,
  pu.operacion, pu.precio, pu.moneda, pu.titulo, pu.descripcion, p.fotos, pu.id as publicacion_id`;

module.exports = async function (app) {
  app.get('/public/:slug/propiedades', async (req) => {
    const e = await empresaPorSlug(req.params.slug);
    const q = req.query || {};
    const rows = await tx(e.id, async c => (await c.query(
      `select ${CAMPOS} from publicacion pu join propiedad p on p.id=pu.propiedad_id join catalogo ca on ca.id=pu.canal_id left join catalogo t on t.id=p.tipo_id left join catalogo cm on cm.id=p.comuna_id
       where pu.estado='publicada' and p.estado='publicada' and ca.datos->>'modo'='nativo' and p.deleted_at is null
         and ($1::text is null or pu.operacion=$1) and ($2::text is null or cm.nombre ilike $2) and ($3::int is null or p.dormitorios>=$3) order by pu.publicada_at desc limit 100`,
      [q.operacion || null, q.comuna || null, q.dormitorios || null])).rows);
    return { empresa: e.razon_social, propiedades: rows };
  });
  app.get('/public/:slug/propiedades/:codigo', async (req) => {
    const e = await empresaPorSlug(req.params.slug);
    const r = await tx(e.id, async c => (await c.query(
      `select ${CAMPOS} from publicacion pu join propiedad p on p.id=pu.propiedad_id join catalogo ca on ca.id=pu.canal_id left join catalogo t on t.id=p.tipo_id left join catalogo cm on cm.id=p.comuna_id
       where pu.estado='publicada' and p.estado='publicada' and ca.datos->>'modo'='nativo' and p.codigo=$1 limit 1`, [req.params.codigo])).rows[0]);
    if (!r) throw notFound();
    return { empresa: e.razon_social, ...r };
  });
  app.post('/public/:slug/contacto', async (req) => {
    limitar(req.ip);
    const b = req.body || {};
    if (b.sitio_web) return { ok: true };          // honeypot anti-bots
    if (!b.consentimiento) throw bad('Debe aceptar el tratamiento de sus datos para enviar la consulta');
    if (!b.nombre || String(b.nombre).length > 120 || !(b.email || b.telefono)) throw bad('Nombre y email o telefono son obligatorios');
    if (b.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email)) throw bad('Email invalido');
    if (b.mensaje && b.mensaje.length > 2000) throw bad('Mensaje demasiado largo');
    const e = await empresaPorSlug(req.params.slug);
    return tx(e.id, async c => {
      let propiedad_id = null, publicacion_id = null, interes = 'comprar';
      if (b.codigo) {
        const r = (await c.query(`select p.id, pu.id as pub, pu.operacion from propiedad p join publicacion pu on pu.propiedad_id=p.id where p.codigo=$1 and pu.estado='publicada' limit 1`, [b.codigo])).rows[0];
        if (r) { propiedad_id = r.id; publicacion_id = r.pub; interes = r.operacion === 'arriendo' ? 'arrendar' : 'comprar'; }
      }
      const fuente = (await c.query("select id from catalogo where grupo='fuente_lead' and codigo='WEB'")).rows[0];
      const lead = await crearLead(c, e.id, { id: null }, { nombre: b.nombre, email: b.email, telefono: b.telefono, mensaje: b.mensaje, consentimiento: true,
        propiedad_id, publicacion_id, interes, fuente_id: fuente && fuente.id });
      return { ok: true, referencia: lead.id.slice(0, 8) };
    });
  });
};
