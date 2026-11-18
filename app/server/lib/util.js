class HttpError extends Error { constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; } }
const bad = (m, x) => new HttpError(422, m, x);
const notFound = (m = 'No encontrado') => new HttpError(404, m);
const forbidden = (m = 'Sin permiso') => new HttpError(403, m);

const round0 = n => Math.round(n);
const round4 = n => Math.round(n * 10000) / 10000;
const hoy = () => new Date().toISOString().slice(0, 10);
const periodoDe = f => String(f).slice(0, 7);
const addDays = (f, d) => { const x = new Date(f + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
const addMonths = (f, m) => { const x = new Date(f + 'T00:00:00Z'); x.setUTCMonth(x.getUTCMonth() + m); return x.toISOString().slice(0, 10); };
const diasEntre = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
const diasDelMes = p => new Date(Date.UTC(+p.slice(0, 4), +p.slice(5, 7), 0)).getUTCDate();

// RUT chileno: valida digito verificador (modulo 11)
function validarRut(rut) {
  if (!rut) return false;
  const limpio = String(rut).replace(/[.\-\s]/g, '').toUpperCase();
  if (!/^\d{7,8}[0-9K]$/.test(limpio)) return false;
  const cuerpo = limpio.slice(0, -1), dv = limpio.slice(-1);
  let suma = 0, mul = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) { suma += +cuerpo[i] * mul; mul = mul === 7 ? 2 : mul + 1; }
  const r = 11 - (suma % 11);
  const esp = r === 11 ? '0' : r === 10 ? 'K' : String(r);
  return esp === dv;
}
function normalizarRut(rut) {
  if (!rut) return null;
  const l = String(rut).replace(/[.\-\s]/g, '').toUpperCase();
  return l.slice(0, -1) + '-' + l.slice(-1);
}

async function nextSeq(c, empresaId, clave) {
  const r = await c.query(
    `insert into secuencia (empresa_id, clave, siguiente) values ($1,$2,2)
     on conflict (empresa_id, clave) do update set siguiente = secuencia.siguiente + 1 returning siguiente - 1 as n`,
    [empresaId, clave]);
  return r.rows[0].n;
}

// Valor de un indice (UF, USD...) vigente a la fecha (ultimo valor <= fecha)
async function valorIndice(c, codigo, fecha) {
  const r = await c.query('select valor from indice_valor where codigo=$1 and fecha<=$2 order by fecha desc limit 1', [codigo, fecha]);
  if (!r.rows[0]) throw bad(`No hay valor de ${codigo} para ${fecha}. Cargue el indice en Mantenedores > Indices.`);
  return Number(r.rows[0].valor);
}
async function aCLP(c, monto, moneda, fecha) {
  if (moneda === 'CLP') return { clp: round0(monto), tc: 1 };
  const tc = await valorIndice(c, moneda === 'UF' ? 'UF' : 'USD', fecha);
  return { clp: round0(monto * tc), tc };
}
async function audit(c, u, entidad, id, accion, antes, despues) {
  await c.query('insert into audit_log (empresa_id, usuario_id, entidad, entidad_id, accion, antes, despues) values ($1,$2,$3,$4,$5,$6,$7)',
    [u.empresa_id, u.id, entidad, String(id || ''), accion, antes ? JSON.stringify(antes) : null, despues ? JSON.stringify(despues) : null]);
}
async function empresaParam(c, empresaId) {
  const r = await c.query('select iva_pct, parametros from empresa where id=$1', [empresaId]);
  const e = r.rows[0] || {};
  return { iva_pct: e.iva_pct ?? 19, ...(e.parametros || {}) };
}
// Politica de clave: >= 10 caracteres, con letras y numeros, distinta del correo y sin patrones triviales
function validarClave(p, email = '') {
  if (typeof p !== 'string' || p.length < 10) return 'La clave debe tener al menos 10 caracteres';
  if (p.length > 200) return 'Clave demasiado larga';
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'La clave debe combinar letras y numeros';
  if (email && p.toLowerCase().includes(String(email).split('@')[0].toLowerCase()) && String(email).split('@')[0].length >= 4) return 'La clave no debe contener su usuario';
  if (/^(.)\1+$/.test(p) || /(1234567890|0123456789|password|contrasena|qwertyuiop)/i.test(p)) return 'Clave demasiado predecible';
  return null;
}
module.exports = { validarClave, HttpError, bad, notFound, forbidden, round0, round4, hoy, periodoDe, addDays, addMonths, diasEntre, diasDelMes,
  validarRut, normalizarRut, nextSeq, valorIndice, aCLP, audit, empresaParam };
