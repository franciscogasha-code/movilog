# Catálogo PDF sin fotos: diagnóstico y arreglo

## Qué pasó

Revisé el PDF que subiste: tiene 125 imágenes incrustadas, y 124 de ellas (todas las de producto) son el **recuadro gris de reemplazo** de 320x320 con el código, no la foto real. La única imagen real es el logo SANSEI.

O sea: no es un problema de diseño ni de los datos. Los productos sí tienen foto cargada (18.502 de 18.918 activos tienen URL) y el proxy de fotos responde correctamente (probado: devuelve la imagen, con permisos de origen cruzado correctos). Lo que falla es la descarga de la foto **dentro del generador de PDF**, que ante cualquier error cae silenciosamente al recuadro gris.

## Causa

El generador carga cada foto con un elemento `<img crossOrigin="anonymous">` y después la dibuja en un canvas. Ese modo es frágil:

- El catálogo en pantalla pide las mismas fotos **sin** ese modo. La respuesta queda guardada en caché (caché del navegador y caché del service worker del PWA, que hoy guarda incluso respuestas "opacas"). Cuando el generador vuelve a pedir la misma foto en modo estricto, el navegador rechaza la respuesta cacheada y dispara error → recuadro gris para todos los productos.
- Además el tiempo de espera es de 5 segundos y, ante error, el resultado fallido queda cacheado en memoria, así que un reintento no ayuda.

Esto explica que aparezca "de golpe" en todos los ítems y no en algunos.

## Solución

1. **Cambiar cómo se bajan las fotos en el PDF**: usar descarga directa (`fetch`) a blob y armar la imagen desde una URL local de ese blob. Así no hay validación de origen cruzado ni riesgo de canvas "contaminado", y se reusa correctamente la caché.
2. **Unificar el modo de pedido de fotos** en el catálogo en pantalla (mismo modo que el generador) para que la caché sirva a ambos.
3. **Ajustar la caché del PWA** para el proxy de fotos: guardar solo respuestas 200 reales (no "opacas") y en modo CORS, para no volver a envenenar la caché.
4. **Reintento y tolerancia**: subir el tiempo de espera a 10s, un reintento por foto, y no cachear fallos de forma permanente.
5. **Visibilidad del problema**: si al final igual quedan fotos que no se pudieron traer, el panel de generación avisa "N fotos no disponibles" en vez de entregar un PDF gris en silencio.

## Verificación antes de darlo por cerrado

- Generar un catálogo de prueba (con fotos) en el navegador real y **abrir el PDF y contar imágenes**: confirmar que las fotos incrustadas son las reales y no el recuadro 320x320.
- Probar en la app publicada (con el service worker activo) y con caché previa cargada desde el catálogo, que es el escenario exacto en el que falló.
- Probar un caso mixto: producto sin foto sigue mostrando el recuadro gris con el código (comportamiento correcto).

## Detalles técnicos

- `src/lib/catalogo-pdf.ts`: reemplazar `loadImage` (elemento `Image` + `crossOrigin`) por `fetch(src, { mode: "cors" })` → `blob` → `URL.createObjectURL` → `Image` → canvas → JPEG; `revokeObjectURL` al terminar. Timeout 10s con `AbortController`, 1 reintento, y cachear solo resultados exitosos en `imgCache`. Contador de fallos expuesto en el resultado.
- `src/components/ventas/CatalogoGrid.tsx`, `ProductoFicha.tsx`, `CatalogoPdfPanel.tsx`: agregar `crossOrigin="anonymous"` a las `<img>` que usan `proxyImageUrl`.
- `vite.config.ts`: en la regla `movilog-product-images`, `cacheableResponse: { statuses: [200] }` y `fetchOptions: { mode: "cors" }`.
- `CatalogoPdfPanel.tsx`: mostrar aviso con la cantidad de fotos no disponibles luego de generar.
