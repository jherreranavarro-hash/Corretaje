// Arranque: marca de la corredora, inicio de sesión (con 2FA y primer cambio de clave), menú por permisos
const MENU = [
  ['Comercial', [['dashboard', 'Panel', null], ['propiedades', 'Propiedades', 'propiedades.ver'], ['leads', 'Leads', 'leads.ver'], ['visitas', 'Visitas', 'visitas.ver'], ['personas', 'Personas', 'personas.ver'], ['publicaciones', 'Publicaciones', 'publicaciones.ver'], ['operaciones', 'Ventas y arriendos', 'operaciones.ver']]],
  ['Administración de cartera', [['contratos', 'Contratos', 'contratos.ver'], ['cobranza', 'Cobranza', 'cargos.ver'], ['ot', 'Mantenciones', 'ot.ver'], ['liquidaciones', 'Liquidaciones', 'liquidaciones.ver']]],
  ['Finanzas', [['movimientos', 'Libro de movimientos', 'movimientos.ver'], ['comisiones', 'Comisiones', 'comisiones.ver'], ['documentos', 'Documentos', 'documentos.ver'], ['reportes', 'Reportes', 'reportes.ver']]],
  ['Sistema', [['mantenedores', 'Mantenedores', 'catalogos.ver'], ['integraciones', 'Integraciones', 'integraciones.ver'], ['admin', 'Administración', 'usuarios.ver']]],
];
// ---- marca ----
A.marca = { nombre: 'Corretaje', logo: null, color: '#1d4ed8', color2: '#0f1b2d' };
A.aplicarMarca = m => {
  A.marca = { ...A.marca, ...Object.fromEntries(Object.entries(m || {}).filter(([, v]) => v)) };
  const hex = A.marca.color, r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const st = document.documentElement.style;
  st.setProperty('--pri', hex); st.setProperty('--pri-ink', lum > 0.6 ? '#0b1220' : '#ffffff'); st.setProperty('--side', A.marca.color2);
  document.title = A.marca.nombre;
  const h = $q('#side h1'); if (h) h.innerHTML = `${A.logoHtml(32) || '🏠'} ${A.esc(A.marca.nombre)}`;
};
A.logoHtml = (alto = 34) => A.marca.logo ? `<img src="${A.esc(A.marca.logo)}" alt="" style="max-height:${alto}px;max-width:150px;vertical-align:middle">` : '';
A.slugActual = async () => {
  const m = location.pathname.match(/^\/c\/([a-z0-9-]+)/); if (m) return m[1];
  try { const h = await (await fetch('/public/host')).json(); return h.slug; } catch { return null; }
};

// ---- inicio de sesión ----
A.renderLogin = async () => {
  const slug = await A.slugActual();
  if (slug) { try { const r = await fetch(`/public/${slug}/marca`); if (r.ok) A.aplicarMarca(await r.json()); } catch {} }
  const caja = html => { $q('#root').innerHTML = `<div class="login"><div class="card"><div style="text-align:center;margin-bottom:10px">${A.logoHtml(56)}<h2 style="margin:6px 0 0">${A.esc(A.marca.nombre)}</h2><p class="mut" style="margin:2px 0 0">${A.esc(A.marca.lema || 'Ingrese a su cuenta')}</p></div>${html}</div>${slug ? '' : '<p class="mut" style="text-align:center;font-size:12px">Use el enlace de acceso de su corredora.</p>'}</div>`; };
  let cred = null;
  const pasoCred = () => {
    caja(`<form id="lf"><label>Email</label><input name="email" type="email" required autocomplete="username"><label>Contraseña</label><input name="password" type="password" required autocomplete="current-password"><p><button class="pri" style="width:100%">Ingresar</button></p></form>`);
    $q('#lf').onsubmit = async ev => { ev.preventDefault(); cred = A.formData(ev.target); await intentar(); };
  };
  const intentar = async (codigo) => {
    try {
      const r = await A.api('POST', '/auth/login', codigo ? { ...cred, codigo } : cred);
      if (r.token) { sessionStorage.setItem('tk', r.token); sessionStorage.setItem('us', JSON.stringify(r.usuario)); if (r.usuario.marca) sessionStorage.setItem('mk', JSON.stringify(r.usuario.marca)); return A.start(); }
      if (r.requiere_2fa) return paso2fa();
      if (r.requiere_cambio_password) return pasoCambio(r.token_enrol);
      if (r.requiere_enrolar_2fa) return pasoEnrolar(r.token_enrol);
    } catch (x) { A.toast(x.message, true); if (codigo) pasoCred(); }
  };
  const paso2fa = () => {
    caja(`<p>Ingrese el código de 6 dígitos de su aplicación autenticadora.</p><form id="f2"><input name="c" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required autofocus><p><button class="pri" style="width:100%">Verificar</button></p></form><p style="text-align:center"><a href="#" data-act="relogin">Volver</a></p>`);
    $q('#f2').onsubmit = ev => { ev.preventDefault(); intentar(A.formData(ev.target).c); };
  };
  const pasoCambio = tok => {
    caja(`<p>Por seguridad, defina su propia contraseña para continuar.</p><form id="fc"><label>Nueva contraseña (mín. 10, con letras y números)</label><input name="nueva" type="password" required autocomplete="new-password"><label>Repita la contraseña</label><input name="rep" type="password" required autocomplete="new-password"><p><button class="pri" style="width:100%">Guardar contraseña</button></p></form>`);
    $q('#fc').onsubmit = async ev => { ev.preventDefault(); const d = A.formData(ev.target); if (d.nueva !== d.rep) return A.toast('Las contraseñas no coinciden', true);
      try { A.token = tok; await A.post('/auth/cambiar-inicial', { nueva: d.nueva }); A.token = null; A.toast('Contraseña actualizada. Ingrese nuevamente.'); cred = null; pasoCred(); } catch (x) { A.toast(x.message, true); } };
  };
  const pasoEnrolar = async tok => {
    try { A.token = tok; const s = await A.post('/auth/2fa/iniciar');
      caja(`<p>Su corredora exige <b>verificación en dos pasos</b>. En su aplicación autenticadora (Google/Microsoft Authenticator, Authy…) agregue una cuenta con esta clave:</p><p class="big" style="font-size:16px;word-break:break-all;text-align:center;letter-spacing:1px">${A.esc(s.secreto)}</p><form id="fe"><label>Código de 6 dígitos</label><input name="c" inputmode="numeric" maxlength="7" required><p><button class="pri" style="width:100%">Activar</button></p></form>`);
      $q('#fe').onsubmit = async ev => { ev.preventDefault(); try { await A.post('/auth/2fa/activar', { codigo: A.formData(ev.target).c }); A.token = null; A.toast('Verificación activada. Ingrese nuevamente.'); pasoCred(); } catch (x) { A.toast(x.message, true); } };
    } catch (x) { A.toast(x.message, true); pasoCred(); }
  };
  A.acts.relogin = () => pasoCred();
  pasoCred();
};

A.start = () => {
  A.token = sessionStorage.getItem('tk'); A.user = JSON.parse(sessionStorage.getItem('us') || 'null');
  if (!A.token || !A.user) return A.renderLogin();
  try { A.aplicarMarca(JSON.parse(sessionStorage.getItem('mk') || '{}')); } catch {}
  const venc = A.user.estado_suscripcion === 'vencida';
  $q('#root').innerHTML = `<div id="app"><nav id="side"><h1>${A.logoHtml(32) || '🏠'} ${A.esc(A.marca.nombre)}</h1>${MENU.map(([g, items]) => { const v = items.filter(([, , p]) => !p || A.can(p)); return v.length ? `<div class="grp">${g}</div>${v.map(([k, l]) => `<a href="#/${k}">${l}</a>`).join('')}` : ''; }).join('')}
    <div class="grp">Cuenta</div><a href="#" data-act="seguridad">Seguridad (clave y 2FA)</a><a href="#" data-act="salir">Salir (${A.esc(A.user.nombre)})</a></nav>
    <main id="main"><div id="top"><button id="burger" data-act="burger">☰</button><span class="mut">${A.esc(A.user.rol)}</span></div><div id="view"></div></main></div>`;
  A.refresh();
};
A.acts.salir = () => { sessionStorage.clear(); const s = location.pathname.match(/^\/c\/[a-z0-9-]+/); A.token = null; A.user = null; A.invalidar(); A.renderLogin(); };
A.logout = () => { A.toast('La sesión terminó. Ingrese nuevamente.', true); A.acts.salir(); };
A.acts.burger = () => $q('#side').classList.toggle('on');
A.acts.seguridad = () => A.modal(`<h2>Seguridad de la cuenta</h2>
  <div class="card"><b>Cambiar contraseña</b><p class="mut">Se cerrarán las demás sesiones abiertas.</p>${A.btn('Cambiar contraseña', 'pwd', null, 'pri')}</div>
  <div class="card"><b>Verificación en dos pasos (2FA)</b><p class="mut">Estado: ${A.user.totp_activo ? '<span class="ok">activada</span>' : '<span class="warn">desactivada</span>'}. Recomendado, sobre todo para administradores y finanzas.</p>
  ${A.user.totp_activo ? A.btn('Desactivar', 'tfa_off', null, 'bad') : A.btn('Activar 2FA', 'tfa_on', null, 'pri')}</div><div class="row" style="justify-content:flex-end"><button data-close>Cerrar</button></div>`);
A.acts.pwd = () => A.form({ title: 'Cambiar contraseña', fields: [{ n: 'actual', l: 'Contraseña actual', t: 'password', req: true }, { n: 'nueva', l: 'Nueva contraseña (mín. 10, letras y números)', t: 'password', req: true }],
  onSubmit: async d => { const r = await A.post('/auth/password', d); sessionStorage.setItem('tk', r.token); A.token = r.token; A.toast('Contraseña actualizada'); } });
A.acts.tfa_on = async () => { try { const s = await A.post('/auth/2fa/iniciar');
  A.form({ title: 'Activar verificación en dos pasos', intro: `Agregue una cuenta en su aplicación autenticadora con esta clave:<br><b style="word-break:break-all;font-size:16px">${A.esc(s.secreto)}</b><br>Luego escriba el código de 6 dígitos que muestra.`, fields: [{ n: 'codigo', l: 'Código', req: true }],
    onSubmit: async d => { await A.post('/auth/2fa/activar', d); A.toast('2FA activado. Debe ingresar nuevamente.'); setTimeout(() => A.acts.salir(), 800); } }); } catch (x) { A.toast(x.message, true); } };
A.acts.tfa_off = () => A.form({ title: 'Desactivar 2FA', fields: [{ n: 'password', l: 'Contraseña', t: 'password', req: true }, { n: 'codigo', l: 'Código actual', req: true }], onSubmit: async d => { await A.post('/auth/2fa/desactivar', d); A.toast('2FA desactivado. Ingrese nuevamente.'); setTimeout(() => A.acts.salir(), 800); } });
document.addEventListener('click', ev => { const a = ev.target.closest('a[href="#"]'); if (a) ev.preventDefault(); });
A.start();
