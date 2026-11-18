const { tx } = require('./db');
const { authenticate, can } = require('./auth');
const { HttpError } = require('./util');

// Registra una ruta autenticada con permiso y transaccion con tenant (RLS).
function makeReg(app) {
  return function reg(method, url, perm, handler) {
    app.route({
      method, url,
      handler: async (req, reply) => {
        const u = authenticate(req);
        if (perm && !can(u, perm)) throw new HttpError(403, `Sin permiso (${perm})`);
        const out = await tx(u.empresa_id, async c => {
          await validarSesion(c, u, req.method);
          return handler({ c, u, req, reply, body: req.body || {}, params: req.params, query: req.query || {} });
        });
        if (out === undefined) return reply.code(204).send();
        return out;
      },
    });
  };
}
// Revoca sesiones (cambio de clave/desactivacion) y aplica el estado de la suscripcion de la corredora
async function validarSesion(c, u, metodo) {
  const r = (await c.query(
    `select us.activo, us.token_version, e.activa, e.estado_suscripcion, e.suscripcion_hasta, e.prueba_hasta
     from usuario us join empresa e on e.id=us.empresa_id where us.id=$1`, [u.id])).rows[0];
  if (!r || !r.activo || r.token_version !== u.tv) throw new HttpError(401, 'Sesion revocada: inicie sesion nuevamente');
  if (!r.activa || ['suspendida', 'cancelada'].includes(r.estado_suscripcion)) throw new HttpError(403, 'La cuenta de la corredora esta suspendida. Contacte al administrador del servicio.');
  const hoy = new Date().toISOString().slice(0, 10);
  const vencida = r.estado_suscripcion === 'vencida' || (r.estado_suscripcion === 'prueba' && r.prueba_hasta && r.prueba_hasta < hoy) || (r.estado_suscripcion === 'activa' && r.suscripcion_hasta && r.suscripcion_hasta < hoy);
  if (vencida && !['GET', 'HEAD'].includes(metodo)) throw new HttpError(402, 'La suscripcion esta vencida: la cuenta esta en modo solo lectura. Renueve el plan para continuar operando.');
}

// scope de datos por rol: 'propios' filtra por agente
const propios = u => u.alcance === 'propios';
function toCsv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = v => { if (v === null || v === undefined) return ''; const s = typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return '﻿' + [cols.join(','), ...rows.map(r => cols.map(k => esc(r[k])).join(','))].join('\n');
}
module.exports = { makeReg, propios, toCsv, validarSesion };
