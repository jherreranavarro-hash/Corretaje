const path = require('path');
const fastify = require('fastify');
const fstatic = require('@fastify/static');
const { HttpError } = require('./lib/util');
const { pool } = require('./lib/db');

function build() {
  const app = fastify({ logger: process.env.NODE_ENV === 'test' ? false : { level: 'info' }, bodyLimit: 9 * 1024 * 1024, trustProxy: process.env.TRUST_PROXY === '1' });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('X-Frame-Options', 'DENY').header('Referrer-Policy', 'same-origin')
      .header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
      .header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()').header('Cross-Origin-Opener-Policy', 'same-origin').header('Cross-Origin-Resource-Policy', 'same-origin');
    if (req.protocol === 'https') reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    return payload;
  });
  // JSON tolerante: cuerpo vacio => {} (DELETE/POST sin datos desde el navegador)
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    if (!body) return done(null, {});
    try { done(null, JSON.parse(body)); } catch { const e = new Error('JSON invalido'); e.statusCode = 400; done(e); }
  });
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message, ...(err.extra || {}) });
    if (err.validation) return reply.code(400).send({ error: err.message });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    const m = { '23505': [409, 'Registro duplicado'], '23503': [409, 'Referencia invalida o registro en uso'], '23514': [422, 'Dato fuera de rango permitido'],
      '23502': [422, 'Falta un dato obligatorio'], '23P01': [409, 'Conflicto: se superpone con otro registro vigente'], '22P02': [422, 'Formato de dato invalido'],
      '22007': [422, 'Fecha invalida'], '22008': [422, 'Fecha invalida'], '42501': [403, 'Acceso denegado'] }[err.code];
    if (err.code === 'P0001') return reply.code(422).send({ error: err.message });
    if (m) { req.log.warn({ code: err.code, detail: err.detail }, err.message); return reply.code(m[0]).send({ error: m[1] + (err.detail && m[0] === 409 ? ` (${err.detail})` : '') }); }
    req.log.error(err);
    return reply.code(500).send({ error: 'Error interno' });
  });

  app.get('/api/health', async () => { await pool.query('select 1'); return { ok: true, hora: new Date().toISOString() }; });
  app.register(require('./routes/auth'));
  app.register(require('./routes/admin'));
  app.register(require('./routes/negocio'));
  app.register(require('./routes/finanzas'));
  app.register(require('./routes/integraciones'));
  app.register(require('./routes/marca'));
  app.register(require('./routes/plataforma'));
  app.register(require('./routes/publico'));

  app.register(fstatic, { root: path.join(__dirname, '../public'), prefix: '/' });
  app.register(fstatic, { root: path.join(__dirname, '../uploads'), prefix: '/uploads/', decorateReply: false, index: false, list: false });
  app.get('/sitio/:slug', async (req, reply) => reply.sendFile('sitio.html'));
  app.get('/c/:slug', async (req, reply) => reply.sendFile('index.html'));          // acceso con marca de la corredora
  app.get('/plataforma', async (req, reply) => reply.sendFile('plataforma.html'));   // administrador del sistema
  // Subdominios (slug.BASE_DOMAIN): la interfaz consulta aqui a que corredora corresponde el host
  const slugDeHost = host => { const b = process.env.BASE_DOMAIN; if (!b || !host) return null; const h = host.split(':')[0].toLowerCase(); return h.endsWith('.' + b) ? h.slice(0, -(b.length + 1)) : null; };
  app.get('/public/host', async (req) => ({ slug: slugDeHost(req.headers.host) }));
  // Caddy "on demand TLS": solo emite certificados para subdominios de corredoras existentes
  app.get('/api/interno/dominio', async (req, reply) => {
    if (!process.env.ASK_TOKEN || req.query.token !== process.env.ASK_TOKEN) return reply.code(403).send();
    const slug = slugDeHost(String(req.query.domain || '') + (req.query.domain && !String(req.query.domain).includes(':') ? '' : ''));
    if (!slug) return reply.code(404).send();
    const r = await pool.query("select 1 from empresa where slug=$1 and activa and estado_suscripcion not in ('suspendida','cancelada')", [slug]);
    return r.rows[0] ? reply.code(200).send('ok') : reply.code(404).send();
  });
  return app;
}
module.exports = { build };

if (require.main === module) {
  require('fs').mkdirSync(path.join(__dirname, '../uploads'), { recursive: true });
  const app = build();
  const port = Number(process.env.PORT) || 3000;
  app.listen({ port, host: process.env.HOST || '0.0.0.0' }).then(() => console.log(`Corretaje en http://localhost:${port}`));
}
