'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pdfRemision } = require('./pdf');

const CHECKLIST = ['proveedor', 'pedido', 'productos', 'cantidades', 'calidad', 'precios', 'importes', 'documento', 'datos_fiscales', 'folio', 'adjuntos'];
const TIPOS_DOC = ['factura', 'xml', 'pdf', 'nota_entrega', 'foto', 'captura', 'evidencia', 'comprobante_devolucion', 'remision_corregida'];
const TIPOS_OBS = { faltante: 'Faltantes', rechazo: 'Productos rechazados', dano: 'Daños', error_documento: 'Error en el documento' };
const MAX_ARCHIVO = 10 * 1024 * 1024;

// Se decide por el contenido del archivo, nunca por su extensión o el encabezado que manda el navegador.
function tipoReal(b) {
  if (b.subarray(0, 5).toString('latin1') === '%PDF-') return ['application/pdf', 'pdf'];
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return ['image/jpeg', 'jpg'];
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return ['image/png', 'png'];
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return ['image/webp', 'webp'];
  const inicio = b.subarray(0, 200).toString('utf8').replace(/^﻿/, '').trimStart();
  if (inicio.startsWith('<?xml')) return ['application/xml', 'xml'];
  return null;
}

// La merma de la receta sustituye al rendimiento del insumo: aplicar ambos descontaría la misma pérdida dos veces.
function calcularLinea(neta, merma, rendimiento) {
  let factor = 1, fuente = 'sin_dato';
  if (merma !== null && merma !== undefined) { factor = 1 - merma / 100; fuente = 'receta'; }
  else if (rendimiento !== null && rendimiento !== undefined) { factor = rendimiento / 100; fuente = 'rendimiento'; }
  const bruta = Math.round(neta / factor * 1000) / 1000;
  return { bruta, merma_prevista: Math.round((bruta - neta) * 1000) / 1000, fuente };
}

module.exports = function operacion(ctx) {
  const { q, uno, run, evento, moverStock, insumo, proveedorId, Falla, texto, opcional, numero, fecha, lineas, ahora, r3, dirArchivos } = ctx;

  const json = v => (v ? JSON.parse(v) : null);
  const clave = b => {
    if (b.clave === undefined) return null;
    if (typeof b.clave !== 'string' || !/^[\w-]{8,64}$/.test(b.clave)) throw new Falla(400, 'Clave de operación inválida');
    return b.clave;
  };
  const historial = (id, accion, detalle, me) => run('INSERT INTO remision_historial (remision_id, accion, detalle, usuario, creado) VALUES (?,?,?,?,?)', id, accion, detalle, me.nombre, ahora());

  function pedidoDe(id) {
    const p = uno('SELECT * FROM pedidos WHERE id = ?', Number(id));
    if (!p) throw new Falla(404, 'Pedido no encontrado');
    return p;
  }
  // Un auxiliar opera lo que tiene asignado y lo que nadie tiene asignado.
  function puedeOperar(p, me) {
    if (me.rol === 'auxiliar' && p.asignado_id && p.asignado_id !== me.id) throw new Falla(403, 'Este pedido está asignado a otra persona');
  }
  function recepcionDe(id, me) {
    const r = uno('SELECT * FROM recepciones WHERE id = ?', Number(id));
    if (!r) throw new Falla(404, 'Recepción no encontrada');
    puedeOperar(pedidoDe(r.pedido_id), me);
    return r;
  }
  function remisionDe(id, me) {
    const r = uno('SELECT * FROM remisiones WHERE id = ?', Number(id));
    if (!r) throw new Falla(404, 'Remisión no encontrada');
    puedeOperar(pedidoDe(r.pedido_id), me);
    return { ...r, contenido: json(r.contenido), devolucion: json(r.devolucion) };
  }

  const estadoEntrega = (p, ls, entregas) => {
    if (!entregas) return 'pendiente';
    if (!ls.some(l => l.aceptado > 0)) return 'rechazada';
    return ls.every(l => l.aceptado >= l.cantidad) ? 'aceptada' : 'recibida_parcial';
  };

  function cerrarSiCompleto(pedidoId, me) {
    const ls = q('SELECT * FROM pedido_lineas WHERE pedido_id = ?', pedidoId);
    if (!ls.every(l => l.cerrado || l.aceptado >= l.cantidad)) return;
    run('UPDATE pedidos SET estado = ?, receptor_id = COALESCE(receptor_id, ?), recibido = COALESCE(recibido, ?) WHERE id = ?',
      ls.every(l => l.aceptado >= l.cantidad) ? 'recibido' : 'diferencia', me.id, ahora(), pedidoId);
  }

  function incidencia(rec, p, i, tipo, cantidad, motivo, nota, me) {
    run(`INSERT INTO incidencias (recepcion_id, pedido_id, proveedor_id, insumo_id, tipo, cantidad, unidad, motivo, nota, usuario_id, creado)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`, rec, p.id, p.proveedor_id, i.id, tipo, cantidad, i.unidad, motivo, nota, me.id, ahora());
  }

  // Únicamente aquí entra mercancía por compra: lo aceptado de una recepción, una sola vez.
  function registrarRecepcion(b, me, idPedido) {
    const k = clave(b);
    if (k) {
      const previa = uno('SELECT id FROM recepciones WHERE clave = ?', k);
      if (previa) return { id: previa.id, repetida: true };
    }
    const p = pedidoDe(idPedido);
    puedeOperar(p, me);
    if (p.estado !== 'en_proceso') throw new Falla(409, 'Este pedido ya fue recibido');
    const entrada = new Map(lineas(b).map(l => [Number(l.insumo), l]));
    const ls = q('SELECT * FROM pedido_lineas WHERE pedido_id = ?', p.id);
    for (const id of entrada.keys()) {
      if (!ls.some(l => l.insumo_id === id)) throw new Falla(400, 'Hay un producto que no pertenece a este pedido');
    }
    const calculadas = ls.map(l => {
      const i = uno('SELECT * FROM insumos WHERE id = ?', l.insumo_id);
      const e = entrada.get(l.insumo_id) || { recibido: 0 };
      const esperada = l.cerrado ? 0 : r3(l.cantidad - l.aceptado);
      const recibido = r3(numero(e.recibido, i.nombre));
      const aceptado = e.aceptado === undefined ? recibido : r3(numero(e.aceptado, i.nombre));
      if (aceptado > recibido) throw new Falla(400, `${i.nombre}: no puedes aceptar más de lo que llegó`);
      if (aceptado > esperada) throw new Falla(400, `${i.nombre}: solo faltan ${esperada} ${i.unidad}. Rechaza el excedente.`);
      const rechazado = r3(recibido - aceptado);
      const motivo = opcional(e.motivo, 'el motivo', 300);
      if (rechazado > 0 && !motivo) throw new Falla(400, `${i.nombre}: escribe el motivo del rechazo`);
      return { l, i, esperada, recibido, aceptado, rechazado, motivo, nota: opcional(e.nota, 'la nota', 500), dano: !!e.dano };
    });
    if (!calculadas.some(c => c.recibido > 0)) throw new Falla(400, 'Registra al menos una cantidad recibida');
    const algoAceptado = calculadas.some(c => c.aceptado > 0);
    const folio = algoAceptado ? texto(b.folio, 'el folio de remisión', 40) : (opcional(b.folio, 'el folio', 40) || 'SIN-FOLIO');
    const pendienteTotal = calculadas.every(c => c.esperada - c.aceptado <= 0);
    const estado = !algoAceptado ? 'rechazada' : pendienteTotal ? 'aceptada' : 'recibida_parcial';

    const { lastInsertRowid } = run('INSERT INTO recepciones (pedido_id, folio, usuario_id, creado, desinfeccion, notas, estado, clave) VALUES (?,?,?,?,?,?,?,?)',
      p.id, folio, me.id, ahora(), b.desinfeccion ? 1 : 0, opcional(b.notas, 'las notas', 1000), estado, k);
    const rec = Number(lastInsertRowid);
    for (const c of calculadas) {
      const pendiente = r3(c.esperada - c.aceptado);
      run(`INSERT INTO recepcion_lineas (recepcion_id, insumo_id, unidad, pedida, esperada, recibido, aceptado, rechazado, pendiente, motivo, nota)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`, rec, c.i.id, c.i.unidad, c.l.cantidad, c.esperada, c.recibido, c.aceptado, c.rechazado, pendiente, c.motivo, c.nota);
      run('UPDATE pedido_lineas SET recibido = COALESCE(recibido, 0) + ?, aceptado = aceptado + ?, rechazado = rechazado + ? WHERE pedido_id = ? AND insumo_id = ?',
        c.recibido, c.aceptado, c.rechazado, p.id, c.i.id);
      if (c.aceptado > 0) moverStock(c.i, c.i.stock + c.aceptado, 'recepcion', me, { ref: `recepcion:${rec}`, nota: `Pedido #${p.id}, folio ${folio}` });
      if (c.rechazado > 0) incidencia(rec, p, c.i, c.dano ? 'dano' : 'rechazo', c.rechazado, c.motivo, c.nota, me);
      if (c.l.cerrado || !c.esperada) continue;
      // Cada recepción sustituye el faltante anterior del producto por el saldo actual.
      run("UPDATE incidencias SET estado = 'cerrada', cierre_nota = ?, cerrado = ? WHERE pedido_id = ? AND insumo_id = ? AND tipo = 'faltante' AND estado = 'abierta'",
        `Actualizado en la recepción ${rec}`, ahora(), p.id, c.i.id);
      const falta = r3(c.esperada - c.recibido);
      if (falta > 0) incidencia(rec, p, c.i, 'faltante', falta, null, c.nota, me);
      else if (c.nota && !c.rechazado) incidencia(rec, p, c.i, 'observacion', 0, null, c.nota, me);
    }
    run('UPDATE pedidos SET receptor_id = ?, recibido = ?, folio = ?, desinfeccion = ? WHERE id = ?', me.id, ahora(), folio, b.desinfeccion ? 1 : 0, p.id);
    cerrarSiCompleto(p.id, me);
    const texto_estado = { aceptada: 'Aceptada', recibida_parcial: 'Recibida parcialmente', rechazada: 'Rechazada' }[estado];
    evento('recepcion', `Recepción ${folio}`, `${texto_estado}, pedido #${p.id}`, `#/expediente/${rec}`);
    return { id: rec };
  }

  // Lo vigente de una línea es lo original más la suma de sus correcciones.
  const AJUSTE = `(SELECT COALESCE(SUM(cl.nuevo - cl.antes), 0) FROM correccion_lineas cl JOIN correcciones c ON c.id = cl.correccion_id
    WHERE c.recepcion_id = rl.recepcion_id AND cl.insumo_id = rl.insumo_id) ajuste`;

  // Corrige lo que llegó y se aceptó en una recepción capturada con error. El registro original no cambia.
  function corregirRecepcion(b, me, id) {
    const k = clave(b);
    if (k) {
      const previa = uno('SELECT id FROM correcciones WHERE clave = ?', k);
      if (previa) return { id: previa.id, repetida: true };
    }
    const rec = recepcionDe(id, me);
    const p = pedidoDe(rec.pedido_id);
    const motivo = texto(b.motivo, 'el motivo de la corrección', 300);
    const cambios = lineas(b).map(e => {
      const l = uno(`SELECT rl.*, ${AJUSTE} FROM recepcion_lineas rl WHERE rl.recepcion_id = ? AND rl.insumo_id = ?`, rec.id, Number(e.insumo));
      if (!l) throw new Falla(400, 'Hay un producto que no pertenece a esta recepción');
      const i = uno('SELECT * FROM insumos WHERE id = ?', l.insumo_id);
      const antes = r3(l.aceptado + l.ajuste), nuevo = r3(numero(e.aceptado, i.nombre));
      return { i, antes, nuevo, delta: r3(nuevo - antes) };
    }).filter(c => c.delta);
    if (!cambios.length) throw new Falla(400, 'No cambiaste ninguna cantidad');
    for (const { i, delta } of cambios) {
      const pl = uno('SELECT * FROM pedido_lineas WHERE pedido_id = ? AND insumo_id = ?', p.id, i.id);
      if (delta > 0 && r3(pl.aceptado + delta) > pl.cantidad) throw new Falla(400, `${i.nombre}: el pedido es de ${pl.cantidad} ${i.unidad} y ya hay ${pl.aceptado} aceptados en todas sus entregas`);
      if (delta < 0 && -delta > r3(pl.aceptado - pl.devuelto)) throw new Falla(400, `${i.nombre}: ya se devolvieron ${pl.devuelto} ${i.unidad} al proveedor; no puedes bajar más de ${r3(pl.aceptado - pl.devuelto)}`);
      if (delta < 0 && -delta > i.stock) throw new Falla(400, `${i.nombre}: solo hay ${i.stock} ${i.unidad} en existencia. Registra primero el conteo real.`);
    }
    const { lastInsertRowid } = run('INSERT INTO correcciones (recepcion_id, motivo, usuario_id, creado, clave) VALUES (?,?,?,?,?)', rec.id, motivo, me.id, ahora(), k);
    const cid = Number(lastInsertRowid);
    for (const c of cambios) {
      run('INSERT INTO correccion_lineas (correccion_id, insumo_id, antes, nuevo) VALUES (?,?,?,?)', cid, c.i.id, c.antes, c.nuevo);
      run('UPDATE pedido_lineas SET recibido = MAX(COALESCE(recibido, 0) + ?, 0), aceptado = aceptado + ? WHERE pedido_id = ? AND insumo_id = ?', c.delta, c.delta, p.id, c.i.id);
      moverStock(c.i, c.i.stock + c.delta, 'correccion_recepcion', me, { ref: `correccion:${cid}`, nota: `Folio ${rec.folio}: ${c.antes} → ${c.nuevo} ${c.i.unidad}. ${motivo}` });
      // El faltante abierto pasa a ser lo que el pedido aún espera de este producto.
      run("UPDATE incidencias SET estado = 'cerrada', cierre_nota = ?, cerrado = ? WHERE pedido_id = ? AND insumo_id = ? AND tipo = 'faltante' AND estado = 'abierta'",
        `Actualizado por la corrección ${cid}`, ahora(), p.id, c.i.id);
      const pl = uno('SELECT * FROM pedido_lineas WHERE pedido_id = ? AND insumo_id = ?', p.id, c.i.id);
      const falta = pl.cerrado ? 0 : r3(pl.cantidad - pl.aceptado);
      if (falta > 0) incidencia(rec.id, p, c.i, 'faltante', falta, null, `Corrección: ${motivo}`, me);
    }
    const abierto = q('SELECT * FROM pedido_lineas WHERE pedido_id = ?', p.id).some(l => !l.cerrado && l.aceptado < l.cantidad);
    if (abierto) run("UPDATE pedidos SET estado = 'en_proceso' WHERE id = ?", p.id);
    else cerrarSiCompleto(p.id, me);

    const vigente = uno("SELECT id, estado FROM remisiones WHERE recepcion_id = ? AND estado <> 'reemplazada'", rec.id);
    const motivoRem = `Corrección de cantidades: ${motivo}`;
    if (vigente?.estado === 'borrador') {
      const r = remisionDe(vigente.id, me);
      const notas_linea = Object.fromEntries(r.contenido.lineas.map(l => [l.insumo_id, l.nota]));
      run('UPDATE remisiones SET contenido = ? WHERE id = ?', JSON.stringify(contenidoRemision(rec, { lugar: r.contenido.lugar, notas: r.contenido.notas, notas_linea }, r.contenido.correccion)), r.id);
      historial(r.id, 'borrador', `Cantidades actualizadas. ${motivoRem}`, me);
    } else if (vigente) nuevaVersion(remisionDe(vigente.id, me), motivoRem, me);
    evento('alerta', `Recepción ${rec.folio} corregida`, `Corrigió ${me.nombre}: ${motivo}`, `#/expediente/${rec.id}`);
    return { id: cid };
  }

  function contenidoRemision(rec, datos, correccion) {
    const p = pedidoDe(rec.pedido_id);
    const prov = uno('SELECT nombre, razon_social, rfc FROM proveedores WHERE id = ?', p.proveedor_id);
    const notasLinea = datos.notas_linea || {};
    return {
      lugar: datos.lugar, notas: datos.notas || '', pedido: p.id, folio_entrega: rec.folio, fecha_recepcion: rec.creado,
      recibio: uno('SELECT nombre FROM usuarios WHERE id = ?', rec.usuario_id).nombre,
      proveedor: prov, correccion: correccion || null,
      lineas: q(`SELECT rl.*, ${AJUSTE}, i.nombre insumo, pl.precio FROM recepcion_lineas rl JOIN insumos i ON i.id = rl.insumo_id
        JOIN pedido_lineas pl ON pl.insumo_id = rl.insumo_id AND pl.pedido_id = ? WHERE rl.recepcion_id = ? ORDER BY i.nombre`, p.id, rec.id).map(l => ({
        insumo_id: l.insumo_id, insumo: l.insumo, unidad: l.unidad, pedida: l.pedida, recibida: r3(l.recibido + l.ajuste), aceptada: r3(l.aceptado + l.ajuste), rechazada: l.rechazado,
        pendiente: Math.max(0, r3(l.pendiente - l.ajuste)), motivo: l.motivo, nota: notasLinea[l.insumo_id] ?? l.nota, precio: l.precio,
      })),
      incidencias: q(`SELECT n.tipo, n.cantidad, n.unidad, n.motivo, n.nota, i.nombre insumo FROM incidencias n JOIN insumos i ON i.id = n.insumo_id
        WHERE n.recepcion_id = ? AND n.tipo <> 'observacion' ORDER BY n.id`, rec.id),
      devoluciones: q(`SELECT dl.cantidad, i.unidad, i.nombre insumo, dl.motivo, d.comprobante FROM devolucion_lineas dl JOIN devoluciones d ON d.id = dl.devolucion_id
        JOIN insumos i ON i.id = dl.insumo_id WHERE d.pedido_id = ? ORDER BY dl.devolucion_id`, p.id),
      evidencias: q('SELECT id, tipo, nombre FROM documentos WHERE recepcion_id = ? ORDER BY id', rec.id),
    };
  }

  function nuevaVersion(r, motivo, me) {
    const rec = uno('SELECT * FROM recepciones WHERE id = ?', r.recepcion_id);
    const contenido = contenidoRemision(rec, { lugar: r.contenido.lugar, notas: r.contenido.notas }, { version_anterior: r.version, motivo });
    run("UPDATE remisiones SET estado = 'reemplazada' WHERE id = ?", r.id);
    historial(r.id, 'reemplazada', `Se creó la versión ${r.version + 1}. Motivo: ${motivo}`, me);
    const { lastInsertRowid } = run(`INSERT INTO remisiones (folio, version, anterior_id, recepcion_id, pedido_id, proveedor_id, estado, contenido, creado, creado_por)
      VALUES (?,?,?,?,?,?,'borrador',?,?,?)`, r.folio, r.version + 1, r.id, r.recepcion_id, r.pedido_id, r.proveedor_id, JSON.stringify(contenido), ahora(), me.nombre);
    const id = Number(lastInsertRowid);
    historial(id, 'creada', `Versión ${r.version + 1} a partir de la versión ${r.version}. Motivo: ${motivo}`, me);
    evento('recepcion', `Remisión ${r.folio} v${r.version + 1}`, 'Borrador por revisar', `#/remision/${id}`);
    return { id };
  }

  const estadoFirmas = fs_ => {
    if (fs_.filter(f => f.estado === 'firmada').length === 2) return 'firmada';
    return fs_.some(f => f.estado === 'no_firmo') ? 'pendiente_con_motivo' : 'pendiente';
  };
  const estadoEnvio = es => {
    const validos = es.filter(e => e.resultado !== 'error' && e.canal !== 'interno');
    if (validos.some(e => e.resultado === 'publicada')) return 'publicada_portal';
    if (validos.some(e => e.resultado === 'compartida_manual')) return 'compartida_manual';
    return es.some(e => e.resultado === 'error') ? 'error' : 'sin_enviar';
  };

  function datosReceta(b) {
    const porciones = numero(b.porciones, 'Porciones');
    if (!porciones) throw new Falla(400, 'Las porciones deben ser mayores a cero');
    const ls = lineas(b).map(l => {
      const i = insumo(l.insumo), neta = numero(l.neta, i.nombre);
      if (!neta) throw new Falla(400, `${i.nombre}: la cantidad debe ser mayor a cero`);
      const merma = l.merma === '' || l.merma === null || l.merma === undefined ? null : numero(l.merma, `Merma de ${i.nombre}`);
      if (merma !== null && merma >= 100) throw new Falla(400, `${i.nombre}: la merma debe ser menor a 100 %`);
      return [i.id, neta, merma];
    });
    return { nombre: texto(b.nombre, 'el nombre', 80), porciones, notas: opcional(b.notas, 'las notas', 1000), ls };
  }

  function recetas() {
    return q('SELECT * FROM recetas ORDER BY nombre').map(r => {
      const ls = q(`SELECT rl.insumo_id, rl.neta, rl.merma, i.nombre, i.unidad, i.stock, i.rendimiento, i.costo FROM receta_lineas rl
        JOIN insumos i ON i.id = rl.insumo_id WHERE rl.receta_id = ? ORDER BY i.nombre`, r.id).map(l => ({ ...l, ...calcularLinea(l.neta, l.merma, l.rendimiento) }));
      const sinPrecio = ls.filter(l => l.costo === null).map(l => l.nombre);
      const costo = sinPrecio.length ? null : r3(ls.reduce((t, l) => t + l.bruta * l.costo, 0));
      const alcanza = ls.length ? Math.floor(Math.min(...ls.map(l => l.stock / (l.bruta / r.porciones)))) : 0;
      return { ...r, lineas: ls, costo, costo_porcion: costo === null ? null : r3(costo / r.porciones), sin_precio: sinPrecio, alcanza };
    });
  }

  function descargaDoc(d) {
    const buffer = fs.readFileSync(path.join(dirArchivos, d.archivo));
    return { binario: buffer, tipo: d.mime, nombre: d.nombre, enLinea: d.mime.startsWith('image/') };
  }

  function subirDocumento(cuerpo, params, me) {
    const tipo = params.get('tipo');
    if (!TIPOS_DOC.includes(tipo)) throw new Falla(400, 'Tipo de documento inválido');
    const real = tipoReal(cuerpo);
    if (!real) throw new Falla(415, 'Solo se aceptan PDF, XML, JPG, PNG o WEBP');
    const nombre = (params.get('nombre') || `archivo.${real[1]}`).replace(/[^\p{L}\p{N} ._()-]/gu, '_').slice(0, 120);
    const num = n => (params.get(n) ? Number(params.get(n)) : null);
    let pedido = num('pedido'), recepcion = num('recepcion'), remision = num('remision'), proveedor = null;
    if (remision) {
      const r = uno('SELECT * FROM remisiones WHERE id = ?', remision);
      if (!r) throw new Falla(404, 'Remisión no encontrada');
      pedido = r.pedido_id; recepcion = r.recepcion_id; proveedor = r.proveedor_id;
      if (me.rol === 'proveedor' && (r.proveedor_id !== me.proveedor_id || !r.compartida || tipo !== 'remision_corregida')) throw new Falla(403, 'Sin acceso');
    } else if (me.rol === 'proveedor') throw new Falla(403, 'Sin acceso');
    if (recepcion && !pedido) {
      const r = uno('SELECT pedido_id FROM recepciones WHERE id = ?', recepcion);
      if (!r) throw new Falla(404, 'Recepción no encontrada');
      pedido = r.pedido_id;
    }
    if (pedido) {
      const p = pedidoDe(pedido);
      if (me.rol !== 'proveedor') puedeOperar(p, me);
      proveedor = p.proveedor_id;
    } else if (num('proveedor')) {
      proveedor = proveedorId(num('proveedor'));
    }
    if (!proveedor) throw new Falla(400, 'El documento debe ligarse a un proveedor, pedido o recepción');
    const archivo = `${crypto.randomBytes(16).toString('hex')}.${real[1]}`;
    fs.writeFileSync(path.join(dirArchivos, archivo), cuerpo, { flag: 'wx' });
    try {
      const { lastInsertRowid } = run(`INSERT INTO documentos (tipo, nombre, mime, tam, archivo, folio, proveedor_id, pedido_id, recepcion_id, remision_id, devolucion_id, insumo_id, usuario, creado)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, tipo, nombre, real[0], cuerpo.length, archivo, (params.get('folio') || '').slice(0, 40) || null, proveedor, pedido, recepcion, remision, num('devolucion'), num('insumo'), me.nombre, ahora());
      if (remision) historial(remision, 'documento', `${me.rol === 'proveedor' ? 'El proveedor adjuntó' : 'Se adjuntó'} ${nombre}`, me);
      if (tipo === 'remision_corregida') evento('alerta', 'Remisión corregida recibida', `Adjuntó ${me.nombre}`, `#/remision/${remision}`);
      return { id: Number(lastInsertRowid) };
    } catch (e) {
      fs.rmSync(path.join(dirArchivos, archivo), { force: true });
      throw e;
    }
  }

  function estadoInterno(me) {
    const agrupar = (filas, llave) => filas.reduce((m, f) => ((m[f[llave]] ||= []).push(f), m), {});
    const lineasRec = agrupar(q(`SELECT rl.*, ${AJUSTE}, i.nombre insumo FROM recepcion_lineas rl JOIN insumos i ON i.id = rl.insumo_id ORDER BY i.nombre`), 'recepcion_id');
    const lineasCorr = agrupar(q('SELECT cl.*, i.nombre insumo, i.unidad FROM correccion_lineas cl JOIN insumos i ON i.id = cl.insumo_id ORDER BY i.nombre'), 'correccion_id');
    const corr = agrupar(q('SELECT c.*, u.nombre usuario FROM correcciones c JOIN usuarios u ON u.id = c.usuario_id ORDER BY c.id DESC')
      .map(c => ({ ...c, lineas: lineasCorr[c.id] || [] })), 'recepcion_id');
    const firmas = agrupar(q('SELECT * FROM firmas').map(f => ({ ...f, trazos: json(f.trazos) })), 'remision_id');
    const envios = agrupar(q('SELECT * FROM envios ORDER BY id DESC'), 'remision_id');
    const hist = agrupar(q('SELECT * FROM remision_historial ORDER BY id DESC'), 'remision_id');
    const lineasDev = agrupar(q('SELECT dl.*, i.nombre insumo, i.unidad FROM devolucion_lineas dl JOIN insumos i ON i.id = dl.insumo_id'), 'devolucion_id');
    return {
      recepciones: q('SELECT r.*, u.nombre usuario FROM recepciones r JOIN usuarios u ON u.id = r.usuario_id ORDER BY r.id DESC').map(r => ({
        ...r, checklist: json(r.checklist), lineas: lineasRec[r.id] || [], correcciones: corr[r.id] || [],
      })),
      remisiones: q('SELECT * FROM remisiones ORDER BY id DESC').map(r => ({
        ...r, contenido: json(r.contenido), devolucion: json(r.devolucion), firmas: firmas[r.id] || [], envios: envios[r.id] || [], historial: hist[r.id] || [],
        firma_estado: estadoFirmas(firmas[r.id] || []), envio_estado: estadoEnvio(envios[r.id] || []),
      })),
      documentos: q('SELECT id, tipo, nombre, mime, tam, folio, proveedor_id, pedido_id, recepcion_id, remision_id, devolucion_id, insumo_id, usuario, creado FROM documentos ORDER BY id DESC'),
      incidencias: q(`SELECT n.*, i.nombre insumo, u.nombre usuario FROM incidencias n JOIN insumos i ON i.id = n.insumo_id JOIN usuarios u ON u.id = n.usuario_id ORDER BY n.id DESC`),
      devoluciones: q('SELECT d.*, u.nombre usuario FROM devoluciones d JOIN usuarios u ON u.id = d.usuario_id ORDER BY d.id DESC').map(d => ({ ...d, lineas: lineasDev[d.id] || [] })),
      recetas: recetas(),
      producciones: q(`SELECT p.*, r.nombre receta, u.nombre usuario FROM producciones p JOIN recetas r ON r.id = p.receta_id JOIN usuarios u ON u.id = p.usuario_id ORDER BY p.id DESC LIMIT 30`),
      merma: q(`SELECT i.id insumo_id, i.nombre, i.unidad,
        COALESCE((SELECT SUM(pl.merma_prevista) FROM produccion_lineas pl JOIN producciones p ON p.id = pl.produccion_id WHERE pl.insumo_id = i.id AND p.creado >= ?1), 0) prevista,
        COALESCE((SELECT -SUM(m.delta) FROM movimientos m WHERE m.insumo_id = i.id AND m.tipo = 'merma_adicional' AND m.creado >= ?1), 0) adicional
        FROM insumos i ORDER BY i.nombre`, new Date(Date.now() - 30 * 864e5).toISOString()).filter(m => m.prevista || m.adicional),
      responsables: q("SELECT nombre FROM usuarios WHERE rol = 'admin' AND activo = 1 ORDER BY nombre").map(u => u.nombre),
      auxiliares: q("SELECT id, nombre FROM usuarios WHERE rol = 'auxiliar' AND activo = 1 ORDER BY nombre"),
      con_portal: q("SELECT DISTINCT proveedor_id FROM usuarios WHERE rol = 'proveedor' AND activo = 1").map(u => u.proveedor_id),
    };
  }

  // Al proveedor solo llega lo que se le compartió: nada de checklist interno, otros proveedores ni bitácora.
  function estadoProveedor(me) {
    return {
      remisiones: q('SELECT id, folio, version, estado, contenido, devolucion, creado FROM remisiones WHERE proveedor_id = ? AND compartida = 1 ORDER BY id DESC', me.proveedor_id)
        .map(r => ({
          ...r, contenido: json(r.contenido), devolucion: json(r.devolucion),
          documentos: q('SELECT id, tipo, nombre FROM documentos WHERE remision_id = ? OR recepcion_id = (SELECT recepcion_id FROM remisiones WHERE id = ?) ORDER BY id', r.id, r.id),
        })),
    };
  }

  const rutas = [
    ['POST', /^\/api\/pedidos$/, (b, me) => {
      const prov = proveedorId(b.proveedor_id);
      if (!prov) throw new Falla(400, 'Elige un proveedor');
      const entrega = fecha(b.fecha_entrega);
      const ls = lineas(b).map(l => {
        const i = insumo(l.insumo), n = numero(l.cantidad, i.nombre);
        if (!n) throw new Falla(400, `${i.nombre}: la cantidad debe ser mayor a cero`);
        // Con presentación, la cantidad viene en cajas o piezas y se guarda convertida a la unidad del insumo.
        const pres = l.presentacion ? uno('SELECT * FROM presentaciones WHERE id = ? AND insumo_id = ? AND activo = 1', Number(l.presentacion), i.id) : null;
        if (l.presentacion && !pres) throw new Falla(400, `${i.nombre}: la presentación no existe o ya no está vigente`);
        const precio = l.precio === '' || l.precio === undefined || l.precio === null ? i.costo : numero(l.precio, `Precio de ${i.nombre}`);
        return [i.id, pres ? r3(n * pres.contenido) : n, precio, pres?.nombre ?? null, pres?.contenido ?? null];
      });
      const asignado = b.asignado_id ? Number(b.asignado_id) : null;
      if (asignado && !uno("SELECT 1 FROM usuarios WHERE id = ? AND rol = 'auxiliar' AND activo = 1", asignado)) throw new Falla(400, 'Auxiliar no encontrado');
      const { lastInsertRowid } = run('INSERT INTO pedidos (proveedor_id, creado, fecha_entrega, asignado_id) VALUES (?,?,?,?)', prov, ahora(), entrega, asignado);
      const id = Number(lastInsertRowid);
      ls.forEach(l => run('INSERT INTO pedido_lineas (pedido_id, insumo_id, cantidad, precio, presentacion, factor) VALUES (?,?,?,?,?,?)', id, ...l));
      evento('pedido', `Pedido #${id}`, 'En proceso', `#/pedido/${id}`);
      return { id };
    }, 'admin'],
    ['PUT', /^\/api\/pedidos\/(\d+)\/gestion$/, (b, me, [id]) => {
      const p = pedidoDe(id);
      if (b.asignado_id !== undefined) {
        const a = b.asignado_id ? Number(b.asignado_id) : null;
        if (a && !uno("SELECT 1 FROM usuarios WHERE id = ? AND rol = 'auxiliar' AND activo = 1", a)) throw new Falla(400, 'Auxiliar no encontrado');
        run('UPDATE pedidos SET asignado_id = ? WHERE id = ?', a, p.id);
      }
      for (const l of b.precios || []) {
        run('UPDATE pedido_lineas SET precio = ? WHERE pedido_id = ? AND insumo_id = ?', l.precio === '' ? null : numero(l.precio, 'Precio'), p.id, Number(l.insumo));
      }
    }, 'admin'],

    ['POST', /^\/api\/pedidos\/(\d+)\/recepcion$/, (b, me, [id]) => registrarRecepcion(b, me, id)],
    ['POST', /^\/api\/recepciones\/(\d+)\/correccion$/, (b, me, [id]) => corregirRecepcion(b, me, id), 'admin'],
    ['POST', /^\/api\/pedidos\/(\d+)\/faltantes\/(\d+)\/cerrar$/, (b, me, [id, insumoId]) => {
      const p = pedidoDe(id);
      puedeOperar(p, me);
      const motivo = texto(b.justificacion, 'la justificación', 500);
      const l = uno('SELECT * FROM pedido_lineas WHERE pedido_id = ? AND insumo_id = ?', p.id, Number(insumoId));
      if (!l) throw new Falla(404, 'Producto no encontrado en el pedido');
      if (l.cerrado || l.aceptado >= l.cantidad) throw new Falla(409, 'Este producto no tiene pendientes');
      run('UPDATE pedido_lineas SET cerrado = 1, cierre_motivo = ? WHERE pedido_id = ? AND insumo_id = ?', motivo, p.id, l.insumo_id);
      run("UPDATE incidencias SET estado = 'cerrada', cierre_nota = ?, cerrado = ? WHERE pedido_id = ? AND insumo_id = ? AND tipo = 'faltante' AND estado = 'abierta'", motivo, ahora(), p.id, l.insumo_id);
      evento('alerta', `Faltante cerrado en pedido #${p.id}`, `Cerró ${me.nombre}: ${motivo}`, `#/pedido/${p.id}`);
      cerrarSiCompleto(p.id, me);
    }],
    // Devolución física: solo sale lo que realmente entró y aún no se devolvió.
    ['POST', /^\/api\/pedidos\/(\d+)\/devoluciones$/, (b, me, [id]) => {
      const k = clave(b);
      if (k) {
        const previa = uno('SELECT id FROM devoluciones WHERE clave = ?', k);
        if (previa) return { id: previa.id, repetida: true };
      }
      const p = pedidoDe(id);
      puedeOperar(p, me);
      const comprobante = texto(b.comprobante, 'el comprobante de devolución', 60);
      const motivoGeneral = opcional(b.motivo, 'el motivo', 300);
      const ls = lineas(b).filter(l => Number(l.cantidad) > 0);
      if (!ls.length) throw new Falla(400, 'Escribe la cantidad a devolver de al menos un producto');
      const { lastInsertRowid } = run('INSERT INTO devoluciones (pedido_id, proveedor_id, recepcion_id, comprobante, motivo, usuario_id, creado, clave) VALUES (?,?,?,?,?,?,?,?)',
        p.id, p.proveedor_id, b.recepcion_id ? Number(b.recepcion_id) : null, comprobante, motivoGeneral, me.id, ahora(), k);
      const dev = Number(lastInsertRowid);
      for (const l of ls) {
        const i = insumo(l.insumo), cantidad = r3(numero(l.cantidad, i.nombre));
        const pl = uno('SELECT * FROM pedido_lineas WHERE pedido_id = ? AND insumo_id = ?', p.id, i.id);
        if (!pl) throw new Falla(400, `${i.nombre} no pertenece a este pedido`);
        const disponible = r3(pl.aceptado - pl.devuelto);
        if (cantidad > disponible) throw new Falla(400, `${i.nombre}: solo se pueden devolver ${disponible} ${i.unidad} aceptados. Lo rechazado nunca entró al inventario.`);
        if (cantidad > i.stock) throw new Falla(400, `${i.nombre}: solo hay ${i.stock} ${i.unidad} en existencia`);
        const motivo = opcional(l.motivo, 'el motivo', 300) || motivoGeneral;
        if (!motivo) throw new Falla(400, `${i.nombre}: escribe el motivo de la devolución`);
        run('INSERT INTO devolucion_lineas (devolucion_id, insumo_id, cantidad, motivo) VALUES (?,?,?,?)', dev, i.id, cantidad, motivo);
        run('UPDATE pedido_lineas SET devuelto = devuelto + ? WHERE pedido_id = ? AND insumo_id = ?', cantidad, p.id, i.id);
        moverStock(i, i.stock - cantidad, 'devolucion', me, { ref: `devolucion:${dev}`, nota: `Pedido #${p.id}, comprobante ${comprobante}` });
      }
      evento('alerta', `Devolución de mercancía, pedido #${p.id}`, `Registró ${me.nombre}. Comprobante ${comprobante}`, `#/pedido/${p.id}`);
      return { id: dev };
    }],

    ['POST', /^\/api\/recepciones\/(\d+)\/checklist$/, (b, me, [id]) => {
      const r = recepcionDe(id, me);
      const items = {};
      for (const k of CHECKLIST) {
        const v = b.items?.[k];
        if (v !== undefined && v !== '' && !['ok', 'observacion', 'no_aplica'].includes(v)) throw new Falla(400, 'Respuesta de checklist inválida');
        if (v) items[k] = v;
      }
      const completo = CHECKLIST.every(k => items[k]);
      const conObs = Object.values(items).includes('observacion');
      const notas = opcional(b.notas, 'las notas', 1000);
      if (conObs && !notas) throw new Falla(400, 'Describe las observaciones en las notas');
      run('UPDATE recepciones SET checklist = ?, checklist_notas = ?, doc_estado = ?, revisor = ?, revisado = ? WHERE id = ?',
        JSON.stringify(items), notas, !completo ? 'pendiente' : conObs ? 'con_observaciones' : 'revisada', me.nombre, ahora(), r.id);
    }],

    ['POST', /^\/api\/recepciones\/(\d+)\/remision$/, (b, me, [id]) => {
      const rec = recepcionDe(id, me);
      const previa = uno("SELECT id FROM remisiones WHERE recepcion_id = ? AND estado <> 'reemplazada'", rec.id);
      if (previa) return { id: previa.id, repetida: true };
      const contenido = contenidoRemision(rec, { lugar: opcional(b.lugar, 'el lugar', 200) || process.env.LUGAR_ENTREGA || 'El Mesón', notas: rec.notas || '' });
      const p = pedidoDe(rec.pedido_id);
      const { lastInsertRowid } = run(`INSERT INTO remisiones (folio, version, recepcion_id, pedido_id, proveedor_id, estado, contenido, creado, creado_por)
        VALUES (?,1,?,?,?,'borrador',?,?,?)`, `TEMP-${crypto.randomBytes(6).toString('hex')}`, rec.id, p.id, p.proveedor_id, JSON.stringify(contenido), ahora(), me.nombre);
      const nuevo = Number(lastInsertRowid);
      const folio = `REM-${String(nuevo).padStart(5, '0')}`;
      run('UPDATE remisiones SET folio = ? WHERE id = ?', folio, nuevo);
      historial(nuevo, 'creada', 'Borrador generado desde la recepción', me);
      return { id: nuevo };
    }],
    ['PUT', /^\/api\/remisiones\/(\d+)$/, (b, me, [id]) => {
      const r = remisionDe(id, me);
      if (r.estado !== 'borrador') throw new Falla(409, 'Solo se edita un borrador. Crea una nueva versión para cambiarla.');
      const notasLinea = {};
      for (const [k, v] of Object.entries(b.notas_linea || {})) notasLinea[Number(k)] = opcional(v, 'la nota', 500);
      const rec = uno('SELECT * FROM recepciones WHERE id = ?', r.recepcion_id);
      const contenido = contenidoRemision(rec, { lugar: texto(b.lugar, 'el lugar de entrega', 200), notas: opcional(b.notas, 'las notas', 1000), notas_linea: notasLinea }, r.contenido.correccion);
      run('UPDATE remisiones SET contenido = ? WHERE id = ?', JSON.stringify(contenido), r.id);
      historial(r.id, 'borrador', 'Borrador guardado', me);
    }],
    ['POST', /^\/api\/remisiones\/(\d+)\/emitir$/, (b, me, [id]) => {
      const r = remisionDe(id, me);
      if (r.estado !== 'borrador') throw new Falla(409, 'Esta remisión ya fue emitida');
      run("UPDATE remisiones SET estado = 'emitida' WHERE id = ?", r.id);
      historial(r.id, 'emitida', 'Remisión emitida', me);
      if (r.anterior_id) {
        run("UPDATE remisiones SET obs_resueltas = 1 WHERE id = ? AND devolucion IS NOT NULL", r.anterior_id);
        historial(r.anterior_id, 'resuelta', `Observaciones resueltas con la versión ${r.version}`, me);
      }
      evento('recepcion', `Remisión ${r.folio}${r.version > 1 ? ` v${r.version}` : ''}`, 'Emitida. Falta firmar', `#/remision/${r.id}`);
    }],
    ['POST', /^\/api\/remisiones\/(\d+)\/version$/, (b, me, [id]) => {
      const r = remisionDe(id, me);
      if (!['emitida', 'devuelta'].includes(r.estado)) throw new Falla(409, 'Solo se versiona una remisión emitida o devuelta');
      return nuevaVersion(r, texto(b.motivo, 'el motivo del cambio', 300), me);
    }],
    // Devolver el documento nunca toca existencias; la devolución de mercancía es otra ruta.
    ['POST', /^\/api\/remisiones\/(\d+)\/devolver$/, (b, me, [id]) => {
      const r = remisionDe(id, me);
      if (r.estado !== 'emitida') throw new Falla(409, 'Solo se devuelve una remisión emitida');
      if (!TIPOS_OBS[b.tipo]) throw new Falla(400, 'Elige el tipo de observación');
      const notasLinea = [];
      for (const l of r.contenido.lineas) {
        const nota = opcional(b.notas_linea?.[l.insumo_id], 'la nota', 500);
        if (nota) notasLinea.push({ insumo_id: l.insumo_id, insumo: l.insumo, nota });
      }
      const devolucion = { tipo: TIPOS_OBS[b.tipo], motivo: texto(b.motivo, 'el motivo', 300), notas: opcional(b.notas, 'las notas', 1000), lineas: notasLinea, por: me.nombre, en: ahora() };
      run("UPDATE remisiones SET estado = 'devuelta', devolucion = ? WHERE id = ?", JSON.stringify(devolucion), r.id);
      historial(r.id, 'devuelta', `${devolucion.tipo}: ${devolucion.motivo}`, me);
      evento('alerta', `Remisión ${r.folio} devuelta con observaciones`, `Devolvió ${me.nombre}: ${devolucion.motivo}`, `#/remision/${r.id}`);
    }],
    ['POST', /^\/api\/remisiones\/(\d+)\/firma$/, (b, me, [id]) => {
      const r = remisionDe(id, me);
      if (!['emitida', 'devuelta'].includes(r.estado)) throw new Falla(409, 'Esta versión no admite firmas');
      if (!['entrega', 'recibe'].includes(b.papel)) throw new Falla(400, 'Firma inválida');
      const previa = uno('SELECT * FROM firmas WHERE remision_id = ? AND papel = ?', r.id, b.papel);
      if (previa?.estado === 'firmada') throw new Falla(409, 'Esta parte ya firmó. Si cambia el contenido, crea una nueva versión.');
      const nombre = texto(b.nombre, 'el nombre', 80), funcion = texto(b.funcion, 'la función', 80);
      let estado = 'firmada', trazos = null, motivo = null;
      if (b.no_firma) {
        estado = 'no_firmo';
        motivo = texto(b.motivo, 'el motivo por el que no firma', 300);
      } else {
        const t = b.trazos;
        const valido = Array.isArray(t) && t.length <= 200 && t.every(s => Array.isArray(s) && s.length <= 2000 && s.every(p => Array.isArray(p) && p.length === 2 && p.every(n => typeof n === 'number' && n >= 0 && n <= 1)));
        if (!valido || t.flat().length < 5) throw new Falla(400, 'Firma aquí antes de guardar');
        trazos = JSON.stringify(t);
      }
      run('DELETE FROM firmas WHERE remision_id = ? AND papel = ?', r.id, b.papel);
      run('INSERT INTO firmas (remision_id, papel, nombre, funcion, estado, trazos, motivo, usuario_id, creado) VALUES (?,?,?,?,?,?,?,?,?)', r.id, b.papel, nombre, funcion, estado, trazos, motivo, me.id, ahora());
      historial(r.id, estado === 'firmada' ? 'firma' : 'sin_firma', `${b.papel === 'entrega' ? 'Entrega' : 'Recibe'}: ${nombre}${motivo ? `. No firmó: ${motivo}` : ''}`, me);
    }],
    ['POST', /^\/api\/remisiones\/(\d+)\/envio$/, (b, me, [id]) => {
      const r = remisionDe(id, me);
      if (!['emitida', 'devuelta'].includes(r.estado)) throw new Falla(409, 'Emite la remisión antes de enviarla');
      const prov = uno('SELECT * FROM proveedores WHERE id = ?', r.proveedor_id);
      const registra = (canal, destinatario, resultado, detalle) => {
        run('INSERT INTO envios (remision_id, canal, destinatario, resultado, detalle, usuario, creado) VALUES (?,?,?,?,?,?,?)', r.id, canal, destinatario, resultado, detalle, me.nombre, ahora());
        historial(r.id, 'envio', `${canal}: ${detalle}`, me);
      };
      if (b.canal === 'portal') {
        const usuario = uno("SELECT 1 FROM usuarios WHERE proveedor_id = ? AND rol = 'proveedor' AND activo = 1", r.proveedor_id);
        if (!usuario) {
          registra('portal', prov.nombre, 'error', 'El proveedor no tiene usuario activo en el portal');
          return { ok: false, error: 'Este proveedor no tiene usuario en el portal. Crea uno en Perfil o compártele el PDF.' };
        }
        run('UPDATE remisiones SET compartida = 1 WHERE id = ?', r.id);
        registra('portal', prov.nombre, 'publicada', 'Publicada en el portal del proveedor');
      } else if (b.canal === 'interno') {
        const admins = q("SELECT nombre FROM usuarios WHERE rol = 'admin' AND activo = 1").map(u => u.nombre).join(', ');
        registra('interno', admins, 'publicada', 'Aviso dentro del sistema');
        evento('recepcion', `Remisión ${r.folio} para revisión`, `Avisó ${me.nombre}`, `#/remision/${r.id}`);
      } else if (['whatsapp', 'correo', 'descarga'].includes(b.canal)) {
        // Solo consta que se abrió el canal: sin integración no hay forma de confirmar la entrega.
        registra(b.canal, opcional(b.destinatario, 'el destinatario', 120) || prov.nombre, 'compartida_manual', 'Abierto para compartir a mano. Entrega sin confirmar.');
      } else throw new Falla(400, 'Canal inválido');
      return { ok: true };
    }],
    ['GET', /^\/api\/remisiones\/(\d+)\/pdf$/, (b, me, [id]) => {
      const r = uno('SELECT * FROM remisiones WHERE id = ?', Number(id));
      if (!r) throw new Falla(404, 'Remisión no encontrada');
      if (me.rol === 'proveedor' ? (r.proveedor_id !== me.proveedor_id || !r.compartida) : false) throw new Falla(404, 'Remisión no encontrada');
      const completa = { ...r, contenido: json(r.contenido), devolucion: json(r.devolucion) };
      const firmas = q('SELECT * FROM firmas WHERE remision_id = ?', r.id).map(f => ({ ...f, trazos: json(f.trazos) }));
      return { binario: pdfRemision(completa, firmas), tipo: 'application/pdf', nombre: `Remision-${r.folio}-v${r.version}.pdf` };
    }, 'todos'],
    ['GET', /^\/api\/documentos\/(\d+)$/, (b, me, [id]) => {
      const d = uno('SELECT * FROM documentos WHERE id = ?', Number(id));
      if (!d) throw new Falla(404, 'Documento no encontrado');
      if (me.rol === 'proveedor') {
        const compartido = d.proveedor_id === me.proveedor_id && uno('SELECT 1 FROM remisiones WHERE compartida = 1 AND (id = ? OR recepcion_id = ?)', d.remision_id, d.recepcion_id);
        if (!compartido) throw new Falla(404, 'Documento no encontrado');
      }
      return descargaDoc(d);
    }, 'todos'],

    ['POST', /^\/api\/recetas$/, b => {
      const d = datosReceta(b);
      const { lastInsertRowid } = run('INSERT INTO recetas (nombre, porciones, notas) VALUES (?,?,?)', d.nombre, d.porciones, d.notas);
      d.ls.forEach(l => run('INSERT INTO receta_lineas VALUES (?,?,?,?)', lastInsertRowid, ...l));
      return { id: Number(lastInsertRowid) };
    }, 'admin'],
    ['PUT', /^\/api\/recetas\/(\d+)$/, (b, me, [id]) => {
      const d = datosReceta(b);
      if (!run('UPDATE recetas SET nombre=?, porciones=?, notas=? WHERE id=?', d.nombre, d.porciones, d.notas, Number(id)).changes) throw new Falla(404, 'Receta no encontrada');
      run('DELETE FROM receta_lineas WHERE receta_id = ?', Number(id));
      d.ls.forEach(l => run('INSERT INTO receta_lineas VALUES (?,?,?,?)', Number(id), ...l));
    }, 'admin'],
    ['POST', /^\/api\/recetas\/(\d+)\/produccion$/, (b, me, [id]) => {
      if (me.rol === 'auxiliar') throw new Falla(403, 'Cocina o administración registran la producción');
      const k = clave(b);
      if (k) {
        const previa = uno('SELECT id FROM producciones WHERE clave = ?', k);
        if (previa) return { id: previa.id, repetida: true };
      }
      const r = uno('SELECT * FROM recetas WHERE id = ?', Number(id));
      if (!r) throw new Falla(404, 'Receta no encontrada');
      const porciones = numero(b.porciones, 'Porciones');
      if (!porciones) throw new Falla(400, 'Las porciones deben ser mayores a cero');
      const escala = porciones / r.porciones;
      const ls = q('SELECT rl.*, i.nombre, i.stock, i.unidad, i.min, i.rendimiento, i.costo, i.id iid FROM receta_lineas rl JOIN insumos i ON i.id = rl.insumo_id WHERE rl.receta_id = ?', r.id);
      const calc = ls.map(l => {
        const neta = r3(l.neta * escala);
        return { l, neta, ...calcularLinea(neta, l.merma, l.rendimiento) };
      });
      const faltan = calc.filter(c => c.bruta > c.l.stock);
      if (faltan.length) throw new Falla(409, `No alcanza: ${faltan.map(c => `${c.l.nombre} (necesitas ${c.bruta} ${c.l.unidad}, hay ${c.l.stock})`).join('; ')}`);
      const { lastInsertRowid } = run('INSERT INTO producciones (receta_id, porciones, usuario_id, creado, clave) VALUES (?,?,?,?,?)', r.id, porciones, me.id, ahora(), k);
      const prod = Number(lastInsertRowid);
      for (const c of calc) {
        run('INSERT INTO produccion_lineas (produccion_id, insumo_id, neta, bruta, merma_prevista, fuente, costo) VALUES (?,?,?,?,?,?,?)', prod, c.l.iid, c.neta, c.bruta, c.merma_prevista, c.fuente, c.l.costo === null ? null : r3(c.bruta * c.l.costo));
        moverStock({ id: c.l.iid, nombre: c.l.nombre, stock: c.l.stock, unidad: c.l.unidad, min: c.l.min }, c.l.stock - c.bruta, 'produccion', me, { ref: `produccion:${prod}`, nota: `${r.nombre}, ${porciones} porciones` });
      }
      return { id: prod };
    }],
    ['POST', /^\/api\/mermas$/, (b, me) => {
      const k = clave(b);
      if (k && uno('SELECT 1 FROM movimientos WHERE ref = ?', `merma:${k}`)) return { repetida: true };
      const i = insumo(b.insumo), cantidad = r3(numero(b.cantidad, i.nombre));
      if (!cantidad) throw new Falla(400, 'La cantidad debe ser mayor a cero');
      if (cantidad > i.stock) throw new Falla(400, `Solo hay ${i.stock} ${i.unidad} en existencia`);
      moverStock(i, i.stock - cantidad, 'merma_adicional', me, { ref: k ? `merma:${k}` : null, nota: texto(b.motivo, 'el motivo', 300) });
    }],
  ];

  return { rutas, estadoInterno, estadoProveedor, estadoEntrega, subirDocumento, MAX_ARCHIVO, calcularLinea };
};

module.exports.calcularLinea = calcularLinea;
