// Arranque: sesión, menú por permisos y render principal
const MENU = [
  ['Comercial', [['dashboard', 'Panel', null], ['propiedades', 'Propiedades', 'propiedades.ver'], ['leads', 'Leads', 'leads.ver'], ['visitas', 'Visitas', 'visitas.ver'], ['personas', 'Personas', 'personas.ver'], ['publicaciones', 'Publicaciones', 'publicaciones.ver'], ['operaciones', 'Ventas y arriendos', 'operaciones.ver']]],
  ['Administración de cartera', [['contratos', 'Contratos', 'contratos.ver'], ['cobranza', 'Cobranza', 'cargos.ver'], ['ot', 'Mantenciones', 'ot.ver'], ['liquidaciones', 'Liquidaciones', 'liquidaciones.ver']]],
  ['Finanzas', [['movimientos', 'Libro de movimientos', 'movimientos.ver'], ['comisiones', 'Comisiones', 'comisiones.ver'], ['documentos', 'Documentos', 'documentos.ver'], ['reportes', 'Reportes', 'reportes.ver']]],
  ['Sistema', [['mantenedores', 'Mantenedores', 'catalogos.ver'], ['integraciones', 'Integraciones', 'integraciones.ver'], ['admin', 'Administración', 'usuarios.ver']]],
];
A.renderLogin = () => {
  $q('#root').innerHTML = `<div class="login"><div class="card"><h2>Corretaje</h2><p class="mut">Ingrese a su cuenta</p><form id="lf"><label>Email</label><input name="email" type="email" required autocomplete="username"><label>Contraseña</label><input name="password" type="password" required autocomplete="current-password">
    <p><button class="pri" style="width:100%">Ingresar</button></p></form></div></div>`;
  $q('#lf').onsubmit = async ev => { ev.preventDefault(); const d = A.formData(ev.target); try { const r = await A.api('POST', '/auth/login', d); sessionStorage.setItem('tk', r.token); sessionStorage.setItem('us', JSON.stringify(r.usuario)); A.start(); } catch (x) { A.toast(x.message, true); } };
};
A.start = () => {
  A.token = sessionStorage.getItem('tk'); A.user = JSON.parse(sessionStorage.getItem('us') || 'null');
  if (!A.token || !A.user) return A.renderLogin();
  $q('#root').innerHTML = `<div id="app"><nav id="side"><h1>🏠 Corretaje</h1>${MENU.map(([g, items]) => { const v = items.filter(([, , p]) => !p || A.can(p)); return v.length ? `<div class="grp">${g}</div>${v.map(([k, l]) => `<a href="#/${k}">${l}</a>`).join('')}` : ''; }).join('')}
    <div class="grp">Cuenta</div><a href="#" data-act="pwd">Cambiar contraseña</a><a href="#" data-act="salir">Salir (${A.esc(A.user.nombre)})</a></nav>
    <main id="main"><div id="top"><button id="burger" data-act="burger">☰</button><span class="mut">${A.esc(A.user.rol)}</span></div><div id="view"></div></main></div>`;
  A.refresh();
};
A.acts.salir = () => A.logout();
A.acts.burger = () => $q('#side').classList.toggle('on');
A.acts.pwd = () => A.form({ title: 'Cambiar contraseña', fields: [{ n: 'actual', l: 'Contraseña actual', t: 'password', req: true }, { n: 'nueva', l: 'Nueva contraseña (mín. 10 caracteres)', t: 'password', req: true }], onSubmit: d => A.post('/auth/password', d) });
document.addEventListener('click', ev => { const a = ev.target.closest('a[href="#"]'); if (a) ev.preventDefault(); });
A.start();
