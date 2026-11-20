// Verifica Procesos.java contra una base de prueba: las cifras deben coincidir con las fórmulas de la pantalla (public/app.js).
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert');
// Uso: node procesos-java/verificar.js  (usa una base de prueba con datos ficticios, nunca meson.db)
const proyecto = path.join(__dirname, '..');
const java = process.argv[2] || (() => { const b = 'C:/Program Files/Eclipse Adoptium'; const d = fs.existsSync(b) && fs.readdirSync(b).find(x => x.startsWith('jdk-21')); return d ? path.join(b, d, 'bin', 'java.exe') : 'java'; })();
const tmp = path.join(require('node:os').tmpdir(), 'meson-java-prueba');
fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp);
const PORT = 3117, URL = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(proyecto, 'server.js')],
  { env: { ...process.env, PIN_INICIAL: '1234', DB_PATH: path.join(tmp, 'prueba.db'), PORT: String(PORT) }, stdio: 'ignore' });
const dormir = ms => new Promise(r => setTimeout(r, ms));
let cookie = '';
const api = async (ruta, cuerpo, metodo = cuerpo ? 'POST' : 'GET') => {
  const r = await fetch(URL + ruta, { method: metodo, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: cuerpo && JSON.stringify(cuerpo) });
  const c = r.headers.get('set-cookie'); if (c) cookie = c.split(';')[0];
  const d = await r.text(); if (!r.ok) throw new Error(ruta + ' ' + d); return d ? JSON.parse(d) : null;
};
const leerCsv = f => fs.readFileSync(f, 'utf8').replace(/^﻿/, '').trim().split('\r\n').map(l => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).filter(x => x !== '').map(x => x.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')));

(async () => {
  try {
    for (let i = 0; i < 40; i++) { try { await fetch(URL); break; } catch { await dormir(150); } }
    const us = await api('/api/usuarios');
    await api('/api/login', { usuario_id: us.find(u => u.nombre === 'Leo').id, pin: '1234' });
    let e = await api('/api/estado');
    const pollo = e.insumos.find(i => i.nombre === 'Pollo (pechuga)');
    await api('/api/insumos/datos', { lineas: [{ insumo: pollo.id, rendimiento: 60, costo: 90 }] });
    await api('/api/recetas', { nombre: 'Pollo, asado "especial"', porciones: 4, precio_venta: 80, lineas: [{ insumo: pollo.id, neta: 1 }] });
    e = await api('/api/estado');

    const run = env => { try { return { out: execFileSync(java, ['-Dstdout.encoding=UTF-8', '-Dstderr.encoding=UTF-8', 'Procesos.java', URL], { cwd: tmp, env: { ...process.env, ...env }, encoding: 'utf8', stdio: 'pipe' }), code: 0 }; } catch (x) { return { out: (x.stdout || '') + (x.stderr || ''), code: x.status }; } };
    fs.copyFileSync(path.join(proyecto, 'procesos-java', 'Procesos.java'), path.join(tmp, 'Procesos.java'));

    // Permisos: PIN incorrecto y usuario de cocina no pasan.
    const malo = run({ MESON_USUARIO: 'Leo', MESON_PIN: '9999' });
    assert.notEqual(malo.code, 0); assert.match(malo.out, /PIN incorrecto/);
    const cocina = run({ MESON_USUARIO: 'Juan Pérez', MESON_PIN: '1234' });
    assert.notEqual(cocina.code, 0); assert.match(cocina.out, /solo para Administración/);

    const ok = run({ MESON_USUARIO: 'Leo', MESON_PIN: '1234' });
    assert.equal(ok.code, 0, ok.out);
    console.log(ok.out.trim());
    const dir = path.join(tmp, 'reportes', new Date().toLocaleDateString('sv'));

    // Mismas fórmulas que public/app.js
    const activos = e.insumos.filter(i => i.activo);
    const estadoDe = (s, m) => (s < m * 0.25 ? 'Crítico' : s < m ? 'Bajo' : 'OK');
    const enCurso = new Set([...e.solicitudes.filter(s => s.estado === 'pendiente').flatMap(s => s.lineas), ...e.pedidos.filter(p => p.estado === 'en_proceso').flatMap(p => p.lineas)].map(l => l.insumo_id));
    const sugeridos = activos.filter(i => i.stock < i.min && !enCurso.has(i.id));

    const ex = leerCsv(path.join(dir, 'existencias.csv'));
    assert.equal(ex.length - 1, activos.length);
    for (const i of activos) assert.equal(ex.find(f => f[0] === i.nombre)[6], estadoDe(i.stock, i.min), i.nombre);

    const re = leerCsv(path.join(dir, 'reabastecimiento.csv'));
    assert.deepEqual(re.slice(1).map(f => f[1]).sort(), sugeridos.map(i => i.nombre).sort());
    for (const i of sugeridos) assert.equal(Number(re.find(f => f[1] === i.nombre)[4]), Math.max(i.max - i.stock, i.min - i.stock, 1), i.nombre);

    const rc = leerCsv(path.join(dir, 'recetas.csv'));
    const r = e.recetas[0], fila = rc.find(f => f[0] === r.nombre);
    assert.ok(fila, 'la receta con coma y comillas se lee completa');
    assert.deepEqual([Number(fila[2]), Number(fila[3]), Number(fila[4]), Number(fila[5])], [r.costo_porcion, r.precio_venta, r.margen, r.margen_pct]);

    // Solo lee: el inventario no cambió y la sesión de Java se cerró.
    const despues = await api('/api/estado');
    assert.deepEqual(despues.insumos.map(i => i.stock), e.insumos.map(i => i.stock));
    console.log(`OK: ${activos.length} insumos, ${sugeridos.length} por pedir, receta ${r.nombre} margen ${r.margen_pct} %, permisos y solo lectura`);
  } catch (x) { console.error('FALLA', x); process.exitCode = 1; } finally { srv.kill(); }
})();
