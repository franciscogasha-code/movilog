

## Plan: Video Demo MoviLog — Implementación completa + validación pre-render

Construir el video demo MP4 de 20 segundos con Remotion, copy en español Paraguay, enfoque en adopción operativa.

### Archivos a crear/modificar

| Archivo | Acción |
|---------|--------|
| `remotion/tsconfig.json` | Reescribir — jsx react-jsx, quitar verbatimModuleSyntax |
| `remotion/src/index.ts` | Crear — registerRoot |
| `remotion/src/Root.tsx` | Crear — Composition 600f/30fps/1920×1080 |
| `remotion/src/MainVideo.tsx` | Crear — TransitionSeries con 6 escenas + fade 15f |
| `remotion/src/scenes/Scene1Problem.tsx` | Crear — Burbujas WhatsApp realistas: "Se pierden mensajes" / "Pedidos sin seguimiento" / "Nadie sabe en qué quedó" |
| `remotion/src/scenes/Scene2Solution.tsx` | Crear — Logo MoviLog + "El flujo logístico en un solo lugar" |
| `remotion/src/scenes/Scene3Operation.tsx` | Crear — 4 tarjetas: "Cargás el pedido una sola vez" / "Ves el stock real por sucursal" / "El envío ya queda listo" / "Todo queda registrado en el sistema" |
| `remotion/src/scenes/Scene4Impact.tsx` | Crear — "Menos errores en el día a día" / "Más control entre sucursales" / "Información en tiempo real" |
| `remotion/src/scenes/Scene5Roles.tsx` | Crear — "Cada uno sabe qué tiene que hacer" / "Menos llamadas. Menos confusión." / "Depósito, chofer y administración conectados" |
| `remotion/src/scenes/Scene6Closing.tsx` | Crear — "De mensajes sueltos a un flujo ordenado" → "Menos WhatsApp. Más control." → "MoviLog — Logística real, en tiempo real" |
| `remotion/scripts/render-remotion.mjs` | Crear — Render programático con chromeMode chrome-for-testing, muted, concurrency 1 |

### Dirección visual

- **Paleta**: #2256B3 (azul), #F5A623 (ámbar), #29A380 (verde), #171D2A (fondo)
- **Tipografía**: Space Grotesk (títulos) + Inter (cuerpo) via @remotion/google-fonts
- **Motion**: Spring-in (damping: 200) para entradas, fade 15f entre escenas, stagger 20f entre tarjetas
- **Escena 1**: Burbujas realistas estilo chat (no caricatura), acumulación progresiva
- **Escena 3**: Tarjetas grandes, texto 40px+, máxima legibilidad
- **Escena 6**: Texto hero 72px+, fondo sólido oscuro, sin distractores

### Timing (600 frames)

| Escena | Frames | Overlap | Neto |
|--------|--------|---------|------|
| 1 Problema | 135f | | 135f |
| 2 Solución | 120f | -15f | 105f |
| 3 Operación | 135f | -15f | 120f |
| 4 Impacto | 120f | -15f | 105f |
| 5 Roles | 75f | -15f | 60f |
| 6 Cierre | 90f | -15f | 75f |
| **Total** | 675f | -75f | **600f** |

### Pasos de ejecución

1. Setup: fix compositor musl→gnu, symlink ffmpeg/ffprobe
2. Crear tsconfig.json, index.ts, Root.tsx
3. Crear las 6 escenas con copy PY y animaciones frame-based
4. Crear MainVideo.tsx con TransitionSeries
5. Crear script de render programático
6. **Validar 4 frames clave** con `bunx remotion still`:
   - Frame 80 → Escena 1: burbujas realistas, no caricatura
   - Frame 180 → Escena 2: logo centrado, sensación de orden
   - Frame 320 → Escena 3: tarjetas legibles y claras
   - Frame 560 → Escena 6: mensaje final máxima legibilidad
7. Ajustar si algún frame no cumple criterios de claridad
8. Render final a `/mnt/documents/movilog-demo.mp4`

