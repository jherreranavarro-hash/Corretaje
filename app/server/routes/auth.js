const bcrypt = require('bcryptjs');
const { tx, pool } = require('../lib/db');
const { sign, authenticate } = require('../lib/auth');
const { HttpError, bad, validarClave, audit } = require('../lib/util');
const { cifrar, descifrar } = require('../lib/secretos');
const totp = require('../lib/totp');
const { golpe, reiniciar } = require('../lib/limitador');

const falso = '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi';
const enrol = (u, proposito) => sign({ id: u.id, nombre: u.nombre, tv: u.token_version, reino: 'tenant', proposito }, 'enrol', '10m');

module.exports = async function (app) {
  app.post('/api/auth/login', async (req) => {
    const { email, password, codigo } = req.body || {};
    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') throw bad('Email y contrasena requeridos');
    if (!golpe('ip:' + req.ip, 40, 60000) || !golpe('em:' + email.toLowerCase(), 10, 15 * 60000)) throw new HttpError(429, 'Demasiados intentos. Espere unos minutos.');
    const r = await pool.query(
      `select u.*, r.nombre as rol_nombre, r.permisos, r.alcance, e.activa as empresa_activa, e.slug, e.estado_suscripcion, e.parametros, e.marca
       from usuario u join rol r on r.id=u.rol_id join empresa e on e.id=u.empresa_id where lower(u.email)=lower($1)`, [email]);
    const u = r.rows[0];
    const fallo = new HttpError(401, 'Credenciales invalidas');
    if (!u) { await bcrypt.compare(password, falso); throw fallo; }
    if (u.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date()) throw new HttpError(423, 'Cuenta bloqueada temporalmente por intentos fallidos');
    if (!(await bcrypt.compare(password, u.password_hash))) {
      await pool.query(`update usuario set intentos_fallidos=intentos_fallidos+1,
        bloqueado_hasta=case when intentos_fallidos+1>=5 then now()+interval '15 minutes' else bloqueado_hasta end where id=$1`, [u.id]);
      await tx(u.empresa_id, c => audit(c, { empresa_id: u.empresa_id, id: u.id }, 'sesion', u.id, 'login_fallido', null, { ip: req.ip }));
      throw fallo;
    }
    if (!u.activo) throw new HttpError(403, 'Usuario inactivo');
    if (!u.empresa_activa || ['suspendida', 'cancelada'].includes(u.estado_suscripcion)) throw new HttpError(403, 'La cuenta de la corredora esta suspendida. Contacte al administrador del servicio.');
    if (u.debe_cambiar_password) return { requiere_cambio_password: true, token_enrol: enrol(u, 'cambio_password') };
    if (u.totp_activo) {
      if (!codigo) return { requiere_2fa: true };
      if (!golpe('2fa:' + u.id, 8, 15 * 60000)) throw new HttpError(429, 'Demasiados intentos de codigo. Espere unos minutos.');
      if (!totp.verificar(descifrar(u.totp_secret).s, codigo)) throw new HttpError(401, 'Codigo de verificacion invalido');
    } else if (u.parametros && u.parametros.exigir_2fa) {
      return { requiere_enrolar_2fa: true, token_enrol: enrol(u, '2fa') };
    }
    await pool.query('update usuario set intentos_fallidos=0, bloqueado_hasta=null, ultimo_acceso=now() where id=$1', [u.id]);
    reiniciar('em:' + email.toLowerCase());
    await tx(u.empresa_id, c => audit(c, { empresa_id: u.empresa_id, id: u.id }, 'sesion', u.id, 'login', null, { ip: req.ip }));
    const user = { id: u.id, empresa_id: u.empresa_id, rol: u.rol_nombre, permisos: u.permisos, alcance: u.alcance, nombre: u.nombre, es_agente: u.es_agente, tv: u.token_version };
    return { token: sign(user), usuario: { ...user, email: u.email, empresa_slug: u.slug, totp_activo: u.totp_activo, marca: u.marca, estado_suscripcion: u.estado_suscripcion } };
  });
  app.get('/api/auth/me', async (req) => authenticate(req));

  // Cambio de clave desde sesion: revoca todas las demas sesiones
  app.post('/api/auth/password', async (req) => {
    const u = authenticate(req);
    const { actual, nueva } = req.body || {};
    const row = (await pool.query('select password_hash, email, token_version from usuario where id=$1', [u.id])).rows[0];
    if (!row || row.token_version !== u.tv) throw new HttpError(401, 'Sesion revocada');
    const e = validarClave(nueva, row.email); if (e) throw bad(e);
    if (!(await bcrypt.compare(actual || '', row.password_hash))) throw new HttpError(401, 'Contrasena actual incorrecta');
    const n = (await pool.query('update usuario set password_hash=$2, token_version=token_version+1, debe_cambiar_password=false where id=$1 returning token_version', [u.id, await bcrypt.hash(nueva, 11)])).rows[0];
    await tx(u.empresa_id, c => audit(c, u, 'usuario', u.id, 'cambio_password'));
    return { ok: true, token: sign({ ...u, tv: n.token_version }) };
  });
  // Primera clave (usuario creado por la plataforma/administrador): requiere token de enrolamiento
  app.post('/api/auth/cambiar-inicial', async (req) => {
    const t = authenticate(req, 'enrol');
    if (t.proposito !== 'cambio_password') throw new HttpError(403, 'Operacion no permitida');
    const { nueva } = req.body || {};
    const row = (await pool.query('select email, empresa_id, token_version from usuario where id=$1', [t.id])).rows[0];
    if (!row || row.token_version !== t.tv) throw new HttpError(401, 'Sesion revocada');
    const e = validarClave(nueva, row.email); if (e) throw bad(e);
    await pool.query('update usuario set password_hash=$2, token_version=token_version+1, debe_cambiar_password=false where id=$1', [t.id, await bcrypt.hash(nueva, 11)]);
    await tx(row.empresa_id, c => audit(c, { empresa_id: row.empresa_id, id: t.id }, 'usuario', t.id, 'cambio_password_inicial'));
    return { ok: true };
  });

  // ---- 2FA (TOTP) del usuario: desde sesion normal o con token de enrolamiento ----
  const quien = req => { const h = req.headers.authorization || ''; try { return { t: authenticate(req, 'tenant'), enrol: false }; } catch { const t = authenticate(req, 'enrol'); if (t.proposito !== '2fa' || t.reino !== 'tenant') throw new HttpError(403, 'Operacion no permitida'); return { t, enrol: true }; } };
  app.post('/api/auth/2fa/iniciar', async (req) => {
    const { t } = quien(req);
    const row = (await pool.query('select email, totp_activo, token_version, empresa_id from usuario where id=$1', [t.id])).rows[0];
    if (!row || row.token_version !== t.tv) throw new HttpError(401, 'Sesion revocada');
    if (row.totp_activo) throw bad('La verificacion en dos pasos ya esta activa');
    const s = totp.nuevoSecreto();
    await pool.query('update usuario set totp_secret=$2 where id=$1', [t.id, cifrar({ s })]);
    return { secreto: s, uri: totp.uri(s, row.email, 'Corretaje') };
  });
  app.post('/api/auth/2fa/activar', async (req) => {
    const { t, enrol: esEnrol } = quien(req);
    const row = (await pool.query('select totp_secret, totp_activo, token_version, empresa_id from usuario where id=$1', [t.id])).rows[0];
    if (!row || row.token_version !== t.tv || !row.totp_secret) throw bad('Inicie la configuracion primero');
    if (!golpe('2fa:' + t.id, 8, 15 * 60000)) throw new HttpError(429, 'Demasiados intentos');
    if (!totp.verificar(descifrar(row.totp_secret).s, (req.body || {}).codigo)) throw bad('Codigo invalido: revise la hora del dispositivo e intente de nuevo');
    await pool.query('update usuario set totp_activo=true, token_version=token_version+1 where id=$1', [t.id]);
    await tx(row.empresa_id, c => audit(c, { empresa_id: row.empresa_id, id: t.id }, 'usuario', t.id, '2fa_activado'));
    return { ok: true, relogin: true };
  });
  app.post('/api/auth/2fa/desactivar', async (req) => {
    const t = authenticate(req, 'tenant');
    const { password, codigo } = req.body || {};
    const row = (await pool.query('select password_hash, totp_secret, totp_activo, token_version, empresa_id, (select parametros from empresa where id=usuario.empresa_id) as par from usuario where id=$1', [t.id])).rows[0];
    if (!row || row.token_version !== t.tv) throw new HttpError(401, 'Sesion revocada');
    if (row.par && row.par.exigir_2fa) throw bad('La corredora exige verificacion en dos pasos: no puede desactivarla');
    if (!(await bcrypt.compare(password || '', row.password_hash)) || !totp.verificar(descifrar(row.totp_secret).s, codigo)) throw new HttpError(401, 'Clave o codigo incorrectos');
    await pool.query('update usuario set totp_activo=false, totp_secret=null, token_version=token_version+1 where id=$1', [t.id]);
    await tx(row.empresa_id, c => audit(c, { empresa_id: row.empresa_id, id: t.id }, 'usuario', t.id, '2fa_desactivado'));
    return { ok: true, relogin: true };
  });
};
