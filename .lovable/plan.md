

## Plan: Hacer la app instalable (PWA básica sin offline)

Agregar un `manifest.json` con `display: "standalone"` e iconos para que la app se pueda "instalar" en móvil y escritorio, sin service worker ni soporte offline.

### Cambios

**1. Crear `public/manifest.json`**
- `name`, `short_name`, `display: "standalone"`, `start_url: "/"`, `theme_color`, `background_color`
- Iconos en tamaños 192x192 y 512x512 (se generarán como SVG inline o se usará el placeholder existente)

**2. Crear iconos PWA**
- `public/icon-192.png` y `public/icon-512.png` — generados programáticamente con el logo/inicial de la app

**3. Modificar `index.html`**
- Agregar `<link rel="manifest" href="/manifest.json">`
- Agregar `<meta name="theme-color" content="...">`
- Agregar `<meta name="apple-mobile-web-app-capable" content="yes">`
- Agregar `<link rel="apple-touch-icon" href="/icon-192.png">`

**No se instala `vite-plugin-pwa`**, no hay service worker, no hay cache offline. Solo manifest + iconos = instalable.

### Archivos
| Archivo | Acción |
|---------|--------|
| `public/manifest.json` | Nuevo |
| `public/icon-192.png` | Nuevo (generado) |
| `public/icon-512.png` | Nuevo (generado) |
| `index.html` | Modificar — agregar manifest y meta tags |

