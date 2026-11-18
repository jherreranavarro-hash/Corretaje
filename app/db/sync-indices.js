// Carga la UF desde mindicador.cl (año actual y anterior). Mejor esfuerzo: si no hay internet, informa y sigue.
const { pool } = require('../server/lib/db');
(async () => {
  let n = 0;
  for (const anio of [new Date().getFullYear() - 1, new Date().getFullYear()]) {
    const r = await fetch(`https://mindicador.cl/api/uf/${anio}`, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    for (const p of (await r.json()).serie || []) { await pool.query(`insert into indice_valor (codigo, fecha, valor, origen) values ('UF',$1,$2,'api') on conflict (codigo, fecha) do update set valor=excluded.valor, origen='api'`, [p.fecha.slice(0, 10), p.valor]); n++; }
  }
  console.log(`UF sincronizada (${n} valores)`);
})().catch(e => { console.log('AVISO: no se pudo sincronizar la UF (' + e.message + '). Cárguela en Mantenedores > Índices.'); process.exitCode = 0; }).finally(() => pool.end());
