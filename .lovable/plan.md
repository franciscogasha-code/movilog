Plan: Sello de versión solo-fecha en hora de Asunción

Objetivo
Ajustar el string de versión que se muestra en el footer del sidebar para que ya no incluya la hora; solo muestre la fecha en la zona horaria de Paraguay (America/Asuncion) seguida del hash corto de git. Ejemplo: `2026-08-20 · 70ed4c3`.

Estado actual
- En `vite.config.ts`, `buildVersion()` llama a `formatAsuncion(new Date())` que devuelve `YYYY-MM-DD HH:mm`.
- El resultado final es `YYYY-MM-DD HH:mm · <hash>`.
- El mismo string se inyecta en `__APP_VERSION__` y se emite en `version.json`, por lo que el chequeo de versión propio (`src/lib/version-check.ts`) compara exactamente ese string.
- `src/lib/version-check.ts` y el service worker no dependen del formato del string; solo lo comparan por igualdad.

Cambio propuesto
1. Reemplazar `formatAsuncion()` en `vite.config.ts` por una función que formatee solo la fecha con `Intl.DateTimeFormat` en `timeZone: 'America/Asuncion'`, devolviendo `YYYY-MM-DD`.
2. `buildVersion()` seguirá concatenando `fecha · hash-corto-git`; si no hay hash, solo la fecha.
3. No modificar `src/lib/version-check.ts`, `src/contexts/UpdateContext.tsx`, `src/components/UpdateBanner.tsx`, `src/lib/register-app-sw.ts`, `src/components/AppSidebar.tsx` ni ningún otro archivo del flujo de chequeo de versión o UI.

Riesgos
- Bajo. El cambio es puramente cosmético en el string de build.
- El hash de git sigue presente, por lo que cada commit genera un string diferente y la detección de versiones publicadas sigue funcionando.
- `version.json` continuará emitiendo el mismo formato que `__APP_VERSION__`, manteniendo la coherencia del chequeo.
- Riesgo residual: si el entorno de build no soporta `America/Asuncion` (muy improbable en Node.js moderno), se usa fallback a UTC `YYYY-MM-DD`. No se requiere offset fijo.

Checklist
- [ ] `vite.config.ts` genera el sello como `YYYY-MM-DD · <hash>`.
- [ ] `version.json` contiene el mismo string que `__APP_VERSION__`.
- [ ] El chequeo de versión propio (`version-check.ts`) sigue comparando por igualdad de strings sin lógica adicional.
- [ ] TypeScript compila sin errores.
- [ ] El sidebar muestra la fecha y el hash, sin hora.
