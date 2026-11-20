# El Mesón · Sistema de inventarios

Requiere Node 24 o superior. No tiene dependencias que instalar.

```
npm start     # abre en http://127.0.0.1:3000
npm test
```

**PIN de acceso:** la primera vez que arranca, crea `meson.db` e imprime en la terminal un PIN para cada usuario. Solo se muestran esa vez. Cámbialos en Perfil. Si los pierdes antes de usar el sistema, borra `meson.db` y vuelve a arrancar.

**Empezar sin datos de ejemplo:** borra `meson.db` y arranca con la variable `SIN_DEMO=1`. Se crea un único usuario, "Administrador".

**Usarlo desde los teléfonos del restaurante:** arranca con `HOST=0.0.0.0` y entra a `http://<IP-de-la-computadora>:3000`. Sin HTTPS, los PIN viajan sin cifrar por la red. Úsalo solo en una red de confianza y no lo expongas a internet sin HTTPS.

**Respaldo:** con el servidor detenido, copia `meson.db` (junto con `meson.db-wal`, si existe) y la carpeta `archivos/`, donde están las facturas, fotos y evidencias.

## Interfaces

Cada usuario entra a la interfaz de su rol. El servidor aplica los permisos, no solo la pantalla.

| Rol | Interfaz | Qué hace |
|---|---|---|
| Administrador | Panel administrativo (con barra lateral en computadora) | Autoriza solicitudes y consulta reportes. Administra insumos, proveedores y usuarios. |
| Cocina | Cocina (pensada para el teléfono) | Registra conteos, pide insumos, recibe pedidos y registra producción. |
| Auxiliar de recepción | Flujo de recepción | Recibe pedidos, documenta incidencias, firma, devuelve y envía remisiones. No cambia datos fiscales, precios ni permisos. |
| Proveedor | Portal de proveedores | Ve solo sus pedidos, los confirma, avisa cuando van en camino y reporta problemas. |

Para dar acceso a un proveedor: en Perfil → Usuarios, agrega un usuario con rol Proveedor y elige a qué proveedor pertenece. Un proveedor que trabaja desde fuera del restaurante necesita que el sistema esté publicado con HTTPS.

Al actualizar desde una versión anterior, la base se migra sola al arrancar y deja una copia en `meson.db.respaldo-v0` o `meson.db.respaldo-v1`.

## Variables

| Variable | Uso | Valor por defecto |
|---|---|---|
| `PORT` | Puerto | `3000` |
| `HOST` | Interfaz de red | `127.0.0.1` |
| `DB_PATH` | Archivo de base de datos | `meson.db` |
| `ARCHIVOS_DIR` | Carpeta de adjuntos | `archivos/` junto a la base |
| `LUGAR_ENTREGA` | Lugar de entrega inicial en remisiones | `El Mesón` |
| `SIN_DEMO` | Sin datos de ejemplo al crear la base | no definida |
| `PIN_INICIAL` | Mismo PIN para los usuarios sembrados (solo pruebas) | PIN aleatorio |
| `SIN_PIN` | `1` = modo desarrollo: se entra eligiendo el usuario, sin PIN. Solo con `HOST=127.0.0.1`; los permisos por rol siguen. **Quitarlo antes de usarlo en el restaurante.** `iniciar.bat` lo activa. | Apagado |

## Reglas del sistema

- **Estado de un insumo:** Crítico por debajo del 25 % del mínimo, Bajo por debajo del mínimo y OK en los demás casos.
- **Stock:** solo cambia por conteo, recepción, producción, merma adicional o devolución de mercancía, y cada cambio queda en movimientos.
- **Autorizar una solicitud:** solo administración puede hacerlo, y se crea un pedido por proveedor.
- **Recepción:** un pedido admite varias entregas. Al inventario entra solo lo aceptado; lo pendiente se recibe después o se cierra con justificación.
- **Faltante, rechazo y pendiente:** faltante es lo que no llegó; rechazado es lo que llegó y no se aceptó; pendiente es lo pedido que aún no se acepta, así que lo rechazado se puede volver a entregar.
- **Merma:** el insumo se captura con su merma (pollo: 40 %) y se guarda como rendimiento (60 %). Si la línea de la receta define merma, se usa esa y no la del insumo. Nunca las dos. La merma adicional se registra aparte.
- **Margen:** precio de venta por porción menos el costo por porción. Sin precio de venta o sin precio de algún insumo, no se calcula.
- **Sub-recetas:** una receta (la salsa) puede producir un insumo. Producirla descuenta sus ingredientes y suma lo que rinde; los platillos la usan como ingrediente y muestran para cuántas porciones sale una tanda.
- **Remisión:** devolverla con observaciones no toca el inventario. Devolver mercancía sí descuenta, solo hasta lo aceptado. Cambiar una remisión emitida crea otra versión, conserva la anterior y pide firmas otra vez.

## Integraciones pendientes

- **Validación fiscal (SAT/PAC):** no conectada. El checklist es una revisión interna.
- **Envío por correo o WhatsApp:** no conectado. Se abre la aplicación del usuario y queda registrado como compartido a mano, sin confirmación. La publicación en el portal del proveedor sí es real.
- **Control de asistencia:** no existe en este sistema.

## Procesos en Java
`procesos-java/` genera reportes en CSV (se abren en Excel) con el sistema encendido. Requiere Java 21 (Eclipse Temurin).
- **Ejecutar:** doble clic en `procesos-java/ejecutar.bat`. Pide usuario y PIN de **Administrador**, y el PIN no se guarda.
- **Genera:** en `procesos-java/reportes/<fecha>/` → `existencias.csv` (estado OK, Bajo o Crítico), `reabastecimiento.csv` (qué pedir, a qué proveedor y en cuántas cajas), `recetas.csv` (costo, margen, alcanza para) y `merma.csv` (últimos 30 días).
- **Solo lee:** entra por la API con los mismos permisos que las pantallas; no crea pedidos ni mueve inventario. Los reportes tienen datos del negocio y no van a git.
- **Verificar:** `node procesos-java/verificar.js` usa una base de prueba con datos ficticios y compara las cifras con las de la pantalla.

## Respaldo automático
- **Cada día a las 11:30 p.m.** la tarea de Windows "El Meson - respaldo diario" corre `respaldar.bat`. Si la laptop estaba apagada a esa hora, corre al encenderla.
- **Guarda** `respaldos/meson-AAAA-MM-DD.db` (uno por día) y conserva los **últimos 30**. La carpeta está dentro de OneDrive, así que también sube a la nube. Los respaldos con otro nombre (manuales) nunca se borran.
- **Es seguro con el sistema abierto:** usa `VACUUM INTO` y revisa la integridad de cada copia antes de guardarla. El registro queda en `respaldos/respaldos.log`.
- **Respaldo manual:** doble clic en `respaldar.bat`.
- **Restaurar:** apaga el sistema, renombra `meson.db` (por ejemplo a `meson.db.dañada`), copia el respaldo elegido como `meson.db` y vuelve a encender.
- **Quitar la tarea:** `schtasks /delete /tn "El Meson - respaldo diario" /f`.
