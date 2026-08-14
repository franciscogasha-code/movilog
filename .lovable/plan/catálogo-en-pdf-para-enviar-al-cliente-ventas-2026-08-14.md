# Catálogo en PDF para enviar al cliente (Ventas)

Hoy el módulo Ventas no tiene generación de catálogo: en el catálogo solo se puede abrir la ficha o agregar al carrito. Esto agrega la selección múltiple y el PDF con marca SANSEI.

## Cómo lo va a usar el vendedor

```text
Catálogo → filtrar (categoría / marca / búsqueda / con stock)
   → "Seleccionar" → tildar productos o "Seleccionar todo el filtro (N)"
   → "Generar PDF" → opciones (precios sí/no, orden, nota)
   → PDF descargado → Compartir (WhatsApp/mail) o descargar
```

- **Filtros ya existentes** (categoría, marca, búsqueda por nombre/código/barcode, "Con stock") son la base: el vendedor primero acota, después selecciona.
- Botón **Seleccionar** en la barra del catálogo: activa el modo selección; cada tarjeta muestra un check.
- Barra inferior con: "N seleccionados", **Seleccionar todo el filtro (N)** (trae los IDs de todo el resultado, no solo lo cargado en pantalla), **Limpiar** y **Generar PDF**.
- La selección **se mantiene al cambiar filtros o buscar**, así se puede armar un catálogo mixto (ej.: Cocina + una marca puntual) sin perder lo ya elegido.
- Vista **"Ver selección"**: lista compacta de lo tildado, para quitar ítems antes de generar.
- Tope de seguridad: hasta **300 productos** por PDF (aviso claro si se supera, con opción de recortar a los primeros 300 del orden elegido).
- Diálogo previo al PDF: mostrar u ocultar precios, orden (categoría/marca o alfabético), incluir datos del cliente elegido, nota libre opcional.
- Al generar: barra de progreso (descarga de fotos) y luego descarga del archivo con opción de **Compartir** nativo.


## Contenido del PDF

- Encabezado con logo SANSEI, tagline y datos de contacto (mismo estándar del PDF de Pre-Venta).
- Datos del cliente seleccionado (si hay) y del vendedor, con fecha.
- Por producto: foto, código, descripción, unidad y —si se activan precios— precio del cliente y escalas por cantidad.
- Sin datos internos: nunca se imprime stock por sucursal ni códigos internos si está activo Modo cliente.
- Pie institucional y paginación.

## Detalle técnico

- `src/lib/catalogo-pdf.ts`: nuevo generador con jsPDF + autoTable, reutilizando header/footer y tokens de `src/lib/pre-sale-pdf.ts` y las miniaturas de `src/lib/pdf-image.ts` (64px, JPEG 0.6, placeholder si falla). Grilla de 3 columnas por página con foto + datos.
- `src/components/ventas/CatalogoPdfPanel.tsx`: diálogo de opciones (precios on/off, orden, nota), lista "Ver selección" con quitar ítem, progreso y acciones Descargar / Compartir (`navigator.share` con fallback a descarga).
- `src/components/ventas/CatalogoGrid.tsx`: props nuevas `selectionMode`, `selectedIds`, `onToggleSelect`, `onSelectAllFiltered`; checkbox por tarjeta y barra sticky de acciones. La búsqueda/paginación infinita actual (48 por página) no cambia.
- "Seleccionar todo el filtro": consulta aparte a `products` con los mismos filtros pero `select("id")` y `limit(300)`, para no depender de lo cargado en pantalla; usa el `count` exacto ya disponible para avisar cuántos entran.
- Los productos seleccionados que no están en memoria se traen por `in("id", ids)` en lotes de 100 al momento de generar el PDF.
- `src/pages/Ventas.tsx`: estado de selección (Set de IDs, persistente entre filtros), botón "Seleccionar" y montaje del panel PDF; pasa el cliente actual y `clientMode`.
- Precios en el PDF usan `resolvePrice`/`getScales` de `src/lib/ventas.ts` con la lista del cliente; formato `de-DE` con ₲.
- Sin cambios de base de datos en esta etapa (el registro de "qué catálogo se envió a quién" queda para una fase posterior).

## Validación

- Generar PDF con 1, 12, 60 y 300 productos: cortes de página, fotos, textos largos y tiempo de generación.
- Filtrar por categoría (ej. Cocina), usar "Seleccionar todo el filtro", cambiar a otra marca y confirmar que la selección previa se mantiene.
- Con y sin cliente seleccionado; con precios ocultos; con Modo cliente activo.
- Revisión visual de cada página del PDF antes de dar por cerrado.
