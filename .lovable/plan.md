# Ficha de producto (Catálogo Ventas) — rediseño

Rehacer el modal que se abre al clickear un producto en Ventas → Catálogo, resolviendo los tres problemas actuales: imagen desencuadrada, falta de stock por sucursal y falta de descripción.

## Qué se arregla

1. **Imagen bien encuadrada**
   - Marco cuadrado con fondo neutro y `object-contain` centrado (sin recorte ni franjas laterales raras).
   - Zoom al hacer tap/click sobre la imagen (vista ampliada a pantalla completa).
   - Placeholder claro cuando el producto no tiene foto.

2. **Cantidad por sucursal (lo que Vector muestra como "Cantidad por Almacén")**
   - Tabla compacta con el stock desagregado: nombre de sucursal + cantidad, ordenada de mayor a menor.
   - Las sucursales en cero se ocultan por defecto, con un enlace "Ver todas las sucursales".
   - Total destacado arriba, con color según disponibilidad.
   - Verificación de stock en vivo contra BIMS al abrir la ficha, con indicador "en vivo" y respaldo silencioso al stock local si la consulta falla.

3. **Descripción del producto**
   - Bloque de descripción con formato de saltos de línea respetado (los textos de BIMS vienen con viñetas y emojis).
   - Colapsado a 4 líneas con "Ver más / Ver menos" cuando el texto es largo.
   - Datos de referencia: código BIMS, código de barras, marca, categoría, unidad.

## Mejoras sobre Vector (más dinámico)

- Cabecera fija con nombre + precio calculado, para que el precio siempre esté visible al hacer scroll.
- Precio reactivo: al cambiar la cantidad se recalcula la escala aplicada y se resalta cuál escala está activa ("aplicando ≥12 unidades"), con el ahorro respecto al precio base.
- Sugerencia inteligente: si falta poco para la siguiente escala, aviso tipo "Agregá 2 más y baja a ₲ 12.410" con botón para saltar a esa cantidad.
- Selector de cantidad con pasos rápidos (6 / 12 / 24) además de −/+ y entrada manual.
- Barra de acción fija abajo (mobile-friendly) con total y "Agregar al carrito"; si ya está en el carrito, muestra "Actualizar cantidad".
- Aviso cuando la cantidad pedida supera el stock total, sin bloquear el flujo.
- Contenido en pestañas ligeras en mobile: Detalle · Stock · Precios, para evitar scroll infinito; en desktop se ve todo en dos columnas (imagen a la izquierda, datos a la derecha).

## Detalle técnico

- Se reescribe `src/components/ventas/ProductoFicha.tsx`; el resto del catálogo no cambia salvo pasar el ítem del carrito actual al modal.
- Mapeo de almacenes: `products.stock_by_warehouse` viene con claves numéricas (`"8": 490`) que corresponden a `branches.code`. Se resuelve con el hook existente `useBranches` para mostrar nombres reales (SUC LUQUE, SUC HOHENAU, etc.); si un código no existe en `branches`, se muestra "Depósito {code}".
- Stock en vivo con el hook existente `useLiveStock` (edge function `bims-stock-live`), consultado solo mientras el modal está abierto.
- Precio y escalas siguen resolviéndose con `resolvePrice` de `src/lib/ventas.ts`; se agrega una función auxiliar de solo lectura para saber qué escala está activa y cuál es la siguiente.
- Imágenes siguen pasando por `proxyImageUrl`.
- Formato numérico y moneda con `toLocaleString("de-DE")` y `formatGs`, tokens de color del design system (sin colores hardcodeados).
