// Recorre cada interfaz en varios anchos de pantalla con Chrome headless.
// Uso: node pruebas-navegador/escritorio.js "<ruta de chrome.exe>" "<ruta del proyecto>"
const { spawn } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const [chrome, proyecto] = process.argv.slice(2);
const dir = __dirname, shots = path.join(dir, 'capturas-escritorio'), datos = path.join(dir, 'datos-escritorio');
fs.rmSync(datos, { recursive: true, force: true });
fs.mkdirSync(datos, { recursive: true });
fs.mkdirSync(shots, { recursive: true });
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(proyecto, 'server.js')], { env: { ...process.env, PIN_INICIAL: '1234', DB_PATH: path.join(datos, 'prueba.db'), PORT: '3116' }, stdio: 'inherit' });
const br = spawn(chrome, ['--headless=new', '--remote-debugging-port=9337', `--user-data-dir=${path.join(dir, 'datos-escritorio', 'perfil')}`, '--no-first-run', '--disable-gpu', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
const dormir = ms => new Promise(r => setTimeout(r, ms));
const errores = [];
let fallas = 0;

(async () => {
  let t;
  for (let i = 0; i < 60 && !t; i++) { await dormir(250); try { t = (await (await fetch('http://127.0.0.1:9337/json')).json()).find(x => x.type === 'page'); } catch {} }
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
    if (r.result.exceptionDetails) throw new Error(`${expr.slice(0, 120)}: ${r.result.exceptionDetails.exception?.description}`);
    return r.result.result.value;
  };
  const check = (nombre, ok, extra = '') => { if (!ok) fallas++; console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre} ${extra}`); };
  const ancho = w => cdp('Emulation.setDeviceMetricsOverride', { width: w, height: w >= 900 ? 860 : 900, deviceScaleFactor: 1, mobile: false });
  const foto = async nombre => {
    await ev(`Promise.all([...document.images].map(i=>i.decode().catch(()=>{})))`);
    const rotas = await ev(`[...document.images].filter(i=>i.complete && !i.naturalWidth).map(i=>i.src)`);
    if (rotas.length) check(`imágenes en ${nombre}`, false, rotas.join(','));
    await dormir(100);
    const r = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(shots, `${nombre}.png`), Buffer.from(r.result.data, 'base64'));
  };
  const post = (ruta, cuerpo, metodo = 'POST') => ev(`fetch(${JSON.stringify(ruta)},{method:${JSON.stringify(metodo)},headers:{'Content-Type':'application/json'},body:${JSON.stringify(JSON.stringify(cuerpo))}}).then(async r=>{const d=await r.json(); if(!r.ok) throw new Error(${JSON.stringify(ruta)}+': '+JSON.stringify(d)); return d})`);
  const estado = () => ev(`fetch('/api/estado').then(r=>r.json())`);
  const entrar = async nombre => {
    await ev(`fetch('/api/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})`);
    const us = await ev(`fetch('/api/usuarios').then(r=>r.json())`);
    await post('/api/login', { usuario_id: us.find(u => u.nombre === nombre).id, pin: '1234' });
    await ev(`location.hash='';location.reload()`);
    await dormir(700);
  };

  await cdp('Runtime.enable'); await cdp('Page.enable');
  await ancho(1366);
  await cdp('Page.navigate', { url: 'http://127.0.0.1:3116/' });
  await dormir(800);
  await foto('00-acceso');
  await entrar('Leo');

  // Datos: pedido parcial con remisión, y una receta
  let e = await estado();
  const pollo = e.insumos.find(i => i.nombre === 'Pollo (pechuga)'), queso = e.insumos.find(i => i.nombre === 'Queso fresco');
  await post('/api/insumos/datos', { lineas: [{ insumo: pollo.id, rendimiento: 80, costo: 90 }, { insumo: queso.id, rendimiento: 95, costo: 120 }] });
  const { id: ped } = await post('/api/pedidos', { proveedor_id: 1, fecha_entrega: '2030-01-01', lineas: [{ insumo: pollo.id, cantidad: 20, precio: 90 }, { insumo: queso.id, cantidad: 5, precio: 120 }] });
  const { id: rec } = await post(`/api/pedidos/${ped}/recepcion`, { folio: 'NOTA-500', lineas: [{ insumo: pollo.id, recibido: 10, aceptado: 10, nota: 'Llegó la mitad' }, { insumo: queso.id, recibido: 5, aceptado: 4, motivo: 'Empaque roto', dano: true }] });
  const { id: rem } = await post(`/api/recepciones/${rec}/remision`, {});
  await post(`/api/remisiones/${rem}/emitir`, {});
  await post(`/api/remisiones/${rem}/envio`, { canal: 'portal' });
  const { id: receta } = await post('/api/recetas', { nombre: 'Pollo asado', porciones: 4, lineas: [{ insumo: pollo.id, neta: 1, merma: 20 }, { insumo: queso.id, neta: 0.2 }] });
  const { id: abierto } = await post('/api/pedidos', { proveedor_id: 1, fecha_entrega: '2030-01-02', lineas: [{ insumo: pollo.id, cantidad: 8 }, { insumo: queso.id, cantidad: 2 }] });

  const roles = [
    ['Leo', 'ui-admin', ['#/inicio', '#/inventario', '#/insumos', `#/insumo/${pollo.id}`, '#/rendimientos', '#/conteo/1', '#/pedidos', '#/nuevo-pedido', `#/pedido/${ped}`, `#/recepcion/${abierto}`, `#/expediente/${rec}`, `#/remision/${rem}`, '#/pendientes', '#/proveedores', '#/proveedor/1', '#/recetas', `#/receta/${receta}`, '#/receta-editar', '#/reportes', '#/perfil']],
    ['Juan Pérez', 'ui-cocina', ['#/inicio', '#/conteo/1', '#/pedidos', '#/recibir', '#/recetas', `#/receta/${receta}`, '#/perfil']],
    ['Carlos Méndez', 'ui-auxiliar', ['#/pendientes', '#/recibir', `#/recepcion/${abierto}`, `#/expediente/${rec}`, `#/remision/${rem}`, '#/proveedores', '#/perfil']],
    ['Distribuidora Central', 'ui-proveedor', ['#/pedidos', `#/pedido/${ped}`, '#/remisiones', `#/remision/${rem}`, '#/historial', '#/perfil']],
  ];

  for (const [nombre, clase, rutas] of roles) {
    await entrar(nombre);
    check(`${nombre}: interfaz correcta`, await ev(`document.body.classList.contains('${clase}')`));
    for (const w of [900, 1024, 1366, 1920, 768]) {
      await ancho(w);
      await dormir(150);
      const lateral = await ev(`getComputedStyle(document.querySelector('.nav')).flexDirection==='column'`);
      if (lateral !== (w >= 900)) check(`${nombre} ${w}: barra lateral`, false, String(lateral));
      for (const r of rutas) {
        await ev(`location.hash='${r}'`);
        await dormir(90);
        const m = await ev(`(()=>{const de=document.documentElement; const fuera=[...document.querySelectorAll('#app main *')].filter(x=>{const b=x.getBoundingClientRect(); return b.width>0 && b.right>innerWidth+1 && !x.closest('table') }).slice(0,2).map(x=>x.tagName+'.'+x.className); const bajoNav=(()=>{const n=document.querySelector('.nav').getBoundingClientRect(); const c=document.querySelector('#app main')?.getBoundingClientRect(); return innerWidth>=900 && c && c.left<n.right-1})(); return {o:de.scrollWidth-innerWidth,fuera,bajoNav}})()`);
        if (m.o > 0 || m.fuera.length || m.bajoNav) check(`${nombre} ${w} ${r}`, false, JSON.stringify(m));
      }
    }
    await ancho(1366);
    for (const r of rutas) {
      await ev(`location.hash='${r}'`);
      await foto(`${clase}-${r.replace(/[#/]/g, '_')}`);
    }
    console.log(`Revisado: ${nombre}, ${rutas.length} pantallas en 5 anchos`);
  }

  // Volver a una pantalla no debe descargar otra vez las fotos
  await entrar('Leo');
  await ancho(1366);
  await ev(`location.hash='#/inventario'`);
  await ev(`Promise.all([...document.images].map(i=>i.decode().catch(()=>{})))`);
  await cdp('Network.enable');
  // requestWillBeSent también se dispara al leer de caché: solo cuenta lo que realmente salió a la red.
  const enRed = new Map();
  const previo = ws.onmessage;
  ws.onmessage = m => {
    const d = JSON.parse(m.data), id = d.params?.requestId;
    if (d.method === 'Network.requestWillBeSent' && d.params.request.url.includes('/img/')) enRed.set(id, d.params.request.url);
    if (d.method === 'Network.requestServedFromCache') enRed.delete(id);
    if (d.method === 'Network.responseReceived' && (d.params.response.fromDiskCache || d.params.response.fromPrefetchCache)) enRed.delete(id);
    previo(m);
  };
  await ev(`location.hash='#/conteo/1'`); await dormir(300);
  await ev(`location.hash='#/inventario'`); await dormir(300);
  const cabecera = await ev(`fetch('/img/logo.png').then(r=>r.headers.get('cache-control'))`);
  console.log(`Descargas de imagen por red al navegar: ${enRed.size}; Cache-Control: ${cabecera}`);
  check('las fotos salen de caché al navegar', enRed.size === 0, String(enRed.size));
  ws.onmessage = previo;

  // Muy ancha
  await entrar('Leo');
  await ancho(1920);
  for (const r of ['#/inicio', `#/expediente/${rec}`]) { await ev(`location.hash='${r}'`); await foto(`ancha-${r.replace(/[#/]/g, '_')}`); }

  // Teclado: Enter avanza a la siguiente cantidad
  await ancho(1366);
  await ev(`location.hash='#/conteo/1'`);
  await dormir(200);
  const av = await ev(`(()=>{const c=[...document.querySelectorAll('#app input[type=number]')]; c[0].focus(); c[0].dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); return document.activeElement===c[1]})()`);
  check('Enter pasa a la siguiente cantidad', av);

  // Rutas de otro rol no se abren
  await entrar('Juan Pérez');
  await ev(`location.hash='#/reportes'`); await dormir(200);
  check('cocina sigue sin reportes en escritorio', !(await ev(`document.querySelector('h1')?.textContent`)).includes('Reportes'));

  // Impresión: la barra no debe salir
  await cdp('Emulation.setEmulatedMedia', { media: 'print' });
  check('al imprimir se oculta la barra', await ev(`getComputedStyle(document.querySelector('.nav')).display==='none'`));
  await cdp('Emulation.setEmulatedMedia', { media: '' });

  console.log('Excepciones JS:', errores.length ? errores : 'ninguna');
  console.log(`Fallas: ${fallas}`);
})().catch(err => console.log('ERROR', err)).finally(() => { br.kill(); srv.kill(); setTimeout(() => process.exit(0), 300); });
