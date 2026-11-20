# Especificación maestra (vigente)

<!-- Una sola versión vigente en docs/. Los cambios respecto de G2 están en docs/correspondencia-g2.md. -->

Sistema de inventarios de El Mesón (restaurante). Controla existencias de insumos, solicitudes de compra, pedidos a proveedores, recepción de mercancía con remisión firmada, recetas y producción.

## 1. Propósito y alcance

| Dentro | Fuera (no se construye) |
|---|---|
| Catálogo de insumos, categorías, presentaciones y proveedores | Punto de venta, cobro a clientes, comandas |
| Conteo físico de existencias y estado OK / Bajo / Crítico | Validación fiscal con SAT o PAC (el checklist es solo revisión interna) |
| Solicitud de compra → autorización → pedido por proveedor | Envío automático por correo o WhatsApp (solo se abre la app del usuario) |
| Portal del proveedor: confirmar, avisar "en camino", reportar problema | Pagos a proveedores y cuentas por pagar |
| Recepción parcial o total, incidencias, devoluciones, correcciones | Control de asistencia o nómina |
| Remisión con versiones, firmas y envío | Varias sucursales |
| Recetas, sub-recetas, producción, merma y margen | Borrar registros (todo se marca no vigente o se corrige) |
| Reportes de solo lectura (procesos en Java por la API) | App móvil nativa (se usa el navegador del teléfono) |

## 2. Actores y roles

| Rol (en la base) | Nombre en pantalla | Quién es | Usuario ficticio de prueba |
|---|---|---|---|
| `admin` | Administrador | Gerencia del restaurante | Leo |
| `staff` | Cocina | Cocineros | Juan Pérez |
| `auxiliar` | Auxiliar de recepción | Almacén / recibe mercancía | Carlos Méndez |
| `proveedor` | Proveedor | Usuario de una empresa proveedora; pertenece a un solo proveedor | Distribuidora Central, Alimentos del Bajío |

Todos entran con usuario + PIN. Las sesiones de un usuario desactivado dejan de valer de inmediato.

## 3. Matriz de permisos por rol y entidad

C = crear · L = leer · M = modificar · — = sin acceso. "Propio" = solo lo de su proveedor. "Asignado" = solo pedidos asignados a él o sin asignar.
Todas las reglas las aplica el servidor (`server.js`, `operacion.js`) y, donde se indica, la base de datos (`db.js`). La pantalla solo las refleja.

| Entidad | Administrador | Cocina | Auxiliar | Proveedor |
|---|---|---|---|---|
| Usuarios | C L M (no puede quitarse su propio rol admin) | — (solo cambia su PIN) | — (solo cambia su PIN) | — (solo cambia su PIN) |
| Insumos, categorías, presentaciones | C L M | L | L | — |
| Proveedores | C L M | L | L | — |
| Conteos (ajustan existencia) | C L | C L | C L | — |
| Merma adicional | C L | C L | C L | — |
| Solicitudes de compra | C L, autoriza y rechaza | C L | C L | — |
| Pedidos | C L M (asigna auxiliar) | L | L (asignado) | L propio; confirma, avisa en camino, reporta problema |
| Recepciones e incidencias | C L | C L | C L (asignado) | — |
| Correcciones de recepción | C L | L | L | — |
| Devoluciones de mercancía | C L | C L | C L (asignado) | — |
| Remisiones (borrador, emitir, versión, devolver, firmar, enviar) | C L M | C L M | C L M (asignado) | L propia y compartida |
| Documentos adjuntos | C L | C L | C L (asignado) | L propio; C solo remisión o factura corregida en remisión devuelta |
| Recetas | C L M | L | L | — |
| Producción | C L | C L | L (no puede registrar) | — |
| Reportes (Java, solo lectura) | L | — | — | — |

Reglas que impone la base de datos (triggers en `db.js`), no solo el servidor:
- Una línea de recepción no se modifica ni se borra; se corrige con un registro de corrección.
- Una corrección no se modifica ni se borra.
- Una presentación no se borra ni cambia de contenido; se marca no vigente.
- La existencia nunca es negativa (`CHECK (stock >= 0)`).
- El rol solo puede ser `admin`, `staff`, `auxiliar` o `proveedor`.

## 4. Entidades, relaciones y estados

| Entidad | Atributos clave | Relaciones | Estados |
|---|---|---|---|
| Usuario | nombre, rol, área, PIN (hash), activo | proveedor (si rol = proveedor) | activo / inactivo |
| Categoría | nombre, ícono | tiene muchos insumos | — |
| Insumo | nombre, unidad, existencia, mín, máx, código, merma % (guardada como rendimiento) | categoría, proveedor habitual | activo / no vigente; OK / Bajo / Crítico (calculado) |
| Presentación | nombre (caja, cubeta), contenido en la unidad del insumo | insumo | vigente / no vigente |
| Proveedor | nombre, canal (WhatsApp, teléfono, correo), contacto, dirección para facturas | tiene pedidos y usuarios proveedor | — |
| Movimiento | tipo, delta, nota | insumo, usuario | — (bitácora, solo se agrega) |
| Solicitud | líneas (insumo, cantidad, proveedor), comentario, fecha de entrega | solicitante; genera un pedido por proveedor | pendiente → autorizada / rechazada |
| Pedido | líneas, fecha de entrega, promesa del proveedor | solicitud, proveedor, auxiliar asignado | en_proceso → recibido / diferencia; avance: por_confirmar → confirmado → en_camino |
| Recepción | folio, líneas aceptadas, desinfección, notas, checklist documental | pedido (un pedido admite varias) | aceptada / recibida_parcial / rechazada; documentos: pendiente / revisada / con_observaciones |
| Incidencia | descripción | recepción, pedido, proveedor | abierta → cerrada |
| Corrección | antes, después, motivo, usuario | recepción | — (inmutable) |
| Devolución | líneas, motivo | pedido, recepción | — |
| Remisión | folio, versión | recepción; versión anterior | borrador → emitida → devuelta; reemplazada al crear otra versión |
| Firma | papel (entrega / recibe), nombre, trazo o motivo | remisión | firmada / no_firmo |
| Envío | canal, destinatario | remisión | publicada / compartida_manual / error |
| Receta | nombre, porciones, precio de venta por porción | líneas de insumo; puede producir un insumo (sub-receta) | — |
| Producción | porciones | receta, usuario | — |

## 5. Flujo core: de la falta de un insumo a la existencia actualizada

| Paso | Quién | Qué hace | Resultado en el sistema |
|---|---|---|---|
| 1 | Cocina | Registra el conteo de una categoría | Cambia la existencia, queda un movimiento y el insumo pasa a Bajo o Crítico si está bajo el mínimo |
| 2 | Cocina | Crea una solicitud con insumo, cantidad y proveedor | Solicitud `pendiente` y aviso "Requiere autorización" |
| 3 | Administrador | Autoriza (o rechaza con motivo) | Se crea un pedido `en_proceso` por cada proveedor de la solicitud |
| 4 | Administrador | Asigna el pedido a un auxiliar (opcional) | Solo ese auxiliar puede operar el pedido |
| 5 | Proveedor | Confirma con fecha promesa y luego avisa "en camino" | avance `confirmado` → `en_camino` |
| 6 | Auxiliar | Registra la recepción: lo aceptado, rechazado o faltante, folio, desinfección e incidencias | Solo lo aceptado suma a la existencia; lo pendiente se recibe después o se cierra con justificación |
| 7 | Auxiliar | Genera la remisión, recaba firmas (entrega y recibe) y la emite | Remisión `emitida` |
| 8 | Auxiliar | Envía la remisión al proveedor | Publicada en el portal del proveedor o registrada como compartida a mano |
| 9 | Administrador | Revisa el checklist documental; si hay error, devuelve la remisión con observaciones o corrige la recepción | Remisión `devuelta` o corrección registrada (la original no cambia) |
| 10 | Proveedor | Sube la remisión o factura corregida en su remisión devuelta | Documento adjunto e historial actualizado |

## 6. Reglas de negocio

- R1: Estado de un insumo: Crítico por debajo del 25 % del mínimo, Bajo por debajo del mínimo y OK en los demás casos.
- R2: La existencia solo cambia por conteo, recepción, producción, merma adicional, devolución o corrección, y cada cambio deja un movimiento.
- R3: Solo el Administrador autoriza solicitudes. Se crea un pedido por proveedor.
- R4: Un pedido admite varias recepciones. Al inventario entra solo lo aceptado.
- R5: Faltante es lo que no llegó, rechazado es lo que llegó y no se aceptó, y pendiente es lo pedido que aún no se acepta.
- R6: Ningún registro se elimina. Se marca no vigente, se corrige con otro registro o se crea una versión nueva.
- R7: Cambiar una remisión emitida crea otra versión, conserva la anterior y pide las firmas otra vez.
- R8: Devolver una remisión con observaciones no toca el inventario. Devolver mercancía sí descuenta, como máximo lo aceptado.
- R9: La merma se captura en porcentaje y se guarda como rendimiento. Si la línea de la receta define su propia merma, se usa esa en lugar de la del insumo.
- R10: Un insumo lo produce una sola receta y no se permiten ciclos entre recetas.
- R11: El proveedor solo ve sus propios pedidos y sus remisiones compartidas.
- R12: Un auxiliar solo opera los pedidos asignados a él o los que no tienen asignado a nadie.

## 7. Criterios de aceptación (comprobables con dos cuentas)

Base de prueba con datos ficticios: borra `meson.db`, arranca con `PIN_INICIAL=1234 npm start` y entra con los usuarios sembrados.

| # | Cuenta A hace | Cuenta B comprueba | Resultado esperado |
|---|---|---|---|
| CA-01 | Juan Pérez (Cocina) crea una solicitud de 5 kg de un insumo | Leo (Admin) abre Solicitudes | La solicitud aparece `pendiente` con 5 kg |
| CA-02 | Juan Pérez intenta autorizar esa solicitud (`POST /api/solicitudes/:id/autorizar`) | — | 403 "Solo administración puede hacer esto" y la solicitud sigue `pendiente` |
| CA-03 | Leo autoriza la solicitud | Distribuidora Central (Proveedor) entra a su portal | Ve el pedido nuevo `por_confirmar`; Alimentos del Bajío no lo ve |
| CA-04 | Distribuidora Central confirma con fecha y avisa "en camino" | Leo abre el pedido | El avance dice `en_camino` con la fecha promesa |
| CA-05 | Alimentos del Bajío pide el pedido o la remisión de Distribuidora Central por su id | — | 404 "no encontrado" (no revela que existe) |
| CA-06 | Leo asigna el pedido a otro auxiliar | Carlos Méndez intenta registrar la recepción | 403 "Este pedido está asignado a otra persona" |
| CA-07 | Carlos Méndez recibe 3 de 5 kg (pedido sin asignar) | Leo revisa el insumo | La existencia sube 3 kg, hay un movimiento y quedan 2 kg pendientes |
| CA-08 | Leo registra una corrección de esa recepción (3 → 2 kg, con motivo) | Juan Pérez abre la recepción | Se ven el original (3 kg) y la corrección (2 kg), y la existencia baja 1 kg |
| CA-09 | Cualquiera intenta `DELETE`/`UPDATE` directo sobre `recepcion_lineas` en la base | — | La base aborta: "La recepción original no se modifica / no se borra" |
| CA-10 | Juan Pérez intenta crear un insumo o un usuario | — | 403; no se crea nada |
| CA-11 | Carlos Méndez intenta registrar una producción | — | 403 "Cocina o administración registran la producción" |
| CA-12 | Distribuidora Central intenta registrar un conteo | — | 403 "Sin acceso" |
| CA-13 | Leo intenta quitarse el rol de admin | — | 400 "No puedes quitarte tu propio acceso de administrador" |
| CA-14 | Leo desactiva a Juan Pérez | Juan Pérez recarga la página | Su sesión ya no vale y vuelve a la pantalla de acceso |

Tienen prueba automática en `test/` (`npm test`): CA-02, CA-05, CA-06, CA-10, CA-11, CA-12 y CA-14. CA-09 y CA-13 se comprueban a mano (el trigger equivalente de presentaciones sí tiene prueba).

## 8. Decisiones

Ver `docs/decisiones.md` (D-01 a D-14). Las que cambian lo de G2 están resumidas en `docs/correspondencia-g2.md`.
