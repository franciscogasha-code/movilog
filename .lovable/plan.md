

## Plan: Rediseñar flujo de Consultas de Disponibilidad

### Concepto nuevo

El módulo de Consultas es **previo** al pedido. Su propósito es consultar disponibilidad a otras sucursales y chatear con ellas antes de decidir si crear un pedido. No necesita contexto de entrega ni lógica mono/multi-origen en esta etapa.

**Flujo simplificado:**
```text
1. Mi sucursal (auto-rellenada, bloqueada)
2. Buscar productos
3. Seleccionar sucursal(es) a consultar por producto
4. Enviar consulta
5. Chat con sucursales consultadas
6. Convertir a pedido (cuando confirmen)
```

### Cambios en `ConsultationForm` (~100 líneas)

**Eliminar:**
- Selector de "Destino de entrega" y estado `deliveryContext`
- `ContextBanner` del formulario de creación
- Importaciones de `getOriginMode`, `getAllowedDeliveryTargets`, `ContextBanner` en el form
- Textos condicionales de mono/multi-origen en la creación

**Simplificar Paso 1:**
- Solo mostrar "Mi sucursal" auto-rellenada desde perfil, siempre bloqueada (readonly)
- Eliminar la segunda columna (grid-cols-2 → single column)

**Paso 2 (Productos) — sin cambios funcionales:**
- Mantener ProductCard con `stockMode="info_only"` 
- Mantener selección multi-branch por producto (toggle sucursales origen)
- Fix visual: la ProductCard se sale del contenedor del dialog — agregar `overflow-hidden` y limitar ancho interno

**Paso 3 (nuevo) — Chat post-creación:**
- En el `ConsultationDetail`, mejorar la sección de Chat existente:
  - Agregar input para enviar mensajes (actualmente solo muestra mensajes, no permite enviar)
  - Mostrar el nombre de sucursal junto a cada mensaje
  - Agrupar por sucursal consultada

### Cambios en `ConsultationDetail` (~40 líneas)

- Agregar formulario de envío de mensaje (input + botón) debajo del listado de chat
- Insert en `consultation_messages` con `consultation_id`, `message`, `sent_by` (user.id)
- Invalidar query de mensajes después de enviar

### Fix visual del dialog

- En el `DialogContent` del formulario de creación: agregar `overflow-y-auto max-h-[85vh]` para que el contenido largo sea scrollable sin salirse
- En ProductCard dentro del form: agregar `className="w-full"` para respetar el contenedor

### Archivos modificados
- `src/pages/Consultas.tsx` (ConsultationForm + ConsultationDetail)

### Sin cambios
- No se modifica ProductCard, ProductSearch, ni la lógica de "Crear pedido desde consulta" (que sí usa ContextBanner y delivery target correctamente en el Detail)

