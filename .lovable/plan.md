# Catálogo PDF: dividir en partes en vez de recortar

## Qué pasa hoy
El generador tiene un tope de 300 productos por PDF. Si seleccionás más (como los 534 de tu caso), el sistema arma el PDF solo con los primeros 300 según el orden elegido y descarta el resto. Esa es la alerta roja que ves. El tope existe porque cada producto descarga y comprime su foto: con 500+ ítems el celular puede tardar mucho o quedarse sin memoria.

## Qué se va a cambiar
En vez de recortar, el catálogo se divide automáticamente en partes de hasta 300 productos.

- Con 534 seleccionados: se generan **Parte 1 (1-300)** y **Parte 2 (301-534)**, ambos con el orden elegido aplicado sobre el total.
- El aviso rojo se reemplaza por un aviso informativo: "Se generarán 2 archivos (300 + 234 productos)".
- Cada parte lleva en portada y pie "Parte 1 de 2", así el cliente sabe que es un solo catálogo.
- Nombre de archivo: `Catalogo-SANSEI-<Cliente>-parte1.pdf`, `...-parte2.pdf`. Si hay una sola parte, se mantiene el nombre actual sin sufijo.

## Descargar y compartir
- **Descargar**: baja los archivos uno tras otro (con una pequeña pausa entre cada uno para que el navegador no bloquee la descarga múltiple).
- **Compartir**: si el dispositivo permite compartir varios archivos juntos, se comparten todos en una sola acción; si no, se comparte la Parte 1 y se descargan las demás, con un aviso claro.
- La barra de progreso pasa a mostrar el avance total ("Parte 1 de 2 · imágenes 120/300").

## Vista previa del panel
Hoy la lista de "Selección" solo carga los primeros 300. Pasa a cargar todos los seleccionados (en tandas), con un separador visual que indica dónde empieza cada parte, para que se entienda el corte antes de generar.

## Límite duro
Se mantiene un techo global de 600 productos (2 partes) para no colgar el celular. Pasado eso sí aparece advertencia de recorte, sugiriendo afinar el filtro por categoría o marca.

## Detalles técnicos
- `src/lib/catalogo-pdf.ts`: `CATALOG_PDF_MAX_ITEMS` pasa a ser el tamaño de parte (`CATALOG_PDF_PART_SIZE = 300`) más un `CATALOG_PDF_HARD_MAX = 600`. Se agrega `buildCatalogPdfParts()` que ordena el set completo, lo corta en chunks y devuelve `{ blob, fileName, partIndex, partCount }[]`, reutilizando el render actual con `partLabel` en encabezado/pie. `catalogFileName()` acepta sufijo de parte.
- `src/components/ventas/CatalogoPdfPanel.tsx`: carga los ítems hasta el hard max, calcula partes, cambia el `Alert` destructive por informativo, guarda `Blob[]` y adapta `download`/`share`/progreso.
- Sin cambios de backend ni de esquema.
