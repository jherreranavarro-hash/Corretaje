const { HttpError } = require('./util');
// Cuotas del plan contratado (NULL = ilimitado; empresa sin plan = sin limites)
async function cuota(c, empresaId, tipo) {
  const e = (await c.query('select p.max_usuarios, p.max_propiedades, p.nombre from empresa e left join plan p on p.id=e.plan_id where e.id=$1', [empresaId])).rows[0];
  if (!e) return;
  const max = tipo === 'usuarios' ? e.max_usuarios : e.max_propiedades;
  if (max === null || max === undefined) return;
  const n = tipo === 'usuarios'
    ? (await c.query('select count(*)::int n from usuario where empresa_id=$1 and activo', [empresaId])).rows[0].n
    : (await c.query('select count(*)::int n from propiedad where deleted_at is null').catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n;
  if (n >= max) throw new HttpError(402, `Su plan ${e.nombre} permite hasta ${max} ${tipo}. Amplíe el plan para agregar más.`);
}
module.exports = { cuota };
