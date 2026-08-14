# Catálogos de más de 600 productos

Hoy el tope duro es 600 productos (2 archivos de 300). Si seleccionás más, se recortan en silencio. Además, la preparación de imágenes es de a una por vez, por eso 600 ítems tardan varios minutos.

## Recomendación

Subir el tope a 1.500 productos (5 archivos de 300) y hacer que la generación sea mucho más rápida, en vez de dejar un límite bajo.

## Qué cambia

1. **Tope nuevo: 1.500 productos**
   - Se dividen en archivos de 300 ("Parte X de Y", hasta 5 archivos).
   - "Seleccionar todo el filtro" pasa a traer hasta 1.500.

2. **Velocidad: precarga de imágenes en paralelo**
   - Hoy cada foto se descarga y comprime una por una. Se pasa a 6 en simultáneo antes de dibujar las páginas.
   - Efecto esperado: de varios minutos a menos de un minuto para 600 ítems; 1.500 queda en un rango razonable.

3. **Modo "sin fotos" para catálogos grandes**
   - Nuevo interruptor "Incluir fotos" (activado por defecto).
   - Si se apaga: lista compacta con código, nombre, precio y escalas. Genera en segundos y el archivo pesa poco (mejor para mandar por WhatsApp).
   - Cuando la selección supera 600, el panel sugiere apagarlo.

4. **Aviso claro por encima del tope**
   - Si se seleccionan más de 1.500, aviso explícito: se incluyen los primeros 1.500 según el orden elegido, con recomendación de filtrar por categoría o marca y mandar dos catálogos.
   - Además, aviso de tiempo estimado y cantidad de archivos antes de generar.

5. **Poder cancelar**
   - Botón "Cancelar" mientras se preparan las imágenes, para no dejar el celular colgado si el vendedor se arrepiente.

## Alternativa descartada (por ahora)

Generar el PDF en el servidor y mandar un link: resuelve cualquier volumen y no depende del celular, pero implica una función de backend, almacenamiento de archivos y limpieza periódica. Se puede hacer en una fase siguiente si aparecen pedidos de catálogos completos (15.000 ítems).

## Detalle técnico

- `src/lib/catalogo-pdf.ts`: `CATALOG_PDF_HARD_MAX` 600 → 1500; nueva etapa `prefetchImages(products, concurrency = 6)` que llena `imgCache` reportando progreso, y `getImage` pasa a leer del cache; nueva opción `showImages` con layout de lista (sin celdas de imagen) cuando está en `false`; soporte de `AbortSignal` para cancelar.
- `src/components/ventas/CatalogoPdfPanel.tsx`: switch "Incluir fotos", aviso de partes/tiempo estimado, aviso de recorte sobre 1.500, botón cancelar durante la generación.
- `src/components/ventas/CatalogoGrid.tsx`: `MAX_SELECT_ALL` sigue atado a `CATALOG_PDF_HARD_MAX` (queda en 1.500 automáticamente).
- Validación: prueba en navegador con 600 y con 1.500 ítems, con y sin fotos, verificando cantidad de archivos, etiquetas "Parte X de Y" y tiempos.
