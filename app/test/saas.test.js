// Pruebas de la plataforma SaaS: administrador del sistema, corredoras aisladas, suscripciones, marca y seguridad.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const BASE = process.env.TEST_ADMIN_URL || 'postgres://corretaje:corretaje_dev@127.0.0.1:5432/postgres';
const TESTDB = 'corretaje_test';
process.env.DATABASE_URL = BASE.replace(/\/[^/]*$/, '/' + TESTDB);
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123456';
process.env.BASE_DOMAIN = 'corretaje.test';

let app, totp, cifrar;
const call = async (method, url, token, body, headers = {}) => {
  const r = await app.inject({ method, url, headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers }, payload: body });
  let json; try { json = r.json(); } catch { json = r.body; }
  return { status: r.statusCode, body: json, headers: r.headers };
};
const ok = async (...a) => { const r = await call(...a); assert.ok(r.status >= 200 && r.status < 300, `${a[0]} ${a[1]} -> ${r.status} ${JSON.stringify(r.body)}`); return r.body; };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const CLAVE = 'Clave-Plataforma-2026';
const S = {};

before(async () => {
  const adm = new Client({ connectionString: BASE }); await adm.connect();
  await adm.query(`drop database if exists ${TESTDB} with (force)`); await adm.query(`create database ${TESTDB}`); await adm.end();
  const c = new Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
  await c.query(fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8'));
  totp = require('../server/lib/totp'); cifrar = require('../server/lib/secretos').cifrar;
  S.secreto = totp.nuevoSecreto();
  await c.query('insert into plataforma_admin (email, nombre, password_hash, totp_secret, totp_activo) values ($1,$2,$3,$4,true)', ['root@plataforma.cl', 'Root', await bcrypt.hash(CLAVE, 10), cifrar({ s: S.secreto })]);
  await c.query('insert into plataforma_admin (email, nombre, password_hash) values ($1,$2,$3)', ['nuevo@plataforma.cl', 'Nuevo', await bcrypt.hash(CLAVE, 10)]);
  await c.end();
  const { build } = require('../server/index'); app = build(); await app.ready();
});
after(async () => { await app.close(); await require('../server/lib/db').pool.end(); });

const loginP = async () => (await ok('POST', '/api/plataforma/login', null, { email: 'root@plataforma.cl', password: CLAVE, codigo: totp.codigo(S.secreto) })).token;
async function nuevaCorredora(P, slug, plan, extra = {}) {
  const planes = await ok('GET', '/api/plataforma/planes', P);
  const r = await ok('POST', '/api/plataforma/corredoras', P, { nombre: 'Corredora ' + slug, rut: rutDe(76000000 + (++S.n || (S.n = 1))), slug, nombre_admin: 'Admin ' + slug, email_admin: `admin@${slug}.cl`, plan_id: planes.find(p => p.codigo === plan).id, ...extra });
  const l1 = await ok('POST', '/api/auth/login', null, { email: `admin@${slug}.cl`, password: r.clave_temporal });
  assert.ok(l1.requiere_cambio_password, 'primer ingreso exige cambiar la clave');
  await ok('POST', '/api/auth/cambiar-inicial', l1.token_enrol, { nueva: `Nueva-Clave-${slug}-9` });
  const l2 = await ok('POST', '/api/auth/login', null, { email: `admin@${slug}.cl`, password: `Nueva-Clave-${slug}-9` });
  return { ...r, token: l2.token, id: r.id, email: `admin@${slug}.cl`, pass: `Nueva-Clave-${slug}-9` };
}
function rutDe(n) { let sum = 0, m = 2; for (const d of String(n).split('').reverse()) { sum += d * m; m = m === 7 ? 2 : m + 1; } const r = 11 - (sum % 11); return `${n}-${r === 11 ? '0' : r === 10 ? 'K' : r}`; }
function dvK() { const { validarRut } = require('../server/lib/util'); for (const d of '0123456789K') if (validarRut('76543210-' + d)) return d; }

test('administrador de plataforma: 2FA obligatorio, enrolamiento y separacion de realms', async () => {
  assert.equal((await call('POST', '/api/plataforma/login', null, { email: 'root@plataforma.cl', password: 'mala' })).status, 401);
  const s1 = await ok('POST', '/api/plataforma/login', null, { email: 'root@plataforma.cl', password: CLAVE });
  assert.equal(s1.requiere_2fa, true); assert.ok(!s1.token);
  assert.equal((await call('POST', '/api/plataforma/login', null, { email: 'root@plataforma.cl', password: CLAVE, codigo: '000000' })).status, 401);
  S.P = await loginP();
  // admin sin 2FA: debe enrolar antes de entrar
  const e1 = await ok('POST', '/api/plataforma/login', null, { email: 'nuevo@plataforma.cl', password: CLAVE });
  assert.equal(e1.requiere_enrolar_2fa, true); assert.ok(!e1.token);
  assert.equal((await call('GET', '/api/plataforma/resumen', e1.token_enrol)).status, 401, 'el token de enrolamiento no sirve para operar');
  const ini = await ok('POST', '/api/plataforma/2fa/iniciar', e1.token_enrol);
  assert.equal((await call('POST', '/api/plataforma/2fa/activar', e1.token_enrol, { codigo: '123456' })).status, 422);
  await ok('POST', '/api/plataforma/2fa/activar', e1.token_enrol, { codigo: totp.codigo(ini.secreto) });
  assert.equal((await ok('POST', '/api/plataforma/login', null, { email: 'nuevo@plataforma.cl', password: CLAVE, codigo: totp.codigo(ini.secreto) })).admin.email, 'nuevo@plataforma.cl');
  assert.equal((await call('GET', '/api/plataforma/resumen')).status, 401);
  assert.equal((await call('GET', '/api/plataforma/resumen', 'basura')).status, 401);
});

test('crear corredoras aisladas, primer ingreso, marca y cuotas del plan', async () => {
  const P = S.P;
  const planes = await ok('GET', '/api/plataforma/planes', P); const pl = planes[0].id;
  const base = { nombre: 'X', rut: '76.543.210-' + dvK(), slug: 'xyz', nombre_admin: 'A', email_admin: 'a@x.cl', plan_id: pl };
  for (const [mal, campo] of [[{ slug: 'plataforma' }, 'slug reservado'], [{ slug: 'A B' }, 'slug invalido'], [{ rut: '1.111.111-1' }, 'rut'], [{ email_admin: 'no' }, 'correo'], [{ plan_id: 9999 }, 'plan']])
    assert.equal((await call('POST', '/api/plataforma/corredoras', P, { ...base, ...mal })).status, 422, campo);
  // plan de prueba con cuotas chicas
  const chico = await ok('POST', '/api/plataforma/planes', P, { codigo: 'mini', nombre: 'Mini', precio_mensual_clp: 1000, max_usuarios: 2, max_propiedades: 1 });
  S.A = await nuevaCorredora(P, 'alfa', 'mini'); S.B = await nuevaCorredora(P, 'beta', 'empresa');
  assert.equal((await call('POST', '/api/plataforma/corredoras', P, { ...base, slug: 'alfa' })).status, 409, 'slug duplicado');
  // aislamiento por corredora
  const dir = tk => ({ direccion: 'Calle 1', moneda_venta: 'UF' });
  const pA = await ok('POST', '/api/propiedades', S.A.token, dir());
  assert.equal((await ok('GET', '/api/propiedades', S.B.token)).length, 0, 'B no ve lo de A');
  assert.equal((await call('GET', `/api/propiedades/${pA.id}`, S.B.token)).status, 404);
  // cuotas del plan: 1 propiedad, 2 usuarios
  assert.equal((await call('POST', '/api/propiedades', S.A.token, { direccion: 'Calle 2' })).status, 402, 'cuota de propiedades');
  const roles = await ok('GET', '/api/roles', S.A.token);
  const nu = n => ({ email: `u${n}@alfa.cl`, nombre: 'U' + n, rol_id: roles.find(r => r.nombre === 'Agente').id, password: 'Clave-Inicial-9' + n });
  await ok('POST', '/api/usuarios', S.A.token, nu(1));
  assert.equal((await call('POST', '/api/usuarios', S.A.token, nu(2))).status, 402, 'cuota de usuarios');
  assert.equal((await call('POST', '/api/usuarios', S.B.token, { ...nu(3), password: '12345' })).status, 422, 'politica de clave');
  // marca
  assert.equal((await ok('GET', '/api/marca', S.A.token)).nombre, 'Corredora alfa');
  assert.equal((await call('PUT', '/api/marca', S.A.token, { color: 'rojo' })).status, 422);
  assert.equal((await call('PUT', '/api/marca', S.A.token, { web: 'javascript:alert(1)' })).status, 422);
  assert.equal((await call('POST', '/api/marca/logo', S.A.token, { data_url: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' })).status, 422, 'SVG rechazado');
  assert.equal((await call('POST', '/api/marca/logo', S.A.token, { data_url: 'data:image/png;base64,' + Buffer.from('no soy imagen').toString('base64') })).status, 422, 'contenido falso');
  await ok('PUT', '/api/marca', S.A.token, { nombre: 'Alfa Propiedades', lema: 'Tu hogar', color: '#0a7d4b', color2: '#102a43', email: 'hola@alfa.cl', web: 'https://alfa.cl' });
  const lg = await ok('POST', '/api/marca/logo', S.A.token, { data_url: PNG });
  const pub = await ok('GET', '/public/alfa/marca');
  assert.equal(pub.nombre, 'Alfa Propiedades'); assert.equal(pub.color, '#0a7d4b'); assert.equal(pub.logo, lg.logo); assert.ok(!('razon_social' in pub) && !('rut' in pub));
  assert.equal((await call('GET', '/public/beta/marca')).body.nombre, 'Corredora beta', 'cada corredora con su marca');
  assert.equal((await call('GET', '/public/noexiste/marca')).status, 404);
  assert.equal((await call('PUT', '/api/marca', S.B.token, { nombre: 'Otra' })).status, 200);
  assert.equal((await ok('GET', '/public/alfa/marca')).nombre, 'Alfa Propiedades', 'editar B no afecta a A');
  // documentos con la marca de la corredora
  const own = await ok('POST', '/api/personas', S.B.token, { nombre: 'Dueña', roles: ['propietario'] });
  const html = (await app.inject({ method: 'GET', url: '/api/documentos/' + (await (async () => {
    const tipo = (await ok('GET', '/api/catalogos/tipo_propiedad', S.B.token))[0].id, com = (await ok('GET', '/api/catalogos/comuna', S.B.token))[0].id;
    const p = await ok('POST', '/api/propiedades', S.B.token, { direccion: 'Doc 1', tipo_id: tipo, comuna_id: com });
    await ok('PUT', `/api/propiedades/${p.id}/propietarios`, S.B.token, { propietarios: [{ persona_id: own.id, porcentaje: 100 }] });
    const m = await ok('POST', `/api/propiedades/${p.id}/mandatos`, S.B.token, { tipo: 'venta', fecha_inicio: '2026-01-01', fecha_fin: '2027-01-01' });
    return (await ok('POST', '/api/documentos/generar', S.B.token, { plantilla_tipo: 'mandato_venta', entidad: 'mandato', entidad_id: m.id })).id; })()) + '/html', headers: { authorization: 'Bearer ' + S.B.token } })).body;
  assert.match(html, /Otra/);
});

test('suscripcion: suspension, solo lectura por vencimiento, pago y revocacion de sesiones', async () => {
  const P = S.P, A = S.A;
  assert.equal((await call('GET', '/api/propiedades', A.token)).status, 200);
  await ok('PATCH', `/api/plataforma/corredoras/${A.id}`, P, { estado_suscripcion: 'suspendida' });
  assert.equal((await call('GET', '/api/propiedades', A.token)).status, 401, 'las sesiones abiertas se cierran');
  const lg = await call('POST', '/api/auth/login', null, { email: A.email, password: A.pass });
  assert.equal(lg.status, 403); assert.match(lg.body.error, /suspendida/);
  assert.equal((await call('GET', '/public/alfa/marca')).status, 404, 'cuenta suspendida no expone nada publico');
  await ok('PATCH', `/api/plataforma/corredoras/${A.id}`, P, { estado_suscripcion: 'activa' });
  A.token = (await ok('POST', '/api/auth/login', null, { email: A.email, password: A.pass })).token;
  assert.equal((await call('GET', '/api/propiedades', A.token)).status, 200);
  // vencida => solo lectura
  await ok('PATCH', `/api/plataforma/corredoras/${A.id}`, P, { estado_suscripcion: 'vencida' });
  assert.equal((await call('GET', '/api/propiedades', A.token)).status, 200, 'lectura permitida');
  const w = await call('PATCH', `/api/propiedades/${(await ok('GET', '/api/propiedades', A.token))[0].id}`, A.token, { descripcion: 'x' });
  assert.equal(w.status, 402); assert.match(w.body.error, /solo lectura/);
  // pago manual reactiva y extiende
  const pago = await ok('POST', `/api/plataforma/corredoras/${A.id}/pagos`, P, { meses: 2, medio: 'transferencia', referencia: 'TRX-1' });
  assert.equal(pago.estado, 'activa'); assert.ok(pago.suscripcion_hasta > new Date().toISOString().slice(0, 10));
  assert.equal((await call('PATCH', `/api/propiedades/${(await ok('GET', '/api/propiedades', A.token))[0].id}`, A.token, { descripcion: 'x' })).status, 200);
  // prueba vencida por fecha
  await ok('PATCH', `/api/plataforma/corredoras/${A.id}`, P, { estado_suscripcion: 'prueba', prueba_hasta: '2020-01-01' });
  assert.equal((await call('PATCH', `/api/propiedades/${(await ok('GET', '/api/propiedades', A.token))[0].id}`, A.token, { descripcion: 'y' })).status, 402);
  await ok('PATCH', `/api/plataforma/corredoras/${A.id}`, P, { estado_suscripcion: 'activa' });
  // un token de corredora no sirve en la plataforma y viceversa
  assert.equal((await call('GET', '/api/plataforma/corredoras', A.token)).status, 401);
  assert.equal((await call('GET', '/api/propiedades', P)).status, 401);
  // reset de clave del admin por la plataforma revoca sesiones y obliga a cambiarla
  const rs = await ok('POST', `/api/plataforma/corredoras/${A.id}/reset-admin`, P, {});
  assert.equal((await call('GET', '/api/propiedades', A.token)).status, 401);
  assert.ok((await ok('POST', '/api/auth/login', null, { email: A.email, password: rs.clave_temporal })).requiere_cambio_password);
});

test('seguridad: 2FA de usuario, revocacion por cambio de clave, limites y cabeceras', async () => {
  const B = S.B;
  // 2FA opcional del usuario
  const ini = await ok('POST', '/api/auth/2fa/iniciar', B.token);
  assert.equal((await call('POST', '/api/auth/2fa/activar', B.token, { codigo: '000000' })).status, 422);
  await ok('POST', '/api/auth/2fa/activar', B.token, { codigo: totp.codigo(ini.secreto) });
  assert.equal((await call('GET', '/api/propiedades', B.token)).status, 401, 'activar 2FA cierra sesiones');
  const l1 = await ok('POST', '/api/auth/login', null, { email: B.email, password: B.pass }); assert.equal(l1.requiere_2fa, true); assert.ok(!l1.token);
  assert.equal((await call('POST', '/api/auth/login', null, { email: B.email, password: B.pass, codigo: '111111' })).status, 401);
  B.token = (await ok('POST', '/api/auth/login', null, { email: B.email, password: B.pass, codigo: totp.codigo(ini.secreto) })).token;
  // cambio de clave revoca el token anterior; politica de clave
  assert.equal((await call('POST', '/api/auth/password', B.token, { actual: B.pass, nueva: 'corta' })).status, 422);
  assert.equal((await call('POST', '/api/auth/password', B.token, { actual: 'incorrecta-123', nueva: 'Otra-Clave-Larga-9' })).status, 401);
  const viejo = B.token;
  const cp = await ok('POST', '/api/auth/password', B.token, { actual: B.pass, nueva: 'Otra-Clave-Larga-9' });
  assert.equal((await call('GET', '/api/propiedades', viejo)).status, 401, 'el token anterior queda revocado');
  assert.equal((await call('GET', '/api/propiedades', cp.token)).status, 200);
  // el gerente puede exigir 2FA a todos
  await ok('PUT', '/api/parametros', cp.token, { parametros: { exigir_2fa: true } });
  assert.equal((await call('POST', '/api/auth/2fa/desactivar', cp.token, { password: 'Otra-Clave-Larga-9', codigo: totp.codigo(ini.secreto) })).status, 422, 'no se puede desactivar si es obligatorio');
  // cabeceras de seguridad
  const h = (await call('GET', '/')).headers;
  assert.match(h['content-security-policy'], /script-src 'self'/); assert.equal(h['x-frame-options'], 'DENY'); assert.equal(h['x-content-type-options'], 'nosniff'); assert.ok(!h['x-powered-by']);
  assert.equal((await call('GET', '/api/health')).headers['cache-control'], 'no-store');
  // limite de intentos por correo
  let ultimo; for (let i = 0; i < 12; i++) ultimo = await call('POST', '/api/auth/login', null, { email: 'inexistente@x.cl', password: 'x' + i });
  assert.equal(ultimo.status, 429);
  // sin enumeracion de usuarios: mismo mensaje si no existe o clave mala
  const a = await call('POST', '/api/auth/login', null, { email: 'otro-inexistente@x.cl', password: 'abc' }), b = await call('POST', '/api/auth/login', null, { email: S.A.email, password: 'abc' });
  assert.equal(a.body.error, b.body.error);
  // JSON invalido o cuerpo vacio no revienta
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/json' }, payload: '{mal' })).statusCode, 400);
  // subdominios: slug.BASE_DOMAIN
  assert.equal((await call('GET', '/public/host', null, null, { host: 'alfa.corretaje.test' })).body.slug, 'alfa');
  assert.equal((await call('GET', '/public/host', null, null, { host: 'corretaje.test' })).body.slug, null);
  // contacto comercial publico
  assert.equal((await call('POST', '/public/plataforma/solicitud', null, { nombre: 'Bot', email: 'a@b.cl', sitio_web: 'spam' })).status, 200);
  await ok('POST', '/public/plataforma/solicitud', null, { nombre: 'Interesado', email: 'int@x.cl', empresa: 'Inmo', mensaje: 'Quiero una demo' });
  const sol = await ok('GET', '/api/plataforma/solicitudes', S.P); assert.equal(sol.length, 1);
});

test('plataforma: resumen, auditoria sin secretos y vista de corredora', async () => {
  const P = S.P;
  const r = await ok('GET', '/api/plataforma/resumen', P);
  assert.equal(r.corredoras, 2); assert.ok(r.ingreso_mensual_recurrente_clp >= 0);
  const lista = await ok('GET', '/api/plataforma/corredoras', P);
  assert.equal(lista.find(c => c.slug === 'alfa').propiedades, 1); assert.equal(lista.find(c => c.slug === 'alfa').max_propiedades, 1);
  const det = await ok('GET', `/api/plataforma/corredoras/${S.A.id}`, P);
  assert.ok(det.usuarios.length >= 2 && det.pagos.length === 1); assert.ok(!('parametros' in det));
  const aud = JSON.stringify(await ok('GET', '/api/plataforma/auditoria', P));
  for (const acc of ['crear_corredora', 'editar_corredora', 'registrar_pago', 'reset_admin_corredora', 'login']) assert.ok(aud.includes(acc), acc);
  assert.ok(!aud.includes(S.A.pass) && !aud.includes('clave_temporal'), 'la auditoria no guarda claves');
});
