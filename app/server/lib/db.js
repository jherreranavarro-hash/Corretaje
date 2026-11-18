const { Pool, types } = require('pg');
types.setTypeParser(1700, v => (v === null ? null : Number(v))); // numeric -> Number
types.setTypeParser(1082, v => v);                                 // date -> 'YYYY-MM-DD' (sin zona)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://corretaje:corretaje_dev@127.0.0.1:5432/corretaje',
  max: 10,
});
// Ejecuta fn dentro de una transaccion con el tenant fijado para RLS.
async function tx(empresaId, fn) {
  const c = await pool.connect();
  // las consultas sobre un mismo cliente se encolan (Promise.all seguro)
  let chain = Promise.resolve();
  const orig = c.query.bind(c);
  c.query = (...a) => { const p = chain.then(() => orig(...a)); chain = p.catch(() => {}); return p; };
  try {
    await c.query('BEGIN');
    await c.query("select set_config('app.empresa_id', $1, true)", [empresaId || '']);
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) { try { await c.query('ROLLBACK'); } catch {} throw e; }
  finally { c.release(); }
}
module.exports = { pool, tx };
