// Marca de cada corredora: nombre comercial, logo y colores (se aplican a la app, el sitio publico y los documentos)
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { makeReg } = require('../lib/route');
const { pool } = require('../lib/db');
const { bad, notFound, audit } = require('../lib/util');

const UPLOADS = path.join(__dirname, '../../uploads');
const HEX = /^#[0-9a-fA-F]{6}$/;
const LIM = { nombre: 80, lema: 140, email: 120, telefono: 30, web: 200, direccion: 160 };
const publica = (e) => ({ slug: e.slug, nombre: (e.marca && e.marca.nombre) || e.razon_social, lema: (e.marca && e.marca.lema) || '', logo: (e.marca && e.marca.logo) || null,
  color: (e.marca && e.marca.color) || '#1d4ed8', color2: (e.marca && e.marca.color2) || '#0f1b2d', email: (e.marca && e.marca.email) || '', telefono: (e.marca && e.marca.telefono) || '', web: (e.marca && e.marca.web) || '' });
module.exports = async function (app) {
  const reg = makeReg(app);
  // Publica (login con marca / sitio): solo datos de presentacion
  app.get('/public/:slug/marca', async (req) => {
    const r = await pool.query("select slug, razon_social, marca from empresa where slug=$1 and activa and estado_suscripcion not in ('suspendida','cancelada')", [req.params.slug]);
    if (!r.rows[0]) throw notFound('Corredora no encontrada');
    return publica(r.rows[0]);
  });
  reg('GET', '/api/marca', null, async ({ u }) => { const r = await pool.query('select slug, razon_social, marca from empresa where id=$1', [u.empresa_id]); return publica(r.rows[0]); });
  reg('PUT', '/api/marca', 'parametros.editar', async ({ c, u, body }) => {
    const prev = (await c.query('select marca from empresa where id=$1', [u.empresa_id])).rows[0].marca || {};
    const nueva = { ...prev };
    for (const k of ['nombre', 'lema', 'email', 'telefono', 'web']) if (k in body) {
      const v = String(body[k] ?? '').trim();
      if (v.length > LIM[k]) throw bad(`${k} demasiado largo (max ${LIM[k]})`);
      if (k === 'email' && v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) throw bad('Email de contacto invalido');
      if (k === 'web' && v && !/^https:\/\/[^\s<>"']+$/.test(v)) throw bad('El sitio web debe comenzar con https://');
      nueva[k] = v;
    }
    for (const k of ['color', 'color2']) if (k in body) { if (!HEX.test(body[k] || '')) throw bad(`${k} debe ser un color hexadecimal #RRGGBB`); nueva[k] = body[k].toLowerCase(); }
    await c.query('update empresa set marca=$2 where id=$1', [u.empresa_id, nueva]);
    await audit(c, u, 'marca', u.empresa_id, 'editar', prev, nueva);
    return nueva;
  });
  reg('POST', '/api/marca/logo', 'parametros.editar', async ({ c, u, body }) => {
    const m = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(body.data_url || '');
    if (!m) throw bad('Envie un logo PNG, JPG o WEBP (no se aceptan SVG)');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 1024 * 1024) throw bad('El logo no debe superar 1 MB');
    const h = buf.subarray(0, 12);
    const esPng = h.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), esJpg = h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff, esWebp = h.subarray(0, 4).toString() === 'RIFF' && h.subarray(8, 12).toString() === 'WEBP';
    if (!(esPng || esJpg || esWebp)) throw bad('El archivo no es una imagen valida');
    const dir = path.join(UPLOADS, 'marca', u.empresa_id); fs.mkdirSync(dir, { recursive: true });
    const nombre = `logo-${crypto.randomUUID()}.${esPng ? 'png' : esJpg ? 'jpg' : 'webp'}`;
    fs.writeFileSync(path.join(dir, nombre), buf);
    const prev = (await c.query('select marca from empresa where id=$1', [u.empresa_id])).rows[0].marca || {};
    if (prev.logo) fs.rm(path.join(UPLOADS, prev.logo.replace(/^\/uploads\//, '')), () => {});
    const logo = `/uploads/marca/${u.empresa_id}/${nombre}`;
    await c.query('update empresa set marca=$2 where id=$1', [u.empresa_id, { ...prev, logo }]);
    await audit(c, u, 'marca', u.empresa_id, 'logo');
    return { logo };
  });
  reg('DELETE', '/api/marca/logo', 'parametros.editar', async ({ c, u }) => {
    const prev = (await c.query('select marca from empresa where id=$1', [u.empresa_id])).rows[0].marca || {};
    if (prev.logo) fs.rm(path.join(UPLOADS, prev.logo.replace(/^\/uploads\//, '')), () => {});
    delete prev.logo; await c.query('update empresa set marca=$2 where id=$1', [u.empresa_id, prev]);
  });
};
module.exports.publica = publica;
