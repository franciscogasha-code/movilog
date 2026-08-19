# Selección de catálogo que no se pierde al refrescar

Objetivo: que la selección de productos para el catálogo PDF sobreviva a cualquier refresco, recarga automática del preview, cambio de pestaña o corte de sesión, sin tener que volver a tildar nada.

## Qué se sabe hoy (verificado en el código)

- La selección se guarda en IndexedDB con la clave `sales-selected-ids-<usuario>` mediante el hook de estado persistido.
- Ese hook guarda por efecto (después del render) y, al montar, **reemplaza** el estado en memoria por lo leído del disco.
- La pantalla de Ventas se desmonta y vuelve a montar cada vez que la sesión pasa por "cargando" (muestra "Cargando ventas..."), volviendo el estado a vacío hasta que termina la lectura.
- Existe un autoguardado en el servidor (hasta 6 respaldos), pero hoy **no se usa nunca automáticamente** para recuperar: solo se carga a mano.
- No hay ninguna expiración de 24 h activa en el código actual.

Causa probable (aún no confirmada con evidencia en vivo): entre el remontaje y la lectura del disco hay una ventana donde los tildes que hace el usuario no se guardan y luego son pisados por el valor viejo leído; y si la lectura falla o devuelve vacío, la selección queda en cero. La primera tarea del trabajo es confirmarlo con una prueba real antes de tocar la lógica.

## Plan

### 1. Confirmar el comportamiento (sin cambios funcionales)
- Reproducir en el navegador: seleccionar productos, forzar refresco, y registrar qué queda guardado en IndexedDB en cada paso.
- Verificar si el remontaje por sesión es lo que borra, o si la escritura nunca llega al disco.

### 2. Guardado a prueba de refrescos
- Guardar la selección **en el mismo momento del clic** (escritura directa), no en un efecto posterior.
- Espejo inmediato en almacenamiento local del navegador, que es sincrónico, para que ni un cierre abrupto pierda el último tilde.
- Regla de seguridad: nunca sobrescribir una selección guardada no vacía con una selección vacía, salvo que el usuario toque explícitamente "Limpiar".

### 3. Recuperación sin pisar trabajo
- Al montar, si el estado en memoria ya tiene tildes y el disco tiene otros, **unir** ambos en lugar de reemplazar.
- Volver a leer el disco al recuperar foco de la pestaña, por si otra pestaña o un refresco modificó algo.

### 4. Red de seguridad visible
- Barra permanente en modo selección: "N productos seleccionados" con acción "Recuperar última selección" que trae el autoguardado más reciente del servidor y lo suma a lo actual.
- Aviso claro y no intrusivo cuando la selección se restauró desde respaldo.

### 5. Validación antes de declarar cerrado
- Prueba end-to-end: seleccionar productos, refrescar 3 veces seguidas, cambiar de pestaña, cerrar y reabrir; la cuenta de seleccionados debe mantenerse idéntica.
- Prueba de sesión: forzar el estado "Cargando ventas..." y verificar que no se pierde nada.
- Prueba de "Limpiar": debe seguir vaciando de verdad.

## Detalle técnico

- `src/hooks/use-idb-state.ts`: agregar escritura imperativa (`setAndPersist`), espejo en `localStorage` para lectura sincrónica inicial, y política de merge configurable en la hidratación en lugar del reemplazo actual.
- `src/pages/Ventas.tsx`: la selección (`sales-selected-ids-<uid>`) usa la escritura imperativa; el vaciado solo por acción explícita del usuario.
- `src/components/ventas/CatalogoGrid.tsx`: barra de estado de selección con contador y botón de recuperación.
- `src/hooks/use-selection-autosave.ts`: exponer una función para leer el último autoguardado del usuario y usarla en la recuperación manual.
- Evitar el desmontaje innecesario de `VentasContent` cuando la sesión se revalida (mantener montado si ya hubo un usuario resuelto).
- Sin cambios de base de datos.

Nada de esto se aplica hasta que termines el catálogo y lo apruebes.
