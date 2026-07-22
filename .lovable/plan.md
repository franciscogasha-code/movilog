# Módulo Flota — Fase 2

Completa el módulo `/flota` agregando **Dashboard analítico**, **Mantenimientos programados con alertas** y **Multas / infracciones**. Reutiliza la infraestructura de Fase 1 (bucket `vehicle-photos`, `SignedImg`, patrones de forms, RLS por rol).

## Alcance funcional

### 1. Dashboard de Flota (tab nuevo "Reportes")
Vista ejecutiva con filtros globales: rango de fechas (últimos 30/90/365 días o custom) y vehículo (todos / uno).

**KPIs superiores (cards):**
- Km recorridos totales (suma `vehicle_usages` + `trips`).
- Litros cargados y gasto total en ₲.
- Rendimiento promedio flota (km/L).
- Costo por km (₲/km).
- Vehículos activos vs total.

**Gráficos (Recharts):**
- Evolución de rendimiento km/L por vehículo (line chart, multi-serie).
- Gasto mensual de combustible (bar chart apilado por vehículo).
- Uso por categoría (pie/donut de `vehicle_usage_categories`).
- Top 5 vehículos por km recorridos (horizontal bar).

**Tabla comparativa por vehículo:** km totales, litros, gasto, km/L, ₲/km, último uso, alertas activas.

### 2. Mantenimientos programados
Extiende `vehicle_maintenance` (ya existe) con: `scheduled_km`, `scheduled_date`, `alert_km_threshold` (default 500), `alert_days_threshold` (default 7), `recurrence_km` y `recurrence_days` (para programar el próximo automáticamente al completar).

- **CRUD** desde el tab "Mantenimiento" con form completo (tipo, taller, costo, fechas, km, recurrencia).
- **Alertas visuales** en la lista de vehículos: badge amarillo si `current_mileage >= scheduled_km - threshold` o `scheduled_date - hoy <= days_threshold`; rojo si vencido.
- **Auto-programación**: al marcar `completed`, si tiene recurrencia, se inserta el siguiente registro.
- **Panel "Próximos mantenimientos"** en el Dashboard (7 días o 500 km).

### 3. Multas / infracciones (nueva tabla `vehicle_fines`)
Campos: `vehicle_id`, `driver_id` (opcional), `fine_number`, `issued_at`, `location`, `infraction_type`, `amount`, `due_date`, `status` (pending/paid/appealed/cancelled), `paid_at`, `paid_by`, `receipt_photo_url`, `notes`.

- **Nuevo tab "Multas"** con lista filtrable + form de alta.
- Cálculo automático de **vencidas** (rojo si `due_date < hoy AND status='pending'`).
- Subida de foto del recibo al bucket `vehicle-photos` (subcarpeta `fines/`).
- Panel "Multas pendientes" en Dashboard con total adeudado.

### 4. Cron de alertas diario
Edge Function `fleet-daily-alerts` programada con `pg_cron` a las 07:00. Genera entradas en `ai_anomalies` (área `logistics`) para:
- Mantenimientos próximos a vencer (fecha o km).
- Mantenimientos vencidos.
- Multas pendientes vencidas.
- VTV o seguro próximos a vencer (< 15 días) — reutiliza `insurance_expiry` / `vtv_expiry` ya existentes en `vehicles`.

## Cambios de base de datos (una sola migración)

**Nueva tabla `vehicle_fines`** con GRANTs, RLS (SELECT authenticated, INSERT/UPDATE/DELETE admin/supervisor/owner o driver dueño del vehículo asignado) y trigger `updated_at`.

**Alter `vehicle_maintenance`** — agregar `scheduled_km`, `alert_km_threshold`, `alert_days_threshold`, `recurrence_km`, `recurrence_days`, `parent_maintenance_id`.

**Función `fn_maintenance_autoschedule`** — trigger `AFTER UPDATE` en `vehicle_maintenance`: si pasa a `completed` y tiene recurrencia, inserta próximo registro.

**Vista `v_fleet_kpis_by_vehicle`** — agrega km, litros, gasto y km/L por vehículo por mes (materializada opcional; empezamos con view normal).

## Cambios de frontend

**Componentes nuevos bajo `src/components/flota/`:**
- `FleetDashboard.tsx` — orquestador de KPIs + gráficos + filtros.
- `MaintenanceForm.tsx` — alta/edición de mantenimiento programado.
- `FineForm.tsx` — alta/edición de multa.
- `FinesList.tsx` — tabla filtrable de multas.
- `MaintenanceAlertsBadge.tsx` — badge reutilizable para lista de vehículos.

**Cambios en `src/pages/Flota.tsx`:**
- Nuevos tabs: `Reportes` (primero) y `Multas`.
- Tab `Mantenimiento` deja de ser read-only: agrega botón "Nuevo mantenimiento" + edición.
- En la lista de vehículos, insertar `MaintenanceAlertsBadge`.

**Edge Function nueva:** `supabase/functions/fleet-daily-alerts/index.ts` + cron con `pg_cron` (SQL de agenda va vía tool insert, no migration, porque incluye anon key).

## Permisos

| Acción | Chofer (vehículo propio) | Admin / Supervisor / Owner |
|---|:-:|:-:|
| Ver dashboard | ❌ | ✅ |
| Ver multas del vehículo | ✅ | ✅ |
| CRUD multas | ❌ | ✅ |
| Marcar multa pagada + subir recibo | ✅ (propia) | ✅ |
| CRUD mantenimientos | ❌ | ✅ |
| Marcar mantenimiento completado | ✅ | ✅ |

## Entregables

1. Migración SQL con tabla `vehicle_fines`, alters de `vehicle_maintenance`, view `v_fleet_kpis_by_vehicle`, función de auto-programación, GRANTs y policies.
2. 5 componentes nuevos + rewrite parcial de `Flota.tsx`.
3. Edge Function `fleet-daily-alerts` + cron agendado.
4. QA manual: crear mantenimiento con recurrencia y completar (verificar próximo), crear multa vencida (verificar badge rojo), verificar dashboard con datos reales, verificar alertas cron.

## Fuera de alcance
- Integración con proveedor de multas oficial.
- Exportación PDF/Excel del dashboard (queda para Fase 3 si se pide).
- Firma digital de comprobantes.
