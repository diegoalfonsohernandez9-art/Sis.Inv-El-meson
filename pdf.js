'use strict';
// PDF mínimo sin dependencias: texto con fuentes base (WinAnsi), líneas y trazos vectoriales para las firmas.
const ANCHO = 612, ALTO = 792, MARGEN = 40;

const limpio = s => String(s ?? '').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?').replace(/([\\()])/g, '\\$1');

function envolver(texto, tam, ancho) {
  // Aproximación del ancho medio de Helvetica; suficiente para partir renglones sin desbordar.
  const max = Math.max(4, Math.floor(ancho / (tam * 0.5)));
  const salida = [];
  for (const parrafo of String(texto ?? '').split('\n')) {
    let linea = '';
    for (const palabra of parrafo.split(/\s+/)) {
      const prueba = linea ? `${linea} ${palabra}` : palabra;
      if (prueba.length > max && linea) { salida.push(linea); linea = palabra; } else linea = prueba;
    }
    salida.push(linea);
  }
  return salida;
}

class Lienzo {
  constructor() { this.paginas = []; this.nueva(); }
  nueva() { this.ops = []; this.paginas.push(this.ops); this.y = ALTO - MARGEN; }
  espacio(alto) { if (this.y - alto < MARGEN) this.nueva(); }
  texto(x, y, s, tam = 10, negrita = false) { this.ops.push(`BT /${negrita ? 'F2' : 'F1'} ${tam} Tf ${x} ${y} Td (${limpio(s)}) Tj ET`); }
  linea(x1, y1, x2, y2) { this.ops.push(`${x1} ${y1} m ${x2} ${y2} l S`); }
  parrafo(s, tam = 10, negrita = false, x = MARGEN, ancho = ANCHO - 2 * MARGEN) {
    for (const l of envolver(s, tam, ancho)) {
      this.espacio(tam + 4);
      this.y -= tam + 3;
      this.texto(x, this.y, l, tam, negrita);
    }
  }
  titulo(s) { this.espacio(32); this.y -= 10; this.parrafo(s, 12, true); this.y -= 2; }
  fila(celdas, columnas, tam = 8, negrita = false) {
    const envueltas = celdas.map((c, i) => envolver(c, tam, columnas[i + 1] - columnas[i] - 4));
    const alto = Math.max(...envueltas.map(e => e.length)) * (tam + 2) + 4;
    this.espacio(alto);
    envueltas.forEach((e, i) => e.forEach((l, j) => this.texto(columnas[i], this.y - (j + 1) * (tam + 2), l, tam, negrita)));
    this.y -= alto;
    this.linea(MARGEN, this.y, ANCHO - MARGEN, this.y);
  }
  firma(x, y, ancho, alto, trazos) {
    for (const t of trazos) {
      const pts = t.map(([a, b]) => `${(x + a * ancho).toFixed(1)} ${(y + alto - b * alto).toFixed(1)}`);
      if (pts.length > 1) this.ops.push(`${pts[0]} m ${pts.slice(1).map(p => `${p} l`).join(' ')} S`);
    }
  }
  pdf() {
    const objs = [];
    const agrega = cuerpo => objs.push(cuerpo) && objs.length;
    agrega('<< /Type /Catalog /Pages 2 0 R >>');
    agrega('');
    agrega('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    agrega('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids = [];
    this.paginas.forEach((ops, i) => {
      const pie = `BT /F1 8 Tf ${MARGEN} 24 Td (Página ${i + 1} de ${this.paginas.length}) Tj ET`;
      const flujo = `0.5 w\n${ops.join('\n')}\n${pie}`;
      const contenido = agrega(`<< /Length ${Buffer.byteLength(flujo, 'latin1')} >>\nstream\n${flujo}\nendstream`);
      kids.push(agrega(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ANCHO} ${ALTO}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contenido} 0 R >>`));
    });
    objs[1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
    let salida = '%PDF-1.4\n';
    const pos = objs.map((o, i) => {
      const p = Buffer.byteLength(salida, 'latin1');
      salida += `${i + 1} 0 obj\n${o}\nendobj\n`;
      return p;
    });
    const xref = Buffer.byteLength(salida, 'latin1');
    salida += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${pos.map(p => `${String(p).padStart(10, '0')} 00000 n \n`).join('')}`;
    salida += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(salida, 'latin1');
  }
}

const fechaLarga = iso => (iso ? new Date(iso).toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short' }) : '');
const TIPO_INC = { faltante: 'Faltante', rechazo: 'Rechazo', dano: 'Daño', observacion: 'Observación' };
const ESTADO = { borrador: 'BORRADOR', emitida: 'Emitida', devuelta: 'Devuelta con observaciones', reemplazada: 'Reemplazada por una versión posterior' };

function pdfRemision(r, firmas) {
  const c = r.contenido, d = new Lienzo();
  d.parrafo('REMISIÓN', 18, true);
  d.parrafo('Este documento es una remisión de entrega. No es una factura ni un comprobante fiscal.', 9);
  d.y -= 6;
  d.parrafo(`Folio: ${r.folio}   Versión: ${r.version}   Estado: ${ESTADO[r.estado] || r.estado}`, 10, true);
  d.parrafo(`Fecha: ${fechaLarga(r.creado)}`);
  d.parrafo(`Lugar de entrega: ${c.lugar}`);
  d.parrafo(`Pedido: #${c.pedido}   Folio de entrega del proveedor: ${c.folio_entrega}`);
  d.parrafo(`Recibió: ${c.recibio}   Fecha de recepción: ${fechaLarga(c.fecha_recepcion)}`);

  d.titulo('Proveedor');
  d.parrafo(c.proveedor.nombre, 10, true);
  if (c.proveedor.razon_social) d.parrafo(`Razón social: ${c.proveedor.razon_social}`);
  if (c.proveedor.rfc) d.parrafo(`RFC: ${c.proveedor.rfc}`);

  d.titulo('Productos');
  const col = [MARGEN, 190, 240, 290, 340, 390, 440, ANCHO - MARGEN];
  d.fila(['Producto', 'Unidad', 'Pedida', 'Recibida', 'Aceptada', 'Rechazada', 'Pendiente'], col, 8, true);
  for (const l of c.lineas) {
    d.fila([l.insumo, l.unidad, l.pedida, l.recibida, l.aceptada, l.rechazada, l.pendiente], col);
    if (l.motivo) d.parrafo(`Motivo de rechazo: ${l.motivo}`, 8);
    if (l.nota) d.parrafo(`Nota: ${l.nota}`, 8);
  }

  if (c.notas) { d.titulo('Notas'); d.parrafo(c.notas, 9); }
  if (c.incidencias.length) {
    d.titulo('Faltantes e incidencias');
    c.incidencias.forEach(i => d.parrafo(`${TIPO_INC[i.tipo] || i.tipo}: ${i.insumo}${i.cantidad ? ` ${i.cantidad} ${i.unidad}` : ''}${i.motivo ? ` (${i.motivo})` : ''}${i.nota ? ` ${i.nota}` : ''}`, 9));
  }
  if (c.devoluciones.length) {
    d.titulo('Mercancía devuelta físicamente');
    c.devoluciones.forEach(x => d.parrafo(`${x.insumo}: ${x.cantidad} ${x.unidad}. Motivo: ${x.motivo}. Comprobante: ${x.comprobante}`, 9));
  }
  if (c.evidencias.length) {
    d.titulo('Evidencias de referencia');
    c.evidencias.forEach(e => d.parrafo(`${e.tipo.replace(/_/g, ' ')}: ${e.nombre}`, 9));
  }
  if (c.correccion) {
    d.titulo('Corrección');
    d.parrafo(`Sustituye a la versión ${c.correccion.version_anterior}. Motivo: ${c.correccion.motivo}`, 9);
  }
  if (r.devolucion) {
    const o = r.devolucion;
    d.titulo('Devuelta con observaciones');
    d.parrafo(`Motivo (${o.tipo}): ${o.motivo}`, 9);
    d.parrafo(`Devolvió: ${o.por}, ${fechaLarga(o.en)}`, 9);
    if (o.notas) d.parrafo(o.notas, 9);
    o.lineas.forEach(l => d.parrafo(`${l.insumo}: ${l.nota}`, 9));
    d.parrafo('Esta devolución es del documento y no modifica el inventario.', 8);
  }

  d.titulo('Firmas');
  for (const [papel, etiqueta] of [['entrega', 'Entrega'], ['recibe', 'Recibe']]) {
    const f = firmas.find(x => x.papel === papel);
    d.espacio(84);
    d.parrafo(etiqueta, 9, true);
    if (f?.estado === 'firmada') {
      d.firma(MARGEN, d.y - 42, 180, 40, f.trazos);
      d.y -= 44;
      d.linea(MARGEN, d.y, MARGEN + 180, d.y);
      d.parrafo(`${f.nombre}, ${f.funcion}, ${fechaLarga(f.creado)}`, 8);
    } else if (f) {
      d.parrafo(`Pendiente de firma. ${f.nombre}, ${f.funcion}, ${fechaLarga(f.creado)}. Motivo: ${f.motivo}`, 8);
    } else {
      d.parrafo('Pendiente de firma.', 8);
    }
  }
  return d.pdf();
}

module.exports = { pdfRemision };
