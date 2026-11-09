// Comprueba en Chrome headless las mejoras: conteo, recarga, actualización, sin red, captura masiva, pedir otro.
const { spawn } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const [chrome, proyecto] = process.argv.slice(2);
const dir = __dirname, shots = path.join(dir, 'shots4'), dbFile = path.join(dir, 'e2e4', 'prueba.db');
fs.rmSync(path.join(dir, 'e2e4'), { recursive: true, force: true });
fs.mkdirSync(path.join(dir, 'e2e4'), { recursive: true });
fs.mkdirSync(shots, { recursive: true });
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(proyecto, 'server.js')], { env: { ...process.env, PIN_INICIAL: '1234', DB_PATH: dbFile, PORT: '3115' }, stdio: 'inherit' });
const br = spawn(chrome, ['--headless=new', '--remote-debugging-port=9336', `--user-data-dir=${path.join(dir, 'perfil4')}`, '--no-first-run', '--disable-gpu', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
const dormir = ms => new Promise(r => setTimeout(r, ms));
const errores = [];
let fallas = 0;

(async () => {
  let t;
  for (let i = 0; i < 60 && !t; i++) { await dormir(250); try { t = (await (await fetch('http://127.0.0.1:9336/json')).json()).find(x => x.type === 'page'); } catch {} }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => { ws.onopen = r; });
  let n = 0; const pend = new Map();
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id) { pend.get(d.id)(d); pend.delete(d.id); }
    if (d.method === 'Runtime.exceptionThrown') errores.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
  };
  const cdp = (method, params = {}) => new Promise(r => { const id = ++n; pend.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async expr => {
    const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(`${expr.slice(0, 150)}: ${r.result.exceptionDetails.exception?.description}`);
    return r.result.result.value;
  };
  const foto = async nombre => {
    await dormir(300);
    const r = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(shots, `${nombre}.png`), Buffer.from(r.result.data, 'base64'));
  };
  const ir = async h => { await ev(`location.hash='${h}'`); await dormir(200); };
  const clic = async sel => { await ev(`document.querySelector(${JSON.stringify(sel)}).click()`); await dormir(350); };
  const clicTexto = async txt => { await ev(`[...document.querySelectorAll('button, a.btn')].find(b=>b.textContent.includes(${JSON.stringify(txt)})).click()`); await dormir(350); };
  const escribir = (sel, v) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const check = (nombre, ok, extra = '') => { if (!ok) fallas++; console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre} ${extra}`); };
  const estado = () => ev(`fetch('/api/estado').then(r=>r.json())`);
  const sinDesborde = async e => { const o = await ev('document.documentElement.scrollWidth - innerWidth'); if (o > 0) check(`sin scroll horizontal ${e}`, false, `${o}px`); };

  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 1, mobile: true });
  await cdp('Page.navigate', { url: 'http://127.0.0.1:3115/' });
  await dormir(900);

  // Acceso: pestaña sin usuarios
  await clic('[data-tipo=auxiliar]');
  check('la pestaña con usuario lo muestra', (await ev(`document.querySelector('[name=usuario_id]').textContent`)).includes('Carlos'));
  await clic('[data-tipo=admin]');
  await escribir('[name=pin]', '1234');
  await clic('#form-login button');
  await dormir(500);

  // Conteo sin tocar no pisa una entrada que ocurrió con la pantalla abierta
  await ir('#/conteo/2');
  const e0 = await estado();
  const arroz = e0.insumos.find(i => i.nombre === 'Arroz');
  await ev(`fetch('/api/pedidos/2048/recepcion',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({folio:'N1',lineas:[{insumo:${arroz.id},recibido:20}]})})`);
  await clicTexto('Guardar conteo');
  await dormir(400);
  check('conteo sin tocar no borra la entrada', (await estado()).insumos.find(i => i.id === arroz.id).stock === arroz.stock + 20);

  // Borrador sobrevive a recargar
  await ir('#/conteo/2');
  const frijol = e0.insumos.find(i => i.nombre === 'Frijol');
  await escribir(`#c-${frijol.id}`, '99');
  await cdp('Page.reload');
  await dormir(1000);
  check('la captura sobrevive a recargar', (await ev(`document.querySelector('#c-${frijol.id}')?.value`)) === '99');
  await clicTexto('Guardar conteo');
  await dormir(400);
  const e1 = await estado();
  check('solo cambia lo capturado', e1.insumos.find(i => i.id === frijol.id).stock === 99 && e1.insumos.find(i => i.id === arroz.id).stock === arroz.stock + 20);
  await foto('01-conteo'); await sinDesborde('conteo');

  // Actualización en segundo plano, sin interrumpir la captura
  await ir('#/inventario');
  const antes = await ev(`document.querySelector('.stats .stat b').textContent`);
  await ev(`fetch('/api/insumos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nombre:'Insumo nuevo',categoria_id:1,unidad:'kg',stock:1,min:1,max:2})})`);
  await ev('actualizarEnSegundoPlano()');
  await dormir(300);
  check('los cambios de otros aparecen solos', Number(await ev(`document.querySelector('.stats .stat b').textContent`)) === Number(antes) + 1);
  await ir('#/conteo/1');
  const ins = e1.insumos.find(i => i.nombre === 'Cebolla');
  await ev(`(()=>{const e=document.querySelector('#c-${ins.id}'); e.focus(); e.value='7';})()`);
  await ev(`fetch('/api/insumos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nombre:'Otro nuevo',categoria_id:1,unidad:'kg',stock:1,min:1,max:2})})`);
  await ev('actualizarEnSegundoPlano()');
  await dormir(300);
  check('no interrumpe a quien captura', (await ev(`document.querySelector('#c-${ins.id}').value`)) === '7' && await ev(`document.activeElement.id==='c-${ins.id}'`));
  await ev('document.activeElement.blur()');

  // Sin conexión
  await ir('#/inventario');
  await cdp('Network.enable');
  await cdp('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await ev('actualizarEnSegundoPlano()');
  await dormir(300);
  check('avisa que no hay conexión', await ev(`!document.querySelector('#sin-red').hidden`));
  await foto('02-sin-red');
  await ir('#/conteo/1');
  await clicTexto('Guardar conteo');
  await dormir(300);
  check('error en español al guardar', (await ev(`document.querySelector('#aviso').textContent`)).includes('Sin conexión'));
  await cdp('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await ev('actualizarEnSegundoPlano()');
  await dormir(300);
  check('el aviso desaparece al volver', await ev(`document.querySelector('#sin-red').hidden`));

  // Captura masiva
  await ir('#/rendimientos');
  await foto('03-rendimientos'); await sinDesborde('rendimientos');
  const pollo = e1.insumos.find(i => i.nombre === 'Pollo (pechuga)');
  await escribir(`[data-draft="ren.${pollo.id}.r"]`, '80');
  await escribir(`[data-draft="ren.${pollo.id}.c"]`, '95.5');
  await clicTexto('Guardar');
  await dormir(400);
  const p2 = (await estado()).insumos.find(i => i.id === pollo.id);
  check('captura masiva guarda', p2.rendimiento === 80 && p2.costo === 95.5 && p2.aprovechable === p2.stock * 0.8);

  // Pedir cualquier insumo
  await ir('#/pedidos');
  await clicTexto('Pedir otro insumo');
  await foto('04-pedir-otro');
  const cloro = e1.insumos.find(i => i.nombre === 'Cloro');
  await ev(`document.querySelector('#dialogo [name=insumo]').value='${cloro.id}'`);
  await escribir('#dialogo [name=cantidad]', '6');
  await clic('#dialogo button[value=ok]');
  await dormir(500);
  const sol = (await estado()).solicitudes[0];
  check('solicitud de insumo sobre el mínimo', sol.lineas[0].insumo_id === cloro.id && sol.lineas[0].cantidad === 6 && sol.lineas[0].proveedor_id === cloro.proveedor_id);

  // Servidor apagado al abrir: pantalla útil en lugar de blanco
  await cdp('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await ev(`S=null; arrancar()`);
  await dormir(400);
  check('pantalla de reintento si no conecta', (await ev(`document.querySelector('main').textContent`)).includes('No se pudo conectar'));
  await foto('05-no-conecta');
  await cdp('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await clicTexto('Intentar de nuevo');
  await dormir(500);
  check('reintentar recupera la app', await ev(`document.body.classList.contains('ui-admin')`));

  console.log('Excepciones JS:', errores.length ? errores : 'ninguna');
  console.log(`Fallas: ${fallas}`);
})().catch(err => console.log('ERROR', err)).finally(() => { br.kill(); srv.kill(); setTimeout(() => process.exit(0), 300); });
