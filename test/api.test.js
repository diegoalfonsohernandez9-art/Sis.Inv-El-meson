'use strict';
process.env.PIN_INICIAL = '1234';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { crearApp } = require('../server');

let server, base;
const LEO = 1, JUAN = 2;

async function llamar(metodo, ruta, cuerpo, cookie) {
  const r = await fetch(base + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  return { status: r.status, datos: await r.json(), cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}
const entrar = async id => (await llamar('POST', '/api/login', { usuario_id: id, pin: '1234' })).cookie;
const estado = async c => (await llamar('GET', '/api/estado', undefined, c)).datos;
const stock = (e, nombre) => e.insumos.find(i => i.nombre === nombre);

before(async () => {
  server = crearApp(':memory:');
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('exige sesión y no deja a staff autorizar', async () => {
  assert.equal((await llamar('GET', '/api/estado')).status, 401);
  const juan = await entrar(JUAN);
  assert.equal((await llamar('POST', '/api/solicitudes/1043/autorizar', { fecha_entrega: '2030-01-01', lineas: [{ insumo: 1 }] }, juan)).status, 403);
  assert.deepEqual((await estado(juan)).usuarios, []);
});

test('bloquea tras cinco PIN incorrectos', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await llamar('POST', '/api/login', { usuario_id: 3, pin: '0000' })).status, 401);
  assert.equal((await llamar('POST', '/api/login', { usuario_id: 3, pin: '1234' })).status, 429);
});

test('el conteo ajusta stock, audita y alerta al cruzar el mínimo', async () => {
  const leo = await entrar(LEO);
  const antes = await estado(leo);
  const queso = stock(antes, 'Queso fresco');
  const r = await llamar('POST', '/api/conteos', { categoria_id: 1, lineas: [{ insumo: queso.id, cantidad: '4.5' }] }, leo);
  assert.equal(r.status, 200);
  const e = await estado(leo);
  assert.equal(stock(e, 'Queso fresco').stock, 4.5);
  assert.equal(e.movimientos[0].delta, -7.5);
  assert.ok(e.eventos.some(ev => ev.titulo === 'Queso fresco en bajo mínimo'));
});

test('un conteo inválido no aplica nada', async () => {
  const leo = await entrar(LEO);
  const e = await estado(leo);
  const [a, b] = e.insumos.filter(i => i.categoria_id === 2);
  for (const mala of ['', -1, 'abc', null]) {
    const r = await llamar('POST', '/api/conteos', { categoria_id: 2, lineas: [{ insumo: a.id, cantidad: 999 }, { insumo: b.id, cantidad: mala }] }, leo);
    assert.equal(r.status, 400);
  }
  assert.equal(stock(await estado(leo), a.nombre).stock, a.stock);
});

test('flujo completo: solicitud, autorización por proveedor y recepción', async () => {
  const juan = await entrar(JUAN), leo = await entrar(LEO);
  const e = await estado(leo);
  const pollo = stock(e, 'Pollo (pechuga)'), leche = stock(e, 'Leche entera');
  const { datos: { id } } = await llamar('POST', '/api/solicitudes', { lineas: [{ insumo: pollo.id, cantidad: 20 }, { insumo: leche.id, cantidad: 24 }] }, juan);

  const aut = { fecha_entrega: '2030-01-01', lineas: [{ insumo: pollo.id, proveedor: 1 }, { insumo: leche.id, proveedor: 3 }] };
  assert.equal((await llamar('POST', `/api/solicitudes/${id}/autorizar`, aut, leo)).status, 200);
  assert.equal((await llamar('POST', `/api/solicitudes/${id}/autorizar`, aut, leo)).status, 409);

  const pedidos = (await estado(leo)).pedidos.filter(p => p.solicitud_id === id);
  assert.equal(pedidos.length, 2);

  const delPollo = pedidos.find(p => p.proveedor_id === 1);
  const rec = { folio: 'REM-1', desinfeccion: true, lineas: [{ insumo: pollo.id, recibido: 18 }] };
  assert.equal((await llamar('POST', `/api/pedidos/${delPollo.id}/recepcion`, { ...rec, folio: '' }, juan)).status, 400);
  assert.equal((await llamar('POST', `/api/pedidos/${delPollo.id}/recepcion`, rec, juan)).status, 200);
  assert.equal((await llamar('POST', `/api/pedidos/${delPollo.id}/recepcion`, rec, juan)).status, 400);

  const fin = await estado(leo);
  assert.equal(stock(fin, 'Pollo (pechuga)').stock, pollo.stock + 18);
  assert.equal(fin.pedidos.find(p => p.id === delPollo.id).entrega, 'recibida_parcial');
});

test('autorizar sin proveedor falla sin crear pedidos', async () => {
  const leo = await entrar(LEO);
  const e = await estado(leo);
  const arroz = stock(e, 'Arroz');
  const { datos: { id } } = await llamar('POST', '/api/solicitudes', { lineas: [{ insumo: arroz.id, cantidad: 5 }] }, leo);
  const r = await llamar('POST', `/api/solicitudes/${id}/autorizar`, { fecha_entrega: '2030-01-01', lineas: [{ insumo: arroz.id }] }, leo);
  assert.equal(r.status, 400);
  assert.equal((await estado(leo)).pedidos.length, e.pedidos.length);
});

test('el proveedor solo ve lo suyo y no entra a rutas internas', async () => {
  const leo = await entrar(LEO);
  const usuarios = (await estado(leo)).usuarios;
  const central = usuarios.find(u => u.nombre === 'Distribuidora Central');
  const bajio = usuarios.find(u => u.nombre === 'Alimentos del Bajío');
  const c = await entrar(central.id), b = await entrar(bajio.id);

  const e = await estado(c);
  assert.deepEqual(Object.keys(e).sort(), ['me', 'pedidos', 'proveedor', 'remisiones']);
  assert.ok(e.pedidos.some(p => p.id === 2048));
  assert.ok(e.pedidos.every(p => !('nota' in p) && !('receptor_id' in p)));
  assert.ok(!JSON.stringify(e).includes('pin_hash'));
  assert.ok(!(await estado(b)).pedidos.some(p => p.id === 2048));

  assert.equal((await llamar('POST', '/api/conteos', { categoria_id: 1, lineas: [{ insumo: 1, cantidad: 1 }] }, c)).status, 403);
  assert.equal((await llamar('POST', '/api/solicitudes', { lineas: [{ insumo: 1, cantidad: 1 }] }, c)).status, 403);
  assert.equal((await llamar('POST', '/api/pedidos/2048/recepcion', { folio: 'x', lineas: [{ insumo: 1, recibido: 1 }] }, c)).status, 403);
  assert.equal((await llamar('POST', '/api/insumos', {}, c)).status, 403);
  assert.equal((await llamar('POST', '/api/proveedor/pedidos/2048/avance', { promesa: '2030-01-01' }, leo)).status, 403);
});

test('el proveedor avanza su pedido en orden y no el de otro', async () => {
  const leo = await entrar(LEO);
  const usuarios = (await estado(leo)).usuarios;
  const c = await entrar(usuarios.find(u => u.nombre === 'Distribuidora Central').id);
  const b = await entrar(usuarios.find(u => u.nombre === 'Alimentos del Bajío').id);
  const avance = (cookie, cuerpo) => llamar('POST', '/api/proveedor/pedidos/2048/avance', cuerpo, cookie);

  assert.equal((await avance(b, { promesa: '2030-01-01' })).status, 404);
  assert.equal((await avance(c, {})).status, 400);
  assert.equal((await avance(c, { promesa: '2030-01-01' })).status, 200);
  assert.equal((await avance(c, {})).status, 200);
  assert.equal((await avance(c, {})).status, 409);
  assert.equal((await llamar('POST', '/api/proveedor/pedidos/2048/problema', { nota: 'Llego tarde' }, c)).status, 200);

  const p = (await estado(leo)).pedidos.find(x => x.id === 2048);
  assert.equal(p.avance, 'en_camino');
  assert.equal(p.promesa, '2030-01-01');
  assert.equal(p.nota_proveedor, 'Llego tarde');
});

test('un usuario proveedor exige un proveedor válido', async () => {
  const leo = await entrar(LEO);
  const r = await llamar('POST', '/api/usuarios', { nombre: 'Sin prov', rol: 'proveedor', area: 'x', pin: '5678' }, leo);
  assert.equal(r.status, 400);
});

test('la migración v0 → v1 conserva datos y deja respaldo', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const { abrirDb } = require('../db');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meson-'));
  const ruta = path.join(dir, 'v0.db');
  const v0 = new DatabaseSync(ruta);
  v0.exec(`
    CREATE TABLE usuarios (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL UNIQUE, rol TEXT NOT NULL CHECK (rol IN ('admin','staff')), area TEXT NOT NULL, pin_hash TEXT NOT NULL, activo INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE proveedores (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL UNIQUE);
    CREATE TABLE sesiones (token_hash TEXT PRIMARY KEY, usuario_id INTEGER NOT NULL REFERENCES usuarios(id), expira INTEGER NOT NULL);
    CREATE TABLE insumos (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, unidad TEXT NOT NULL);
    CREATE TABLE movimientos (id INTEGER PRIMARY KEY, insumo_id INTEGER);
    CREATE TABLE pedido_lineas (pedido_id INTEGER NOT NULL, insumo_id INTEGER NOT NULL, cantidad REAL NOT NULL, recibido REAL, PRIMARY KEY (pedido_id, insumo_id));
    CREATE TABLE pedidos (id INTEGER PRIMARY KEY AUTOINCREMENT, proveedor_id INTEGER NOT NULL REFERENCES proveedores(id), estado TEXT NOT NULL, receptor_id INTEGER REFERENCES usuarios(id), recibido TEXT, folio TEXT, desinfeccion INTEGER, nota TEXT);
    INSERT INTO usuarios VALUES (7, 'Ana', 'admin', 'Adm', 'sal:hash', 0);
    INSERT INTO proveedores VALUES (1, 'P');
    INSERT INTO sesiones VALUES ('t', 7, 1);
    INSERT INTO insumos VALUES (1, 'Pollo', 'kg');
    INSERT INTO pedidos VALUES (2048, 1, 'diferencia', 7, '2026-01-01T00:00:00Z', 'REM-1', 1, NULL);
    INSERT INTO pedido_lineas VALUES (2048, 1, 20, 18);
  `);
  v0.close();

  const db = abrirDb(ruta);
  assert.ok(fs.existsSync(`${ruta}.respaldo-v0`));
  const u = db.prepare('SELECT * FROM usuarios').get();
  assert.equal(u.nombre, 'Ana');
  assert.equal(u.pin_hash, 'sal:hash');
  assert.equal(u.activo, 0);
  assert.equal(db.prepare('SELECT avance FROM pedidos').get().avance, 'por_confirmar');
  assert.ok(fs.existsSync(`${ruta}.respaldo-v1`));
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 6);
  assert.ok(fs.existsSync(`${ruta}.respaldo-v4`));
  assert.ok(fs.existsSync(`${ruta}.respaldo-v5`));
  assert.ok(fs.existsSync(`${ruta}.respaldo-v2`));
  assert.ok(fs.existsSync(`${ruta}.respaldo-v3`));
  const pl = db.prepare('SELECT aceptado, recibido FROM pedido_lineas').get();
  assert.deepEqual([pl.aceptado, pl.recibido], [18, 18], 'lo recibido antes ya estaba en inventario');
  const rec = db.prepare('SELECT * FROM recepciones').get();
  assert.deepEqual([rec.pedido_id, rec.folio, rec.usuario_id], [2048, 'REM-1', 7]);
  assert.equal(db.prepare('SELECT pendiente FROM recepcion_lineas').get().pendiente, 2);
  db.prepare("INSERT INTO usuarios (nombre, rol, area, pin_hash, proveedor_id) VALUES ('Q','proveedor','x','s:h',1)").run();
  db.prepare("INSERT INTO usuarios (nombre, rol, area, pin_hash) VALUES ('R','auxiliar','x','s:h')").run();
  assert.throws(() => db.prepare("INSERT INTO sesiones VALUES ('z', 999, 1)").run(), /FOREIGN KEY/);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  db.close();

  const otra = abrirDb(ruta);
  assert.equal(otra.prepare('SELECT COUNT(*) n FROM usuarios').get().n, 3);
  otra.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('un usuario desactivado pierde la sesión', async () => {
  const leo = await entrar(LEO);
  await llamar('POST', '/api/usuarios', { nombre: 'Temporal', rol: 'staff', area: 'Barra', pin: '5678' }, leo);
  const t = (await estado(leo)).usuarios.find(u => u.nombre === 'Temporal');
  const c = (await llamar('POST', '/api/login', { usuario_id: t.id, pin: '5678' })).cookie;
  await llamar('PUT', `/api/usuarios/${t.id}`, { nombre: 'Temporal', rol: 'staff', area: 'Barra', activo: false }, leo);
  assert.equal((await llamar('GET', '/api/estado', undefined, c)).status, 401);
});

test('una presentación no se borra ni cambia su contenido en la base', () => {
  const { abrirDb } = require('../db');
  const db = abrirDb(':memory:');
  const p = db.prepare('SELECT id FROM presentaciones LIMIT 1').get();
  assert.throws(() => db.prepare('DELETE FROM presentaciones WHERE id = ?').run(p.id), /no se borra/);
  assert.throws(() => db.prepare('UPDATE presentaciones SET contenido = 99 WHERE id = ?').run(p.id), /no se modifica/);
  db.prepare('UPDATE presentaciones SET activo = 0 WHERE id = ?').run(p.id);
});

test('modo sin PIN: entra eligiendo el usuario, los permisos por rol siguen y por defecto se pide PIN', async () => {
  const dev = crearApp(':memory:', { sinPin: true });
  await new Promise(r => dev.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${dev.address().port}`;
  try {
    assert.deepEqual(await (await fetch(url + '/api/config')).json(), { sin_pin: true });
    const us = await (await fetch(url + '/api/usuarios')).json();
    const entrar = async nombre => (await fetch(url + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario_id: us.find(u => u.nombre === nombre).id }) }));
    const r = await entrar('Juan Pérez');
    assert.equal(r.status, 200);
    const cookie = r.headers.get('set-cookie').split(';')[0];
    const nuevo = await fetch(url + '/api/insumos', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ nombre: 'X', categoria_id: 1, unidad: 'kg', stock: 0, min: 0, max: 1 }) });
    assert.equal(nuevo.status, 403, 'Cocina sigue sin poder hacer lo de Administración');
  } finally { dev.close(); }
  const normal = await (await fetch(base + '/api/config')).json();
  assert.equal(normal.sin_pin, false);
  const us = await (await fetch(base + '/api/usuarios')).json();
  const sinPin = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario_id: us[0].id }) });
  assert.equal(sinPin.status, 401, 'sin el modo, el PIN es obligatorio');
});
