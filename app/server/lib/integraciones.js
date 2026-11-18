// Catalogo de integraciones: campos a ingresar y prueba de conexion.
// IMPORTANTE: solo las pruebas marcadas "real" validan contra el proveedor. Las demas guardan las credenciales y, si se
// informa una URL de prueba, ejecutan una llamada autenticada generica; sin URL quedan "configurada (sin verificar)".
const net = require('net'), tls = require('tls');

const F = (n, l, o = {}) => ({ n, l, ...o });
const URL_PRUEBA = F('url_prueba', 'URL de prueba (endpoint autenticado del proveedor)', { help: 'Opcional. Si la informa, "Probar conexión" hace una llamada GET autenticada a esa URL (Basic con usuario/contraseña, o Bearer con la API key).' });
const USR = [F('usuario', 'Usuario', { req: true }), F('password', 'Contraseña', { secret: true, req: true })];

const DEFS = [
  { codigo: 'portal_inmobiliario', grupo: 'Portales', nombre: 'Portal Inmobiliario', modo: 'generica',
    nota: 'No se verificó una API pública. Ingrese las credenciales de su cuenta/convenio; la publicación seguirá siendo asistida hasta contar con la documentación del portal.', campos: [...USR, F('url_base', 'URL base de la API / feed (si el portal la entrega)'), URL_PRUEBA] },
  { codigo: 'yapo', grupo: 'Portales', nombre: 'Yapo', modo: 'generica', nota: 'Sin API pública verificada.', campos: [...USR, F('url_base', 'URL base de la API / feed'), URL_PRUEBA] },
  { codigo: 'toctoc', grupo: 'Portales', nombre: 'TocToc', modo: 'generica', nota: 'Sin API pública verificada.', campos: [...USR, F('url_base', 'URL base de la API / feed'), URL_PRUEBA] },
  { codigo: 'mercadolibre', grupo: 'Portales', nombre: 'MercadoLibre Inmuebles', modo: 'mercadolibre', nota: 'Prueba real: solicita un token con client_id/secret de su aplicación.', campos: [F('client_id', 'Client ID (App ID)', { req: true }), F('client_secret', 'Client secret', { secret: true, req: true })] },
  { codigo: 'meta', grupo: 'Redes sociales', nombre: 'Facebook / Instagram (Meta)', modo: 'meta', nota: 'Prueba real contra Graph API con un token de acceso de página/usuario de sistema.', campos: [F('page_id', 'ID de página (Facebook)'), F('instagram_id', 'ID de cuenta de Instagram Business'), F('access_token', 'Token de acceso', { secret: true, req: true })] },
  { codigo: 'whatsapp', grupo: 'Mensajería', nombre: 'WhatsApp Business (Cloud API)', modo: 'whatsapp', nota: 'Prueba real contra Graph API con el ID del número y el token.', campos: [F('phone_number_id', 'ID del número de teléfono', { req: true }), F('waba_id', 'ID de la cuenta de WhatsApp Business'), F('access_token', 'Token de acceso', { secret: true, req: true })] },
  { codigo: 'smtp', grupo: 'Mensajería', nombre: 'Correo saliente (SMTP)', modo: 'smtp', nota: 'La prueba verifica que el servidor responda; la autenticación no se valida desde aquí.', campos: [F('host', 'Servidor SMTP', { req: true }), F('port', 'Puerto', { req: true, ph: '587' }), F('remitente', 'Remitente (From)'), F('usuario', 'Usuario', { req: true }), F('password', 'Contraseña', { secret: true, req: true })] },
  { codigo: 'firma_electronica', grupo: 'Documentos', nombre: 'Firma electrónica', modo: 'generica', nota: 'Elija proveedor e ingrese sus credenciales de API.', campos: [F('proveedor', 'Proveedor'), F('url_base', 'URL base de la API'), F('usuario', 'Usuario / Client ID'), F('password', 'Contraseña / Secret', { secret: true }), F('api_key', 'API key', { secret: true }), URL_PRUEBA] },
  { codigo: 'sii_facturacion', grupo: 'Finanzas', nombre: 'Facturación electrónica (SII, vía proveedor)', modo: 'generica', nota: 'Proveedor certificado de su elección.', campos: [F('proveedor', 'Proveedor'), F('rut_empresa', 'RUT empresa emisora'), F('url_base', 'URL base de la API'), F('usuario', 'Usuario'), F('password', 'Contraseña', { secret: true }), F('api_key', 'API key', { secret: true }), URL_PRUEBA] },
  { codigo: 'pasarela_pago', grupo: 'Finanzas', nombre: 'Pasarela de pago', modo: 'generica', nota: 'Para cobro en línea de arriendos.', campos: [F('proveedor', 'Proveedor'), F('codigo_comercio', 'Código de comercio'), F('url_base', 'URL base de la API'), F('api_key', 'API key / secret', { secret: true, req: true }), URL_PRUEBA] },
  { codigo: 'banco_cartolas', grupo: 'Finanzas', nombre: 'Banco (cartolas / conciliación)', modo: 'generica', nota: 'Solo si el banco ofrece acceso por API. Guarde solo credenciales de API, no la clave de su banca en línea personal.', campos: [F('banco', 'Banco'), F('url_base', 'URL base de la API'), F('usuario', 'Usuario / Client ID'), F('password', 'Contraseña / Secret', { secret: true }), URL_PRUEBA] },
  { codigo: 'indicadores', grupo: 'Indicadores', nombre: 'Indicadores económicos (UF, IPC, USD)', modo: 'indicadores', nota: 'Fuente pública sin credenciales (mindicador.cl). Puede cambiar la URL.', campos: [F('url_base', 'URL base', { ph: 'https://mindicador.cl/api' })], sinCredenciales: true },
];

// Bloquea destinos internos en URLs ingresadas por el usuario (mitiga SSRF)
function urlSegura(u) {
  let x; try { x = new URL(u); } catch { throw new Error('URL invalida'); }
  if (x.protocol !== 'https:') throw new Error('Solo se permiten URLs https');
  const h = x.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1|\[?fc|\[?fd|\[?fe80)/.test(h)) throw new Error('Destino no permitido');
  return x.toString();
}
const ft = async (url, opt = {}) => { const t0 = Date.now(); const r = await fetch(url, { ...opt, signal: AbortSignal.timeout(12000), redirect: 'manual' }); return { r, ms: Date.now() - t0 }; };
const OK = (detalle, extra = {}) => ({ estado: 'conectada', detalle, ...extra });
const FAIL = (detalle, extra = {}) => ({ estado: 'error', detalle, ...extra });
const SIN = detalle => ({ estado: 'configurada', detalle });

const PRUEBAS = {
  async generica(cfg, sec) {
    if (!cfg.url_prueba) return SIN('Credenciales guardadas. Sin URL de prueba: no se pudo verificar la conexión.');
    const headers = { Accept: 'application/json' };
    if (sec.usuario && sec.password) headers.Authorization = 'Basic ' + Buffer.from(`${sec.usuario}:${sec.password}`).toString('base64');
    else if (sec.api_key) headers.Authorization = 'Bearer ' + sec.api_key;
    const { r, ms } = await ft(urlSegura(cfg.url_prueba), { headers });
    if (r.status >= 200 && r.status < 300) return OK('Respuesta ' + r.status, { http: r.status, ms });
    if (r.status === 401 || r.status === 403) return FAIL('Credenciales rechazadas (' + r.status + ')', { http: r.status, ms });
    return FAIL('El proveedor respondió ' + r.status, { http: r.status, ms });
  },
  async mercadolibre(cfg, sec) {
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: sec.client_id || cfg.client_id || '', client_secret: sec.client_secret || '' });
    const { r, ms } = await ft('https://api.mercadolibre.com/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body });
    return r.ok ? OK('Token obtenido', { http: r.status, ms }) : FAIL('Credenciales rechazadas o aplicación inválida (' + r.status + ')', { http: r.status, ms });
  },
  async meta(cfg, sec) {
    const { r, ms } = await ft('https://graph.facebook.com/v19.0/me?fields=id,name', { headers: { Authorization: 'Bearer ' + (sec.access_token || '') } });
    const j = await r.json().catch(() => ({}));
    return r.ok ? OK(`Conectado como ${j.name || j.id}`, { http: r.status, ms }) : FAIL((j.error && j.error.message) || 'Token inválido (' + r.status + ')', { http: r.status, ms });
  },
  async whatsapp(cfg, sec) {
    const { r, ms } = await ft(`https://graph.facebook.com/v19.0/${encodeURIComponent(cfg.phone_number_id || '')}?fields=display_phone_number,verified_name`, { headers: { Authorization: 'Bearer ' + (sec.access_token || '') } });
    const j = await r.json().catch(() => ({}));
    return r.ok ? OK(`Número ${j.display_phone_number || cfg.phone_number_id}`, { http: r.status, ms }) : FAIL((j.error && j.error.message) || 'Token o ID inválido (' + r.status + ')', { http: r.status, ms });
  },
  async indicadores(cfg) {
    const base = urlSegura(cfg.url_base || 'https://mindicador.cl/api');
    const { r, ms } = await ft(base.replace(/\/$/, '') + '/uf', { headers: { Accept: 'application/json' } });
    return r.ok ? OK('Fuente disponible', { http: r.status, ms }) : FAIL('La fuente respondió ' + r.status, { http: r.status, ms });
  },
  async smtp(cfg) {
    const port = Number(cfg.port) || 587, host = cfg.host;
    if (!host) return FAIL('Falta el servidor');
    urlSegura('https://' + host);
    const t0 = Date.now();
    const banner = await new Promise((res, rej) => {
      const s = (port === 465 ? tls.connect({ host, port, servername: host }) : net.connect({ host, port }));
      s.setTimeout(10000, () => { s.destroy(); rej(new Error('Tiempo de espera agotado')); });
      s.once('data', d => { s.end(); res(String(d).trim().slice(0, 120)); }); s.once('error', rej);
    });
    return /^220/.test(banner) ? SIN(`Servidor SMTP responde (${banner}). La autenticación no se validó.`) : FAIL('Respuesta inesperada: ' + banner, { ms: Date.now() - t0 });
  },
};

module.exports = { DEFS, PRUEBAS, urlSegura };
