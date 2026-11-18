// Vistas de negocio: dashboard, propiedades, personas, leads, visitas, publicaciones y operaciones.
const V = A.vistas, e_ = A.esc;
const TIPOS_DOC_MANDATO = { venta: 'mandato_venta', arriendo: 'mandato_arriendo', administracion: 'mandato_administracion' };

V.dashboard = async () => {
  const [d, al] = await Promise.all([A.get('/reportes/dashboard'), A.get('/alertas').catch(() => [])]);
  return `<div class="row"><h2>Panel</h2><span class="mut">Período ${e_(d.periodo)}</span></div>
  <div class="grid g4">
    ${A.kpi('Propiedades publicadas', d.propiedades.publicadas, `${d.propiedades.cartera} en cartera`)}
    ${A.kpi('Leads abiertos', d.leads.abiertos, `${d.leads.nuevos} nuevos sin gestionar`)}
    ${A.kpi('Ventas abiertas', d.operaciones.ventas_abiertas)}${A.kpi('Arriendos en proceso', d.operaciones.arriendos_abiertos)}
    ${A.kpi('Contratos vigentes', d.arriendos.contratos_vigentes)}${A.kpi('Facturado del mes', A.clp(d.arriendos.facturado_mes))}
    ${A.kpi('Cobrado del mes', A.clp(d.arriendos.cobrado_mes))}${A.kpi('Saldo vencido', `<span class="${d.arriendos.vencido ? 'bd' : ''}">${A.clp(d.arriendos.vencido)}</span>`, `Morosidad ${d.arriendos.morosidad_pct}%`)}
    ${A.kpi('Ingresos propios (mes)', A.clp(d.finanzas.ingresos_mes), 'neto sin IVA')}${A.kpi('Costos corredora (mes)', A.clp(d.finanzas.costos_mes))}
    ${A.kpi('Comisiones devengadas', A.clp(d.finanzas.comisiones_por_cobrar_o_pagar.monto), `${d.finanzas.comisiones_por_cobrar_o_pagar.n} pendientes`)}
    ${A.kpi('Por aprobar', d.movimientos_por_aprobar + d.mantenciones.por_aprobar, `${d.movimientos_por_aprobar} movimientos · ${d.mantenciones.por_aprobar} mantenciones`)}
  </div>
  <h3>Alertas</h3><div class="card">${A.tabla([{ l: 'Tipo', f: a => A.chip(a.tipo.replace(/_/g, ' '), a.severidad === 'alta' ? 'bd' : 'warn') }, { k: 'detalle', l: 'Detalle' }], al, { vacio: 'Sin alertas' })}</div>`;
};

// ---------------- PROPIEDADES ----------------
V.propiedades = async (r) => {
  if (r.args[0]) return V.ficha_propiedad(r.args[0]);
  const f = A.state.fp || {};
  const [rows, tipos, comunas] = await Promise.all([A.get('/propiedades' + A.qs(f)), A.catalogo('tipo_propiedad'), A.catalogo('comuna')]);
  return `<div class="row"><h2>Propiedades</h2><span class="right"></span>${A.can('propiedades.crear') ? A.btn('+ Nueva propiedad', 'prop_nueva', null, 'pri') : ''}</div>
  <div class="card row"><input id="fq" placeholder="Código o dirección" value="${e_(f.q || '')}" style="min-width:200px">
    <select id="fe"><option value="">Todos los estados</option>${['borrador', 'captada', 'publicada', 'reservada', 'vendida', 'arrendada', 'retirada'].map(s => `<option ${f.estado === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
    <select id="fc"><option value="">Todas las comunas</option>${comunas.map(c => `<option value="${c.id}" ${f.comuna_id == c.id ? 'selected' : ''}>${e_(c.nombre)}</option>`).join('')}</select>
    ${A.btn('Filtrar', 'prop_filtrar', null, '')}</div>
  <div class="card">${A.tabla([{ k: 'codigo', l: 'Código' }, { l: 'Propiedad', f: p => `${e_(p.tipo || '')} · ${e_(p.direccion)}<div class="mut">${e_(p.comuna || '')}</div>` }, { l: 'Estado', f: p => A.estado(p.estado) },
    { l: 'Venta', n: 1, f: p => p.precio_venta ? A.money(p.precio_venta, p.moneda_venta) : '' }, { l: 'Arriendo', n: 1, f: p => p.precio_arriendo ? A.money(p.precio_arriendo, p.moneda_arriendo) : '' },
    { k: 'propietarios', l: 'Propietarios' }, { k: 'agente', l: 'Agente' }, { l: 'Compl.', n: 1, f: p => p.completitud + '%' }], rows, { click: p => 'propiedades/' + p.id })}</div>`;
};
A.acts.prop_filtrar = () => { A.state.fp = { q: $q('#fq').value, estado: $q('#fe').value, comuna_id: $q('#fc').value }; A.refresh(); };
A.acts.prop_nueva = async () => {
  const [tipos, comunas, ag] = await Promise.all([A.catalogo('tipo_propiedad'), A.catalogo('comuna'), A.agentes()]);
  A.form({ title: 'Nueva propiedad', wide: true, fields: [
    { n: 'direccion', l: 'Dirección', req: true }, { n: 'tipo_id', l: 'Tipo', t: 'select', opts: A.opts(tipos), req: true }, { n: 'comuna_id', l: 'Comuna', t: 'select', opts: A.opts(comunas), req: true },
    { n: 'rol_sii', l: 'Rol SII', help: 'Ej. 1234-56' }, { n: 'sup_util', l: 'Superficie útil (m²)', t: 'number' }, { n: 'sup_terreno', l: 'Superficie terreno (m²)', t: 'number' },
    { n: 'dormitorios', l: 'Dormitorios', t: 'number' }, { n: 'banos', l: 'Baños', t: 'number' }, { n: 'estacionamientos', l: 'Estacionamientos', t: 'number' }, { n: 'bodegas', l: 'Bodegas', t: 'number' },
    { n: 'precio_venta', l: 'Precio de venta', t: 'number' }, { n: 'moneda_venta', l: 'Moneda venta', t: 'select', opts: [['UF', 'UF'], ['CLP', 'CLP']], v: 'UF', req: true },
    { n: 'precio_arriendo', l: 'Canon de arriendo', t: 'number' }, { n: 'moneda_arriendo', l: 'Moneda arriendo', t: 'select', opts: [['CLP', 'CLP'], ['UF', 'UF']], v: 'CLP', req: true },
    { n: 'gasto_comun', l: 'Gasto común', t: 'number' }, { n: 'agente_captador_id', l: 'Agente captador', t: 'select', opts: A.opts(ag), v: A.user.es_agente ? A.user.id : '' },
    { n: 'descripcion', l: 'Descripción', t: 'textarea' }],
    onSubmit: async d => { try { const p = await A.post('/propiedades', d); A.go('propiedades/' + p.id); } catch (x) { if (/misma direccion/.test(x.message) && confirm(x.message)) { const p = await A.post('/propiedades', { ...d, confirmar_duplicado: true }); A.go('propiedades/' + p.id); } else throw x; } } });
};

V.ficha_propiedad = async (id) => {
  const p = await A.get('/propiedades/' + id);
  const tab = A.state.tab && A.state.tabFor === id ? A.state.tab : (A.state.tabFor = id, A.state.tab = 'datos');
  const mov = p.movimientos.filter(m => m.estado !== 'anulado');
  const costos = mov.filter(m => m.tipo === 'egreso' && m.pagador === 'corredora' && m.fondo === 'propio').reduce((s, m) => s + m.neto_clp, 0);
  let body = '';
  if (tab === 'datos') body = `<div class="grid g2"><div class="card"><h3 style="margin-top:0">Ficha</h3><table>
      ${[['Tipo', p.tipo], ['Comuna', p.comuna], ['Dirección', p.direccion], ['Rol SII', p.rol_sii], ['Sup. útil', p.sup_util && p.sup_util + ' m²'], ['Dormitorios / baños', `${p.dormitorios ?? ''} / ${p.banos ?? ''}`],
        ['Estacionamientos / bodegas', `${p.estacionamientos} / ${p.bodegas}`], ['Gasto común', A.clp(p.gasto_comun)], ['Venta', p.precio_venta ? A.money(p.precio_venta, p.moneda_venta) : ''], ['Arriendo', p.precio_arriendo ? A.money(p.precio_arriendo, p.moneda_arriendo) : '']]
        .map(([k, v]) => `<tr><th>${k}</th><td>${e_(v || '')}</td></tr>`).join('')}</table>
      <p>${e_(p.descripcion || '')}</p><div class="row">${A.can('propiedades.editar') ? A.btn('Editar', 'prop_editar', p) + A.btn('Cambiar precio', 'prop_precio', p) : ''}</div></div>
    <div class="card"><h3 style="margin-top:0">Fotos</h3><div class="photos">${p.fotos.map((f, i) => `<div><img src="${e_(f.url)}" alt="">${A.can('propiedades.editar') ? `<br>${A.btn('Quitar', 'foto_quitar', { id: p.id, i }, 'sm bad')}` : ''}</div>`).join('') || '<span class="mut">Sin fotos</span>'}</div>
      ${A.can('propiedades.editar') ? `<p><input type="file" id="foto" accept="image/png,image/jpeg,image/webp"></p>` : ''}
      <h3>Publicable</h3><div id="pub-chk" class="mut">…</div></div></div>`;
  if (tab === 'propietarios') body = `<div class="card">${A.tabla([{ k: 'nombre', l: 'Propietario' }, { k: 'rut', l: 'RUT' }, { k: 'email', l: 'Email' }, { k: 'telefono', l: 'Teléfono' }, { l: 'Dominio', n: 1, f: o => o.porcentaje + '%' }], p.propietarios, { vacio: 'Sin propietarios registrados' })}
      ${A.can('propiedades.editar') ? A.btn('Definir propietarios', 'prop_propietarios', p, 'pri') : ''}</div>`;
  if (tab === 'mandatos') body = `<div class="card">${A.tabla([{ l: 'Tipo', f: m => A.chip(m.tipo) }, { l: 'Excl.', f: m => m.exclusivo ? 'Sí' : 'No' }, { l: 'Vigencia', f: m => `${A.fecha(m.fecha_inicio)} → ${A.fecha(m.fecha_fin)}` },
      { l: 'Comisión / honorario', f: m => m.comision_tipo ? `${m.comision_valor}${m.comision_tipo === 'porcentaje' ? '%' : m.comision_tipo === 'meses_renta' ? ' mes(es)' : ''}` : m.honorario_admin_pct ? m.honorario_admin_pct + '% del canon' : '' },
      { l: 'Estado', f: m => A.estado(m.estado) },
      { l: '', f: m => (A.can('documentos.crear') ? A.btn('Generar documento', 'doc_generar', { plantilla_tipo: TIPOS_DOC_MANDATO[m.tipo], entidad: 'mandato', entidad_id: m.id }) : '') + (m.estado === 'vigente' && A.can('propiedades.editar') ? ' ' + A.btn('Terminar', 'mandato_terminar', m.id, 'sm bad') : '') }], p.mandatos, { vacio: 'Sin mandatos' })}
      ${A.can('propiedades.editar') ? A.btn('+ Nuevo mandato', 'mandato_nuevo', p.id, 'pri') : ''}</div>`;
  if (tab === 'publicaciones') body = `<div class="card">${A.tabla([{ k: 'canal', l: 'Canal' }, { k: 'operacion', l: 'Operación' }, { l: 'Estado', f: x => A.estado(x.estado) }, { k: 'titulo', l: 'Título' }, { l: 'Precio', n: 1, f: x => A.money(x.precio, x.moneda) },
      { l: 'Costo', n: 1, f: x => A.clp(x.costo) }, { l: 'Externo', f: x => x.url_externa ? `<a href="${e_(x.url_externa)}" target="_blank" rel="noopener">${e_(x.id_externo || 'ver')}</a>` : e_(x.id_externo || '') },
      { l: '', f: x => A.can('publicaciones.editar') ? (x.estado === 'pendiente' ? A.btn('Confirmar publicación', 'pub_confirmar', x.id) : '') + (x.estado === 'publicada' ? A.btn('Pausar', 'pub_accion', [x.id, 'pausar']) : '') + (x.estado === 'pausada' ? A.btn('Reactivar', 'pub_accion', [x.id, 'reactivar']) : '') + (['publicada', 'pausada', 'pendiente'].includes(x.estado) ? A.btn('Retirar', 'pub_accion', [x.id, 'retirar'], 'sm bad') : '') : '' }], p.publicaciones, { vacio: 'Sin publicaciones' })}
      ${A.can('publicaciones.crear') ? A.btn('+ Publicar', 'pub_nueva', p, 'pri') : ''}<p class="mut">Los portales sin integración directa se publican de forma asistida: publique en el portal y registre el ID o enlace aquí. Los costos se provisionan en Finanzas.</p></div>`;
  if (tab === 'finanzas') body = `<div class="grid g4">${A.kpi('Costos propios acumulados', A.clp(costos), 'captación y publicación')}</div><div class="card">${A.tabla([{ l: 'Fecha', f: m => A.fecha(m.fecha) }, { k: 'concepto', l: 'Concepto' }, { l: 'Tipo', f: m => A.chip(m.tipo) },
      { l: 'Total', n: 1, f: m => A.clp(m.monto_clp) }, { k: 'pagador', l: 'Paga' }, { l: 'Estado', f: m => A.estado(m.estado) }, { k: 'glosa', l: 'Glosa' }], p.movimientos, { vacio: 'Sin movimientos' })}
      ${A.can('movimientos.crear') ? A.btn('+ Costo / ingreso', 'mov_nuevo', { propiedad_id: p.id }, 'pri') : ''}</div>`;
  if (tab === 'historial') body = `<div class="card">${A.tabla([{ l: 'Fecha', f: h => A.fecha(h.at) }, { k: 'tipo', l: 'Cambio' }, { k: 'anterior', l: 'Antes' }, { k: 'nuevo', l: 'Después' }, { k: 'motivo', l: 'Motivo' }, { k: 'usuario', l: 'Usuario' }], p.historial, { vacio: 'Sin cambios' })}
      <h3>Operaciones</h3>${A.tabla([{ k: 'codigo', l: 'Código' }, { k: 'tipo', l: 'Tipo' }, { l: 'Estado', f: o => A.estado(o.estado) }, { l: 'Precio', n: 1, f: o => A.money(o.precio, o.moneda) }], p.operaciones, { click: o => 'operaciones/' + o.id, vacio: 'Sin operaciones' })}</div>`;
  const next = { borrador: ['captada'], captada: ['publicada', 'retirada'], publicada: ['captada', 'retirada'], retirada: ['captada'] }[p.estado] || [];
  setTimeout(async () => {
    const el = $q('#pub-chk'); if (el) { try { const r = await A.get(`/propiedades/${id}/publicable`); el.innerHTML = r.ok ? '<span class="ok">✔ Cumple los requisitos</span>' : r.faltantes.map(x => `<div class="warn">• ${e_(x)}</div>`).join(''); } catch {} }
    const fi = $q('#foto'); if (fi) fi.onchange = () => { const f = fi.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => A.run(() => A.post(`/propiedades/${id}/fotos`, { data_url: rd.result }), 'Foto subida'); rd.readAsDataURL(f); };
  }, 0);
  return `<div class="row"><a href="#/propiedades">← Propiedades</a></div>
  <div class="row"><h2>${e_(p.codigo)} · ${e_(p.direccion)}</h2>${A.estado(p.estado)}<span class="right"></span>${next.map(s => A.can('propiedades.editar') ? A.btn('→ ' + s, 'prop_estado', [p.id, s], '') : '').join(' ')}</div>
  ${A.tabs([['datos', 'Datos'], ['propietarios', 'Propietarios'], ['mandatos', 'Mandatos'], ['publicaciones', 'Publicaciones'], ['finanzas', 'Finanzas'], ['historial', 'Historial y operaciones']], tab)}${body}`;
};
A.acts.prop_estado = async ([id, estado]) => {
  if (estado === 'retirada') return A.prompt('Motivo del retiro', 'Motivo', m => A.run(() => A.post(`/propiedades/${id}/estado`, { estado, motivo: m }), 'Estado actualizado'));
  A.run(() => A.post(`/propiedades/${id}/estado`, { estado }), 'Estado actualizado');
};
A.acts.prop_editar = async p => { const [tipos, comunas] = await Promise.all([A.catalogo('tipo_propiedad'), A.catalogo('comuna')]);
  A.form({ title: 'Editar propiedad', wide: true, fields: [{ n: 'direccion', l: 'Dirección', v: p.direccion, req: true }, { n: 'tipo_id', l: 'Tipo', t: 'select', opts: A.opts(tipos), v: p.tipo_id }, { n: 'comuna_id', l: 'Comuna', t: 'select', opts: A.opts(comunas), v: p.comuna_id },
    { n: 'rol_sii', l: 'Rol SII', v: p.rol_sii }, { n: 'sup_util', l: 'Sup. útil', t: 'number', v: p.sup_util }, { n: 'dormitorios', l: 'Dormitorios', t: 'number', v: p.dormitorios }, { n: 'banos', l: 'Baños', t: 'number', v: p.banos },
    { n: 'gasto_comun', l: 'Gasto común', t: 'number', v: p.gasto_comun }, { n: 'descripcion', l: 'Descripción', t: 'textarea', v: p.descripcion }, { n: 'notas_internas', l: 'Notas internas', t: 'textarea', v: p.notas_internas }],
    onSubmit: d => A.patch('/propiedades/' + p.id, d) }); };
A.acts.prop_precio = p => A.form({ title: 'Cambiar precio', fields: [{ n: 'operacion', l: 'Operación', t: 'select', opts: [['venta', 'Venta'], ['arriendo', 'Arriendo']], req: true }, { n: 'precio', l: 'Nuevo precio', t: 'number', req: true },
  { n: 'moneda', l: 'Moneda', t: 'select', opts: [['UF', 'UF'], ['CLP', 'CLP']], req: true }, { n: 'motivo', l: 'Motivo', help: 'Obligatorio si el cambio supera el límite configurado' }], onSubmit: d => A.post(`/propiedades/${p.id}/precio`, d) });
A.acts.foto_quitar = ({ id, i }) => A.run(() => A.del(`/propiedades/${id}/fotos/${i}`), 'Foto eliminada');
A.acts.prop_propietarios = async p => {
  const personas = await A.get('/personas');
  const cur = p.propietarios;
  A.modal(`<h2>Propietarios y dominio</h2><p class="mut">Los porcentajes deben sumar 100%.</p><div id="own">${(cur.length ? cur : [{}]).map(o => ownRow(personas, o)).join('')}</div>
    <div class="row" style="margin-top:10px">${A.btn('+ Agregar', 'own_add', null, '')}${A.btn('Crear persona', 'persona_nueva', null, '')}<span class="right"></span><button data-close>Cancelar</button><button class="pri" id="ownok">Guardar</button></div>`);
  A.acts.own_add = () => $q('#own').insertAdjacentHTML('beforeend', ownRow(personas, {}));
  $q('#ownok').onclick = () => A.run(async () => {
    const rows = [...document.querySelectorAll('#own .row')].map(r => ({ persona_id: r.querySelector('select').value, porcentaje: Number(r.querySelector('input').value) })).filter(x => x.persona_id);
    await A.put(`/propiedades/${p.id}/propietarios`, { propietarios: rows }); A.closeModal();
  }, 'Propietarios guardados');
};
const ownRow = (personas, o) => `<div class="row" style="margin-bottom:6px"><select style="min-width:260px"><option value=""></option>${personas.map(x => `<option value="${x.id}" ${x.id === o.persona_id ? 'selected' : ''}>${e_(x.nombre)} ${e_(x.rut || '')}</option>`).join('')}</select><input type="number" step="any" value="${o.porcentaje ?? 100}" style="width:90px"> %</div>`;
A.acts.mandato_nuevo = id => A.form({ title: 'Nuevo mandato', fields: [{ n: 'tipo', l: 'Tipo', t: 'select', opts: [['venta', 'Venta'], ['arriendo', 'Arriendo'], ['administracion', 'Administración']], req: true },
  { n: 'exclusivo', l: 'Con exclusividad', t: 'checkbox' }, { n: 'fecha_inicio', l: 'Inicio', t: 'date', req: true, v: A.hoy() }, { n: 'fecha_fin', l: 'Fin', t: 'date', req: true },
  { n: 'comision_tipo', l: 'Tipo de comisión', t: 'select', opts: [['porcentaje', '% del precio'], ['meses_renta', 'Meses de renta'], ['monto_fijo', 'Monto fijo']] }, { n: 'comision_valor', l: 'Valor comisión', t: 'number' },
  { n: 'honorario_admin_pct', l: 'Honorario administración (% canon)', t: 'number', help: 'Solo mandatos de administración' }, { n: 'honorario_admin_minimo', l: 'Honorario mínimo ($)', t: 'number' }],
  onSubmit: d => A.post(`/propiedades/${id}/mandatos`, d) });
A.acts.mandato_terminar = id => A.prompt('Terminar mandato', 'Motivo', m => A.run(() => A.post(`/mandatos/${id}/terminar`, { motivo: m }), 'Mandato terminado'));
A.acts.pub_nueva = async p => {
  const canales = await A.catalogo('canal');
  A.form({ title: 'Publicar propiedad', intro: 'Seleccione los canales. El costo es el provisionado en Finanzas y puede ajustarse.', fields: [
    { n: 'operacion', l: 'Operación', t: 'select', opts: [['venta', 'Venta'], ['arriendo', 'Arriendo']], req: true },
    ...canales.flatMap(c => [{ n: 'c_' + c.id, l: `${c.nombre} (${c.datos.modo === 'nativo' ? 'automático' : 'asistido'})`, t: 'checkbox', v: c.datos.modo === 'nativo' }, { n: 'k_' + c.id, l: `Costo ${c.nombre} (neto $)`, t: 'number', v: c.datos.costo || 0 }])],
    onSubmit: d => A.post(`/propiedades/${p.id}/publicaciones`, { operacion: d.operacion, canales: canales.filter(c => d['c_' + c.id]).map(c => ({ canal_id: c.id, costo: d['k_' + c.id] || 0 })) }) });
};
A.acts.pub_confirmar = id => A.form({ title: 'Confirmar publicación en el portal', fields: [{ n: 'id_externo', l: 'ID de la publicación en el portal' }, { n: 'url', l: 'URL' }], onSubmit: d => A.post(`/publicaciones/${id}/confirmar-manual`, d) });
A.acts.pub_accion = ([id, a]) => A.run(() => A.post(`/publicaciones/${id}/${a}`), 'Listo');
A.acts.doc_generar = d => A.run(async () => { const r = await A.post('/documentos/generar', d); if (r.advertencia) A.toast(r.advertencia); A.acts.doc_ver(r.id); }, 'Documento generado', false);
A.acts.doc_ver = async id => { const r = await fetch(`/api/documentos/${id}/html`, { headers: { Authorization: 'Bearer ' + A.token } }); const b = await r.blob(); window.open(URL.createObjectURL(b), '_blank'); };

// ---------------- PERSONAS ----------------
V.personas = async (r) => {
  if (r.args[0]) return V.ficha_persona(r.args[0]);
  const q = A.state.pq || '';
  const rows = await A.get('/personas' + A.qs({ q }));
  return `<div class="row"><h2>Personas</h2><span class="right"></span>${A.can('personas.crear') ? A.btn('+ Nueva persona', 'persona_nueva', null, 'pri') : ''}</div>
  <div class="card row"><input id="pq" placeholder="Nombre, RUT o email" value="${e_(q)}" style="min-width:260px">${A.btn('Buscar', 'persona_buscar', null, '')}</div>
  <div class="card">${A.tabla([{ k: 'nombre', l: 'Nombre' }, { k: 'rut', l: 'RUT' }, { k: 'email', l: 'Email' }, { k: 'telefono', l: 'Teléfono' }, { l: 'Roles', f: p => (p.roles || []).map(x => A.chip(x)).join(' ') }], rows, { click: p => 'personas/' + p.id })}</div>`;
};
A.acts.persona_buscar = () => { A.state.pq = $q('#pq').value; A.refresh(); };
A.acts.persona_nueva = () => A.form({ title: 'Nueva persona', fields: [{ n: 'nombre', l: 'Nombre completo / razón social', req: true }, { n: 'tipo', l: 'Tipo', t: 'select', opts: [['natural', 'Natural'], ['juridica', 'Jurídica']], v: 'natural', req: true },
  { n: 'rut', l: 'RUT', help: 'Se valida el dígito verificador' }, { n: 'email', l: 'Email', t: 'email' }, { n: 'telefono', l: 'Teléfono' },
  { n: 'rol', l: 'Rol', t: 'select', opts: [['propietario', 'Propietario'], ['comprador', 'Comprador'], ['arrendatario', 'Arrendatario'], ['aval', 'Aval'], ['proveedor', 'Proveedor'], ['referidor', 'Referidor']] }, { n: 'consentimiento', l: 'Otorgó consentimiento de tratamiento de datos', t: 'checkbox' }, { n: 'notas', l: 'Notas', t: 'textarea' }],
  onSubmit: async d => { const { rol, ...b } = d; if (rol) b.roles = [rol]; await A.post('/personas', b); A.invalidar(); } });
V.ficha_persona = async id => {
  const p = await A.get('/personas/' + id);
  return `<div class="row"><a href="#/personas">← Personas</a></div><div class="row"><h2>${e_(p.nombre)}</h2>${(p.roles || []).map(x => A.chip(x)).join(' ')}<span class="right"></span>${A.can('personas.editar') ? A.btn('Editar', 'persona_editar', p) : ''}</div>
  <div class="grid g2"><div class="card"><table>${[['RUT', p.rut], ['Email', p.email], ['Teléfono', p.telefono], ['Consentimiento', p.consentimiento_datos_at ? A.fecha(p.consentimiento_datos_at) : 'No registrado'], ['Notas', p.notas]].map(([k, v]) => `<tr><th>${k}</th><td>${e_(v || '')}</td></tr>`).join('')}</table></div>
  <div class="card"><h3 style="margin-top:0">Propiedades</h3>${A.tabla([{ k: 'codigo', l: 'Código' }, { k: 'direccion', l: 'Dirección' }, { l: 'Dominio', n: 1, f: x => x.porcentaje + '%' }], p.propiedades, { click: x => 'propiedades/' + x.id, vacio: 'Ninguna' })}
  <h3>Operaciones</h3>${A.tabla([{ k: 'codigo', l: 'Código' }, { k: 'tipo', l: 'Tipo' }, { l: 'Estado', f: x => A.estado(x.estado) }], p.operaciones, { click: x => 'operaciones/' + x.id, vacio: 'Ninguna' })}</div></div>
  <div class="card"><h3 style="margin-top:0">Interacciones</h3>${A.tabla([{ l: 'Fecha', f: i => A.fecha(i.at) }, { k: 'tipo', l: 'Tipo' }, { k: 'detalle', l: 'Detalle' }], p.interacciones, { vacio: 'Sin interacciones' })}
  ${A.can('leads.editar') ? A.btn('+ Registrar interacción', 'interaccion_nueva', p.id, 'pri') : ''}</div>`;
};
A.acts.persona_editar = p => A.form({ title: 'Editar persona', fields: [{ n: 'nombre', l: 'Nombre', v: p.nombre }, { n: 'rut', l: 'RUT', v: p.rut }, { n: 'email', l: 'Email', v: p.email }, { n: 'telefono', l: 'Teléfono', v: p.telefono }, { n: 'notas', l: 'Notas', t: 'textarea', v: p.notas }, { n: 'no_contactar', l: 'No contactar (sin comunicaciones comerciales)', t: 'checkbox', v: p.no_contactar }], onSubmit: d => A.patch('/personas/' + p.id, d) });
A.acts.interaccion_nueva = id => A.form({ title: 'Registrar interacción', fields: [{ n: 'tipo', l: 'Tipo', t: 'select', opts: [['llamada', 'Llamada'], ['email', 'Email'], ['whatsapp', 'WhatsApp'], ['reunion', 'Reunión'], ['nota', 'Nota']], req: true, v: 'llamada' }, { n: 'detalle', l: 'Detalle', t: 'textarea', req: true }], onSubmit: d => A.post('/interacciones', { ...d, persona_id: id }) });

// ---------------- LEADS Y VISITAS ----------------
V.leads = async () => {
  const leads = await A.get('/leads');
  const cols = ['nuevo', 'contactado', 'visita', 'oferta', 'ganado', 'perdido'];
  const sig = { nuevo: ['contactado'], contactado: ['visita', 'oferta'], visita: ['oferta'], oferta: ['ganado'], ganado: [], perdido: ['contactado'] };
  return `<div class="row"><h2>Leads</h2><span class="right"></span>${A.can('leads.crear') ? A.btn('+ Nuevo lead', 'lead_nuevo', null, 'pri') : ''}</div>
  <div class="kan">${cols.map(c => `<div class="col"><h4>${c} <span class="mut">(${leads.filter(l => l.estado === c).length})</span></h4>${leads.filter(l => l.estado === c).map(l => `<div class="c">
    <b>${e_(l.persona)}</b><div class="mut">${e_(l.interes)} ${l.propiedad ? '· ' + e_(l.propiedad) : ''}</div><div class="mut">${e_(l.fuente || '')} · ${e_(l.agente || 'sin agente')}</div>
    ${l.mensaje ? `<div style="margin:4px 0">${e_(l.mensaje)}</div>` : ''}<div class="row">${(sig[c] || []).map(s => A.btn('→ ' + s, 'lead_estado', [l.id, s])).join('')}${!['ganado', 'perdido'].includes(c) ? A.btn('Perdido', 'lead_perdido', l.id, 'sm bad') : ''}${c === 'oferta' || c === 'visita' ? A.btn('Crear operación', 'lead_operacion', l, 'sm') : ''}</div></div>`).join('')}</div>`).join('')}</div>`;
};
A.acts.lead_estado = ([id, estado]) => A.run(() => A.post(`/leads/${id}/estado`, { estado }), 'Lead actualizado');
A.acts.lead_perdido = async id => { const m = await A.catalogo('motivo_perdida'); A.form({ title: 'Marcar como perdido', fields: [{ n: 'motivo_perdida_id', l: 'Motivo', t: 'select', opts: A.opts(m), req: true }], onSubmit: d => A.post(`/leads/${id}/estado`, { estado: 'perdido', ...d }) }); };
A.acts.lead_operacion = l => A.go('operaciones?nuevo=1&propiedad=' + (l.propiedad_id || '') + '&persona=' + l.persona_id + '&lead=' + l.id);
A.acts.lead_nuevo = async () => {
  const [f, props] = await Promise.all([A.catalogo('fuente_lead'), A.get('/propiedades')]);
  A.form({ title: 'Nuevo lead', fields: [{ n: 'nombre', l: 'Nombre', req: true }, { n: 'email', l: 'Email', t: 'email' }, { n: 'telefono', l: 'Teléfono' }, { n: 'interes', l: 'Interés', t: 'select', req: true, v: 'comprar', opts: [['comprar', 'Comprar'], ['arrendar', 'Arrendar'], ['vender', 'Vender'], ['arrendar_propiedad_propia', 'Arrendar su propiedad'], ['administrar', 'Administrar']] },
    { n: 'fuente_id', l: 'Fuente', t: 'select', opts: A.opts(f) }, { n: 'propiedad_id', l: 'Propiedad consultada', t: 'select', opts: props.map(p => [p.id, `${p.codigo} ${p.direccion}`]) }, { n: 'mensaje', l: 'Mensaje', t: 'textarea' }, { n: 'consentimiento', l: 'Consintió el tratamiento de sus datos', t: 'checkbox' }],
    onSubmit: d => A.post('/leads', d) });
};
V.visitas = async () => {
  const v = await A.get('/visitas');
  return `<div class="row"><h2>Visitas</h2><span class="right"></span>${A.can('visitas.crear') ? A.btn('+ Agendar visita', 'visita_nueva', null, 'pri') : ''}</div>
  <div class="card">${A.tabla([{ l: 'Inicio', f: x => new Date(x.inicio).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }) }, { k: 'codigo', l: 'Propiedad' }, { k: 'direccion', l: 'Dirección' }, { k: 'persona', l: 'Cliente' }, { k: 'agente', l: 'Agente' }, { l: 'Estado', f: x => A.estado(x.estado) },
    { l: '', f: x => A.can('visitas.editar') ? (x.estado === 'agendada' ? A.btn('Confirmar', 'visita_estado', [x.id, 'confirmada']) : '') + (['agendada', 'confirmada'].includes(x.estado) ? A.btn('Realizada', 'visita_fb', x.id) + A.btn('No asistió', 'visita_estado', [x.id, 'no_asistio'], 'sm bad') : '') : '' }], v)}</div>`;
};
A.acts.visita_estado = ([id, estado]) => A.run(() => A.post(`/visitas/${id}/estado`, { estado }), 'Visita actualizada');
A.acts.visita_fb = id => A.form({ title: 'Visita realizada', fields: [{ n: 'interes_nivel', l: 'Interés del cliente (1-5)', t: 'number', step: 1 }, { n: 'feedback', l: 'Comentarios', t: 'textarea' }], onSubmit: d => A.post(`/visitas/${id}/estado`, { estado: 'realizada', ...d }) });
A.acts.visita_nueva = async () => {
  const [props, leads] = await Promise.all([A.get('/propiedades'), A.get('/leads')]);
  A.form({ title: 'Agendar visita', fields: [{ n: 'propiedad_id', l: 'Propiedad', t: 'select', req: true, opts: props.map(p => [p.id, `${p.codigo} ${p.direccion}`]) }, { n: 'lead_id', l: 'Lead', t: 'select', opts: leads.filter(l => !['ganado', 'perdido'].includes(l.estado)).map(l => [l.id, l.persona]) },
    { n: 'inicio', l: 'Inicio', t: 'datetime-local', req: true }, { n: 'fin', l: 'Fin', t: 'datetime-local', req: true }], onSubmit: d => A.post('/visitas', { ...d, inicio: new Date(d.inicio).toISOString(), fin: new Date(d.fin).toISOString() }) });
};

// ---------------- PUBLICACIONES ----------------
V.publicaciones = async () => {
  const rows = await A.get('/publicaciones');
  return `<h2>Publicaciones</h2><div class="card">${A.tabla([{ k: 'codigo', l: 'Propiedad' }, { k: 'direccion', l: 'Dirección' }, { k: 'canal', l: 'Canal' }, { k: 'operacion', l: 'Operación' }, { l: 'Estado', f: x => A.estado(x.estado) }, { l: 'Costo', n: 1, f: x => A.clp(x.costo) }, { k: 'id_externo', l: 'ID externo' },
    { l: '', f: x => x.estado === 'pendiente' && A.can('publicaciones.editar') ? A.btn('Confirmar publicación', 'pub_confirmar', x.id) : '' }], rows)}</div>
  <p class="mut">Sitio público de la empresa: <a href="/sitio/${e_(A.user.empresa_slug || 'demo')}" target="_blank">/sitio/${e_(A.user.empresa_slug || 'demo')}</a></p>`;
};

// ---------------- OPERACIONES ----------------
V.operaciones = async (r) => {
  if (r.args[0]) return V.ficha_operacion(r.args[0]);
  if (r.query.nuevo) { setTimeout(() => A.acts.op_nueva(r.query), 0); history.replaceState(null, '', '#/operaciones'); }
  const tipo = A.state.optipo || '';
  const rows = await A.get('/operaciones' + A.qs({ tipo }));
  return `<div class="row"><h2>Operaciones</h2><span class="right"></span><select id="otipo" style="width:auto"><option value="">Venta y arriendo</option><option value="venta" ${tipo === 'venta' ? 'selected' : ''}>Ventas</option><option value="arriendo" ${tipo === 'arriendo' ? 'selected' : ''}>Arriendos</option></select>${A.can('operaciones.crear') ? A.btn('+ Nueva operación', 'op_nueva', {}, 'pri') : ''}</div>
  <div class="card">${A.tabla([{ k: 'codigo', l: 'Código' }, { k: 'tipo', l: 'Tipo' }, { l: 'Propiedad', f: o => `${e_(o.propiedad)} <span class="mut">${e_(o.direccion)}</span>` }, { k: 'cliente', l: 'Cliente' }, { k: 'agente_vendedor', l: 'Agente' }, { l: 'Estado', f: o => A.estado(o.estado) }, { l: 'Precio', n: 1, f: o => A.money(o.precio, o.moneda) }], rows, { click: o => 'operaciones/' + o.id })}</div>`;
};
document.addEventListener('change', ev => { if (ev.target.id === 'otipo') { A.state.optipo = ev.target.value; A.refresh(); } });
A.acts.op_nueva = async (pre = {}) => {
  const [props, personas] = await Promise.all([A.get('/propiedades'), A.get('/personas')]);
  A.form({ title: 'Nueva operación', fields: [{ n: 'tipo', l: 'Tipo', t: 'select', opts: [['venta', 'Venta'], ['arriendo', 'Arriendo']], req: true }, { n: 'propiedad_id', l: 'Propiedad', t: 'select', req: true, v: pre.propiedad, opts: props.filter(p => !['vendida', 'arrendada', 'retirada'].includes(p.estado)).map(p => [p.id, `${p.codigo} ${p.direccion} (${p.estado})`]) },
    { n: 'cliente_id', l: 'Comprador / arrendatario', t: 'select', v: pre.persona, opts: personas.map(p => [p.id, `${p.nombre} ${p.rut || ''}`]) }, { n: 'precio', l: 'Precio acordado (opcional)', t: 'number', help: 'Por defecto, el precio de la ficha' }],
    intro: 'La propiedad debe tener un mandato vigente del tipo de operación.', onSubmit: async d => { const o = await A.post('/operaciones', { ...d, lead_id: pre.lead }); if (d.cliente_id) await A.patch('/operaciones/' + o.id, { cliente_id: d.cliente_id }); A.go('operaciones/' + o.id); } });
};
V.ficha_operacion = async id => {
  const o = await A.get('/operaciones/' + id);
  const op = o.operacion, fl = o.flujo.sig;
  const orden = Object.keys(fl).filter(s => !['caida', 'rechazada'].includes(s));
  const idx = orden.indexOf(op.estado);
  const ag = await A.agentes();
  const tab = A.state.tab && A.state.tabFor === id ? A.state.tab : (A.state.tabFor = id, A.state.tab = 'resumen');
  const fm = (n) => `<tr><th>${n[0]}</th><td class="n">${n[1]}</td></tr>`;
  let body = '';
  if (tab === 'resumen') body = `<div class="grid g2"><div class="card"><h3 style="margin-top:0">Operación</h3><table>
      ${[['Propiedad', `<a href="#/propiedades/${op.propiedad_id}">${e_(o.propiedad.codigo)}</a> ${e_(o.propiedad.direccion)}`], ['Cliente', o.cliente ? `<a href="#/personas/${o.cliente.id}">${e_(o.cliente.nombre)}</a>` : '<span class="warn">Sin asignar</span>'],
        ['Precio', A.money(op.precio, op.moneda)], ['Agente captador', e_((ag.find(a => a.id === op.agente_captador_id) || {}).nombre || '')], ['Agente vendedor', e_((ag.find(a => a.id === op.agente_vendedor_id) || {}).nombre || '')], ['Abierta', A.fecha(op.abierta_at)], ['Motivo de caída', e_(op.caida_motivo || '')]].map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>
      ${A.can('operaciones.editar') && !['cerrada', 'caida', 'rechazada'].includes(op.estado) ? A.btn('Asignar cliente / agente', 'op_asignar', op) : ''}</div>
    <div class="card"><h3 style="margin-top:0">Historial</h3>${A.tabla([{ l: 'Fecha', f: h => A.fecha(h.at) }, { l: 'Cambio', f: h => `${e_(h.estado_desde || '—')} → ${e_(h.estado_hacia)}` }, { k: 'usuario', l: 'Usuario' }, { k: 'motivo', l: 'Motivo' }], o.historial)}</div></div>
    ${op.tipo === 'arriendo' ? `<div class="card"><h3 style="margin-top:0">Contrato de arriendo</h3>${o.contratos.length ? A.tabla([{ l: 'Vigencia', f: k => `${A.fecha(k.fecha_inicio)} → ${A.fecha(k.fecha_termino)}` }, { l: 'Canon', n: 1, f: k => A.money(k.canon_vigente, k.canon_moneda) }, { l: 'Estado', f: k => A.estado(k.estado) }], o.contratos, { click: k => 'contratos/' + k.id }) : '<p class="mut">Sin contrato.</p>'}
      ${op.estado === 'aprobada' && !o.contratos.length && A.can('contratos.crear') ? A.btn('Crear contrato', 'contrato_nuevo', op, 'pri') : ''}</div>` : ''}`;
  if (tab === 'finanzas') body = `<div class="grid g4">${A.kpi('Ingresos (comisión neta)', A.clp(o.ingresos))}${A.kpi('Costos de la corredora', A.clp(o.costos))}${A.kpi('Comisiones a agentes', A.clp(o.comisiones_agentes))}${A.kpi('Utilidad neta', `<span class="${o.utilidad < 0 ? 'bd' : 'ok'}">${A.clp(o.utilidad)}</span>`, o.margen_pct !== null ? `Margen ${o.margen_pct}%` : '')}</div>
    <div class="card"><h3 style="margin-top:0">Comisiones</h3>${A.tabla([{ k: 'hito', l: 'Hito' }, { l: 'Neto', n: 1, f: c => A.clp(c.monto_neto) }, { l: 'IVA', n: 1, f: c => A.clp(c.iva) }, { l: 'Estado', f: c => A.estado(c.estado) },
      { l: 'Reparto', f: c => (c.reparto || []).map(r => `${r.rol}: ${A.clp(r.monto)}`).join(' · ') }, { l: '', f: c => c.estado === 'devengada' && A.can('comisiones.aprobar') ? A.btn('Aprobar', 'com_aprobar', c.id) : '' }], o.comisiones, { vacio: 'Aún no se devenga la comisión (se genera al alcanzar el hito de la regla)' })}
      ${['cerrada', 'caida', 'rechazada'].includes(op.estado) ? '' : A.btn('Simular comisión y utilidad', 'com_simular', op.id)}</div>
    <div class="card"><h3 style="margin-top:0">Movimientos de la operación</h3>${A.tabla([{ l: 'Fecha', f: m => A.fecha(m.fecha) }, { k: 'concepto', l: 'Concepto' }, { l: 'Tipo', f: m => A.chip(m.tipo) }, { l: 'Neto', n: 1, f: m => A.clp(m.neto_clp) }, { l: 'IVA', n: 1, f: m => A.clp(m.iva_clp) }, { k: 'pagador', l: 'Paga' }, { l: 'Estado', f: m => A.estado(m.estado) }, { k: 'glosa', l: 'Glosa' }, { l: '', f: m => movAcciones(m) }], o.movimientos)}
      ${A.can('movimientos.crear') && !['caida'].includes(op.estado) ? A.btn('+ Costo / ingreso', 'mov_nuevo', { operacion_id: op.id, propiedad_id: op.propiedad_id }, 'pri') : ''}
      ${o.costos_propiedad_no_asignados ? `<p class="mut">Además hay ${A.clp(o.costos_propiedad_no_asignados)} de costos a nivel de propiedad (captación/publicación) sin operación asociada.</p>` : ''}${o.movimientos_sin_respaldo ? `<p class="warn">${o.movimientos_sin_respaldo} egreso(s) sin respaldo.</p>` : ''}</div>`;
  const perm = (o.permitidos || []);
  return `<div class="row"><a href="#/operaciones">← Operaciones</a></div><div class="row"><h2>${e_(op.codigo)}</h2>${A.estado(op.estado)}<span class="mut">${e_(op.tipo)}</span></div>
  <div class="steps">${orden.map((s, i) => `<span class="s ${i < idx ? 'done' : i === idx ? 'now' : ''}">${s.replace(/_/g, ' ')}</span>`).join('')}${['caida', 'rechazada'].includes(op.estado) ? A.chip(op.estado, 'bd') : ''}</div>
  <div class="row">${A.can('operaciones.editar') ? perm.map(s => ['caida', 'rechazada'].includes(s) ? A.btn('Marcar ' + s, 'op_avanzar', [op.id, s], 'sm bad') : A.btn('Avanzar a ' + s.replace(/_/g, ' '), 'op_avanzar', [op.id, s], 'pri')).join(' ') : ''}</div>
  ${A.tabs([['resumen', 'Resumen'], ['finanzas', 'Finanzas y comisión']], tab)}${body}`;
};
const movAcciones = m => {
  if (m.estado === 'anulado') return '';
  let h = '';
  if (A.can('movimientos.editar')) { if (m.estado === 'provisionado') h += A.btn('Facturado', 'mov_estado', [m.id, 'facturado']); if (m.estado !== 'pagado') h += A.btn('Pagado', 'mov_pagar', m.id); }
  if (m.requiere_aprobacion && !m.aprobado_por && A.can('movimientos.aprobar')) h += A.btn('Aprobar', 'mov_aprobar', m.id);
  if (A.can('movimientos.anular')) h += A.btn('Anular', 'mov_anular', m.id, 'sm bad');
  return h;
};
A.movAcciones = movAcciones;
A.acts.op_avanzar = async ([id, estado]) => {
  const run = (extra = {}) => A.run(async () => { const r = await A.post(`/operaciones/${id}/avanzar`, { estado_hacia: estado, ...extra }); if (r.comision_devengada) A.toast('Comisión devengada'); }, 'Operación actualizada');
  if (['caida', 'rechazada'].includes(estado)) return A.prompt('Motivo', 'Motivo', m => run({ motivo: m }));
  A.confirm(`¿Avanzar a "${estado.replace(/_/g, ' ')}"?`, () => run());
};
A.acts.op_asignar = async op => { const [personas, ag] = await Promise.all([A.get('/personas'), A.agentes()]);
  A.form({ title: 'Asignar', fields: [{ n: 'cliente_id', l: 'Cliente', t: 'select', v: op.cliente_id, opts: personas.map(p => [p.id, `${p.nombre} ${p.rut || ''}`]) }, { n: 'agente_vendedor_id', l: 'Agente vendedor', t: 'select', v: op.agente_vendedor_id, opts: A.opts(ag) }], onSubmit: d => A.patch('/operaciones/' + op.id, d) }); };
A.acts.com_aprobar = id => A.run(() => A.post(`/comisiones/${id}/aprobar`), 'Comisión aprobada');
A.acts.com_simular = async id => { try { const s = await A.post(`/operaciones/${id}/comision/simular`, {});
  A.modal(`<h2>Simulación de comisión</h2><p class="mut">Regla: ${e_(s.regla)} · se devenga en: ${e_(s.hito)}</p><table>
    ${[['Base (CLP)', A.clp(s.base_clp)], ['Comisión neta', A.clp(s.monto_neto)], ['IVA', A.clp(s.iva)], ['Total a cobrar', A.clp(s.total)]].map(([k, v]) => `<tr><th>${k}</th><td class="n">${v}</td></tr>`).join('')}</table>
    <h3>Reparto</h3>${A.tabla([{ k: 'rol', l: 'Rol' }, { l: '%', n: 1, f: l => l.pct }, { l: 'Monto', n: 1, f: l => A.clp(l.monto) }, { l: 'Beneficiario', f: l => l.beneficiario_id ? '' : 'Corredora' }], s.reparto)}
    <p><b>Costos actuales:</b> ${A.clp(s.costos_actuales)} · <b>Utilidad estimada:</b> <span class="${s.utilidad_estimada < 0 ? 'bd' : 'ok'}">${A.clp(s.utilidad_estimada)}</span></p><div class="row" style="justify-content:flex-end"><button data-close>Cerrar</button></div>`); } catch (x) { A.toast(x.message, true); } };
A.acts.contrato_nuevo = op => A.form({ title: 'Crear contrato de arriendo', wide: true, intro: 'Quedará en borrador hasta marcar la operación como "contrato firmado".', fields: [
  { n: 'fecha_inicio', l: 'Inicio', t: 'date', req: true, v: A.hoy() }, { n: 'fecha_termino', l: 'Término', t: 'date', req: true }, { n: 'canon', l: 'Canon mensual', t: 'number', v: op.precio, req: true }, { n: 'canon_moneda', l: 'Moneda', t: 'select', opts: [['CLP', 'CLP'], ['UF', 'UF']], v: op.moneda, req: true },
  { n: 'dia_pago', l: 'Día de pago (1-28)', t: 'number', v: 5, req: true }, { n: 'garantia_monto', l: 'Garantía ($)', t: 'number' }, { n: 'reajuste_tipo', l: 'Reajuste', t: 'select', req: true, v: 'ipc', opts: [['ipc', 'IPC'], ['porcentaje_fijo', '% fijo'], ['monto_fijo', 'Monto fijo'], ['ninguno', 'Sin reajuste']] },
  { n: 'reajuste_periodicidad_meses', l: 'Cada (meses)', t: 'number', v: 12 }, { n: 'reajuste_valor', l: 'Valor (si es fijo)', t: 'number' }, { n: 'interes_mora_pct', l: 'Interés por mora (% mensual)', t: 'number', v: 0 }, { n: 'dias_gracia', l: 'Días de gracia', t: 'number', v: 0 },
  { n: 'cobra_gasto_comun', l: 'Cobrar gasto común al arrendatario (reembolso)', t: 'checkbox' }, { n: 'administrado', l: 'Administrado por la corredora', t: 'checkbox', v: true }],
  onSubmit: d => A.post(`/operaciones/${op.id}/contrato`, d) });
