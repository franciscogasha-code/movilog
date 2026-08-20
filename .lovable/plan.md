Plan: Sello de versión determinístico (fecha del commit + hash)

Objetivo
El sello de versión debe ser `YYYY-MM-DD · <hash-corto>` (ej. `2026-08-20 · 70ed4c3`), sin hora, y 100% determinístico: mismo commit = mismo sello, sin importar cuándo se recompile.

Estado actual
- En `vite.config.ts`, `buildVersion()` llama a `formatAsuncion(new Date())` que devuelve `YYYY-MM-DD HH:mm` y concatena el hash corto de git.
- Como la fecha proviene del momento del build, recompilar el mismo commit en otro día cambia el string → falso aviso de "nueva versión".
- El mismo string se inyecta en `__APP_VERSION__` y se emite en `version.json`; el chequeo propio (`src/lib/version-check.ts`) compara por igualdad exacta de strings.

Cambio propuesto
1. En `vite.config.ts`, obtener la fecha del commit con `git show -s --date=short --format=%cd HEAD` (formato `YYYY-MM-DD`, fijo por commit).
2. `buildVersion()` devuelve `fechaCommit · hashCorto`. Si solo hay uno de los dos, devuelve el disponible.
3. Fallback si git no está disponible: fecha del build formateada en `America/Asuncion` (solo `YYYY-MM-DD`, sin hora), con fallback final a UTC.
4. Se elimina el formateo con hora; `formatAsuncion` queda reducida a solo fecha y se usa únicamente como fallback.
5. No modificar `src/lib/version-check.ts`, `src/contexts/UpdateContext.tsx`, `src/components/UpdateBanner.tsx`, `src/lib/register-app-sw.ts`, `src/components/AppSidebar.tsx` ni ningún otro archivo.

Riesgos
- Bajo. Cambio acotado al string de build.
- El hash cambia con cada commit, así que la detección de versiones nuevas sigue funcionando igual.
- `version.json` sigue emitiendo el mismo string que `__APP_VERSION__` (coherencia del chequeo intacta).
- Riesgo residual: si git no está disponible en el entorno de build, se pierde el determinismo y se usa la fecha de build (comportamiento actual, aceptado como fallback).

Checklist
- [ ] `vite.config.ts` genera el sello como `YYYY-MM-DD · <hash>` usando la fecha del commit.
- [ ] Recompilar el mismo commit produce exactamente el mismo string.
- [ ] `version.json` contiene el mismo string que `__APP_VERSION__`.
- [ ] El chequeo de versión propio (`version-check.ts`) sigue comparando por igualdad de strings sin lógica adicional.
- [ ] TypeScript compila sin errores.
- [ ] El sidebar muestra la fecha y el hash, sin hora.
