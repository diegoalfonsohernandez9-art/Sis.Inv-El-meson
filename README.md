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

## Reglas del sistema

- **Estado de un insumo:** Crítico por debajo del 25 % del mínimo, Bajo por debajo del mínimo y OK en los demás casos.
- **Stock:** solo cambia por conteo, recepción, producción, merma adicional o devolución de mercancía, y cada cambio queda en movimientos.
- **Autorizar una solicitud:** solo administración puede hacerlo, y se crea un pedido por proveedor.
- **Recepción:** un pedido admite varias entregas. Al inventario entra solo lo aceptado; lo pendiente se recibe después o se cierra con justificación.
- **Faltante, rechazo y pendiente:** faltante es lo que no llegó; rechazado es lo que llegó y no se aceptó; pendiente es lo pedido que aún no se acepta, así que lo rechazado se puede volver a entregar.
- **Rendimiento y merma:** si la línea de la receta define merma, se usa esa; si no, el rendimiento del insumo. Nunca las dos. La merma adicional se registra aparte.
- **Remisión:** devolverla con observaciones no toca el inventario. Devolver mercancía sí descuenta, solo hasta lo aceptado. Cambiar una remisión emitida crea otra versión, conserva la anterior y pide firmas otra vez.

## Integraciones pendientes

- **Validación fiscal (SAT/PAC):** no conectada. El checklist es una revisión interna.
- **Envío por correo o WhatsApp:** no conectado. Se abre la aplicación del usuario y queda registrado como compartido a mano, sin confirmación. La publicación en el portal del proveedor sí es real.
- **Control de asistencia:** no existe en este sistema.
