// Recorre en Chrome headless el flujo completo con el caso de los 20 kg de pollo.
const { spawn } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const [chrome, proyecto] = process.argv.slice(2);
const dir = __dirname, shots = path.join(dir, 'shots3'), dbFile = path.join(dir, 'e2e3', 'prueba.db');
fs.rmSync(path.join(dir, 'e2e3'), { recursive: true, force: true });
fs.mkdirSync(path.join(dir, 'e2e3'), { recursive: true });
fs.mkdirSync(shots, { recursive: true });
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(proyecto, 'server.js')], { env: { ...process.env, PIN_INICIAL: '1234', DB_PATH: dbFile, PORT: '3114' }, stdio: 'inherit' });
const br = spawn(chrome, ['--headless=new', '--remote-debugging-port=9335', `--user-data-dir=${path.join(dir, 'perfil3')}`, '--no-first-run', '--disable-gpu', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
const dormir = ms => new Promise(r => setTimeout(r, ms));
const errores = [];
let fallas = 0;

(async () => {
  let t;
  for (let i = 0; i < 60 && !t; i++) { await dormir(250); try { t = (await (await fetch('http://127.0.0.1:9335/json')).json()).find(x => x.type === 'page'); } catch {} }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => { ws.onopen = r; });
  let n = 0; const pend = new Map();
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id) { pend.get(d.id)(d); pend.delete(d.id); }
    if (d.method === 'Runtime.exceptionThrown') errores.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errores.push(JSON.stringify(d.params.args.map(a => a.value)));
  };
  const cdp = (method, params = {}) => new Promise(r => { const id = ++n; pend.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async expr => {
    const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(`${expr.slice(0, 150)}: ${r.result.exceptionDetails.exception?.description}`);
    return r.result.result.value;
  };
  const ancho = w => cdp('Emulation.setDeviceMetricsOverride', { width: w, height: w > 600 ? 800 : 844, deviceScaleFactor: 1, mobile: w <= 600 });
  const foto = async (nombre, completa = true) => {
    await dormir(300);
    const r = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: completa });
    fs.writeFileSync(path.join(shots, `${nombre}.png`), Buffer.from(r.result.data, 'base64'));
  };
  const ir = async h => { await ev(`location.hash='${h}'`); await dormir(200); };
  const clic = async sel => { await ev(`document.querySelector(${JSON.stringify(sel)}).click()`); await dormir(350); };
  const clicTexto = async (txt, sel = 'button, a.btn') => { await ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].find(b=>b.textContent.includes(${JSON.stringify(txt)})).click()`); await dormir(350); };
  const escribir = (sel, v) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const marcar = sel => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); e.checked=true; e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const texto = (sel = 'main') => ev(`document.querySelector(${JSON.stringify(sel)})?.textContent || ''`);
  const check = (nombre, ok, extra = '') => { if (!ok) fallas++; console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre} ${extra}`); };
  const estado = () => ev(`fetch('/api/estado').then(r=>r.json())`);
  const sinDesborde = async e => { const o = await ev('document.documentElement.scrollWidth - innerWidth'); if (o > 0) check(`sin scroll horizontal ${e}`, false, `${o}px`); };
  const entrar = async (tipo, nombre) => {
    await clic(`[data-tipo=${tipo}]`);
    const hay = await ev(`(()=>{const o=[...document.querySelectorAll('[name=usuario_id] option')].find(o=>o.textContent===${JSON.stringify(nombre)}); if(o) document.querySelector('[name=usuario_id]').value=o.value; return !!o})()`);
    if (!hay) throw new Error(`sin usuario ${nombre}`);
    await escribir('[name=pin]', '1234');
    await clic('#form-login button');
    await dormir(400);
  };
  const salir = async () => { await ir('#/perfil'); await clicTexto('Cerrar sesión'); await dormir(400); };
  const firmaEn = async () => ev(`(async()=>{const c=document.querySelector('#dialogo canvas'); const r=c.getBoundingClientRect();
    const f=(tipo,x,y)=>c.dispatchEvent(new PointerEvent(tipo,{pointerId:1,clientX:r.left+x*r.width,clientY:r.top+y*r.height,bubbles:true}));
    c.setPointerCapture=()=>{}; f('pointerdown',.1,.5); for(let i=1;i<=30;i++) f('pointermove',.1+i*.027,.5+Math.sin(i/2)*.3); f('pointerup',.9,.5); return true})()`);
  const subirArchivo = (sel, nombre, tipo, b64) => ev(`(()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(b64)}),c=>c.charCodeAt(0)); const dt=new DataTransfer(); dt.items.add(new File([bytes],${JSON.stringify(nombre)},{type:${JSON.stringify(tipo)}})); document.querySelector(${JSON.stringify(sel)}).files=dt.files; return true})()`);
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64').toString('base64');

  await cdp('Runtime.enable'); await cdp('Page.enable');
  await ancho(390);
  await cdp('Page.navigate', { url: 'http://127.0.0.1:3114/' });
  await dormir(900);
  await foto('00-login', false);

  // 1. Administración: alta de proveedor, rendimiento, receta y pedido
  await entrar('admin', 'Leo');
  await ir('#/proveedores');
  await clicTexto('Agregar proveedor');
  await foto('01-alta-proveedor', false);
  await escribir('#dialogo [name=nombre]', 'Carnes del Norte');
  await escribir('#dialogo [name=contacto]', '8112345678');
  await ev(`document.querySelector('#dialogo details').open=true`);
  await escribir('#dialogo [name=razon_social]', 'Carnes del Norte SA de CV');
  await escribir('#dialogo [name=rfc]', 'cno010101ab1');
  await escribir('#dialogo [name=cp]', '64000');
  await escribir('#dialogo [name=regimen_fiscal]', '601');
  await escribir('#dialogo [name=correo]', 'ventas@carnes.example');
  await clic('#dialogo button[value=ok]');
  await dormir(300);
  let e = await estado();
  const prov = e.proveedores.find(p => p.nombre === 'Carnes del Norte');
  check('alta de proveedor con datos fiscales', prov?.rfc === 'CNO010101AB1' && prov.cp === '64000');
  await ir(`#/proveedor/${prov.id}`);
  await foto('02-ficha-proveedor'); await sinDesborde('ficha proveedor');

  const pollo = e.insumos.find(i => i.nombre === 'Pollo (pechuga)');
  const stockInicial = pollo.stock;
  await ir(`#/insumo/${pollo.id}`);
  await clicTexto('Editar');
  await escribir('#dialogo [name=rendimiento]', '80');
  await ev(`document.querySelector('#dialogo details').open=true`);
  await escribir('#dialogo [name=costo]', '90');
  await clic('#dialogo button[value=ok]');
  await dormir(300);
  await foto('03-insumo-rendimiento', false);
  check('muestra rendimiento y aprovechable', (await texto()).includes('80 %'));

  await ir('#/receta-editar');
  await escribir('#re-nombre', 'Pollo asado');
  await escribir('#re-porciones', '4');
  await ev(`(()=>{const f=document.querySelector('#ed-re .fila-ed'); f.querySelector('select').value='${pollo.id}'; f.querySelector('[data-col=neta]').value='1'; f.querySelector('[data-col=merma]').value='20';})()`);
  await foto('04-editar-receta');
  await clicTexto('Guardar receta');
  await dormir(400);
  await foto('05-receta');
  const receta = (await estado()).recetas[0];
  check('receta usa su merma y no el rendimiento', receta.lineas[0].fuente === 'receta' && receta.lineas[0].bruta === 1.25);

  await ir('#/nuevo-pedido');
  await ev(`document.querySelector('#np-prov').value='${prov.id}'`);
  await ev(`(()=>{const f=document.querySelector('#ed-np .fila-ed'); f.querySelector('select').value='${pollo.id}'; f.querySelector('[data-col=cantidad]').value='20'; f.querySelector('[data-col=precio]').value='90';})()`);
  await clicTexto('Crear pedido');
  await dormir(400);
  e = await estado();
  const ped = e.pedidos.find(p => p.proveedor_id === prov.id);
  check('pedido de 20 kg creado', ped?.lineas[0].cantidad === 20 && ped.entrega === 'pendiente');
  await salir();

  // 2. Auxiliar: 20 pedidos, 10 llegan
  await entrar('auxiliar', 'Carlos Méndez');
  check('auxiliar entra a su interfaz', await ev(`document.body.classList.contains('ui-auxiliar')`));
  await foto('10-auxiliar-hoy'); await sinDesborde('auxiliar hoy');
  await ir(`#/recepcion/${ped.id}`);
  await foto('11-recepcion-inicio'); await sinDesborde('recepción');
  await escribir(`[data-draft="rcp.${ped.id}.folio"]`, 'NOTA-500');
  await escribir(`[data-draft="rcp.${ped.id}.${pollo.id}.rec"]`, '10');
  await dormir(100);
  const msg = await texto('.msg-linea');
  check('muestra claramente que faltan 10 kg', msg.includes('Faltan 10 kg') && msg.includes('Entra al inventario: 10 kg'), msg);
  await escribir(`[data-draft="rcp.${ped.id}.${pollo.id}.nota"]`, 'Llegó la mitad del pedido');
  await foto('12-recepcion-faltante');
  check('oculta cuánto aceptas si no es parcial', await ev(`getComputedStyle(document.querySelector('.cmp-par')).display==='none'`));
  await clicTexto('Revisar y confirmar');
  await foto('13-confirmar', false);
  check('resumen antes de confirmar', (await texto('#dialogo')).includes('Faltante, queda pendiente'));
  e = await estado();
  check('nada entra antes de confirmar', e.insumos.find(i => i.id === pollo.id).stock === stockInicial);
  await clic('#dialogo button[value=ok]');
  await dormir(500);
  e = await estado();
  check('entran solo los 10 kg aceptados', e.insumos.find(i => i.id === pollo.id).stock === stockInicial + 10);
  const rec = e.recepciones.find(r => r.pedido_id === ped.id);
  check('pedido queda recibido parcialmente', e.pedidos.find(p => p.id === ped.id).entrega === 'recibida_parcial');
  check('pasa al expediente', (await ev('location.hash')) === `#/expediente/${rec.id}`);
  await foto('14-expediente'); await sinDesborde('expediente');
  check('incidencia de faltante', (await texto()).includes('Faltante: Pollo (pechuga) 10 kg'));

  // 3. Evidencia y checklist
  await clicTexto('Adjuntar');
  await ev(`document.querySelector('#dialogo [name=tipo]').value='foto'`);
  await subirArchivo('#dialogo [name=archivo]', 'caja-pollo.png', 'image/png', PNG);
  await clic('#dialogo button[value=ok]');
  await dormir(500);
  check('evidencia ligada a la recepción', (await estado()).documentos.some(d => d.recepcion_id === rec.id && d.nombre === 'caja-pollo.png'));
  check('aviso: no hay validación fiscal', (await texto()).includes('no es validación fiscal'));
  for (const k of ['proveedor', 'pedido', 'productos', 'calidad', 'precios', 'importes', 'documento', 'datos_fiscales', 'folio', 'adjuntos']) await marcar(`[name="chk.${rec.id}.${k}"][value=ok]`);
  await marcar(`[name="chk.${rec.id}.cantidades"][value=observacion]`);
  await escribir(`[data-draft="chk.${rec.id}.notas"]`, 'Faltan 10 kg de pollo');
  await clicTexto('Guardar revisión');
  await dormir(400);
  e = await estado();
  const r2 = e.recepciones.find(r => r.id === rec.id);
  check('revisión documental separada de la entrega', r2.doc_estado === 'con_observaciones' && r2.estado === 'recibida_parcial' && r2.revisor === 'Carlos Méndez');

  // 4. Remisión: borrador, emitir, devolver, firmas, envío
  await clicTexto('Generar remisión');
  await dormir(500);
  e = await estado();
  const rem = e.remisiones.find(r => r.recepcion_id === rec.id);
  check('borrador sin recapturar datos', rem.contenido.lineas[0].pendiente === 10 && rem.contenido.lineas[0].aceptada === 10 && rem.contenido.folio_entrega === 'NOTA-500');
  await foto('20-remision-borrador'); await sinDesborde('remisión');
  check('se identifica como remisión, no factura', (await texto()).includes('No es una factura'));
  await clicTexto('Emitir');
  await dormir(400);
  await foto('21-remision-emitida');
  await clicTexto('Devolver con observaciones');
  await foto('22-devolver', false);
  await escribir('#dialogo [name=motivo]', 'Faltan 10 kg de pollo');
  await ev(`document.querySelector('#dialogo details').open=true`);
  await escribir(`#dialogo [name=n${pollo.id}]`, 'Se pidieron 20 kg, llegaron 10 kg');
  await clic('#dialogo button[value=ok]');
  await dormir(500);
  e = await estado();
  check('devolver la remisión no cambia existencias', e.insumos.find(i => i.id === pollo.id).stock === stockInicial + 10);
  check('estado Devuelta con observaciones', e.remisiones.find(r => r.id === rem.id).estado === 'devuelta');

  await clicTexto('Firma aquí');
  await foto('23-firma', false);
  check('resumen antes de firmar', (await texto('#dialogo')).includes('Pendiente:'));
  await escribir('#dialogo [name=nombre]', 'Repartidor Uno');
  await clic('#dialogo button[value=ok]');
  await dormir(200);
  check('exige trazo de firma', (await texto('#dialogo .error')).includes('Firma aquí'));
  await firmaEn();
  await foto('24-firma-trazo', false);
  await clic('#dialogo button[value=ok]');
  await dormir(500);
  await clicTexto('Firma aquí');
  check('precarga a quien recibe', (await ev(`document.querySelector('#dialogo [name=nombre]').value`)) === 'Carlos Méndez');
  await ev(`document.querySelector('#dialogo [name=no_firma]').checked=true`);
  await escribir('#dialogo [name=motivo]', 'Se ausentó del área');
  await clic('#dialogo button[value=ok]');
  await dormir(500);
  e = await estado();
  check('firma real y pendiente con motivo', e.remisiones.find(r => r.id === rem.id).firma_estado === 'pendiente_con_motivo' && e.remisiones.find(r => r.id === rem.id).firmas.length === 2);
  await foto('25-firmas'); await sinDesborde('firmas');

  check('avisa que no hay envío automático', (await texto()).includes('no está conectado'));
  const conEnvio = await ev(`!!document.querySelector('[data-canal=portal]')`);
  check('sin usuario de portal no ofrece publicar', !conEnvio);
  await ev(`(()=>{const a=document.querySelector('[data-canal=whatsapp]'); a.removeAttribute('target'); a.addEventListener('click',e=>e.preventDefault()); a.click();})()`);
  await dormir(500);
  e = await estado();
  check('WhatsApp queda sin confirmar', e.remisiones.find(r => r.id === rem.id).envio_estado === 'compartida_manual');

  const pdf = await ev(`fetch('/api/remisiones/${rem.id}/pdf').then(async r=>({s:r.status,t:r.headers.get('content-type'),x:await r.text()}))`);
  check('PDF con observaciones', pdf.s === 200 && pdf.t === 'application/pdf' && pdf.x.startsWith('%PDF') && pdf.x.includes('Faltan 10 kg de pollo'));
  const b64 = await ev(`fetch('/api/remisiones/${rem.id}/pdf').then(r=>r.arrayBuffer()).then(b=>btoa(String.fromCharCode(...new Uint8Array(b))))`);
  fs.writeFileSync(path.join(shots, 'remision.pdf'), Buffer.from(b64, 'base64'));

  // 5. Corrección: versión nueva, firmas de nuevo
  await clicTexto('Registrar corrección');
  await escribir('#dialogo [name=motivo]', 'El proveedor corrigió el folio de su nota');
  await clic('#dialogo button[value=ok]');
  await dormir(600);
  e = await estado();
  const v2 = e.remisiones.find(r => r.anterior_id === rem.id);
  check('versión 2 conserva la original', v2?.version === 2 && e.remisiones.find(r => r.id === rem.id).estado === 'reemplazada' && e.remisiones.find(r => r.id === rem.id).firmas.length === 2);
  check('versión 2 pide firmas', v2.firmas.length === 0);
  await clicTexto('Emitir');
  await dormir(400);
  await foto('26-version2');
  e = await estado();
  check('versiones no mueven inventario', e.insumos.find(i => i.id === pollo.id).stock === stockInicial + 10);
  check('entradas de esta recepción: una sola', e.movimientos.filter(m => m.ref === `recepcion:${rec.id}`).length === 1);

  // 6. Devolución física
  await ir(`#/pedido/${ped.id}`);
  await foto('30-pedido'); await sinDesborde('pedido');
  await clicTexto('Devolver mercancía');
  await foto('31-devolver-mercancia', false);
  await escribir('#dialogo [name=comprobante]', 'DEV-77');
  await escribir('#dialogo [name=motivo]', 'Olor extraño');
  await escribir(`#dialogo [name=c${pollo.id}]`, '11');
  await clic('#dialogo button[value=ok]');
  await dormir(300);
  check('no devuelve más de lo aceptado', (await texto('#dialogo .error')).includes('solo se pueden devolver 10'));
  await escribir(`#dialogo [name=c${pollo.id}]`, '2');
  await clic('#dialogo button[value=ok]');
  await dormir(500);
  e = await estado();
  check('devolución física descuenta solo 2 kg', e.insumos.find(i => i.id === pollo.id).stock === stockInicial + 8);

  // 7. Llega el resto y permisos del auxiliar
  await ir(`#/recepcion/${ped.id}`);
  check('solo espera lo pendiente', (await texto('.linea-rec')).includes('Se esperan 10 kg'));
  await escribir(`[data-draft="rcp.${ped.id}.folio"]`, 'NOTA-501');
  await clicTexto('Revisar y confirmar');
  await clic('#dialogo button[value=ok]');
  await dormir(500);
  e = await estado();
  check('entrega posterior sin duplicar', e.insumos.find(i => i.id === pollo.id).stock === stockInicial + 18 && e.pedidos.find(p => p.id === ped.id).entrega === 'aceptada');
  await ir(`#/proveedor/${prov.id}`);
  check('auxiliar no edita datos fiscales', !(await ev(`!!document.querySelector('[data-act=editarProveedor]')`)));
  await ir('#/reportes');
  check('auxiliar no llega a reportes', !(await texto('h1')).includes('Reportes'));
  await salir();

  // 8. Cocina: producción con merma y consumo
  await entrar('staff', 'Juan Pérez');
  await ir(`#/receta/${receta.id}`);
  await clicTexto('Registrar producción');
  await clic('#dialogo button[value=ok]');
  await dormir(500);
  e = await estado();
  check('producción descuenta el bruto (1.25 kg) una vez', e.insumos.find(i => i.id === pollo.id).stock === stockInicial + 16.75);
  await salir();

  // 9. Escritorio y rechazo total en administración
  await entrar('admin', 'Leo');
  await ancho(1366);
  for (const [h, f] of [['#/inicio', 'd1-resumen'], [`#/proveedor/${prov.id}`, 'd2-proveedor'], [`#/expediente/${rec.id}`, 'd3-expediente'], [`#/remision/${v2.id}`, 'd4-remision'], ['#/pendientes', 'd5-pendientes'], ['#/reportes', 'd6-reportes']]) {
    await ir(h); await foto(f); await sinDesborde(`escritorio ${h}`);
  }
  await ancho(390);
  await ir('#/nuevo-pedido');
  await ev(`document.querySelector('#np-prov').value='${prov.id}'`);
  await ev(`(()=>{const f=document.querySelector('#ed-np .fila-ed'); f.querySelector('select').value='${pollo.id}'; f.querySelector('[data-col=cantidad]').value='20';})()`);
  await clicTexto('Crear pedido');
  await dormir(400);
  e = await estado();
  const ped2 = e.pedidos.find(p => p.proveedor_id === prov.id && p.id !== ped.id);
  const antes = e.insumos.find(i => i.id === pollo.id).stock;
  await ir(`#/recepcion/${ped2.id}`);
  await clicTexto('Rechazar toda la entrega');
  await escribir('#dialogo [name=motivo]', 'Cadena de frío rota');
  await clic('#dialogo button[value=ok]');
  await dormir(500);
  e = await estado();
  check('rechazo total: sin entrada al inventario', e.insumos.find(i => i.id === pollo.id).stock === antes && e.pedidos.find(p => p.id === ped2.id).entrega === 'rechazada');
  await foto('40-rechazo-total');

  // 10. Portal: publicar, consultar observaciones y subir corrección
  await ev(`fetch('/api/usuarios',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nombre:'Portal Carnes',rol:'proveedor',area:'Proveedor',proveedor_id:${prov.id},pin:'1234'})})`);
  await ev(`fetch('/api/remisiones/${v2.id}/devolver',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tipo:'error_documento',motivo:'El folio no coincide'})})`);
  await ir('#/inicio'); await ev('refrescar()'); await ir(`#/remision/${v2.id}`);
  await clic('[data-canal=portal]');
  await dormir(400);
  e = await estado();
  check('publicada en portal es envío real', e.remisiones.find(r => r.id === v2.id).envio_estado === 'publicada_portal');
  await salir();
  await entrar('proveedor', 'Portal Carnes');
  await ir('#/remisiones');
  await foto('50-portal-remisiones', false); await sinDesborde('portal remisiones');
  await ir(`#/remision/${v2.id}`);
  await foto('51-portal-remision'); await sinDesborde('portal remisión');
  check('proveedor ve las observaciones', (await texto()).includes('El folio no coincide'));
  await clicTexto('Subir remisión corregida');
  await subirArchivo('#dialogo [name=archivo]', 'corregida.png', 'image/png', PNG);
  await clic('#dialogo button[value=ok]');
  await dormir(500);
  check('corrección subida y visible', (await texto()).includes('corregida.png'));
  await ir(`#/remision/${rem.id}`);
  check('versión no compartida no es visible', (await texto()).includes('no encontrado'));
  await salir();

  console.log('Excepciones JS:', errores.length ? errores : 'ninguna');
  console.log(`Fallas: ${fallas}`);
})().catch(err => console.log('ERROR', err)).finally(() => { br.kill(); srv.kill(); setTimeout(() => process.exit(0), 300); });
