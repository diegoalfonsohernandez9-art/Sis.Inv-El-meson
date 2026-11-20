'use strict';
// Recepción, expediente, remisiones, firmas, ficha de proveedor, recetas y pendientes.

const ENTREGA = { pendiente: 'Pendiente', recibida_parcial: 'Recibida parcialmente', aceptada: 'Aceptada', rechazada: 'Rechazada' };
const ENTREGA_CHIP = { pendiente: ['neutro', 'reloj'], recibida_parcial: ['bajo', 'alerta'], aceptada: ['', 'ok'], rechazada: ['critico', 'x'] };
const chipEntrega = e => `<span class="chip ${ENTREGA_CHIP[e][0]}">${ic(ENTREGA_CHIP[e][1])}${ENTREGA[e]}</span>`;
const DOC_ESTADO = { pendiente: ['Por revisar', 'neutro', 'reloj'], revisada: ['Revisada', '', 'ok'], con_observaciones: ['Con observaciones', 'bajo', 'alerta'] };
const REM_ESTADO = { borrador: ['Borrador', 'neutro', 'lapiz'], emitida: ['Emitida', '', 'ok'], devuelta: ['Devuelta con observaciones', 'bajo', 'alerta'], reemplazada: ['Versión anterior', 'neutro', 'reloj'] };
const FIRMA_ESTADO = { firmada: ['Firmada', '', 'ok'], pendiente: ['Falta firmar', 'neutro', 'reloj'], pendiente_con_motivo: ['Pendiente de firma (con motivo)', 'bajo', 'alerta'] };
const ENVIO_ESTADO = { sin_enviar: ['Sin enviar', 'neutro', 'reloj'], publicada_portal: ['Publicada en portal', '', 'ok'], compartida_manual: ['Compartida a mano, sin confirmar', 'bajo', 'alerta'], error: ['Error al enviar', 'critico', 'x'] };
const chipDe = ([t, c, i]) => `<span class="chip ${c}">${ic(i)}${esc(t)}</span>`;
const TIPO_DOC = { factura: 'Factura', xml: 'XML', pdf: 'PDF', nota_entrega: 'Nota de entrega', foto: 'Fotografía', captura: 'Captura', evidencia: 'Evidencia', comprobante_devolucion: 'Comprobante de devolución', remision_corregida: 'Remisión corregida', factura_corregida: 'Factura corregida' };
const TIPO_INC = { faltante: 'Faltante', rechazo: 'Rechazo', dano: 'Daño', observacion: 'Observación' };
const CHECKLIST = [['proveedor', 'Proveedor correcto'], ['pedido', 'Corresponde al pedido'], ['productos', 'Productos correctos'], ['cantidades', 'Cantidades correctas'], ['calidad', 'Calidad aceptable'],
  ['precios', 'Precios correctos'], ['importes', 'Importes correctos'], ['documento', 'Factura o nota presente'], ['datos_fiscales', 'Datos fiscales coinciden'], ['folio', 'Folio correcto'], ['adjuntos', 'Archivos adjuntos']];
// Lo que la revisión marcó con observación, como borrador del aviso al proveedor (el checklist interno no se le comparte).
const notasRevision = rem => {
  const r = S.recepciones.find(x => x.id === rem.recepcion_id);
  if (!r) return '';
  const obs = CHECKLIST.filter(([k]) => r.checklist?.[k] === 'observacion').map(([, t]) => `Revisar: ${t.toLowerCase()}.`);
  return [...obs, r.checklist_notas || ''].filter(Boolean).join('\n').slice(0, 500);
};
const REGIMENES = [['', 'Sin capturar'], ['601', '601 General de Ley Personas Morales'], ['603', '603 Personas Morales con Fines no Lucrativos'], ['606', '606 Arrendamiento'], ['612', '612 Personas Físicas con Actividades Empresariales y Profesionales'], ['616', '616 Sin obligaciones fiscales'], ['620', '620 Sociedades Cooperativas de Producción'], ['621', '621 Incorporación Fiscal'], ['622', '622 Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras'], ['625', '625 Plataformas Tecnológicas'], ['626', '626 Régimen Simplificado de Confianza']];
const FUENTE = { receta: 'Merma de la receta', rendimiento: 'Merma del insumo', sin_dato: 'Sin merma capturada' };

const clave = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
const dinero = n => (n === null || n === undefined ? 'Sin dato' : new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n));
const pendienteDe = l => (l.cerrado ? 0 : Math.max(0, +(l.cantidad - l.aceptado).toFixed(3)));
const vigentes = () => S.remisiones.filter(r => r.estado !== 'reemplazada');
const remDe = recId => vigentes().find(r => r.recepcion_id === recId);
const puedoOperar = p => S.me.rol !== 'auxiliar' || !p.asignado_id || p.asignado_id === S.me.id;

const nums = (cols) => `<div class="nums" style="grid-template-columns:repeat(${cols.length},1fr)">${cols.map(([t, v, c]) => `<div><small>${t}</small><b class="${c || ''}">${esc(v)}</b></div>`).join('')}</div>`;

function listaDocs(docs) {
  return docs.map(d => `<a class="fila" href="/api/documentos/${d.id}" target="_blank" rel="noopener"><span class="burbuja">${ic('hoja')}</span>
    <div class="txt"><b>${esc(d.nombre)}</b><small>${esc(TIPO_DOC[d.tipo] || d.tipo)}${d.usuario ? ` · ${esc(d.usuario)}` : ''}${d.creado ? ` · ${cuando(d.creado)}` : ''}</small></div></a>`).join('') || '<p class="vacio">Sin archivos adjuntos.</p>';
}

async function subir(archivo, params) {
  const q = new URLSearchParams({ ...params, nombre: archivo.name });
  const r = await fetch(`/api/documentos?${q}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: archivo }).catch(() => { throw new Error(SIN_RED); });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'No se pudo subir el archivo');
  return d;
}

const campoArchivo = { nombre: 'archivo', etiqueta: 'Archivo (PDF, XML, JPG, PNG o WEBP, hasta 10 MB)', tipo: 'file', req: 1 };

function pasos(actual) {
  const n = ['Revisar', 'Registrar', 'Decidir', 'Firmar', 'Enviar'];
  return `<ol class="pasos">${n.map((t, i) => `<li class="${i === actual ? 'on' : i < actual ? 'hecho' : ''}" ${i === actual ? 'aria-current="step"' : ''}>${i < actual ? ic('ok') : `<span>${i + 1}</span>`}${t}</li>`).join('')}</ol>`;
}

function calcLinea(esperada, recibido, decision, parcial) {
  const rec = Number(recibido) || 0;
  let acept = decision === 'rechazar' ? 0 : decision === 'parcial' ? Math.min(Number(parcial) || 0, rec) : Math.min(rec, esperada);
  acept = Math.min(acept, esperada);
  return { rec, acept: +acept.toFixed(3), rej: +(rec - acept).toFixed(3), falta: Math.max(0, +(esperada - rec).toFixed(3)) };
}

function mensajeLinea(c, esperada, u) {
  const partes = [];
  if (c.falta > 0) partes.push(`<b class="rojo-t">Faltan ${cant(c.falta, u)}</b>`);
  if (c.rej > 0) partes.push(`<b class="rojo-t">Se rechazan ${cant(c.rej, u)}</b>`);
  partes.push(`Entra al inventario: <b class="${c.acept ? 'verde-t' : ''}">${cant(c.acept, u)}</b>`);
  return partes.join(' · ');
}

function datosRecepcion(p) {
  const k = `rcp.${p.id}.`;
  return p.lineas.filter(l => pendienteDe(l) > 0).map(l => {
    const i = insumoPor(l.insumo_id), esperada = pendienteDe(l), f = l.factor || 1;
    const recibido = val(`${k}${i.id}.rec`, +(esperada / f).toFixed(3));
    const decision = val(`${k}${i.id}.dec`, 'aceptar');
    const parcial = val(`${k}${i.id}.par`, '');
    return { i, l, esperada, recibido, decision, parcial, motivo: val(`${k}${i.id}.mot`, ''), nota: val(`${k}${i.id}.nota`, ''), dano: val(`${k}${i.id}.dano`, false), c: calcLinea(esperada, (Number(recibido) || 0) * f, decision, (Number(parcial) || 0) * f) };
  });
}

function docRemision(r) {
  const c = r.contenido;
  return `<article class="papel" aria-label="Vista previa de la remisión">
    <header><h2>Remisión</h2><p class="aviso-doc">Este documento es una remisión de entrega. No es una factura ni un comprobante fiscal.</p></header>
    <dl class="datos">
      <div><dt>Folio</dt><dd>${esc(r.folio)} · versión ${r.version}</dd></div>
      <div><dt>Fecha</dt><dd>${cuando(r.creado)}</dd></div>
      <div><dt>Proveedor</dt><dd>${esc(c.proveedor.nombre)}${c.proveedor.rfc ? ` · RFC ${esc(c.proveedor.rfc)}` : ''}</dd></div>
      <div><dt>Lugar de entrega</dt><dd>${esc(c.lugar)}</dd></div>
      <div><dt>Pedido</dt><dd>#${c.pedido}</dd></div>
      <div><dt>Folio de entrega</dt><dd>${esc(c.folio_entrega)}</dd></div>
      <div><dt>Recibió</dt><dd>${esc(c.recibio)} · ${cuando(c.fecha_recepcion)}</dd></div>
    </dl>
    ${c.lineas.map(l => `<div class="prod"><b>${esc(l.insumo)}</b> <small>(${esc(l.unidad)})</small>
      ${nums([['Pedida', +l.pedida], ['Recibida', +l.recibida], ['Aceptada', +l.aceptada, 'verde-t'], ['Rechazada', +l.rechazada, l.rechazada ? 'rojo-t' : ''], ['Pendiente', +l.pendiente, l.pendiente ? 'rojo-t' : '']])}
      ${l.motivo ? `<p class="mini-nota">Motivo de rechazo: ${esc(l.motivo)}</p>` : ''}${l.nota ? `<p class="mini-nota">Nota: ${esc(l.nota)}</p>` : ''}</div>`).join('')}
    ${c.notas ? `<h3>Notas</h3><p>${esc(c.notas)}</p>` : ''}
    ${c.incidencias.length ? `<h3>Faltantes e incidencias</h3><ul>${c.incidencias.map(i => `<li>${esc(TIPO_INC[i.tipo] || i.tipo)}: ${esc(i.insumo)}${i.cantidad ? ` ${+i.cantidad} ${esc(i.unidad)}` : ''}${i.motivo ? ` (${esc(i.motivo)})` : ''}</li>`).join('')}</ul>` : ''}
    ${c.devoluciones.length ? `<h3>Mercancía devuelta físicamente</h3><ul>${c.devoluciones.map(d => `<li>${esc(d.insumo)}: ${+d.cantidad} ${esc(d.unidad)}. ${esc(d.motivo)}. Comprobante ${esc(d.comprobante)}</li>`).join('')}</ul>` : ''}
    ${c.evidencias.length ? `<h3>Evidencias de referencia</h3><ul>${c.evidencias.map(e => `<li>${esc(TIPO_DOC[e.tipo] || e.tipo)}: ${esc(e.nombre)}</li>`).join('')}</ul>` : ''}
    ${c.correccion ? `<h3>Corrección</h3><p>Sustituye a la versión ${c.correccion.version_anterior}. Motivo: ${esc(c.correccion.motivo)}</p>` : ''}
    ${r.devolucion ? `<div class="obs"><h3>${ic('alerta')} Devuelta con observaciones</h3><p><b>${esc(r.devolucion.tipo)}:</b> ${esc(r.devolucion.motivo)}</p>
      ${r.devolucion.notas ? `<p>${esc(r.devolucion.notas)}</p>` : ''}${r.devolucion.lineas.map(l => `<p><b>${esc(l.insumo)}:</b> ${esc(l.nota)}</p>`).join('')}
      <small>Devolvió ${esc(r.devolucion.por)}, ${cuando(r.devolucion.en)}<br>Esta devolución es del documento y no modifica el inventario.</small></div>` : ''}
</article>`;
}

function firmaSvg(f) {
  const d = (f.trazos || []).map(t => `M${t.map(([x, y]) => `${(x * 300).toFixed(1)} ${(y * 90).toFixed(1)}`).join(' L')}`).join(' ');
  return `<svg class="firma-svg" viewBox="0 0 300 90" role="img" aria-label="Firma de ${esc(f.nombre)}"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function diferencias(a, b) {
  const salida = [];
  if (a.contenido.lugar !== b.contenido.lugar) salida.push(`Lugar de entrega: "${a.contenido.lugar}" → "${b.contenido.lugar}"`);
  if ((a.contenido.notas || '') !== (b.contenido.notas || '')) salida.push(`Notas: "${a.contenido.notas || 'sin notas'}" → "${b.contenido.notas || 'sin notas'}"`);
  for (const l of b.contenido.lineas) {
    const o = a.contenido.lineas.find(x => x.insumo_id === l.insumo_id);
    if (o && (o.nota || '') !== (l.nota || '')) salida.push(`${l.insumo}, nota: "${o.nota || 'sin nota'}" → "${l.nota || 'sin nota'}"`);
  }
  const ea = a.contenido.evidencias.length, eb = b.contenido.evidencias.length;
  if (ea !== eb) salida.push(`Evidencias: ${ea} → ${eb}`);
  return salida;
}

Object.assign(rutas, {
  pendientes() {
    const rec = S.recepciones;
    const porRecibir = abiertos().filter(puedoOperar);
    const porRevisar = rec.filter(r => r.doc_estado === 'pendiente');
    const porCorregir = vigentes().filter(r => r.estado === 'devuelta');
    const porFirmar = vigentes().filter(r => r.estado !== 'borrador' && r.firma_estado !== 'firmada');
    const porEnviar = vigentes().filter(r => r.estado !== 'borrador' && r.envio_estado === 'sin_enviar');
    const borradores = vigentes().filter(r => r.estado === 'borrador');
    const sinRemision = rec.filter(r => !remDe(r.id));
    const nombreProv = id => esc(provPor(id)?.nombre || '');
    const fila = (href, t, sub, chipHtml = '') => `<a class="fila" href="${href}"><div class="txt"><b>${t}</b><small>${sub}</small></div>${chipHtml}<span class="chev">${ic('chev')}</span></a>`;
    const seccion = (t, icono, items) => (items.length ? `<section class="tarjeta"><div class="titulo"><h2>${ic(icono)} ${t}</h2><span class="contador" aria-label="${items.length} pendientes">${items.length}</span></div>${items.join('')}</section>` : '');
    const hay = porRecibir.length + porRevisar.length + sinRemision.length + borradores.length + porCorregir.length + porFirmar.length + porEnviar.length;
    return `${S.me.rol === 'auxiliar' ? hero(`Hola, ${esc(S.me.nombre.split(' ')[0])}`, 'Esto es lo que falta por hacer hoy.') : hero('Pendientes', 'Todo lo que falta por recibir, revisar, corregir, firmar o enviar.')}
    <main class="contenido">
      ${seccion('Por recibir', 'camion', porRecibir.map(p => fila(`#/recepcion/${p.id}`, `Pedido #${p.id}`, `${nombreProv(p.proveedor_id)}${p.asignado_id === S.me.id ? ' · Asignado a ti' : ''} · ${fechaCorta(p.promesa || p.fecha_entrega)}`, chipEntrega(p.entrega))))}
      ${seccion('Por revisar documentos', 'lista', porRevisar.map(r => fila(`#/expediente/${r.id}`, `Folio ${esc(r.folio)}`, `Pedido #${r.pedido_id}`)))}
      ${seccion('Remisión por generar', 'hoja', [...sinRemision.map(r => fila(`#/expediente/${r.id}`, `Folio ${esc(r.folio)}`, `Pedido #${r.pedido_id}`)), ...borradores.map(r => fila(`#/remision/${r.id}`, esc(r.folio), 'Borrador por emitir'))])}
      ${seccion('Por corregir', 'alerta', porCorregir.map(r => fila(`#/remision/${r.id}`, esc(r.folio), `${nombreProv(r.proveedor_id)} · ${esc(r.devolucion?.motivo || '')}`)))}
      ${seccion('Por firmar', 'lapiz', porFirmar.map(r => fila(`#/remision/${r.id}`, esc(r.folio), nombreProv(r.proveedor_id), chipDe(FIRMA_ESTADO[r.firma_estado]))))}
      ${seccion('Por enviar', 'correo', porEnviar.map(r => fila(`#/remision/${r.id}`, esc(r.folio), nombreProv(r.proveedor_id))))}
      ${hay ? '' : `<section class="tarjeta"><p class="vacio">${ic('okc')} Todo al día. No hay nada pendiente.</p></section>`}
    </main>`;
  },

  nuevoPedido() {
    return `<main class="contenido sin-hero"><section class="tarjeta">${titulo('Nuevo pedido')}
      <label class="campo">Proveedor *<select id="np-prov" required><option value="">Elegir…</option>${S.proveedores.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('')}</select></label>
      <label class="campo">Fecha de entrega *<input id="np-fecha" type="date" value="${new Date(Date.now() + 864e5).toISOString().slice(0, 10)}"></label>
      <label class="campo">Asignar a <select id="np-aux"><option value="">Sin asignar</option>${S.auxiliares.map(a => `<option value="${a.id}">${esc(a.nombre)}</option>`).join('')}</select></label>
      ${editorFilas('np', [{ n: 'insumo', t: 'Insumo y presentación', opciones: activos().flatMap(i => [[i.id, `${i.nombre} (${i.unidad})`], ...presDe(i.id).map(p => [`${i.id}:${p.id}`, `${i.nombre} · ${p.nombre} de ${+p.contenido} ${i.unidad}`])]) }, { n: 'cantidad', t: 'Cantidad', num: 1 }, { n: 'precio', t: 'Precio por kg, L o unidad', num: 1 }])}
      <button class="btn" data-act="crearPedido">${ic('ok')} Crear pedido</button></section></main>`;
  },

  recepcion(id) {
    const p = S.pedidos.find(x => x.id === Number(id));
    if (!p) return noEncontrado('Pedido');
    const prov = provPor(p.proveedor_id);
    if (p.estado !== 'en_proceso') return `<main class="contenido sin-hero"><section class="tarjeta"><p class="vacio">Este pedido ya no tiene productos por recibir.</p><a class="btn borde" href="#/pedido/${p.id}">Ver pedido</a></section></main>`;
    if (!puedoOperar(p)) return `<main class="contenido sin-hero"><section class="tarjeta"><p class="vacio">Este pedido está asignado a otra persona.</p></section></main>`;
    const k = `rcp.${p.id}.`;
    return `<main class="contenido sin-hero">${pasos(1)}
      <section class="tarjeta"><div class="encabezado"><a href="#/pedido/${p.id}" aria-label="Volver" class="volver">${ic('atras')}</a><h2>Recibir pedido #${p.id}</h2>${chipEntrega(p.entrega)}</div>
        <p class="sub">${esc(prov.nombre)} · Entrega ${fechaCorta(p.promesa || p.fecha_entrega)}</p>
        <label class="campo">Folio de la nota o remisión del proveedor *<input data-draft="${k}folio" maxlength="40" autocomplete="off" value="${esc(val(`${k}folio`, ''))}"></label>
        <label class="check"><input type="checkbox" data-draft="${k}desinf" ${val(`${k}desinf`, false) ? 'checked' : ''}> Desinfección realizada</label></section>
      ${datosRecepcion(p).map(d => {
        const u = d.i.unidad, pre = `${k}${d.i.id}.`, en = d.l.factor ? `${esc(d.l.presentacion)} de ${+d.l.factor} ${esc(u)}` : esc(u);
        const opt = (v, t) => `<label class="seg-op"><input type="radio" name="${pre}dec" value="${v}" data-draft="${pre}dec" data-live="rcp" ${d.decision === v ? 'checked' : ''}><span>${t}</span></label>`;
        return `<section class="tarjeta linea-rec" data-pedido="${p.id}" data-insumo="${d.i.id}">
          <div class="insumo-c">${foto(d.i)}<div><b>${esc(d.i.nombre)}</b><br><small>Se esperan ${cant(d.esperada, u)}${d.l.factor ? ` (${+(d.esperada / d.l.factor).toFixed(2)} × ${esc(d.l.presentacion)})` : ''}${d.l.aceptado ? ` · ya entraron ${cant(d.l.aceptado, u)}` : ''}</small></div></div>
          <label class="campo">¿Cuánto llegó? (${en})<input class="grande" type="number" min="0" step="any" inputmode="decimal" data-draft="${pre}rec" data-live="rcp" value="${esc(d.recibido)}"></label>
          <div class="seg" role="radiogroup" aria-label="Decisión sobre ${esc(d.i.nombre)}">${opt('aceptar', 'Aceptar')}${opt('parcial', 'Parcial')}${opt('rechazar', 'Rechazar')}</div>
          <label class="campo cmp-par" ${d.decision === 'parcial' ? '' : 'hidden'}>¿Cuánto aceptas? (${en})<input class="grande" type="number" min="0" step="any" inputmode="decimal" data-draft="${pre}par" data-live="rcp" value="${esc(d.parcial)}"></label>
          <p class="msg-linea" role="status">${mensajeLinea(d.c, d.esperada, u)}</p>
          <div class="cmp-mot" ${d.c.rej > 0 ? '' : 'hidden'}>
            <label class="campo">Motivo del rechazo *<input maxlength="300" data-draft="${pre}mot" value="${esc(d.motivo)}"></label>
            <label class="check"><input type="checkbox" data-draft="${pre}dano" ${d.dano ? 'checked' : ''}> Es por daño del producto</label>
          </div>
          <details><summary>Agregar nota</summary><label class="campo">Nota<textarea rows="2" maxlength="500" data-draft="${pre}nota">${esc(d.nota)}</textarea></label></details>
        </section>`;
      }).join('')}
      <section class="tarjeta"><details><summary>Notas de la entrega</summary><label class="campo">Notas<textarea rows="2" maxlength="1000" data-draft="${k}notas">${esc(val(`${k}notas`, ''))}</textarea></label></details>
        <p class="sub">Las fotos, factura y XML se adjuntan en el siguiente paso.</p></section>
      <div class="pila">
        <button class="btn" data-act="confirmarRecepcion" data-id="${p.id}">${ic('ok')} Revisar y confirmar</button>
        <button class="btn borde" data-act="rechazarEntrega" data-id="${p.id}">${ic('x')} Rechazar toda la entrega</button>
      </div></main>`;
  },

  expediente(id) {
    const r = S.recepciones.find(x => x.id === Number(id));
    if (!r) return noEncontrado('Recepción');
    const p = S.pedidos.find(x => x.id === r.pedido_id), prov = provPor(p.proveedor_id), rem = remDe(r.id);
    const versiones = S.remisiones.filter(x => x.recepcion_id === r.id);
    const docs = S.documentos.filter(d => d.recepcion_id === r.id || d.pedido_id === r.pedido_id && !d.recepcion_id && !d.remision_id);
    const incs = S.incidencias.filter(i => i.recepcion_id === r.id);
    const devs = S.devoluciones.filter(d => d.pedido_id === r.pedido_id);
    const check = r.checklist || {};
    const paso = !rem ? 2 : rem.estado === 'borrador' ? 2 : rem.firma_estado !== 'firmada' ? 3 : 4;
    return `<main class="contenido sin-hero">${pasos(paso)}
      <section class="tarjeta"><div class="encabezado"><a href="#/pedido/${p.id}" aria-label="Volver" class="volver">${ic('atras')}</a><h2>Expediente de la entrega</h2></div>
        <dl class="datos">
          <div><dt>Proveedor</dt><dd><a class="enlace" href="#/proveedor/${prov.id}">${esc(prov.nombre)}</a></dd></div>
          <div><dt>Pedido</dt><dd><a class="enlace" href="#/pedido/${p.id}">#${p.id}</a></dd></div>
          <div><dt>Folio</dt><dd>${esc(r.folio)}</dd></div>
          <div><dt>Recibió</dt><dd>${esc(r.usuario)} · ${cuando(r.creado)}</dd></div>
        </dl>
        <ul class="estados">
          <li><small>Entrega</small>${chipEntrega(r.estado)}</li>
          <li><small>Documentos</small>${chipDe(DOC_ESTADO[r.doc_estado])}</li>
          <li><small>Firmas</small>${rem && rem.estado !== 'borrador' ? chipDe(FIRMA_ESTADO[rem.firma_estado]) : chipDe(['Sin remisión emitida', 'neutro', 'reloj'])}</li>
          <li><small>Envío</small>${rem && rem.estado !== 'borrador' ? chipDe(ENVIO_ESTADO[rem.envio_estado]) : chipDe(['Sin remisión emitida', 'neutro', 'reloj'])}</li>
        </ul>
        ${!rem ? `<button class="btn" data-act="generarRemision" data-id="${r.id}">${ic('hoja')} Generar remisión</button>` : `<a class="btn" href="#/remision/${rem.id}">${ic('hoja')} ${rem.estado === 'borrador' ? 'Revisar y emitir remisión' : rem.firma_estado !== 'firmada' ? 'Solicitar firmas' : 'Enviar remisión'}</a>`}
      </section>
      <section class="tarjeta"><div class="titulo"><h2>Productos</h2>${esAdmin() ? `<button class="ver" data-act="corregirRecepcion" data-id="${r.id}">${ic('lapiz')} Corregir cantidades</button>` : ''}</div>
        ${r.lineas.map(l => {
          const pend = Math.max(0, +(l.pendiente - l.ajuste).toFixed(3));
          return `<div class="prod"><b>${esc(l.insumo)}</b> <small>(${esc(l.unidad)})</small>
          ${nums([['Pedida', +l.pedida], ['Recibida', +(l.recibido + l.ajuste).toFixed(3)], ['Aceptada', +(l.aceptado + l.ajuste).toFixed(3), 'verde-t'], ['Rechazada', +l.rechazado, l.rechazado ? 'rojo-t' : ''], ['Pendiente', pend, pend ? 'rojo-t' : '']])}
          ${l.ajuste ? `<p class="mini-nota">Corregida. Se capturaron ${+l.aceptado} ${esc(l.unidad)} aceptados.</p>` : ''}
          ${l.motivo ? `<p class="mini-nota">Motivo de rechazo: ${esc(l.motivo)}</p>` : ''}${l.nota ? `<p class="mini-nota">Nota: ${esc(l.nota)}</p>` : ''}</div>`;
        }).join('')}
        ${r.correcciones.length ? `<h3>Correcciones</h3>${r.correcciones.map(c => `<div class="fila"><span class="burbuja">${ic('lapiz')}</span><div class="txt"><b>${c.lineas.map(l => `${esc(l.insumo)}: ${+l.antes} → ${+l.nuevo} ${esc(l.unidad)}`).join('; ')}</b>
          <small>${esc(c.motivo)} · ${esc(c.usuario)} · ${cuando(c.creado)}</small></div></div>`).join('')}` : ''}
        ${r.notas ? `<p class="mini-nota">Notas de la entrega: ${esc(r.notas)}</p>` : ''}</section>
      <section class="tarjeta"><div class="titulo"><h2>Incidencias</h2></div>
        ${incs.map(i => `<div class="fila"><span class="burbuja ${i.tipo === 'observacion' ? '' : 'rojo'}">${ic('alerta')}</span><div class="txt"><b>${TIPO_INC[i.tipo]}: ${esc(i.insumo)}${i.cantidad ? ` ${+i.cantidad} ${esc(i.unidad)}` : ''}</b>
          <small>${esc(i.motivo || i.nota || '')} · ${esc(i.usuario)} · ${i.estado === 'abierta' ? 'Abierta' : `Cerrada: ${esc(i.cierre_nota || '')}`}</small></div></div>`).join('') || '<p class="vacio">Sin incidencias.</p>'}
      </section>
      <section class="tarjeta"><div class="titulo"><h2>Evidencias y documentos</h2><span><button class="ver" data-act="adjuntar" data-recepcion="${r.id}" data-tipo="factura">${ic('mas')} Factura</button> <button class="ver" data-act="adjuntar" data-recepcion="${r.id}">${ic('mas')} Adjuntar</button></span></div>${listaDocs(docs)}</section>
      <section class="tarjeta">${titulo('Revisión de documentos')}
        <p class="nota-info">${ic('escudo')} <span><b>Revisión interna, no es validación fiscal.</b> La validación oficial del CFDI ante el SAT no está conectada. Para activarla se necesita un servicio de validación (PAC o SAT) y sus credenciales.</span></p>
        <button class="btn borde tinta" data-act="marcarChecklist" data-id="${r.id}">${ic('ok')} Marcar sin respuesta como Bien</button>
        ${CHECKLIST.map(([id_, t]) => {
          const v = val(`chk.${r.id}.${id_}`, check[id_] || '');
          const o = (x, e) => `<label class="seg-op"><input type="radio" name="chk.${r.id}.${id_}" value="${x}" data-draft="chk.${r.id}.${id_}" ${v === x ? 'checked' : ''}><span>${e}</span></label>`;
          return `<fieldset class="chk"><legend>${t}</legend><div class="seg">${o('ok', 'Bien')}${o('observacion', 'Observación')}${o('no_aplica', 'No aplica')}</div></fieldset>`;
        }).join('')}
        <label class="campo">Notas de la revisión<textarea rows="2" maxlength="1000" data-draft="chk.${r.id}.notas">${esc(val(`chk.${r.id}.notas`, r.checklist_notas || ''))}</textarea></label>
        <button class="btn" data-act="guardarChecklist" data-id="${r.id}">${ic('guardar')} Guardar revisión</button>
        ${r.revisor ? `<p class="sub">Última revisión: ${esc(r.revisor)}, ${cuando(r.revisado)}</p>` : ''}</section>
      ${versiones.length ? `<section class="tarjeta">${titulo('Remisiones')}${versiones.map(v => `<a class="fila" href="#/remision/${v.id}"><div class="txt"><b>${esc(v.folio)} · versión ${v.version}</b><small>${cuando(v.creado)}</small></div>${chipDe(REM_ESTADO[v.estado])}</a>`).join('')}</section>` : ''}
      <section class="tarjeta"><div class="titulo"><h2>Devoluciones de mercancía</h2></div>
        ${devs.map(d => `<div class="fila"><div class="txt"><b>Comprobante ${esc(d.comprobante)}</b><small>${d.lineas.map(l => `${esc(l.insumo)} ${+l.cantidad} ${esc(l.unidad)}: ${esc(l.motivo)}`).join('; ')} · ${esc(d.usuario)} · ${cuando(d.creado)}</small></div></div>`).join('') || '<p class="vacio">Sin devoluciones de mercancía.</p>'}
        <a class="btn borde" href="#/pedido/${p.id}">${ic('caja')} Ver pedido para devolver mercancía</a></section>
    </main>`;
  },

  remision(id) {
    const r = S.remisiones.find(x => x.id === Number(id));
    if (!r) return noEncontrado('Remisión');
    const prov = provPor(r.proveedor_id), abierta = ['emitida', 'devuelta'].includes(r.estado);
    const k = `rem.${r.id}.`;
    const anterior = r.anterior_id && S.remisiones.find(x => x.id === r.anterior_id);
    const posterior = S.remisiones.find(x => x.anterior_id === r.id);
    const docs = S.documentos.filter(d => d.remision_id === r.id);
    const digitos = (prov.telefono || (prov.tipo !== 'correo' ? prov.contacto : '')).replace(/\D/g, '');
    const correo = prov.correo || (prov.tipo === 'correo' ? prov.contacto : '');
    const asunto = `Remisión ${r.folio} versión ${r.version}${r.estado === 'devuelta' ? ' devuelta con observaciones' : ''}`;
    const cuerpo = `${asunto}. Pedido #${r.contenido.pedido}.${r.devolucion ? ` Motivo: ${r.devolucion.motivo}.` : ''} Adjunto el PDF.`;
    const firmaDe = papel => r.firmas.find(f => f.papel === papel);
    const tarjetaFirma = (papel, t) => {
      const f = firmaDe(papel);
      return `<div class="firma-caja"><b>${t}</b>
        ${f?.estado === 'firmada' ? `${firmaSvg(f)}<small>${esc(f.nombre)}, ${esc(f.funcion)}<br>${cuando(f.creado)}</small>`
          : `${f ? `<p class="mini-nota">No firmó: ${esc(f.motivo)}<br>${esc(f.nombre)}, ${cuando(f.creado)}</p>` : ''}${abierta ? `<button class="btn" data-act="firmar" data-id="${r.id}" data-papel="${papel}">${ic('lapiz')} Firma aquí</button>` : '<p class="mini-nota">Sin firma.</p>'}`}</div>`;
    };
    return `<main class="contenido sin-hero">${pasos(r.estado === 'borrador' ? 2 : r.firma_estado !== 'firmada' ? 3 : 4)}
      <section class="tarjeta"><div class="encabezado"><a href="#/expediente/${r.recepcion_id}" aria-label="Volver" class="volver">${ic('atras')}</a><h2>${esc(r.folio)}</h2>${chipDe(REM_ESTADO[r.estado])}</div>
        <ul class="estados">
          <li><small>Firmas</small>${chipDe(FIRMA_ESTADO[r.firma_estado])}</li>
          <li><small>Envío</small>${chipDe(ENVIO_ESTADO[r.envio_estado])}</li>
        </ul>
        ${posterior ? `<a class="btn borde" href="#/remision/${posterior.id}">Ver versión ${posterior.version}</a>` : ''}
        ${anterior ? `<a class="enlace" href="#/remision/${anterior.id}">Ver versión anterior (${anterior.version})</a>` : ''}
      </section>
      ${anterior ? `<section class="tarjeta">${titulo('Cambios frente a la versión anterior')}${diferencias(anterior, r).map(d => `<p class="mini-nota">${esc(d)}</p>`).join('') || '<p class="vacio">Sin cambios en el contenido.</p>'}</section>` : ''}
      ${r.estado === 'borrador' ? `<section class="tarjeta">${titulo('Revisar antes de emitir')}
        <p class="sub">Los datos vienen de la recepción. Solo agrega lo que haga falta.</p>
        <label class="campo">Lugar de entrega *<input maxlength="200" data-draft="${k}lugar" value="${esc(val(`${k}lugar`, r.contenido.lugar))}"></label>
        <details><summary>Notas</summary><label class="campo">Notas de la remisión<textarea rows="2" maxlength="1000" data-draft="${k}notas">${esc(val(`${k}notas`, r.contenido.notas))}</textarea></label>
        ${r.contenido.lineas.map(l => `<label class="campo">Nota de ${esc(l.insumo)}<input maxlength="500" data-draft="${k}n${l.insumo_id}" value="${esc(val(`${k}n${l.insumo_id}`, l.nota || ''))}"></label>`).join('')}</details>
        <div class="botones"><button class="btn borde" data-act="guardarBorrador" data-id="${r.id}">${ic('guardar')} Guardar borrador</button><button class="btn" data-act="emitirRemision" data-id="${r.id}">${ic('ok')} Emitir</button></div></section>` : ''}
      ${docRemision(r)}
      <div class="botones"><a class="btn borde" href="/api/remisiones/${r.id}/pdf" download>${ic('guardar')} Descargar PDF</a><a class="btn borde" href="/api/remisiones/${r.id}/pdf" target="_blank" rel="noopener">${ic('hoja')} Abrir para imprimir</a></div>
      ${r.estado === 'borrador' ? '' : `<section class="tarjeta">${titulo('Firmas')}
        ${abierta ? `<p class="sub">Antes de firmar, revisen el resumen de arriba.</p>` : ''}
        <div class="firmas">${tarjetaFirma('entrega', 'Quien entrega')}${tarjetaFirma('recibe', 'Quien recibe')}</div></section>`}
      ${abierta ? `<section class="tarjeta">${titulo('Enviar')}
        <p class="sub"><b>Destinatarios:</b> ${esc(prov.nombre)}${prov.contacto_nombre ? ` (${esc(prov.contacto_nombre)})` : ''}${digitos ? ` · ${esc(digitos)}` : ''}${correo ? ` · ${esc(correo)}` : ''}${prov.direccion_envio ? `<br><b>Enviar folio y factura a:</b> ${esc(prov.direccion_envio)}` : ''}<br><b>Responsable interno:</b> ${esc(S.responsables.join(', ') || 'Sin responsable')}</p>
        <p class="nota-info">${ic('alerta')} <span>El envío automático por correo o WhatsApp no está conectado. Al usarlos se abre tu aplicación con el mensaje; adjunta el PDF descargado. Se registra como compartida a mano, sin confirmación de entrega.</span></p>
        <div class="pila">
          ${S.con_portal.includes(r.proveedor_id) ? `<button class="btn" data-act="enviar" data-id="${r.id}" data-canal="portal">${ic('camion')} Publicar en el portal del proveedor</button>` : `<p class="sub">Este proveedor no tiene usuario en el portal.</p>`}
          ${digitos ? `<a class="btn borde" href="https://wa.me/${esc(digitos)}?text=${encodeURIComponent(cuerpo)}" target="_blank" rel="noopener noreferrer" data-act="enviar" data-id="${r.id}" data-canal="whatsapp" data-dest="${esc(digitos)}">${ic('coment')} Abrir WhatsApp</a>` : ''}
          ${correo ? `<a class="btn borde" href="mailto:${encodeURIComponent(correo)}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}" data-act="enviar" data-id="${r.id}" data-canal="correo" data-dest="${esc(correo)}">${ic('correo')} Abrir correo</a>` : ''}
          <button class="btn borde tinta" data-act="enviar" data-id="${r.id}" data-canal="interno">${ic('persona')} Avisar al responsable interno</button>
        </div>
        ${r.envios.map(e => `<div class="fila"><div class="txt"><b>${esc(e.canal)}: ${esc(e.destinatario)}</b><small>${esc(e.detalle)} · ${esc(e.usuario)} · ${cuando(e.creado)}</small></div>${e.resultado === 'error' ? chipDe(['Error', 'critico', 'x']) : e.resultado === 'publicada' ? chipDe(['Hecho', '', 'ok']) : chipDe(['Sin confirmar', 'bajo', 'alerta'])}</div>`).join('')}</section>` : ''}
      <section class="tarjeta"><div class="titulo"><h2>Evidencias de esta remisión</h2><button class="ver" data-act="adjuntar" data-remision="${r.id}">${ic('mas')} Adjuntar</button></div>${listaDocs(docs)}</section>
      ${abierta ? `<div class="pila">
        ${r.estado === 'emitida' ? `<button class="btn borde" data-act="devolverRemision" data-id="${r.id}">${ic('alerta')} Devolver con observaciones</button>` : ''}
        <button class="btn borde tinta" data-act="nuevaVersion" data-id="${r.id}">${ic('lapiz')} ${r.estado === 'devuelta' ? 'Registrar corrección (nueva versión)' : 'Cambiar contenido (nueva versión)'}</button>
        <p class="sub">Una versión nueva conserva esta tal como está y pide firmas otra vez. Las cantidades vienen de la recepción y no se cambian aquí. Ninguna de estas acciones modifica el inventario.</p></div>` : ''}
      <section class="tarjeta"><details><summary>Historial</summary>${r.historial.map(h => `<div class="fila"><div class="txt"><b>${esc(h.detalle)}</b><small>${esc(h.usuario)} · ${cuando(h.creado)}</small></div></div>`).join('') || '<p class="vacio">Sin historial.</p>'}</details></section>
    </main>`;
  },

  proveedor(id) {
    const p = provPor(Number(id));
    if (!p) return noEncontrado('Proveedor');
    const pedidos = S.pedidos.filter(x => x.proveedor_id === p.id);
    const ids = new Set(pedidos.map(x => x.id));
    const recs = S.recepciones.filter(r => ids.has(r.pedido_id));
    const rems = S.remisiones.filter(r => r.proveedor_id === p.id);
    const docs = S.documentos.filter(d => d.proveedor_id === p.id);
    const devs = S.devoluciones.filter(d => d.proveedor_id === p.id);
    const incs = S.incidencias.filter(i => i.proveedor_id === p.id && i.estado === 'abierta');
    const entradas = S.movimientos.filter(m => m.tipo === 'recepcion' && recs.some(r => m.ref === `recepcion:${r.id}`));
    const dato = (t, v) => `<div><dt>${t}</dt><dd>${v ? esc(v) : '<span class="sin">Sin capturar</span>'}</dd></div>`;
    return `<main class="contenido sin-hero">
      <section class="tarjeta"><div class="encabezado"><a href="#/proveedores" aria-label="Volver" class="volver">${ic('atras')}</a><h2>${esc(p.nombre)}</h2>${contacto(p)}</div>
        <dl class="datos">${dato('Contacto', p.contacto_nombre)}${dato('Teléfono', p.telefono)}${dato('Correo', p.correo)}${dato('Enviar folio y factura a', p.direccion_envio)}</dl>
        ${esAdmin() ? `<div class="botones"><button class="btn borde tinta" data-act="editarProveedor" data-id="${p.id}">${ic('lapiz')} Editar</button><a class="btn" href="#/nuevo-pedido">${ic('mas')} Nuevo pedido</a></div>` : ''}</section>
      <section class="tarjeta">${titulo('Datos fiscales')}<dl class="datos">${dato('Razón social', p.razon_social)}${dato('RFC', p.rfc)}${dato('Domicilio fiscal', p.domicilio_fiscal)}${dato('Código postal', p.cp)}${dato('Régimen fiscal', REGIMENES.find(r => r[0] === p.regimen_fiscal)?.[1] || p.regimen_fiscal)}</dl>
        <p class="sub">Capturados por El Mesón. No se validan contra el SAT.</p></section>
      ${incs.length ? `<section class="tarjeta">${titulo('Incidencias abiertas')}${incs.map(i => `<a class="fila" href="#/expediente/${i.recepcion_id}"><div class="txt"><b>${TIPO_INC[i.tipo]}: ${esc(i.insumo)} ${+i.cantidad} ${esc(i.unidad)}</b><small>Pedido #${i.pedido_id}</small></div><span class="chev">${ic('chev')}</span></a>`).join('')}</section>` : ''}
      <section class="tarjeta">${titulo(`Pedidos (${pedidos.length})`)}${pedidos.map(x => `<a class="fila" href="#/pedido/${x.id}"><div class="txt"><b>Pedido #${x.id}</b><small>${fechaCorta(x.fecha_entrega)}</small></div>${chipEntrega(x.entrega)}</a>`).join('') || '<p class="vacio">Sin pedidos.</p>'}</section>
      <section class="tarjeta">${titulo(`Entregas (${recs.length})`)}${recs.map(r => `<a class="fila" href="#/expediente/${r.id}"><div class="txt"><b>Folio ${esc(r.folio)}</b><small>Pedido #${r.pedido_id} · ${cuando(r.creado)}</small></div>${chipEntrega(r.estado)}</a>`).join('') || '<p class="vacio">Sin entregas.</p>'}</section>
      <section class="tarjeta">${titulo(`Remisiones (${rems.length})`)}${rems.map(r => `<a class="fila" href="#/remision/${r.id}"><div class="txt"><b>${esc(r.folio)} · versión ${r.version}</b><small>${cuando(r.creado)}</small></div>${chipDe(REM_ESTADO[r.estado])}</a>`).join('') || '<p class="vacio">Sin remisiones.</p>'}</section>
      <section class="tarjeta">${titulo(`Entradas de inventario recientes (${entradas.length})`)}${entradas.map(m => `<div class="fila"><div class="txt"><b>${esc(m.insumo)}</b><small>${esc(m.nota || '')} · ${cuando(m.creado)}</small></div><span class="verde-t">+${+m.delta} ${esc(m.unidad)}</span></div>`).join('') || '<p class="vacio">Sin entradas.</p>'}</section>
      <section class="tarjeta">${titulo(`Devoluciones (${devs.length})`)}${devs.map(d => `<a class="fila" href="#/pedido/${d.pedido_id}"><div class="txt"><b>Comprobante ${esc(d.comprobante)}</b><small>${d.lineas.map(l => `${esc(l.insumo)} ${+l.cantidad} ${esc(l.unidad)}`).join('; ')} · ${cuando(d.creado)}</small></div></a>`).join('') || '<p class="vacio">Sin devoluciones.</p>'}</section>
      <section class="tarjeta"><div class="titulo"><h2>Documentos (${docs.length})</h2><button class="ver" data-act="adjuntar" data-proveedor="${p.id}">${ic('mas')} Adjuntar</button></div>${listaDocs(docs)}</section>
    </main>`;
  },

  insumo(id) {
    const i = insumoPor(Number(id));
    if (!i) return noEncontrado('Insumo');
    const usan = S.recetas.filter(r => r.lineas.some(l => l.insumo_id === i.id));
    const movs = S.movimientos.filter(m => m.insumo_id === i.id);
    return `<main class="contenido sin-hero"><section class="tarjeta"><div class="encabezado"><a href="#/insumos" aria-label="Volver" class="volver">${ic('atras')}</a><h2>${esc(i.nombre)}</h2>${chip(estadoDe(i.stock, i.min))}</div>
        ${nums([['Existencia', cant(i.stock, i.unidad) + equivalente(i)], ['Merma', i.rendimiento === null ? 'Sin dato' : `${mermaDe(i.rendimiento)} %`], ['Aprovechable', i.aprovechable === null ? 'Sin dato' : cant(i.aprovechable, i.unidad)]])}
        ${i.rendimiento === null ? '<p class="sub">Captura la merma para calcular cuánto se aprovecha.</p>' : ''}
        <dl class="datos"><div><dt>Precio</dt><dd>${i.costo === null ? '<span class="sin">Sin capturar</span>' : `${dinero(i.costo)} por ${esc(i.unidad)}`}</dd></div></dl>
        <div class="botones"><button class="btn borde" data-act="registrarMerma" data-id="${i.id}">${ic('alerta')} Registrar merma</button>${esAdmin() ? `<button class="btn borde tinta" data-act="editarInsumo" data-id="${i.id}">${ic('lapiz')} Editar</button>` : ''}</div></section>
      <section class="tarjeta"><div class="titulo"><h2>Presentaciones de compra</h2>${esAdmin() ? `<button class="ver" data-act="agregarPresentacion" data-id="${i.id}">${ic('mas')} Agregar</button>` : ''}</div>
        <p class="sub">El inventario se guarda en ${esc(i.unidad)}. Al pedir o recibir en cajas o piezas se convierte solo.</p>
        ${S.presentaciones.filter(p => p.insumo_id === i.id).map(p => `<div class="fila"><div class="txt"><b>${esc(p.nombre)} = ${cant(p.contenido, i.unidad)}</b><small>${p.activo ? 'Vigente' : 'No vigente'}</small></div>
          ${esAdmin() ? `<button class="ver" data-act="alternarPresentacion" data-id="${p.id}" data-activo="${p.activo ? '' : '1'}">${p.activo ? 'Marcar no vigente' : 'Volver a usar'}</button>` : ''}</div>`).join('') || '<p class="vacio">Sin presentaciones: se pide y recibe en ' + esc(i.unidad) + '.</p>'}</section>
      <section class="tarjeta">${titulo('Recetas que lo usan')}${usan.map(r => {
        const l = r.lineas.find(x => x.insumo_id === i.id);
        return `<a class="fila" href="#/receta/${r.id}"><div class="txt"><b>${esc(r.nombre)}</b><small>Neto ${cant(l.neta, i.unidad)} · Bruto ${cant(l.bruta, i.unidad)} · ${FUENTE[l.fuente]}</small></div><span class="chev">${ic('chev')}</span></a>`;
      }).join('') || '<p class="vacio">Ninguna receta lo usa.</p>'}</section>
      <section class="tarjeta">${titulo('Movimientos recientes')}${movs.map(m => `<div class="fila"><div class="txt"><b>${esc(NOMBRE_MOV[m.tipo] || m.tipo)}</b><small>${esc(m.nota || '')} ${esc(m.usuario)} · ${cuando(m.creado)}</small></div><span class="${m.delta < 0 ? 'rojo-t' : 'verde-t'}">${m.delta > 0 ? '+' : ''}${+m.delta} ${esc(m.unidad)}</span></div>`).join('') || '<p class="vacio">Sin movimientos recientes.</p>'}</section></main>`;
  },

  rendimientos() {
    const fila = i => `<tr><td><b>${esc(i.nombre)}</b><br><small class="minmax">${esc(i.unidad)}</small></td>
      <td><input class="cant" type="number" min="0" max="99" step="any" inputmode="decimal" aria-label="Merma de ${esc(i.nombre)}" data-draft="ren.${i.id}.m" value="${esc(val(`ren.${i.id}.m`, mermaDe(i.rendimiento)))}"></td>
      <td><input class="cant" type="number" min="0" step="any" inputmode="decimal" aria-label="Precio de ${esc(i.nombre)}" data-draft="ren.${i.id}.c" value="${esc(val(`ren.${i.id}.c`, i.costo))}"></td></tr>`;
    return `<main class="contenido sin-hero"><section class="tarjeta"><div class="encabezado"><a href="#/inventario" aria-label="Volver" class="volver">${ic('atras')}</a><h2>Merma y precios</h2></div>
      <p class="sub">Merma: de cada 100 que compras, cuánto se pierde al limpiar. Si 10 kg de pollo dejan 6 kg limpios, escribe 40. Lo que dejes vacío queda sin capturar.</p></section>
      ${S.categorias.map(c => {
        const de = activos().filter(i => i.categoria_id === c.id);
        return de.length ? `<section class="tarjeta">${titulo(esc(c.nombre))}<table><thead><tr><th>Insumo</th><th>Merma %</th><th>Precio $</th></tr></thead><tbody>${de.map(fila).join('')}</tbody></table></section>` : '';
      }).join('')}
      <button class="btn" data-act="guardarRendimientos">${ic('guardar')} Guardar</button></main>`;
  },

  recetas() {
    return `${hero('Recetas', 'Consumo, merma prevista y costo de cada platillo.')}<main class="contenido">
      ${esAdmin() ? `<a class="btn" href="#/receta-editar">${ic('mas')} Agregar receta</a>` : ''}
      <section class="tarjeta">${titulo('Recetas')}${S.recetas.map(r => `<a class="fila" href="#/receta/${r.id}"><div class="txt"><b>${esc(r.nombre)}</b><small>${r.produce ? `Sub-receta: rinde ${+r.porciones} ${esc(r.produce_unidad)} de ${esc(r.produce)}` : `${+r.porciones} porciones`} · Costo ${r.costo_porcion === null ? 'sin dato' : `${dinero(r.costo_porcion)} por ${r.produce ? esc(r.produce_unidad) : 'porción'}`}${r.margen_pct === null ? '' : ` · Margen ${r.margen_pct} %`} · Alcanza para ${r.alcanza}</small></div><span class="chev">${ic('chev')}</span></a>`).join('') || `<p class="vacio">Aún no hay recetas registradas.${esAdmin() ? ' Agrega la primera con sus insumos y merma.' : ' Administración las da de alta.'}</p>`}</section></main>`;
  },

  receta(id) {
    const r = S.recetas.find(x => x.id === Number(id));
    if (!r) return noEncontrado('Receta');
    const colorM = r.margen === null ? '' : r.margen < 0 ? 'rojo-t' : 'verde-t';
    return `<main class="contenido sin-hero"><section class="tarjeta"><div class="encabezado"><a href="#/recetas" aria-label="Volver" class="volver">${ic('atras')}</a><h2>${esc(r.nombre)}</h2></div>
      ${r.produce ? `<p class="sub">Sub-receta: al producirla se suma a la existencia de <a class="enlace" href="#/insumo/${r.produce_insumo_id}">${esc(r.produce)}</a>, y los platillos la descuentan de ahí.</p>` : ''}
      ${nums([['Rinde', `${+r.porciones} ${r.produce ? esc(r.produce_unidad) : 'porciones'}`], ['Alcanza para', `${r.alcanza} ${r.produce ? esc(r.produce_unidad) : ''}`], ['Costo total', dinero(r.costo)], [`Costo por ${r.produce ? esc(r.produce_unidad) : 'porción'}`, dinero(r.costo_porcion)]])}
      ${r.produce ? '' : nums([['Precio de venta', dinero(r.precio_venta)], ['Margen por porción', dinero(r.margen), colorM], ['Margen', r.margen_pct === null ? 'Sin dato' : `${r.margen_pct} %`, colorM]])}
      ${!r.produce && r.precio_venta === null ? '<p class="sub">Captura el precio de venta para calcular el margen.</p>' : ''}
      ${r.sin_precio.length ? `<p class="sub">Falta el precio de: ${esc(r.sin_precio.join(', '))}. Sin él no se calcula el costo.</p>` : ''}
      ${r.notas ? `<p class="mini-nota">${esc(r.notas)}</p>` : ''}
      <div class="botones"><button class="btn" data-act="producir" data-id="${r.id}">${ic('ok')} Registrar producción</button>${esAdmin() ? `<a class="btn borde tinta" href="#/receta-editar/${r.id}">${ic('lapiz')} Editar</a>` : ''}</div></section>
      ${r.produce ? `<section class="tarjeta">${titulo('¿Para cuántos platillos sale?')}
        ${r.usos.map(u => `<div class="fila"><div class="txt"><a class="enlace" href="#/receta/${u.receta_id}"><b>${esc(u.receta)}</b></a><small>Usa ${+u.por_porcion} ${esc(r.produce_unidad)} por porción</small></div><b>Una tanda: ${u.por_tanda} porciones</b></div>`).join('') || `<p class="vacio">Ningún platillo usa ${esc(r.produce)} todavía. Agrégalo como insumo en la receta del platillo.</p>`}</section>` : ''}
      <section class="tarjeta">${titulo('Insumos')}
        <p class="nota-info">${ic('alerta')} <span>Si la receta define merma, se usa esa y no la merma del insumo: nunca se descuentan las dos.</span></p>
        ${r.lineas.map(l => `<div class="prod"><a class="enlace" href="#/insumo/${l.insumo_id}"><b>${esc(l.nombre)}</b></a> <small>(${esc(l.unidad)})</small>
          ${nums([['Neto', +l.neta], ['Merma prevista', +l.merma_prevista], ['A descontar', +l.bruta, 'verde-t'], ['Existencia', +l.stock]])}
          <p class="mini-nota">${FUENTE[l.fuente]}${l.fuente === 'receta' ? ` (${+l.merma} %)` : l.fuente === 'rendimiento' ? ` (${mermaDe(l.rendimiento)} %)` : ': se usa la cantidad neta'}</p></div>`).join('')}</section></main>`;
  },

  recetaEditar(id) {
    const r = id ? S.recetas.find(x => x.id === Number(id)) : {};
    if (!r) return noEncontrado('Receta');
    return `<main class="contenido sin-hero"><section class="tarjeta">${titulo(id ? 'Editar receta' : 'Agregar receta')}
      <label class="campo">Nombre *<input id="re-nombre" maxlength="80" value="${esc(r.nombre)}"></label>
      <label class="campo">¿Es una sub-receta? (la salsa, un fondo, una masa)<select id="re-produce"><option value="">No, es un platillo</option>${activos().map(i => `<option value="${i.id}" ${r.produce_insumo_id === i.id ? 'selected' : ''}>Sí, produce ${esc(i.nombre)} (${esc(i.unidad)})</option>`).join('')}</select></label>
      <p class="sub">Para una sub-receta, primero da de alta su insumo en Inventario (por ejemplo "Salsa verde", en L). Así se lleva su existencia y los platillos la usan como ingrediente.</p>
      <label class="campo">Rinde cuánto * (porciones; en una sub-receta, en la unidad de su insumo: 2 L)<input id="re-porciones" type="number" min="0" step="any" inputmode="decimal" value="${esc(r.porciones)}"></label>
      <label class="campo">Precio de venta por porción (solo platillos)<input id="re-precio" type="number" min="0" step="any" inputmode="decimal" value="${esc(r.precio_venta)}"></label>
      <p class="sub">Cantidad neta: lo que llega al platillo. Merma %: déjala vacía para usar la merma del insumo.</p>
      ${editorFilas('re', [{ n: 'insumo', t: 'Insumo', opciones: activos().map(i => [i.id, `${i.nombre} (${i.unidad})`]) }, { n: 'neta', t: 'Cantidad neta', num: 1 }, { n: 'merma', t: 'Merma %', num: 1 }], (r.lineas || []).map(l => ({ insumo: l.insumo_id, neta: l.neta, merma: l.merma })))}
      <details><summary>Notas</summary><label class="campo">Notas<textarea id="re-notas" rows="2" maxlength="1000">${esc(r.notas)}</textarea></label></details>
      <button class="btn" data-act="guardarReceta" data-id="${id || ''}">${ic('guardar')} Guardar receta</button></section></main>`;
  },

  provRemisiones() {
    return bandaProveedor('Remisiones que El Mesón te compartió.') + `<main class="contenido"><section class="tarjeta">${titulo('Remisiones')}
      ${S.remisiones.map(r => `<a class="fila" href="#/remision/${r.id}"><div class="txt"><b>${esc(r.folio)} · versión ${r.version}</b><small>Pedido #${r.contenido.pedido} · ${cuando(r.creado)}</small></div>${chipDe(REM_ESTADO[r.estado])}</a>`).join('') || '<p class="vacio">Aún no tienes remisiones compartidas.</p>'}</section></main>`;
  },

  provRemision(id) {
    const r = S.remisiones.find(x => x.id === Number(id));
    if (!r) return bandaProveedor('') + noEncontrado('Remisión');
    return bandaProveedor(`${r.folio}, versión ${r.version}`) + `<main class="contenido">
      ${docRemision(r)}
      <a class="btn borde" href="/api/remisiones/${r.id}/pdf" download>${ic('guardar')} Descargar PDF</a>
      ${r.estado === 'devuelta' ? `<div class="botones"><button class="btn" data-act="provCorregida" data-id="${r.id}">${ic('hoja')} Subir remisión corregida</button><button class="btn borde tinta" data-act="provCorregida" data-id="${r.id}" data-tipo="factura_corregida">${ic('hoja')} Subir factura corregida</button></div>` : ''}
      <section class="tarjeta">${titulo('Evidencias')}${listaDocs(r.documentos)}</section></main>`;
  },
});

const NOMBRE_MOV = { conteo: 'Conteo', recepcion: 'Entrada por recepción', devolucion: 'Devolución al proveedor', correccion_recepcion: 'Corrección de recepción',produccion: 'Consumo por producción', produccion_entrada: 'Entrada por producción (sub-receta)', merma_adicional: 'Merma adicional' };

function editorFilas(id, cols, filas = []) {
  const celda = (c, v = '') => (c.opciones
    ? `<label>${c.t}<select data-col="${c.n}"><option value="">Elegir…</option>${c.opciones.map(([x, t]) => `<option value="${x}" ${String(v) === String(x) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`
    : `<label>${c.t}<input data-col="${c.n}" type="number" min="0" step="any" inputmode="decimal" value="${esc(v)}"></label>`);
  const fila = f => `<div class="fila-ed">${cols.map(c => celda(c, f?.[c.n] ?? '')).join('')}<button type="button" class="quitar" data-act="quitarFila" aria-label="Quitar renglón">${ic('x')}</button></div>`;
  return `<div id="ed-${id}" class="editor">${(filas.length ? filas : [null]).map(fila).join('')}</div>
    <button type="button" class="btn borde tinta" data-act="agregarFila" data-editor="${id}">${ic('mas')} Agregar insumo</button><br>`;
}
const leerFilas = id => [...document.querySelectorAll(`#ed-${id} .fila-ed`)].map(f => Object.fromEntries([...f.querySelectorAll('[data-col]')].map(e => [e.dataset.col, e.value]))).filter(f => f.insumo);

function iniciarFirma(canvas) {
  const trazos = [];
  const ajustar = () => {
    const r = canvas.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    canvas.width = r.width * d; canvas.height = r.height * d;
    const c = canvas.getContext('2d');
    c.scale(d, d); c.lineWidth = 2; c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = '#1f1a17';
    return c;
  };
  const c = ajustar();
  const pos = e => {
    const r = canvas.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };
  let actual = null;
  canvas.onpointerdown = e => { canvas.setPointerCapture(e.pointerId); actual = [pos(e)]; trazos.push(actual); canvas.parentElement.classList.add('con-trazo'); };
  canvas.onpointermove = e => {
    if (!actual || actual.length >= 1500) return;
    const r = canvas.getBoundingClientRect(), a = actual[actual.length - 1], p = pos(e);
    c.beginPath(); c.moveTo(a[0] * r.width, a[1] * r.height); c.lineTo(p[0] * r.width, p[1] * r.height); c.stroke();
    actual.push(p);
  };
  canvas.onpointerup = canvas.onpointercancel = () => { actual = null; };
  return { trazos, limpiar() { trazos.length = 0; c.clearRect(0, 0, canvas.width, canvas.height); canvas.parentElement.classList.remove('con-trazo'); } };
}

Object.assign(acciones, {
  agregarFila({ editor }) {
    const cont = $(`#ed-${editor}`), nueva = cont.querySelector('.fila-ed').cloneNode(true);
    nueva.querySelectorAll('input').forEach(i => { i.value = ''; });
    nueva.querySelectorAll('select').forEach(s => { s.value = ''; });
    cont.append(nueva);
    nueva.querySelector('select').focus();
  },
  quitarFila(_, b) {
    const cont = b.closest('.editor');
    if (cont.children.length > 1) b.closest('.fila-ed').remove();
    else cont.querySelectorAll('input,select').forEach(e => { e.value = ''; });
  },
  async crearPedido() {
    const { id } = await api('/api/pedidos', { proveedor_id: $('#np-prov').value, fecha_entrega: $('#np-fecha').value, asignado_id: $('#np-aux').value, lineas: leerFilas('np').map(f => { const [insumo, presentacion] = f.insumo.split(':'); return { ...f, insumo, presentacion }; }) });
    avisar(`Pedido #${id} creado`);
    await refrescar();
    location.hash = `#/pedido/${id}`;
  },
  confirmarRecepcion({ id }) {
    const p = S.pedidos.find(x => x.id === Number(id)), k = `rcp.${p.id}.`;
    const ds = datosRecepcion(p);
    const sinMotivo = ds.find(d => d.c.rej > 0 && !String(d.motivo).trim());
    if (sinMotivo) throw new Error(`${sinMotivo.i.nombre}: escribe el motivo del rechazo`);
    if (ds.every(d => !d.c.rec)) throw new Error('Registra al menos una cantidad recibida');
    if (ds.some(d => d.c.acept > 0) && !String(val(`${k}folio`, '')).trim()) throw new Error('Escribe el folio de la nota o remisión del proveedor');
    draft[`${k}clave`] ||= clave();
    const resumen = titulo => (filas) => (filas.length ? `<h3 class="res-t">${titulo}</h3><ul class="res">${filas.join('')}</ul>` : '');
    const html = resumen('Entra al inventario')(ds.filter(d => d.c.acept > 0).map(d => `<li>${esc(d.i.nombre)}: <b>${cant(d.c.acept, d.i.unidad)}</b></li>`))
      + resumen('Rechazado, no entra')(ds.filter(d => d.c.rej > 0).map(d => `<li>${esc(d.i.nombre)}: <b>${cant(d.c.rej, d.i.unidad)}</b>. ${esc(d.motivo)}</li>`))
      + resumen('Faltante, queda pendiente')(ds.filter(d => d.c.falta > 0).map(d => `<li>${esc(d.i.nombre)}: <b>${cant(d.c.falta, d.i.unidad)}</b></li>`));
    formulario({
      titulo: 'Confirmar recepción', enviar: 'Confirmar', exito: 'Recepción registrada. Inventario actualizado con lo aceptado.',
      campos: [{ tipo: 'info', html }],
      alEnviar: async () => {
        const r = await api(`/api/pedidos/${p.id}/recepcion`, {
          clave: draft[`${k}clave`], folio: val(`${k}folio`, ''), desinfeccion: val(`${k}desinf`, false), notas: val(`${k}notas`, ''),
          lineas: ds.map(d => ({ insumo: d.i.id, recibido: String(d.c.rec), aceptado: String(d.c.acept), motivo: d.motivo, nota: d.nota, dano: d.dano })),
        });
        limpiar(k);
        location.hash = `#/expediente/${r.id}`;
      },
    });
  },
  rechazarEntrega({ id }) {
    const p = S.pedidos.find(x => x.id === Number(id)), k = `rcp.${p.id}.`;
    const ds = datosRecepcion(p);
    draft[`${k}clave`] ||= clave();
    formulario({
      titulo: 'Rechazar toda la entrega', enviar: 'Rechazar entrega', exito: 'Entrega rechazada. No entró nada al inventario.',
      campos: [{ tipo: 'info', html: `<p>Nada entrará al inventario. Los productos quedan pendientes de entrega.</p>` }, { nombre: 'motivo', etiqueta: 'Motivo *', tipo: 'area', req: 1 }, { nombre: 'dano', etiqueta: 'Es por daño del producto', tipo: 'check' }],
      alEnviar: async d => {
        const r = await api(`/api/pedidos/${p.id}/recepcion`, {
          clave: draft[`${k}clave`], folio: val(`${k}folio`, ''), notas: val(`${k}notas`, ''),
          lineas: ds.map(x => ({ insumo: x.i.id, recibido: String(x.c.rec || x.esperada), aceptado: '0', motivo: d.motivo, nota: x.nota, dano: d.dano })),
        });
        limpiar(k);
        location.hash = `#/expediente/${r.id}`;
      },
    });
  },
  adjuntar({ recepcion, remision, proveedor, pedido, tipo = 'evidencia' }) {
    const params = { ...(recepcion && { recepcion }), ...(remision && { remision }), ...(proveedor && { proveedor }), ...(pedido && { pedido }) };
    formulario({
      titulo: tipo === 'factura' ? 'Subir factura' : 'Adjuntar archivo', enviar: 'Subir', exito: 'Archivo guardado',
      campos: [{ nombre: 'tipo', etiqueta: 'Tipo', tipo: 'select', valor: tipo, opciones: Object.entries(TIPO_DOC) }, campoArchivo, { nombre: 'folio', etiqueta: 'Folio del documento', opcional: 1 }],
      alEnviar: d => subir(d.archivo, { ...params, tipo: d.tipo, folio: d.folio || '' }),
    });
  },
  marcarChecklist({ id }) {
    const r = S.recepciones.find(x => x.id === Number(id));
    CHECKLIST.forEach(([k]) => { if (!val(`chk.${id}.${k}`, r.checklist?.[k] || '')) draft[`chk.${id}.${k}`] = 'ok'; });
    render();
  },
  async guardarChecklist({ id }) {
    const items = Object.fromEntries(CHECKLIST.map(([k]) => [k, val(`chk.${id}.${k}`, S.recepciones.find(r => r.id === Number(id)).checklist?.[k] || '')]).filter(([, v]) => v));
    const r = S.recepciones.find(x => x.id === Number(id));
    await api(`/api/recepciones/${id}/checklist`, { items, notas: val(`chk.${id}.notas`, r.checklist_notas || '') });
    limpiar(`chk.${id}.`);
    const faltan = CHECKLIST.length - Object.keys(items).length;
    avisar(faltan ? `Revisión guardada. Faltan ${faltan} puntos.` : 'Revisión guardada');
    await refrescar();
  },
  async generarRemision({ id }) {
    const r = await api(`/api/recepciones/${id}/remision`, {});
    avisar('Borrador de remisión generado');
    await refrescar();
    location.hash = `#/remision/${r.id}`;
  },
  async guardarBorrador({ id }) {
    const r = S.remisiones.find(x => x.id === Number(id)), k = `rem.${id}.`;
    await guardarRemision(r, k);
    avisar('Borrador guardado');
    await refrescar();
  },
  async emitirRemision({ id }) {
    const r = S.remisiones.find(x => x.id === Number(id)), k = `rem.${id}.`;
    await guardarRemision(r, k);
    await api(`/api/remisiones/${id}/emitir`, {});
    avisar('Remisión emitida. Faltan firmas.');
    await refrescar();
  },
  firmar({ id, papel }) {
    const r = S.remisiones.find(x => x.id === Number(id));
    const previa = r.firmas.find(f => f.papel === papel);
    const c = r.contenido.lineas;
    const sum = campo => c.filter(l => l[campo] > 0);
    const res = (t, campo) => (sum(campo).length ? `<li><b>${t}:</b> ${sum(campo).map(l => `${esc(l.insumo)} ${+l[campo]} ${esc(l.unidad)}`).join(', ')}</li>` : '');
    const html = `<ul class="res">${res('Aceptado', 'aceptada')}${res('Rechazado', 'rechazada')}${res('Pendiente', 'pendiente')}
      ${r.contenido.devoluciones.length ? `<li><b>Devuelto:</b> ${r.contenido.devoluciones.map(d => `${esc(d.insumo)} ${+d.cantidad} ${esc(d.unidad)}`).join(', ')}</li>` : ''}
      ${r.devolucion ? `<li><b>Observaciones:</b> ${esc(r.devolucion.motivo)}</li>` : ''}</ul>`;
    formulario({
      titulo: papel === 'entrega' ? 'Firma de quien entrega' : 'Firma de quien recibe', enviar: 'Guardar', exito: 'Registrado en la remisión',
      campos: [{ tipo: 'info', html },
        { nombre: 'nombre', etiqueta: 'Nombre *', req: 1, valor: previa?.nombre || (papel === 'recibe' ? S.me.nombre : ''), extra: 'maxlength="80" autocomplete="off"' },
        { nombre: 'funcion', etiqueta: 'Función *', req: 1, valor: previa?.funcion || (papel === 'recibe' ? S.me.area : 'Repartidor') , extra: 'maxlength="80"' },
        { nombre: 'trazos', tipo: 'firma' },
        { nombre: 'no_firma', etiqueta: 'No puede o no desea firmar', tipo: 'check' },
        { nombre: 'motivo', etiqueta: 'Motivo (si no firma)', tipo: 'area' }],
      alEnviar: d => {
        if (d.no_firma && !d.motivo.trim()) throw new Error('Escribe por qué no firma');
        if (!d.no_firma && d.trazos.flat().length < 5) throw new Error('Firma aquí antes de guardar');
        return api(`/api/remisiones/${id}/firma`, { papel, nombre: d.nombre, funcion: d.funcion, ...(d.no_firma ? { no_firma: true, motivo: d.motivo } : { trazos: d.trazos }) });
      },
    });
  },
  async enviar({ id, canal, dest }) {
    const r = await api(`/api/remisiones/${id}/envio`, { canal, destinatario: dest });
    if (r.ok === false) avisar(r.error);
    else avisar(canal === 'portal' ? 'Publicada en el portal del proveedor' : canal === 'interno' ? 'Aviso registrado para el responsable interno' : 'Registrada como compartida a mano. Sin confirmación de entrega.');
    await refrescar();
  },
  devolverRemision({ id }) {
    const r = S.remisiones.find(x => x.id === Number(id));
    formulario({
      titulo: 'Devolver con observaciones', enviar: 'Devolver', exito: 'Remisión devuelta con observaciones. El inventario no cambió.',
      campos: [{ tipo: 'info', html: '<p>Se devuelve el documento para corregirlo. No cambia el inventario ni se pierde la versión original.</p>' },
        { nombre: 'tipo', etiqueta: 'Por qué se devuelve *', tipo: 'select', valor: 'faltante', opciones: [['faltante', 'Faltantes'], ['rechazo', 'Productos rechazados'], ['dano', 'Daños'], ['error_documento', 'Error en el documento']] },
        { nombre: 'motivo', etiqueta: 'Motivo *', tipo: 'area', req: 1 },
        { nombre: 'notas', etiqueta: 'Notas para el proveedor (vienen de la revisión; edítalas antes de enviar)', tipo: 'area', opcional: 1, valor: notasRevision(r) },
        ...r.contenido.lineas.map(l => ({ nombre: `n${l.insumo_id}`, etiqueta: `Nota de ${l.insumo}`, opcional: 1 })),
        { nombre: 'archivo', etiqueta: 'Foto o captura', tipo: 'file', opcional: 1 }],
      alEnviar: async d => {
        await api(`/api/remisiones/${id}/devolver`, { tipo: d.tipo, motivo: d.motivo, notas: d.notas, notas_linea: Object.fromEntries(r.contenido.lineas.map(l => [l.insumo_id, d[`n${l.insumo_id}`]])) });
        if (d.archivo) await subir(d.archivo, { remision: id, tipo: 'evidencia' });
      },
    });
  },
  nuevaVersion({ id }) {
    const r = S.remisiones.find(x => x.id === Number(id));
    formulario({
      titulo: 'Crear nueva versión', enviar: 'Crear versión', exito: 'Nueva versión creada. Revísala y emítela.',
      campos: [{ tipo: 'info', html: `<p>La versión ${r.version} se conserva. La nueva vuelve a pedir firmas.</p>` },
        { nombre: 'motivo', etiqueta: 'Qué cambió *', tipo: 'area', req: 1 },
        { nombre: 'archivo', etiqueta: 'Remisión corregida del proveedor', tipo: 'file', opcional: 1 }],
      alEnviar: async d => {
        const n = await api(`/api/remisiones/${id}/version`, { motivo: d.motivo });
        if (d.archivo) await subir(d.archivo, { remision: n.id, tipo: 'remision_corregida' });
        location.hash = `#/remision/${n.id}`;
      },
    });
  },
  agregarPresentacion({ id }) {
    const i = insumoPor(Number(id));
    formulario({
      titulo: `Presentación de ${esc(i.nombre)}`, enviar: 'Agregar', exito: 'Presentación agregada',
      campos: [{ tipo: 'info', html: `<p>Ejemplo: Caja = 10 ${esc(i.unidad)}. El contenido no se puede cambiar después; si cambia, agrega otra y marca esta como no vigente.</p>` },
        { nombre: 'nombre', etiqueta: 'Nombre (caja, cubeta, pieza…) *', req: 1, extra: 'maxlength="40"' },
        { nombre: 'contenido', etiqueta: `¿Cuántos ${esc(i.unidad)} trae? *`, tipo: 'number', req: 1 }],
      alEnviar: d => api(`/api/insumos/${i.id}/presentaciones`, d),
    });
  },
  async alternarPresentacion({ id, activo }) {
    await api(`/api/presentaciones/${id}`, { activo: !!activo }, 'PUT');
    avisar(activo ? 'Presentación vigente otra vez' : 'Presentación marcada como no vigente');
    await refrescar();
  },
  corregirRecepcion({ id }) {
    const r = S.recepciones.find(x => x.id === Number(id));
    const k = clave();
    formulario({
      titulo: `Corregir recepción ${esc(r.folio)}`, enviar: 'Guardar corrección', exito: 'Corrección registrada. El inventario se ajustó por la diferencia.',
      campos: [{ tipo: 'info', html: '<p>Escribe lo que de verdad llegó y se aceptó. La captura original se conserva y el inventario se ajusta solo por la diferencia. Si ya hay remisión emitida, se crea una versión nueva.</p>' },
        ...r.lineas.map(l => ({ nombre: `a${l.insumo_id}`, etiqueta: `${esc(l.insumo)}: aceptado (${esc(l.unidad)})`, tipo: 'number', valor: +(l.aceptado + l.ajuste).toFixed(3), req: 1 })),
        { nombre: 'motivo', etiqueta: 'Motivo de la corrección *', tipo: 'area', req: 1 }],
      alEnviar: d => api(`/api/recepciones/${id}/correccion`, { clave: k, motivo: d.motivo, lineas: r.lineas.map(l => ({ insumo: l.insumo_id, aceptado: d[`a${l.insumo_id}`] })) }),
    });
  },
  cerrarFaltante({ id, insumo }) {
    const i = insumoPor(Number(insumo));
    formulario({
      titulo: `Cerrar faltante de ${i.nombre}`, enviar: 'Cerrar faltante', exito: 'Faltante cerrado',
      campos: [{ tipo: 'info', html: '<p>Ya no se espera este producto. El inventario no cambia.</p>' }, { nombre: 'justificacion', etiqueta: 'Justificación *', tipo: 'area', req: 1 }],
      alEnviar: d => api(`/api/pedidos/${id}/faltantes/${insumo}/cerrar`, d),
    });
  },
  devolverMercancia({ id }) {
    const p = S.pedidos.find(x => x.id === Number(id));
    const disp = p.lineas.filter(l => l.aceptado - l.devuelto > 0);
    if (!disp.length) throw new Error('No hay mercancía aceptada para devolver. Lo rechazado nunca entró al inventario.');
    const k = clave();
    formulario({
      titulo: 'Devolver mercancía', enviar: 'Registrar devolución', exito: 'Devolución registrada. Se descontó solo lo devuelto.',
      campos: [{ tipo: 'info', html: '<p>Solo para mercancía que ya entró al inventario. Se descuenta de las existencias.</p>' },
        { nombre: 'comprobante', etiqueta: 'Folio del comprobante de devolución *', req: 1 },
        { nombre: 'motivo', etiqueta: 'Motivo *', tipo: 'area', req: 1 },
        ...disp.map(l => {
          const i = insumoPor(l.insumo_id);
          return { nombre: `c${i.id}`, etiqueta: `${i.nombre}: cantidad (máximo ${+(l.aceptado - l.devuelto).toFixed(3)} ${i.unidad})`, tipo: 'number' };
        }),
        { nombre: 'archivo', etiqueta: 'Foto del comprobante', tipo: 'file', opcional: 1 }],
      alEnviar: async d => {
        const r = await api(`/api/pedidos/${id}/devoluciones`, {
          clave: k, comprobante: d.comprobante, motivo: d.motivo,
          lineas: disp.map(l => ({ insumo: l.insumo_id, cantidad: d[`c${l.insumo_id}`] || 0 })),
        });
        if (d.archivo) await subir(d.archivo, { pedido: id, devolucion: r.id, tipo: 'comprobante_devolucion' });
      },
    });
  },
  gestionPedido({ id }) {
    const p = S.pedidos.find(x => x.id === Number(id));
    formulario({
      titulo: `Administrar pedido #${p.id}`, enviar: 'Guardar', exito: 'Pedido actualizado',
      campos: [{ nombre: 'asignado_id', etiqueta: 'Auxiliar asignado', tipo: 'select', valor: p.asignado_id, opciones: [['', 'Sin asignar'], ...S.auxiliares.map(a => [a.id, a.nombre])] },
        ...p.lineas.map(l => ({ nombre: `p${l.insumo_id}`, etiqueta: `Precio de ${insumoPor(l.insumo_id).nombre}`, tipo: 'number', valor: l.precio })) ],
      alEnviar: d => api(`/api/pedidos/${id}/gestion`, { asignado_id: d.asignado_id, precios: p.lineas.map(l => ({ insumo: l.insumo_id, precio: d[`p${l.insumo_id}`] })) }, 'PUT'),
    });
  },
  registrarMerma({ id }) {
    const i = insumoPor(Number(id));
    const k = clave();
    formulario({
      titulo: `Merma adicional de ${i.nombre}`, enviar: 'Registrar', exito: 'Merma registrada',
      campos: [{ tipo: 'info', html: '<p>Para pérdidas durante la operación, aparte de la merma ya prevista en las recetas.</p>' },
        { nombre: 'cantidad', etiqueta: `Cantidad (${i.unidad}, hay ${+i.stock}) *`, tipo: 'number', req: 1 }, { nombre: 'motivo', etiqueta: 'Motivo *', req: 1, extra: 'maxlength="300"' }],
      alEnviar: d => api('/api/mermas', { insumo: i.id, cantidad: d.cantidad, motivo: d.motivo, clave: k }),
    });
  },
  producir({ id }) {
    const r = S.recetas.find(x => x.id === Number(id));
    const k = clave();
    formulario({
      titulo: `Producir ${r.nombre}`, enviar: 'Registrar producción', exito: 'Producción registrada. Existencias actualizadas.',
      campos: [{ tipo: 'info', html: r.produce ? `<p>Se descuentan sus ingredientes y se suman a la existencia de ${esc(r.produce)}. Con lo que hay alcanza para ${r.alcanza} ${esc(r.produce_unidad)}.</p>` : `<p>Alcanza para ${r.alcanza} porciones con las existencias actuales.</p>` },
        { nombre: 'porciones', etiqueta: r.produce ? `Cantidad que vas a preparar (${esc(r.produce_unidad)}) *` : 'Porciones *', tipo: 'number', valor: r.porciones, req: 1 }],
      alEnviar: d => api(`/api/recetas/${id}/produccion`, { porciones: d.porciones, clave: k }),
    });
  },
  async guardarRendimientos() {
    await api('/api/insumos/datos', { lineas: activos().map(i => ({ insumo: i.id, rendimiento: rendDe(val(`ren.${i.id}.m`, mermaDe(i.rendimiento))), costo: val(`ren.${i.id}.c`, i.costo) })) });
    limpiar('ren.');
    avisar('Merma y precios guardados');
    await refrescar();
  },
  reintentar() {
    return arrancar();
  },
  async guardarReceta({ id }) {
    const cuerpo = { nombre: $('#re-nombre').value, porciones: $('#re-porciones').value, precio_venta: $('#re-precio').value, produce_insumo_id: $('#re-produce').value, notas: $('#re-notas').value, lineas: leerFilas('re') };
    const r = await (id ? api(`/api/recetas/${id}`, cuerpo, 'PUT') : api('/api/recetas', cuerpo));
    avisar('Receta guardada');
    await refrescar();
    location.hash = `#/receta/${id || r.id}`;
  },
  provCorregida({ id, tipo = 'remision_corregida' }) {
    const que = TIPO_DOC[tipo];
    formulario({
      titulo: `Subir ${que.toLowerCase()}`, enviar: 'Subir', exito: `${que} enviada a El Mesón`,
      campos: [campoArchivo, { nombre: 'folio', etiqueta: 'Folio del documento', opcional: 1 }],
      alEnviar: d => subir(d.archivo, { remision: id, tipo, folio: d.folio || '' }),
    });
  },
});

function guardarRemision(r, k) {
  return api(`/api/remisiones/${r.id}`, {
    lugar: val(`${k}lugar`, r.contenido.lugar), notas: val(`${k}notas`, r.contenido.notas),
    notas_linea: Object.fromEntries(r.contenido.lineas.map(l => [l.insumo_id, val(`${k}n${l.insumo_id}`, l.nota || '')])),
  }, 'PUT');
}

// Actualiza el mensaje de una línea sin redibujar, para no perder el foco al escribir.
document.addEventListener('input', e => {
  if (e.target.dataset.live !== 'rcp') return;
  const t = e.target.closest('.linea-rec');
  const p = S.pedidos.find(x => x.id === Number(t.dataset.pedido));
  const d = datosRecepcion(p).find(x => x.i.id === Number(t.dataset.insumo));
  $('.msg-linea', t).innerHTML = mensajeLinea(d.c, d.esperada, d.i.unidad);
  $('.cmp-par', t).hidden = d.decision !== 'parcial';
  $('.cmp-mot', t).hidden = d.c.rej <= 0;
});

// Enter pasa a la siguiente cantidad: captura rápida con el teclado numérico.
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !e.target.matches('#app input[type=number]')) return;
  e.preventDefault();
  const todos = [...document.querySelectorAll('#app input[type=number]')].filter(i => i.offsetParent);
  const siguiente = todos[todos.indexOf(e.target) + 1];
  if (siguiente) { siguiente.focus(); siguiente.select(); }
});

function pantallaSinRed() {
  document.body.className = '';
  app.innerHTML = `<header class="cabecera"><img src="/img/logo.png" alt="El Mesón"></header><main class="contenido sin-hero"><section class="tarjeta">
    <h2>No se pudo conectar</h2><p class="sub">El servidor de El Mesón no responde. Verifica que esté encendido y que estés en la misma red.</p>
    <button class="btn" data-act="reintentar">Intentar de nuevo</button></section></main>`;
}

const arrancar = () => refrescar().catch(() => { if (!S) pantallaSinRed(); });

// Trae cambios de otras personas sin interrumpir a quien está capturando.
async function actualizarEnSegundoPlano() {
  if (!S || document.hidden) return;
  const ocupado = $('#dialogo').open || $('details[open]') || document.activeElement?.matches('input, textarea, select');
  try {
    const nuevo = await api('/api/estado');
    $('#sin-red').hidden = true;
    if (S && !ocupado && JSON.stringify(nuevo) !== JSON.stringify(S)) {
      S = nuevo;
      render();
    }
  } catch {
    if (S) $('#sin-red').hidden = false;
  }
}
setInterval(actualizarEnSegundoPlano, 30000);
document.addEventListener('visibilitychange', actualizarEnSegundoPlano);
window.addEventListener('online', actualizarEnSegundoPlano);

arrancar();
