// Aplica el esquema (idempotente). Uso: node db/setup.js
const fs = require('fs'), path = require('path');
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL || 'postgres://corretaje:corretaje_dev@127.0.0.1:5432/corretaje' });
  await c.connect();
  await c.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  await c.end();
  console.log('Esquema aplicado');
})().catch(e => { console.error(e.message); process.exit(1); });
