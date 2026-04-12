

# Plan: Eliminar "Requieren atención" y expandir cola operativa

## Archivo: `src/pages/Index.tsx`

### 1. Eliminar código del bloque lateral
- **Queries** (líneas 158-194): Eliminar `attentionRequests` y `openIncidents`
- **useMemo** (líneas 251-319): Eliminar `attentionCases`
- **Función** (líneas 342-350): Eliminar `attentionIcon`
- **Bloque visual** (líneas 597-642): Eliminar todo el `<motion.div>` de "Requieren atención"

### 2. Limpiar imports
- Eliminar `FileWarning`, `XCircle`, `AlertCircle` de la línea 5-6

### 3. Cambiar layout a ancho completo
- **Línea 441**: Reemplazar `grid grid-cols-1 lg:grid-cols-3 gap-5` por un simple contenedor sin grid
- **Línea 443**: Eliminar `lg:col-span-2` del wrapper de la cola
- Eliminar el `<div>` grid wrapper ya innecesario (línea 641/643)

### 4. Mejorar filas aprovechando ancho completo

Cada fila (líneas 531-589) se reorganiza para desktop con mejor distribución horizontal:

- Usar un layout flex con secciones claras: **izquierda** (tipo + ID + ruta), **centro** (estado + prioridad + antigüedad), **derecha** (acción)
- Eliminar `hidden md:inline-flex` del badge de prioridad (línea 569) — siempre visible en desktop
- Eliminar `hidden sm:inline` del tiempo (línea 574) — visible desde tablet
- Dar más espacio al label origen→destino con `min-w-0` y `flex-1`
- Agrupar estado + prioridad + tiempo en un bloque con `gap-2` alineado al centro
- Mantener el botón de acción anclado a la derecha con `ml-auto`
- En mobile: apilar tipo+ID arriba, ruta abajo, acción al final — usando `flex-wrap` controlado

### Resultado
Panel limpio, sin redundancia, cola operativa ocupa 100% del ancho con filas mejor distribuidas y más legibles.

