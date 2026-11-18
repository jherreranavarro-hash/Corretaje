// Mantenedores y administración del sistema
const EA = A.esc;
const GRUPOS = { tipo_propiedad: 'Tipos de propiedad', comuna: 'Comunas', fuente_lead: 'Fuentes de lead', motivo_perdida: 'Motivos de pérdida', medio_pago: 'Medios de pago', centro_costo: 'Centros de costo', canal: 'Canales de publicación', banco: 'Bancos', tipo_documento: 'Tipos de documento' };

V.mantenedores = async () => {
  const g = A.state.mg || 'conceptos';
  const menu = `<div class="tabs">${[...Object.entries(GRUPOS), ['conceptos', 'Conceptos financieros'], ['indices', 'Índices (UF, IPC…)']].map(([k, l]) => `<a class="${k === g ? 'on' : ''}" data-act="mant_sel" data-args='"${k}"'>${EA(l)}</a>`).join('')}</div>`;
  if (g === 'conceptos') {
    const rows = await A.get('/conceptos?todos=1');
    return `<div class="row"><h2>Mantenedores</h2><span class="right"></span>${A.can('catalogos.crear') ? A.btn('+ Nuevo concepto', 'concepto_nuevo', null, 'pri') : ''}</div>${menu}
    <div class="card">${A.tabla([{ k: 'codigo', l: 'Código' }, { k: 'nombre', l: 'Nombre' }, { l: 'Naturaleza', f: c => A.chip(c.naturaleza) }, { k: 'categoria', l: 'Categoría' }, { l: 'IVA', f: c => c.afecto_iva ? 'Afecto' : 'Exento' }, { l: 'Respaldo', f: c => c.requiere_respaldo ? 'Obligatorio' : '' },
      { l: 'Estado', f: c => c.activo ? A.chip('activo', 'ok') : A.chip('inactivo') }, { l: '', f: c => A.can('catalogos.editar') ? A.btn('Editar', 'concepto_editar', c) + (!c.es_sistema ? A.btn(c.activo ? 'Desactivar' : 'Activar', 'concepto_toggle', c) : '') : '' }], rows)}</div>
    <p class="mut">Cambiar un concepto no altera los movimientos ya registrados. Los conceptos de sistema no se pueden desactivar.</p>`;
  }
  if (g === 'indices') {
    const [uf, ipc] = await Promise.all([A.get('/indices/UF?hasta=' + A.hoy()), A.get('/indices/IPC')]);
    return `<div class="row"><h2>Mantenedores</h2><span class="right"></span>${A.can('indices.editar') ? A.btn('Cargar valor manual', 'indice_manual', null, 'pri') + A.btn('Sincronizar UF desde fuente externa', 'indice_sync', null, '') : ''}</div>${menu}
    <p class="mut">Los índices se usan en reajustes, cargos en UF y conversión de montos. Si la fuente externa falla, cargue el valor a mano con su respaldo. <b>Los valores de demostración deben reemplazarse por los oficiales.</b></p>
    <div class="grid g2"><div class="card"><h3 style="margin-top:0">UF (últimos valores)</h3>${A.tabla([{ l: 'Fecha', f: x => A.fecha(x.fecha) }, { l: 'Valor', n: 1, f: x => A.num(x.valor, 2) }, { k: 'origen', l: 'Origen' }], uf.slice(0, 15))}</div>
    <div class="card"><h3 style="margin-top:0">IPC (variación mensual %)</h3>${A.tabla([{ l: 'Mes', f: x => String(x.fecha).slice(0, 7) }, { l: 'Variación %', n: 1, f: x => A.num(x.valor, 2) }, { k: 'origen', l: 'Origen' }], ipc.slice(0, 15))}</div></div>`;
  }
  const rows = await A.get(`/catalogos/${g}?todos=1`);
  return `<div class="row"><h2>Mantenedores</h2><span class="right"></span>${A.can('catalogos.crear') ? A.btn('+ Agregar', 'cat_nuevo', g, 'pri') : ''}</div>${menu}
  <div class="card">${A.tabla([{ k: 'codigo', l: 'Código' }, { k: 'nombre', l: 'Nombre' }, ...(g === 'canal' ? [{ l: 'Modo', f: c => EA(c.datos.modo || '') }, { l: 'Costo ref.', n: 1, f: c => A.clp(c.datos.costo) }] : []), { l: 'Estado', f: c => c.activo ? A.chip('activo', 'ok') : A.chip('inactivo') },
    { l: '', f: c => A.can('catalogos.editar') ? A.btn('Editar', 'cat_editar', [g, c]) + A.btn(c.activo ? 'Desactivar' : 'Activar', 'cat_toggle', [g, c]) + (A.can('catalogos.eliminar') ? A.btn('Eliminar', 'cat_eliminar', [g, c.id], 'sm bad') : '') : '' }], rows)}</div>
  <p class="mut">Un valor en uso no se puede eliminar: desactívelo para que deje de ofrecerse sin afectar el historial.</p>`;
};
A.acts.mant_sel = g => { A.state.mg = g; A.refresh(); };
A.acts.cat_nuevo = g => A.form({ title: 'Agregar a ' + (GRUPOS[g] || g), fields: [{ n: 'codigo', l: 'Código', req: true, help: 'No podrá cambiarse' }, { n: 'nombre', l: 'Nombre', req: true }, { n: 'orden', l: 'Orden', t: 'number', v: 0 },
  ...(g === 'canal' ? [{ n: 'modo', l: 'Modo', t: 'select', req: true, opts: [['asistida', 'Asistida (publica el agente)'], ['nativo', 'Nativo (sitio propio)']] }, { n: 'costo', l: 'Costo referencial (neto)', t: 'number' }] : [])],
  onSubmit: async d => { const { modo, costo, ...b } = d; if (g === 'canal') b.datos = { modo, costo: costo || 0 }; await A.post('/catalogos/' + g, b); A.invalidar(); } });
A.acts.cat_editar = ([g, c]) => A.form({ title: 'Editar ' + c.codigo, fields: [{ n: 'nombre', l: 'Nombre', v: c.nombre }, { n: 'orden', l: 'Orden', t: 'number', v: c.orden }, ...(g === 'canal' ? [{ n: 'costo', l: 'Costo referencial (neto)', t: 'number', v: c.datos.costo }] : [])],
  onSubmit: async d => { const { costo, ...b } = d; if (g === 'canal') b.datos = { ...c.datos, costo: costo || 0 }; await A.patch(`/catalogos/${g}/${c.id}`, b); A.invalidar(); } });
A.acts.cat_toggle = ([g, c]) => A.run(async () => { await A.patch(`/catalogos/${g}/${c.id}`, { activo: !c.activo }); A.invalidar(); }, 'Actualizado');
A.acts.cat_eliminar = ([g, id]) => A.confirm('¿Eliminar este valor?', () => A.run(async () => { await A.del(`/catalogos/${g}/${id}`); A.invalidar(); }, 'Eliminado'), 'Eliminar');
A.acts.concepto_nuevo = () => A.form({ title: 'Nuevo concepto', fields: [{ n: 'codigo', l: 'Código', req: true }, { n: 'nombre', l: 'Nombre', req: true }, { n: 'naturaleza', l: 'Naturaleza', t: 'select', req: true, opts: [['ingreso', 'Ingreso'], ['egreso', 'Egreso'], ['traspaso', 'Traspaso']] },
  { n: 'categoria', l: 'Categoría', help: 'documento, publicidad, captacion, mantencion, contribucion, seguro, gasto_propietario…' }, { n: 'afecto_iva', l: 'Afecto a IVA', t: 'checkbox', v: true }, { n: 'requiere_respaldo', l: 'Exige respaldo para marcar pagado', t: 'checkbox' }, { n: 'monto_referencial', l: 'Monto referencial', t: 'number' }],
  onSubmit: async d => { await A.post('/conceptos', d); A.invalidar(); } });
A.acts.concepto_editar = c => A.form({ title: 'Editar ' + c.codigo, fields: [{ n: 'nombre', l: 'Nombre', v: c.nombre }, { n: 'categoria', l: 'Categoría', v: c.categoria }, { n: 'afecto_iva', l: 'Afecto a IVA', t: 'checkbox', v: c.afecto_iva }, { n: 'requiere_respaldo', l: 'Exige respaldo', t: 'checkbox', v: c.requiere_respaldo }, { n: 'monto_referencial', l: 'Monto referencial', t: 'number', v: c.monto_referencial }],
  onSubmit: async d => { await A.patch('/conceptos/' + c.id, d); A.invalidar(); } });
A.acts.concepto_toggle = c => A.run(async () => { await A.patch('/conceptos/' + c.id, { activo: !c.activo }); A.invalidar(); }, 'Actualizado');
A.acts.indice_manual = () => A.form({ title: 'Cargar índice', fields: [{ n: 'codigo', l: 'Índice', t: 'select', req: true, opts: [['UF', 'UF'], ['IPC', 'IPC (variación mensual %)'], ['UTM', 'UTM'], ['USD', 'USD']] }, { n: 'fecha', l: 'Fecha (IPC: día 1 del mes)', t: 'date', req: true, v: A.hoy() }, { n: 'valor', l: 'Valor', t: 'number', req: true }],
  onSubmit: d => A.put(`/indices/${d.codigo}/${d.fecha}`, { valor: d.valor }) });
A.acts.indice_sync = () => A.run(async () => { const r = await A.post('/indices-sincronizar', {}); A.toast(`${r.sincronizados} valores sincronizados`); });

// ---------------- ADMINISTRACION ----------------
V.admin = async () => {
  const tab = A.state.tab && A.state.tabFor === 'admin' ? A.state.tab : (A.state.tabFor = 'admin', A.state.tab = 'usuarios');
  const tabs = A.tabs([['usuarios', 'Usuarios'], ['roles', 'Roles y permisos'], ['parametros', 'Parámetros'], ['marca', 'Marca y sitio web'], ['periodos', 'Cierre de períodos'], ['auditoria', 'Auditoría']], tab);
  let body = '';
  if (tab === 'usuarios') {
    const [us, roles] = await Promise.all([A.get('/usuarios'), A.get('/roles')]);
    body = `<div class="card">${A.tabla([{ k: 'nombre', l: 'Nombre' }, { k: 'email', l: 'Email' }, { k: 'rol', l: 'Rol' }, { l: 'Agente', f: u => u.es_agente ? 'Sí' : '' }, { l: 'Último acceso', f: u => A.fecha(u.ultimo_acceso) }, { l: 'Estado', f: u => u.activo ? A.chip('activo', 'ok') : A.chip('inactivo', 'bd') },
      { l: '', f: u => A.can('usuarios.editar') ? A.btn('Editar', 'usuario_editar', { u, roles }) + A.btn(u.activo ? 'Desactivar' : 'Activar', 'usuario_toggle', u) : '' }], us)}${A.can('usuarios.crear') ? A.btn('+ Nuevo usuario', 'usuario_nuevo', roles, 'pri') : ''}</div>`;
  } else if (tab === 'roles') {
    const roles = await A.get('/roles');
    body = `<div class="card">${A.tabla([{ k: 'nombre', l: 'Rol' }, { k: 'alcance', l: 'Alcance de datos' }, { l: 'Permisos', f: r => r.permisos.map(p => A.chip(p)).join(' ') }, { l: '', f: r => A.can('usuarios.editar') ? A.btn('Editar', 'rol_editar', r) : '' }], roles)}
    ${A.can('usuarios.crear') ? A.btn('+ Nuevo rol', 'rol_nuevo', null, 'pri') : ''}<p class="mut">Permiso = módulo.acción (ver, crear, editar, eliminar, aprobar…). "*" otorga todo; "modulo.*" todas las acciones del módulo; "*.ver" lectura en todo. Alcance "propios": el usuario solo ve lo que le corresponde.</p></div>`;
  } else if (tab === 'parametros') {
    const p = await A.get('/parametros'); const x = p.parametros;
    body = `<div class="card"><h3 style="margin-top:0">${EA(p.razon_social)} · RUT ${EA(p.rut)}</h3><form id="pf" class="grid g2">${[['iva_pct', 'IVA %', p.iva_pct, 'number'], ['umbral_aprobacion_gasto', 'Umbral de aprobación de gastos ($)', x.umbral_aprobacion_gasto, 'number'], ['umbral_mantencion', 'Umbral de aprobación de mantenciones ($)', x.umbral_mantencion, 'number'],
      ['retencion_honorarios_pct', 'Retención de honorarios agentes (%) — validar con contador', x.retencion_honorarios_pct, 'number'], ['min_fotos', 'Fotos mínimas para publicar', x.min_fotos, 'number'], ['completitud_minima', 'Completitud mínima para publicar (%)', x.completitud_minima, 'number'],
      ['dias_alerta_mandato', 'Días de alerta de mandato por vencer', x.dias_alerta_mandato, 'number'], ['variacion_precio_max_pct', 'Cambio de precio que exige motivo (%)', x.variacion_precio_max_pct, 'number']].map(([n, l, v, t]) => A.field({ n, l, v, t })).join('')}
      ${[['exigir_2fa', 'Exigir verificación en dos pasos (2FA) a todos los usuarios', x.exigir_2fa], ['exigir_mandato', 'Exigir mandato vigente para operar y publicar', x.exigir_mandato], ['pagar_comision_solo_si_cobrada', 'Aprobar comisiones solo si el cliente ya pagó', x.pagar_comision_solo_si_cobrada], ['prorratear_canon', 'Prorratear canon en el primer y último mes', x.prorratear_canon]].map(([n, l, v]) => A.field({ n, l, v: n === 'exigir_2fa' ? !!v : v !== false, t: 'checkbox' })).join('')}
      </form>${A.can('parametros.editar') ? `<p>${A.btn('Guardar parámetros', 'param_guardar', null, 'pri')}</p>` : ''}</div>`;
  } else if (tab === 'marca') {
    const m = await A.get('/marca');
    body = `<div class="grid g2"><div class="card"><h3 style="margin-top:0">Identidad de su corredora</h3><form id="mf2">${[['nombre', 'Nombre comercial', m.nombre], ['lema', 'Lema o descripción corta', m.lema], ['email', 'Email de contacto', m.email], ['telefono', 'Teléfono', m.telefono], ['web', 'Sitio web (https://…)', m.web]].map(([n, l, v]) => A.field({ n, l, v })).join('')}
      ${A.field({ n: 'color', l: 'Color principal', v: m.color, t: 'color' })}${A.field({ n: 'color2', l: 'Color del menú lateral', v: m.color2, t: 'color' })}</form>${A.can('parametros.editar') ? `<p>${A.btn('Guardar marca', 'marca_guardar', null, 'pri')}</p>` : ''}</div>
      <div class="card"><h3 style="margin-top:0">Logo</h3><p>${m.logo ? `<img src="${A.esc(m.logo)}" alt="" style="max-height:90px;max-width:100%">` : '<span class="mut">Sin logo</span>'}</p>
      ${A.can('parametros.editar') ? `<input type="file" id="logo" accept="image/png,image/jpeg,image/webp"><p class="mut">PNG, JPG o WEBP, hasta 1 MB. Fondo transparente recomendado.</p>${m.logo ? A.btn('Quitar logo', 'logo_quitar', null, 'sm bad') : ''}` : ''}
      <h3>Dónde se usa</h3><p class="mut">Pantalla de ingreso, menú, sitio público (<a href="/sitio/${A.esc(m.slug)}" target="_blank">/sitio/${A.esc(m.slug)}</a>) y documentos.<br>Enlace de acceso para su equipo: <b>${location.origin}/c/${A.esc(m.slug)}</b></p></div></div>`;
    setTimeout(() => { const f = $q('#logo'); if (f) f.onchange = () => { const x = f.files[0]; if (!x) return; const rd = new FileReader(); rd.onload = () => A.run(async () => { const r = await A.post('/marca/logo', { data_url: rd.result }); A.aplicarMarca({ logo: r.logo }); sessionStorage.setItem('mk', JSON.stringify({ ...JSON.parse(sessionStorage.getItem('mk') || '{}'), logo: r.logo })); }, 'Logo actualizado'); rd.readAsDataURL(x); }; }, 0);
  } else if (tab === 'periodos') {
    const ps = await A.get('/periodos');
    body = `<div class="card"><p class="mut">Un período cerrado no admite nuevos movimientos ni anulaciones. Las correcciones se registran en el período abierto.</p>${A.tabla([{ k: 'periodo', l: 'Período' }, { l: 'Estado', f: p => A.estado(p.estado) }, { l: 'Cerrado', f: p => A.fecha(p.cerrado_at) }, { l: '', f: p => p.estado === 'cerrado' && A.can('periodos.reabrir') ? A.btn('Reabrir', 'periodo_reabrir', p.periodo, 'sm bad') : '' }], ps, { vacio: 'Ningún período cerrado' })}
    ${A.can('periodos.cerrar') ? A.btn('Cerrar un período', 'periodo_cerrar', null, 'pri') : ''}</div>`;
  } else {
    const au = await A.get('/auditoria?limit=300');
    body = `<div class="card">${A.tabla([{ l: 'Fecha', f: a => new Date(a.at).toLocaleString('es-CL') }, { k: 'usuario', l: 'Usuario' }, { k: 'entidad', l: 'Entidad' }, { k: 'accion', l: 'Acción' }, { l: 'Detalle', f: a => `<span class="mut">${EA(JSON.stringify(a.despues || a.antes || '').slice(0, 140))}</span>` }], au)}</div>`;
  }
  return `<h2>Administración</h2>${tabs}${body}`;
};
A.acts.marca_guardar = () => A.run(async () => { const d = A.formData($q('#mf2')); const r = await A.put('/marca', d); A.aplicarMarca(r); sessionStorage.setItem('mk', JSON.stringify(r)); }, 'Marca guardada');
A.acts.logo_quitar = () => A.run(async () => { await A.del('/marca/logo'); A.marca.logo = null; const mk = JSON.parse(sessionStorage.getItem('mk') || '{}'); delete mk.logo; sessionStorage.setItem('mk', JSON.stringify(mk)); }, 'Logo eliminado');
A.acts.usuario_nuevo = roles => A.form({ title: 'Nuevo usuario', fields: [{ n: 'nombre', l: 'Nombre', req: true }, { n: 'email', l: 'Email', t: 'email', req: true }, { n: 'rol_id', l: 'Rol', t: 'select', req: true, opts: A.opts(roles) }, { n: 'password', l: 'Contraseña inicial (mín. 10, letras y números; la cambiará al ingresar)', t: 'password', req: true }, { n: 'es_agente', l: 'Es agente comercial', t: 'checkbox' }], onSubmit: async d => { await A.post('/usuarios', d); A.invalidar(); } });
A.acts.usuario_editar = ({ u, roles }) => A.form({ title: 'Editar ' + u.nombre, fields: [{ n: 'nombre', l: 'Nombre', v: u.nombre }, { n: 'rol_id', l: 'Rol', t: 'select', req: true, v: u.rol_id, opts: A.opts(roles) }, { n: 'es_agente', l: 'Es agente comercial', t: 'checkbox', v: u.es_agente }, { n: 'password', l: 'Nueva contraseña (opcional)', t: 'password' }], onSubmit: async d => { await A.patch('/usuarios/' + u.id, d); A.invalidar(); } });
A.acts.usuario_toggle = u => A.run(async () => { await A.patch('/usuarios/' + u.id, { activo: !u.activo }); A.invalidar(); }, 'Actualizado');
const PERMS = '*,propiedades.*,personas.*,leads.*,visitas.*,operaciones.*,publicaciones.*,movimientos.*,comisiones.*,liquidaciones.*,contratos.*,cargos.*,pagos.*,ot.*,documentos.*,reportes.ver,catalogos.*,usuarios.*,parametros.editar,periodos.*,auditoria.ver,indices.editar,*.ver';
A.acts.rol_nuevo = () => A.form({ title: 'Nuevo rol', fields: [{ n: 'nombre', l: 'Nombre', req: true }, { n: 'alcance', l: 'Alcance de datos', t: 'select', req: true, opts: [['empresa', 'Toda la empresa'], ['propios', 'Solo lo propio']] }, { n: 'permisos', l: 'Permisos (separados por coma)', t: 'textarea', req: true, help: 'Disponibles: ' + PERMS }], onSubmit: d => A.post('/roles', { ...d, permisos: d.permisos.split(',').map(s => s.trim()).filter(Boolean) }) });
A.acts.rol_editar = r => A.form({ title: 'Editar ' + r.nombre, fields: [{ n: 'alcance', l: 'Alcance', t: 'select', req: true, v: r.alcance, opts: [['empresa', 'Toda la empresa'], ['propios', 'Solo lo propio']] }, { n: 'permisos', l: 'Permisos (coma)', t: 'textarea', v: r.permisos.join(', '), help: 'Quedará auditado' }], onSubmit: d => A.patch('/roles/' + r.id, { alcance: d.alcance, permisos: d.permisos.split(',').map(s => s.trim()).filter(Boolean) }) });
A.acts.param_guardar = () => A.run(async () => { const f = $q('#pf'); const d = A.formData(f); const { iva_pct, ...resto } = d; await A.put('/parametros', { iva_pct, parametros: resto }); A.invalidar(); }, 'Parámetros guardados');
A.acts.periodo_cerrar = () => A.form({ title: 'Cerrar período', fields: [{ n: 'p', l: 'Período (YYYY-MM)', req: true, v: A.hoy().slice(0, 7) }], onSubmit: d => A.post(`/periodos/${d.p}/cerrar`) });
A.acts.periodo_reabrir = p => A.prompt('Reabrir ' + p, 'Motivo', m => A.run(() => A.post(`/periodos/${p}/reabrir`, { motivo: m }), 'Período reabierto'));

// ---------------- INTEGRACIONES ----------------
V.integraciones = async () => {
  const lista = await A.get('/integraciones');
  const grupos = [...new Set(lista.map(i => i.grupo))];
  const chip = i => ({ conectada: A.chip('Conectada ✔', 'ok'), configurada: A.chip('Configurada (sin verificar)', 'warn'), error: A.chip('Error', 'bd'), sin_configurar: A.chip('Sin configurar') }[i.estado]);
  return `<h2>Integraciones</h2><p class="mut">Ingrese las credenciales de cada servicio. Se guardan <b>cifradas</b> y nunca se vuelven a mostrar. Use "Probar conexión" para verificarlas; una integración queda <b>habilitada</b> cuando la prueba es exitosa y usted la activa. Las integraciones marcadas "sin verificar" no cuentan con un método de prueba automática hasta que el proveedor entregue su documentación.</p>
  ${grupos.map(g => `<h3>${A.esc(g)}</h3><div class="grid g2">${lista.filter(i => i.grupo === g).map(i => `<div class="card"><div class="row"><b>${A.esc(i.nombre)}</b><span class="right"></span>${chip(i)}${i.activa ? A.chip('Activa', 'ok') : ''}</div>
    <p class="mut" style="font-size:12px">${A.esc(i.nota || '')}</p>${i.ultimo_resultado ? `<p style="font-size:12px" class="${i.estado === 'error' ? 'bd' : ''}">${A.esc(i.ultimo_resultado)} <span class="mut">${i.ultimo_test_at ? '· ' + new Date(i.ultimo_test_at).toLocaleString('es-CL') : ''}</span></p>` : ''}
    <div class="row">${A.can('integraciones.editar') ? A.btn(i.estado === 'sin_configurar' ? 'Configurar' : 'Editar credenciales', 'int_editar', i, 'pri') + (i.estado !== 'sin_configurar' ? A.btn('Probar conexión', 'int_probar', i.codigo) : '') + (i.estado === 'conectada' && !i.activa ? A.btn('Activar', 'int_activar', [i.codigo, true]) : '') + (i.activa ? A.btn('Desactivar', 'int_activar', [i.codigo, false]) : '') : ''}${A.btn('Historial', 'int_logs', i, '')}</div></div>`).join('')}</div>`).join('')}`;
};
A.acts.int_editar = i => A.form({ title: i.nombre, intro: A.esc(i.nota || ''), wide: true,
  fields: i.campos.map(c => ({ n: c.n, l: c.l, req: c.req && !c.cargado, t: c.secret ? 'password' : 'text', v: c.secret ? '' : c.valor, help: c.secret ? (c.cargado ? 'Hay un valor guardado. Déjelo vacío para conservarlo.' : 'Se guardará cifrado') : c.help })),
  submit: 'Guardar credenciales', onSubmit: async d => { await A.put('/integraciones/' + i.codigo, { valores: Object.fromEntries(i.campos.map(c => [c.n, d[c.n] ?? ''])) }); A.toast('Guardado. Ahora pruebe la conexión.'); } });
A.acts.int_probar = codigo => A.run(async () => { const r = await A.post(`/integraciones/${codigo}/probar`); A.toast((r.estado === 'conectada' ? '✔ ' : r.estado === 'error' ? '✘ ' : 'ℹ ') + r.detalle, r.estado === 'error'); }, null);
A.acts.int_activar = ([codigo, activa]) => A.run(() => A.post(`/integraciones/${codigo}/activar`, { activa }), activa ? 'Integración activada' : 'Integración desactivada');
A.acts.int_logs = async i => { const l = await A.get(`/integraciones/${i.codigo}/logs`);
  A.modal(`<h2>Historial · ${A.esc(i.nombre)}</h2>${A.tabla([{ l: 'Fecha', f: x => new Date(x.at).toLocaleString('es-CL') }, { k: 'operacion', l: 'Operación' }, { l: 'Resultado', f: x => x.ok ? A.chip('ok', 'ok') : A.chip('falló', 'bd') }, { k: 'http_status', l: 'HTTP' }, { l: 'ms', n: 1, f: x => x.duracion_ms }, { k: 'detalle', l: 'Detalle' }, { k: 'usuario', l: 'Usuario' }], l, { vacio: 'Sin intentos registrados' })}
  ${A.can('integraciones.editar') && i.estado !== 'sin_configurar' ? `<p>${A.btn('Borrar credenciales', 'int_borrar', i.codigo, 'sm bad')}</p>` : ''}<div class="row" style="justify-content:flex-end"><button data-close>Cerrar</button></div>`, true); };
A.acts.int_borrar = codigo => A.confirm('¿Borrar las credenciales guardadas?', () => A.run(() => A.del(`/integraciones/${codigo}/credenciales`), 'Credenciales borradas'), 'Borrar');
