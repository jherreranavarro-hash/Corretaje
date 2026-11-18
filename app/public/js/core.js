// Nucleo de la interfaz: API, utilidades, modales, formularios, tablas y enrutador.
const A = { vistas: {}, menu: [], user: null, cache: {} };
const $q = (s, r = document) => r.querySelector(s);

A.esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const e = A.esc;
A.clp = n => (n === null || n === undefined || n === '') ? '' : (Number(n) < 0 ? '-' : '') + '$' + Math.abs(Math.round(Number(n))).toLocaleString('es-CL');
A.num = (n, d = 0) => (n === null || n === undefined) ? '' : Number(n).toLocaleString('es-CL', { maximumFractionDigits: d });
A.money = (n, m) => m === 'UF' ? A.num(n, 2) + ' UF' : m === 'USD' ? 'US$' + A.num(n, 2) : A.clp(n);
A.fecha = f => f ? String(f).slice(0, 10).split('-').reverse().join('-') : '';
A.hoy = () => new Date().toISOString().slice(0, 10);
A.chip = (t, kind) => `<span class="chip ${kind || ''}">${e(t)}</span>`;
const ESTADO_KIND = { publicada: 'ok', vigente: 'ok', pagado: 'ok', pagada: 'ok', aprobada: 'ok', cerrada: 'ok', ganado: 'ok', conciliado: 'ok', firmado: 'ok', terminada: 'ok', realizada: 'ok',
  vencido: 'bd', caida: 'bd', perdido: 'bd', rechazada: 'bd', anulado: 'bd', anulada: 'bd', error: 'bd', cancelada: 'bd', pendiente_aprobacion: 'warn', pendiente: 'warn', provisionado: 'warn', devengada: 'warn', borrador: 'warn', parcial: 'warn', reservada: 'warn' };
A.estado = s => A.chip(String(s || '').replace(/_/g, ' '), ESTADO_KIND[s]);

A.api = async (method, path, body) => {
  const r = await fetch('/api' + path, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(A.token ? { Authorization: 'Bearer ' + A.token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (r.status === 204) return null;
  const txt = await r.text(); let j; try { j = JSON.parse(txt); } catch { j = txt; }
  if (!r.ok) { if (r.status === 401 && A.user) { A.logout(); } throw new Error((j && j.error) || 'Error ' + r.status); }
  return j;
};
A.get = (p) => A.api('GET', p); A.post = (p, b) => A.api('POST', p, b || {}); A.patch = (p, b) => A.api('PATCH', p, b); A.put = (p, b) => A.api('PUT', p, b); A.del = (p) => A.api('DELETE', p);
A.qs = o => { const q = Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&'); return q ? '?' + q : ''; };
A.can = p => { const u = A.user; if (!u) return false; const [m, a] = p.split('.'); return u.permisos.includes('*') || u.permisos.includes(p) || u.permisos.includes(m + '.*') || (a === 'ver' && u.permisos.includes('*.ver')); };

A.toast = (msg, err) => { const t = document.createElement('div'); t.className = 't' + (err ? ' err' : ''); t.textContent = msg; $q('#toast').appendChild(t); setTimeout(() => t.remove(), err ? 7000 : 3500); };
// Ejecuta una accion mostrando errores; refresca la vista si ok
A.run = async (fn, okMsg, refresh = true) => { try { const r = await fn(); if (okMsg) A.toast(okMsg); if (refresh) A.refresh(); return r; } catch (x) { A.toast(x.message, true); } };

A.modal = (html, wide) => { const m = $q('#modal'); $q('#modalbox').innerHTML = html; m.classList.toggle('wide', !!wide); m.classList.add('on'); };
A.closeModal = () => $q('#modal').classList.remove('on');
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') A.closeModal(); });
document.addEventListener('mousedown', ev => { if (ev.target.id === 'modal') A.closeModal(); });

// Campos: {n,l,t:'text|number|date|datetime-local|select|textarea|checkbox|password', opts:[[v,label]], req, v, help, step}
A.field = f => {
  const v = f.v ?? '';
  const id = `f_${f.n}`;
  let ctl;
  if (f.t === 'select') ctl = `<select id="${id}" name="${f.n}" ${f.req ? 'required' : ''}>${f.req ? '' : '<option value=""></option>'}${(f.opts || []).map(([k, l]) => `<option value="${e(k)}" ${String(k) === String(v) ? 'selected' : ''}>${e(l)}</option>`).join('')}</select>`;
  else if (f.t === 'textarea') ctl = `<textarea id="${id}" name="${f.n}" rows="3" ${f.req ? 'required' : ''}>${e(v)}</textarea>`;
  else if (f.t === 'checkbox') return `<label style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input type="checkbox" name="${f.n}" ${v ? 'checked' : ''}> ${e(f.l)}</label>`;
  else ctl = `<input id="${id}" name="${f.n}" type="${f.t || 'text'}" value="${e(v)}" ${f.req ? 'required' : ''} ${f.step ? `step="${f.step}"` : f.t === 'number' ? 'step="any"' : ''} ${f.t === 'password' ? 'autocomplete="new-password"' : ''}>`;
  return `<div><label for="${id}">${e(f.l)}${f.req ? ' *' : ''}</label>${ctl}${f.help ? `<div class="mut" style="font-size:12px">${e(f.help)}</div>` : ''}</div>`;
};
A.formData = form => {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.value === '') continue;
    else o[el.name] = el.type === 'number' ? Number(el.value) : el.value;
  }
  return o;
};
// Modal con formulario. onSubmit(datos) puede lanzar error (se muestra y no se cierra).
A.form = ({ title, fields, onSubmit, submit = 'Guardar', intro = '', wide }) => {
  A.modal(`<h2>${e(title)}</h2>${intro ? `<p class="mut">${intro}</p>` : ''}<form id="mf"><div class="grid g2">${fields.map(A.field).join('')}</div>
    <div class="row" style="margin-top:14px;justify-content:flex-end"><button type="button" data-close>Cancelar</button><button class="pri" type="submit">${e(submit)}</button></div></form>`, wide);
  $q('#mf').onsubmit = async ev => {
    ev.preventDefault();
    const b = $q('#mf button.pri'); b.disabled = true;
    try { await onSubmit(A.formData(ev.target)); A.closeModal(); A.refresh(); } catch (x) { A.toast(x.message, true); b.disabled = false; }
  };
};
A.confirm = (msg, fn, label = 'Confirmar') => {
  A.modal(`<h2>${e(msg)}</h2><div class="row" style="justify-content:flex-end;margin-top:14px"><button data-close>Cancelar</button><button class="pri" id="cf">${e(label)}</button></div>`);
  $q('#cf').onclick = async () => { A.closeModal(); await fn(); };
};
A.prompt = (titulo, campo, fn, label = 'Aceptar') => A.form({ title: titulo, fields: [{ n: 'v', l: campo, req: true, t: 'textarea' }], submit: label, onSubmit: d => fn(d.v) });

// tabla: cols [{k, l, n?, f?:(row)=>htmlSeguro}]
A.tabla = (cols, rows, { click, vacio = 'Sin registros' } = {}) => !rows.length ? `<p class="mut">${vacio}</p>` :
  `<div class="scroll"><table><thead><tr>${cols.map(c => `<th class="${c.n ? 'n' : ''}">${e(c.l)}</th>`).join('')}</tr></thead><tbody>${rows.map((r, i) =>
    `<tr ${click ? `class="click" data-click="${e(click(r))}"` : ''}>${cols.map(c => `<td class="${c.n ? 'n' : ''}">${c.f ? c.f(r, i) : e(r[c.k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
A.kpi = (l, v, sub) => `<div class="card kpi"><div class="v">${v}</div><div class="l">${e(l)}</div>${sub ? `<div class="mut" style="font-size:12px">${sub}</div>` : ''}</div>`;
A.tabs = (items, actual, base) => `<div class="tabs">${items.map(([k, l]) => `<a class="${k === actual ? 'on' : ''}" data-tab="${k}">${e(l)}</a>`).join('')}</div>`;
A.opts = (arr, v = 'id', l = 'nombre') => arr.map(x => [x[v], x[l]]);
A.catalogo = async g => (A.cache['cat_' + g] ||= await A.get('/catalogos/' + g));
A.conceptos = async () => (A.cache.conceptos ||= await A.get('/conceptos'));
A.agentes = async () => (A.cache.agentes ||= await A.get('/agentes'));
A.invalidar = () => { A.cache = {}; };

// Enrutador por hash: #/ruta/param?query
A.route = () => { const h = location.hash.slice(2) || 'dashboard'; const [path, query] = h.split('?'); const [name, ...args] = path.split('/'); return { name, args, query: Object.fromEntries(new URLSearchParams(query || '')) }; };
A.go = h => { location.hash = '#/' + h; };
A.refresh = async () => {
  const r = A.route(); const v = A.vistas[r.name];
  const main = $q('#view'); if (!main) return;
  document.querySelectorAll('#side a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#/' + r.name));
  if (!v) { main.innerHTML = '<h2>No encontrado</h2>'; return; }
  const scroll = window.scrollY;
  try { main.innerHTML = await v(r); window.scrollTo(0, scroll); } catch (x) { main.innerHTML = `<div class="card bd">${e(x.message)}</div>`; }
};
window.addEventListener('hashchange', () => { A.closeModal(); A.refresh(); $q('#side') && $q('#side').classList.remove('on'); });

// Delegacion de eventos: [data-close], [data-click=ruta], [data-act=nombre] con data-args
A.acts = {};
document.addEventListener('click', async ev => {
  const t = ev.target.closest('[data-close],[data-click],[data-act],[data-tab]');
  if (!t) return;
  if (t.hasAttribute('data-close')) return A.closeModal();
  if (t.dataset.tab) { A.state.tab = t.dataset.tab; return A.refresh(); }
  if (t.dataset.act) { ev.stopPropagation(); const fn = A.acts[t.dataset.act]; if (fn) { try { await fn(JSON.parse(t.dataset.args || 'null'), t); } catch (x) { A.toast(x.message, true); } } return; }
  if (t.dataset.click && !ev.target.closest('button,a,input,select')) A.go(t.dataset.click);
});
A.state = { tab: null };
// helper para botones: act('nombre', args)
A.btn = (label, act, args, cls = 'sm', extra = '') => `<button class="${cls}" data-act="${act}" data-args='${e(JSON.stringify(args ?? null))}' ${extra}>${e(label)}</button>`;

A.logout = () => { sessionStorage.clear(); A.token = null; A.user = null; A.invalidar(); A.renderLogin(); };
