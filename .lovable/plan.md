# Catálogos grandes: sin tope de selección, con partes y estimación

De acuerdo con tu criterio. Si filtrás una marca (ej. SANSEI HM tiene 2.956 productos activos y SANSEI IMPORT. 1.525), tenés que poder seleccionar todo y que el sistema se encargue de dividir y avisar cuánto tarda.

## Qué cambia

1. **Selección sin tope artificial**
   - "Seleccionar todo el filtro" trae todos los productos del filtro (paginando de a 1.000 contra la base), no 600.
   - El contador del botón muestra el total real del filtro.

2. **División automática en varios archivos**
   - El PDF se corta cada 300 productos: 1.525 productos = 6 archivos, cada uno rotulado "Parte X de 6".
   - El panel avisa antes de generar: cuántos archivos y cuántos productos por archivo.

3. **Estimación de tiempo antes de generar**
   - Cartel del tipo: "≈ 2 min · 6 archivos" (con fotos) o "≈ 10 seg · 6 archivos" (sin fotos).
   - El cálculo usa la velocidad medida durante la generación y se ajusta mientras avanza ("faltan ≈ 1 min").

4. **Interruptor "Incluir fotos" + sugerencia automática**
   - Con fotos (por defecto): catálogo visual, más pesado y más lento.
   - Sin fotos: lista compacta (código, nombre, precio, escalas), genera en segundos y pesa poco — ideal para WhatsApp.
   - Cuando la selección supera 500 productos, el panel sugiere apagar las fotos y muestra la comparación de tiempo/peso estimado.

5. **Generación más rápida y cancelable**
   - Las fotos pasan a prepararse de a 6 en paralelo (hoy es una por vez): baja fuerte el tiempo total.
   - Botón "Cancelar" durante la generación, y aviso si la selección es muy grande en un celular de gama baja (más de ~1.500 con fotos).

6. **Sin recorte silencioso**
   - Desaparece el tope duro de 600: nunca más se descartan productos sin avisar. Si algo se limita, el panel lo dice explícitamente.

## Guardas para no colgar el celular

- Barra de progreso por parte ("Parte 3 de 6 · 145/300").
- Cada archivo se entrega apenas está listo (descarga/compartir secuencial), así no se acumula todo en memoria.
- Con más de 2.000 productos y fotos activadas, el panel pide confirmación explícita antes de arrancar.

## Detalle técnico

- `src/components/ventas/CatalogoGrid.tsx`: `selectAllFiltered` pagina con `.range()` de a 1.000 hasta cubrir el `count` del filtro, con progreso ("Seleccionando 2.000 de 2.956..."); se quita `MAX_SELECT_ALL`.
- `src/lib/catalogo-pdf.ts`: se elimina `CATALOG_PDF_HARD_MAX`; se mantiene `CATALOG_PDF_PART_SIZE = 300`; nueva etapa `prefetchImages(products, { concurrency: 6, signal })` que llena `imgCache` y reporta progreso; nueva opción `showImages` con layout de lista compacta cuando es `false`; soporte de `AbortSignal`.
- `src/components/ventas/CatalogoPdfPanel.tsx`: carga de productos por lotes de 100 sin tope; switch "Incluir fotos"; cartel de estimación (archivos + tiempo, recalculado en vivo); confirmación sobre 2.000 con fotos; botón cancelar; entrega archivo por archivo.
- Validación en navegador: marca con ~1.525 productos, con fotos y sin fotos, verificando cantidad de archivos, rótulos "Parte X de Y", progreso, cancelación y tiempos reales.
