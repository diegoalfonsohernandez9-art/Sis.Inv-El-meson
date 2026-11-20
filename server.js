'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { abrirDb, hashPin, pinValido } = require('./db');
const operacion = require('./operacion');

const SESION_MS = 7 * 864e5;
const MAX_INTENTOS = 5;
const BLOQUEO_MS = 5 * 60e3;
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

class Falla extends Error {
  constructor(status, mensaje) { super(mensaje); this.status = status; }
}

const ahora = () => new Date().toISOString();
const r3 = n => Math.round(n * 1000) / 1000;
const sha = t => crypto.createHash('sha256').update(t).digest('hex');

function texto(v, etiqueta, max = 200) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) throw new Falla(400, `Falta ${etiqueta}`);
  if (s.length > max) throw new Falla(400, `${etiqueta} es demasiado largo`);
  return s;
}
const opcional = (v, etiqueta, max) => (typeof v === 'string' && v.trim() ? texto(v, etiqueta, max) : null);

function numero(v, etiqueta) {
  const n = v === '' || v === null || typeof v === 'boolean' ? NaN : Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1e7) throw new Falla(400, `${etiqueta}: cantidad inválida`);
  return n;
}

function fecha(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v))) throw new Falla(400, 'Fecha de entrega inválida');
  return v;
}

function lineas(b) {
  if (!Array.isArray(b.lineas) || !b.lineas.length) throw new Falla(400, 'Agrega al menos un insumo');
  if (new Set(b.lineas.map(l => String(l.insumo))).size !== b.lineas.length) throw new Falla(400, 'Hay insumos repetidos');
  return b.lineas;
}

function pinNuevo(v) {
  if (typeof v !== 'string' || !/^\d{4,8}$/.test(v)) throw new Falla(400, 'El PIN debe tener de 4 a 8 dígitos');
  return v;
}

// sinPin: modo desarrollo, entra eligiendo el usuario sin PIN. Los PIN y los permisos por rol no cambian.
function crearApp(rutaDb, { sinPin = false } = {}) {
  const db = abrirDb(rutaDb);
  // Los adjuntos viven fuera de public/ y solo salen por /api/documentos, con permisos.
  const dirArchivos = process.env.ARCHIVOS_DIR || (rutaDb === ':memory:' ? fs.mkdtempSync(path.join(os.tmpdir(), 'meson-archivos-')) : path.join(path.dirname(rutaDb), 'archivos'));
  fs.mkdirSync(dirArchivos, { recursive: true });
  const q = (sql, ...a) => db.prepare(sql).all(...a);
  const uno = (sql, ...a) => db.prepare(sql).get(...a);
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const intentos = new Map();

  const evento = (tipo, titulo, detalle, ref) => run('INSERT INTO eventos (tipo, titulo, detalle, ref, creado) VALUES (?,?,?,?,?)', tipo, titulo, detalle, ref, ahora());

  function insumo(id) {
    const i = uno('SELECT * FROM insumos WHERE id = ? AND activo = 1', Number(id));
    if (!i) throw new Falla(400, 'Insumo no encontrado');
    return i;
  }

  function proveedorId(v) {
    if (v === null || v === undefined || v === '') return null;
    if (!uno('SELECT 1 FROM proveedores WHERE id = ?', Number(v))) throw new Falla(400, 'Proveedor no encontrado');
    return Number(v);
  }

  function moverStock(i, nuevo, tipo, me, { ref = null, nota = null } = {}) {
    const final = r3(nuevo);
    if (final === i.stock) return;
    run('UPDATE insumos SET stock = ? WHERE id = ?', final, i.id);
    run('INSERT INTO movimientos (insumo_id, tipo, delta, stock_final, usuario_id, creado, ref, nota) VALUES (?,?,?,?,?,?,?,?)', i.id, tipo, r3(final - i.stock), final, me.id, ahora(), ref, nota);
    if (final < i.min && i.stock >= i.min) evento('alerta', `${i.nombre} en bajo mínimo`, `Stock actual: ${final} ${i.unidad}`, '#/pedidos');
  }

  function rendimientoDe(v) {
    const r = v === '' || v === undefined || v === null ? null : numero(v, 'Rendimiento');
    if (r !== null && (r <= 0 || r > 100)) throw new Falla(400, 'La merma debe ser de 0 a 99 % (rendimiento de 1 a 100 %)');
    return r;
  }
  const precioDe = v => (v === '' || v === undefined || v === null ? null : numero(v, 'Precio'));

  function datosInsumo(b) {
    const d = {
      nombre: texto(b.nombre, 'el nombre', 80), categoria_id: Number(b.categoria_id), unidad: texto(b.unidad, 'la unidad', 20),
      min: numero(b.min, 'Mínimo'), max: numero(b.max, 'Máximo'), codigo: opcional(b.codigo, 'el código', 40), proveedor_id: proveedorId(b.proveedor_id),
    };
    if (!uno('SELECT 1 FROM categorias WHERE id = ?', d.categoria_id)) throw new Falla(400, 'Categoría no encontrada');
    if (d.min > d.max) throw new Falla(400, 'El mínimo no puede ser mayor que el máximo');
    d.rendimiento = rendimientoDe(b.rendimiento);
    d.costo = precioDe(b.costo);
    return d;
  }

  function datosProveedor(b) {
    const tipo = b.tipo, contacto = texto(b.contacto, 'el contacto', 120);
    if (!['whatsapp', 'telefono', 'correo'].includes(tipo)) throw new Falla(400, 'Tipo de contacto inválido');
    if (tipo === 'correo' ? !/^[^\s@]+@[^\s@]+$/.test(contacto) : !/^\+?[\d\s-]{7,20}$/.test(contacto)) throw new Falla(400, 'Contacto inválido');
    const rfc = opcional(b.rfc, 'el RFC', 13)?.toUpperCase() ?? null;
    if (rfc && !/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfc)) throw new Falla(400, 'El RFC no tiene un formato válido');
    const cp = opcional(b.cp, 'el código postal', 5);
    if (cp && !/^\d{5}$/.test(cp)) throw new Falla(400, 'El código postal debe tener 5 dígitos');
    const correo = opcional(b.correo, 'el correo', 120);
    if (correo && !/^[^\s@]+@[^\s@]+$/.test(correo)) throw new Falla(400, 'El correo no es válido');
    const telefono = opcional(b.telefono, 'el teléfono', 20);
    if (telefono && !/^\+?[\d\s-]{7,20}$/.test(telefono)) throw new Falla(400, 'El teléfono no es válido');
    return {
      nombre: texto(b.nombre, 'el nombre', 80), tipo, contacto, razon_social: opcional(b.razon_social, 'la razón social', 160), rfc,
      domicilio_fiscal: opcional(b.domicilio_fiscal, 'el domicilio fiscal', 250), cp, regimen_fiscal: opcional(b.regimen_fiscal, 'el régimen fiscal', 80),
      contacto_nombre: opcional(b.contacto_nombre, 'el nombre de contacto', 80), telefono, correo,
      direccion_envio: opcional(b.direccion_envio, 'la dirección de envío', 250),
    };
  }

  function datosUsuario(b) {
    if (!['admin', 'staff', 'auxiliar', 'proveedor'].includes(b.rol)) throw new Falla(400, 'Rol inválido');
    const proveedor_id = b.rol === 'proveedor' ? proveedorId(b.proveedor_id) : null;
    if (b.rol === 'proveedor' && !proveedor_id) throw new Falla(400, 'Elige a qué proveedor pertenece este usuario');
    return { nombre: texto(b.nombre, 'el nombre', 60), rol: b.rol, area: texto(b.area, 'el área', 60), proveedor_id };
  }

  // Un proveedor recibe solo sus pedidos y solo estos campos: nada de stock, otros proveedores ni notas internas.
  function estadoProveedor(me) {
    const proveedor = uno('SELECT id, nombre FROM proveedores WHERE id = ?', me.proveedor_id);
    const pedidos = q(`SELECT id, estado, creado, fecha_entrega, recibido, folio, avance, promesa, nota_proveedor FROM pedidos
      WHERE proveedor_id = ? ORDER BY id DESC`, me.proveedor_id).map(p => ({
      ...p,
      lineas: q(`SELECT l.insumo_id, i.nombre, i.unidad, l.cantidad, l.recibido, l.aceptado, l.rechazado, l.cerrado, l.presentacion, l.factor FROM pedido_lineas l
        JOIN insumos i ON i.id = l.insumo_id WHERE l.pedido_id = ? ORDER BY i.nombre`, p.id),
    })).map(p => ({ ...p, entrega: op.estadoEntrega(p, p.lineas, uno('SELECT COUNT(*) n FROM recepciones WHERE pedido_id = ?', p.id).n) }));
    return { me: { id: me.id, nombre: me.nombre, rol: me.rol, area: me.area }, proveedor, pedidos, ...op.estadoProveedor(me) };
  }

  function pendiente(id) {
    const s = uno('SELECT * FROM solicitudes WHERE id = ?', Number(id));
    if (!s) throw new Falla(404, 'Solicitud no encontrada');
    if (s.estado !== 'pendiente') throw new Falla(409, 'Esta solicitud ya fue revisada');
    return s;
  }

  function estado(me) {
    if (me.rol === 'proveedor') return estadoProveedor(me);
    const agrupar = (filas, llave) => filas.reduce((m, f) => ((m[f[llave]] ||= []).push(f), m), {});
    const linS = agrupar(q('SELECT * FROM solicitud_lineas'), 'solicitud_id');
    const linP = agrupar(q('SELECT * FROM pedido_lineas'), 'pedido_id');
    return {
      me: { id: me.id, nombre: me.nombre, rol: me.rol, area: me.area },
      categorias: q('SELECT * FROM categorias ORDER BY id'),
      insumos: q('SELECT * FROM insumos ORDER BY nombre').map(i => ({ ...i, aprovechable: i.rendimiento === null ? null : r3(i.stock * i.rendimiento / 100) })),
      proveedores: q('SELECT * FROM proveedores ORDER BY nombre'),
      presentaciones: q('SELECT * FROM presentaciones ORDER BY insumo_id, contenido'),
      solicitudes: q(`SELECT s.*, u.nombre solicitante, u.area solicitante_area, r.nombre revisor FROM solicitudes s
        JOIN usuarios u ON u.id = s.solicitante_id LEFT JOIN usuarios r ON r.id = s.revisor_id ORDER BY s.id DESC`).map(s => ({ ...s, lineas: linS[s.id] || [] })),
      pedidos: q(`SELECT p.*, u.nombre receptor, u.area receptor_area FROM pedidos p LEFT JOIN usuarios u ON u.id = p.receptor_id ORDER BY p.id DESC`)
        .map(p => ({ ...p, lineas: linP[p.id] || [], entrega: op.estadoEntrega(p, linP[p.id] || [], uno('SELECT COUNT(*) n FROM recepciones WHERE pedido_id = ?', p.id).n) })),
      eventos: q('SELECT * FROM eventos ORDER BY id DESC LIMIT 100'),
      conteos: q(`SELECT c.*, u.nombre usuario FROM conteos c JOIN usuarios u ON u.id = c.usuario_id ORDER BY c.id DESC LIMIT 200`),
      movimientos: q(`SELECT m.*, i.nombre insumo, i.unidad, u.nombre usuario FROM movimientos m JOIN insumos i ON i.id = m.insumo_id
        JOIN usuarios u ON u.id = m.usuario_id ORDER BY m.id DESC LIMIT 60`),
      usuarios: me.rol === 'admin' ? q('SELECT id, nombre, rol, area, activo, proveedor_id FROM usuarios ORDER BY nombre') : [],
      ...op.estadoInterno(me),
    };
  }

  // Cada ruta: [método, patrón, manejador, permiso]. Las escrituras corren dentro de una transacción.
  // Permisos: sin valor = personal interno; 'admin'; 'proveedor' = solo proveedores; 'todos' = cualquier sesión; 'publico'.
  const op = operacion({ q, uno, run, evento, moverStock, insumo, proveedorId, Falla, texto, opcional, numero, fecha, lineas, ahora, r3, dirArchivos });
  const rutas = [
    ...op.rutas,
    ['GET', /^\/api\/usuarios$/, () => q('SELECT id, nombre, rol FROM usuarios WHERE activo = 1 ORDER BY nombre'), 'publico'],
    ['GET', /^\/api\/config$/, () => ({ sin_pin: sinPin }), 'publico'],
    ['GET', /^\/api\/estado$/, (b, me) => estado(me), 'todos'],

    ['POST', /^\/api\/conteos$/, (b, me) => {
      const categoria = Number(b.categoria_id);
      const cat = uno('SELECT * FROM categorias WHERE id = ?', categoria);
      if (!cat) throw new Falla(400, 'Categoría no encontrada');
      for (const l of b.lineas?.length ? lineas(b) : []) {
        const i = insumo(l.insumo);
        if (i.categoria_id !== categoria) throw new Falla(400, `${i.nombre} no pertenece a ${cat.nombre}`);
        moverStock(i, numero(l.cantidad, i.nombre), 'conteo', me);
      }
      run('INSERT INTO conteos (categoria_id, usuario_id, creado) VALUES (?,?,?)', categoria, me.id, ahora());
      evento('conteo', `Conteo de ${cat.nombre}`, `Registrado por ${me.nombre}`, `#/conteo/${categoria}`);
    }],

    ['POST', /^\/api\/insumos$/, b => {
      const d = datosInsumo(b);
      run('INSERT INTO insumos (nombre, categoria_id, unidad, stock, min, max, codigo, proveedor_id, rendimiento, costo) VALUES (?,?,?,?,?,?,?,?,?,?)',
        d.nombre, d.categoria_id, d.unidad, r3(numero(b.stock, 'Stock')), d.min, d.max, d.codigo, d.proveedor_id, d.rendimiento, d.costo);
    }, 'admin'],
    ['POST', /^\/api\/insumos\/datos$/, b => {
      for (const l of lineas(b)) run('UPDATE insumos SET rendimiento=?, costo=? WHERE id=?', rendimientoDe(l.rendimiento), precioDe(l.costo), insumo(l.insumo).id);
    }, 'admin'],
    // El stock no se edita aquí: solo cambia por movimientos registrados.
    ['PUT', /^\/api\/insumos\/(\d+)$/, (b, me, [id]) => {
      const d = datosInsumo(b);
      const r = run('UPDATE insumos SET nombre=?, categoria_id=?, unidad=?, min=?, max=?, codigo=?, proveedor_id=?, activo=?, rendimiento=?, costo=? WHERE id=?',
        d.nombre, d.categoria_id, d.unidad, d.min, d.max, d.codigo, d.proveedor_id, b.activo ? 1 : 0, d.rendimiento, d.costo, Number(id));
      if (!r.changes) throw new Falla(404, 'Insumo no encontrado');
    }, 'admin'],
    ['POST', /^\/api\/insumos\/(\d+)\/presentaciones$/, (b, me, [id]) => {
      const i = insumo(id), nombre = texto(b.nombre, 'el nombre de la presentación', 40), contenido = r3(numero(b.contenido, 'Contenido'));
      if (!contenido) throw new Falla(400, `Contenido: escribe cuántos ${i.unidad} trae`);
      if (uno('SELECT 1 FROM presentaciones WHERE insumo_id = ? AND activo = 1 AND nombre = ?', i.id, nombre)) throw new Falla(409, `${i.nombre} ya tiene la presentación ${nombre}. Márcala como no vigente para crear otra.`);
      return { id: Number(run('INSERT INTO presentaciones (insumo_id, nombre, contenido) VALUES (?,?,?)', i.id, nombre, contenido).lastInsertRowid) };
    }, 'admin'],
    ['PUT', /^\/api\/presentaciones\/(\d+)$/, (b, me, [id]) => {
      if (!run('UPDATE presentaciones SET activo = ? WHERE id = ?', b.activo ? 1 : 0, Number(id)).changes) throw new Falla(404, 'Presentación no encontrada');
    }, 'admin'],

    ['POST', /^\/api\/proveedores$/, b => {
      const d = datosProveedor(b);
      const { lastInsertRowid } = run('INSERT INTO proveedores (nombre, tipo, contacto, razon_social, rfc, domicilio_fiscal, cp, regimen_fiscal, contacto_nombre, telefono, correo, direccion_envio) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        d.nombre, d.tipo, d.contacto, d.razon_social, d.rfc, d.domicilio_fiscal, d.cp, d.regimen_fiscal, d.contacto_nombre, d.telefono, d.correo, d.direccion_envio);
      return { id: Number(lastInsertRowid) };
    }, 'admin'],
    ['PUT', /^\/api\/proveedores\/(\d+)$/, (b, me, [id]) => {
      const d = datosProveedor(b);
      if (!run('UPDATE proveedores SET nombre=?, tipo=?, contacto=?, razon_social=?, rfc=?, domicilio_fiscal=?, cp=?, regimen_fiscal=?, contacto_nombre=?, telefono=?, correo=?, direccion_envio=? WHERE id=?',
        d.nombre, d.tipo, d.contacto, d.razon_social, d.rfc, d.domicilio_fiscal, d.cp, d.regimen_fiscal, d.contacto_nombre, d.telefono, d.correo, d.direccion_envio, Number(id)).changes) throw new Falla(404, 'Proveedor no encontrado');
    }, 'admin'],

    ['POST', /^\/api\/usuarios$/, b => {
      const d = datosUsuario(b);
      run('INSERT INTO usuarios (nombre, rol, area, pin_hash, proveedor_id) VALUES (?,?,?,?,?)', d.nombre, d.rol, d.area, hashPin(pinNuevo(b.pin)), d.proveedor_id);
    }, 'admin'],
    ['PUT', /^\/api\/usuarios\/(\d+)$/, (b, me, [idTxt]) => {
      const id = Number(idTxt), d = datosUsuario(b), activo = b.activo ? 1 : 0;
      if (id === me.id && (!activo || d.rol !== 'admin')) throw new Falla(400, 'No puedes quitarte tu propio acceso de administrador');
      if (!run('UPDATE usuarios SET nombre=?, rol=?, area=?, activo=?, proveedor_id=? WHERE id=?', d.nombre, d.rol, d.area, activo, d.proveedor_id, id).changes) throw new Falla(404, 'Usuario no encontrado');
      if (b.pin) run('UPDATE usuarios SET pin_hash=? WHERE id=?', hashPin(pinNuevo(b.pin)), id);
      if (!activo || b.pin) run('DELETE FROM sesiones WHERE usuario_id=?', id);
    }, 'admin'],
    ['POST', /^\/api\/pin$/, (b, me) => {
      if (typeof b.actual !== 'string' || !pinValido(b.actual, me.pin_hash)) throw new Falla(400, 'El PIN actual no es correcto');
      run('UPDATE usuarios SET pin_hash=? WHERE id=?', hashPin(pinNuevo(b.nuevo)), me.id);
    }, 'todos'],

    ['POST', /^\/api\/proveedor\/pedidos\/(\d+)\/avance$/, (b, me, [id]) => {
      const p = uno('SELECT * FROM pedidos WHERE id = ? AND proveedor_id = ?', Number(id), me.proveedor_id);
      if (!p) throw new Falla(404, 'Pedido no encontrado');
      if (p.estado !== 'en_proceso') throw new Falla(409, 'Este pedido ya fue recibido');
      if (p.avance === 'por_confirmar') {
        run("UPDATE pedidos SET avance='confirmado', promesa=? WHERE id=?", fecha(b.promesa), p.id);
        evento('pedido', `Pedido #${p.id}`, `Confirmado por ${me.nombre}`, `#/pedido/${p.id}`);
      } else if (p.avance === 'confirmado') {
        run("UPDATE pedidos SET avance='en_camino' WHERE id=?", p.id);
        evento('pedido', `Pedido #${p.id}`, `En camino, avisó ${me.nombre}`, `#/pedido/${p.id}`);
      } else throw new Falla(409, 'Este pedido ya está en camino');
    }, 'proveedor'],
    ['POST', /^\/api\/proveedor\/pedidos\/(\d+)\/problema$/, (b, me, [id]) => {
      const p = uno('SELECT * FROM pedidos WHERE id = ? AND proveedor_id = ?', Number(id), me.proveedor_id);
      if (!p) throw new Falla(404, 'Pedido no encontrado');
      if (p.estado !== 'en_proceso') throw new Falla(409, 'Este pedido ya fue recibido');
      run('UPDATE pedidos SET nota_proveedor=? WHERE id=?', texto(b.nota, 'la descripción', 500), p.id);
      evento('alerta', `Problema en pedido #${p.id}`, `Avisó ${me.nombre}`, `#/pedido/${p.id}`);
    }, 'proveedor'],

    ['POST', /^\/api\/solicitudes$/, (b, me) => {
      const ls = lineas(b).map(l => {
        const i = insumo(l.insumo), cantidad = numero(l.cantidad, i.nombre);
        if (!cantidad) throw new Falla(400, `${i.nombre}: la cantidad debe ser mayor a cero`);
        return [i.id, cantidad, proveedorId(l.proveedor)];
      });
      const { lastInsertRowid: id } = run('INSERT INTO solicitudes (solicitante_id, creado, comentario, fecha_entrega) VALUES (?,?,?,?)',
        me.id, ahora(), opcional(b.comentario, 'el comentario', 500) || '', b.fecha_entrega ? fecha(b.fecha_entrega) : null);
      ls.forEach(l => run('INSERT INTO solicitud_lineas VALUES (?,?,?,?)', id, ...l));
      evento('solicitud', `Solicitud #SO-${id}`, 'Requiere autorización', `#/solicitud/${id}`);
      return { id: Number(id) };
    }],
    ['POST', /^\/api\/solicitudes\/(\d+)\/autorizar$/, (b, me, [id]) => {
      const s = pendiente(id), entrega = fecha(b.fecha_entrega);
      const existentes = new Map(q('SELECT insumo_id, cantidad, proveedor_id FROM solicitud_lineas WHERE solicitud_id = ?', s.id).map(l => [l.insumo_id, l]));
      const cambios = new Map(lineas(b).map(l => [Number(l.insumo), l]));
      const porProveedor = new Map();
      for (const [insumoId, l] of existentes) {
        const c = cambios.get(insumoId) || {};
        const i = insumo(insumoId);
        const cantidad = c.cantidad === undefined ? l.cantidad : numero(c.cantidad, i.nombre);
        const prov = c.proveedor === undefined ? l.proveedor_id : proveedorId(c.proveedor);
        if (!cantidad) throw new Falla(400, `${i.nombre}: la cantidad debe ser mayor a cero`);
        if (!prov) throw new Falla(400, `Asigna un proveedor a ${i.nombre}`);
        run('UPDATE solicitud_lineas SET cantidad=?, proveedor_id=? WHERE solicitud_id=? AND insumo_id=?', cantidad, prov, s.id, insumoId);
        if (!porProveedor.has(prov)) porProveedor.set(prov, []);
        porProveedor.get(prov).push([insumoId, cantidad]);
      }
      run("UPDATE solicitudes SET estado='autorizada', fecha_entrega=?, revisor_id=?, revisado=? WHERE id=?", entrega, me.id, ahora(), s.id);
      evento('solicitud', `Solicitud #SO-${s.id}`, `Autorizada por ${me.nombre}`, `#/solicitud/${s.id}`);
      for (const [prov, ls] of porProveedor) {
        const { lastInsertRowid: p } = run('INSERT INTO pedidos (solicitud_id, proveedor_id, creado, fecha_entrega) VALUES (?,?,?,?)', s.id, prov, ahora(), entrega);
        ls.forEach(([i, c]) => run('INSERT INTO pedido_lineas (pedido_id, insumo_id, cantidad) VALUES (?,?,?)', p, i, c));
        evento('pedido', `Pedido #${p}`, 'En proceso', `#/pedido/${p}`);
      }
    }, 'admin'],
    ['POST', /^\/api\/solicitudes\/(\d+)\/rechazar$/, (b, me, [id]) => {
      const s = pendiente(id);
      run("UPDATE solicitudes SET estado='rechazada', motivo=?, revisor_id=?, revisado=? WHERE id=?", texto(b.motivo, 'el motivo', 300), me.id, ahora(), s.id);
      evento('solicitud', `Solicitud #SO-${s.id}`, `Rechazada por ${me.nombre}`, `#/solicitud/${s.id}`);
    }, 'admin'],

    ['POST', /^\/api\/pedidos\/(\d+)\/diferencia$/, (b, me, [id]) => {
      const p = uno('SELECT * FROM pedidos WHERE id = ?', Number(id));
      if (!p) throw new Falla(404, 'Pedido no encontrado');
      run('UPDATE pedidos SET nota=? WHERE id=?', texto(b.nota, 'la descripción', 500), p.id);
      evento('alerta', `Diferencia en pedido #${p.id}`, `Reportada por ${me.nombre}`, `#/pedido/${p.id}`);
    }],
  ];

  function usuarioDe(req) {
    const m = /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.cookie || '');
    if (!m) return null;
    return uno(`SELECT u.* FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id WHERE s.token_hash = ? AND s.expira > ? AND u.activo = 1`, sha(m[1]), Date.now()) || null;
  }

  function login(b) {
    const u = uno('SELECT * FROM usuarios WHERE id = ? AND activo = 1', Number(b.usuario_id));
    if (!u || (!sinPin && typeof b.pin !== 'string')) throw new Falla(401, 'Usuario o PIN incorrecto');
    const t = intentos.get(u.id);
    if (t && t.hasta > Date.now()) throw new Falla(429, 'Demasiados intentos. Espera 5 minutos.');
    if (!sinPin && !pinValido(b.pin, u.pin_hash)) {
      const fallos = (t && t.hasta ? 0 : t?.fallos || 0) + 1;
      intentos.set(u.id, { fallos, hasta: fallos >= MAX_INTENTOS ? Date.now() + BLOQUEO_MS : 0 });
      throw new Falla(401, 'Usuario o PIN incorrecto');
    }
    intentos.delete(u.id);
    const token = crypto.randomBytes(32).toString('hex');
    run('DELETE FROM sesiones WHERE expira < ?', Date.now());
    run('INSERT INTO sesiones VALUES (?,?,?)', sha(token), u.id, Date.now() + SESION_MS);
    return `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESION_MS / 1000}`;
  }

  function leerBinario(req) {
    return new Promise((resolve, reject) => {
      const partes = [];
      let tam = 0;
      req.on('data', c => {
        tam += c.length;
        if (tam > op.MAX_ARCHIVO) { reject(new Falla(413, 'El archivo pasa de 10 MB')); req.destroy(); } else partes.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(partes)));
      req.on('error', reject);
    });
  }

  function leerCuerpo(req) {
    return new Promise((resolve, reject) => {
      let t = '';
      req.on('data', c => {
        t += c;
        if (t.length > 1e6) { reject(new Falla(413, 'Solicitud demasiado grande')); req.destroy(); }
      });
      req.on('end', () => {
        if (!t) return resolve({});
        try {
          const b = JSON.parse(t);
          if (b === null || typeof b !== 'object' || Array.isArray(b)) throw 0;
          resolve(b);
        } catch { reject(new Falla(400, 'JSON inválido')); }
      });
      req.on('error', reject);
    });
  }

  async function api(req, res, ruta) {
    const responder = (status, datos, cabeceras = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cabeceras });
      res.end(JSON.stringify(datos ?? { ok: true }));
    };
    const enviar = (r) => {
      if (!r?.binario) return responder(200, r);
      const ascii = r.nombre.normalize('NFD').replace(/[^\w. -]/g, '_');
      res.writeHead(200, {
        'Content-Type': r.tipo, 'Content-Length': r.binario.length, 'Cache-Control': 'private, no-store', 'Content-Security-Policy': "default-src 'none'; sandbox",
        'Content-Disposition': `${r.enLinea ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(r.nombre)}`,
      });
      res.end(r.binario);
    };
    try {
      if (req.method === 'POST' && ruta === '/api/documentos') {
        const me = usuarioDe(req);
        if (!me) throw new Falla(401, 'Inicia sesión');
        const cuerpo = await leerBinario(req);
        if (!cuerpo.length) throw new Falla(400, 'El archivo está vacío');
        db.exec('BEGIN IMMEDIATE');
        try {
          const r = op.subirDocumento(cuerpo, new URL(req.url, 'http://x').searchParams, me);
          db.exec('COMMIT');
          return responder(200, r);
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
      }
      if (req.method !== 'GET' && !(req.headers['content-type'] || '').startsWith('application/json')) throw new Falla(415, 'Se esperaba JSON');
      const b = req.method === 'GET' ? {} : await leerCuerpo(req);

      if (req.method === 'POST' && ruta === '/api/login') return responder(200, null, { 'Set-Cookie': login(b) });
      if (req.method === 'POST' && ruta === '/api/logout') {
        const m = /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.cookie || '');
        if (m) run('DELETE FROM sesiones WHERE token_hash = ?', sha(m[1]));
        return responder(200, null, { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
      }

      for (const [metodo, patron, fn, permiso] of rutas) {
        const m = req.method === metodo && patron.exec(ruta);
        if (!m) continue;
        const me = usuarioDe(req);
        if (permiso !== 'publico' && !me) throw new Falla(401, 'Inicia sesión');
        if (permiso === 'admin' && me.rol !== 'admin') throw new Falla(403, 'Solo administración puede hacer esto');
        if (permiso === 'proveedor' && me.rol !== 'proveedor') throw new Falla(403, 'Solo proveedores pueden hacer esto');
        if (!permiso && me.rol === 'proveedor') throw new Falla(403, 'Sin acceso');
        if (metodo === 'GET') return enviar(fn(b, me, m.slice(1)));
        db.exec('BEGIN IMMEDIATE');
        try {
          const r = fn(b, me, m.slice(1));
          db.exec('COMMIT');
          return responder(200, r);
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
      }
      throw new Falla(404, 'No encontrado');
    } catch (e) {
      if (e instanceof Falla) return responder(e.status, { error: e.message });
      if (/UNIQUE/.test(e.message)) return responder(409, { error: 'Ya existe un registro con ese nombre o código' });
      console.error(e);
      responder(500, { error: 'Error interno del servidor' });
    }
  }

  // Solo se sirve lo que existe en public/ al arrancar, así no hay rutas que escapen de la carpeta.
  const raiz = path.join(__dirname, 'public');
  const archivos = new Map(fs.readdirSync(raiz, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => {
    const abs = path.join(e.parentPath, e.name);
    return ['/' + path.relative(raiz, abs).split(path.sep).join('/'), abs];
  }));

  return http.createServer((req, res) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    let ruta;
    try { ruta = new URL(req.url, 'http://x').pathname; } catch { res.writeHead(400); return res.end(); }
    if (ruta.startsWith('/api/')) return api(req, res, ruta);
    const abs = archivos.get(ruta === '/' ? '/index.html' : ruta);
    if (!abs || req.method !== 'GET') { res.writeHead(404); return res.end('No encontrado'); }
    // Fotos y fuentes casi no cambian; sin caché parpadean en cada cambio de pantalla.
    res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream', 'Cache-Control': /^\/(img|fonts)\//.test(ruta) ? 'public, max-age=86400' : 'no-cache' });
    fs.createReadStream(abs).pipe(res);
  });
}

module.exports = { crearApp };

if (require.main === module) {
  const host = process.env.HOST || '127.0.0.1', port = Number(process.env.PORT) || 3000;
  const sinPin = process.env.SIN_PIN === '1';
  // Sin PIN solo en esta computadora: abierto a la red, cualquiera en el wifi entraría como Administrador.
  if (sinPin && !['127.0.0.1', 'localhost', '::1'].includes(host)) {
    console.error('SIN_PIN=1 solo se permite con HOST=127.0.0.1. Quita SIN_PIN para abrir el sistema a la red.');
    process.exit(1);
  }
  crearApp(process.env.DB_PATH || path.join(__dirname, 'meson.db'), { sinPin }).listen(port, host, () => {
    console.log(`El Mesón listo en http://${host}:${port}`);
    if (sinPin) console.log('MODO DESARROLLO: se entra sin PIN. Quita SIN_PIN antes de usarlo en el restaurante.');
  });
}
