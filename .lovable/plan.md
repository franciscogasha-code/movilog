# Trabajo sin internet y sincronización segura (Ventas primero)

## Situación actual (verificada en el código)

- No hay service worker ni caché offline: `public/` solo tiene `manifest.json`, no hay registro de service worker en el código.
- No hay persistencia de datos de React Query: todo se pierde al recargar.
- El carrito de ventas (`useSalesCart`) vive en memoria (`useState`). Si se cierra la app, se refresca la pestaña o se corta la batería, **el carrito desaparece**.
- El cierre de pre-venta escribe directo contra la base. Sin señal, la operación falla y no queda nada guardado.

Respuesta corta a tu pregunta: hoy ningún módulo funciona sin internet, y sí, existe hoy el riesgo que describís. Este plan lo elimina para el flujo de venta.

## Principio de diseño: nada se pierde, nunca

La regla es: **la acción del vendedor se guarda en el dispositivo antes de intentar enviarla al servidor**. El envío es una consecuencia, no la fuente de verdad.

```text
Vendedor arma el pedido
   → se guarda en el dispositivo (cada cambio, al instante)
   → al confirmar: entra en la "cola de envío" (estado: pendiente)
   → hay señal? → se envía → servidor confirma → estado: enviado
   → no hay señal / error? → sigue en la cola, visible, con botón "Reintentar"
```

Un pedido **jamás** se borra del dispositivo por un error de sincronización. Solo se marca como enviado cuando el servidor devuelve el ID de la pre-venta creada. Si el envío falla 10 veces, el pedido sigue ahí, completo, con cliente, productos y cantidades.

## Qué va a ver el vendedor

1. **Indicador de conexión** en el header de Ventas: "En línea" / "Sin conexión" / "Sincronizando (2)".
2. **Carrito persistente**: si cierra la app en medio de la carga y vuelve, el carrito está igual, con el cliente elegido.
3. **Al confirmar sin señal**: mensaje claro — "Pedido guardado. Se va a enviar automáticamente cuando vuelva la conexión." No un error rojo.
4. **Pantalla "Pendientes de envío"**: lista de pre-ventas guardadas sin enviar, con cliente, cantidad de ítems y total. Cada una se puede abrir, revisar, corregir, reintentar o eliminar a mano.
5. **Al volver la señal**: se envían solas, una por una, y aparece un aviso "2 pre-ventas enviadas".
6. **Si una falla en el servidor** (por ejemplo un producto dado de baja): queda en la lista marcada en rojo con el motivo, y se puede corregir y reenviar. Nunca se descarta sola.

## Catálogo sin internet

- El catálogo consultado queda cacheado en el dispositivo: los productos que el vendedor ya vio siguen buscables y visibles sin señal, con las fotos.
- Los clientes de su cartera también quedan cacheados.
- Se muestra la fecha del último dato ("Catálogo del 14/08 10:20") para que sepa que puede estar desactualizado.
- El stock en vivo y la revalidación de precio requieren señal: sin conexión se muestra el último valor conocido, marcado como "sin conexión". Al confirmar con señal, si algo cambió, se avisa antes de cerrar.

## Alcance

Esta primera etapa cubre **el módulo Ventas** (catálogo, cliente, carrito, cierre de pre-venta), que es donde el vendedor está en la calle y el riesgo de pérdida es real. Los módulos internos (logística, flota, recepción, administración) se usan en sucursal con conexión y siguen requiriendo internet; si querés, en una etapa siguiente aplicamos el mismo mecanismo a la app del chofer, que es el otro caso de campo.

## Detalle técnico

**Persistencia local**
- IndexedDB vía `idb-keyval` como almacenamiento base (más capacidad y confiabilidad que localStorage para catálogo e imágenes).
- `useSalesCart` pasa a persistir cada cambio en IndexedDB, con hidratación al montar. Clave por vendedor.
- `persistQueryClient` de React Query con persistor sobre IndexedDB, para catálogo, clientes y filtros. `gcTime` extendido a 24 h en las queries de catálogo/clientes.

**Cola de salida (outbox)**
- Tabla local `sales_outbox` en IndexedDB: `client_uuid` (UUID generado en el dispositivo), payload completo del pedido (cliente + ítems + condiciones), `status` (pending/sending/error/sent), `attempts`, `last_error`, timestamps.
- Idempotencia: se agrega `client_uuid` a `sales_carts` con índice único. El envío hace upsert por `client_uuid`, así un reintento tras un timeout no duplica la pre-venta. Se persiste también en `branch_requests` (columna nueva `client_uuid`, única, nullable) para que el `branch_requests` + ítems se cree una sola vez.
- La creación de la pre-venta se mueve del componente a un helper `submitPreSale(payload)` reutilizable por la cola y por el envío directo.
- Procesador de cola: se dispara al montar la app, en el evento `online`, y con reintento exponencial (5s, 30s, 2min, 10min, tope 30min). Nunca borra el registro ante error; solo cambia `status` y guarda el mensaje.

**Service worker**
- Service worker vía `vite-plugin-pwa` (`registerType: autoUpdate`), precache del shell de la app y runtime cache `CacheFirst` para imágenes de producto (a través de `bims-image-proxy`), con expiración de 30 días y tope de entradas.
- Sin background sync nativo en la primera versión: la cola se procesa con la app abierta, que es el caso real del vendedor.

**UI nueva**
- `src/hooks/use-online-status.ts`, `src/lib/sales-outbox.ts`, `src/components/ventas/EstadoConexion.tsx`, `src/components/ventas/PendientesEnvio.tsx`.
- `ConfirmarVenta` deja de llamar a Supabase directo: encola y, si hay señal, procesa al instante mostrando el resultado real.

**Base de datos**
- Migración: `client_uuid uuid unique` en `sales_carts` y en `branch_requests`, ambas nullable, con los GRANT y policies ya vigentes sin cambios de alcance.

## Validación antes de darlo por bueno

- Armar un pedido, cortar la red en el navegador, confirmar: debe guardarse y avisar. Restaurar red: debe enviarse sola y aparecer la pre-venta en base.
- Armar un pedido y recargar la página en el medio: el carrito debe seguir intacto.
- Forzar un error del servidor en el envío: el pedido debe quedar en "Pendientes" con el motivo, no desaparecer.
- Reenviar dos veces el mismo pedido: debe existir una sola pre-venta.
