// Crea el primer administrador del sistema (idempotente). Uso:
//   PADMIN_EMAIL=yo@dominio.cl PADMIN_NOMBRE="Mi Nombre" node db/admin-plataforma.js     (genera y muestra una clave temporal)
// La clave temporal debe cambiarse y se obliga a activar el 2FA en el primer ingreso a /plataforma.
const bcrypt = require('bcryptjs'), crypto = require('crypto');
const { pool } = require('../server/lib/db');
const { validarClave } = require('../server/lib/util');
(async () => {
  const email = process.env.PADMIN_EMAIL;
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Defina PADMIN_EMAIL con un correo valido');
  const ex = await pool.query('select 1 from plataforma_admin where lower(email)=lower($1)', [email]);
  if (ex.rows[0]) { console.log('El administrador ya existe: sin cambios.'); return; }
  let clave = process.env.PADMIN_PASSWORD, generada = false;
  if (!clave) { do clave = crypto.randomBytes(12).toString('base64').replace(/[/+=]/g, '').slice(0, 12) + 'Aa7'; while (validarClave(clave)); generada = true; }
  const e = validarClave(clave, email); if (e) throw new Error(e);
  await pool.query('insert into plataforma_admin (email, nombre, password_hash) values ($1,$2,$3)', [email, process.env.PADMIN_NOMBRE || 'Administrador del sistema', await bcrypt.hash(clave, 12)]);
  console.log(`Administrador de plataforma creado: ${email}` + (generada ? `\nClave temporal: ${clave}\n(Se pedirá cambiarla y activar la verificación en dos pasos al ingresar a /plataforma)` : ''));
})().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
