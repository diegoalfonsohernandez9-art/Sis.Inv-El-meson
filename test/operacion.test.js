'use strict';
process.env.PIN_INICIAL = '1234';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { crearApp } = require('../server');
const { calcularLinea } = require('../operacion');

let server, base, leo, juan, carlos, portal;

async function llamar(metodo, ruta, cuerpo, cookie) {
  const r = await fetch(base + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const t = await r.text();
  let datos;
  try { datos = JSON.parse(t); } catch { datos = t; }
  return { status: r.status, datos, cookie: (r.headers.get('set-cookie') || '').split(';')[0], tipo: r.headers.get('content-type'), disp: r.headers.get('content-disposition') };
}
const ok = async (...a) => {
  const r = await llamar(...a);
  assert.equal(r.status, 200, `${a[1]}: ${JSON.stringify(r.datos)}`);
  return r.datos;
};
const estado = c => ok('GET', '/api/estado', undefined, c);
const stock = async (nombre, c = leo) => (await estado(c)).insumos.find(i => i.nombre === nombre).stock;
const movs = async (tipo, ref) => (await estado(leo)).movimientos.filter(m => m.tipo === tipo && (!ref || m.ref === ref));
const subir = (ruta, cuerpo, c) => fetch(base + ruta, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Cookie: c }, body: cuerpo });
const PNG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0]);
const FIRMA = [[[0.1, 0.1], [0.5, 0.5], [0.9, 0.2], [0.8, 0.8], [0.2, 0.9]]];

async function pedidoPollo(cantidad = 20) {
  const e = await estado(leo);
  const pollo = e.insumos.find(i => i.nombre === 'Pollo (pechuga)');
  const { id } = await ok('POST', '/api/pedidos', { proveedor_id: 1, fecha_entrega: '2030-01-01', lineas: [{ insumo: pollo.id, cantidad, precio: 80 }] }, leo);
  return { id, pollo };
}

before(async () => {
  server = crearApp(':memory:');
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const usuarios = await ok('GET', '/api/usuarios');
  const entrar = async n => (await llamar('POST', '/api/login', { usuario_id: usuarios.find(u => u.nombre === n).id, pin: '1234' })).cookie;
  leo = await entrar('Leo'); juan = await entrar('Juan Pérez'); carlos = await entrar('Carlos Méndez'); portal = await entrar('Distribuidora Central');
});
after(() => server.close());

test('rendimiento y merma de receta no se descuentan dos veces', () => {
  const merma = calcularLinea(1, 10, 80);
  assert.equal(merma.fuente, 'receta');
  assert.equal(merma.bruta, 1.111);
  const rend = calcularLinea(1, null, 80);
  assert.equal(rend.fuente, 'rendimiento');
  assert.equal(rend.bruta, 1.25);
  assert.equal(rend.merma_prevista, 0.25);
  assert.deepEqual(calcularLinea(2, null, null), { bruta: 2, merma_prevista: 0, fuente: 'sin_dato' });
});

test('un conteo solo cambia lo capturado: no borra una entrada ocurrida mientras contaban', async () => {
  const { id, pollo } = await pedidoPollo();
  const leche = (await estado(leo)).insumos.find(i => i.nombre === 'Leche entera');
  await ok('POST', `/api/pedidos/${id}/recepcion`, { folio: 'NOTA-CT', lineas: [{ insumo: pollo.id, recibido: 20 }] }, carlos);
  const conEntrada = await stock('Pollo (pechuga)');
  await ok('POST', '/api/conteos', { categoria_id: 1, lineas: [{ insumo: leche.id, cantidad: leche.stock + 1 }] }, juan);
  assert.equal(await stock('Pollo (pechuga)'), conEntrada);
  assert.equal(await stock('Leche entera'), leche.stock + 1);

  // Confirmar sin cambios registra el conteo y no mueve nada.
  const antes = await estado(leo);
  await ok('POST', '/api/conteos', { categoria_id: 1, lineas: [] }, juan);
  const despues = await estado(leo);
  assert.equal(despues.conteos.length, antes.conteos.length + 1);
  assert.equal(despues.movimientos.length, antes.movimientos.length);
  assert.equal((await llamar('POST', '/api/conteos', { categoria_id: 999, lineas: [] }, juan)).status, 400);
});

test('captura masiva de rendimientos y precios: valida todo o nada y es de administración', async () => {
  const e = await estado(leo);
  const [a, b] = e.insumos.filter(i => i.categoria_id === 4);
  const url = '/api/insumos/datos';
  assert.equal((await llamar('POST', url, { lineas: [{ insumo: a.id, rendimiento: 90 }] }, carlos)).status, 403);
  assert.equal((await llamar('POST', url, { lineas: [{ insumo: a.id, rendimiento: 90 }, { insumo: b.id, rendimiento: 150 }] }, leo)).status, 400);
  assert.equal((await estado(leo)).insumos.find(i => i.id === a.id).rendimiento, a.rendimiento, 'un error no aplica nada');
  await ok('POST', url, { lineas: [{ insumo: a.id, rendimiento: '90', costo: '12.5' }, { insumo: b.id, rendimiento: '', costo: '' }] }, leo);
  const f = await estado(leo);
  const x = f.insumos.find(i => i.id === a.id), y = f.insumos.find(i => i.id === b.id);
  assert.deepEqual([x.rendimiento, x.costo, x.stock], [90, 12.5, a.stock]);
  assert.deepEqual([y.rendimiento, y.costo], [null, null]);
});

test('proveedor con datos fiscales: formato validado y permisos', async () => {
  const base_ = { nombre: 'Carnes del Norte', tipo: 'correo', contacto: 'ventas@carnes.example' };
  assert.equal((await llamar('POST', '/api/proveedores', { ...base_, rfc: 'MAL' }, leo)).status, 400);
  assert.equal((await llamar('POST', '/api/proveedores', { ...base_, cp: '123' }, leo)).status, 400);
  assert.equal((await llamar('POST', '/api/proveedores', base_, carlos)).status, 403);
  const { id } = await ok('POST', '/api/proveedores', { ...base_, razon_social: 'Carnes del Norte SA de CV', rfc: 'cno010101ab1', cp: '64000', regimen_fiscal: '601', domicilio_fiscal: 'Calle 1', telefono: '8112345678', correo: 'fact@carnes.example', contacto_nombre: 'Ana' }, leo);
  const p = (await estado(leo)).proveedores.find(x => x.id === id);
  assert.equal(p.rfc, 'CNO010101AB1');
  assert.equal(p.cp, '64000');
});

test('caso 20 kg pedidos, llegan 10: parcial, faltante, entrada única y entrega posterior', async () => {
  const { id, pollo } = await pedidoPollo();
  const antes = pollo.stock;
  const clave = 'clave-parcial-0001';
  const r = await ok('POST', `/api/pedidos/${id}/recepcion`, { clave, folio: 'NOTA-1', lineas: [{ insumo: pollo.id, recibido: 10, aceptado: 10, nota: 'Llegó la mitad' }] }, carlos);
  assert.equal(await stock('Pollo (pechuga)'), antes + 10);

  // Reintento con la misma clave: misma recepción, sin otra entrada.
  const rep = await ok('POST', `/api/pedidos/${id}/recepcion`, { clave, folio: 'NOTA-1', lineas: [{ insumo: pollo.id, recibido: 10, aceptado: 10 }] }, carlos);
  assert.equal(rep.id, r.id);
  assert.equal(rep.repetida, true);
  assert.equal(await stock('Pollo (pechuga)'), antes + 10);

  let e = await estado(leo);
  let ped = e.pedidos.find(p => p.id === id);
  assert.equal(ped.entrega, 'recibida_parcial');
  assert.equal(ped.estado, 'en_proceso');
  const linea = e.recepciones.find(x => x.id === r.id).lineas[0];
  assert.deepEqual([linea.pedida, linea.recibido, linea.aceptado, linea.rechazado, linea.pendiente, linea.unidad], [20, 10, 10, 0, 10, 'kg']);
  const falt = e.incidencias.filter(i => i.pedido_id === id && i.tipo === 'faltante' && i.estado === 'abierta');
  assert.equal(falt.length, 1);
  assert.equal(falt[0].cantidad, 10);

  // No se puede aceptar más de lo pendiente.
  assert.equal((await llamar('POST', `/api/pedidos/${id}/recepcion`, { folio: 'NOTA-2', lineas: [{ insumo: pollo.id, recibido: 11, aceptado: 11 }] }, carlos)).status, 400);

  // Llega el resto: completa sin duplicar.
  await ok('POST', `/api/pedidos/${id}/recepcion`, { folio: 'NOTA-2', lineas: [{ insumo: pollo.id, recibido: 10 }] }, carlos);
  assert.equal(await stock('Pollo (pechuga)'), antes + 20);
  e = await estado(leo);
  ped = e.pedidos.find(p => p.id === id);
  assert.equal(ped.entrega, 'aceptada');
  assert.equal(ped.estado, 'recibido');
  assert.equal(e.incidencias.filter(i => i.pedido_id === id && i.tipo === 'faltante' && i.estado === 'abierta').length, 0);
  assert.equal((await llamar('POST', `/api/pedidos/${id}/recepcion`, { folio: 'NOTA-3', lineas: [{ insumo: pollo.id, recibido: 1 }] }, carlos)).status, 409);
});

test('rechazo total no registra ninguna entrada y exige motivo', async () => {
  const { id, pollo } = await pedidoPollo();
  const antes = await stock('Pollo (pechuga)');
  const nMov = (await movs('recepcion')).length;
  assert.equal((await llamar('POST', `/api/pedidos/${id}/recepcion`, { lineas: [{ insumo: pollo.id, recibido: 10, aceptado: 0 }] }, carlos)).status, 400);
  const r = await ok('POST', `/api/pedidos/${id}/recepcion`, { lineas: [{ insumo: pollo.id, recibido: 10, aceptado: 0, motivo: 'Mal olor', dano: true }] }, carlos);
  assert.equal(await stock('Pollo (pechuga)'), antes);
  assert.equal((await movs('recepcion')).length, nMov);
  const e = await estado(leo);
  assert.equal(e.recepciones.find(x => x.id === r.id).estado, 'rechazada');
  assert.equal(e.pedidos.find(p => p.id === id).entrega, 'rechazada');
  const inc = e.incidencias.filter(i => i.pedido_id === id);
  assert.ok(inc.some(i => i.tipo === 'dano' && i.cantidad === 10 && i.motivo === 'Mal olor'));
  assert.ok(inc.some(i => i.tipo === 'faltante' && i.cantidad === 10), 'lo que no llegó es faltante, no rechazo');

  // Se cierra el faltante con justificación y el pedido termina sin tocar inventario.
  assert.equal((await llamar('POST', `/api/pedidos/${id}/faltantes/${pollo.id}/cerrar`, {}, carlos)).status, 400);
  await ok('POST', `/api/pedidos/${id}/faltantes/${pollo.id}/cerrar`, { justificacion: 'Se canceló con el proveedor' }, carlos);
  assert.equal((await estado(leo)).pedidos.find(p => p.id === id).estado, 'diferencia');
  assert.equal(await stock('Pollo (pechuga)'), antes);
});

test('remisión: borrador, versiones, devolución sin stock, firmas y envío', async () => {
  const { id, pollo } = await pedidoPollo();
  const r = await ok('POST', `/api/pedidos/${id}/recepcion`, { folio: 'NOTA-9', lineas: [{ insumo: pollo.id, recibido: 10, aceptado: 10 }] }, carlos);
  const rem = await ok('POST', `/api/recepciones/${r.id}/remision`, {}, carlos);
  const otra = await ok('POST', `/api/recepciones/${r.id}/remision`, {}, carlos);
  assert.equal(otra.id, rem.id, 'no se crean dos remisiones por recepción');
  await ok('PUT', `/api/remisiones/${rem.id}`, { lugar: 'Cocina principal', notas: 'Faltan 10 kg', notas_linea: { [pollo.id]: 'Solo la mitad' } }, carlos);

  // Borrador: no se firma ni se envía ni se devuelve.
  assert.equal((await llamar('POST', `/api/remisiones/${rem.id}/firma`, { papel: 'recibe', nombre: 'C', funcion: 'A', trazos: FIRMA }, carlos)).status, 409);
  assert.equal((await llamar('POST', `/api/remisiones/${rem.id}/devolver`, { tipo: 'faltante', motivo: 'x' }, carlos)).status, 409);
  await ok('POST', `/api/remisiones/${rem.id}/emitir`, {}, carlos);
  assert.equal((await llamar('PUT', `/api/remisiones/${rem.id}`, { lugar: 'Otro' }, carlos)).status, 409);

  // El proveedor no ve lo que no se le compartió.
  assert.equal((await llamar('GET', `/api/remisiones/${rem.id}/pdf`, undefined, portal)).status, 404);

  const stockAntes = await stock('Pollo (pechuga)');
  const nMov = (await estado(leo)).movimientos.length;
  assert.equal((await llamar('POST', `/api/remisiones/${rem.id}/devolver`, { tipo: 'faltante' }, carlos)).status, 400);
  await ok('POST', `/api/remisiones/${rem.id}/devolver`, { tipo: 'faltante', motivo: 'Faltan 10 kg', notas: 'Corregir', notas_linea: { [pollo.id]: 'Pedido 20, llegaron 10' } }, carlos);
  assert.equal(await stock('Pollo (pechuga)'), stockAntes, 'devolver el documento no toca existencias');
  assert.equal((await estado(leo)).movimientos.length, nMov);

  // Firmas: una firma real, una sin firmar con motivo.
  assert.equal((await llamar('POST', `/api/remisiones/${rem.id}/firma`, { papel: 'recibe', nombre: 'Carlos', funcion: 'Auxiliar', trazos: [] }, carlos)).status, 400);
  await ok('POST', `/api/remisiones/${rem.id}/firma`, { papel: 'recibe', nombre: 'Carlos', funcion: 'Auxiliar', trazos: FIRMA }, carlos);
  assert.equal((await llamar('POST', `/api/remisiones/${rem.id}/firma`, { papel: 'recibe', nombre: 'Otro', funcion: 'X', trazos: FIRMA }, carlos)).status, 409);
  assert.equal((await llamar('POST', `/api/remisiones/${rem.id}/firma`, { papel: 'entrega', nombre: 'Repartidor', funcion: 'Chofer', no_firma: true }, carlos)).status, 400);
  await ok('POST', `/api/remisiones/${rem.id}/firma`, { papel: 'entrega', nombre: 'Repartidor', funcion: 'Chofer', no_firma: true, motivo: 'Tenía prisa' }, carlos);
  let e = await estado(leo);
  let x = e.remisiones.find(z => z.id === rem.id);
  assert.equal(x.firma_estado, 'pendiente_con_motivo');
  assert.equal(x.estado, 'devuelta');
  assert.equal(x.envio_estado, 'sin_enviar');

  // Envío: compartir a mano nunca cuenta como confirmado.
  await ok('POST', `/api/remisiones/${rem.id}/envio`, { canal: 'whatsapp', destinatario: '5215512345678' }, carlos);
  e = await estado(leo);
  x = e.remisiones.find(z => z.id === rem.id);
  assert.equal(x.envio_estado, 'compartida_manual');
  assert.equal(x.envios[0].resultado, 'compartida_manual');
  assert.equal((await llamar('GET', `/api/remisiones/${rem.id}/pdf`, undefined, portal)).status, 404);

  // Portal: ahora sí lo consulta con observaciones y PDF.
  await ok('POST', `/api/remisiones/${rem.id}/envio`, { canal: 'portal' }, carlos);
  const pe = await estado(portal);
  const vista = pe.remisiones.find(z => z.id === rem.id);
  assert.equal(vista.devolucion.motivo, 'Faltan 10 kg');
  assert.ok(!('historial' in vista) && !('envios' in vista));
  const pdf = await llamar('GET', `/api/remisiones/${rem.id}/pdf`, undefined, portal);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.tipo, 'application/pdf');
  assert.ok(String(pdf.datos).startsWith('%PDF-'));
  assert.ok(String(pdf.datos).includes('Faltan 10 kg'), 'el PDF incluye las observaciones');
  assert.ok(String(pdf.datos).includes('no es una factura'.replace('no es', 'No es')), 'se distingue de la factura');

  // El proveedor sube la versión corregida.
  const sub = await subir(`/api/documentos?tipo=remision_corregida&remision=${rem.id}&nombre=corregida.png`, PNG, portal);
  assert.equal(sub.status, 200);
  assert.equal((await subir(`/api/documentos?tipo=factura&remision=${rem.id}`, PNG, portal)).status, 403);

  // Nueva versión: la original se conserva con sus firmas y la nueva pide firmas otra vez.
  const v2 = await ok('POST', `/api/remisiones/${rem.id}/version`, { motivo: 'Proveedor corrigió el folio' }, carlos);
  await ok('POST', `/api/remisiones/${v2.id}/emitir`, {}, carlos);
  e = await estado(leo);
  const orig = e.remisiones.find(z => z.id === rem.id), nueva = e.remisiones.find(z => z.id === v2.id);
  assert.equal(orig.estado, 'reemplazada');
  assert.equal(orig.obs_resueltas, 1);
  assert.equal(orig.firmas.length, 2);
  assert.equal(orig.devolucion.motivo, 'Faltan 10 kg');
  assert.equal(nueva.version, 2);
  assert.equal(nueva.folio, orig.folio);
  assert.equal(nueva.firmas.length, 0);
  assert.equal(nueva.firma_estado, 'pendiente');
  assert.equal(nueva.anterior_id, orig.id);
  assert.equal(await stock('Pollo (pechuga)'), stockAntes, 'versionar no mueve inventario');
  assert.equal((await llamar('POST', `/api/remisiones/${rem.id}/firma`, { papel: 'entrega', nombre: 'X', funcion: 'Y', trazos: FIRMA }, carlos)).status, 409);
});

test('devolución física: solo descuenta lo aceptado y una sola vez', async () => {
  const { id, pollo } = await pedidoPollo();
  await ok('POST', `/api/pedidos/${id}/recepcion`, { folio: 'NOTA-D', lineas: [{ insumo: pollo.id, recibido: 15, aceptado: 10, motivo: 'Dañado' }] }, carlos);
  const antes = await stock('Pollo (pechuga)');
  const b = { comprobante: 'DEV-1', motivo: 'Mal estado', lineas: [{ insumo: pollo.id, cantidad: 11 }] };
  const exceso = await llamar('POST', `/api/pedidos/${id}/devoluciones`, b, carlos);
  assert.equal(exceso.status, 400, 'los 5 rechazados nunca entraron: no pueden salir');
  assert.equal(await stock('Pollo (pechuga)'), antes);
  assert.equal((await llamar('POST', `/api/pedidos/${id}/devoluciones`, { ...b, comprobante: '', lineas: [{ insumo: pollo.id, cantidad: 3 }] }, carlos)).status, 400);
  const con = { comprobante: 'DEV-1', motivo: 'Mal estado', clave: 'clave-devolucion-1', lineas: [{ insumo: pollo.id, cantidad: 3 }] };
  const d = await ok('POST', `/api/pedidos/${id}/devoluciones`, con, carlos);
  const rep = await ok('POST', `/api/pedidos/${id}/devoluciones`, con, carlos);
  assert.equal(rep.id, d.id);
  assert.equal(await stock('Pollo (pechuga)'), antes - 3);
  assert.equal((await movs('devolucion', `devolucion:${d.id}`)).length, 1);
  assert.equal((await llamar('POST', `/api/pedidos/${id}/devoluciones`, { ...b, lineas: [{ insumo: pollo.id, cantidad: 8 }] }, carlos)).status, 400, 'ya se devolvieron 3 de 10');
});

test('checklist: revisión interna separada del estado de entrega', async () => {
  const { id, pollo } = await pedidoPollo();
  const r = await ok('POST', `/api/pedidos/${id}/recepcion`, { folio: 'NOTA-C', lineas: [{ insumo: pollo.id, recibido: 20 }] }, carlos);
  const items = Object.fromEntries(['proveedor', 'pedido', 'productos', 'cantidades', 'calidad', 'precios', 'importes', 'documento', 'datos_fiscales', 'folio', 'adjuntos'].map(k => [k, 'ok']));
  await ok('POST', `/api/recepciones/${r.id}/checklist`, { items: { proveedor: 'ok' } }, carlos);
  assert.equal((await estado(leo)).recepciones.find(x => x.id === r.id).doc_estado, 'pendiente');
  assert.equal((await llamar('POST', `/api/recepciones/${r.id}/checklist`, { items: { ...items, precios: 'observacion' } }, carlos)).status, 400);
  await ok('POST', `/api/recepciones/${r.id}/checklist`, { items: { ...items, precios: 'observacion' }, notas: 'Precio distinto' }, carlos);
  let x = (await estado(leo)).recepciones.find(z => z.id === r.id);
  assert.equal(x.doc_estado, 'con_observaciones');
  assert.equal(x.estado, 'aceptada');
  assert.equal(x.revisor, 'Carlos Méndez');
  await ok('POST', `/api/recepciones/${r.id}/checklist`, { items }, carlos);
  x = (await estado(leo)).recepciones.find(z => z.id === r.id);
  assert.equal(x.doc_estado, 'revisada');
});

test('documentos: valida contenido real, permisos y descarga segura', async () => {
  const { id } = await pedidoPollo();
  assert.equal((await subir(`/api/documentos?tipo=factura&pedido=${id}`, Buffer.from('<html><script>alert(1)</script>'), carlos)).status, 415);
  assert.equal((await subir(`/api/documentos?tipo=virus&pedido=${id}`, PNG, carlos)).status, 400);
  assert.equal((await subir(`/api/documentos?tipo=factura`, PNG, carlos)).status, 400);
  assert.equal((await subir(`/api/documentos?tipo=factura&pedido=${id}`, PNG, portal)).status, 403);
  const r = await subir(`/api/documentos?tipo=xml&pedido=${id}&nombre=${encodeURIComponent('../../fact ura.xml')}`, Buffer.from('<?xml version="1.0"?><a/>'), carlos);
  assert.equal(r.status, 200);
  const { id: doc } = await r.json();
  const g = await llamar('GET', `/api/documentos/${doc}`, undefined, carlos);
  assert.equal(g.status, 200);
  assert.ok(g.disp.startsWith('attachment'), 'XML nunca se abre dentro de la app');
  assert.ok(!g.disp.includes('/'), 'el nombre no conserva rutas');
  assert.equal((await llamar('GET', `/api/documentos/${doc}`, undefined, portal)).status, 404);
  assert.equal((await llamar('GET', `/api/documentos/${doc}`)).status, 401);
});

test('auxiliar: pedidos asignados y límites de permisos', async () => {
  const e = await estado(leo);
  const carlosId = e.usuarios.find(u => u.nombre === 'Carlos Méndez').id;
  const otro = await ok('POST', '/api/usuarios', { nombre: 'Aux Dos', rol: 'auxiliar', area: 'Almacén', pin: '5678' }, leo).then(() => estado(leo));
  const dosId = otro.usuarios.find(u => u.nombre === 'Aux Dos').id;
  const pollo = e.insumos.find(i => i.nombre === 'Pollo (pechuga)');
  const { id } = await ok('POST', '/api/pedidos', { proveedor_id: 1, fecha_entrega: '2030-01-01', asignado_id: dosId, lineas: [{ insumo: pollo.id, cantidad: 5 }] }, leo);
  assert.equal((await llamar('POST', `/api/pedidos/${id}/recepcion`, { folio: 'X', lineas: [{ insumo: pollo.id, recibido: 5 }] }, carlos)).status, 403);
  await ok('PUT', `/api/pedidos/${id}/gestion`, { asignado_id: carlosId }, leo);
  await ok('POST', `/api/pedidos/${id}/recepcion`, { folio: 'X', lineas: [{ insumo: pollo.id, recibido: 5 }] }, carlos);

  // Reservado a administración.
  assert.equal((await llamar('PUT', `/api/pedidos/${id}/gestion`, { precios: [{ insumo: pollo.id, precio: 1 }] }, carlos)).status, 403);
  assert.equal((await llamar('PUT', '/api/proveedores/1', { nombre: 'X', tipo: 'correo', contacto: 'a@b.c' }, carlos)).status, 403);
  assert.equal((await llamar('POST', '/api/usuarios', { nombre: 'Y', rol: 'admin', area: 'x', pin: '5678' }, carlos)).status, 403);
  assert.equal((await llamar('PUT', `/api/insumos/${pollo.id}`, { nombre: 'X', categoria_id: 1, unidad: 'kg', min: 1, max: 2, costo: 1 }, carlos)).status, 403);
  assert.equal((await llamar('POST', '/api/recetas', { nombre: 'R', porciones: 1, lineas: [{ insumo: pollo.id, neta: 1 }] }, carlos)).status, 403);
});

test('receta: consumo, merma prevista contra adicional, costo y sin duplicar', async () => {
  const e = await estado(leo);
  const leche = e.insumos.find(i => i.nombre === 'Leche entera');
  const queso = e.insumos.find(i => i.nombre === 'Queso fresco');
  const ins = i => ({ nombre: i.nombre, categoria_id: i.categoria_id, unidad: i.unidad, min: i.min, max: i.max, codigo: i.codigo, proveedor_id: i.proveedor_id, activo: 1 });
  await ok('PUT', `/api/insumos/${leche.id}`, { ...ins(leche), rendimiento: 50, costo: 20 }, leo);
  await ok('PUT', `/api/insumos/${queso.id}`, { ...ins(queso), rendimiento: 80 }, leo);
  assert.equal((await llamar('PUT', `/api/insumos/${leche.id}`, { ...ins(leche), rendimiento: 0 }, leo)).status, 400);
  const quesoAntes = (await estado(leo)).insumos.find(i => i.id === queso.id).stock;
  const lecheAntes = (await estado(leo)).insumos.find(i => i.id === leche.id).stock;
  assert.equal((await estado(leo)).insumos.find(i => i.id === leche.id).aprovechable, lecheAntes * 0.5);
  assert.equal((await llamar('POST', '/api/recetas', { nombre: 'Mala', porciones: 2, lineas: [{ insumo: leche.id, neta: 1, merma: 100 }] }, leo)).status, 400);

  // Queso con merma 10 % en receta: ignora su rendimiento de 80 %. Leche sin merma: usa rendimiento de 50 %.
  const { id } = await ok('POST', '/api/recetas', { nombre: 'Salsa', porciones: 2, lineas: [{ insumo: queso.id, neta: 0.9, merma: 10 }, { insumo: leche.id, neta: 0.5 }] }, leo);
  let r = (await estado(leo)).recetas.find(x => x.id === id);
  const lq = r.lineas.find(l => l.insumo_id === queso.id), ll = r.lineas.find(l => l.insumo_id === leche.id);
  assert.deepEqual([lq.bruta, lq.fuente], [1, 'receta']);
  assert.deepEqual([ll.bruta, ll.fuente], [1, 'rendimiento']);
  assert.equal(r.costo, null, 'sin precio de queso no se inventa el costo');
  assert.deepEqual(r.sin_precio, ['Queso fresco']);
  await ok('PUT', `/api/insumos/${queso.id}`, { ...ins(queso), rendimiento: 80, costo: 100 }, leo);
  r = (await estado(leo)).recetas.find(x => x.id === id);
  assert.equal(r.costo, 120);
  assert.equal(r.costo_porcion, 60);

  // Producir 4 porciones = doble de la receta.
  const clave = 'clave-produccion-1';
  const p = await ok('POST', `/api/recetas/${id}/produccion`, { porciones: 4, clave }, juan);
  const rep = await ok('POST', `/api/recetas/${id}/produccion`, { porciones: 4, clave }, juan);
  assert.equal(rep.id, p.id);
  let f = await estado(leo);
  assert.equal(f.insumos.find(i => i.id === queso.id).stock, quesoAntes - 2);
  assert.equal(f.insumos.find(i => i.id === leche.id).stock, lecheAntes - 2);
  assert.equal(f.movimientos.filter(m => m.ref === `produccion:${p.id}`).length, 2);
  assert.equal((await llamar('POST', `/api/recetas/${id}/produccion`, { porciones: 2 }, carlos)).status, 403);

  const mq = f.merma.find(m => m.insumo_id === queso.id);
  assert.equal(mq.prevista, 0.2);
  assert.equal(mq.adicional, 0);

  // Merma adicional: aparte de la prevista, una sola salida.
  await ok('POST', '/api/mermas', { insumo: queso.id, cantidad: 0.5, motivo: 'Se cayó', clave: 'clave-merma-0001' }, carlos);
  await ok('POST', '/api/mermas', { insumo: queso.id, cantidad: 0.5, motivo: 'Se cayó', clave: 'clave-merma-0001' }, carlos);
  assert.equal((await llamar('POST', '/api/mermas', { insumo: queso.id, cantidad: 1, motivo: '' }, carlos)).status, 400);
  f = await estado(leo);
  assert.equal(f.insumos.find(i => i.id === queso.id).stock, quesoAntes - 2.5);
  const m2 = f.merma.find(m => m.insumo_id === queso.id);
  assert.deepEqual([m2.prevista, m2.adicional], [0.2, 0.5]);

  // No alcanza: no descuenta nada.
  const stockFinal = f.insumos.find(i => i.id === leche.id).stock;
  assert.equal((await llamar('POST', `/api/recetas/${id}/produccion`, { porciones: 100000 }, juan)).status, 409);
  assert.equal((await estado(leo)).insumos.find(i => i.id === leche.id).stock, stockFinal);
});

test('corrección de recepción: solo admin, ajusta por diferencia, conserva el original y versiona la remisión', async () => {
  const { id, pollo } = await pedidoPollo(20);
  const antes = await stock('Pollo (pechuga)');
  const r = await ok('POST', `/api/pedidos/${id}/recepcion`, { folio: 'NOTA-C1', lineas: [{ insumo: pollo.id, recibido: 20, aceptado: 20 }] }, carlos);
  const rem = await ok('POST', `/api/recepciones/${r.id}/remision`, {}, carlos);
  await ok('POST', `/api/remisiones/${rem.id}/emitir`, {}, carlos);
  const ruta = `/api/recepciones/${r.id}/correccion`;
  const cuerpo = { clave: 'clave-correccion-01', motivo: 'Se capturó 20, llegaron 12', lineas: [{ insumo: pollo.id, aceptado: 12 }] };

  // Permisos en el servidor y validaciones.
  assert.equal((await llamar('POST', ruta, cuerpo, carlos)).status, 403);
  assert.equal((await llamar('POST', ruta, cuerpo, juan)).status, 403);
  assert.equal((await llamar('POST', ruta, { ...cuerpo, motivo: '' }, leo)).status, 400);
  assert.equal((await llamar('POST', ruta, { ...cuerpo, lineas: [{ insumo: pollo.id, aceptado: 21 }] }, leo)).status, 400, 'no se acepta más de lo pedido');
  assert.equal((await llamar('POST', ruta, { ...cuerpo, lineas: [{ insumo: pollo.id, aceptado: 20 }] }, leo)).status, 400, 'sin cambios');

  const c = await ok('POST', ruta, cuerpo, leo);
  assert.equal(await stock('Pollo (pechuga)'), antes + 12);
  // Reintento con la misma clave: no vuelve a mover inventario.
  assert.equal((await ok('POST', ruta, cuerpo, leo)).repetida, true);
  assert.equal(await stock('Pollo (pechuga)'), antes + 12);
  assert.equal((await movs('correccion_recepcion', `correccion:${c.id}`))[0].delta, -8);

  let e = await estado(leo);
  const rec = e.recepciones.find(x => x.id === r.id);
  assert.equal(rec.lineas[0].aceptado, 20, 'la captura original no cambia');
  assert.equal(rec.lineas[0].aceptado + rec.lineas[0].ajuste, 12);
  assert.deepEqual(rec.correcciones[0].lineas.map(l => [l.antes, l.nuevo]), [[20, 12]]);
  const ped = e.pedidos.find(p => p.id === id);
  assert.equal(ped.estado, 'en_proceso', 'vuelve a esperar lo que falta');
  assert.equal(e.incidencias.find(i => i.pedido_id === id && i.tipo === 'faltante' && i.estado === 'abierta').cantidad, 8);
  const vigente = e.remisiones.find(x => x.recepcion_id === r.id && x.estado !== 'reemplazada');
  assert.equal(vigente.version, 2);
  assert.equal(vigente.estado, 'borrador');
  assert.equal(vigente.contenido.lineas[0].aceptada, 12);

  // Se corrige al alza hasta completar: el pedido se cierra otra vez.
  await ok('POST', ruta, { motivo: 'Sí llegaron los 20', lineas: [{ insumo: pollo.id, aceptado: 20 }] }, leo);
  e = await estado(leo);
  assert.equal(e.pedidos.find(p => p.id === id).estado, 'recibido');
  assert.equal(e.incidencias.filter(i => i.pedido_id === id && i.tipo === 'faltante' && i.estado === 'abierta').length, 0);
  assert.equal(await stock('Pollo (pechuga)'), antes + 20);

  // No se baja por debajo de lo ya devuelto.
  await ok('POST', `/api/pedidos/${id}/devoluciones`, { comprobante: 'DEV-C1', motivo: 'Mal estado', lineas: [{ insumo: pollo.id, cantidad: 15 }] }, carlos);
  assert.equal((await llamar('POST', ruta, { motivo: 'x', lineas: [{ insumo: pollo.id, aceptado: 4 }] }, leo)).status, 400);
});

test('presentaciones: pedido en cajas se guarda en kg, recepción suma kg, solo admin las crea y no se borran', async () => {
  const e0 = await estado(leo);
  const pollo = e0.insumos.find(i => i.nombre === 'Pollo (pechuga)');
  const arroz = e0.insumos.find(i => i.nombre === 'Arroz');
  assert.equal((await llamar('POST', `/api/insumos/${pollo.id}/presentaciones`, { nombre: 'Bolsa', contenido: 5 }, carlos)).status, 403);
  assert.equal((await llamar('POST', `/api/insumos/${pollo.id}/presentaciones`, { nombre: 'Bolsa', contenido: 0 }, leo)).status, 400);
  const { id: bolsa } = await ok('POST', `/api/insumos/${pollo.id}/presentaciones`, { nombre: 'Bolsa', contenido: 5 }, leo);
  assert.equal((await llamar('POST', `/api/insumos/${pollo.id}/presentaciones`, { nombre: 'Bolsa', contenido: 6 }, leo)).status, 409);

  // Una presentación de otro insumo no se acepta.
  assert.equal((await llamar('POST', '/api/pedidos', { proveedor_id: 1, fecha_entrega: '2030-01-01', lineas: [{ insumo: arroz.id, presentacion: bolsa, cantidad: 2 }] }, leo)).status, 400);

  const { id } = await ok('POST', '/api/pedidos', { proveedor_id: 1, fecha_entrega: '2030-01-01', lineas: [{ insumo: pollo.id, presentacion: bolsa, cantidad: 3, precio: 80 }] }, leo);
  let ped = (await estado(leo)).pedidos.find(p => p.id === id);
  assert.deepEqual([ped.lineas[0].cantidad, ped.lineas[0].presentacion, ped.lineas[0].factor], [15, 'Bolsa', 5]);

  const antes = await stock('Pollo (pechuga)');
  await ok('POST', `/api/pedidos/${id}/recepcion`, { folio: 'NOTA-P1', lineas: [{ insumo: pollo.id, recibido: 15 }] }, carlos);
  assert.equal(await stock('Pollo (pechuga)'), antes + 15);

  // No vigente: ya no se puede pedir, pero el pedido viejo conserva su conversión.
  await ok('PUT', `/api/presentaciones/${bolsa}`, { activo: false }, leo);
  assert.equal((await llamar('POST', '/api/pedidos', { proveedor_id: 1, fecha_entrega: '2030-01-01', lineas: [{ insumo: pollo.id, presentacion: bolsa, cantidad: 1 }] }, leo)).status, 400);
  ped = (await estado(leo)).pedidos.find(p => p.id === id);
  assert.equal(ped.lineas[0].factor, 5);
  assert.equal((await estado(leo)).presentaciones.find(p => p.id === bolsa).activo, 0, 'se conserva como no vigente');
});
