const bcrypt = require('bcryptjs');
const { tx, pool } = require('../lib/db');
const { sign, authenticate } = require('../lib/auth');
const { HttpError, bad } = require('../lib/util');

module.exports = async function (app) {
  app.post('/api/auth/login', async (req) => {
    const { email, password } = req.body || {};
    if (!email || !password) throw bad('Email y contrasena requeridos');
    const r = await pool.query(
      `select u.*, r.nombre as rol_nombre, r.permisos, r.alcance, e.activa as empresa_activa, e.slug from usuario u join rol r on r.id=u.rol_id join empresa e on e.id=u.empresa_id where lower(u.email)=lower($1)`, [email]);
    const u = r.rows[0];
    const fallo = new HttpError(401, 'Credenciales invalidas');
    if (!u) { await bcrypt.compare(password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi'); throw fallo; }
    if (u.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date()) throw new HttpError(423, 'Cuenta bloqueada temporalmente por intentos fallidos');
    if (!u.activo || !u.empresa_activa) throw new HttpError(403, 'Usuario o empresa inactivos');
    if (!(await bcrypt.compare(password, u.password_hash))) {
      await pool.query(`update usuario set intentos_fallidos=intentos_fallidos+1,
        bloqueado_hasta=case when intentos_fallidos+1>=5 then now()+interval '15 minutes' else bloqueado_hasta end where id=$1`, [u.id]);
      throw fallo;
    }
    await pool.query('update usuario set intentos_fallidos=0, bloqueado_hasta=null, ultimo_acceso=now() where id=$1', [u.id]);
    const user = { id: u.id, empresa_id: u.empresa_id, rol: u.rol_nombre, permisos: u.permisos, alcance: u.alcance, nombre: u.nombre, es_agente: u.es_agente };
    return { token: sign(user), usuario: { ...user, email: u.email, empresa_slug: u.slug } };
  });
  app.get('/api/auth/me', async (req) => authenticate(req));
  app.post('/api/auth/password', async (req) => {
    const u = authenticate(req);
    const { actual, nueva } = req.body || {};
    if (!nueva || nueva.length < 10) throw bad('La nueva contrasena debe tener al menos 10 caracteres');
    const r = await pool.query('select password_hash from usuario where id=$1', [u.id]);
    if (!(await bcrypt.compare(actual || '', r.rows[0].password_hash))) throw new HttpError(401, 'Contrasena actual incorrecta');
    await pool.query('update usuario set password_hash=$2 where id=$1', [u.id, await bcrypt.hash(nueva, 10)]);
    return { ok: true };
  });
};
