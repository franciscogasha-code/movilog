# Auditoría de raíz — Módulo Ruteo

## Diagnóstico (causa raíz exacta)

El error `invalid input value for enum event_category: "logistics"` no es un bug aislado. Es el síntoma de una **inconsistencia estructural sostenida** entre el frontend, las RPC nuevas y el enum real de Postgres.

### Hechos verificados en DB (no asumidos)

**Enum real `public.event_category`** (única fuente de verdad):
```
request, fulfillment, document, trip, inventory, incident,
vehicle, collection, stock, preparation, transport, reception, closure
```

**No existe `logistics`** en este enum, y nunca existió (los 186+15+87+172+1 eventos históricos en `operational_events` usan exclusivamente `transport / request / reception / closure / preparation`).

**Confusión de origen**: hay OTRA columna llamada `area` en la tabla `ai_anomalies` que es `text` libre y SÍ acepta `"logistics"`. Históricamente las migraciones insertan `'logistics'` ahí sin problema. Alguien (yo, en intervenciones recientes) extrapoló incorrectamente ese literal a `operational_events.category`, que es un enum estricto.

### Lugares contaminados (8 archivos frontend + 2 RPC nuevas)

Frontend (insert directo a `operational_events` con `category: "logistics" as any`):
- `src/components/logistica/CrearViajeForm.tsx:137` → evento `trip_planned` (debe ser `trip`)
- `src/components/chofer/ViajeInterurbano.tsx:90` → `trip_started` (debe ser `transport`)
- `src/components/chofer/ViajeInterurbano.tsx:141` → `trip_completed` (debe ser `transport`)
- `src/components/chofer/CorteUrbano.tsx:113` → `cutoff_started` (`transport`)
- `src/components/chofer/CorteUrbano.tsx:174` → `cutoff_ended` (`transport`)
- `src/components/chofer/AgregarTareaViaje.tsx:72` → `task_added_in_transit` (`transport`)
- `src/components/chofer/CargasDisponibles.tsx:307` → `driver_pickup_rejected` (`incident`)
- `src/components/chofer/CorteDetalle.tsx:135` → `driver_pickup_rejected` (`incident`)

RPC nuevas creadas en intervenciones recientes:
- `fn_cancel_trip` (migración `20260428172239`) → `'logistics'::event_category` (debe ser `'trip'`)
- `fn_edit_trip` (migración `20260428174318`) → `'logistics'::event_category` ya estaba mal (ya en DB, falla en runtime al ejecutarse — el cast literal se valida tarde en plpgsql)

> Postgres aceptó **crear** las funciones porque el cast `'logistics'::event_category` dentro de plpgsql se valida al ejecutar, no al definir. Por eso el error aparece sólo al usar la función.

### Por qué pasó (estructural, no anecdótico)

1. **No hay un mapeo único** evento→categoría. Cada archivo decidió ad-hoc.
2. **`as any` ocultó el error de tipos** que TS habría detectado (los tipos generados de Supabase tienen el enum real).
3. **Las RPC nuevas se escribieron a mano** sin consultar el enum vigente.
4. **No hay test ni linter** que detecte literales enum inválidos antes de ejecutar.

---

## Mapa de corrección (mapping definitivo, sin inventar)

| Acción | event_type | category correcta |
|---|---|---|
| Crear viaje | `trip_planned` | `trip` |
| Editar viaje | `trip_edited` | `trip` |
| Cancelar viaje | `trip_cancelled` | `trip` |
| Iniciar viaje | `trip_started` | `transport` |
| Finalizar viaje | `trip_completed` | `transport` |
| Iniciar corte urbano | `cutoff_started` | `transport` |
| Finalizar corte urbano | `cutoff_ended` | `transport` |
| Tarea agregada en tránsito | `task_added_in_transit` | `transport` |
| Chofer rechazó retiro | `driver_pickup_rejected` | `incident` |

Criterio: alinear con los 461 eventos históricos ya en producción (`transport`, `reception`, `closure`, `request`, `preparation`). `trip` queda reservado a cambios de **planificación** del viaje (crear/editar/cancelar), `transport` a la **operación** del viaje (iniciar/finalizar/tareas).

> No tocamos `ai_anomalies.area = 'logistics'` — esa columna es text, funciona, y cambiarla rompería migraciones, dashboards y consultas históricas.

---

## Cambios a aplicar (una sola tanda integral)

### 1. Fuente única de verdad (frontend)

Crear `src/lib/event-categories.ts`:
- Exporta tipo `EventCategory` derivado de `Database["public"]["Enums"]["event_category"]` (sin `as any`).
- Exporta constante `EVENT_CATEGORIES` con los 13 valores reales.
- Exporta helper `categoryForTripEvent(eventType)` con el mapping de la tabla anterior.

### 2. Refactor de los 8 archivos frontend
Reemplazar cada `category: "logistics" as any` por la categoría correcta del mapping, importada del módulo nuevo (sin `as any`). Esto hace que TS valide el literal contra el enum real.

### 3. Migración SQL correctiva (sólo 2 funciones, sin tocar schema)
Reemplazar (`CREATE OR REPLACE`) `fn_cancel_trip` y `fn_edit_trip` para que usen `'trip'::event_category` en su `INSERT INTO operational_events`. Cero cambios de firma, cero cambios de lógica de validación, cero cambios de RLS.

### 4. Nada más
- No tocamos `fn_transition_request_status`, `fn_driver_action`, `fn_clear_for_pickup`, `fn_ensure_driver_for_user` — todas usan categorías correctas (`request`, `transport`, `reception`, etc.).
- No tocamos triggers (`fn_auto_resolve_alerts`, etc.) — usan `'logistics'` sólo en `ai_anomalies.area` que es text.
- No tocamos enums, RLS, schema, índices, tipos generados, hooks de cache.

---

## Lo que NO se toca (y por qué)

| Ítem | Por qué no se toca |
|---|---|
| Enum `event_category` | Agregar `logistics` rompería el modelo semántico ya consolidado (461 eventos) y duplicaría significado con `transport/trip` |
| `ai_anomalies.area` | Es `text`, funciona, cambiarlo rompe migraciones históricas y dashboards |
| RPC ajenas a Ruteo | Sin `'logistics'::event_category`. Validado |
| Tipos `src/integrations/supabase/types.ts` | Auto-generados |
| Realtime / RLS | Fuera del scope del bug |
| Lógica de joins / cache de `LogisticaViajesProgramados` | Ya estabilizada en intervención previa |

---

## Plan de validación (post-implementación)

Casos funcionales (cada uno verifica que ya no salta el error de enum y la operación persiste):

1. Crear viaje → ver evento `trip_planned` con `category=trip` en `operational_events`.
2. Editar viaje (cambiar chofer) → evento `trip_edited` con `category=trip`.
3. Cancelar viaje vacío → evento `trip_cancelled` con `category=trip`.
4. Iniciar viaje (chofer) → `trip_started` con `category=transport`.
5. Finalizar viaje → `trip_completed` con `category=transport`.
6. Iniciar/finalizar corte urbano → `category=transport`.
7. Agregar tarea en tránsito → `category=transport`.
8. Rechazar retiro desde móvil → `category=incident` + alerta en `ai_anomalies`.
9. Asignar/quitar carga, refresh navegador, navegación atrás móvil → sin regresión.
10. Multi-rol: owner / jefe_logistica / warehouse_operator / driver — sin permisos rotos (no tocamos `has_role`/RLS).

Query de verificación post-deploy:
```sql
SELECT category, count(*) FROM operational_events
WHERE created_at > now() - interval '1 hour' GROUP BY 1;
```
No debe aparecer error en logs ni categorías nuevas inesperadas.

---

## Riesgos mitigados

- **Riesgo de inventar enum**: descartado. Usamos sólo valores reales del schema.
- **Riesgo de romper triggers**: triggers no tocados.
- **Riesgo de tipos stale**: el refactor quita `as any`, así TS bloquea futuras regresiones.
- **Riesgo de afectar permisos del Jefe de Logística** (intervención anterior): no se toca `fn_edit_trip`/`fn_cancel_trip` en la parte de roles, sólo el literal de category.
- **Riesgo en chofer móvil**: cambios mínimos, mismo comportamiento, sólo categoría correcta.

---

## Resumen

3 cambios concretos:
1. **Nuevo**: `src/lib/event-categories.ts` (mapping tipado).
2. **Editar 8 archivos frontend** — sustituir literal incorrecto por categoría tipada del mapping.
3. **Una migración** que reemplaza `fn_cancel_trip` y `fn_edit_trip` con `'trip'::event_category`.

Esto cierra la causa raíz del módulo Ruteo sin parches, sin tocar nada que ya funciona, y deja una barrera de tipos para que no vuelva a ocurrir.
