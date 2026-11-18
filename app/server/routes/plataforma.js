// Administrador del sistema (plataforma SaaS): corredoras, planes, suscripciones, soporte y auditoria.
// Realm de autenticacion separado ('plataforma'): un token de corredora NUNCA sirve aqui, ni al reves.
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool, tx } = require('../lib/db');
const { sign, authenticate } = require('../lib/auth');
const { HttpError, bad, notFound, validarClave, validarRut, normalizarRut, addMonths, hoy } = require('../lib/util');
const { cifrar, descifrar } = require('../lib/secretos');
const totp = require('../lib/totp');
const { golpe, reiniciar } = require('../lib/limitador');
const { seedEmpresa } = require('../../db/seed');

const RESERVADOS = new Set(['plataforma', 'api', 'public', 'sitio', 'c', 'admin', 'www', 'uploads', 'js', 'app', 'static', 'assets', 'login', 'demo-plataforma']);
const claveTemporal = () => { for (;;) { const p = crypto.randomBytes(12).toString('base64').replace(/[/+=]/g, '').slice(0, 12) + 'Aa7'; if (!validarClave(p)) return p; } };
const enrol = a => sign({ id: a.id, nombre: a.nombre, tv: a.token_version, reino: 'plataforma', proposito: '2fa' }, 'enrol', '10m');

async function audita(adm, accion, corredoraId, detalle, ip) {
  await pool.query('insert into plataforma_audit (admin_id, accion, corredora_id, detalle, ip) values ($1,$2,$3,$4,$5)', [adm && adm.id, accion, corredoraId || null, detalle ? JSON.stringify(detalle) : null, ip || null]);
}
// valida que el administrador siga activo y que su sesion no haya sido revocada
async function admin(req) {
  const t = authenticate(req, 'plataforma');
  const a = (await pool.query('select id, nombre, email, activo, token_version, totp_activo from plataforma_admin where id=$1', [t.id])).rows[0];
  if (!a || !a.activo || a.token_version !== t.tv || !a.totp_activo) throw new HttpError(401, 'Sesion invalida');
  return a;
}
async function uso(empresaId) {
  return tx(empresaId, async c => ({
    usuarios: (await c.query('select count(*)::int n from usuario where empresa_id=$1 and activo', [empresaId])).rows[0].n,
    propiedades: (await c.query('select count(*)::int n from propiedad where deleted_at is null')).rows[0].n,
    operaciones: (await c.query('select count(*)::int n from operacion')).rows[0].n,
  }));
}

module.exports = async function (app) {
  const preg = (method, url, handler) => app.route({ method, url: '/api/plataforma' + url, handler: async (req, reply) => {
    const a = await admin(req);
    const out = await handler({ a, req, reply, body: req.body || {}, params: req.params, query: req.query || {} });
    return out === undefined ? reply.code(204).send() : out;
  } });

  // ---------------- acceso (2FA obligatorio) ----------------
  app.post('/api/plataforma/login', async (req) => {
    const { email, password, codigo } = req.body || {};
    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') throw bad('Email y contrasena requeridos');
    if (!golpe('pip:' + req.ip, 20, 60000) || !golpe('pem:' + email.toLowerCase(), 6, 15 * 60000)) throw new HttpError(429, 'Demasiados intentos. Espere unos minutos.');
    const a = (await pool.query('select * from plataforma_admin where lower(email)=lower($1)', [email])).rows[0];
    const fallo = new HttpError(401, 'Credenciales invalidas');
    if (!a) { await bcrypt.compare(password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi'); throw fallo; }
    if (a.bloqueado_hasta && new Date(a.bloqueado_hasta) > new Date()) throw new HttpError(423, 'Cuenta bloqueada temporalmente');
    if (!(await bcrypt.compare(password, a.password_hash))) {
      await pool.query(`update plataforma_admin set intentos_fallidos=intentos_fallidos+1, bloqueado_hasta=case when intentos_fallidos+1>=5 then now()+interval '30 minutes' else bloqueado_hasta end where id=$1`, [a.id]);
      await audita(a, 'login_fallido', null, null, req.ip); throw fallo;
    }
    if (!a.activo) throw new HttpError(403, 'Cuenta inactiva');
    if (!a.totp_activo) return { requiere_enrolar_2fa: true, token_enrol: enrol(a) };
    if (!codigo) return { requiere_2fa: true };
    if (!golpe('p2fa:' + a.id, 8, 15 * 60000)) throw new HttpError(429, 'Demasiados intentos de codigo');
    if (!totp.verificar(descifrar(a.totp_secret).s, codigo)) { await audita(a, 'login_2fa_fallido', null, null, req.ip); throw new HttpError(401, 'Codigo de verificacion invalido'); }
    await pool.query('update plataforma_admin set intentos_fallidos=0, bloqueado_hasta=null, ultimo_acceso=now() where id=$1', [a.id]);
    reiniciar('pem:' + email.toLowerCase());
    await audita(a, 'login', null, null, req.ip);
    return { token: sign({ id: a.id, nombre: a.nombre, tv: a.token_version }, 'plataforma', '8h'), admin: { id: a.id, nombre: a.nombre, email: a.email } };
  });
  const quien = req => { try { return authenticate(req, 'plataforma'); } catch { const t = authenticate(req, 'enrol'); if (t.proposito !== '2fa' || t.reino !== 'plataforma') throw new HttpError(403, 'Operacion no permitida'); return t; } };
  app.post('/api/plataforma/2fa/iniciar', async (req) => {
    const t = quien(req);
    const a = (await pool.query('select email, totp_activo, token_version from plataforma_admin where id=$1', [t.id])).rows[0];
    if (!a || a.token_version !== t.tv) throw new HttpError(401, 'Sesion invalida');
    if (a.totp_activo) throw bad('Ya esta activo');
    const s = totp.nuevoSecreto();
    await pool.query('update plataforma_admin set totp_secret=$2 where id=$1', [t.id, cifrar({ s })]);
    return { secreto: s, uri: totp.uri(s, a.email, 'Corretaje Plataforma') };
  });
  app.post('/api/plataforma/2fa/activar', async (req) => {
    const t = quien(req);
    const a = (await pool.query('select totp_secret, token_version from plataforma_admin where id=$1', [t.id])).rows[0];
    if (!a || a.token_version !== t.tv || !a.totp_secret) throw bad('Inicie la configuracion primero');
    if (!golpe('p2fa:' + t.id, 8, 15 * 60000)) throw new HttpError(429, 'Demasiados intentos');
    if (!totp.verificar(descifrar(a.totp_secret).s, (req.body || {}).codigo)) throw bad('Codigo invalido');
    await pool.query('update plataforma_admin set totp_activo=true, token_version=token_version+1 where id=$1', [t.id]);
    await audita(t, '2fa_activado', null, null, req.ip);
    return { ok: true, relogin: true };
  });
  preg('POST', '/password', async ({ a, body, req }) => {
    const row = (await pool.query('select password_hash from plataforma_admin where id=$1', [a.id])).rows[0];
    const e = validarClave(body.nueva, a.email); if (e) throw bad(e);
    if (!(await bcrypt.compare(body.actual || '', row.password_hash))) throw new HttpError(401, 'Contrasena actual incorrecta');
    const n = (await pool.query('update plataforma_admin set password_hash=$2, token_version=token_version+1 where id=$1 returning token_version', [a.id, await bcrypt.hash(body.nueva, 12)])).rows[0];
    await audita(a, 'cambio_password', null, null, req.ip);
    return { token: sign({ id: a.id, nombre: a.nombre, tv: n.token_version }, 'plataforma', '8h') };
  });
  preg('GET', '/yo', async ({ a }) => a);
  preg('POST', '/admins', async ({ a, body, req }) => {
    if (!body.email || !body.nombre) throw bad('email y nombre son obligatorios');
    const temp = claveTemporal();
    const r = await pool.query('insert into plataforma_admin (email, nombre, password_hash) values ($1,$2,$3) returning id, email, nombre', [body.email.trim(), body.nombre, await bcrypt.hash(temp, 12)]);
    await audita(a, 'crear_admin', null, { email: body.email }, req.ip);
    return { ...r.rows[0], clave_temporal: temp, aviso: 'Entregue esta clave por un canal seguro; deberá cambiarla y activar el 2FA al ingresar.' };
  });

  // ---------------- resumen ----------------
  preg('GET', '/resumen', async () => {
    const e = (await pool.query(`select e.id, e.estado_suscripcion, e.suscripcion_hasta, e.prueba_hasta, p.precio_mensual_clp from empresa e left join plan p on p.id=e.plan_id`)).rows;
    const por = {}; let mrr = 0;
    for (const x of e) { por[x.estado_suscripcion] = (por[x.estado_suscripcion] || 0) + 1; if (x.estado_suscripcion === 'activa') mrr += Number(x.precio_mensual_clp || 0); }
    const venc = e.filter(x => ['activa', 'prueba'].includes(x.estado_suscripcion) && ((x.suscripcion_hasta || x.prueba_hasta) || '9999') <= addMonths(hoy(), 0).slice(0, 8) + '31' ).length;
    const sol = (await pool.query("select count(*)::int n from solicitud_contacto where estado='nueva'")).rows[0].n;
    return { corredoras: e.length, por_estado: por, ingreso_mensual_recurrente_clp: mrr, solicitudes_nuevas: sol, por_vencer_este_mes: venc };
  });

  // ---------------- corredoras ----------------
  preg('GET', '/corredoras', async () => {
    const rows = (await pool.query(`select e.id, e.slug, e.razon_social, e.rut, e.estado_suscripcion, e.prueba_hasta, e.suscripcion_hasta, e.activa, e.created_at, e.marca,
        p.id as plan_id, p.nombre as plan, p.precio_mensual_clp, p.max_usuarios, p.max_propiedades from empresa e left join plan p on p.id=e.plan_id order by e.created_at desc`)).rows;
    for (const r of rows) Object.assign(r, await uso(r.id));
    return rows;
  });
  preg('GET', '/corredoras/:id', async ({ params }) => {
    const e = (await pool.query(`select e.*, p.nombre as plan from empresa e left join plan p on p.id=e.plan_id where e.id=$1`, [params.id])).rows[0];
    if (!e) throw notFound('Corredora no encontrada');
    delete e.parametros;
    const usuarios = (await pool.query('select u.id, u.email, u.nombre, u.activo, u.ultimo_acceso, u.totp_activo, u.debe_cambiar_password, r.nombre as rol from usuario u join rol r on r.id=u.rol_id where u.empresa_id=$1 order by u.nombre', [params.id])).rows;
    const pagos = (await pool.query('select * from pago_suscripcion where corredora_id=$1 order by at desc limit 24', [params.id])).rows;
    return { ...e, usuarios, pagos, uso: await uso(params.id) };
  });
  preg('POST', '/corredoras', async ({ a, body, req }) => {
    const slug = String(body.slug || '').toLowerCase().trim();
    if (!/^[a-z0-9][a-z0-9-]{2,30}$/.test(slug) || RESERVADOS.has(slug)) throw bad('Identificador invalido: use 3-31 letras minusculas, numeros o guiones (no reservado)');
    if (!body.nombre || String(body.nombre).length > 120) throw bad('Nombre obligatorio (max 120)');
    if (!validarRut(body.rut)) throw bad('RUT invalido');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email_admin || '')) throw bad('Correo del administrador invalido');
    const plan = (await pool.query('select id from plan where id=$1 and activo', [body.plan_id])).rows[0];
    if (!plan) throw bad('Plan invalido');
    const dias = Math.min(Math.max(Number(body.dias_prueba ?? 14), 0), 90);
    const temp = claveTemporal();
    const empresaId = await tx(null, async c => {
      const r = await seedEmpresa(c, { slug, razon: body.nombre.trim(), rut: normalizarRut(body.rut), demo: false, soloAdmin: true, adminEmail: body.email_admin.trim(), password: temp });
      await c.query(`update empresa set plan_id=$2, estado_suscripcion='prueba', prueba_hasta=current_date+$3::int, marca=$4 where id=$1`, [r.empresa_id, plan.id, dias, { nombre: body.nombre.trim() }]);
      await c.query('update usuario set debe_cambiar_password=true, nombre=$2 where empresa_id=$1', [r.empresa_id, body.nombre_admin || 'Administrador']);
      return r.empresa_id;
    });
    await audita(a, 'crear_corredora', empresaId, { slug, plan_id: plan.id }, req.ip);
    return { id: empresaId, slug, usuario: body.email_admin.trim(), clave_temporal: temp, url: `/c/${slug}`,
      aviso: 'Esta clave se muestra una sola vez. Entréguela por un canal seguro: el administrador deberá cambiarla al primer ingreso.' };
  });
  preg('PATCH', '/corredoras/:id', async ({ a, params, body, req }) => {
    const e = (await pool.query('select * from empresa where id=$1', [params.id])).rows[0];
    if (!e) throw notFound('Corredora no encontrada');
    if (body.estado_suscripcion && !['prueba', 'activa', 'vencida', 'suspendida', 'cancelada'].includes(body.estado_suscripcion)) throw bad('Estado invalido');
    if (body.plan_id) { const p = (await pool.query('select 1 from plan where id=$1 and activo', [body.plan_id])).rows[0]; if (!p) throw bad('Plan invalido'); }
    for (const k of ['prueba_hasta', 'suscripcion_hasta']) if (body[k] && !/^\d{4}-\d{2}-\d{2}$/.test(body[k])) throw bad(`${k} debe ser YYYY-MM-DD`);
    await pool.query(`update empresa set plan_id=coalesce($2,plan_id), estado_suscripcion=coalesce($3,estado_suscripcion), prueba_hasta=coalesce($4,prueba_hasta), suscripcion_hasta=coalesce($5,suscripcion_hasta),
      notas_plataforma=coalesce($6,notas_plataforma), activa=coalesce($7,activa) where id=$1`, [params.id, body.plan_id, body.estado_suscripcion, body.prueba_hasta, body.suscripcion_hasta, body.notas, body.activa]);
    if (['suspendida', 'cancelada'].includes(body.estado_suscripcion) || body.activa === false) await pool.query('update usuario set token_version=token_version+1 where empresa_id=$1', [params.id]); // cierra todas las sesiones
    await audita(a, 'editar_corredora', params.id, { antes: { estado: e.estado_suscripcion, plan_id: e.plan_id }, cambios: body }, req.ip);
    return { ok: true };
  });
  preg('POST', '/corredoras/:id/pagos', async ({ a, params, body, req }) => {
    const e = (await pool.query('select e.*, p.precio_mensual_clp from empresa e left join plan p on p.id=e.plan_id where e.id=$1', [params.id])).rows[0];
    if (!e) throw notFound('Corredora no encontrada');
    const meses = Math.min(Math.max(parseInt(body.meses || 1, 10), 1), 24);
    const monto = Number(body.monto ?? Number(e.precio_mensual_clp || 0) * meses);
    if (!(monto >= 0)) throw bad('Monto invalido');
    const base = e.suscripcion_hasta && e.suscripcion_hasta > hoy() ? e.suscripcion_hasta : hoy();
    const hasta = addMonths(base, meses);
    await pool.query('insert into pago_suscripcion (corredora_id, plan_id, monto, medio, referencia, periodo_desde, periodo_hasta, registrado_por) values ($1,$2,$3,$4,$5,$6,$7,$8)', [params.id, e.plan_id, monto, body.medio || null, body.referencia || null, base, hasta, a.id]);
    await pool.query("update empresa set suscripcion_hasta=$2, estado_suscripcion='activa' where id=$1", [params.id, hasta]);
    await audita(a, 'registrar_pago', params.id, { monto, meses, hasta }, req.ip);
    return { suscripcion_hasta: hasta, estado: 'activa' };
  });
  preg('POST', '/corredoras/:id/reset-admin', async ({ a, params, body, req }) => {
    const u = (await pool.query(`select u.id, u.email from usuario u join rol r on r.id=u.rol_id where u.empresa_id=$1 and ($2::uuid is null or u.id=$2) and '*'=any(r.permisos) order by u.created_at limit 1`, [params.id, body.usuario_id || null])).rows[0];
    if (!u) throw notFound('Administrador no encontrado');
    const temp = claveTemporal();
    await pool.query('update usuario set password_hash=$2, debe_cambiar_password=true, token_version=token_version+1, intentos_fallidos=0, bloqueado_hasta=null, activo=true where id=$1', [u.id, await bcrypt.hash(temp, 11)]);
    await audita(a, 'reset_admin_corredora', params.id, { usuario: u.email }, req.ip);
    return { usuario: u.email, clave_temporal: temp, aviso: 'Se muestra una sola vez. Se cerraron sus sesiones y deberá definir una nueva clave.' };
  });
  preg('POST', '/corredoras/:id/revocar-2fa', async ({ a, params, body, req }) => {
    const r = await pool.query('update usuario set totp_activo=false, totp_secret=null, token_version=token_version+1 where id=$1 and empresa_id=$2', [body.usuario_id, params.id]);
    if (!r.rowCount) throw notFound('Usuario no encontrado');
    await audita(a, 'restablecer_2fa_usuario', params.id, { usuario_id: body.usuario_id }, req.ip);
    return { ok: true };
  });

  // ---------------- planes, solicitudes, auditoria ----------------
  preg('GET', '/planes', async () => (await pool.query('select * from plan order by precio_mensual_clp')).rows);
  preg('POST', '/planes', async ({ a, body, req }) => {
    if (!/^[a-z0-9_]{2,30}$/.test(body.codigo || '') || !body.nombre) throw bad('codigo (a-z0-9_) y nombre son obligatorios');
    const r = await pool.query('insert into plan (codigo, nombre, descripcion, precio_mensual_clp, max_usuarios, max_propiedades) values ($1,$2,$3,$4,$5,$6) returning *',
      [body.codigo, body.nombre, body.descripcion || null, Number(body.precio_mensual_clp || 0), body.max_usuarios ?? null, body.max_propiedades ?? null]);
    await audita(a, 'crear_plan', null, r.rows[0], req.ip); return r.rows[0];
  });
  preg('PATCH', '/planes/:id', async ({ a, params, body, req }) => {
    const r = await pool.query(`update plan set nombre=coalesce($2,nombre), descripcion=coalesce($3,descripcion), precio_mensual_clp=coalesce($4,precio_mensual_clp),
      max_usuarios=case when $5 then $6 else max_usuarios end, max_propiedades=case when $7 then $8 else max_propiedades end, activo=coalesce($9,activo) where id=$1 returning *`,
      [params.id, body.nombre, body.descripcion, body.precio_mensual_clp, 'max_usuarios' in body, body.max_usuarios ?? null, 'max_propiedades' in body, body.max_propiedades ?? null, body.activo]);
    if (!r.rows[0]) throw notFound(); await audita(a, 'editar_plan', null, r.rows[0], req.ip); return r.rows[0];
  });
  preg('GET', '/solicitudes', async () => (await pool.query('select * from solicitud_contacto order by at desc limit 200')).rows);
  preg('PATCH', '/solicitudes/:id', async ({ params, body }) => {
    if (!['nueva', 'contactada', 'cliente', 'descartada'].includes(body.estado)) throw bad('Estado invalido');
    await pool.query('update solicitud_contacto set estado=$2 where id=$1', [params.id, body.estado]);
  });
  preg('GET', '/auditoria', async ({ query }) => (await pool.query(
    `select a.at, a.accion, a.detalle, a.ip, pa.nombre as admin, e.slug as corredora from plataforma_audit a left join plataforma_admin pa on pa.id=a.admin_id left join empresa e on e.id=a.corredora_id
     where ($1::uuid is null or a.corredora_id=$1) order by a.at desc limit 300`, [query.corredora_id || null])).rows);

  // Contacto comercial desde la pagina publica de la plataforma
  app.post('/public/plataforma/solicitud', async (req) => {
    const b = req.body || {};
    if (b.sitio_web) return { ok: true };
    if (!golpe('sol:' + req.ip, 5, 3600000)) throw new HttpError(429, 'Demasiadas solicitudes. Intente mas tarde.');
    if (!b.nombre || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email || '') || String(b.nombre).length > 120 || String(b.mensaje || '').length > 2000) throw bad('Nombre y correo validos son obligatorios');
    await pool.query('insert into solicitud_contacto (nombre, empresa, email, telefono, mensaje, ip) values ($1,$2,$3,$4,$5,$6)', [b.nombre, String(b.empresa || '').slice(0, 120), b.email, String(b.telefono || '').slice(0, 30), b.mensaje || null, req.ip]);
    return { ok: true };
  });
};
