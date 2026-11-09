'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');

const TRAZOS = {
  casa: '<path d="M3 11l9-8 9 8"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  caja: '<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M3 7l9 5 9-5M12 12v10"/>',
  hoja: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>',
  lista: '<rect x="5" y="4" width="14" height="18" rx="2"/><path d="M9 2h6v4H9zM9 11h6M9 16h6"/>',
  barras: '<path d="M5 21v-7M12 21V4M19 21v-11"/>',
  persona: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-5 4-7 8-7s7 2 8 7"/>',
  campana: '<path d="M6 16V10a6 6 0 0 1 12 0v6l2 2H4z"/><path d="M10 21h4"/>',
  alerta: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.01"/>',
  ok: '<path d="M4 12l5 5L20 6"/>',
  okc: '<circle cx="12" cy="12" r="10"/><path d="M7.5 12l3 3 6-6"/>',
  chev: '<path d="M9 5l7 7-7 7"/>',
  atras: '<path d="M15 5l-7 7 7 7"/>',
  mas: '<path d="M12 5v14M5 12h14"/>',
  camion: '<path d="M2 6h12v11H2zM14 10h4l4 4v3h-8z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
  reloj: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  coment: '<path d="M21 12a8 8 0 0 1-12 7l-5 1 1-5a8 8 0 1 1 16-3z"/>',
  guardar: '<path d="M5 3h11l5 5v13H3V3z"/><path d="M7 3v6h8V3M7 21v-7h10v7"/>',
  codigo: '<path d="M4 6v12M8 6v12M11 6v12M15 6v12M20 6v12"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  tel: '<path d="M5 3h4l2 5-3 2a12 12 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
  correo: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  escudo: '<path d="M12 2l8 3v7c0 5-4 8-8 10-4-2-8-5-8-10V5z"/><path d="M9 12l2 2 4-4"/>',
  lapiz: '<path d="M4 20l1-5L16 4l4 4L9 19z"/>',
  fridge: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M6 10h12M9 6v1M9 13v3"/>',
  jar: '<rect x="8" y="2" width="8" height="3" rx="1"/><rect x="6" y="5" width="12" height="17" rx="2"/><path d="M6 11h12"/>',
  bottle: '<path d="M10 2h4v5l2 3v12H8V10l2-3z"/><path d="M8 14h8"/>',
  spray: '<path d="M8 8h6l2 4v10H6V12z"/><path d="M9 8V4h5l3 2M14 4l-1 4"/>',
};
const ic = n => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${TRAZOS[n] || ''}</svg>`;

let S = null;
const draft = {};
try { Object.assign(draft, JSON.parse(sessionStorage.getItem('meson.borrador') || '{}')); } catch {}
const guardarBorrador = () => { try { sessionStorage.setItem('meson.borrador', JSON.stringify(draft)); } catch {} };
const val = (k, d) => (k in draft ? draft[k] : d);
const limpiar = prefijo => { Object.keys(draft).filter(k => k.startsWith(prefijo)).forEach(k => delete draft[k]); guardarBorrador(); };
const seleccion = new Set();

const SIN_RED = 'Sin conexión con el servidor. Lo capturado no se perdió: intenta de nuevo.';

async function api(ruta, cuerpo, metodo) {
  const r = await fetch(ruta, {
    method: metodo || (cuerpo === undefined ? 'GET' : 'POST'),
    headers: { 'Content-Type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  }).catch(() => { throw new Error(SIN_RED); });
  const datos = await r.json().catch(() => ({}));
  if (r.status === 401 && ruta !== '/api/login') { S = null; login(); throw new Error('Tu sesión terminó'); }
  if (!r.ok) throw new Error(datos.error || 'No se pudo completar la operación');
  return datos;
}

function avisar(msg) {
  const a = $('#aviso');
  a.textContent = msg;
  a.classList.add('ver-aviso');
  clearTimeout(avisar.t);
  avisar.t = setTimeout(() => a.classList.remove('ver-aviso'), 3000);
}

// Formato
const dia = d => new Date(d).toDateString();
function cuando(iso) {
  if (!iso) return '';
  const d = new Date(iso), hora = d.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' });
  if (dia(d) === dia(Date.now())) return `Hoy, ${hora}`;
  if (dia(d) === dia(Date.now() - 864e5)) return `Ayer, ${hora}`;
  return `${d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}, ${hora}`;
}
const fechaCorta = f => (f ? new Date(`${f}T12:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Sin fecha');
const unidad = (n, u) => (n === 1 || u.length <= 2 ? u : `${u}s`);
const cant = (n, u) => `${+n} ${unidad(+n, u)}`;
const presDe = id => S.presentaciones.filter(p => p.insumo_id === id && p.activo);
// Ayuda visual: la existencia expresada en la presentación más grande del insumo.
const equivalente = i => { const p = presDe(i.id).at(-1); return p ? ` ≈ ${+(i.stock / p.contenido).toFixed(1)} × ${esc(p.nombre)}` : ''; };
const enPres = l => (l.factor ? ` · ${+(l.cantidad / l.factor).toFixed(2)} × ${esc(l.presentacion)} de ${+l.factor}` : '');

// Crítico por debajo de una cuarta parte del mínimo; bajo por debajo del mínimo.
const estadoDe = (stock, min) => (stock < min * 0.25 ? 'critico' : stock < min ? 'bajo' : 'ok');
const ETIQUETA = { ok: 'OK', bajo: 'Bajo', critico: 'Crítico' };
const chip = e => `<span class="chip ${e}"><i class="punto ${e}"></i>${ETIQUETA[e]}</span>`;
const chipAlerta = e => `<span class="chip ${e}">${ic('alerta')}${ETIQUETA[e]}</span>`;

const activos = () => S.insumos.filter(i => i.activo);
const insumoPor = id => S.insumos.find(i => i.id === id);
const provPor = id => S.proveedores.find(p => p.id === id);
const catPor = id => S.categorias.find(c => c.id === id);
const bajos = () => activos().filter(i => i.stock < i.min).sort((a, b) => a.stock / (a.min || 1) - b.stock / (b.min || 1));
const criticos = () => activos().filter(i => estadoDe(i.stock, i.min) === 'critico');
const abiertos = () => S.pedidos.filter(p => p.estado === 'en_proceso');
const pendientes = () => S.solicitudes.filter(s => s.estado === 'pendiente');
const esAdmin = () => S.me.rol === 'admin';

function foto(i) {
  return i.foto ? `<img class="foto" src="/img/${esc(i.foto)}" alt="">` : `<span class="foto">${ic(catPor(i.categoria_id)?.icono)}</span>`;
}

// Piezas
const stat = (n, etiqueta, icono, color, href, flecha) => `<a class="stat" href="${href}"><span class="burbuja ${color}">${ic(icono)}</span>
  <div><b>${n}</b><span>${etiqueta}</span></div>${flecha ? `<span class="flecha">${ic('chev')}</span>` : ''}</a>`;
const titulo = (t, href, enlace = 'Ver todos') => `<div class="titulo"><h2>${t}</h2>${href ? `<a class="ver" href="${href}">${enlace} ${ic('chev')}</a>` : ''}</div>`;
const hero = (h, p, extra = '') => `<section class="hero"><h1>${h}</h1>${extra}<p>${p}</p></section>`;
const EV_ICONO = { solicitud: ['hoja', ''], pedido: ['camion', 'verde'], recepcion: ['ok', 'verde'], alerta: ['alerta', 'rojo'], conteo: ['lista', ''] };

function filaEvento(e) {
  const [i, c] = EV_ICONO[e.tipo] || ['hoja', ''];
  return `<a class="fila" href="${esc(e.ref || '#/inicio')}"><span class="burbuja ${c}">${ic(i)}</span>
    <div class="txt"><b>${esc(e.titulo)}</b><small>${esc(e.detalle)}</small></div><time>${cuando(e.creado)}</time><span class="chev">${ic('chev')}</span></a>`;
}

// Pantallas
const rutas = {
  inicio() {
    const completas = S.pedidos.filter(p => p.estado !== 'en_proceso').length;
    return hero(`Hola, ${esc(S.me.nombre.split(' ')[0])}`, 'Aquí tienes un resumen de tu operación de hoy.', `<div class="rol">${esc(S.me.area)}</div>`) + `<main class="contenido">
      <div class="stats">
        ${stat(pendientes().length, 'Solicitudes por autorizar', 'hoja', '', '#/pedidos', 1)}
        ${stat(abiertos().length, 'Pedidos en proceso', 'caja', '', '#/pedidos', 1)}
        ${stat(completas, 'Recepciones completadas', 'okc', 'verde', '#/reportes', 1)}
        ${stat(bajos().length, 'Insumos en bajo mínimo', 'alerta', 'rojo', '#/pedidos', 1)}
      </div>
      <a class="btn borde tinta" href="#/pendientes">${ic('lista')} Ver pendientes de recepción, revisión, firma y envío</a>
      <section class="tarjeta">${titulo('Actividad reciente', '#/actividad', 'Ver toda')}
        ${S.eventos.slice(0, 4).map(filaEvento).join('') || '<p class="vacio">Aún no hay actividad.</p>'}</section></main>`;
  },

  actividad() {
    return `<main class="contenido sin-hero"><section class="tarjeta">${titulo('Actividad')}
      ${S.eventos.map(filaEvento).join('') || '<p class="vacio">Aún no hay actividad.</p>'}</section></main>`;
  },

  inventario() {
    const conteosHoy = S.conteos.filter(c => dia(c.creado) === dia(Date.now())).length;
    const cats = S.categorias.map(c => {
      const de = activos().filter(i => i.categoria_id === c.id);
      const pct = de.length ? Math.round(de.filter(i => i.stock >= i.min).length / de.length * 100) : 100;
      const e = pct >= 75 ? '' : pct >= 40 ? 'bajo' : 'critico';
      return `<a class="cat" href="#/insumos/${c.id}">${c.foto ? `<img src="/img/${esc(c.foto)}" alt="">` : `<span class="sinfoto">${ic(c.icono)}</span>`}
        <div class="c"><b><i class="punto ${e}"></i>${esc(c.nombre)}</b><small>${de.length} items</small>
        <div class="barra"><i><u class="${e}" style="width:${pct}%"></u></i>${pct}%</div></div></a>`;
    }).join('');
    return hero('Inventario', 'Controla existencias, alertas y recepciones en tiempo real.') + `<main class="contenido">
      <div class="stats c4">
        ${stat(activos().length, 'Insumos activos', 'caja', '', '#/insumos')}
        ${stat(bajos().length, 'Bajo mínimo', 'alerta', '', '#/pedidos')}
        ${stat(abiertos().length, 'Pedidos por recibir', 'hoja', '', '#/pedidos')}
        ${stat(conteosHoy, 'Conteos hoy', 'lista', '', '#/conteo')}
      </div>
      <div class="cats">${cats}</div>
      <a class="btn" href="#/conteo">${ic('lista')} Registrar conteo</a>
      ${esAdmin() ? `<a class="btn borde tinta" href="#/rendimientos">${ic('lapiz')} Capturar rendimientos y precios${activos().some(i => i.rendimiento === null || i.costo === null) ? ` (faltan ${activos().filter(i => i.rendimiento === null || i.costo === null).length})` : ''}</a>` : ''}
      <section class="tarjeta alerta-t">${titulo(`<span class="rojo-t">${ic('alerta')}</span> Alertas críticas`, '#/pedidos', 'Ver todas')}
        ${criticos().map(i => `<a class="fila" href="#/pedidos">${foto(i)}
          <div class="txt"><b>${esc(i.nombre)}</b><small>Stock actual: <span class="rojo-t">${cant(i.stock, i.unidad)}</span></small></div>
          <span class="chip critico">${ic('alerta')}Mínimo: ${cant(i.min, i.unidad)}</span></a>`).join('') || '<p class="vacio">Sin alertas críticas.</p>'}
      </section></main>`;
  },

  insumos(catId) {
    const cat = catPor(Number(catId));
    const filtro = String(val('buscar', '')).toLowerCase();
    const lista = S.insumos.filter(i => (!cat || i.categoria_id === cat.id) && (esAdmin() || i.activo) && i.nombre.toLowerCase().includes(filtro));
    const fila = i => `<a class="fila" href="#/insumo/${i.id}">${foto(i)}
      <div class="txt"><b>${esc(i.nombre)}${i.activo ? '' : ' (inactivo)'}</b><small>${cant(i.stock, i.unidad)}${equivalente(i)} · ${i.rendimiento === null ? 'Rendimiento sin capturar' : `Rinde ${+i.rendimiento} % · Aprovechable ${cant(i.aprovechable, i.unidad)}`}</small></div>
      ${chip(estadoDe(i.stock, i.min))}</a>`;
    return `<main class="contenido sin-hero">
      ${esAdmin() ? `<button class="btn" data-act="nuevoInsumo">${ic('mas')} Agregar insumo</button>` : ''}
      <input class="buscar" type="search" placeholder="Buscar insumo" aria-label="Buscar insumo" data-draft="buscar" data-live="buscar" value="${esc(val('buscar', ''))}">
      <section class="tarjeta">${titulo(esc(cat?.nombre || 'Todos los insumos'))}<div id="lista-insumos">
        ${lista.map(fila).join('') || '<p class="vacio">No hay insumos.</p>'}</div></section></main>`;
  },

  conteo(catId) {
    const cat = catPor(Number(catId)) || S.categorias[0];
    const items = activos().filter(i => i.categoria_id === cat.id);
    const ultimo = S.conteos.find(c => c.categoria_id === cat.id);
    return `<section class="hero">${''}<h1>Conteo</h1><p>Registra existencias por categoría y actualiza el stock del día.</p></section>
    <main class="contenido">
      <div class="pestanas">${S.categorias.map(c => `<a class="pestana ${c.id === cat.id ? 'on' : ''}" href="#/conteo/${c.id}">${ic(c.icono)}${esc(c.nombre)}</a>`).join('')}</div>
      <section class="tarjeta">
        <div class="titulo"><h2>Conteo de hoy</h2><span class="meta">${new Date().toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
        ${items.length ? `<table><thead><tr><th>Insumo</th><th>Cantidad</th><th>Mín / Máx</th><th>Estado</th></tr></thead><tbody>
          ${items.map(i => {
            const v = val(`conteo.${i.id}`, i.stock);
            return `<tr data-min="${i.min}"><td><div class="insumo-c">${foto(i)}<span>${esc(i.nombre)}<br><small class="minmax">${esc(i.unidad)}</small></span></div></td>
              <td><input class="cant" id="c-${i.id}" type="number" min="0" step="any" inputmode="decimal" aria-label="Cantidad de ${esc(i.nombre)}" data-draft="conteo.${i.id}" data-live="conteo" value="${esc(v)}"></td>
              <td class="minmax">Mín: ${+i.min}<br>Máx: ${+i.max}</td><td>${chip(estadoDe(Number(v), i.min))}</td></tr>`;
          }).join('')}</tbody></table>` : '<p class="vacio">Esta categoría no tiene insumos.</p>'}
      </section>
      ${ultimo ? `<section class="tarjeta fila" style="padding:12px 14px"><span class="burbuja">${ic('reloj')}</span><div class="txt"><b>Último conteo</b>
        <small>Registrado por ${esc(ultimo.usuario)}<br>${cuando(ultimo.creado)}</small></div></section>` : ''}
      <div class="botones">
        <button class="btn" data-act="guardarConteo" data-cat="${cat.id}" ${items.length ? '' : 'disabled'}>${ic('guardar')} Guardar conteo</button>
        <button class="btn borde tinta" data-act="escanear">${ic('codigo')} Escanear insumo</button>
      </div></main>`;
  },

  pedidos() {
    const hace30 = Date.now() - 30 * 864e5;
    const atendidas = S.solicitudes.filter(s => s.revisado && Date.parse(s.revisado) > hace30).length;
    // Lo que ya está en una solicitud pendiente o un pedido abierto no se vuelve a sugerir.
    const sugeridos = porSugerir();
    const bajoMinimo = `<section class="tarjeta">${titulo(`<span class="rojo-t">${ic('alerta')}</span> Bajo mínimo`)}
        ${bajos().length ? `<table><thead><tr><th>Insumo</th><th>Stock</th><th>Mínimo</th><th>Estado</th></tr></thead><tbody>
        ${bajos().map(i => `<tr><td><div class="insumo-c">${foto(i)}<span>${esc(i.nombre)}</span></div></td><td class="rojo-t">${cant(i.stock, i.unidad)}</td>
          <td>${cant(i.min, i.unidad)}</td><td>${chipAlerta(estadoDe(i.stock, i.min))}</td></tr>`).join('')}</tbody></table>` : '<p class="vacio">Todo por encima del mínimo.</p>'}
      </section>`;
    const sugerencia = `<section class="tarjeta">${titulo(`<span style="color:var(--naranja)">${ic('hoja')}</span> Solicitud sugerida`)}
        ${sugeridos.length ? `<table><thead><tr><th>Insumo</th><th>Cantidad</th><th>Proveedor</th><th></th></tr></thead><tbody>
        ${sugeridos.map(i => {
          const on = seleccion.has(i.id);
          return `<tr><td><b>${esc(i.nombre)}</b></td><td>${cant(sugerida(i), i.unidad)}</td><td>${esc(provPor(i.proveedor_id)?.nombre || 'Sin asignar')}</td>
            <td><button class="mas ${on ? 'on' : ''}" data-act="alternar" data-id="${i.id}" aria-pressed="${on}" aria-label="Incluir ${esc(i.nombre)}">${ic(on ? 'ok' : 'mas')}</button></td></tr>`;
        }).join('')}</tbody></table>
        <button class="btn" style="margin-top:12px" data-act="crearSolicitud">${ic('mas')} Crear solicitud${seleccion.size ? ` (${seleccion.size})` : ''}</button>`
        : '<p class="vacio">Nada por solicitar: los faltantes ya están en proceso.</p>'}
        <button class="btn borde tinta" style="margin-top:8px" data-act="pedirOtro">${ic('mas')} Pedir otro insumo</button>
      </section>`;
    const solicitudes = `<section class="tarjeta">${titulo(esAdmin() ? 'Solicitudes por revisar' : 'Solicitudes')}
        ${[...S.solicitudes].sort((a, b) => (a.estado === 'pendiente' ? 0 : 1) - (b.estado === 'pendiente' ? 0 : 1)).slice(0, 15).map(s => `<a class="fila" href="#/solicitud/${s.id}"><span class="burbuja">${ic('hoja')}</span>
          <div class="txt"><b>Solicitud #SO-${s.id}</b><small>${esc(s.solicitante)} · ${cuando(s.creado)}</small></div>${chipSolicitud(s)}</a>`).join('') || '<p class="vacio">Sin solicitudes.</p>'}
      </section>`;
    if (!esAdmin()) {
      return `<section class="hero"><h1 style="font-size:30px">Pedir insumos</h1><p>Elige lo que hace falta y envíalo a administración.</p></section>
      <main class="contenido">${sugerencia}${bajoMinimo}${solicitudes}</main>`;
    }
    const pedidos = `<section class="tarjeta">${titulo('Pedidos', '#/proveedores', 'Proveedores')}
        ${S.pedidos.slice(0, 15).map(filaPedido).join('') || '<p class="vacio">Sin pedidos.</p>'}
      </section>`;
    return `<section class="hero"><h1 style="font-size:30px">Autorizaciones</h1><p>Revisa solicitudes, asigna proveedores y da seguimiento a los pedidos.</p></section>
    <main class="contenido">
      <a class="btn" href="#/nuevo-pedido">${ic('mas')} Nuevo pedido</a>
      <div class="stats c3">
        ${stat(pendientes().length, 'Por autorizar', 'hoja', '', '#/pedidos')}
        ${stat(criticos().length, 'Críticas', 'alerta', 'rojo', '#/pedidos')}
        ${stat(atendidas, 'Atendidas (30 días)', 'okc', 'verde', '#/pedidos')}
      </div>
      ${solicitudes}${pedidos}${bajoMinimo}${sugerencia}</main>`;
  },

  solicitud(id, tab = 'resumen') {
    const s = S.solicitudes.find(x => x.id === Number(id));
    if (!s) return noEncontrado('Solicitud');
    const editable = s.estado === 'pendiente' && esAdmin();
    const k = `sol.${s.id}.`;
    const provDe = l => Number(val(`${k}p${l.insumo_id}`, l.proveedor_id ?? ''));
    const tabs = [['resumen', 'Resumen'], ['insumos', `Insumos (${s.lineas.length})`], ['proveedores', 'Proveedores'], ['historial', 'Historial']];
    let cuerpo = '';
    if (tab === 'resumen') {
      cuerpo = `<section class="tarjeta">${titulo(`<span style="color:var(--naranja)">${ic('hoja')}</span> Información general`)}
        <div class="botones"><div class="dato">${ic('persona')}<div><small>Solicitado por</small><b>${esc(s.solicitante)}</b><small>${esc(s.solicitante_area)}</small></div></div>
        <div class="dato">${ic('cal')}<div><small>Fecha de solicitud</small><b>${cuando(s.creado)}</b></div></div></div>
        ${s.comentario ? `<div class="dato">${ic('coment')}<div><small>Comentarios</small>${esc(s.comentario)}</div></div>` : ''}
        ${s.revisor ? `<div class="dato">${ic('escudo')}<div><small>Revisó</small><b>${esc(s.revisor)}</b><small>${cuando(s.revisado)}</small></div></div>` : ''}
        ${s.motivo ? `<p class="nota">Motivo de rechazo: ${esc(s.motivo)}</p>` : ''}</section>
      <section class="tarjeta">${titulo(`<span style="color:var(--naranja)">${ic('caja')}</span> Insumos y proveedores`)}
        <table><thead><tr><th>Insumo</th><th>Cantidad</th><th>Proveedor asignado</th></tr></thead><tbody>
        ${s.lineas.map(l => {
          const i = insumoPor(l.insumo_id);
          const c = val(`${k}c${l.insumo_id}`, l.cantidad);
          return `<tr><td><div class="insumo-c">${foto(i)}<span>${esc(i.nombre)}</span></div></td>
            <td>${editable ? `<input class="cant" type="number" min="0" step="any" inputmode="decimal" aria-label="Cantidad de ${esc(i.nombre)}" data-draft="${k}c${l.insumo_id}" value="${esc(c)}"> <small class="minmax">${esc(i.unidad)}</small>` : cant(l.cantidad, i.unidad)}</td>
            <td>${editable ? `<select aria-label="Proveedor de ${esc(i.nombre)}" data-draft="${k}p${l.insumo_id}"><option value="">Elegir…</option>${S.proveedores.map(p => `<option value="${p.id}" ${provDe(l) === p.id ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select>` : esc(provPor(l.proveedor_id)?.nombre || 'Sin asignar')}</td></tr>`;
        }).join('')}</tbody></table></section>
      <section class="tarjeta">${titulo(`<span style="color:var(--naranja)">${ic('cal')}</span> Fecha de entrega estimada`)}
        ${editable ? `<label class="campo" style="margin:0"><input type="date" aria-label="Fecha de entrega" data-draft="${k}fecha" value="${esc(val(`${k}fecha`, s.fecha_entrega || ''))}"></label>` : fechaCorta(s.fecha_entrega)}</section>
      ${editable ? `<div class="botones"><button class="btn borde" data-act="rechazar" data-id="${s.id}">${ic('x')} Rechazar</button>
        <button class="btn" data-act="autorizar" data-id="${s.id}">${ic('ok')} Autorizar</button></div>` : ''}
      ${s.estado === 'pendiente' && !esAdmin() ? '<p class="vacio">Administración debe autorizar esta solicitud.</p>' : ''}
      ${S.pedidos.filter(p => p.solicitud_id === s.id).map(p => `<a class="tarjeta fila" href="#/pedido/${p.id}"><span class="burbuja verde">${ic('camion')}</span><div class="txt"><b>Pedido #${p.id}</b><small>${esc(provPor(p.proveedor_id)?.nombre)}</small></div>${chipPedido(p)}</a>`).join('')}`;
    } else if (tab === 'insumos') {
      cuerpo = `<section class="tarjeta">${s.lineas.map(l => {
        const i = insumoPor(l.insumo_id);
        return `<div class="fila">${foto(i)}<div class="txt"><b>${esc(i.nombre)}</b><small>Stock actual: ${cant(i.stock, i.unidad)} · Mínimo: ${cant(i.min, i.unidad)}</small></div><span class="meta">${cant(l.cantidad, i.unidad)}</span></div>`;
      }).join('')}</section>`;
    } else if (tab === 'proveedores') {
      const ids = [...new Set(s.lineas.map(provDe).filter(Boolean))];
      cuerpo = `<section class="tarjeta">${ids.map(pid => {
        const p = provPor(pid);
        return `<div class="fila"><span class="burbuja">${ic('casa')}</span><div class="txt"><b>${esc(p.nombre)}</b>
          <small>${s.lineas.filter(l => provDe(l) === pid).map(l => esc(insumoPor(l.insumo_id).nombre)).join(', ')}</small></div>${contacto(p)}</div>`;
      }).join('') || '<p class="vacio">Sin proveedores asignados.</p>'}</section>`;
    } else {
      const ev = S.eventos.filter(e => e.ref === `#/solicitud/${s.id}`);
      cuerpo = `<section class="tarjeta">${ev.map(filaEvento).join('') || '<p class="vacio">Sin historial.</p>'}</section>`;
    }
    return `<section class="hero corto"></section><main class="contenido">
      <section class="tarjeta"><div class="encabezado"><a href="#/pedidos" aria-label="Volver" style="padding:6px 6px 6px 0">${ic('atras')}</a><h2>Solicitud #SO-${s.id}</h2>${chipSolicitud(s)}</div>
      <nav class="subtabs">${tabs.map(([t, n]) => `<a class="${t === tab ? 'on' : ''}" href="#/solicitud/${s.id}/${t}">${n}</a>`).join('')}</nav></section>
      ${cuerpo}</main>`;
  },

  pedido(id) {
    const p = S.pedidos.find(x => x.id === Number(id));
    if (!p) return noEncontrado('Pedido');
    const abierto = p.estado === 'en_proceso', prov = provPor(p.proveedor_id);
    const recs = S.recepciones.filter(r => r.pedido_id === p.id);
    const docs = S.documentos.filter(d => d.pedido_id === p.id);
    const devs = S.devoluciones.filter(d => d.pedido_id === p.id);
    const asignado = p.asignado_id && S.auxiliares.find(a => a.id === p.asignado_id);
    const total = p.lineas.every(l => l.precio !== null) ? p.lineas.reduce((s, l) => s + l.cantidad * l.precio, 0) : null;
    return `<main class="contenido sin-hero">
      <section class="tarjeta"><div class="encabezado"><a href="#/pedidos" aria-label="Volver" class="volver">${ic('atras')}</a><h2>Pedido #${p.id}</h2>${chipEntrega(p.entrega)}</div>
        <dl class="datos">
          <div><dt>Proveedor</dt><dd><a class="enlace" href="#/proveedor/${prov.id}">${esc(prov.nombre)}</a> ${contacto(prov)}</dd></div>
          <div><dt>Entrega</dt><dd>${fechaCorta(p.promesa || p.fecha_entrega)}${abierto ? ` · ${esc(AVANCE[p.avance])}` : ''}</dd></div>
          <div><dt>Asignado a</dt><dd>${asignado ? esc(asignado.nombre) : 'Sin asignar'}</dd></div>
          ${total !== null ? `<div><dt>Importe pedido</dt><dd>${dinero(total)}</dd></div>` : ''}
        </dl>
        ${p.nota ? `<p class="nota">Diferencia reportada: ${esc(p.nota)}</p>` : ''}
        ${p.nota_proveedor ? `<p class="nota" style="margin-top:8px">El proveedor avisa: ${esc(p.nota_proveedor)}</p>` : ''}
        ${abierto && puedoOperar(p) ? `<a class="btn" href="#/recepcion/${p.id}">${ic('caja')} Registrar recepción</a>` : ''}
        ${abierto && !puedoOperar(p) ? '<p class="sub">Este pedido está asignado a otra persona.</p>' : ''}
      </section>
      <section class="tarjeta">${titulo('Productos')}
        ${p.lineas.map(l => {
          const i = insumoPor(l.insumo_id), pend = pendienteDe(l);
          return `<div class="prod"><b>${esc(i.nombre)}</b> <small>(${esc(i.unidad)})${enPres(l)}${l.precio !== null ? ` · ${dinero(l.precio)} por ${esc(i.unidad)}` : ''}</small>
            ${nums([['Pedida', +l.cantidad], ['Recibida', +(l.recibido || 0)], ['Aceptada', +l.aceptado, 'verde-t'], ['Rechazada', +l.rechazado, l.rechazado ? 'rojo-t' : ''], ['Pendiente', pend, pend ? 'rojo-t' : '']])}
            ${l.devuelto ? `<p class="mini-nota">Devuelta al proveedor: ${cant(l.devuelto, i.unidad)}</p>` : ''}
            ${l.cerrado ? `<p class="mini-nota">Faltante cerrado: ${esc(l.cierre_motivo)}</p>` : ''}
            ${pend > 0 && puedoOperar(p) && recs.length ? `<button class="ver" data-act="cerrarFaltante" data-id="${p.id}" data-insumo="${i.id}">${ic('x')} Cerrar faltante con justificación</button>` : ''}</div>`;
        }).join('')}</section>
      <section class="tarjeta">${titulo(`Entregas (${recs.length})`)}
        ${recs.map(r => `<a class="fila" href="#/expediente/${r.id}"><div class="txt"><b>Folio ${esc(r.folio)}</b><small>${esc(r.usuario)} · ${cuando(r.creado)}</small></div>${chipEntrega(r.estado)}<span class="chev">${ic('chev')}</span></a>`).join('') || '<p class="vacio">Aún no se recibe nada de este pedido.</p>'}</section>
      <section class="tarjeta"><div class="titulo"><h2>Documentos (${docs.length})</h2><button class="ver" data-act="adjuntar" data-pedido="${p.id}">${ic('mas')} Adjuntar</button></div>${listaDocs(docs)}</section>
      ${devs.length ? `<section class="tarjeta">${titulo('Devoluciones de mercancía')}${devs.map(d => `<div class="fila"><div class="txt"><b>Comprobante ${esc(d.comprobante)}</b><small>${d.lineas.map(l => `${esc(l.insumo)} ${+l.cantidad} ${esc(l.unidad)}: ${esc(l.motivo)}`).join('; ')} · ${esc(d.usuario)} · ${cuando(d.creado)}</small></div></div>`).join('')}</section>` : ''}
      <div class="pila">
        ${p.lineas.some(l => l.aceptado - l.devuelto > 0) && puedoOperar(p) ? `<button class="btn borde" data-act="devolverMercancia" data-id="${p.id}">${ic('caja')} Devolver mercancía</button>` : ''}
        <button class="btn borde tinta" data-act="diferencia" data-id="${p.id}">${ic('alerta')} Reportar diferencia</button>
        ${esAdmin() ? `<button class="btn borde tinta" data-act="gestionPedido" data-id="${p.id}">${ic('lapiz')} Asignar y capturar precios</button>` : ''}
      </div></main>`;
  },

  proveedores() {
    return `<main class="contenido sin-hero">
      ${esAdmin() ? `<button class="btn" data-act="nuevoProveedor">${ic('mas')} Agregar proveedor</button>` : ''}
      <section class="tarjeta">${titulo('Proveedores')}
      ${S.proveedores.map(p => `<div class="fila"><a class="txt" href="#/proveedor/${p.id}"><b>${esc(p.nombre)}</b><small>${p.rfc ? `RFC ${esc(p.rfc)}` : 'Datos fiscales sin capturar'}</small></a>${contacto(p)}<a href="#/proveedor/${p.id}" aria-label="Abrir ficha de ${esc(p.nombre)}" class="chev" style="padding:10px 0 10px 6px">${ic('chev')}</a></div>`).join('') || '<p class="vacio">Sin proveedores.</p>'}
      </section></main>`;
  },

  reportes() {
    const conDif = S.pedidos.filter(p => p.estado === 'diferencia' || p.nota || p.lineas.some(l => l.rechazado > 0));
    return hero('Reportes', 'Cobertura de inventario, recepciones y movimientos recientes.') + `<main class="contenido">
      <div class="stats c3">
        ${stat(S.recepciones.length, 'Recepciones', 'okc', 'verde', '#/reportes')}
        ${stat(conDif.length, 'Con diferencia', 'alerta', 'rojo', '#/reportes')}
        ${stat(S.conteos.length, 'Conteos', 'lista', '', '#/conteo')}
      </div>
      <section class="tarjeta">${titulo('Cobertura por categoría')}
        ${S.categorias.map(c => {
          const de = activos().filter(i => i.categoria_id === c.id);
          const pct = de.length ? Math.round(de.filter(i => i.stock >= i.min).length / de.length * 100) : 100;
          const e = pct >= 75 ? '' : pct >= 40 ? 'bajo' : 'critico';
          return `<div class="fila"><div class="txt"><b>${esc(c.nombre)}</b><small>${de.filter(i => i.stock >= i.min).length} de ${de.length} insumos sobre el mínimo</small>
            <div class="barra"><i><u class="${e}" style="width:${pct}%"></u></i>${pct}%</div></div></div>`;
        }).join('')}</section>
      <section class="tarjeta">${titulo('Diferencias en recepción')}
        ${conDif.map(p => `<a class="fila" href="#/pedido/${p.id}"><span class="burbuja rojo">${ic('alerta')}</span><div class="txt"><b>Pedido #${p.id}</b><small>${esc(provPor(p.proveedor_id)?.nombre)}${p.nota ? ` · ${esc(p.nota)}` : ''}</small></div><span class="chev">${ic('chev')}</span></a>`).join('') || '<p class="vacio">Sin diferencias registradas.</p>'}</section>
      <section class="tarjeta">${titulo('Merma, últimos 30 días')}
        <p class="sub">La prevista viene de las recetas producidas. La adicional se registró durante la operación.</p>
        ${S.merma.map(m => `<div class="prod"><b>${esc(m.nombre)}</b> <small>(${esc(m.unidad)})</small>${nums([['Prevista', +m.prevista], ['Adicional', +m.adicional, m.adicional ? 'rojo-t' : '']])}</div>`).join('') || '<p class="vacio">Aún no hay merma registrada.</p>'}</section>
      <section class="tarjeta">${titulo('Movimientos recientes')}
        ${S.movimientos.map(m => `<div class="fila"><div class="txt"><b>${esc(m.insumo)}</b><small>${esc(NOMBRE_MOV[m.tipo] || m.tipo)} · ${esc(m.usuario)} · ${cuando(m.creado)}</small></div>
          <span class="${m.delta < 0 ? 'rojo-t' : 'verde-t'}">${m.delta > 0 ? '+' : ''}${+m.delta} ${esc(m.unidad)}</span></div>`).join('') || '<p class="vacio">Aún no hay movimientos.</p>'}</section></main>`;
  },

  perfil() {
    return `<main class="contenido sin-hero">
      <section class="tarjeta fila" style="padding:14px"><span class="burbuja" style="width:52px;height:52px;font-size:20px">${ic('persona')}</span>
        <div class="txt"><h2 style="font-size:20px">${esc(S.me.nombre)}</h2><small>${esc(S.me.area)} · ${ROL[S.me.rol]}</small></div></section>
      ${esAdmin() ? `<section class="tarjeta"><div class="titulo"><h2>Usuarios</h2><button class="ver" data-act="nuevoUsuario">${ic('mas')} Agregar</button></div>
        ${S.usuarios.map(u => `<button class="fila" style="width:100%;text-align:left" data-act="editarUsuario" data-id="${u.id}"><span class="burbuja">${ic('persona')}</span>
          <div class="txt"><b>${esc(u.nombre)}${u.activo ? '' : ' (inactivo)'}</b><small>${esc(u.area)} · ${ROL[u.rol]}</small></div><span class="chev">${ic('lapiz')}</span></button>`).join('')}</section>` : ''}
      <div class="pila">${S.me.rol === 'proveedor' ? '' : `<a class="btn borde tinta" href="#/proveedores">${ic('camion')} Proveedores</a>`}
      ${S.me.rol === 'admin' ? `<a class="btn borde tinta" href="#/reportes">${ic('barras')} Reportes</a>` : ''}
      ${S.me.rol === 'proveedor' ? '' : `<a class="btn borde tinta" href="#/pendientes">${ic('lista')} Pendientes</a>`}
      ${['staff', 'auxiliar'].includes(S.me.rol) ? `<a class="btn borde tinta" href="#/insumos">${ic('caja')} Insumos y merma</a>` : ''}
      <button class="btn borde tinta" data-act="cambiarPin">${ic('escudo')} Cambiar PIN</button>
      <button class="btn borde" data-act="salir">${ic('x')} Cerrar sesión</button></div></main>`;
  },
};

const AVANCE = { por_confirmar: 'Sin confirmar por el proveedor', confirmado: 'Confirmado por el proveedor', en_camino: 'En camino' };
const ROL = { admin: 'Administrador', staff: 'Cocina', auxiliar: 'Auxiliar de recepción', proveedor: 'Proveedor' };
const filaPedido = p => `<a class="fila" href="#/pedido/${p.id}"><span class="burbuja verde">${ic('camion')}</span>
  <div class="txt"><b>Pedido #${p.id}</b><small>${esc(provPor(p.proveedor_id)?.nombre)} · ${fechaCorta(p.fecha_entrega)}</small></div>${chipPedido(p)}</a>`;
const porSugerir = () => {
  const enCurso = new Set([...pendientes().flatMap(s => s.lineas), ...abiertos().flatMap(p => p.lineas)].map(l => l.insumo_id));
  return bajos().filter(i => !enCurso.has(i.id));
};

// Cocina: tareas del turno, sin reportes ni administración
Object.assign(rutas, {
  cocinaInicio() {
    const tarea = (href, icono, nombre, detalle) => `<a class="tarea" href="${href}"><span class="burbuja">${ic(icono)}</span><div><b>${nombre}</b><small>${detalle}</small></div>${ic('chev')}</a>`;
    return hero(`Hola, ${esc(S.me.nombre.split(' ')[0])}`, '¿Qué necesitas hacer en este turno?', `<div class="rol">${esc(S.me.area)}</div>`) + `<main class="contenido">
      <div class="pila tareas">
        ${tarea('#/conteo', 'lista', 'Registrar conteo', 'Actualiza las existencias del día')}
        ${tarea('#/pedidos', 'hoja', 'Pedir insumos', `${porSugerir().length} por solicitar`)}
        ${tarea('#/recibir', 'camion', 'Recibir pedido', `${abiertos().length} por recibir`)}
        ${tarea('#/recetas', 'hoja', 'Registrar producción', `${S.recetas.length} recetas`)}
      </div>
      <section class="tarjeta">${titulo(`<span class="rojo-t">${ic('alerta')}</span> Lo que está por acabarse`, '#/pedidos', 'Pedir')}
        ${bajos().slice(0, 5).map(i => `<div class="fila">${foto(i)}<div class="txt"><b>${esc(i.nombre)}</b><small>Quedan ${cant(i.stock, i.unidad)}</small></div>${chip(estadoDe(i.stock, i.min))}</div>`).join('') || '<p class="vacio">Todo por encima del mínimo.</p>'}
      </section></main>`;
  },

  recibir() {
    const hechos = S.recepciones.slice(0, 10);
    const lista = abiertos().filter(puedoOperar);
    const fila = p => `<a class="fila" href="#/recepcion/${p.id}"><span class="burbuja verde">${ic('camion')}</span>
      <div class="txt"><b>Pedido #${p.id}</b><small>${esc(provPor(p.proveedor_id)?.nombre)}${p.asignado_id === S.me.id ? ' · Asignado a ti' : ''}</small><small>Entrega: ${fechaCorta(p.promesa || p.fecha_entrega)} · ${esc(AVANCE[p.avance])}</small></div>${chipEntrega(p.entrega)}<span class="chev">${ic('chev')}</span></a>`;
    return `<section class="hero"><h1>Recibir</h1><p>Compara lo que llegó con lo pedido antes de que entre al inventario.</p></section><main class="contenido">
      <section class="tarjeta">${titulo('Por recibir')}${lista.map(fila).join('') || '<p class="vacio">No hay pedidos por recibir.</p>'}</section>
      <section class="tarjeta">${titulo('Recibidos')}${hechos.map(r => `<a class="fila" href="#/expediente/${r.id}"><div class="txt"><b>Folio ${esc(r.folio)}</b><small>${esc(provPor(S.pedidos.find(p => p.id === r.pedido_id)?.proveedor_id)?.nombre)} · ${cuando(r.creado)}</small></div>${chipEntrega(r.estado)}<span class="chev">${ic('chev')}</span></a>`).join('') || '<p class="vacio">Aún no hay recepciones.</p>'}</section></main>`;
  },

  // Portal de proveedores: solo trabaja con S.proveedor y S.pedidos, lo único que el servidor le manda.
  provPedidos() {
    const abiertosP = S.pedidos.filter(p => p.estado === 'en_proceso');
    const n = a => abiertosP.filter(p => p.avance === a).length;
    return bandaProveedor('Tus pedidos activos de El Mesón.') + `<main class="contenido">
      <div class="stats c3">
        ${stat(n('por_confirmar'), 'Por confirmar', 'hoja', 'ambar', '#/pedidos')}
        ${stat(n('confirmado'), 'Por enviar', 'caja', '', '#/pedidos')}
        ${stat(n('en_camino'), 'En camino', 'camion', 'verde', '#/pedidos')}
      </div>
      <section class="tarjeta">${titulo('Pedidos activos')}
        ${abiertosP.map(filaProv).join('') || '<p class="vacio">No tienes pedidos activos.</p>'}</section></main>`;
  },

  provHistorial() {
    return bandaProveedor('Pedidos ya entregados y lo que se recibió.') + `<main class="contenido">
      <section class="tarjeta">${titulo('Historial')}
        ${S.pedidos.filter(p => p.estado !== 'en_proceso').map(filaProv).join('') || '<p class="vacio">Aún no hay entregas.</p>'}</section></main>`;
  },

  provPedido(id) {
    const p = S.pedidos.find(x => x.id === Number(id));
    if (!p) return bandaProveedor('') + noEncontrado('Pedido');
    const abierto = p.estado === 'en_proceso';
    return bandaProveedor(`Pedido #${p.id}`) + `<main class="contenido">
      <section class="tarjeta"><div class="encabezado"><a href="#/pedidos" aria-label="Volver" style="padding:6px 6px 6px 0">${ic('atras')}</a><h2>Pedido #${p.id}</h2>${chipProv(p)}</div>
        <div class="minis" style="margin-top:12px">
          <div class="mini">${ic('cal')}<small>Fecha solicitada</small><b>${fechaCorta(p.fecha_entrega)}</b></div>
          <div class="mini">${ic('camion')}<small>Tu fecha de entrega</small><b>${p.promesa ? fechaCorta(p.promesa) : 'Sin confirmar'}</b></div>
          ${abierto ? '' : `<div class="mini">${ic('reloj')}<small>Recibido</small><b>${cuando(p.recibido)}</b></div><div class="mini">${ic('hoja')}<small>Folio de remisión</small><b>${esc(p.folio)}</b></div>`}
        </div></section>
      <section class="tarjeta">${titulo('Productos')}
        <table><thead><tr><th>Producto</th><th>Pedido</th>${abierto ? '' : '<th>Aceptado</th>'}</tr></thead><tbody>
        ${p.lineas.map(l => `<tr><td><b>${esc(l.nombre)}</b></td><td>${cant(l.cantidad, l.unidad)}${enPres(l)}</td>
          ${abierto ? '' : `<td class="${l.aceptado >= l.cantidad ? 'verde-t' : 'rojo-t'}">${cant(l.aceptado, l.unidad)}</td>`}</tr>`).join('')}</tbody></table></section>
      ${p.nota_proveedor ? `<p class="nota">Avisaste: ${esc(p.nota_proveedor)}</p>` : ''}
      ${abierto ? `<div class="pila">
        ${p.avance === 'por_confirmar' ? `<button class="btn" data-act="provConfirmar" data-id="${p.id}">${ic('ok')} Confirmar pedido</button>` : ''}
        ${p.avance === 'confirmado' ? `<button class="btn" data-act="provEnCamino" data-id="${p.id}">${ic('camion')} Marcar en camino</button>` : ''}
        <button class="btn borde" data-act="provProblema" data-id="${p.id}">${ic('alerta')} Avisar un problema</button></div>` : ''}</main>`;
  },
});

const bandaProveedor = sub => `<section class="banda"><small>Portal de proveedores</small><h1>${esc(S.proveedor.nombre)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</section>`;
const chipProv = p => (p.estado !== 'en_proceso' ? chipPedido(p) : {
  por_confirmar: `<span class="chip bajo">${ic('reloj')}Por confirmar</span>`,
  confirmado: `<span class="chip neutro">${ic('caja')}Por enviar</span>`,
  en_camino: `<span class="chip">${ic('camion')}En camino</span>`,
}[p.avance]);
const filaProv = p => `<a class="fila" href="#/pedido/${p.id}"><span class="burbuja">${ic('camion')}</span>
  <div class="txt"><b>Pedido #${p.id}</b><small>${p.lineas.length} productos · Entrega: ${fechaCorta(p.promesa || p.fecha_entrega)}</small></div>${chipProv(p)}</a>`;

const sugerida = i => Math.max(i.max - i.stock, i.min - i.stock, 1);
const noEncontrado = q => `<main class="contenido sin-hero"><section class="tarjeta"><p class="vacio">${q} no encontrado.</p></section></main>`;
const chipSolicitud = s => ({ pendiente: `<span class="chip neutro">${ic('reloj')}Pendiente</span>`, autorizada: `<span class="chip">${ic('ok')}Autorizada</span>`, rechazada: `<span class="chip critico">${ic('x')}Rechazada</span>` }[s.estado]);
const chipPedido = p => chipEntrega(p.entrega);

function contacto(p) {
  const digitos = p.contacto.replace(/\D/g, '');
  const [href, icono, txt] = {
    whatsapp: [`https://wa.me/${digitos}`, 'coment', 'WhatsApp'],
    telefono: [`tel:${digitos}`, 'tel', 'Llamar'],
    correo: [`mailto:${encodeURIComponent(p.contacto)}`, 'correo', 'Correo'],
  }[p.tipo];
  return `<a class="ver" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${ic(icono)} ${txt}</a>`;
}

const INTERFACES = {
  admin: {
    clase: 'ui-admin', nombre: 'Panel administrativo',
    nav: [['inicio', 'Resumen', 'casa'], ['inventario', 'Inventario', 'caja'], ['pedidos', 'Pedidos', 'lista'], ['pendientes', 'Pendientes', 'reloj', 1], ['proveedores', 'Proveedores', 'camion', 1], ['recetas', 'Recetas', 'hoja'], ['reportes', 'Reportes', 'barras', 1], ['perfil', '<span class="solo-movil">Más</span><span class="solo-grande">Perfil</span>', 'persona']],
    seccion: { actividad: 'inicio', insumos: 'inventario', insumo: 'inventario', rendimientos: 'inventario', conteo: 'inventario', solicitud: 'pedidos', pedido: 'pedidos', 'nuevo-pedido': 'pedidos', recepcion: 'pedidos', expediente: 'pedidos', remision: 'pedidos', proveedor: 'proveedores', receta: 'recetas', 'receta-editar': 'recetas' },
    rutas: ['inicio', 'actividad', 'inventario', 'insumos', 'insumo', 'rendimientos', 'conteo', 'pedidos', 'pendientes', 'solicitud', 'pedido', 'nuevo-pedido', 'recibir', 'recepcion', 'expediente', 'remision', 'proveedores', 'proveedor', 'recetas', 'receta', 'receta-editar', 'reportes', 'perfil'],
    vista: { 'nuevo-pedido': 'nuevoPedido', 'receta-editar': 'recetaEditar' },
  },
  staff: {
    clase: 'ui-cocina', nombre: 'Cocina',
    nav: [['inicio', 'Hoy', 'casa'], ['conteo', 'Conteo', 'lista'], ['pedidos', 'Pedir', 'hoja'], ['recibir', 'Recibir', 'camion'], ['recetas', 'Recetas', 'caja'], ['perfil', 'Perfil', 'persona']],
    seccion: { insumos: 'conteo', insumo: 'conteo', solicitud: 'pedidos', pedido: 'recibir', recepcion: 'recibir', expediente: 'recibir', remision: 'recibir', proveedores: 'recibir', proveedor: 'recibir', pendientes: 'inicio', receta: 'recetas' },
    rutas: ['inicio', 'conteo', 'insumos', 'insumo', 'pedidos', 'pendientes', 'solicitud', 'pedido', 'recibir', 'recepcion', 'expediente', 'remision', 'proveedores', 'proveedor', 'recetas', 'receta', 'perfil'],
    vista: { inicio: 'cocinaInicio' },
  },
  auxiliar: {
    clase: 'ui-auxiliar', nombre: 'Auxiliar de recepción',
    nav: [['pendientes', 'Hoy', 'casa'], ['recibir', 'Recibir', 'camion'], ['proveedores', 'Proveedores', 'hoja'], ['perfil', 'Perfil', 'persona']],
    seccion: { pedido: 'recibir', recepcion: 'recibir', expediente: 'recibir', remision: 'recibir', proveedor: 'proveedores', insumos: 'perfil', insumo: 'perfil' },
    rutas: ['pendientes', 'recibir', 'pedido', 'recepcion', 'expediente', 'remision', 'proveedores', 'proveedor', 'insumos', 'insumo', 'perfil'],
    vista: {},
  },
  proveedor: {
    clase: 'ui-proveedor', nombre: 'Portal de proveedores',
    nav: [['pedidos', 'Pedidos', 'camion'], ['remisiones', 'Remisiones', 'hoja'], ['historial', 'Historial', 'reloj'], ['perfil', 'Cuenta', 'persona']],
    seccion: { pedido: 'pedidos', remision: 'remisiones' },
    rutas: ['pedidos', 'pedido', 'remisiones', 'remision', 'historial', 'perfil'],
    vista: { pedidos: 'provPedidos', pedido: 'provPedido', historial: 'provHistorial', remisiones: 'provRemisiones', remision: 'provRemision' },
  },
};
let rutaPrevia = '';

function campana() {
  if (S.me.rol === 'proveedor') {
    const n = S.pedidos.filter(p => p.estado === 'en_proceso' && p.avance === 'por_confirmar').length;
    return `<a class="campana ${n ? 'activa' : ''}" href="#/pedidos" aria-label="${n} pedidos por confirmar">${ic('campana')}</a>`;
  }
  const n = criticos().length;
  return `<a class="campana ${n ? 'activa' : ''}" href="#/pedidos" aria-label="Alertas: ${n} críticas">${ic('campana')}</a>`;
}

function render() {
  if (!S) return;
  const ui = INTERFACES[S.me.rol];
  const [nombre, ...args] = location.hash.replace(/^#\/?/, '').split('/');
  const r = ui.rutas.includes(nombre) ? nombre : ui.rutas[0];
  const seccion = ui.seccion[r] || r;
  const scroll = window.scrollY;
  document.body.className = `app ${ui.clase}`;
  app.innerHTML = `<header class="cabecera"><a href="#/${ui.rutas[0]}" aria-label="Inicio"><img src="/img/logo.png" alt="El Mesón"></a>
    <span class="interfaz">${ui.nombre}</span>${campana()}</header>
    ${rutas[ui.vista[r] || r](...args)}
    <nav class="nav" aria-label="Principal">${ui.nav.map(([id, t, i, escritorio]) => `<a class="${id === seccion ? 'on' : ''} ${escritorio ? 'solo-escritorio' : ''}" ${id === seccion ? 'aria-current="page"' : ''} href="#/${id}">${ic(i)}${t}</a>`).join('')}</nav>`;
  window.scrollTo(0, location.hash === rutaPrevia ? scroll : 0);
  rutaPrevia = location.hash;
}

async function refrescar() {
  S = await api('/api/estado');
  render();
}

async function login(errorInicial = '') {
  document.body.className = '';
  const usuarios = await api('/api/usuarios');
  const tipos = [['admin', 'Admin', 'escudo'], ['staff', 'Cocina', 'lista'], ['auxiliar', 'Auxiliar', 'caja'], ['proveedor', 'Proveedor', 'camion']];
  let ultimo = null;
  try { ultimo = Number(localStorage.getItem('meson.usuario')); } catch {}
  const previo = usuarios.find(u => u.id === ultimo);
  app.innerHTML = `<header class="cabecera"><img src="/img/logo.png" alt="El Mesón"></header>
    <section class="hero"><h1>Acceso</h1><p>Control que impulsa grandes sabores.</p></section>
    <main class="login"><div class="pestanas" style="margin-bottom:10px" role="group" aria-label="Tipo de acceso">
      ${tipos.map(([id, n, i]) => `<button type="button" class="pestana" data-tipo="${id}">${ic(i)}${n}</button>`).join('')}</div>
    <form id="form-login">
      <label class="campo">Usuario<select name="usuario_id" required></select></label>
      <label class="campo">PIN<input name="pin" type="password" inputmode="numeric" autocomplete="current-password" required autofocus></label>
      <p class="error" role="alert">${esc(errorInicial)}</p>
      <button class="btn">Entrar</button></form></main>`;
  const elegir = tipo => {
    document.querySelectorAll('[data-tipo]').forEach(b => {
      b.classList.toggle('on', b.dataset.tipo === tipo);
      b.setAttribute('aria-pressed', b.dataset.tipo === tipo);
    });
    $('[name=usuario_id]').innerHTML = usuarios.filter(u => u.rol === tipo).map(u => `<option value="${u.id}">${esc(u.nombre)}</option>`).join('') || '<option value="">Aún no hay usuarios de este tipo</option>';
  };
  document.querySelectorAll('[data-tipo]').forEach(b => { b.onclick = () => elegir(b.dataset.tipo); });
  elegir(previo?.rol || 'admin');
  if (previo) { $('[name=usuario_id]').value = previo.id; $('[name=pin]').focus(); }
  $('#form-login').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api('/api/login', { usuario_id: Number(f.get('usuario_id')), pin: f.get('pin') });
      try { localStorage.setItem('meson.usuario', f.get('usuario_id')); } catch {}
      await refrescar();
    } catch (err) {
      $('#form-login .error').textContent = err.message;
    }
  });
}

// Diálogo de formulario: los errores del servidor se muestran dentro para no perder lo capturado.
function formulario({ titulo: t, campos, enviar, alEnviar, exito }) {
  const d = $('#dialogo');
  const control = c => {
    if (c.tipo === 'info') return `<div class="info-form">${c.html}</div>`;
    if (c.tipo === 'firma') return `<div class="lienzo-firma"><span aria-hidden="true">Firma aquí</span><canvas aria-label="Espacio para firmar con el dedo o el mouse" role="img"></canvas><button type="button" class="ver" data-limpiar>Borrar firma</button></div>`;
    if (c.tipo === 'select') return `<label class="campo">${c.etiqueta}<select name="${c.nombre}" ${c.req ? 'required' : ''}>${c.opciones.map(([v, n]) => `<option value="${esc(v)}" ${String(c.valor ?? '') === String(v) ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>`;
    if (c.tipo === 'check') return `<label class="check"><input type="checkbox" name="${c.nombre}" ${c.valor ? 'checked' : ''}> ${c.etiqueta}</label>`;
    if (c.tipo === 'area') return `<label class="campo">${c.etiqueta}<textarea name="${c.nombre}" rows="3" maxlength="500" ${c.req ? 'required' : ''}>${esc(c.valor)}</textarea></label>`;
    if (c.tipo === 'file') return `<label class="campo">${c.etiqueta}<input name="${c.nombre}" type="file" accept=".pdf,.xml,image/jpeg,image/png,image/webp" ${c.req ? 'required' : ''}></label>`;
    return `<label class="campo">${c.etiqueta}<input name="${c.nombre}" type="${c.tipo || 'text'}" value="${esc(c.valor)}" ${c.req ? 'required' : ''} ${c.tipo === 'number' ? 'min="0" step="any" inputmode="decimal"' : ''} ${c.extra || ''}></label>`;
  };
  const opcionales = campos.filter(c => c.opcional);
  d.innerHTML = `<form><h2>${t}</h2>${campos.filter(c => !c.opcional).map(control).join('')}
    ${opcionales.length ? `<details class="opcionales"><summary>Datos adicionales (opcional)</summary>${opcionales.map(control).join('')}</details>` : ''}
    <p class="error" role="alert"></p>
    <div class="botones"><button type="button" class="btn borde tinta" data-cerrar>Cancelar</button><button class="btn" value="ok">${enviar}</button></div></form>`;
  const form = $('form', d);
  $('[data-cerrar]', d).onclick = () => d.close();
  form.onsubmit = async e => {
    e.preventDefault();
    const b = e.submitter;
    const datos = {};
    for (const c of campos) {
      if (c.tipo === 'info') continue;
      if (c.tipo === 'firma') { datos[c.nombre] = firma.trazos; continue; }
      const el = form.elements[c.nombre];
      datos[c.nombre] = c.tipo === 'check' ? el.checked : c.tipo === 'file' ? el.files[0] : el.value;
    }
    b.disabled = true;
    try {
      await alEnviar(datos);
      d.close();
      if (exito) avisar(exito);
      await refrescar();
    } catch (err) {
      $('.error', d).textContent = err.message;
      $('.error', d).scrollIntoView({ block: 'nearest' });
    } finally {
      b.disabled = false;
    }
  };
  d.showModal();
  // El lienzo necesita estar visible para medir su tamaño.
  let firma = null;
  const lienzo = $('canvas', d);
  if (lienzo) {
    firma = iniciarFirma(lienzo);
    $('[data-limpiar]', d).onclick = () => firma.limpiar();
  }
}

const camposInsumo = (i = {}) => [
  { nombre: 'nombre', etiqueta: 'Nombre *', valor: i.nombre, req: 1, extra: 'maxlength="80"' },
  { nombre: 'categoria_id', etiqueta: 'Categoría *', tipo: 'select', valor: i.categoria_id, req: 1, opciones: S.categorias.map(c => [c.id, c.nombre]) },
  { nombre: 'unidad', etiqueta: 'Unidad * (kg, L, pz, paquete)', valor: i.unidad, req: 1, extra: 'maxlength="20"' },
  ...(i.id ? [] : [{ nombre: 'stock', etiqueta: 'Stock inicial *', tipo: 'number', valor: 0, req: 1 }]),
  { nombre: 'min', etiqueta: 'Mínimo *', tipo: 'number', valor: i.min, req: 1 },
  { nombre: 'max', etiqueta: 'Máximo *', tipo: 'number', valor: i.max, req: 1 },
  { nombre: 'rendimiento', etiqueta: 'Rendimiento % (de 10 kg, ¿cuánto se aprovecha? 8 kg = 80)', tipo: 'number', valor: i.rendimiento },
  { nombre: 'costo', etiqueta: 'Precio por unidad', tipo: 'number', valor: i.costo, opcional: 1 },
  { nombre: 'codigo', etiqueta: 'Código de barras', valor: i.codigo, opcional: 1 },
  { nombre: 'proveedor_id', etiqueta: 'Proveedor', tipo: 'select', valor: i.proveedor_id, opcional: 1, opciones: [['', 'Sin asignar'], ...S.proveedores.map(p => [p.id, p.nombre])] },
  ...(i.id ? [{ nombre: 'activo', etiqueta: 'Activo', tipo: 'check', valor: i.activo }] : []),
];
const camposProveedor = (p = {}) => [
  { nombre: 'nombre', etiqueta: 'Nombre comercial *', valor: p.nombre, req: 1, extra: 'maxlength="80"' },
  { nombre: 'tipo', etiqueta: 'Contacto principal por', tipo: 'select', valor: p.tipo, opciones: [['whatsapp', 'WhatsApp'], ['telefono', 'Teléfono'], ['correo', 'Correo']] },
  { nombre: 'contacto', etiqueta: 'Número o correo *', valor: p.contacto, req: 1 },
  { nombre: 'razon_social', etiqueta: 'Razón social', valor: p.razon_social, opcional: 1, extra: 'maxlength="160"' },
  { nombre: 'rfc', etiqueta: 'RFC', valor: p.rfc, opcional: 1, extra: 'maxlength="13" autocapitalize="characters"' },
  { nombre: 'domicilio_fiscal', etiqueta: 'Domicilio fiscal', valor: p.domicilio_fiscal, opcional: 1, extra: 'maxlength="250"' },
  { nombre: 'cp', etiqueta: 'Código postal', valor: p.cp, opcional: 1, extra: 'maxlength="5" inputmode="numeric"' },
  { nombre: 'regimen_fiscal', etiqueta: 'Régimen fiscal', tipo: 'select', valor: p.regimen_fiscal, opcional: 1, opciones: REGIMENES },
  { nombre: 'contacto_nombre', etiqueta: 'Nombre de contacto', valor: p.contacto_nombre, opcional: 1, extra: 'maxlength="80"' },
  { nombre: 'telefono', etiqueta: 'Teléfono', valor: p.telefono, opcional: 1, extra: 'type="tel" inputmode="tel"' },
  { nombre: 'correo', etiqueta: 'Correo', valor: p.correo, opcional: 1, extra: 'inputmode="email"' },
];
const camposUsuario = (u = {}) => [
  { nombre: 'nombre', etiqueta: 'Nombre *', valor: u.nombre, req: 1, extra: 'maxlength="60"' },
  { nombre: 'area', etiqueta: 'Área *', valor: u.area, req: 1, extra: 'maxlength="60"' },
  { nombre: 'rol', etiqueta: 'Rol', tipo: 'select', valor: u.rol || 'staff', opciones: [['staff', 'Cocina'], ['auxiliar', 'Auxiliar de recepción'], ['admin', 'Administrador'], ['proveedor', 'Proveedor']] },
  { nombre: 'proveedor_id', etiqueta: 'Proveedor (solo para ese rol)', tipo: 'select', valor: u.proveedor_id, opciones: [['', 'No aplica'], ...S.proveedores.map(p => [p.id, p.nombre])] },
  { nombre: 'pin', etiqueta: u.id ? 'Nuevo PIN (opcional)' : 'PIN (4 a 8 dígitos)', tipo: 'password', req: !u.id, extra: 'inputmode="numeric" autocomplete="new-password"' },
  ...(u.id ? [{ nombre: 'activo', etiqueta: 'Activo', tipo: 'check', valor: u.activo }] : []),
];

const acciones = {
  async guardarConteo({ cat }) {
    const id = Number(cat);
    const items = activos().filter(i => i.categoria_id === id);
    // Solo lo capturado: un renglón sin tocar no debe pisar entradas ocurridas mientras la pantalla estaba abierta.
    const tocados = items.filter(i => `conteo.${i.id}` in draft);
    await api('/api/conteos', { categoria_id: id, lineas: tocados.map(i => ({ insumo: i.id, cantidad: String(draft[`conteo.${i.id}`]) })) });
    tocados.forEach(i => delete draft[`conteo.${i.id}`]);
    guardarBorrador();
    avisar(tocados.length ? `Conteo guardado: ${tocados.length} insumos actualizados` : 'Conteo registrado sin cambios');
    await refrescar();
  },
  // shortcut: lectores USB/Bluetooth teclean el código aquí; sin cámara del teléfono porque requiere HTTPS. Agregar BarcodeDetector al servir con HTTPS.
  escanear() {
    formulario({
      titulo: 'Escanear insumo', enviar: 'Buscar',
      campos: [{ nombre: 'codigo', etiqueta: 'Código de barras', req: 1, extra: 'autofocus autocomplete="off"' }],
      alEnviar: async ({ codigo }) => {
        const i = activos().find(x => x.codigo === codigo.trim());
        if (!i) throw new Error('Ningún insumo tiene ese código');
        location.hash = `#/conteo/${i.categoria_id}`;
        setTimeout(() => { const el = $(`#c-${i.id}`); el?.focus(); el?.select(); }, 120);
      },
    });
  },
  nuevoInsumo: () => formulario({ titulo: 'Agregar insumo', enviar: 'Guardar', exito: 'Insumo agregado', campos: camposInsumo(), alEnviar: d => api('/api/insumos', d) }),
  editarInsumo({ id }) {
    const i = insumoPor(Number(id));
    formulario({ titulo: 'Editar insumo', enviar: 'Guardar', exito: 'Insumo actualizado', campos: camposInsumo(i), alEnviar: d => api(`/api/insumos/${i.id}`, d, 'PUT') });
  },
  nuevoProveedor: () => formulario({ titulo: 'Agregar proveedor', enviar: 'Guardar', exito: 'Proveedor agregado', campos: camposProveedor(), alEnviar: d => api('/api/proveedores', d) }),
  editarProveedor({ id }) {
    const p = provPor(Number(id));
    formulario({ titulo: 'Editar proveedor', enviar: 'Guardar', exito: 'Proveedor actualizado', campos: camposProveedor(p), alEnviar: d => api(`/api/proveedores/${p.id}`, d, 'PUT') });
  },
  nuevoUsuario: () => formulario({ titulo: 'Agregar usuario', enviar: 'Guardar', exito: 'Usuario agregado', campos: camposUsuario(), alEnviar: d => api('/api/usuarios', d) }),
  editarUsuario({ id }) {
    const u = S.usuarios.find(x => x.id === Number(id));
    formulario({ titulo: 'Editar usuario', enviar: 'Guardar', exito: 'Usuario actualizado', campos: camposUsuario(u), alEnviar: d => api(`/api/usuarios/${u.id}`, d, 'PUT') });
  },
  cambiarPin() {
    formulario({
      titulo: 'Cambiar PIN', enviar: 'Guardar',
      campos: [{ nombre: 'actual', etiqueta: 'PIN actual', tipo: 'password', req: 1, extra: 'inputmode="numeric" autocomplete="current-password"' },
        { nombre: 'nuevo', etiqueta: 'PIN nuevo (4 a 8 dígitos)', tipo: 'password', req: 1, extra: 'inputmode="numeric" autocomplete="new-password"' }],
      alEnviar: d => api('/api/pin', d),
    });
  },
  provConfirmar({ id }) {
    const p = S.pedidos.find(x => x.id === Number(id));
    formulario({
      titulo: `Confirmar pedido #${p.id}`, enviar: 'Confirmar',
      campos: [{ nombre: 'promesa', etiqueta: '¿Qué día lo entregas?', tipo: 'date', valor: p.fecha_entrega, req: 1 }],
      alEnviar: d => api(`/api/proveedor/pedidos/${p.id}/avance`, d),
    });
  },
  async provEnCamino({ id }) {
    await api(`/api/proveedor/pedidos/${id}/avance`, {});
    avisar('El Mesón ya sabe que va en camino');
    await refrescar();
  },
  provProblema({ id }) {
    formulario({
      titulo: 'Avisar un problema', enviar: 'Enviar aviso',
      campos: [{ nombre: 'nota', etiqueta: '¿Qué pasó? (faltante, retraso, cambio)', tipo: 'area', req: 1 }],
      alEnviar: d => api(`/api/proveedor/pedidos/${id}/problema`, d),
    });
  },
  async salir() {
    await api('/api/logout', {});
    limpiar('');
    seleccion.clear();
    S = null;
    location.hash = '';
    login();
  },
  alternar({ id }) {
    const n = Number(id);
    seleccion.has(n) ? seleccion.delete(n) : seleccion.add(n);
    render();
  },
  pedirOtro() {
    formulario({
      titulo: 'Pedir otro insumo', enviar: 'Crear solicitud', exito: 'Solicitud creada',
      campos: [{ nombre: 'insumo', etiqueta: 'Insumo *', tipo: 'select', req: 1, opciones: [['', 'Elegir…'], ...activos().map(i => [i.id, `${i.nombre} (${i.unidad}, hay ${+i.stock})`])] },
        { nombre: 'cantidad', etiqueta: 'Cantidad *', tipo: 'number', req: 1 },
        { nombre: 'fecha_entrega', etiqueta: 'Fecha de entrega deseada', tipo: 'date', valor: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10), opcional: 1 },
        { nombre: 'comentario', etiqueta: 'Comentarios', tipo: 'area', opcional: 1 }],
      alEnviar: async d => {
        const { id } = await api('/api/solicitudes', { comentario: d.comentario, fecha_entrega: d.fecha_entrega, lineas: [{ insumo: d.insumo, cantidad: d.cantidad, proveedor: insumoPor(Number(d.insumo))?.proveedor_id }] });
        location.hash = `#/solicitud/${id}`;
      },
    });
  },
  crearSolicitud() {
    const candidatos = porSugerir();
    const elegidos = candidatos.filter(i => seleccion.has(i.id));
    const lineas = (elegidos.length ? elegidos : candidatos).map(i => ({ insumo: i.id, cantidad: sugerida(i), proveedor: i.proveedor_id }));
    const manana = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
    formulario({
      titulo: `Crear solicitud (${lineas.length} insumos)`, enviar: 'Crear',
      campos: [{ nombre: 'fecha_entrega', etiqueta: 'Fecha de entrega deseada', tipo: 'date', valor: manana, req: 1 }, { nombre: 'comentario', etiqueta: 'Comentarios', tipo: 'area' }],
      alEnviar: async d => {
        const { id } = await api('/api/solicitudes', { ...d, lineas });
        seleccion.clear();
        location.hash = `#/solicitud/${id}`;
      },
    });
  },
  async autorizar({ id }) {
    const s = S.solicitudes.find(x => x.id === Number(id));
    const k = `sol.${s.id}.`;
    await api(`/api/solicitudes/${s.id}/autorizar`, {
      fecha_entrega: val(`${k}fecha`, s.fecha_entrega || ''),
      lineas: s.lineas.map(l => ({ insumo: l.insumo_id, cantidad: String(val(`${k}c${l.insumo_id}`, l.cantidad)), proveedor: val(`${k}p${l.insumo_id}`, l.proveedor_id) })),
    });
    limpiar(k);
    avisar('Solicitud autorizada. Pedidos creados.');
    await refrescar();
  },
  rechazar({ id }) {
    formulario({
      titulo: 'Rechazar solicitud', enviar: 'Rechazar',
      campos: [{ nombre: 'motivo', etiqueta: 'Motivo', tipo: 'area', req: 1 }],
      alEnviar: d => api(`/api/solicitudes/${id}/rechazar`, d),
    });
  },
  diferencia({ id }) {
    formulario({
      titulo: 'Reportar diferencia', enviar: 'Reportar',
      campos: [{ nombre: 'nota', etiqueta: '¿Qué pasó?', tipo: 'area', req: 1 }],
      alEnviar: d => api(`/api/pedidos/${id}/diferencia`, d),
    });
  },
};

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  b.disabled = true;
  try {
    await acciones[b.dataset.act](b.dataset, b);
  } catch (err) {
    avisar(err.message);
  } finally {
    b.disabled = false;
  }
});

document.addEventListener('input', e => {
  const el = e.target;
  if (!el.dataset.draft) return;
  draft[el.dataset.draft] = el.type === 'checkbox' ? el.checked : el.value;
  guardarBorrador();
  const fila = el.closest('tr');
  if (el.dataset.live === 'conteo') fila.querySelector('td:last-child').innerHTML = chip(estadoDe(Number(el.value), Number(fila.dataset.min)));
  if (el.dataset.live === 'rec') fila.querySelector('.est').innerHTML = iconoRec(Number(el.value), Number(fila.dataset.pedido));
  if (el.dataset.live === 'buscar') {
    const q = el.value.toLowerCase();
    document.querySelectorAll('#lista-insumos .fila').forEach(f => { f.hidden = !f.textContent.toLowerCase().includes(q); f.style.display = f.hidden ? 'none' : ''; });
  }
});
// Los <select> también disparan "input"; "change" cubre navegadores móviles antiguos.
document.addEventListener('change', e => {
  if (e.target.matches('select[data-draft]')) { draft[e.target.dataset.draft] = e.target.value; guardarBorrador(); }
});

window.addEventListener('hashchange', render);
