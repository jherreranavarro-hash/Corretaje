// Vistas financieras y de administración de cartera: movimientos, comisiones, contratos, cobranza, liquidaciones, OT, documentos y reportes.
const E = A.esc;

// ---------------- MOVIMIENTOS (libro) ----------------
A.acts.mov_nuevo = async (pre = {}) => {
  const [cons, mp, ag] = await Promise.all([A.conceptos(), A.catalogo('medio_pago'), A.catalogo('centro_costo')]);
  const ref = Object.fromEntries(cons.map(c => [c.id, c]));
  A.form({ title: 'Registrar movimiento', wide: true, intro: 'Ingrese el monto neto. El IVA se calcula automáticamente según el concepto. Los movimientos no se editan: se anulan.', fields: [
    { n: 'concepto_id', l: 'Concepto', t: 'select', req: true, opts: cons.filter(c => !['COBRO_ARRIENDO', 'COM_AGENTE', 'PAGO_PROPIETARIO', 'TRASPASO_FONDOS'].includes(c.codigo)).map(c => [c.id, `${c.nombre} (${c.naturaleza})`]) },
    { n: 'monto_neto', l: 'Monto neto', t: 'number', req: true }, { n: 'moneda', l: 'Moneda', t: 'select', opts: [['CLP', 'CLP'], ['UF', 'UF']], v: 'CLP', req: true },
    { n: 'fecha', l: 'Fecha', t: 'date', v: A.hoy(), req: true }, { n: 'pagador', l: 'Quién paga / asume', t: 'select', req: true, v: 'corredora', opts: [['corredora', 'Corredora'], ['propietario', 'Propietario'], ['cliente', 'Cliente'], ['tercero', 'Tercero']] },
    { n: 'fondo', l: 'Fondo', t: 'select', v: 'propio', req: true, opts: [['propio', 'Propio'], ['terceros', 'Terceros (dinero del propietario)']], help: 'Gastos pagados con dinero de arriendos van a "terceros"' },
    { n: 'estado', l: 'Estado', t: 'select', v: 'provisionado', req: true, opts: [['provisionado', 'Provisionado'], ['facturado', 'Facturado'], ['pagado', 'Pagado']] }, { n: 'medio_pago_id', l: 'Medio de pago', t: 'select', opts: A.opts(mp) },
    { n: 'nro_documento', l: 'N° documento (respaldo)' }, { n: 'tipo_documento_tributario', l: 'Tipo de documento', t: 'select', opts: [['factura', 'Factura'], ['boleta_honorarios', 'Boleta de honorarios'], ['boleta', 'Boleta'], ['comprobante', 'Comprobante']] },
    { n: 'centro_costo_id', l: 'Centro de costo', t: 'select', opts: A.opts(ag), help: 'Obligatorio si no está vinculado a una operación o propiedad' }, { n: 'iva', l: 'IVA manual (opcional)', t: 'number', help: 'Si difiere del calculado, debe justificar en la glosa' },
    { n: 'glosa', l: 'Glosa', t: 'textarea' }], onSubmit: d => A.post('/movimientos', { ...pre, ...d }) });
};
A.acts.mov_estado = ([id, estado]) => A.run(() => A.post(`/movimientos/${id}/estado`, { estado }), 'Estado actualizado');
A.acts.mov_pagar = id => A.form({ title: 'Marcar como pagado', fields: [{ n: 'fecha_pago', l: 'Fecha de pago', t: 'date', v: A.hoy() }, { n: 'nro_documento', l: 'N° documento (si el concepto exige respaldo)' }], onSubmit: d => A.post(`/movimientos/${id}/estado`, { estado: 'pagado', ...d }) });
A.acts.mov_aprobar = id => A.run(() => A.post(`/movimientos/${id}/aprobar`), 'Movimiento aprobado');
A.acts.mov_anular = id => A.prompt('Anular movimiento (se crea una reversa)', 'Motivo', m => A.run(() => A.post(`/movimientos/${id}/anular`, { motivo: m }), 'Movimiento anulado'), 'Anular');

V.movimientos = async () => {
  const f = A.state.fm || { periodo: A.hoy().slice(0, 7) };
  const rows = await A.get('/movimientos' + A.qs(f));
  const vivos = rows.filter(m => m.estado !== 'anulado');
  const ing = vivos.filter(m => m.tipo === 'ingreso' && m.fondo === 'propio').reduce((s, m) => s + m.neto_clp, 0), egr = vivos.filter(m => m.tipo === 'egreso' && m.fondo === 'propio').reduce((s, m) => s + m.neto_clp, 0);
  return `<div class="row"><h2>Libro de movimientos</h2><span class="right"></span>${A.can('movimientos.crear') ? A.btn('+ Nuevo movimiento', 'mov_nuevo', {}, 'pri') : ''}</div>
  <div class="card row"><input id="mper" placeholder="YYYY-MM" value="${E(f.periodo || '')}" style="width:110px">
    <select id="mtipo"><option value="">Todos</option>${['ingreso', 'egreso', 'traspaso'].map(t => `<option ${f.tipo === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
    <select id="mfondo"><option value="">Ambos fondos</option><option value="propio" ${f.fondo === 'propio' ? 'selected' : ''}>Propio</option><option value="terceros" ${f.fondo === 'terceros' ? 'selected' : ''}>Terceros</option></select>
    <select id="mest"><option value="">Todos los estados</option>${['provisionado', 'facturado', 'pagado', 'anulado'].map(t => `<option ${f.estado === t ? 'selected' : ''}>${t}</option>`).join('')}</select>${A.btn('Filtrar', 'mov_filtrar', null, '')}
    <span class="mut">Ingresos propios netos ${A.clp(ing)} · Egresos propios netos ${A.clp(egr)}</span></div>
  <div class="card">${A.tabla([{ l: 'Fecha', f: m => A.fecha(m.fecha) }, { k: 'concepto', l: 'Concepto' }, { l: 'Vínculo', f: m => E(m.operacion || m.propiedad || '') }, { l: 'Tipo', f: m => A.chip(m.tipo) },
    { l: 'Neto', n: 1, f: m => A.clp(m.neto_clp) }, { l: 'IVA', n: 1, f: m => A.clp(m.iva_clp) }, { l: 'Total', n: 1, f: m => A.clp(m.monto_clp) }, { k: 'pagador', l: 'Paga' }, { l: 'Fondo', f: m => m.fondo === 'terceros' ? A.chip('terceros', 'warn') : 'propio' },
    { l: 'Estado', f: m => A.estado(m.estado) + (m.requiere_aprobacion && !m.aprobado_por && m.estado !== 'anulado' ? ' ' + A.chip('por aprobar', 'warn') : '') }, { k: 'glosa', l: 'Glosa' }, { l: '', f: m => A.movAcciones(m) }], rows)}</div>`;
};
A.acts.mov_filtrar = () => { A.state.fm = { periodo: $q('#mper').value, tipo: $q('#mtipo').value, fondo: $q('#mfondo').value, estado: $q('#mest').value }; A.refresh(); };

// ---------------- COMISIONES ----------------
V.comisiones = async () => {
  const [coms, reglas, ag] = await Promise.all([A.get('/comisiones'), A.get('/reglas-comision'), A.agentes()]);
  return `<h2>Comisiones</h2>
  <div class="card"><h3 style="margin-top:0">Comisiones devengadas</h3><p class="mut">Se aprueban cuando el cliente pagó la comisión (política configurable). Luego se liquidan a cada agente.</p>
  ${A.tabla([{ k: 'codigo', l: 'Operación' }, { k: 'propiedad', l: 'Propiedad' }, { k: 'hito', l: 'Hito' }, { l: 'Neto', n: 1, f: c => A.clp(c.monto_neto) }, { l: 'Cobro cliente', f: c => A.estado(c.ingreso_estado) }, { l: 'Estado', f: c => A.estado(c.estado) },
    { l: 'Reparto', f: c => (c.reparto || []).map(r => `${E(r.agente || 'Corredora')}: ${A.clp(r.monto)}`).join('<br>') },
    { l: '', f: c => c.estado === 'devengada' && A.can('comisiones.aprobar') ? A.btn('Aprobar', 'com_aprobar', c.id) + A.btn('Cambiar reparto', 'com_reparto', c) : '' }], coms)}</div>
  <div class="card"><h3 style="margin-top:0">Reglas de comisión</h3>${A.tabla([{ k: 'nombre', l: 'Regla' }, { k: 'tipo_operacion', l: 'Operación' }, { k: 'base', l: 'Base' }, { l: 'Valor', f: r => r.base === 'renta_meses' ? r.meses + ' mes(es)' : r.base === 'fijo' ? A.clp(r.monto_fijo) : r.pct + '%' },
    { k: 'hito_devengo', l: 'Se devenga en' }, { l: 'Reparto', f: r => Object.entries(r.reparto).map(([k, v]) => `${k} ${v}%`).join(' · ') }, { l: 'Vigente', f: r => r.activa ? A.chip('activa', 'ok') : A.chip('histórica') }], reglas)}
    ${A.can('comisiones.reglas') ? A.btn('+ Nueva regla (versión)', 'regla_nueva', null, 'pri') : ''}<p class="mut">Una regla nueva reemplaza a la vigente del mismo tipo e hito; las comisiones ya devengadas conservan la regla con que se calcularon.</p></div>`;
};
A.acts.regla_nueva = () => A.form({ title: 'Nueva regla de comisión', wide: true, fields: [{ n: 'nombre', l: 'Nombre', req: true }, { n: 'tipo_operacion', l: 'Operación', t: 'select', req: true, opts: [['venta', 'Venta'], ['arriendo', 'Arriendo']] },
  { n: 'base', l: 'Base de cálculo', t: 'select', req: true, opts: [['precio', '% del precio'], ['canon', '% del canon'], ['renta_meses', 'Meses de renta'], ['fijo', 'Monto fijo']] }, { n: 'pct', l: '% (si aplica)', t: 'number' }, { n: 'meses', l: 'Meses de renta', t: 'number' }, { n: 'monto_fijo', l: 'Monto fijo', t: 'number' },
  { n: 'minimo', l: 'Mínimo ($)', t: 'number' }, { n: 'tope', l: 'Tope ($)', t: 'number' }, { n: 'hito_devengo', l: 'Se devenga en (estado)', req: true, help: 'Venta: reserva, promesa, escritura… · Arriendo: contrato_firmado' },
  { n: 'pagador', l: 'Paga la comisión', t: 'select', req: true, opts: [['cliente', 'Cliente'], ['propietario', 'Propietario'], ['tercero', 'Tercero']] }, { n: 'afecta_iva', l: 'Afecta a IVA', t: 'checkbox', v: true },
  { n: 'r_captador', l: 'Reparto captador %', t: 'number', v: 30, req: true }, { n: 'r_vendedor', l: 'Reparto vendedor %', t: 'number', v: 40, req: true }, { n: 'r_corredora', l: 'Reparto corredora %', t: 'number', v: 30, req: true }],
  onSubmit: d => { const { r_captador, r_vendedor, r_corredora, ...b } = d; return A.post('/reglas-comision', { ...b, reparto: { captador: r_captador, vendedor: r_vendedor, corredora: r_corredora } }); } });
A.acts.com_reparto = async c => { const ag = await A.agentes();
  A.form({ title: 'Modificar reparto', intro: 'Queda auditado con el motivo. Los % deben sumar 100.', fields: [{ n: 'captador', l: 'Captador %', t: 'number', v: (c.reparto.find(r => r.rol === 'captador') || {}).pct || 0, req: true }, { n: 'vendedor', l: 'Vendedor %', t: 'number', v: (c.reparto.find(r => r.rol === 'vendedor') || {}).pct || 0, req: true },
    { n: 'referido', l: 'Referido %', t: 'number', v: 0 }, { n: 'corredora', l: 'Corredora %', t: 'number', v: (c.reparto.find(r => r.rol === 'corredora') || {}).pct || 0, req: true }, { n: 'motivo', l: 'Motivo', req: true, t: 'textarea' }],
    onSubmit: async d => { const prev = Object.fromEntries(c.reparto.map(r => [r.rol, r.beneficiario_id])); const l = ['captador', 'vendedor', 'referido', 'corredora'].filter(k => d[k] > 0 || k === 'corredora').map(k => ({ rol: k, pct: d[k] || 0, beneficiario_id: k === 'corredora' ? null : prev[k] || null })); await A.patch(`/comisiones/${c.id}/reparto`, { reparto: l, motivo: d.motivo }); } }); };

// ---------------- LIQUIDACIONES ----------------
V.liquidaciones = async () => {
  const tab = A.state.tab || 'propietarios'; A.state.tabFor = null;
  const tabs = A.tabs([['propietarios', 'Propietarios'], ['agentes', 'Agentes']], tab);
  if (tab === 'agentes') {
    const rows = await A.get('/liquidaciones-agente');
    return `<div class="row"><h2>Liquidaciones</h2><span class="right"></span>${A.can('liquidaciones.crear') ? A.btn('Generar liquidaciones de comisiones', 'liqa_generar', null, 'pri') : ''}</div>${tabs}
    <div class="card">${A.tabla([{ k: 'periodo', l: 'Período' }, { k: 'agente', l: 'Agente' }, { l: 'Bruto', n: 1, f: l => A.clp(l.bruto) }, { l: 'Retención', n: 1, f: l => A.clp(l.retencion) }, { l: 'Neto', n: 1, f: l => A.clp(l.neto) }, { l: 'Estado', f: l => A.estado(l.estado) },
      { l: '', f: l => A.btn('Detalle', 'liqa_ver', l.id, '') + (l.estado === 'borrador' && A.can('liquidaciones.aprobar') ? A.btn('Aprobar', 'liqa_accion', [l.id, 'aprobar']) : '') + (l.estado === 'aprobada' && A.can('liquidaciones.pagar') ? A.btn('Marcar pagada', 'liqa_accion', [l.id, 'pagar'], 'sm pri') : '') }], rows)}</div>`;
  }
  const rows = await A.get('/liquidaciones-propietario');
  return `<div class="row"><h2>Liquidaciones</h2><span class="right"></span>${A.can('liquidaciones.crear') ? A.btn('Generar liquidaciones del período', 'liqp_generar', null, 'pri') : ''}</div>${tabs}
  <div class="card">${A.tabla([{ k: 'periodo', l: 'Período' }, { k: 'propiedad', l: 'Propiedad' }, { k: 'propietario', l: 'Propietario' }, { l: 'Ingresos', n: 1, f: l => A.clp(l.ingresos) }, { l: 'Honorario + IVA', n: 1, f: l => A.clp(l.honorario_neto + l.honorario_iva) }, { l: 'Gastos', n: 1, f: l => A.clp(l.gastos) },
    { l: 'Neto a pagar', n: 1, f: l => `<b class="${l.neto_a_pagar < 0 ? 'bd' : ''}">${A.clp(l.neto_a_pagar)}</b>` }, { l: 'Estado', f: l => A.estado(l.estado) },
    { l: '', f: l => A.btn('Detalle', 'liqp_ver', l.id, '') + (['borrador', 'revisada'].includes(l.estado) && A.can('liquidaciones.editar') ? A.btn('Revisar', 'liqp_accion', [l.id, 'revisar']) : '') + (['borrador', 'revisada'].includes(l.estado) && A.can('liquidaciones.aprobar') ? A.btn('Aprobar', 'liqp_accion', [l.id, 'aprobar']) : '') + (l.estado === 'aprobada' && A.can('liquidaciones.pagar') ? A.btn('Marcar pagada', 'liqp_accion', [l.id, 'pagar'], 'sm pri') : '') }], rows)}</div>
  <p class="mut">La liquidación incluye solo pagos conciliados y gastos del propietario con respaldo. Al aprobar, el honorario pasa a fondos propios y el resto queda por pagar desde fondos de terceros.</p>`;
};
A.acts.liqp_generar = () => A.form({ title: 'Generar liquidaciones', fields: [{ n: 'periodo', l: 'Período (YYYY-MM)', v: A.hoy().slice(0, 7), req: true }], onSubmit: async d => { const r = await A.post('/liquidaciones-propietario/generar', d); A.toast(`${r.length} liquidación(es) generada(s)`); } });
A.acts.liqp_accion = ([id, a]) => A.run(() => A.post(`/liquidaciones-propietario/${id}/${a}`), 'Listo');
A.acts.liqp_ver = async id => { const l = await A.get('/liquidaciones-propietario/' + id);
  A.modal(`<h2>Liquidación ${E(l.periodo)} · ${E(l.propiedad)}</h2><p class="mut">${E(l.propietario)} · ${A.estado(l.estado)}</p>${A.tabla([{ k: 'tipo', l: 'Tipo' }, { k: 'descripcion', l: 'Detalle' }, { l: 'Monto', n: 1, f: d => `<span class="${d.monto < 0 ? 'bd' : ''}">${A.clp(d.monto)}</span>` }], l.detalle)}
  <p class="big n" style="text-align:right">Neto a pagar: ${A.clp(l.neto_a_pagar)}</p><div class="row" style="justify-content:flex-end">${A.btn('Documento imprimible', 'liq_doc', l.id, '')}<button data-close>Cerrar</button></div>`, true); };
A.acts.liq_doc = id => A.run(async () => { const r = await A.post('/documentos/generar', { plantilla_tipo: 'liquidacion_propietario', entidad: 'liquidacion', entidad_id: id }); A.acts.doc_ver(r.id); }, null, false);
A.acts.liqa_generar = () => A.form({ title: 'Generar liquidaciones de agentes', intro: 'Incluye las comisiones aprobadas aún no liquidadas.', fields: [{ n: 'periodo', l: 'Período (YYYY-MM)', v: A.hoy().slice(0, 7), req: true }], onSubmit: async d => { const r = await A.post('/liquidaciones-agente/generar', d); A.toast(`${r.length} liquidación(es) generada(s)`); } });
A.acts.liqa_accion = ([id, a]) => A.run(() => A.post(`/liquidaciones-agente/${id}/${a}`), 'Listo');
A.acts.liqa_ver = async id => { const l = await A.get('/liquidaciones-agente/' + id);
  A.modal(`<h2>Liquidación de ${E(l.agente)} · ${E(l.periodo)}</h2>${A.tabla([{ k: 'glosa', l: 'Detalle' }, { l: 'Monto', n: 1, f: d => A.clp(d.monto) }], l.detalle)}<p class="n" style="text-align:right">Bruto ${A.clp(l.bruto)} − retención ${A.clp(l.retencion)} = <b>${A.clp(l.neto)}</b></p><div class="row" style="justify-content:flex-end"><button data-close>Cerrar</button></div>`); };

// ---------------- CONTRATOS Y COBRANZA ----------------
V.contratos = async (r) => {
  if (r.args[0]) return V.ficha_contrato(r.args[0]);
  const rows = await A.get('/contratos');
  return `<h2>Contratos de arriendo</h2><div class="card">${A.tabla([{ k: 'propiedad', l: 'Propiedad' }, { k: 'arrendatario', l: 'Arrendatario' }, { l: 'Vigencia', f: k => `${A.fecha(k.fecha_inicio)} → ${A.fecha(k.fecha_termino)}` }, { l: 'Canon', n: 1, f: k => A.money(k.canon_vigente, k.canon_moneda) },
    { l: 'Próx. reajuste', f: k => A.fecha(k.proximo_reajuste) }, { l: 'Saldo', n: 1, f: k => A.clp(k.saldo_pendiente) }, { l: 'Estado', f: k => A.estado(k.estado) }], rows, { click: k => 'contratos/' + k.id })}</div>`;
};
V.ficha_contrato = async id => {
  const d = await A.get('/contratos/' + id);
  const k = d.contrato;
  const activo = ['firmado', 'vigente'].includes(k.estado);
  return `<div class="row"><a href="#/contratos">← Contratos</a></div><div class="row"><h2>${E(k.propiedad_codigo)} · ${E(k.arrendatario)}</h2>${A.estado(k.estado)}<span class="right"></span>
    ${A.can('documentos.crear') ? A.btn('Documento del contrato', 'doc_generar', { plantilla_tipo: 'contrato_arriendo', entidad: 'contrato', entidad_id: id }, '') : ''}</div>
  <div class="grid g4">${A.kpi('Canon vigente', A.money(k.canon_vigente, k.canon_moneda))}${A.kpi('Saldo pendiente', `<span class="${d.saldo_vencido ? 'bd' : ''}">${A.clp(d.saldo_pendiente)}</span>`, `Vencido ${A.clp(d.saldo_vencido)}`)}${A.kpi('Garantía', A.clp(k.garantia_monto), A.estado(k.garantia_estado))}${A.kpi('Próximo reajuste', A.fecha(k.proximo_reajuste) || '—', k.reajuste_tipo)}</div>
  <div class="row" style="margin-bottom:12px">${activo && A.can('pagos.crear') ? A.btn('Registrar pago', 'pago_nuevo', k, 'pri') : ''}${activo && A.can('cargos.crear') ? A.btn('Generar cargos del mes', 'cargos_generar', k.id, '') + A.btn('Cargo manual', 'cargo_nuevo', k.id, '') : ''}
    ${k.garantia_estado === 'pendiente' && k.garantia_monto > 0 && A.can('contratos.editar') ? A.btn('Registrar recepción de garantía', 'garantia_recibir', k.id, '') : ''}${activo && A.can('contratos.editar') && k.reajuste_tipo !== 'ninguno' ? A.btn('Reajuste', 'reajuste_ver', k.id, '') : ''}${activo && A.can('ot.crear') ? A.btn('+ Orden de trabajo', 'ot_nueva', { propiedad_id: k.propiedad_id }, '') : ''}</div>
  <div class="card"><h3 style="margin-top:0">Estado de cuenta</h3>${A.tabla([{ k: 'periodo', l: 'Período' }, { k: 'tipo', l: 'Tipo' }, { k: 'descripcion', l: 'Detalle' }, { l: 'Vence', f: c => A.fecha(c.vencimiento) }, { l: 'Monto', n: 1, f: c => A.clp(c.monto_clp) }, { l: 'Saldo', n: 1, f: c => A.clp(c.saldo_clp) }, { l: 'Estado', f: c => A.estado(c.estado) },
    { l: '', f: c => c.estado !== 'pagado' && c.saldo_clp === c.monto_clp && A.can('cargos.editar') ? A.btn('Anular', 'cargo_anular', c.id, 'sm bad') : '' }], d.cargos)}</div>
  <div class="grid g2"><div class="card"><h3 style="margin-top:0">Pagos</h3>${A.tabla([{ l: 'Fecha', f: p => A.fecha(p.fecha) }, { l: 'Monto', n: 1, f: p => A.clp(p.monto) }, { k: 'referencia', l: 'Ref.' }, { l: 'Sin asignar', n: 1, f: p => p.sin_asignar ? A.clp(p.sin_asignar) : '' }, { l: '', f: p => A.can('pagos.editar') ? A.btn('Revertir', 'pago_revertir', p.id, 'sm bad') : '' }], d.pagos, { vacio: 'Sin pagos' })}</div>
  <div class="card"><h3 style="margin-top:0">Reajustes y mantenciones</h3>${A.tabla([{ l: 'Fecha', f: x => A.fecha(x.fecha_aplicacion) }, { l: 'Canon', f: x => `${A.clp(x.canon_anterior)} → ${A.clp(x.canon_nuevo)}` }, { k: 'detalle', l: 'Detalle' }], d.reajustes, { vacio: 'Sin reajustes aplicados' })}
  ${A.tabla([{ k: 'codigo', l: 'OT' }, { k: 'descripcion', l: 'Trabajo' }, { l: 'Estado', f: o => A.estado(o.estado) }, { l: 'Costo', n: 1, f: o => A.clp(o.costo_real ?? o.costo_estimado) }], d.ordenes_trabajo, { vacio: 'Sin órdenes de trabajo' })}</div></div>`;
};
A.acts.cargos_generar = id => A.form({ title: 'Generar cargos', intro: 'Es idempotente: no duplica cargos ya generados.', fields: [{ n: 'periodo', l: 'Período', v: A.hoy().slice(0, 7), req: true }], onSubmit: async d => { const r = await A.post('/cargos/generar', { ...d, contrato_id: id }); A.toast(`${r.cargos_creados} cargo(s) creado(s)`); } });
A.acts.cargo_nuevo = id => A.form({ title: 'Cargo manual', fields: [{ n: 'tipo', l: 'Tipo', t: 'select', req: true, opts: [['multa', 'Multa'], ['servicio_basico', 'Servicio básico'], ['reparacion', 'Reparación'], ['otro', 'Otro'], ['gasto_comun', 'Gasto común'], ['ajuste', 'Ajuste']] }, { n: 'descripcion', l: 'Descripción', req: true }, { n: 'monto', l: 'Monto', t: 'number', req: true }, { n: 'vencimiento', l: 'Vencimiento', t: 'date', v: A.hoy() }], onSubmit: d => A.post('/cargos', { ...d, contrato_id: id }) });
A.acts.cargo_anular = id => A.prompt('Anular cargo', 'Motivo', m => A.run(() => A.post(`/cargos/${id}/anular`, { motivo: m }), 'Cargo anulado'));
A.acts.pago_nuevo = async k => { const mp = await A.catalogo('medio_pago');
  A.form({ title: 'Registrar pago', intro: 'Se aplica a los cargos pendientes (primero mora y multas, luego los más antiguos).', fields: [{ n: 'monto', l: 'Monto recibido', t: 'number', req: true }, { n: 'fecha', l: 'Fecha', t: 'date', v: A.hoy(), req: true }, { n: 'medio_pago_id', l: 'Medio de pago', t: 'select', opts: A.opts(mp) }, { n: 'referencia', l: 'Referencia / N° operación' }],
    onSubmit: async d => { const r = await A.post('/pagos', { ...d, contrato_id: k.id }); A.toast(`Pago aplicado a ${r.aplicaciones.length} cargo(s)` + (r.sin_asignar ? `; saldo a favor ${A.clp(r.sin_asignar)}` : '')); } }); };
A.acts.pago_revertir = id => A.prompt('Revertir pago', 'Motivo', m => A.run(() => A.post(`/pagos/${id}/revertir`, { motivo: m }), 'Pago revertido'));
A.acts.garantia_recibir = id => A.run(() => A.post(`/contratos/${id}/garantia`), 'Garantía registrada (fondos de terceros)');
A.acts.reajuste_ver = async id => { try { const p = await A.get(`/contratos/${id}/reajuste`);
  A.modal(`<h2>Reajuste propuesto</h2><table>${[['Fecha de aplicación', A.fecha(p.fecha_aplicacion)], ['Canon actual', A.clp(p.canon_anterior)], ['Variación', p.variacion_pct + '%'], ['Canon nuevo', `<b>${A.clp(p.canon_nuevo)}</b>`], ['Cálculo', E(p.detalle)]].map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button data-close>Cerrar</button><button class="pri" id="rjok">Aplicar reajuste</button></div>`); $q('#rjok').onclick = () => { A.closeModal(); A.run(() => A.post(`/contratos/${id}/reajuste`), 'Reajuste aplicado'); };
  } catch (x) { A.toast(x.message, true); } };

V.cobranza = async () => {
  const [mor, ec] = await Promise.all([A.get('/reportes/morosidad'), A.get('/contratos?estado=vigente')]);
  return `<div class="row"><h2>Cobranza y morosidad</h2><span class="right"></span>${A.can('cargos.crear') ? A.btn('Generar cargos del mes', 'cargos_todos', null, '') : ''}${A.can('cargos.editar') ? A.btn('Calcular mora e intereses', 'mora_calcular', null, 'pri') : ''}</div>
  <div class="card"><h3 style="margin-top:0">Antigüedad de saldos</h3>${A.tabla([{ k: 'arrendatario', l: 'Arrendatario' }, { k: 'propiedad', l: 'Propiedad' }, { l: 'Por vencer', n: 1, f: r => A.clp(r.por_vencer) }, { l: '1-30', n: 1, f: r => A.clp(r.d1_30) }, { l: '31-60', n: 1, f: r => A.clp(r.d31_60) },
    { l: '61-90', n: 1, f: r => A.clp(r.d61_90) }, { l: '+90', n: 1, f: r => A.clp(r.d90_mas) }, { l: 'Total', n: 1, f: r => `<b>${A.clp(r.total)}</b>` }], mor, { click: r => 'contratos/' + r.contrato_id, vacio: 'Sin saldos pendientes' })}</div>`;
};
A.acts.cargos_todos = () => A.form({ title: 'Generar cargos de todos los contratos', fields: [{ n: 'periodo', l: 'Período', v: A.hoy().slice(0, 7), req: true }], onSubmit: async d => { const r = await A.post('/cargos/generar', d); A.toast(`${r.cargos_creados} cargo(s) creado(s) en ${r.contratos} contrato(s)`); } });
A.acts.mora_calcular = () => A.run(async () => { const r = await A.post('/cobranza/calcular-mora', {}); A.toast(`${r.cargos_vencidos} cargo(s) vencido(s), ${r.intereses_calculados} interés(es) calculado(s)`); });

// ---------------- ORDENES DE TRABAJO ----------------
V.ot = async () => {
  const rows = await A.get('/ordenes-trabajo');
  return `<div class="row"><h2>Órdenes de trabajo</h2><span class="right"></span>${A.can('ot.crear') ? A.btn('+ Nueva OT', 'ot_nueva', {}, 'pri') : ''}</div>
  <div class="card">${A.tabla([{ k: 'codigo', l: 'OT' }, { k: 'propiedad', l: 'Propiedad' }, { k: 'descripcion', l: 'Trabajo' }, { k: 'prioridad', l: 'Prioridad' }, { l: 'Estado', f: o => A.estado(o.estado) }, { l: 'Estimado', n: 1, f: o => A.clp(o.costo_estimado) }, { l: 'Real', n: 1, f: o => A.clp(o.costo_real) }, { k: 'cargo_a', l: 'Cargo a' },
    { l: '', f: o => !A.can('ot.editar') ? '' : (['solicitada', 'pendiente_aprobacion'].includes(o.estado) && A.can('ot.aprobar') ? A.btn('Aprobar', 'ot_accion', [o.id, 'aprobar']) : '') + (['solicitada', 'aprobada'].includes(o.estado) ? A.btn('Iniciar', 'ot_accion', [o.id, 'iniciar']) : '') + (o.estado === 'en_ejecucion' ? A.btn('Terminar', 'ot_terminar', o, 'sm pri') : '') + (!['terminada', 'rechazada', 'cancelada'].includes(o.estado) ? A.btn('Rechazar', 'ot_accion', [o.id, 'rechazar'], 'sm bad') : '') }], rows)}</div>
  <p class="mut">Las mantenciones sobre el umbral configurado requieren aprobación antes de ejecutarse. Al terminar, el costo real queda en el libro y en la liquidación del propietario.</p>`;
};
A.acts.ot_nueva = async (pre = {}) => { const [props, prov] = await Promise.all([A.get('/propiedades'), A.get('/personas?rol=proveedor')]);
  A.form({ title: 'Nueva orden de trabajo', fields: [{ n: 'propiedad_id', l: 'Propiedad', t: 'select', req: true, v: pre.propiedad_id, opts: props.map(p => [p.id, `${p.codigo} ${p.direccion}`]) }, { n: 'descripcion', l: 'Descripción del trabajo', t: 'textarea', req: true },
    { n: 'prioridad', l: 'Prioridad', t: 'select', v: 'media', req: true, opts: [['baja', 'Baja'], ['media', 'Media'], ['alta', 'Alta'], ['urgente', 'Urgente']] }, { n: 'costo_estimado', l: 'Costo estimado', t: 'number' },
    { n: 'cargo_a', l: 'Costo a cargo de', t: 'select', v: 'propietario', req: true, opts: [['propietario', 'Propietario'], ['arrendatario', 'Arrendatario (cargo en su cuenta)'], ['corredora', 'Corredora']] }, { n: 'proveedor_id', l: 'Proveedor', t: 'select', opts: prov.map(p => [p.id, p.nombre]) }], onSubmit: d => A.post('/ordenes-trabajo', d) }); };
A.acts.ot_accion = ([id, a]) => A.run(() => A.post(`/ordenes-trabajo/${id}/${a}`), 'Listo');
A.acts.ot_terminar = o => A.form({ title: 'Terminar OT ' + o.codigo, fields: [{ n: 'costo_real', l: 'Costo real (total pagado)', t: 'number', req: true, v: o.costo_estimado }, { n: 'nro_documento', l: 'N° factura / boleta (respaldo)' }, { n: 'cargo_a', l: 'Cargo a', t: 'select', v: o.cargo_a, opts: [['propietario', 'Propietario'], ['arrendatario', 'Arrendatario'], ['corredora', 'Corredora']] }], onSubmit: d => A.post(`/ordenes-trabajo/${o.id}/terminar`, d) });

// ---------------- DOCUMENTOS ----------------
V.documentos = async () => {
  const rows = await A.get('/documentos');
  return `<h2>Documentos</h2><div class="card">${A.tabla([{ l: 'Fecha', f: d => A.fecha(d.created_at) }, { k: 'titulo', l: 'Documento' }, { k: 'tipo', l: 'Tipo' }, { l: 'Estado', f: d => A.estado(d.estado) }, { l: 'Firmado', f: d => A.fecha(d.firmado_at) },
    { l: '', f: d => A.btn('Ver / imprimir', 'doc_ver', d.id, '') + (d.estado !== 'firmado' && A.can('documentos.editar') ? A.btn('Registrar firma', 'doc_firmar', d.id) : '') }], rows, { vacio: 'Genere documentos desde mandatos, contratos y liquidaciones' })}</div>
  <p class="mut">Los documentos se generan desde plantillas. Las plantillas incluidas son borradores de apoyo y deben ser revisadas por un abogado antes de su uso. Un documento firmado no puede modificarse.</p>`;
};
A.acts.doc_firmar = id => A.form({ title: 'Registrar firma', intro: 'Registro manual de la firma (la integración con firma electrónica es una fase posterior).', fields: [{ n: 'nombre', l: 'Firmante', req: true }, { n: 'rut', l: 'RUT' }, { n: 'rol', l: 'Rol' }], onSubmit: d => A.post(`/documentos/${id}/firmar`, { firmantes: [d] }) });

// ---------------- REPORTES ----------------
const REPORTES = [['dashboard', 'Resumen'], ['resultado-operaciones', 'Resultado por operación'], ['rentabilidad', 'Rentabilidad por agente'], ['comisiones', 'Comisiones'], ['morosidad', 'Morosidad'], ['cartera', 'Cartera administrada'], ['flujo-caja', 'Flujo de caja proyectado'],
  ['control-movimientos', 'Control de movimientos'], ['libro-iva', 'Libro IVA'], ['publicaciones', 'Publicaciones por canal'], ['leads-embudo', 'Leads por fuente']];
V.reportes = async () => {
  const sel = A.state.rep || 'resultado-operaciones';
  const r = await A.get(`/reportes/${sel}`);
  const rows = Array.isArray(r) ? r : [];
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const esMonto = k => /ingresos|costos|comisiones|utilidad|total|saldo|neto|monto|iva|canon|cobros|pagos|d1_|d31|d61|d90|por_vencer|costo/.test(k) && !/pct|codigo|leads|n$/.test(k);
  return `<div class="row"><h2>Reportes</h2><span class="right"></span><select id="rsel" style="width:auto">${REPORTES.filter(x => x[0] !== 'dashboard').map(([k, l]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${l}</option>`).join('')}</select><a class="btn" href="#" data-act="rep_csv">Descargar CSV</a></div>
  <div class="card">${A.tabla(cols.map(k => ({ l: k.replace(/_/g, ' '), n: rows.some(x => typeof x[k] === 'number'), f: x => typeof x[k] === 'number' ? (esMonto(k) ? A.clp(x[k]) : A.num(x[k], 1)) : E(x[k] ?? '') })), rows, { vacio: 'Sin datos para este reporte' })}</div>`;
};
document.addEventListener('change', ev => { if (ev.target.id === 'rsel') { A.state.rep = ev.target.value; A.refresh(); } });
A.acts.rep_csv = async () => { const r = await fetch(`/api/reportes/${A.state.rep || 'resultado-operaciones'}?formato=csv`, { headers: { Authorization: 'Bearer ' + A.token } }); const b = await r.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = (A.state.rep || 'reporte') + '.csv'; a.click(); };
