// TOTP (RFC 6238) sin dependencias: compatible con Google Authenticator, Microsoft Authenticator, Authy, 1Password…
const crypto = require('crypto');
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const b32enc = buf => { let bits = '', out = ''; for (const b of buf) bits += b.toString(2).padStart(8, '0'); for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)]; return out; };
const b32dec = s => { let bits = ''; for (const c of s.replace(/=+$/, '').toUpperCase()) { const i = B32.indexOf(c); if (i < 0) throw new Error('base32'); bits += i.toString(2).padStart(5, '0'); } const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); };
const nuevoSecreto = () => b32enc(crypto.randomBytes(20));
function codigo(secreto, t = Date.now(), paso = 30) {
  const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(Math.floor(t / 1000 / paso)));
  const h = crypto.createHmac('sha1', b32dec(secreto)).update(c).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
}
// acepta el codigo actual y +-1 paso (desfase de reloj); comparacion en tiempo constante
function verificar(secreto, entrada, t = Date.now()) {
  const e = String(entrada || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(e)) return false;
  let ok = false;
  for (const d of [-1, 0, 1]) { const c = codigo(secreto, t + d * 30000); if (crypto.timingSafeEqual(Buffer.from(c), Buffer.from(e))) ok = true; }
  return ok;
}
const uri = (secreto, cuenta, emisor) => `otpauth://totp/${encodeURIComponent(emisor)}:${encodeURIComponent(cuenta)}?secret=${secreto}&issuer=${encodeURIComponent(emisor)}&algorithm=SHA1&digits=6&period=30`;
module.exports = { nuevoSecreto, codigo, verificar, uri };
