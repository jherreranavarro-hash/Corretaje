const jwt = require('jsonwebtoken');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { HttpError } = require('./util');

function secret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const f = path.join(__dirname, '../../.jwt_secret');
  try { return fs.readFileSync(f, 'utf8').trim(); } catch {}
  const s = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
}
const SECRET = secret();
const sign = u => jwt.sign({ id: u.id, empresa_id: u.empresa_id, rol: u.rol, permisos: u.permisos, alcance: u.alcance, nombre: u.nombre, es_agente: u.es_agente }, SECRET, { expiresIn: '10h' });
function authenticate(req) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!t) throw new HttpError(401, 'No autenticado');
  try { return jwt.verify(t, SECRET); } catch { throw new HttpError(401, 'Sesion invalida o expirada'); }
}
// permiso 'modulo.accion'; el rol puede tener '*' o 'modulo.*'
function can(u, perm) {
  if (!perm) return true;
  const [m] = perm.split('.');
  const a = perm.split('.')[1];
  return u.permisos.includes('*') || u.permisos.includes(perm) || u.permisos.includes(m + '.*') || (a === 'ver' && u.permisos.includes('*.ver'));
}
module.exports = { sign, authenticate, can };
