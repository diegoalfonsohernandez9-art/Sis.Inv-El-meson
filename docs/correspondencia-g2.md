# Correspondencia con G2

Lo que cambió respecto de la arquitectura entregada en G2 (PDF) y por qué. Cada cambio tiene su decisión en `docs/decisiones.md`.

> **Pendiente del equipo:** revisar contra el PDF de G2. Si algún rol, entidad o permiso de G2 no aparece en esta tabla y no coincide con `docs/especificacion.md`, se agrega una fila con su razón.

| # | Elemento | En G2 | Ahora (especificación vigente) | Por qué | Decisión |
|---|---|---|---|---|---|
| 1 | Rol Proveedor | El proveedor no tenía cuenta en el sistema | Rol `proveedor` con portal propio: ve solo sus pedidos, confirma, avisa en camino y reporta problemas | Evitar llamadas para saber si el pedido viene y dejar constancia de la promesa de entrega | Migración v0→v1 en `db.js` |
| 2 | Rol Auxiliar de recepción | La recepción la hacía Cocina | Rol `auxiliar`: recibe, firma y envía remisiones de los pedidos asignados; no cambia precios, datos fiscales ni permisos | Separar quién recibe de quién autoriza la compra | Migración v1→v2 en `db.js` |
| 3 | Recepción | Una entrega por pedido | Varias recepciones por pedido; solo lo aceptado entra al inventario | Los proveedores entregan en partes y rechazan producto | Reglas R4 y R5 |
| 4 | Corrección de recepción | Se editaba la captura | Registro de corrección (antes, después, motivo y usuario); la base impide editar o borrar la original | Ningún registro se elimina y el inventario debe cuadrar | D-08 |
| 5 | Presentaciones | Solo la unidad del insumo | Presentaciones (caja, cubeta) con contenido fijo en la unidad del insumo; no se borran | Los pedidos se hacen en cajas y el inventario se lleva en kg o L | D-09 |
| 6 | Merma, margen y dirección del proveedor | No estaban | Merma en % guardada como rendimiento, precio de venta y margen por receta, dirección para facturas | Petición del usuario | D-10 |
| 7 | Reportes | En el mismo servidor | Programa aparte en Java que solo lee por la API como Administrador | Incluir Java sin duplicar lógica ni permisos | D-11 |
| 8 | Factura corregida | No estaba | El proveedor sube factura o remisión corregida solo en sus remisiones devueltas | El Mesón no edita facturas: las pide corregidas | D-12 |
| 9 | Sub-recetas | No estaban | Una receta puede producir un insumo, sin ciclos | Saber cuántos platillos salen de una tanda de salsa sin descontar dos veces | D-13 |
| 10 | Acceso sin PIN | No estaba | `SIN_PIN=1` solo en desarrollo y solo en `127.0.0.1` | Agilizar el desarrollo sin abrir el sistema a la red | D-14 |
