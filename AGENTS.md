# AGENTS.md

## Proyecto
El Mesón · Sistema de inventarios: controla existencias, compras a proveedores, recepción con remisión firmada y recetas del restaurante El Mesón.

## Alcance
Se construye solo lo que está en `docs/especificacion.md`: catálogo de insumos y proveedores, conteos, solicitud → autorización → pedido, portal del proveedor, recepción con incidencias, devoluciones y correcciones, remisiones con versiones y firmas, recetas, producción y merma, y reportes de solo lectura.

Roles: Administrador (`admin`), Cocina (`staff`), Auxiliar de recepción (`auxiliar`) y Proveedor (`proveedor`). La matriz de permisos está en la sección 3 de la especificación.

## Lo que NO se construye
- Punto de venta, cobro a clientes o comandas.
- Validación fiscal con SAT o PAC. El checklist es solo una revisión interna.
- Envío automático por correo o WhatsApp. Solo se abre la aplicación del usuario y se registra como compartido a mano.
- Pagos, cuentas por pagar, nómina o control de asistencia.
- Varias sucursales.
- Borrado de registros, ni en la interfaz ni en la API.
- Dependencias de npm. El proyecto usa solo Node 24 (`node:sqlite`, `node:http`, `node:test`).
- Cualquier cosa que no esté escrita en `docs/especificacion.md`.

## Reglas de trabajo
- Una sola funcionalidad del plan del ciclo por petición.
- Datos y permisos antes que pantallas.
- Las reglas de permisos se escriben en la base de datos, no solo en la interfaz.
- Ningún registro se elimina: se marca como no vigente.
- Solo datos ficticios en las pruebas.
- Antes de modificar archivos, entrega un plan con: archivos a tocar, supuestos y verificación.
- Toda decisión nueva se registra en `docs/decisiones.md`. Si cambia una regla, también se cambia aquí y en la especificación.
- `meson.db`, `archivos/`, `respaldos/` y los reportes tienen datos del negocio y no van a git.

## Vocabulario
| Término | Significado |
|---|---|
| Insumo | Producto que se guarda en inventario (pollo, arroz). Su existencia se lleva en su unidad (kg, L, pieza). |
| Presentación | Forma en que se compra un insumo (caja de 10 kg). Su contenido no cambia. |
| Existencia / stock | Cantidad actual de un insumo. Nunca es negativa. |
| Estado OK / Bajo / Crítico | Bajo: por debajo del mínimo. Crítico: por debajo del 25 % del mínimo. |
| Conteo | Captura física que ajusta la existencia de una categoría. |
| Movimiento | Registro de cada cambio de existencia. Solo se agregan, nunca se editan. |
| Solicitud | Petición de compra de Cocina. Solo el Administrador la autoriza. |
| Pedido | Compra a un proveedor que nace de una solicitud autorizada. |
| Avance | Lo que informa el proveedor: por confirmar → confirmado → en camino. |
| Recepción | Entrega física de un pedido. Un pedido puede tener varias. |
| Aceptado / rechazado / faltante / pendiente | Aceptado entra al inventario. Rechazado llegó y no se aceptó. Faltante no llegó. Pendiente es lo pedido que aún no se acepta. |
| Incidencia | Problema documentado en una recepción. Se cierra con una nota. |
| Corrección | Registro que ajusta una recepción mal capturada sin modificar la original. |
| Remisión | Documento de la recepción con folio, versión y firmas de entrega y recibe. |
| Merma / rendimiento | Merma es lo que se pierde al limpiar (40 %). Se guarda como rendimiento (60 %). |
| Sub-receta | Receta que produce un insumo (una salsa) que otras recetas usan. |
| No vigente | Registro desactivado que se conserva para el historial. |

## Comandos
```
npm start                        # servidor en http://127.0.0.1:3000
npm test                         # todas las pruebas (node:test)
node --test test/api.test.js     # solo un archivo de pruebas
PIN_INICIAL=1234 npm start       # base nueva con el mismo PIN para los usuarios ficticios
SIN_DEMO=1 npm start             # base nueva sin datos de ejemplo
node procesos-java/verificar.js  # compara los reportes Java con la pantalla
```
Para empezar de cero, borra `meson.db` antes de arrancar. En PowerShell las variables se ponen así: `$env:PIN_INICIAL='1234'; npm start`.

## Mapa del código
- `db.js`: esquema, migraciones, triggers de solo agregar y datos ficticios.
- `server.js`: HTTP, sesiones, permisos por ruta y catálogo, solicitudes y portal del proveedor.
- `operacion.js`: pedidos, recepciones, correcciones, devoluciones, remisiones, documentos, recetas, producción y merma.
- `public/`: interfaz (sin framework).
- `test/`: pruebas con cuentas ficticias.
- `procesos-java/`: reportes de solo lectura.

## Documentos del proyecto
La especificación vigente está en docs/especificacion.md. Léela antes de proponer cualquier plan.
El plan del ciclo en curso está en docs/plan-ciclo.md.
Si una petición contradice la especificación, detente y pregunta antes de modificar archivos.
Las decisiones están en docs/decisiones.md y los cambios respecto de G2 en docs/correspondencia-g2.md.
