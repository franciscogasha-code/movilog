# Plan — Deshabilitar autocompletado del sistema en "Solicitado por / medio"

## Alcance
Solo el input **"Solicitado por / medio"** dentro de `src/components/solicitudes/EnvioDirectoForm.tsx`. No se tocan otros inputs ni formularios del proyecto.

## Diagnóstico
El input actual es un `Input` de shadcn/ui que no declara atributos de autocompletado. Los navegadores móviles y de escritorio lo interpretan como un campo genérico de texto y muestran sugerencias del sistema (contraseñas, tarjetas, direcciones, correcciones automáticas). Esto es especialmente visible en Android/iOS, pero también ocurre en escritorio.

## Solución técnica
Aplicar la combinación estándar y multiplataforma de atributos HTML en el input, **sin detección de dispositivo**:

```tsx
<Input
  value={instructionSource}
  maxLength={MAX_INSTRUCTION_SOURCE}
  onChange={(e) => setInstructionSource(e.target.value)}
  placeholder="Ej: Verbal - Gerente Caballero / WhatsApp"
  autoComplete="off"
  autoCorrect="off"
  autoCapitalize="sentences"
  spellCheck="false"
  inputMode="text"
  name="instruction-source-free-text"
  id="instruction-source-free-text"
  className="mt-1"
/>
```

Razón de cada atributo:
- `autoComplete="off"`: desactiva el autocompletado de contraseñas, tarjetas y direcciones.
- `autoCorrect="off"`: desactiva la corrección automática en iOS/Safari y Android.
- `autoCapitalize="sentences"`: mantiene la primera letra de cada frase en mayúscula de forma natural, útil para nombres de personas y medios ("Verbal - Gerente Caballero"), sin desactivar la ayuda del teclado.
- `spellCheck="false"`: evita subrayados rojos y sugerencias del navegador de escritorio.
- `inputMode="text"`: fuerza teclado de texto estándar (sin sugerencias numéricas/especiales).
- `name` / `id` no comunes (no "name", "email", "address", "phone"): evita que el navegador asocie el campo a datos de autocompletado guardados por el usuario.

## Alternativa robusta si `autoComplete="off"` no alcanza
En algunos navegadores móviles (especialmente versiones antiguas de Chrome Android) `autoComplete="off"` es ignorado. La alternativa robusta estándar es usar un valor no reconocido por el navegador:

```tsx
autoComplete="new-instruction-source"
```

O, si el navegador insiste en autocompletar, una solución universal segura es:

```tsx
autoComplete="one-time-code"
```

En la práctica, la combinación `autoComplete="off"` + `autoCorrect="off"` + `autoCapitalize="off"` + `spellCheck="false"` + `name`/`id` no estándar resuelve el problema en Android, iOS/Safari y escritorio. Si durante las pruebas persiste en algún navegador, se reemplaza por `autoComplete="new-instruction-source"` (alternativa declarada en el mismo plan).

## Checklist de prueba
1. Abrir `/solicitudes` → "Enviar a otra sucursal".
2. Tocar/focusear el input "Solicitado por / medio".
3. Verificar que NO aparezca la barra de autocompletado del sistema en:
   - Android Chrome (contraseñas, tarjetas, direcciones).
   - iOS Safari (sugerencias de autocompletado y corrección automática).
   - Escritorio Chrome/Safari/Firefox (dropdowns de autocompletado).
4. Verificar que el input sigue permitiendo texto libre y se guarda correctamente en `instruction_source`.
5. Verificar que el resto del formulario (origen, destino, productos) no se ve afectado.

## Riesgos de regresión
| Riesgo | Mitigación |
|---|---|
| Cambio de atributos HTML afecta la validación o el valor del input | Solo se agregan atributos de autocompletado; `value`, `onChange` y `maxLength` se mantienen iguales. |
| Se deshabilita corrección automática en otros inputs del formulario | Se modifica solo el input de "Solicitado por / medio". |
| Navegador ignora `autoComplete="off"` | Se documenta alternativa robusta (`autoComplete="new-instruction-source"`) y se prueba en el checklist. |
| Falla de guardado del campo | El atributo `name` no se usa en el submit del formulario; el valor sigue controlado por React state. |

## Notas de implementación
- No se agregan dependencias.
- No se modifica la base de datos ni el backend.
- No se afecta la lógica de negocio.
