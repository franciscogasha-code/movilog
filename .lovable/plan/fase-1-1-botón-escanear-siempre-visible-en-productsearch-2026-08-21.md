# Fase 1.1 — Botón "Escanear" siempre visible en ProductSearch

## Auditoría actual

`src/components/shared/ProductSearch.tsx` (líneas 58–284):
- Tiene un guard `cameraAvailable = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia`.
- El botón de escáner (`ScanLine`) solo se renderiza si `cameraAvailable === true`.
- `BarcodeScanner` ya maneja internamente estados de permiso denegado y cámara no disponible, pero el usuario nunca llega ahí si el botón no se muestra.

## Alcance

Solo `src/components/shared/ProductSearch.tsx`. No se toca `BarcodeScanner.tsx`, ni otros consumidores del buscador.

## Cambios

1. **Mostrar el botón siempre**
   - Eliminar el guard `cameraAvailable` en la condición de render del botón.
   - Ajustar el `padding-right` del input para que siempre reserve el espacio del icono de escaneo (actualmente varía `pr-20` vs `pr-9`). Con el botón siempre visible, usar `pr-20` siempre.

2. **Verificar disponibilidad al tocar**
   - En `openScanner()`, antes de llamar `setScannerOpen(true)`, comprobar si `navigator.mediaDevices?.getUserMedia` existe.
   - Si no existe (HTTP inseguro, iframe sin permisos, dispositivo sin cámara, navegador muy restrictivo), mostrar `notify.warning("La cámara no está disponible en este dispositivo")` y NO abrir el overlay.

3. **Manejo de permiso denegado después de abrir**
   - `BarcodeScanner` ya notifica "Permiso de cámara denegado" cuando el usuario lo rechaza. No se duplica ese mensaje desde `ProductSearch` para no repetir toasts.
   - Solo se pre-valida la ausencia de API de cámara antes de intentar abrir.

## Regresión / checklist

- [ ] El buscador sigue funcionando con texto igual que antes.
- [ ] En desktop con cámara, el botón abre el scanner.
- [ ] En desktop sin cámara / HTTP inseguro, el botón muestra el mensaje de no disponible y no abre nada.
- [ ] En móvil (Android/iOS), el botón es visible incluso si el navegador oculta `mediaDevices` hasta el gesture; al tocar, pide permiso o muestra el mensaje.
- [ ] No se rompe el layout del input (espacio reservado correcto).

## Riesgos

- Bajo. Solo cambia la visibilidad del botón y agrega un guard de toast. No hay cambios de base de datos ni edge functions.
