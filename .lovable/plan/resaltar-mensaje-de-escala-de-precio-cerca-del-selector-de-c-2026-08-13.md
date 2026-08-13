# Resaltar mensaje de escala de precio cerca del selector de cantidades

## Contexto

En `ProductoFicha.tsx` el mensaje de sugerencia de próxima escala de precio ("Agregá X más y baja a ₲ ...") está ubicado en la sección de **Escalas**, mientras que el selector de cantidades y el total se encuentran en la **barra de acción fija** inferior. Esto hace que el mensaje de incentivo pase desapercibido para el vendedor/cliente.

## Objetivo

Reubicar el mensaje de escala junto al selector de cantidades y darle un tratamiento visual que llame la atención sin romper el diseño minimal tech del producto.

## Cambios propuestos

### 1. Reubicación del mensaje

Mover la lógica de `next` de la sección de escalas al área de selector de cantidades, justo debajo del input o entre el selector y el total.

### 2. Tratamiento visual

- Mostrar el mensaje como un **banner compacto** con fondo de color `primary/10` o `accent/10`, borde del color primario, y un ícono `TrendingDown` o similar.
- Aplicar una animación sutil de atención (por ejemplo, `animate-pulse` o un keyframe de `fade-in`) solo cuando la cantidad cambia y el mensaje se actualiza.
- Usar tipografía con peso semibold en el ahorro y la cantidad faltante.
- Incluir un botón de acción "Aplicar" dentro del mismo banner para saltar directamente a la cantidad sugerida.

### 3. Comportamiento

- El mensaje solo aparece cuando hay una escala superior disponible (`next !== null`).
- Si la cantidad ingresada ya alcanza la última escala, el mensaje desaparece.
- Al tocar/click "Aplicar", se actualiza la cantidad al `min_quantity` de la siguiente escala.
- El cálculo de ahorro y escala activa sigue usando `resolveScaleInfo` y `resolvePrice` de `src/lib/ventas.ts`.

### 4. Mobile y desktop

- Mantener la barra de acción fija en mobile.
- El banner debe caber sin aumentar la altura de la barra de acción de forma excesiva; usar un layout que apile o acomode según el ancho disponible.

### 5. Verificación

- Revisar visualmente la ficha en desktop y mobile.
- Confirmar que el mensaje desaparece correctamente cuando no hay escala siguiente.
- Confirmar que el botón "Aplicar" actualiza la cantidad y recalcula el precio total.

## Archivos afectados

- `src/components/ventas/ProductoFicha.tsx` (reubicación de la sección de sugerencia y ajustes de estilo).
- Posiblemente `src/lib/ventas.ts` si se necesita un helper adicional para formatear el mensaje (no se anticipa cambio).

## No incluye

- No se agregan dependencias nuevas.
- No se modifica la lógica de precios ni de stock en vivo.
- No se toca el flujo de agregar al carrito.
