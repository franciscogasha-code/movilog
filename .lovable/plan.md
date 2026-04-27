## Plan de corrección crítica: navegación mobile estable

### Diagnóstico inicial encontrado

La regresión más probable no está en Pedidos ni en lógica de negocio. Está en el app shell mobile:

1. El sidebar mobile usa `Sheet`.
2. `Sheet` fue modificado recientemente para usar `useBackToClose`.
3. `useBackToClose` hace `history.pushState()` al abrir un overlay y `history.back()` cuando se cierra desde UI.
4. Al tocar un item del menú mobile, hoy ocurre una carrera:
   - el `NavLink` navega a `/solicitudes`, `/consultas`, `/chofer`, etc.
   - el `onClick` del contenedor cierra el sidebar mobile
   - al cerrarse el `Sheet`, `useBackToClose` ejecuta `window.history.back()`
   - eso puede volver a la ruta anterior, típicamente Dashboard `/`

Esto explica directamente: “tocar Pedidos lleva a Dashboard”, necesidad de tocar varias veces, rebotes y navegación inestable. Es un problema estructural de navegación/history, no un tema visual.

### Objetivo

Dejar el flujo mobile así:

```text
Tap menú -> navegación correcta -> cierre del menú -> pantalla destino usable
```

Sin doble toque, sin rebote al Dashboard, sin overlay invisible bloqueando, sin tocar lógica de pedidos/consultas/transporte.

### Cambios propuestos

#### 1. Corregir la causa raíz en `useBackToClose`

Modificar `src/hooks/use-back-to-close.ts` para que:

- No ejecute `window.history.back()` durante el cleanup normal si el overlay se cerró por una acción de UI.
- Distinga explícitamente entre:
  - cierre por botón back/popstate
  - cierre programático/UI
- Use una estrategia segura con marker de history que no deshaga una navegación real recién ocurrida.
- Evite listeners duplicados y efectos encadenados.

Resultado esperado: cerrar un Sheet/Dialog no debe revertir la ruta actual.

#### 2. Hacer la navegación del sidebar mobile explícita y atómica

Modificar `src/components/AppSidebar.tsx` para eliminar el cierre genérico por `onClick` en `SidebarContent` y reemplazarlo por navegación controlada por item:

- Cada item tendrá un handler mobile dedicado.
- En mobile: cerrar menú y navegar al destino correcto sin depender de bubbling accidental.
- En desktop: mantener comportamiento actual.
- No cambiar permisos, módulos visibles ni rutas.

Esto evita que cualquier click interno del sidebar cierre el menú por accidente y reduce carreras de eventos.

#### 3. Revisar `Sheet` mobile para no interferir con rutas

Revisar `src/components/ui/sheet.tsx` y `src/components/ui/sidebar.tsx` para asegurar:

- overlay sólo activo cuando el sheet está abierto
- z-index correcto
- cierre por overlay/back sin bloquear taps posteriores
- ancho mobile estable
- no quedan elementos invisibles con `pointer-events` capturando toques

Si el problema queda resuelto con el hook, no se harán cambios innecesarios.

#### 4. Mantener intacta la lógica de negocio

No tocar:

- queries de Pedidos
- filtros de Pedidos
- creación de pedidos
- cambio de estado
- detalle de pedidos
- consultas de disponibilidad
- lógica Chofer/Transporte
- RLS/backend
- Dashboard operativo

### QA y validación

Ejecutaré validación técnica y funcional:

1. Build/typecheck.
2. Búsqueda de usos de `history.back`, `pushState`, `popstate`, `setOpenMobile` para confirmar que no queda otra fuente de rebote.
3. Prueba mobile con viewport equivalente a iPhone/Android en preview:
   - Dashboard -> Pedidos
   - Dashboard -> Consultas
   - Dashboard -> Transporte
   - volver atrás
   - abrir/cerrar menú varias veces
   - abrir/cerrar detalle si hay datos disponibles
4. Confirmar que desktop mantiene navegación intacta.

### Sobre los videos solicitados

En este entorno puedo inspeccionar código, ejecutar pruebas y usar preview automatizado después de aprobar el cambio. Si la herramienta de browser/sandbox lo permite, capturaré evidencia visual del flujo. Si no permite grabación de video real, entregaré exactamente qué se verificó y la limitación técnica; no voy a afirmar “probado en dispositivo real” si no se ejecutó en dispositivo real.

### Entrega final

Reportaré:

- causa raíz exacta
- archivos modificados
- qué carrera de history/router provocaba el rebote a Dashboard
- pruebas ejecutadas
- regresiones descartadas
- confirmación explícita de que no se tocó lógica de negocio ni backend