# Fase 1 — Escaneo de código de barras en la búsqueda de productos

## Auditoría de lo que ya existe

`src/components/shared/ProductSearch.tsx`:
- Input con debounce de 300 ms, busca desde 3 caracteres.
- Consulta `products` con `.or()` sobre `name`, `sku`, `bims_code`, `barcode` (ilike), filtro `is_active`, límite 20.
- Enriquece resultados con stock en vivo (`useLiveStock`) y devuelve el producto al padre vía `onSelect`.
- Usado por: Consultas, SolicitudCreateForm, EnvioDirectoForm, AdminReposicionForm, ExcelImport.

Conclusión: el escáner NO necesita lógica de búsqueda propia. Solo decodifica y reutiliza la consulta existente (con match exacto por `barcode`/`bims_code`).

## Alcance

Solo el buscador compartido. No se toca recepción, chofer, ventas ni ningún otro flujo.

## Archivos

**Nuevo** `src/components/shared/BarcodeScanner.tsx`
- Overlay a pantalla completa (Dialog de shadcn) con `<video>`, marco guía, botón cerrar y estados: pidiendo permiso / escaneando / permiso denegado / cámara no disponible.
- Cámara trasera (`facingMode: "environment"`), corte del stream al cerrar y al desmontar.
- Props: `open`, `onOpenChange`, `onDetected(code: string)`, `continuous?`.
- Formatos: EAN-13, EAN-8, UPC-A, UPC-E, Code-128, Code-39, ITF.

**Modificado** `src/components/shared/ProductSearch.tsx`
- Botón "Escanear" (ícono `ScanLine`/cámara) dentro del input, solo si hay `navigator.mediaDevices`.
- Nueva función `lookupByCode(code)`: consulta `products` activa con `barcode.eq` / `bims_code.eq` (y fallback `ilike` por si el código viene con ceros a la izquierda), respetando `excludeIds`.
  - 1 resultado: `onSelect` con stock enriquecido si aplica, cierra el scanner, toast "Agregado: <producto>".
  - Varios: carga el código en el input, abre el dropdown con los resultados, cierra el scanner.
  - Ninguno: toast "No se encontró producto con ese código"; el scanner sigue abierto para reintentar.

## Librería: `@zxing/browser` (+ `@zxing/library`)

Por qué:
- Funciona en iOS Safari, donde `BarcodeDetector` no existe; Android Chrome también.
- API imperativa simple sobre `<video>` (`BrowserMultiFormatReader.decodeFromVideoDevice`), sin UI impuesta (a diferencia de html5-qrcode, que trae su propio DOM/estilos y choca con el design system).
- Se puede limitar a los formatos retail para acelerar la decodificación.

Estrategia híbrida: si `window.BarcodeDetector` existe y soporta los formatos, se usa (más rápido y menos CPU en Android); si no, ZXing. La carga de ZXing es dinámica (`import()`) para no engordar el bundle inicial.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| La cámara exige HTTPS (o localhost) | La app ya corre en HTTPS; si no, se muestra el mensaje de "cámara no disponible" |
| Permiso denegado permanentemente | Mensaje claro + botón "Buscar a mano" que cierra el overlay y enfoca el input |
| iOS Safari requiere `playsInline` y gesto del usuario | El video va con `playsInline muted autoplay` y el escáner solo arranca tras tocar el botón |
| Stream de cámara sin liberar (batería) | `stop()` del reader + `getTracks().forEach(t => t.stop())` en cierre y unmount |
| Lecturas duplicadas o erróneas | Debounce del mismo código (ignorar repetido dentro de 1,5 s) y vibración corta al detectar |
| Peso del bundle | Import dinámico del scanner y de ZXing |
| Códigos con dígito verificador o ceros distintos a los de BIMS | Doble intento: match exacto y luego `ilike` con sufijo, igual que ya hace la búsqueda actual |

## Verificación

- Typecheck limpio.
- Regresión del buscador sin escáner: escribir texto sigue buscando igual en las 5 pantallas que lo usan.
- Validación manual de ustedes: Android Chrome e iPhone Safari — abrir cámara, escanear un código real, caso sin match y caso sin permiso.
