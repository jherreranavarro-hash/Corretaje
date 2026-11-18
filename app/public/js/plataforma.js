// Administrador del sistema: corredoras, planes, suscripciones, solicitudes y auditoría
const V = A.vistas, E = A.esc, P = '/plataforma';
const ESTADOS = { prueba: 'warn', activa: 'ok', vencida: 'bd', suspendida: 'bd', cancelada: 'bd' };
A.logout = () => { sessionStorage.removeItem('ptk'); A.token = null; A.user = null; A.renderLogin(); };
A.can = () => true;

A.renderLogin = () => {
  let cred = null;
  const caja = html => { $q('#root').innerHTML = `<div class="login"><div class="card"><h2>Administración de la plataforma</h2><p class="mut">Acceso restringido. Se exige verificación en dos pasos.</p>${html}</div></div>`; };
  const pasoCred = () => { caja(`<form id="lf"><label>Email</label><input name="email" type="email" required autocomplete="username"><label>Contraseña</label><input name="password" type="password" required autocomplete="current-password"><p><button class="pri" style="width:100%">Continuar</button></p></form>`);
    $q('#lf').onsubmit = async ev => { ev.preventDefault(); cred = A.formData(ev.target); await intentar(); }; };
  const intentar = async codigo => {
    try {
      const r = await A.api('POST', P + '/login', codigo ? { ...cred, codigo } : cred);
      if (r.token) { sessionStorage.setItem('ptk', r.token); sessionStorage.setItem('pus', JSON.stringify(r.admin)); return A.start(); }
      if (r.requiere_2fa) return paso2fa();
      if (r.requiere_enrolar_2fa) return enrolar(r.token_enrol);
    } catch (x) { A.toast(x.message, true); if (codigo) pasoCred(); }
  };
  const paso2fa = () => { caja(`<p>Código de 6 dígitos de su aplicación autenticadora.</p><form id="f2"><input name="c" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required autofocus><p><button class="pri" style="width:100%">Verificar</button></p></form>`); $q('#f2').onsubmit = ev => { ev.preventDefault(); intentar(A.formData(ev.target).c); }; };
  const enrolar = async tok => { try { A.token = tok; const s = await A.post(P + '/2fa/iniciar');
    caja(`<p>Configure su aplicación autenticadora (Google/Microsoft Authenticator, Authy…) con esta clave:</p><p class="big" style="font-size:16px;word-break:break-all;text-align:center">${E(s.secreto)}</p><form id="fe"><label>Código de 6 dígitos</label><input name="c" inputmode="numeric" maxlength="7" required><p><button class="pri" style="width:100%">Activar</button></p></form>`);
    $q('#fe').onsubmit = async ev => { ev.preventDefault(); try { await A.post(P + '/2fa/activar', { codigo: A.formData(ev.target).c }); A.token = null; A.toast('Activado. Ingrese nuevamente.'); pasoCred(); } catch (x) { A.toast(x.message, true); } };
  } catch (x) { A.toast(x.message, true); pasoCred(); } };
  pasoCred();
};
A.start = () => {
  A.token = sessionStorage.getItem('ptk'); const u = JSON.parse(sessionStorage.getItem('pus') || 'null');
  if (!A.token || !u) return A.renderLogin();
  A.user = { nombre: u.nombre, permisos: ['*'] };
  $q('#root').innerHTML = `<div id="app"><nav id="side"><h1>⚙️ Plataforma</h1><div class="grp">Servicio</div>${[['resumen', 'Resumen'], ['corredoras', 'Corredoras'], ['planes', 'Planes'], ['solicitudes', 'Solicitudes comerciales'], ['auditoria', 'Auditoría'], ['seguridad', 'Mi seguridad']].map(([k, l]) => `<a href="#/${k}">${l}</a>`).join('')}
    <div class="grp">Cuenta</div><a href="#" data-act="salir">Salir (${E(u.nombre)})</a></nav><main id="main"><div id="top"><button id="burger" data-act="burger">☰</button></div><div id="view"></div></main></div>`;
  if (!location.hash) location.hash = '#/resumen'; A.refresh();
};
A.acts.salir = () => A.logout(); A.acts.burger = () => $q('#side').classList.toggle('on');
document.addEventListener('click', ev => { const a = ev.target.closest('a[href="#"]'); if (a) ev.preventDefault(); });
const aviso = (t, r) => A.modal(`<h2>${E(t)}</h2><table>${[['Usuario', r.usuario], ['Clave temporal', `<b style="font-size:18px;user-select:all">${E(r.clave_temporal)}</b>`], ['Acceso', r.url ? location.origin + r.url : '']].filter(x => x[1]).map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>
  <p class="warn">${E(r.aviso || '')}</p><div class="row" style="justify-content:flex-end"><button class="pri" data-close>Entendido</button></div>`);

V.resumen = async () => {
  const r = await A.get(P + '/resumen');
  return `<h2>Resumen del servicio</h2><div class="grid g4">${A.kpi('Corredoras', r.corredoras)}${A.kpi('Ingreso mensual recurrente', A.clp(r.ingreso_mensual_recurrente_clp), 'planes activos')}${A.kpi('Solicitudes nuevas', r.solicitudes_nuevas)}${A.kpi('Por vencer este mes', r.por_vencer_este_mes)}</div>
  <div class="card"><h3 style="margin-top:0">Por estado</h3>${Object.entries(r.por_estado).map(([k, v]) => `${A.chip(k, ESTADOS[k])} ${v} &nbsp;`).join('') || '<span class="mut">Sin corredoras</span>'}</div>`;
};
V.corredoras = async (r) => {
  if (r.args[0]) return V.ficha(r.args[0]);
  const rows = await A.get(P + '/corredoras');
  return `<div class="row"><h2>Corredoras</h2><span class="right"></span>${A.btn('+ Nueva corredora', 'cor_nueva', null, 'pri')}</div><div class="card">${A.tabla([{ l: 'Corredora', f: c => `<b>${E(c.razon_social)}</b><div class="mut">/c/${E(c.slug)}</div>` }, { k: 'plan', l: 'Plan' }, { l: 'Estado', f: c => A.chip(c.estado_suscripcion, ESTADOS[c.estado_suscripcion]) },
    { l: 'Vigencia', f: c => A.fecha(c.estado_suscripcion === 'prueba' ? c.prueba_hasta : c.suscripcion_hasta) }, { l: 'Usuarios', n: 1, f: c => `${c.usuarios}${c.max_usuarios ? ' / ' + c.max_usuarios : ''}` }, { l: 'Propiedades', n: 1, f: c => `${c.propiedades}${c.max_propiedades ? ' / ' + c.max_propiedades : ''}` }, { l: 'Alta', f: c => A.fecha(c.created_at) }], rows, { click: c => 'corredoras/' + c.id })}</div>`;
};
A.acts.cor_nueva = async () => { const planes = (await A.get(P + '/planes')).filter(p => p.activo);
  A.form({ title: 'Nueva corredora', wide: true, intro: 'Se crea su espacio aislado y un administrador con clave temporal (se muestra una sola vez).', fields: [{ n: 'nombre', l: 'Nombre / razón social', req: true }, { n: 'rut', l: 'RUT', req: true, help: '76.123.456-7' }, { n: 'slug', l: 'Identificador del enlace', req: true, help: 'minúsculas, números y guiones: /c/identificador' },
    { n: 'nombre_admin', l: 'Nombre del administrador', req: true }, { n: 'email_admin', l: 'Correo del administrador', t: 'email', req: true }, { n: 'plan_id', l: 'Plan', t: 'select', req: true, opts: planes.map(p => [p.id, `${p.nombre} (${A.clp(p.precio_mensual_clp)}/mes)`]) }, { n: 'dias_prueba', l: 'Días de prueba', t: 'number', v: 14 }],
    onSubmit: async d => { const r = await A.post(P + '/corredoras', d); setTimeout(() => aviso('Corredora creada', r), 50); } }); };
V.ficha = async id => {
  const c = await A.get(P + '/corredoras/' + id);
  const link = `${location.origin}/c/${c.slug}`;
  return `<div class="row"><a href="#/corredoras">← Corredoras</a></div><div class="row"><h2>${E(c.razon_social)}</h2>${A.chip(c.estado_suscripcion, ESTADOS[c.estado_suscripcion])}<span class="right"></span>
    ${A.btn('Editar plan / vigencia', 'cor_editar', c, '')}${A.btn('Registrar pago', 'cor_pago', c, 'pri')}${['suspendida', 'cancelada'].includes(c.estado_suscripcion) ? A.btn('Reactivar', 'cor_estado', [c.id, 'activa'], '') : A.btn('Suspender', 'cor_estado', [c.id, 'suspendida'], 'sm bad')}</div>
  <div class="grid g4">${A.kpi('Plan', E(c.plan || '—'))}${A.kpi('Usuarios', c.uso.usuarios)}${A.kpi('Propiedades', c.uso.propiedades)}${A.kpi('Operaciones', c.uso.operaciones)}</div>
  <div class="card"><table>${[['RUT', c.rut], ['Enlace de acceso', `<a href="${E(link)}" target="_blank" rel="noopener">${E(link)}</a>`], ['Sitio público', `<a href="/sitio/${E(c.slug)}" target="_blank">/sitio/${E(c.slug)}</a>`], ['Prueba hasta', A.fecha(c.prueba_hasta)], ['Suscripción hasta', A.fecha(c.suscripcion_hasta)], ['Notas internas', E(c.notas_plataforma || '')]].map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table></div>
  <div class="card"><h3 style="margin-top:0">Usuarios</h3>${A.tabla([{ k: 'nombre', l: 'Nombre' }, { k: 'email', l: 'Email' }, { k: 'rol', l: 'Rol' }, { l: '2FA', f: u => u.totp_activo ? 'Sí' : '' }, { l: 'Último acceso', f: u => A.fecha(u.ultimo_acceso) }, { l: 'Estado', f: u => u.activo ? A.chip('activo', 'ok') : A.chip('inactivo') },
    { l: '', f: u => (u.rol === 'Gerente' ? A.btn('Restablecer clave', 'cor_reset', [c.id, u.id]) : '') + (u.totp_activo ? A.btn('Restablecer 2FA', 'cor_2fa', [c.id, u.id], 'sm bad') : '') }], c.usuarios)}</div>
  <div class="card"><h3 style="margin-top:0">Pagos de suscripción</h3>${A.tabla([{ l: 'Fecha', f: p => A.fecha(p.fecha) }, { l: 'Monto', n: 1, f: p => A.clp(p.monto) }, { l: 'Período', f: p => `${A.fecha(p.periodo_desde)} → ${A.fecha(p.periodo_hasta)}` }, { k: 'medio', l: 'Medio' }, { k: 'referencia', l: 'Referencia' }], c.pagos, { vacio: 'Sin pagos' })}</div>`;
};
A.acts.cor_editar = async c => { const planes = await A.get(P + '/planes');
  A.form({ title: 'Plan y vigencia', fields: [{ n: 'plan_id', l: 'Plan', t: 'select', v: c.plan_id, opts: planes.map(p => [p.id, p.nombre]) }, { n: 'estado_suscripcion', l: 'Estado', t: 'select', v: c.estado_suscripcion, opts: ['prueba', 'activa', 'vencida', 'suspendida', 'cancelada'].map(x => [x, x]) },
    { n: 'prueba_hasta', l: 'Prueba hasta', t: 'date', v: String(c.prueba_hasta || '').slice(0, 10) }, { n: 'suscripcion_hasta', l: 'Suscripción hasta', t: 'date', v: String(c.suscripcion_hasta || '').slice(0, 10) }, { n: 'notas', l: 'Notas internas', t: 'textarea', v: c.notas_plataforma }], onSubmit: d => A.patch(P + '/corredoras/' + c.id, d) }); };
A.acts.cor_pago = c => A.form({ title: 'Registrar pago de suscripción', intro: 'Extiende la vigencia y deja la cuenta activa.', fields: [{ n: 'meses', l: 'Meses pagados', t: 'number', v: 1, req: true }, { n: 'monto', l: 'Monto (vacío = precio del plan × meses)', t: 'number' }, { n: 'medio', l: 'Medio de pago' }, { n: 'referencia', l: 'Referencia / N° documento' }], onSubmit: d => A.post(P + `/corredoras/${c.id}/pagos`, d) });
A.acts.cor_estado = ([id, estado]) => A.confirm(estado === 'suspendida' ? 'Suspender la cuenta: se cierran todas las sesiones y no podrán ingresar.' : 'Reactivar la cuenta', () => A.run(() => A.patch(P + '/corredoras/' + id, { estado_suscripcion: estado }), 'Actualizado'), 'Confirmar');
A.acts.cor_reset = ([id, uid]) => A.confirm('Se generará una clave temporal y se cerrarán sus sesiones.', async () => { try { const r = await A.post(P + `/corredoras/${id}/reset-admin`, { usuario_id: uid }); aviso('Clave restablecida', r); } catch (x) { A.toast(x.message, true); } }, 'Restablecer');
A.acts.cor_2fa = ([id, uid]) => A.confirm('El usuario deberá configurar de nuevo su verificación en dos pasos (si la corredora la exige).', () => A.run(() => A.post(P + `/corredoras/${id}/revocar-2fa`, { usuario_id: uid }), '2FA restablecido'), 'Restablecer');

V.planes = async () => { const rows = await A.get(P + '/planes');
  return `<div class="row"><h2>Planes</h2><span class="right"></span>${A.btn('+ Nuevo plan', 'plan_nuevo', null, 'pri')}</div><div class="card">${A.tabla([{ k: 'codigo', l: 'Código' }, { k: 'nombre', l: 'Plan' }, { l: 'Precio mensual', n: 1, f: p => A.clp(p.precio_mensual_clp) }, { l: 'Usuarios', n: 1, f: p => p.max_usuarios ?? '∞' }, { l: 'Propiedades', n: 1, f: p => p.max_propiedades ?? '∞' }, { l: 'Estado', f: p => p.activo ? A.chip('activo', 'ok') : A.chip('inactivo') }, { l: '', f: p => A.btn('Editar', 'plan_editar', p) }], rows)}</div><p class="mut">Los precios y límites incluidos son de ejemplo: defínalos según su oferta comercial. Los límites se aplican al crear usuarios y propiedades.</p>`; };
const camposPlan = p => [{ n: 'nombre', l: 'Nombre', v: p.nombre, req: true }, { n: 'descripcion', l: 'Descripción', v: p.descripcion }, { n: 'precio_mensual_clp', l: 'Precio mensual (CLP)', t: 'number', v: p.precio_mensual_clp }, { n: 'max_usuarios', l: 'Máx. usuarios (vacío = sin límite)', t: 'number', v: p.max_usuarios }, { n: 'max_propiedades', l: 'Máx. propiedades (vacío = sin límite)', t: 'number', v: p.max_propiedades }];
A.acts.plan_nuevo = () => A.form({ title: 'Nuevo plan', fields: [{ n: 'codigo', l: 'Código (a-z, 0-9, _)', req: true }, ...camposPlan({})], onSubmit: d => A.post(P + '/planes', d) });
A.acts.plan_editar = p => A.form({ title: 'Editar plan', fields: [...camposPlan(p), { n: 'activo', l: 'Disponible para nuevas corredoras', t: 'checkbox', v: p.activo }],
  onSubmit: d => A.patch(P + '/planes/' + p.id, { ...d, max_usuarios: d.max_usuarios ?? null, max_propiedades: d.max_propiedades ?? null }) });
V.solicitudes = async () => { const rows = await A.get(P + '/solicitudes');
  return `<h2>Solicitudes comerciales</h2><div class="card">${A.tabla([{ l: 'Fecha', f: s => A.fecha(s.at) }, { k: 'nombre', l: 'Nombre' }, { k: 'empresa', l: 'Empresa' }, { k: 'email', l: 'Email' }, { k: 'telefono', l: 'Teléfono' }, { k: 'mensaje', l: 'Mensaje' }, { l: 'Estado', f: s => A.chip(s.estado) },
    { l: '', f: s => ['contactada', 'cliente', 'descartada'].map(e => A.btn(e, 'sol_estado', [s.id, e])).join('') }], rows, { vacio: 'Sin solicitudes' })}</div>`; };
A.acts.sol_estado = ([id, estado]) => A.run(() => A.patch(P + '/solicitudes/' + id, { estado }), 'Actualizado');
V.auditoria = async () => { const rows = await A.get(P + '/auditoria');
  return `<h2>Auditoría de la plataforma</h2><div class="card">${A.tabla([{ l: 'Fecha', f: a => new Date(a.at).toLocaleString('es-CL') }, { k: 'admin', l: 'Administrador' }, { k: 'accion', l: 'Acción' }, { k: 'corredora', l: 'Corredora' }, { l: 'Detalle', f: a => `<span class="mut">${E(JSON.stringify(a.detalle || '').slice(0, 120))}</span>` }, { k: 'ip', l: 'IP' }], rows)}</div>`; };
V.seguridad = async () => `<h2>Mi seguridad</h2><div class="card"><p>${A.btn('Cambiar contraseña', 'p_pwd', null, 'pri')} ${A.btn('Agregar administrador del sistema', 'p_admin', null, '')}</p><p class="mut">Cada acción queda en la auditoría. Los administradores deben activar la verificación en dos pasos al primer ingreso.</p></div>`;
A.acts.p_pwd = () => A.form({ title: 'Cambiar contraseña', fields: [{ n: 'actual', l: 'Actual', t: 'password', req: true }, { n: 'nueva', l: 'Nueva (mín. 10, letras y números)', t: 'password', req: true }], onSubmit: async d => { const r = await A.post(P + '/password', d); sessionStorage.setItem('ptk', r.token); A.token = r.token; A.toast('Contraseña actualizada'); } });
A.acts.p_admin = () => A.form({ title: 'Nuevo administrador del sistema', fields: [{ n: 'nombre', l: 'Nombre', req: true }, { n: 'email', l: 'Email', t: 'email', req: true }], onSubmit: async d => { const r = await A.post(P + '/admins', d); setTimeout(() => aviso('Administrador creado', { usuario: r.email, clave_temporal: r.clave_temporal, aviso: r.aviso }), 50); } });
A.start();
