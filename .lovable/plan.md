# Catálogo en PDF para enviar al cliente (Ventas)

Hoy el módulo Ventas no tiene generación de catálogo: en el catálogo solo se puede abrir la ficha o agregar al carrito. Esto agrega la selección múltiple y el PDF con marca SANSEI.

## Cómo lo va a usar el vendedor

```text
Catálogo → botón "Seleccionar" → tildar productos (contador flotante)
   → "Generar PDF" → opciones (mostrar precios sí/no, nota)
   → PDF descargado → Compartir (WhatsApp/mail) o descargar
```

- Botón **Seleccionar** en la barra del catálogo: activa el modo selección; cada tarjeta muestra un check.
- Barra inferior con "N seleccionados", **Limpiar** y **Generar PDF**.
- Diálogo previo al PDF: mostrar u ocultar precios, incluir datos del cliente elegido, nota libre opcional.
- Al generar: descarga el archivo y, si el dispositivo lo soporta, ofrece **Compartir** nativo.

## Contenido del PDF

- Encabezado con logo SANSEI, tagline y datos de contacto (mismo estándar del PDF de Pre-Venta).
- Datos del cliente seleccionado (si hay) y del vendedor, con fecha.
- Por producto: foto, código, descripción, unidad y —si se activan precios— precio del cliente y escalas por cantidad.
- Sin datos internos: nunca se imprime stock por sucursal ni códigos internos si está activo Modo cliente.
- Pie institucional y paginación.

## Detalle técnico

- `src/lib/catalogo-pdf.ts`: nuevo generador con jsPDF + autoTable, reutilizando el header/footer y tokens de `src/lib/pre-sale-pdf.ts` y las miniaturas de `src/lib/pdf-image.ts` (64px, JPEG 0.6, placeholder si falla).
- `src/components/ventas/CatalogoPdfPanel.tsx`: diálogo de opciones (precios on/off, nota) + acciones Descargar / Compartir (`navigator.share` con fallback a descarga).
- `src/components/ventas/CatalogoGrid.tsx`: props nuevas `selectionMode`, `selectedIds`, `onToggleSelect`; checkbox por tarjeta y barra de acciones. Sin cambios en la lógica de búsqueda/paginación existente.
- `src/pages/Ventas.tsx`: estado de selección, botón "Seleccionar" y montaje del panel PDF; pasa el cliente actual y `clientMode`.
- Precios en el PDF usan `resolvePrice`/`getScales` de `src/lib/ventas.ts` con la lista del cliente; formato `de-DE` con ₲.
- Sin cambios de base de datos en esta etapa (el registro de "qué catálogo se envió a quién" queda para una fase posterior).

## Validación

- Generar PDF con 1, 12 y 60 productos: revisar cortes de página, fotos y textos largos.
- Con y sin cliente seleccionado; con precios ocultos; con Modo cliente activo.
- Revisión visual de cada página del PDF antes de dar por cerrado.
