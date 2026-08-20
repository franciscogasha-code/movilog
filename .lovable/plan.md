Plan: Sello de versión en hora de Paraguay (America/Asuncion)

Objetivo
Corregir el sello de versión del build que aparece en el footer del sidebar para que refleje la fecha/hora en la zona horaria de Paraguay (America/Asuncion), sin usar offset fijo.

Estado actual
- En `vite.config.ts`, la función `buildVersion()` genera el timestamp con `new Date().toISOString().slice(0, 16)`, que es UTC.
- `AppSidebar.tsx` muestra el valor de `__APP_VERSION__` directamente, sin transformación.
- El resultado visible queda ~1 hora adelantado respecto a Paraguay en agosto (UTC-4).

Cambio propuesto
1. Modificar `buildVersion()` en `vite.config.ts` para formatear el timestamp usando `toLocaleString` con `timeZone: 'America/Asuncion'` y un locale que produzca formato `YYYY-MM-DD HH:mm` (ej. `sv-SE`).
2. No tocar `AppSidebar.tsx` ni ninguna otra parte de la UI; el alcance es estrictamente el formateo del sello.
3. No usar offset fijo ni librerías externas; depender de la zona horaria del sistema IANA `America/Asuncion`, que respeta el cambio de horario de verano.

Riesgos
- Bajo. El cambio solo afecta el string de build. No impacta la lógica de registro del service worker, la comparación de versiones ni el flujo de actualización.
- Riesgo residual: si el entorno de build de Vite no tiene soporte de zonas horarias IANA (muy improbable en Node.js moderno), el formateo podría fallar. Se maneja con un fallback a UTC ISO.

Checklist
- [ ] `vite.config.ts` formatea en `America/Asuncion` sin offset fijo.
- [ ] El string final sigue siendo legible y ordenable (`YYYY-MM-DD HH:mm`).
- [ ] TypeScript compila sin errores.
- [ ] En el sidebar se ve la hora de Paraguay correcta (en agosto: UTC-4).
