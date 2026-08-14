# Persistencia real de Carrito y Catálogo en Ventas

## Qué encontré (verificado en el navegador)

Reproduje el caso: agregué un producto en /ventas y recargué la pestaña.

- El carrito **sí** quedó guardado en el almacenamiento local del dispositivo (el badge volvió con 1 ítem tras recargar).
- Lo que **se pierde** es todo el contexto de trabajo: al recargar la app vuelve siempre a la pestaña "Cliente", el catálogo arranca de cero (sin búsqueda, sin marca/categoría, sin filtro de stock, sin las páginas ya cargadas ni la posición de scroll) y la selección para PDF se borra.
- Por eso la sensación de "desapareció todo": el carrito estaba, pero escondido detrás de la pestaña inicial y con el catálogo reiniciado.

También detecté un riesgo real de pérdida de datos: la clave de guardado del carrito incluye el ID del usuario. Cuando la sesión tarda en cargar (celular, señal lenta), la clave cambia de "sin usuario" a "con usuario" y el guardado puede escribir un carrito vacío sobre el guardado bueno. En mi prueba con sesión inmediata no ocurrió, pero el código lo permite.

## Qué voy a hacer

1. **Blindar el guardado local**
   - Corregir la condición de carrera al cambiar de clave: no escribir nada hasta terminar de leer lo guardado para esa clave, y nunca sobrescribir con vacío mientras se rehidrata.
   - Montar el carrito recién cuando la sesión esté resuelta, para que siempre use la clave del usuario.

2. **Recordar dónde estaba trabajando el vendedor**
   - Guardar y restaurar: pestaña activa (Cliente / Catálogo / Carrito / Pedidos), texto de búsqueda, marca, categoría, filtro "solo con stock", modo selección + productos seleccionados, y posición de scroll con la cantidad de páginas ya cargadas.
   - Todo por usuario, en el mismo almacenamiento offline.

3. **Evitar confusión al volver**
   - Al restaurar con carrito no vacío, mostrar un aviso breve "Se recuperó tu carga en curso" y dejar visible el botón flotante del carrito.

4. **Pruebas reales antes de confirmar**
   - Recarga con ítems en carrito, con filtros aplicados y con scroll profundo.
   - Cierre y reapertura de pestaña, y navegación a otro módulo y vuelta.
   - Caso sin conexión: cargar, quedarse sin señal, recargar, volver la señal.
   - Caso sesión lenta (auth demorada) para confirmar que no se borra el carrito.

## Detalles técnicos

- `src/hooks/use-idb-state.ts`: guardar `hydratedKey` y comparar contra `key` antes de persistir; evitar el efecto de escritura durante el cambio de clave.
- `src/pages/Ventas.tsx`: reemplazar `useState` por `useIdbState` para `activeTab`, `selectionMode`, `selectedIds` (serializado como array); montar `VentasContent` solo con `user` definido.
- `src/components/ventas/CatalogoGrid.tsx`: elevar/persistir `search`, `brand`, `category`, `onlyStock` y `pagesLoaded` + `scrollTop`; al rehidratar, usar `fetchNextPage` hasta alcanzar las páginas guardadas (cache de React Query en IndexedDB ya conserva los datos) y restaurar scroll.
- Suite E2E con Playwright cubriendo los escenarios listados, incluyendo verificación directa de las claves en IndexedDB antes y después de recargar.
