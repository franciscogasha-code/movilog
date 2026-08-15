# Guía para Claude Code — MoviLog

## Qué es este proyecto

MoviLog es el sistema WMS/TMS de SANSEI (Paraguay). Reemplaza la coordinación por WhatsApp y la app legada Vector para gestionar pedidos, stock, logística, choferes, flota, rendiciones y ventas de catálogo.

La fuente de verdad funcional está en `docs/MOVILOG.md` (documentación maestra). Si necesitás entender un módulo en detalle, empezá por ahí.

## Stack

- **Frontend**: React 18, Vite, TypeScript, Tailwind CSS v3, shadcn/ui.
- **Backend / datos**: Lovable Cloud (Supabase gestionado) — Postgres, Auth, Storage, Edge Functions.
- **Estado local**: React hooks + Context. IndexedDB para offline (ventas).
- **Tests**: Vitest.
- **Comandos comunes**:
  - `npm install`
  - `npm run dev` (levanta en http://localhost:8080)
  - `npx vitest run`

## Reglas de oro (NO tocar)

- `src/integrations/supabase/client.ts` y `src/integrations/supabase/types.ts` son autogenerados.
- `.env` y `supabase/config.toml` son gestionados por la plataforma.
- Las migraciones existentes en `supabase/migrations/` no se editan. Nuevos cambios de base van en migraciones nuevas con fecha/UUID.
- No se agregan claves privadas, tokens ni `SUPABASE_SERVICE_ROLE_KEY` al código. Los secretos viven en el almacén de secretos del backend (`Deno.env.get`).
- Cada tabla nueva en el esquema `public` requiere: `GRANT`, `ENABLE ROW LEVEL SECURITY`, y políticas sin `USING (true)`.
- Los roles de usuario viven en `public.user_roles`, nunca en la tabla de perfiles.

## Convenciones del proyecto

- **Idioma de UI**: castellano paraguayo operativo. Mensajes cortos y directos.
- **Números y moneda**: `toLocaleString("de-DE")`; guaraníes con el símbolo `₲`.
- **Colores**: usar tokens semánticos (`bg-primary`, `text-destructive`, etc.). No hardcodear `text-white`, `bg-black`, hex sueltos, ni degradados por defecto.
- **Tipografía**: Space Grotesk para títulos, Inter para cuerpo.
- **Deep-linking de detalles**: modales y paneles de detalle usan `?detail=UUID` y limpian la URL al cerrarse.
- **Filtro de sucursales**: en el frontend usar `useUserBranchFilter`; en la base, las políticas de RLS restringen por acceso a sucursal.

## Reglas de negocio críticas que no son obvias en el código

- **BIMS es el ERP fuente de verdad**: MoviLog lee catálogo, precios y stock en vivo desde BIMS. No escribe nunca en BIMS.
- **Pre-ventas aisladas**: las filas de `branch_requests` con `is_pre_sale = true` no deben aparecer en módulos operativos (Pedidos, Logística, Chofer, Dashboard, etc.). Solo se ven en la bandeja de Solicitudes / Pre-Ventas hasta que se promueven a operación.
- **Datos de cliente protegidos**: `client_phone` y `client_email` están enmascarados en `branch_requests`. Solo se obtienen mediante `fn_get_request_client_contact` para usuarios autorizados.
- **Pedidos vs. fulfillment**: `branch_requests` es la entidad central. `fulfillment_orders` y `shipment_packages` son desdoblamientos logísticos.
- **Ciclo de vida de pedido**: estados agrupados en fases: Pendientes → En preparación → En tránsito → Cerrados. Después de `in_transit` no se permite editar el pedido.
- **Abastecimiento Fase 5A**: cuando un pedido tiene ítems sin stock local, se resuelve con `branch_request_items.local_supply_qty` y se crean pedidos hijos. El abastecimiento parcial está permitido como warning, no como bloqueo duro.
- **Modo Cliente en ventas**: el catálogo puede mostrarse al cliente ocultando stock numérico por sucursal; el vendedor puede hacer “peek” largo para ver datos internos.
- **Offline en ventas**: carrito y clientes persisten en IndexedDB; los pedidos se encolan en `sales_outbox` para sincronización segura cuando vuelve la conexión.

## Cómo trabajar sin romper nada

1. Hacé `git pull` antes de empezar (Lovable también escribe en `main`).
2. Trabajá en una rama propia (`git checkout -b feat/...`).
3. Corré `npx vitest run` antes de proponer un cambio.
4. Abrí Pull Request en GitHub; no pushees directo a `main` para evitar conflictos con cambios desde Lovable.
5. Para cambios de base, escribí la migración SQL y probá el resultado con una base local o con un script de verificación. No edités migraciones ya aplicadas.

## Mapa rápido de archivos

| Módulo | Páginas | Componentes / hooks | Lógica clave |
|--------|---------|---------------------|--------------|
| Panel operativo | `src/pages/Index.tsx` | `src/hooks/use-user-access.ts` | Cola unificada por participación del usuario |
| Dashboard ejecutivo | `src/pages/DashboardEjecutivo.tsx` | `src/hooks/use-executive-dashboard.ts` | `executive-insights` Edge Function |
| Solicitudes / Pedidos | `src/pages/Solicitudes.tsx`, `src/pages/Pedidos.tsx` | `src/components/solicitudes/*`, `src/lib/branch-requests-query.ts`, `src/lib/request-status.ts` | `fn_transition_request_status`, `fn_commit_supply_resolution` |
| Consultas | `src/pages/Consultas.tsx` | `src/components/solicitudes/*` | `fn_respond_consultation_target` |
| Logística / viajes | `src/pages/Ruteo.tsx`, `src/pages/Cumplimiento.tsx` | `src/components/logistica/*` | Viajes, consolidación, `trip-eligible-drivers` |
| Chofer | `src/pages/Chofer.tsx` | `src/components/chofer/*` | `fn_driver_action` |
| Flota | `src/pages/Flota.tsx` | `src/components/flota/*` | Vehículos, usos, combustible, multas, mantenimiento |
| Rendición | `src/pages/Rendicion.tsx` | - | Combustible, viáticos, cobranzas, depósitos |
| Ventas / Catálogo | `src/pages/Ventas.tsx` | `src/components/ventas/*`, `src/lib/ventas.ts`, `src/lib/catalogo-pdf.ts` | `bims-image-proxy`, `bims-stock-live`, offline cart |
| Sincronización BIMS | `src/pages/SincronizacionBims.tsx` | - | `bims-sync`, `bims-proxy`, `bims-stock-live` |
| Usuarios y accesos | `src/pages/Usuarios.tsx` | `src/contexts/AuthContext.tsx`, `src/hooks/use-user-access.ts` | `create-user`, `reset-user-password` |
| Alertas / incidencias | `src/pages/Alertas.tsx`, `src/pages/Incidencias.tsx` | `src/components/incidencias/*` | `commercial-escalation`, `fleet-daily-alerts` |

## Datos: no tocar directamente

No hay acceso directo a Postgres. Si en algún momento se necesita consultar datos reales (KPIs, patrones, errores), se hace mediante una **cuenta de solo lectura dentro de MoviLog** (Opción A), que respeta RLS por sucursal y roles. Nunca se usa una connection string directa.

## Contacto y contexto

- Proyecto: MoviLog — Logística Integral Design.
- Propietario: Juan Aquino / SANSEI.
- Documentación: `docs/MOVILOG.md`.
