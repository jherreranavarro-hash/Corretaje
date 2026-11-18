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
// Tres tipos de token: 'tenant' (usuario de una corredora), 'plataforma' (administrador del sistema) y 'enrol' (solo para configurar 2FA / cambiar clave)
const sign = (u, tipo = 'tenant', exp = '10h') => jwt.sign({ ...(tipo === 'tenant' ? {
  id: u.id, empresa_id: u.empresa_id, rol: u.rol, permisos: u.permisos, alcance: u.alcance, nombre: u.nombre, es_agente: u.es_agente, tv: u.tv } : { id: u.id, nombre: u.nombre, tv: u.tv, reino: u.reino, proposito: u.proposito }), tipo }, SECRET, { expiresIn: exp });
function authenticate(req, tipo = 'tenant') {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!t) throw new HttpError(401, 'No autenticado');
  let p; try { p = jwt.verify(t, SECRET); } catch { throw new HttpError(401, 'Sesion invalida o expirada'); }
  if (p.tipo !== tipo) throw new HttpError(401, 'Sesion invalida para este recurso');
  return p;
}
// permiso 'modulo.accion'; el rol puede tener '*' o 'modulo.*'
function can(u, perm) {
  if (!perm) return true;
  const [m] = perm.split('.');
  const a = perm.split('.')[1];
  return u.permisos.includes('*') || u.permisos.includes(perm) || u.permisos.includes(m + '.*') || (a === 'ver' && u.permisos.includes('*.ver'));
}
module.exports = { sign, authenticate, can, SECRET };
