# Módulo Control de Móviles — Fase 1

Reemplaza la página `/flota` (hoy read-only) por un módulo completo con CRUD de vehículos, categorías configurables, registro de uso genérico (paralelo a `trips`), carga de combustible con fotos, y galería. Mantenimientos programados, multas y dashboard con gráficos quedan para Fase 2.

## Alcance funcional

1. **Vehículos** — CRUD completo (alta, edición, baja lógica). Campos ya existentes + apodo interno. Estado: Disponible / En uso / En mantenimiento / Fuera de servicio. Documentación: seguro y VTV con vencimientos y alertas visuales (ya existen).
2. **Categorías de uso** — Tabla configurable (admin/supervisor): entre sucursales, a proveedor, a cliente, trámites, otro. Editable desde la UI.
3. **Registro de uso** — Nueva tabla `vehicle_usages` **paralela** a `trips` (no toca la lógica logística existente). Campos: vehículo, chofer (usuario o texto libre), categoría, destino, km inicial/final, km recorridos (calculado), pedido/envío opcional, fecha-hora inicio/fin, fotos odómetro inicial/final, observaciones. Validaciones: km_inicial ≥ último km registrado del vehículo (soft-warning), alerta si km_recorridos > 2× promedio histórico.
4. **Combustible** — Extender formulario existente (`fuel_records` ya existe) con: foto surtidor/comprobante, cálculo automático precio total ↔ precio/litro, rendimiento km/L entre cargas, alerta si rendimiento cae > 20% vs promedio del vehículo. Historial por vehículo.
5. **Galería** — Vista por vehículo con todas las fotos (odómetro + combustible) ordenadas por fecha.
6. **Actualización de kilometraje** — Trigger que actualiza `vehicles.current_mileage` con el mayor km registrado entre `vehicle_usages`, `fuel_records` y `trips`.

## Cambios de base de datos

**Nuevas tablas:**
- `vehicle_usage_categories` — id, name, description, is_active, created_at
- `vehicle_usages` — id, vehicle_id, driver_id (nullable FK a `drivers`), driver_name_text (fallback), category_id, destination, start_mileage, end_mileage, km_traveled (generated), linked_request_id (nullable FK a `branch_requests`), started_at, ended_at, start_odometer_photo_url, end_odometer_photo_url, notes, created_by, created_at, updated_at

**Modificaciones:**
- `vehicles`: agregar `nickname` (text, nullable).
- `fuel_records`: agregar `computed_efficiency_kmpl` (numeric, calculado por trigger contra la carga anterior).

**Storage:**
- Bucket privado `vehicle-photos` con RLS: chofer puede subir para su vehículo, admin/supervisor/owner todo.

**RLS y GRANTs (siguiendo el patrón del proyecto):**
- `vehicle_usage_categories`: SELECT authenticated; INSERT/UPDATE/DELETE solo admin/supervisor/owner.
- `vehicle_usages`: SELECT authenticated con branch filter vía vehículo asignado o participación del chofer; INSERT si `driver_id` corresponde al `auth.uid()` **o** rol admin/supervisor/owner; UPDATE/DELETE admin/supervisor/owner.
- `fuel_records`: endurecer las policies actuales (`USING (true)`) al mismo criterio.
- Todas con `GRANT` explícito a `authenticated` y `service_role`.

**Funciones/triggers:**
- `fn_recompute_vehicle_mileage(vehicle_id)` — actualiza `vehicles.current_mileage`.
- Trigger `AFTER INSERT/UPDATE` en `vehicle_usages` y `fuel_records` que llama a la función.
- Trigger en `fuel_records` que calcula `computed_efficiency_kmpl` usando el registro anterior del vehículo.

## Cambios de frontend

**Ruta:** `/flota` se reemplaza por el nuevo módulo (misma URL, se conserva navegación existente).

**Estructura de tabs:**
```text
/flota
├── Vehículos      → lista + botón "Nuevo vehículo" + modal detalle con historial completo
├── Usos           → tabla filtrable por vehículo/categoría/fecha + botón "Registrar uso"
├── Combustible    → historial + botón "Registrar carga" + panel rendimiento por vehículo
├── Mantenimiento  → tal como está hoy (sin cambios)
├── Préstamos      → tal como está hoy (sin cambios)
└── Configuración  → CRUD categorías (visible solo admin/supervisor/owner)
```

**Componentes nuevos:**
- `src/components/flota/VehicleForm.tsx` — alta/edición de vehículo.
- `src/components/flota/VehicleUsageForm.tsx` — registro de uso con validaciones de km y `FileUpload` para fotos odómetro.
- `src/components/flota/FuelRecordForm.tsx` — carga de combustible con foto y cálculo bidireccional precio total ↔ precio/litro.
- `src/components/flota/UsageCategoryManager.tsx` — CRUD categorías.
- `src/components/flota/VehiclePhotoGallery.tsx` — galería agrupada por fecha.

**Reutilizamos:** `FileUpload` (ya existe, subir a bucket nuevo), `useUserBranchFilter`, patrones de `Dialog` y `Card` del proyecto, tipografía Space Grotesk/Inter, `.toLocaleString("de-DE")` para ₲/km, español paraguayo.

## Permisos (roles existentes)

| Acción                                    | Chofer (propio vehículo) | Admin / Supervisor / Owner |
|-------------------------------------------|:------------------------:|:--------------------------:|
| Registrar uso                             | ✅                        | ✅                          |
| Registrar carga combustible               | ✅                        | ✅                          |
| Ver historial / galería del vehículo      | ✅                        | ✅                          |
| CRUD vehículos                            | ❌                        | ✅                          |
| CRUD categorías                           | ❌                        | ✅                          |
| Editar/eliminar usos y cargas ajenas      | ❌                        | ✅                          |

## Fuera de alcance (Fase 2, ya acordado)

- Mantenimientos programados con alertas por km/fecha.
- Multas/infracciones.
- Dashboard con Recharts (rendimiento evolución, costo/km, uso por categoría).
- Cron de alertas.

## Entregables

1. Una migración SQL con: 2 tablas nuevas + 2 alteraciones + triggers + policies + grants + seed de 5 categorías por defecto + bucket privado con policies.
2. 5 componentes nuevos bajo `src/components/flota/`.
3. Rewrite de `src/pages/Flota.tsx` con la nueva estructura de tabs.
4. QA manual: crear vehículo, registrar 2 usos consecutivos (validar km), registrar carga y verificar rendimiento calculado, subir fotos y visualizar en galería, editar categoría, verificar bloqueo a chofer no propietario.

## Notas técnicas

- No se toca la lógica de `trips` ni `fn_driver_action`; los usos genéricos son entidad independiente.
- El dashboard de la Fase 2 podrá unir `trips + vehicle_usages + fuel_records + vehicle_maintenance` en una vista SQL sin tocar los flujos.
- `vehicle_usages.linked_request_id` es solo trazabilidad; no dispara ningún cambio en el pedido.
