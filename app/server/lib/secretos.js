// Cifrado de credenciales en reposo (AES-256-GCM). La clave viene de INTEGRATIONS_KEY (32 bytes en hex/base64)
// o se genera una vez y se guarda en .integrations_key (permisos 600). Perder la clave = volver a ingresar credenciales.
const crypto = require('crypto'), fs = require('fs'), path = require('path');
function clave() {
  const env = process.env.INTEGRATIONS_KEY;
  if (env) return crypto.createHash('sha256').update(env).digest();
  const f = path.join(__dirname, '../../.integrations_key');
  try { return Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'hex'); } catch {}
  const k = crypto.randomBytes(32); fs.writeFileSync(f, k.toString('hex'), { mode: 0o600 }); return k;
}
const KEY = clave();
const cifrar = obj => {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const d = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), d].map(b => b.toString('base64')).join('.');
};
const descifrar = txt => {
  if (!txt) return {};
  const [iv, tag, d] = txt.split('.').map(x => Buffer.from(x, 'base64'));
  const c = crypto.createDecipheriv('aes-256-gcm', KEY, iv); c.setAuthTag(tag);
  return JSON.parse(Buffer.concat([c.update(d), c.final()]).toString('utf8'));
};
module.exports = { cifrar, descifrar };
