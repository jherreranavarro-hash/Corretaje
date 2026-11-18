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
        const out = await tx(u.empresa_id, c => handler({ c, u, req, reply, body: req.body || {}, params: req.params, query: req.query || {} }));
        if (out === undefined) return reply.code(204).send();
        return out;
      },
    });
  };
}
// scope de datos por rol: 'propios' filtra por agente
const propios = u => u.alcance === 'propios';
function toCsv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = v => { if (v === null || v === undefined) return ''; const s = typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return '﻿' + [cols.join(','), ...rows.map(r => cols.map(k => esc(r[k])).join(','))].join('\n');
}
module.exports = { makeReg, propios, toCsv };
