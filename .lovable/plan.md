

## Plan: Simplificar "Crear pedido desde consulta" → Redirigir a Solicitudes

### Idea

Reemplazar todo el formulario embebido de creación de pedido en el detalle de la consulta por un simple botón **"Crear pedido"** que navega al módulo de Solicitudes (`/solicitudes`), pasando el contexto de la consulta como parámetros para pre-cargar los productos.

### Cambios

**`src/pages/Consultas.tsx` — `ConsultationDetail`**

1. **Eliminar** el bloque completo de "Crear pedido desde consulta" (líneas 702-757): selectores de tipo/destino, ContextBanner, dialog con `CreateOrderFromConsultation`
2. **Eliminar** los estados asociados: `orderRequestType`, `orderDeliveryTarget`, `createOrderOpen`, `allowedTargets`, `orderMode`
3. **Eliminar** la función `CreateOrderFromConsultation` completa (líneas 763-1093)
4. **Reemplazar** con un botón simple que usa `useNavigate`:
   - Texto: "Crear pedido desde esta consulta"
   - Al hacer click, navega a `/solicitudes?from_consultation={consultationId}`
   - Solo visible cuando `canCreateOrder` es true

**`src/pages/Solicitudes.tsx`**

5. **Leer** el query param `from_consultation` al abrir
6. Si está presente, abrir automáticamente el dialog de `SolicitudCreateForm` y mostrar un banner indicando que viene de una consulta (con link para volver)
7. Los productos se pre-cargarán en una fase posterior; por ahora solo abre el formulario limpio

### Resultado

- El detalle de consulta queda limpio: productos, respuestas, chat, y un botón para crear pedido
- Toda la lógica de creación de pedido vive en un solo lugar (Solicitudes)
- Se eliminan ~350 líneas de código duplicado

### Archivos modificados
- `src/pages/Consultas.tsx` (eliminar ~380 líneas)
- `src/pages/Solicitudes.tsx` (agregar ~15 líneas para manejar query param)

