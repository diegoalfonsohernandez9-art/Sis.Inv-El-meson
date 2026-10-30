'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE usuarios (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL UNIQUE, rol TEXT NOT NULL CHECK (rol IN ('admin','staff','proveedor')),
  area TEXT NOT NULL, pin_hash TEXT NOT NULL, activo INTEGER NOT NULL DEFAULT 1, proveedor_id INTEGER REFERENCES proveedores(id));
CREATE TABLE sesiones (token_hash TEXT PRIMARY KEY, usuario_id INTEGER NOT NULL REFERENCES usuarios(id), expira INTEGER NOT NULL);
CREATE TABLE categorias (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL UNIQUE, icono TEXT NOT NULL, foto TEXT);
CREATE TABLE proveedores (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL UNIQUE, tipo TEXT NOT NULL CHECK (tipo IN ('whatsapp','telefono','correo')), contacto TEXT NOT NULL);
CREATE TABLE insumos (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, categoria_id INTEGER NOT NULL REFERENCES categorias(id), unidad TEXT NOT NULL,
  stock REAL NOT NULL CHECK (stock >= 0), min REAL NOT NULL, max REAL NOT NULL, codigo TEXT UNIQUE, foto TEXT,
  proveedor_id INTEGER REFERENCES proveedores(id), activo INTEGER NOT NULL DEFAULT 1);
CREATE TABLE conteos (id INTEGER PRIMARY KEY, categoria_id INTEGER NOT NULL REFERENCES categorias(id), usuario_id INTEGER NOT NULL REFERENCES usuarios(id), creado TEXT NOT NULL);
CREATE TABLE movimientos (id INTEGER PRIMARY KEY, insumo_id INTEGER NOT NULL REFERENCES insumos(id), tipo TEXT NOT NULL, delta REAL NOT NULL,
  stock_final REAL NOT NULL, usuario_id INTEGER NOT NULL REFERENCES usuarios(id), creado TEXT NOT NULL);
CREATE TABLE solicitudes (id INTEGER PRIMARY KEY AUTOINCREMENT, estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','autorizada','rechazada')),
  solicitante_id INTEGER NOT NULL REFERENCES usuarios(id), creado TEXT NOT NULL, comentario TEXT NOT NULL DEFAULT '', fecha_entrega TEXT,
  revisor_id INTEGER REFERENCES usuarios(id), revisado TEXT, motivo TEXT);
CREATE TABLE solicitud_lineas (solicitud_id INTEGER NOT NULL REFERENCES solicitudes(id), insumo_id INTEGER NOT NULL REFERENCES insumos(id),
  cantidad REAL NOT NULL, proveedor_id INTEGER REFERENCES proveedores(id), PRIMARY KEY (solicitud_id, insumo_id));
CREATE TABLE pedidos (id INTEGER PRIMARY KEY AUTOINCREMENT, solicitud_id INTEGER REFERENCES solicitudes(id), proveedor_id INTEGER NOT NULL REFERENCES proveedores(id),
  estado TEXT NOT NULL DEFAULT 'en_proceso' CHECK (estado IN ('en_proceso','recibido','diferencia')), creado TEXT NOT NULL, fecha_entrega TEXT,
  receptor_id INTEGER REFERENCES usuarios(id), recibido TEXT, folio TEXT, desinfeccion INTEGER, nota TEXT,
  avance TEXT NOT NULL DEFAULT 'por_confirmar' CHECK (avance IN ('por_confirmar','confirmado','en_camino')), promesa TEXT, nota_proveedor TEXT);
CREATE TABLE pedido_lineas (pedido_id INTEGER NOT NULL REFERENCES pedidos(id), insumo_id INTEGER NOT NULL REFERENCES insumos(id),
  cantidad REAL NOT NULL, recibido REAL, PRIMARY KEY (pedido_id, insumo_id));
CREATE TABLE eventos (id INTEGER PRIMARY KEY, tipo TEXT NOT NULL, titulo TEXT NOT NULL, detalle TEXT NOT NULL, ref TEXT, creado TEXT NOT NULL);
`;

const MIGRACION_V2 = `
CREATE TABLE usuarios_v2 (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL UNIQUE, rol TEXT NOT NULL CHECK (rol IN ('admin','staff','auxiliar','proveedor')),
  area TEXT NOT NULL, pin_hash TEXT NOT NULL, activo INTEGER NOT NULL DEFAULT 1, proveedor_id INTEGER REFERENCES proveedores(id));
INSERT INTO usuarios_v2 SELECT id, nombre, rol, area, pin_hash, activo, proveedor_id FROM usuarios;
DROP TABLE usuarios;
ALTER TABLE usuarios_v2 RENAME TO usuarios;

ALTER TABLE insumos ADD COLUMN rendimiento REAL;
ALTER TABLE insumos ADD COLUMN costo REAL;
ALTER TABLE proveedores ADD COLUMN razon_social TEXT;
ALTER TABLE proveedores ADD COLUMN rfc TEXT;
ALTER TABLE proveedores ADD COLUMN domicilio_fiscal TEXT;
ALTER TABLE proveedores ADD COLUMN cp TEXT;
ALTER TABLE proveedores ADD COLUMN regimen_fiscal TEXT;
ALTER TABLE proveedores ADD COLUMN contacto_nombre TEXT;
ALTER TABLE proveedores ADD COLUMN telefono TEXT;
ALTER TABLE proveedores ADD COLUMN correo TEXT;
ALTER TABLE pedidos ADD COLUMN asignado_id INTEGER REFERENCES usuarios(id);
ALTER TABLE pedido_lineas ADD COLUMN aceptado REAL NOT NULL DEFAULT 0;
ALTER TABLE pedido_lineas ADD COLUMN rechazado REAL NOT NULL DEFAULT 0;
ALTER TABLE pedido_lineas ADD COLUMN devuelto REAL NOT NULL DEFAULT 0;
ALTER TABLE pedido_lineas ADD COLUMN precio REAL;
ALTER TABLE pedido_lineas ADD COLUMN cerrado INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pedido_lineas ADD COLUMN cierre_motivo TEXT;
ALTER TABLE movimientos ADD COLUMN ref TEXT;
ALTER TABLE movimientos ADD COLUMN nota TEXT;

CREATE TABLE recepciones (id INTEGER PRIMARY KEY AUTOINCREMENT, pedido_id INTEGER NOT NULL REFERENCES pedidos(id), folio TEXT NOT NULL, usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  creado TEXT NOT NULL, desinfeccion INTEGER NOT NULL DEFAULT 0, notas TEXT, estado TEXT NOT NULL CHECK (estado IN ('aceptada','recibida_parcial','rechazada')), clave TEXT UNIQUE,
  doc_estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (doc_estado IN ('pendiente','revisada','con_observaciones')), checklist TEXT, checklist_notas TEXT, revisor TEXT, revisado TEXT);
CREATE TABLE recepcion_lineas (recepcion_id INTEGER NOT NULL REFERENCES recepciones(id), insumo_id INTEGER NOT NULL REFERENCES insumos(id), unidad TEXT NOT NULL,
  pedida REAL NOT NULL, esperada REAL NOT NULL, recibido REAL NOT NULL, aceptado REAL NOT NULL, rechazado REAL NOT NULL, pendiente REAL NOT NULL, motivo TEXT, nota TEXT, PRIMARY KEY (recepcion_id, insumo_id));
CREATE TABLE incidencias (id INTEGER PRIMARY KEY, recepcion_id INTEGER NOT NULL REFERENCES recepciones(id), pedido_id INTEGER NOT NULL REFERENCES pedidos(id), proveedor_id INTEGER NOT NULL REFERENCES proveedores(id),
  insumo_id INTEGER NOT NULL REFERENCES insumos(id), tipo TEXT NOT NULL CHECK (tipo IN ('faltante','rechazo','dano','observacion')), cantidad REAL NOT NULL, unidad TEXT NOT NULL, motivo TEXT, nota TEXT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id), creado TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta','cerrada')), cierre_nota TEXT, cerrado TEXT);
CREATE TABLE devoluciones (id INTEGER PRIMARY KEY AUTOINCREMENT, pedido_id INTEGER NOT NULL REFERENCES pedidos(id), proveedor_id INTEGER NOT NULL REFERENCES proveedores(id), recepcion_id INTEGER REFERENCES recepciones(id),
  comprobante TEXT NOT NULL, motivo TEXT, usuario_id INTEGER NOT NULL REFERENCES usuarios(id), creado TEXT NOT NULL, clave TEXT UNIQUE);
CREATE TABLE devolucion_lineas (devolucion_id INTEGER NOT NULL REFERENCES devoluciones(id), insumo_id INTEGER NOT NULL REFERENCES insumos(id), cantidad REAL NOT NULL, motivo TEXT NOT NULL, PRIMARY KEY (devolucion_id, insumo_id));
CREATE TABLE remisiones (id INTEGER PRIMARY KEY AUTOINCREMENT, folio TEXT NOT NULL, version INTEGER NOT NULL, anterior_id INTEGER REFERENCES remisiones(id), recepcion_id INTEGER NOT NULL REFERENCES recepciones(id),
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id), proveedor_id INTEGER NOT NULL REFERENCES proveedores(id), estado TEXT NOT NULL CHECK (estado IN ('borrador','emitida','devuelta','reemplazada')),
  contenido TEXT NOT NULL, devolucion TEXT, obs_resueltas INTEGER NOT NULL DEFAULT 0, compartida INTEGER NOT NULL DEFAULT 0, creado TEXT NOT NULL, creado_por TEXT NOT NULL, UNIQUE (folio, version));
CREATE TABLE remision_historial (id INTEGER PRIMARY KEY, remision_id INTEGER NOT NULL REFERENCES remisiones(id), accion TEXT NOT NULL, detalle TEXT NOT NULL, usuario TEXT NOT NULL, creado TEXT NOT NULL);
CREATE TABLE firmas (remision_id INTEGER NOT NULL REFERENCES remisiones(id), papel TEXT NOT NULL CHECK (papel IN ('entrega','recibe')), nombre TEXT NOT NULL, funcion TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('firmada','no_firmo')), trazos TEXT, motivo TEXT, usuario_id INTEGER NOT NULL REFERENCES usuarios(id), creado TEXT NOT NULL, PRIMARY KEY (remision_id, papel));
CREATE TABLE envios (id INTEGER PRIMARY KEY, remision_id INTEGER NOT NULL REFERENCES remisiones(id), canal TEXT NOT NULL, destinatario TEXT NOT NULL, resultado TEXT NOT NULL CHECK (resultado IN ('publicada','compartida_manual','error')),
  detalle TEXT NOT NULL, usuario TEXT NOT NULL, creado TEXT NOT NULL);
CREATE TABLE documentos (id INTEGER PRIMARY KEY, tipo TEXT NOT NULL, nombre TEXT NOT NULL, mime TEXT NOT NULL, tam INTEGER NOT NULL, archivo TEXT NOT NULL UNIQUE, folio TEXT, proveedor_id INTEGER NOT NULL REFERENCES proveedores(id),
  pedido_id INTEGER REFERENCES pedidos(id), recepcion_id INTEGER REFERENCES recepciones(id), remision_id INTEGER REFERENCES remisiones(id), devolucion_id INTEGER REFERENCES devoluciones(id), insumo_id INTEGER REFERENCES insumos(id), usuario TEXT NOT NULL, creado TEXT NOT NULL);
CREATE TABLE recetas (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL UNIQUE, porciones REAL NOT NULL, notas TEXT);
CREATE TABLE receta_lineas (receta_id INTEGER NOT NULL REFERENCES recetas(id), insumo_id INTEGER NOT NULL REFERENCES insumos(id), neta REAL NOT NULL, merma REAL, PRIMARY KEY (receta_id, insumo_id));
CREATE TABLE producciones (id INTEGER PRIMARY KEY AUTOINCREMENT, receta_id INTEGER NOT NULL REFERENCES recetas(id), porciones REAL NOT NULL, usuario_id INTEGER NOT NULL REFERENCES usuarios(id), creado TEXT NOT NULL, clave TEXT UNIQUE);
CREATE TABLE produccion_lineas (produccion_id INTEGER NOT NULL REFERENCES producciones(id), insumo_id INTEGER NOT NULL REFERENCES insumos(id), neta REAL NOT NULL, bruta REAL NOT NULL, merma_prevista REAL NOT NULL, fuente TEXT NOT NULL, costo REAL, PRIMARY KEY (produccion_id, insumo_id));

-- Lo recibido con el flujo anterior entró completo al inventario: se conserva como aceptado.
UPDATE pedido_lineas SET aceptado = recibido WHERE recibido IS NOT NULL;
INSERT INTO recepciones (pedido_id, folio, usuario_id, creado, desinfeccion, notas, estado, clave)
  SELECT id, COALESCE(folio, 'SIN-FOLIO'), receptor_id, recibido, COALESCE(desinfeccion, 0), nota, 'aceptada', 'migrada-' || id FROM pedidos WHERE estado <> 'en_proceso' AND receptor_id IS NOT NULL;
INSERT INTO recepcion_lineas (recepcion_id, insumo_id, unidad, pedida, esperada, recibido, aceptado, rechazado, pendiente)
  SELECT r.id, l.insumo_id, i.unidad, l.cantidad, l.cantidad, COALESCE(l.recibido, 0), COALESCE(l.recibido, 0), 0, MAX(l.cantidad - COALESCE(l.recibido, 0), 0)
  FROM recepciones r JOIN pedido_lineas l ON l.pedido_id = r.pedido_id JOIN insumos i ON i.id = l.insumo_id;
`;

function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pin, salt, 32).toString('hex')}`;
}

function pinValido(pin, guardado) {
  const [salt, hash] = guardado.split(':');
  return crypto.timingSafeEqual(crypto.scryptSync(pin, salt, 32), Buffer.from(hash, 'hex'));
}

const haceHoras = h => new Date(Date.now() - h * 3600e3).toISOString();
const enDias = d => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

function crearUsuarios(db, lista) {
  const ins = db.prepare('INSERT INTO usuarios (nombre, rol, area, pin_hash, proveedor_id) VALUES (?,?,?,?,?)');
  for (const [nombre, rol, area, proveedorId = null] of lista) {
    const pin = process.env.PIN_INICIAL || String(crypto.randomInt(100000, 1000000));
    ins.run(nombre, rol, area, hashPin(pin), proveedorId);
    if (!process.env.PIN_INICIAL) console.log(`  PIN inicial de ${nombre}: ${pin}`);
  }
}

function sembrarDemo(db) {
  crearUsuarios(db, [['Leo', 'admin', 'Administración'], ['Juan Pérez', 'staff', 'Cocina'], ['Carlos Méndez', 'auxiliar', 'Almacén']]);

  const prov = db.prepare('INSERT INTO proveedores (nombre, tipo, contacto) VALUES (?,?,?)');
  [['Distribuidora Central', 'whatsapp', '5215512345678'], ['Alimentos del Bajío', 'telefono', '4771234567'],
    ['Lácteos La Senda', 'correo', 'ventas@lacteoslasenda.example'], ['La Mexicana', 'telefono', '5512340000'], ['La Española', 'whatsapp', '5215587654321']]
    .forEach(p => prov.run(...p));
  crearUsuarios(db, [['Distribuidora Central', 'proveedor', 'Proveedor', 1], ['Alimentos del Bajío', 'proveedor', 'Proveedor', 2]]);

  const ins = db.prepare('INSERT INTO insumos (nombre, categoria_id, unidad, stock, min, max, codigo, foto, proveedor_id) VALUES (?,?,?,?,?,?,?,?,?)');
  [['Pollo (pechuga)', 1, 'kg', 2, 10, 40, '7501000000011', 'pollo.png', 1],
    ['Tomate saladet', 1, 'kg', 28, 10, 50, '7501000000028', 'tomate.png', 2],
    ['Jitomate', 1, 'kg', 4, 15, 60, '7501000000035', 'jitomate.png', 2],
    ['Leche entera', 1, 'L', 3, 12, 30, '7501000000042', 'leche.png', 3],
    ['Queso fresco', 1, 'kg', 12, 5, 20, '7501000000059', null, 3],
    ['Cebolla', 1, 'kg', 5, 10, 30, '7501000000066', null, 2],
    ['Tortillas de maíz', 2, 'paquete', 1, 5, 20, '7501000000073', 'tortillas.png', 4],
    ['Arroz', 2, 'kg', 22, 10, 40, '7501000000080', 'arroz.png', 1],
    ['Aceite vegetal', 2, 'L', 2, 5, 20, '7501000000097', 'aceite.png', 5],
    ['Frijol', 2, 'kg', 6, 8, 30, '7501000000103', null, 1],
    ['Azúcar', 2, 'kg', 14, 5, 25, '7501000000110', null, 1],
    ['Refrescos', 3, 'pz', 24, 20, 80, '7501000000127', 'refrescos.png', 1],
    ['Agua mineral', 3, 'pz', 36, 24, 96, '7501000000134', null, 1],
    ['Jugo de naranja', 3, 'L', 9, 6, 24, '7501000000141', null, 3],
    ['Cloro', 4, 'L', 8, 4, 20, '7501000000158', null, 1],
    ['Detergente', 4, 'kg', 3, 5, 20, '7501000000165', null, 1],
    ['Servilletas', 4, 'paquete', 15, 10, 40, '7501000000172', null, 1]]
    .forEach(i => ins.run(...i));

  const idDe = nombre => db.prepare('SELECT id FROM insumos WHERE nombre = ?').get(nombre).id;
  db.prepare("INSERT INTO solicitudes (id, solicitante_id, creado, comentario, fecha_entrega) VALUES (1043, 2, ?, 'Insumos para la semana. Urgente el jitomate.', ?)").run(haceHoras(3), enDias(2));
  const linS = db.prepare('INSERT INTO solicitud_lineas VALUES (1043,?,?,?)');
  [['Jitomate', 40, 2], ['Aceite vegetal', 10, 5], ['Frijol', 15, 1], ['Cebolla', 20, 2], ['Detergente', 10, 1]].forEach(([n, c, p]) => linS.run(idDe(n), c, p));

  db.prepare('INSERT INTO pedidos (id, proveedor_id, creado, fecha_entrega) VALUES (2048, 1, ?, ?)').run(haceHoras(5), enDias(0));
  const linP = db.prepare('INSERT INTO pedido_lineas (pedido_id, insumo_id, cantidad) VALUES (2048,?,?)');
  [['Arroz', 20], ['Azúcar', 10], ['Refrescos', 48], ['Agua mineral', 24]].forEach(([n, c]) => linP.run(idDe(n), c));

  db.prepare('INSERT INTO conteos (categoria_id, usuario_id, creado) VALUES (1, 3, ?)').run(haceHoras(26));
  const ev = db.prepare('INSERT INTO eventos (tipo, titulo, detalle, ref, creado) VALUES (?,?,?,?,?)');
  ev.run('alerta', 'Jitomate en bajo mínimo', 'Stock actual: 4 kg', '#/pedidos', haceHoras(28));
  ev.run('conteo', 'Conteo de Refrigerados', 'Registrado por Carlos Méndez', '#/conteo/1', haceHoras(26));
  ev.run('pedido', 'Pedido #2048', 'En proceso', '#/pedido/2048', haceHoras(5));
  ev.run('solicitud', 'Solicitud #SO-1043', 'Requiere autorización', '#/solicitud/1043', haceHoras(3));
}

// v0 → v1: agrega el rol proveedor (SQLite exige reconstruir la tabla para cambiar un CHECK) y el avance de los pedidos.
function migrar(db, ruta) {
  if (db.prepare('PRAGMA user_version').get().user_version >= 1) return;
  if (ruta !== ':memory:') {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    fs.copyFileSync(ruta, `${ruta}.respaldo-v0`);
  }
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE usuarios_v1 (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL UNIQUE, rol TEXT NOT NULL CHECK (rol IN ('admin','staff','proveedor')),
        area TEXT NOT NULL, pin_hash TEXT NOT NULL, activo INTEGER NOT NULL DEFAULT 1, proveedor_id INTEGER REFERENCES proveedores(id));
      INSERT INTO usuarios_v1 (id, nombre, rol, area, pin_hash, activo) SELECT id, nombre, rol, area, pin_hash, activo FROM usuarios;
      DROP TABLE usuarios;
      ALTER TABLE usuarios_v1 RENAME TO usuarios;
      ALTER TABLE pedidos ADD COLUMN avance TEXT NOT NULL DEFAULT 'por_confirmar' CHECK (avance IN ('por_confirmar','confirmado','en_camino'));
      ALTER TABLE pedidos ADD COLUMN promesa TEXT;
      ALTER TABLE pedidos ADD COLUMN nota_proveedor TEXT;
      PRAGMA user_version = 1;
    `);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

function migrarV2(db, ruta) {
  if (db.prepare('PRAGMA user_version').get().user_version >= 2) return;
  if (ruta !== ':memory:') {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    fs.copyFileSync(ruta, `${ruta}.respaldo-v1`);
  }
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(MIGRACION_V2);
    db.exec('PRAGMA user_version = 2');
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

function abrirDb(ruta) {
  const db = new DatabaseSync(ruta);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  const nueva = !db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'usuarios'").get();
  if (nueva) {
    db.exec(SCHEMA);
    db.exec('PRAGMA user_version = 1');
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec(MIGRACION_V2);
    db.exec('PRAGMA user_version = 2');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('BEGIN');
    const cat = db.prepare('INSERT INTO categorias (nombre, icono, foto) VALUES (?,?,?)');
    [['Refrigerados', 'fridge', 'cat-refrigerados.png'], ['Secos', 'jar', 'cat-secos.png'], ['Bebidas', 'bottle', 'cat-bebidas.png'], ['Limpieza', 'spray', null]]
      .forEach(c => cat.run(...c));
    if (process.env.SIN_DEMO) crearUsuarios(db, [['Administrador', 'admin', 'Administración']]);
    else sembrarDemo(db);
    db.exec('COMMIT');
  }
  migrar(db, ruta);
  migrarV2(db, ruta);
  return db;
}

module.exports = { abrirDb, hashPin, pinValido };
