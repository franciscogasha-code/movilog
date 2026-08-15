# MoviLog — Documentación Funcional y Técnica

**Sistema operativo logístico de SANSEI**

Versión del documento: 1.0 · Fecha: 15 de agosto de 2026

Este documento describe la totalidad de MoviLog: qué hace cada módulo, por qué se creó, cómo funciona en la operación diaria y cómo está programado (tablas, funciones de base de datos, funciones de servidor y archivos del código). Está escrito para que la primera parte de cada sección la entienda cualquier persona del negocio y el detalle técnico quede concentrado al final de cada sección y en los anexos.

---

## Índice

**Parte I — Contexto y Arquitectura**
- Qué es MoviLog
- Mapa de módulos
- Ciclo de vida de un pedido
- Roles operativos
**Parte II — Módulos**
- Panel Operativo Unificado
- Dashboard Ejecutivo
- Consultas de Disponibilidad
- Alertas y Excepciones
- Solicitudes y Pedidos
- Cumplimiento (Ejecución Física)
- Ruteo y viajes
- App del Chofer
- Distribución (Mayorista)
- Etiquetas y bultos
- Recepción física
- Incidencias
- Documentos (Trazabilidad documental)
- Notas transversales del dominio
- Ventas — Catálogo del Vendedor
- Catálogo PDF para el Cliente
- Trabajo sin Conexión (Offline)
- Flota y Control de Móviles
- Rendición
- Cobranzas
- Stock Comprometido y Stock Especial
- Usuarios, Roles y Accesos
- Sincronización con BIMS
- Modelo de Seguridad
- Arquitectura y Convenciones Técnicas
**Parte III — Anexos Técnicos**
- Anexo A — Diccionario de tablas
- Anexo B — Tipos enumerados
- Anexo C — Funciones de base de datos
- Anexo D — Edge functions
- Anexo E — Convenciones del proyecto
- Anexo F — Módulos en fase futura

---

# Parte I — Contexto y Arquitectura

## Qué es MoviLog

MoviLog es el sistema operativo logístico de SANSEI. Reemplaza la coordinación informal por WhatsApp, las planillas sueltas y la aplicación comercial Vector, unificando en una sola plataforma el ciclo completo de una mercadería: desde que alguien la necesita hasta que está físicamente entregada, recibida, documentada y rendida.

La aplicación es una SPA en React 18 + Vite + TypeScript + Tailwind, con backend gestionado (base PostgreSQL, autenticación, storage y edge functions). Funciona en escritorio para las áreas internas y en celular para vendedores y choferes, con soporte de trabajo sin conexión en el módulo de Ventas.

### El problema que resuelve

Antes de MoviLog la operación tenía cuatro agujeros concretos:

1. **Pedidos sin rastro.** Una sucursal pedía mercadería por WhatsApp. Si el mensaje se perdía en el grupo, el pedido no existía. Nadie podía decir cuántos pedidos había abiertos ni desde cuándo.
2. **Custodia difusa.** Con la mercadería en camino, nadie sabía con certeza quién la tenía en la mano en ese momento ni dónde estaba físicamente.
3. **Cierre prematuro.** Se daba por terminado un envío cuando salía del depósito, aunque la entrega física y la rendición de documentos ocurrieran días después.
4. **Datos comerciales dispersos.** El vendedor mostraba productos con capturas de pantalla y precios desactualizados, y el pedido del cliente se cargaba dos veces.

MoviLog ataca los cuatro: todo pedido es un registro con número, todo movimiento genera un evento con custodio y ubicación, el ciclo queda abierto hasta la entrega física más la rendición documental, y el vendedor trabaja sobre el catálogo real del ERP.

### Principio rector: cumplimiento diferido

El ciclo logístico **no** se cierra cuando la mercadería sale. Se cierra en dos etapas:

- **Cierre logístico** (`logistic_closed`): la mercadería llegó y fue recibida físicamente.
- **Cierre administrativo** (`closed`): los documentos volvieron, se conciliaron con el ERP y no hay pendientes.

Esta separación es la razón por la que existen campos como `logistic_closed_at` y `admin_closed_at` en el mismo pedido.

### Relación con BIMS (el ERP)

BIMS es la **única fuente de verdad** de catálogo, precios y stock. MoviLog nunca escribe en BIMS; lo consulta.

| Dato | Dónde vive | Cómo llega a MoviLog |
|---|---|---|
| Catálogo de productos, marcas, categorías | BIMS | Sincronización periódica a `products` |
| Precios y escalas de precio | BIMS | Sincronización a `products.price_scales` / `price_lists` |
| Stock por depósito | BIMS | Consulta en vivo por edge function, sin persistir |
| Imágenes de producto | BIMS | Proxy con caché (`bims-image-proxy`) |
| Facturas y transferencias | BIMS | Se referencian por número en el pedido |
| Pedidos, viajes, custodia, incidencias, rendición | MoviLog | Nacen y viven en MoviLog |

La consecuencia práctica: si un producto no está bien cargado en BIMS (por ejemplo sin foto), MoviLog lo va a mostrar así. No es una falla del sistema logístico sino un dato de origen.

## Mapa de módulos

Los módulos se agrupan en cuatro dominios, tal como aparecen en el menú lateral (`src/components/AppSidebar.tsx`):

**Principal**
- Dashboard (panel operativo unificado) — `/`
- Dashboard Ejecutivo — `/ejecutivo`
- Ventas — `/ventas`
- Alertas — `/alertas`

**Operación**
- Consultas de disponibilidad — `/consultas`
- Pedidos — `/solicitudes`
- Stock Comprometido — `/stock-comprometido`
- Operaciones (cumplimiento) — `/cumplimiento`
- Recepción — `/recepcion`
- Incidencias — `/incidencias`
- Documentos — `/documentos`

**Logística**
- Transporte / App del Chofer — `/chofer`
- Etiquetas — `/etiquetas`
- Rendición — `/rendicion`

**Administración**
- Usuarios — `/usuarios`
- Sincronización BIMS — `/sincronizacion`
- Flota — `/flota`
- Ruteo — `/ruteo`
- Cobranzas — `/cobranzas`

Cada ítem del menú está atado a un `moduleKey`. El acceso se resuelve contra `user_module_access`: si no hay registro explícito, el módulo se considera habilitado; si hay un registro con `is_enabled = false`, se oculta.

Existen además cuatro rutas de fase futura que hoy sólo muestran una pantalla de "próximamente": `/abastecimiento`, `/reposicion`, `/pedidos` y `/distribucion` (esta última con contenido parcial). Están documentadas al final para que quede claro que son placeholders y no funcionalidad activa.

## Ciclo de vida de un pedido

```text
                 CONSULTA (opcional)
        ¿quién tiene stock? → respuesta por sucursal
                     │
                     ▼
        PEDIDO (branch_requests) — nace con número
                     │
     ┌───────────────┴────────────────┐
     │                                │
  in_supply                        pending
  (necesita abastecerse)     (origen ya definido)
     │                                │
  resolución de abastecimiento        │
  local + pedidos hijos               │
     │                                │
  supplied ──────────────────────────►│
                                      ▼
                              in_preparation
                    (se materializan fulfillment_orders)
                                      │
                     ready_for_pickup / ready_for_delivery
                                      │
                        in_consolidation → assigned_to_trip
                                      │
                                  in_transit
                          (custodia = chofer, ubicación = ruta)
                                      │
                      delivered / delivered_to_third_party
                                      │
                                  received
                        (recepción física + conciliación BIMS)
                                      │
                             logistic_closed
                                      │
                        rendición documental y de valores
                                      │
                                   closed
```

En paralelo a este eje corren tres carriles: **eventos** (`operational_events`, que registra cada cambio de estado, custodio y ubicación), **documentos** (`tracked_documents`, con su propio ciclo hasta el archivo) e **incidencias** (`logistics_incidents`, que puede abrirse en cualquier punto).

### Las cuatro categorías de evento

Todo lo que pasa se clasifica en una de cuatro categorías, y esa clasificación es la que alimenta los KPIs y la cola operativa:

| Categoría | Qué abarca | Responsable típico |
|---|---|---|
| `preparation` | Aceptación, picking, armado de bultos, listo para retiro | Depósito / sucursal origen |
| `transport` | Asignación a viaje, salida, tránsito, transferencias de custodia | Chofer / logística |
| `reception` | Llegada, conteo, aceptación o rechazo, conciliación con BIMS | Sucursal destino |
| `closure` | Cierre logístico, retorno de documentos, cierre administrativo | Administración |

## Roles operativos

Los roles viven en `user_roles` (nunca en el perfil) y se consultan con la función `has_role`. El enum `app_role` define once roles:

| Rol | Para qué existe | Alcance típico |
|---|---|---|
| `owner` | Dueño del sistema. Protegido: no se puede degradar ni borrar desde la interfaz | Todo |
| `admin` | Administración general, cierres administrativos, usuarios | Todo |
| `supervisor` | Supervisión operativa y acceso al tablero ejecutivo | Multi-sucursal |
| `jefe_logistica` | Planificación de viajes, consolidación, asignación de choferes | Logística |
| `branch_manager` | Encargado de sucursal: pide, acepta, recibe | Su sucursal |
| `branch_operator` | Operador de sucursal: carga pedidos y recibe mercadería | Su sucursal |
| `warehouse_operator` | Depósito: preparación, picking, bultos, etiquetas | Su depósito |
| `driver` | Chofer: retira, transporta, entrega, rinde | Sus viajes |
| `collector` | Cobrador: gestión de documentos y cobranzas | Cartera asignada |
| `salesperson` | Vendedor: catálogo, clientes, pre-venta | Su cartera |
| `viewer` | Sólo lectura | Según sucursal |

El acceso a datos no depende sólo del rol sino también de la sucursal: `profile_branch_access` lista las sucursales habilitadas y `profiles.all_branches_access` habilita todas. La función `can_access_branch` combina ambas cosas y es la base de casi todas las políticas de seguridad.

### Principio de diseño: paneles contextuales, no silos por rol

MoviLog evita tener una pantalla distinta por cargo. La cola operativa del panel principal es una sola y se arma por **participación**: aparece lo que a vos te toca, sea porque sos el origen, el destino, el chofer asignado o el responsable comercial. La lectura siempre se presenta como "De: origen / Para: destino" para que cualquiera entienda el contexto sin conocer la jerga interna.


---

# Parte II — Módulos

## Panel Operativo Unificado

### Propósito y por qué existe
`src/pages/Index.tsx` es la pantalla de aterrizaje (`/`) de MoviLog. Antes de esta unificación, un usuario operativo tenía que revisar por separado sus pedidos, sus consultas de disponibilidad y sus tareas de logística (preparar, despachar, recepcionar) para saber qué hacer primero. El Panel Operativo Unificado resuelve ese problema construyendo una **cola de trabajo única** ("cola operativa") que mezcla tres tipos de ítems heterogéneos —pedidos, consultas y tareas de fulfillment— y los ordena por urgencia real (SLA vencido) en vez de por fecha de creación simple. El título de la página cambia según el rol (`Panel de Seguimiento`, `Panel Logístico`, `Panel del Chofer`, `Mi Panel Operativo`) para comunicar que el contenido está filtrado según lo que cada actor puede/debe accionar.

### Flujo paso a paso
1. Se determina el rol operativo del usuario (`isDriver`, `isLogisticsOp`, `isAdmin`, `isViewer`) vía `useAuth().hasRole` y `useUserBranchFilter()` (sucursales permitidas / `isAllBranches`).
2. Se disparan tres queries en paralelo con React Query, cada una con `refetchInterval` de 60s y `refetchOnWindowFocus`:
   - `dashboard-pending`: `branch_requests` con estado en `DASHBOARD_PENDING_REQUEST_STATUSES`, `is_pre_sale = false`, filtrado por sucursales permitidas u `operational_responsible_id` del usuario.
   - `dashboard-fulfillments`: `fulfillment_orders` con estado fuera de `FULFILLMENT_TERMINAL_STATUSES`, filtrado por sucursal origen/destino o por `current_custody_holder_id` (el chofer que tiene la mercadería en custodia).
   - `dashboard-consultations`: `availability_consultations` en estado `open` o `responded`, con sus `consultation_targets`.
3. Se descartan los "pedidos padre" multi-origen (`useParentRequestIds`) para no duplicar entradas cuando un pedido se fracciona en varios `fulfillment_orders`.
4. Cada registro se transforma en un `QueueItem` homogéneo con: tipo (`pedido` | `consulta` | `tarea`), prioridad calculada, ruta (`De: X → Para: Y`), y una acción de navegación (`navigateTo`).
5. Para las tareas de fulfillment, `getTaskKind()` decide qué acción corresponde según el estado del envío y el rol relacional del usuario con esa operación (origen, destino, custodio o admin): `preparar`, `despachar`, `retirar`, `en_transito`, `recepcionar`, `entregar`.
6. Todos los ítems se ordenan primero por prioridad, luego (para operadores logísticos) por tipo de tarea, y finalmente por antigüedad.
7. La UI agrupa visualmente en tres secciones: "Requiere atención inmediata", "Para hoy", "En curso", y añade una sub-agrupación opcional por tipo de acción (preparar/despachar/gestionar/consulta) cuando el usuario no es admin/viewer/chofer y la sección tiene 3+ ítems.
8. Se calcula un bloque separado "Pedidos con cliente" (pickup/delivery/encomienda con evidencia real de cliente) que puede filtrarse con un clic.
9. Los KPIs de cabecera actúan como filtros rápidos sobre la misma cola (clic para activar/desactivar).
10. Un indicador "Actualizado hace Xs/m" con botón de refresco manual invalida las tres queries `dashboard-*` a demanda.

### Reglas de negocio de priorización
| Prioridad | Condición | Color / Badge |
|---|---|---|
| `overdue_critical` | Más de 48h desde `created_at` | Rojo — "Crítico" |
| `overdue` | Más de 24h desde `created_at` | Naranja — "Atrasado" |
| `today` | Más de 18h (75% de 24h) o creado el mismo día calendario | Amarillo — "Hoy" |
| `normal` | Resto | Gris — "Normal" |

Constantes: `SLA_HOURS = 24`, `CRITICAL_HOURS = 48`. Este SLA se aplica por igual a pedidos, consultas y tareas usando su `created_at` respectivo (no distingue tipo de operación).

### Clasificación de modo de pedido (`classifyOrderMode`)
| Regla | Resultado |
|---|---|
| `delivery_target = "branch"` y `shipping_method = "courier"` | `encomienda` (transferencia entre sucursales por transportista) |
| `delivery_target = "branch"` y cualquier otro método | `reposicion` (traslado interno) |
| `delivery_target = "client"` (o vacío) y `shipping_method = "pickup"` | `pickup` |
| `delivery_target = "client"` y `shipping_method = "courier"` | `encomienda` |
| `delivery_target = "client"` y `shipping_method = "delivery"` (o sin método) | `delivery` |

La prioridad 1 siempre es el destino (sucursal vs cliente): un pedido a sucursal nunca se clasifica como pickup/delivery al cliente aunque el campo legacy `shipping_method` lo sugiera. "Pedidos con cliente" solo incluye ítems con `hasClientEvidence` verdadera (nombre, dirección o `delivery_target` distinto de sucursal/vacío).

### Cálculo de KPIs de cabecera
| KPI | Fuente | Cálculo |
|---|---|---|
| Atrasados | `queueItems` | Cuenta ítems con prioridad `overdue` u `overdue_critical` |
| Urgentes hoy | `queueItems` | Cuenta ítems con prioridad `today` |
| En curso | `queueItems` | Total de ítems visibles en la cola (`activeCount`) |
| Pend. recepción | `queueItems` / fallback `activeFulfillments` | Ítems tipo tarea con `taskKind = recepcionar`, o fallback contando fulfillments en `delivered`/`pending_physical_confirmation` |

### Determinación de `taskKind` (tareas de fulfillment)
| Rol del usuario | Estado del `fulfillment_order` | `taskKind` |
|---|---|---|
| Custodio o admin | `in_transit` | `en_transito` |
| Custodio o admin | `delivery_failed` | `entregar` |
| Custodio o admin | `dispatched` / `at_hub` | `retirar` |
| Sucursal origen o admin | `pending` / `picking` | `preparar` |
| Sucursal origen o admin | `waiting_for_cut` / `waiting_for_courier` | `despachar` |
| Sucursal destino o admin | `delivered` / `pending_physical_confirmation` | `recepcionar` |

### Tablas y datos usados
`branch_requests`, `fulfillment_orders`, `availability_consultations`, `consultation_targets`, `branches` (para nombres de sucursal), más los hooks `useParentRequestIds` (para excluir pedidos padre) y `useUserBranchFilter` (control de alcance por sucursal). No hay RPC/edge functions propias de esta pantalla; toda la lógica de agregación ocurre en el cliente sobre datos ya filtrados por RLS.

### Permisos
El filtrado real de seguridad ocurre en RLS de Supabase (las consultas solo devuelven filas visibles para el usuario). En el cliente, `isAllBranches` (visión global: owner, admin, supervisor o `jefe_logistica`) evita aplicar el filtro `.or()` de sucursales; en caso contrario se restringe a `allowedBranchIds` más registros donde el usuario es responsable operativo o custodio actual. `isViewer` (roles `viewer`/`auditor`) solo puede "Ver", no tiene botones de acción rápida ni accesos de creación de pedido/consulta.

### Archivos relevantes
- `src/pages/Index.tsx` (lógica y UI completa)
- `src/hooks/use-parent-request-ids.ts`
- `src/hooks/use-user-access.ts` (`useUserBranchFilter`)
- `src/lib/request-status.ts` (`DASHBOARD_PENDING_REQUEST_STATUSES`, `FULFILLMENT_TERMINAL_STATUSES`)
- `src/lib/constants.ts` (`REQUEST_STATUS_CONFIG`)
- `src/components/StatusBadge.tsx`

## Dashboard Ejecutivo

### Propósito y por qué existe
`src/pages/DashboardEjecutivo.tsx` es la vista gerencial de MoviLog: agrega la operación completa (no la cola personal de un usuario) para responder tres preguntas ejecutivas: ¿cómo está la salud general de la operación?, ¿qué está roto ahora mismo? y ¿cómo evoluciona cada sucursal/etapa del proceso? A diferencia del Panel Operativo, acá el usuario no gestiona tareas individuales; consume KPIs, embudos, tiempos de ciclo y alertas agregadas, con filtros de rango de fecha y sucursal, y puede pedir un diagnóstico narrativo generado por IA.

### Control de acceso a la pantalla
El componente exporta un guard implícito: si el usuario no es admin (`isAllBranches`, `isOwner`, `admin`, `supervisor` o `jefe_logistica`), se redirige con `<Navigate>` fuera de esta pantalla (patrón visto en el import de `Navigate` de `react-router-dom` al inicio del archivo). Es decir, es una vista exclusiva de roles de dirección/logística central.

### Flujo paso a paso
1. El usuario elige un rango de fechas (`today`, `yesterday`, `7d`, `30d`, `this_month`, `custom`) y opcionalmente una sucursal (`useBranches`).
2. Se disparan en paralelo los hooks de `use-executive-dashboard.ts`: KPIs, embudo operativo, alertas críticas, ítems accionables ("qué está roto ahora"), rendimiento por sucursal, adopción del sistema, incidencias por tipo y tiempos de ciclo.
3. El `HealthBanner` calcula un score 0-100 combinando cumplimiento, trazabilidad y penalización por alertas, salvo que ya exista un `healthScore` devuelto por IA.
4. El usuario puede pulsar "Analizar con IA" para invocar la edge function `executive-insights`, que devuelve un resumen narrativo, hallazgos, riesgos y recomendaciones en español, generados con un modelo de lenguaje (Gemini 2.5 Flash Lite vía Lovable AI Gateway).
5. El panel `BrokenNowPanel` (`useActionableItems`) muestra hasta 5 ítems por categoría: envíos sin documento BIMS, entregas demoradas >48h, anomalías de IA no reconocidas, y las 3 sucursales con peor cumplimiento.
6. El `FunnelChart` (`useOperationalFunnel`) dibuja el embudo Solicitudes → Aceptados → En preparación → Despachados → Entregados → Recibidos → Cerrados, resaltando el escalón con mayor caída porcentual (cuello de botella).
7. `CycleTimesPanel` (`useCycleTimes`) compara tiempos promedio de preparación, tránsito y ciclo total contra un SLA fijo, mostrando barra de progreso y semáforo.
8. Tablas de rendimiento por sucursal, adopción del sistema (uso real vs. omisión de pasos) e incidencias por tipo completan la vista.

### Cómo se calcula cada KPI

| KPI | Fórmula | Fuente |
|---|---|---|
| Solicitudes creadas (`reqCreated`) y su variación | Conteo de `branch_requests` (`is_pre_sale=false`) en el rango vs. período anterior equivalente | `branch_requests` |
| En preparación (`inPrep`) | `fulfillment_orders` con estado en `pending, picking, waiting_for_cut, waiting_for_courier` | `fulfillment_orders` |
| En tránsito (`inTransit`) | Estado en `in_transit, dispatched, at_hub` | `fulfillment_orders` |
| Entregados (`delivered`) | Estado en `delivered, received, completed` | `fulfillment_orders` |
| Incidencias abiertas (`openIncidents`) | `logistics_incidents` con estado no en `resolved, closed` | `logistics_incidents` |
| Cumplimiento (`compliance`) | `delivered / totalFulfillments activos * 100` (excluye `cancelled`) | `fulfillment_orders` |
| Trazabilidad completa (`fullTraceability`) | De los envíos en estados avanzados (`dispatched, in_transit, delivered, received, completed, at_hub, delivery_failed`), % que tiene número BIMS (transferencia o factura) Y `dispatched_at` cargado | `fulfillment_orders` |
| Operaciones con alerta (`opsWithAlerts`) | Envíos activos que aparecen como entidad afectada en alguna `ai_anomalies` no reconocida (deduplicado por id) | `fulfillment_orders` + `ai_anomalies` |
| Health Score (Health Banner) | `compliance*0.4 + traceability*0.4 + (100 - min(totalAlertas*3, 30))*0.2`, redondeado y acotado a [0,100]; se sobreescribe si la IA devuelve `healthScore` | Cálculo local o `executive-insights` |

Niveles de salud: `>=85` saludable (verde), `>=60` alerta (amarillo), `<60` crítico (rojo).

### Embudo operativo y bottleneck
El embudo cuenta, sobre el total histórico (no limitado al rango de fecha seleccionado), 7 etapas: Solicitudes, Aceptados (`status` distinto de `pending`/`rejected`), En preparación, Despachados (incluye `delivery_failed`), Entregados, Recibidos, Cerrados. El "cuello de botella" (`bottleneckIdx`) es el escalón consecutivo con mayor porcentaje de caída respecto al anterior; se resalta visualmente con anillo rojo y aparece con `⚠` en el label.

### Tiempos de ciclo y SLA
| Etapa | Cálculo (promedio en horas) | SLA objetivo |
|---|---|---|
| Preparación | `dispatched_at - created_at` del fulfillment | 24h |
| Tránsito | `received_at_branch - dispatched_at` | 48h |
| Ciclo total | `received_at_branch - created_at` | 96h |

Solo se consideran fulfillments con `dispatched_at` no nulo (y, para tránsito/ciclo total, también `received_at_branch` no nulo). Adicionalmente se calcula `reqToAcceptance` (de `branch_requests.created_at` a `accepted_at`), sin SLA definido en el código (no se muestra semáforo para esa métrica en el panel visto).

### Alertas críticas (`useCriticalAlerts`)
| Alerta | Condición |
|---|---|
| `staleRequests` | `branch_requests` en `pending` con `created_at` anterior a hace 24h |
| `noBims` | `fulfillment_orders` en estados operativos activos (`pending`…`in_transit`) sin `bims_transfer_number` ni `bims_invoice_number` |
| `openIncidents` | `logistics_incidents` no `resolved`/`closed` |
| `anomalies` | `ai_anomalies` con `is_acknowledged = false`, deduplicadas contra `noBims` cuando la anomalía solo referencia entidades ya listadas ahí |
| `failedDeliveries` | `fulfillment_orders` con `status = delivery_failed` |

### Adopción del sistema (`useSystemAdoption`)
Mide uso real de la trazabilidad digital: usuarios activos (triggers en `operational_events`), % con documentación BIMS, % con entrega confirmada, % con recepción confirmada, % con flujo completo (BIMS + despacho + estado final + recepción), y estima operaciones "fuera de sistema" (llegaron a estado entregado/recibido sin registrar despacho ni recepción formal) y "pasos omitidos" (marcadas como entregadas sin `dispatched_at`).

### Rendimiento por sucursal (`useBranchPerformance`)
Por cada sucursal activa: cantidad de solicitudes y fulfillments asociados (como origen o destino), incidencias en el rango, y `compliance` (mismo cálculo que el KPI global pero acotado a esa sucursal). Se ordena de mayor a menor cumplimiento.

### Tablas usadas
`branch_requests`, `fulfillment_orders`, `logistics_incidents`, `ai_anomalies`, `branches`, `operational_events`, `profiles`.

### Edge function
`supabase/functions/executive-insights/index.ts`: recibe `kpis`, `alerts`, `adoption`, `branchPerformance` desde el cliente, arma un prompt en español y llama a `ai.gateway.lovable.dev` (modelo `google/gemini-2.5-flash-lite`, `temperature: 0.3`, `max_tokens: 800`) usando el secreto `LOVABLE_API_KEY`. Devuelve JSON con `healthScore`, `healthLabel`, `summary`, `findings`, `risks`, `recommendations`. No persiste nada en base de datos; es puramente de lectura/inferencia. Si la clave no está configurada o el gateway falla, responde error 500 con `healthScore: null`, y el cliente sigue usando el score calculado localmente como respaldo.

### Permisos
Acceso restringido a roles de dirección/logística (ver guard arriba). La invocación de la edge function usa el JWT del usuario autenticado (llamada vía `supabase.functions.invoke`), pero la función en sí no valida rol server-side más allá de requerir la presencia de `LOVABLE_API_KEY`; el control de acceso real está en el guard de React Router de la página. Todas las consultas de datos respetan RLS de las tablas subyacentes.

### Archivos relevantes
- `src/pages/DashboardEjecutivo.tsx`
- `src/hooks/use-executive-dashboard.ts`
- `supabase/functions/executive-insights/index.ts`
- `src/hooks/use-branches.ts`

## Consultas de Disponibilidad

### Propósito y por qué existe
El módulo de Consultas (`src/pages/Consultas.tsx`, ruta `/consultas`) resuelve un problema muy concreto de multi-sucursal: antes de generar un pedido de traslado, una sucursal necesita saber si otra tiene stock disponible de un producto específico, en qué cantidad y colores, y coordinar por chat esa negociación previa. En vez de mensajes sueltos por WhatsApp, la consulta queda registrada, vinculada a productos concretos, con respuestas estructuradas por sucursal destino, y puede derivar directamente en un pedido real (`branch_requests`) sin perder la trazabilidad del origen de la negociación.

### Modelo de datos
- `availability_consultations`: cabecera (sucursal solicitante, creador, estado, `auto_close_at`).
- `consultation_products`: productos incluidos en la consulta.
- `consultation_targets`: una fila por cada sucursal consultada, con su respuesta (`response_quantity`, `response_colors`, `response_note`, `responded_by`, `responded_at`).
- `consultation_messages`: chat asociado a la consulta.
- `consultation_requests`: vínculo entre la consulta y los `branch_requests` (pedidos) que se generaron a partir de ella.

Estados de `availability_consultations`: `open`, `responded`, `converted`, `expired` (más `closed` contemplado en configuraciones de UI aunque no se ve como resultado directo de una transición automática en el código revisado).

### Flujo paso a paso
1. **Creación**: el usuario elige su sucursal (auto-detectada o manual si tiene permiso `canChangeBranch`), busca productos con `ProductSearch`, y para cada producto selecciona una o más sucursales origen candidatas (`toggleProductBranch`). El formulario exige que todos los productos tengan al menos una sucursal asociada (`allProductsHaveSource`).
2. Al enviar, el cliente hace un preflight de autenticación (compara `user.id` del contexto contra `session.user.id` real) para detectar sesiones desincronizadas y registra diagnósticos en `diagnostic_logs` ante cualquier error (auth mismatch, error en insert de consulta, productos o targets), facilitando soporte técnico.
3. Se crea **una consulta separada por cada sucursal destino** (`derivedTargetBranches`): inserta `availability_consultations`, sus `consultation_products` (solo los productos que corresponden a esa sucursal) y un único `consultation_targets`. Si hay mensaje inicial, se inserta también en `consultation_messages`.
4. **Listado** (`Consultas.tsx` principal): paginación server-side (`usePaginatedQuery`) sobre `availability_consultations` filtrado por estado (tabs "Activas" = open+responded, "Pendientes" = open, "Respondidas" = responded), con un segundo query de enriquecimiento que trae productos, conteo de pedidos vinculados y respuestas/target branches solo de la página visible.
5. **Respuesta**: la sucursal consultada abre el detalle y usa `TargetResponseForm`, que llama al RPC `fn_respond_consultation_target` con cantidad, colores y nota. El RPC valida permisos, bloquea la fila (`FOR UPDATE`), valida que la consulta siga activa, guarda la respuesta y, si es la primera respuesta de la consulta, cambia el estado global a `responded`.
6. **Chat**: cualquier participante autorizado (creador, sucursal solicitante, sucursal consultada, o admin/supervisor/owner) puede enviar mensajes mientras la consulta está `open`/`responded`.
7. **Conversión a pedido**: desde el detalle, el botón "Crear pedido desde esta consulta" navega a `/solicitudes?from_consultation=<id>`, que crea un `branch_request` real (la vinculación queda en `consultation_requests`, visible en la sección "Pedidos creados" del detalle).
8. **Cierre manual**: el creador de la consulta puede marcarla como `converted` directamente actualizando el estado.
9. **Cierre automático por expiración**: el RPC `fn_close_expired_consultations` (pensado para ejecutarse por cron/scheduler) cambia a `expired` toda consulta en `open`/`responded` cuyo `auto_close_at` ya pasó. No se encontró en el código de frontend revisado una invocación directa de este RPC; se asume que corre como job programado en Supabase (pg_cron) fuera del alcance de este documento de frontend.

### Reglas de negocio clave
- Una consulta multi-sucursal en la UI se traduce en **N consultas independientes** en base, una por sucursal destino, cada una con estado propio. Esto significa que la "conversión" y el "cierre" son por sucursal, no globales para el conjunto original.
- Solo puede responder por una sucursal consultada un usuario que tenga acceso a esa sucursal (`can_access_branch`) o sea admin/supervisor/owner.
- Una consulta deja de aceptar respuestas si su estado no es `open` ni `responded` (el RPC lo valida explícitamente y lanza excepción).
- Re-responder está permitido: `fn_respond_consultation_target` hace `UPDATE`, no crea histórico de respuestas; la última respuesta pisa la anterior.
- El estado pasa automáticamente de `open` a `responded` en cuanto **al menos un** target respondió (no espera que respondan todas las sucursales consultadas).

### RPCs y funciones SQL
| Función | Tipo | Rol / seguridad | Qué hace |
|---|---|---|---|
| `fn_can_view_consultation(_user_id, _consultation_id)` | `STABLE SECURITY DEFINER` | Usada en políticas RLS | Devuelve `true` si el usuario es admin/supervisor/owner, es el creador, pertenece a la sucursal solicitante, o pertenece a alguna sucursal consultada (target) |
| `fn_respond_consultation_target(p_target_id, p_quantity, p_colors, p_note)` | `SECURITY DEFINER`, invocada por RPC desde el cliente | Requiere pertenecer a la sucursal del target o ser admin/supervisor/owner | Bloquea la fila, valida que la consulta siga activa, guarda la respuesta y auto-promueve el estado de la consulta a `responded` |
| `fn_close_expired_consultations()` | `SECURITY DEFINER` | Pensada para ejecución programada (no vista invocada desde frontend) | Marca como `expired` las consultas vencidas según `auto_close_at` |

### Permisos (RLS)
- **Ver** consulta/targets/productos/mensajes: `fn_can_view_consultation` (creador, sucursal solicitante, sucursal target, o rol admin/supervisor/owner).
- **Actualizar** cabecera de consulta: solo el creador o admin/supervisor/owner.
- **Insertar** targets/productos: solo el creador de la consulta o admin/owner.
- **Actualizar** un target (registrar respuesta): solo usuarios de la sucursal de ese target, o admin/owner (reforzado también a nivel de función con `SECURITY DEFINER`).
- **Enviar mensajes**: el remitente debe ser él mismo (`sender_id = auth.uid()`) y tener visibilidad de la consulta, o ser admin/supervisor/owner.
- **Insertar `consultation_requests`** (vínculo con pedido creado): cualquiera que pueda ver la consulta.

### Archivos relevantes
- `src/pages/Consultas.tsx` (listado, formulario de creación, formulario de respuesta, detalle con chat)
- `src/components/shared/ProductSearch.tsx`, `src/components/shared/ProductCard.tsx`
- `src/components/solicitudes/DemandAlert.tsx`
- `src/hooks/use-live-stock.ts`, `src/hooks/use-paginated-query.ts`
- `src/components/shared/BranchSelector.tsx` (`useAutoDetectBranch`)
- Migraciones SQL: `supabase/migrations/20260412015608_*.sql`, `20260412020613_*.sql`, `20260813183839_*.sql`

## Alertas y Excepciones

### Propósito y por qué existe
`src/pages/Alertas.tsx` (ruta `/alertas`) es la bandeja de entrada de anomalías detectadas automáticamente por el sistema (tabla `ai_anomalies`). Existe para separar "lo que cada actor necesita ver" en función de a quién le corresponde actuar: un operador de sucursal no debería ver decisiones que le competen solo a logística central, y viceversa. Por eso la pantalla no muestra una lista única, sino **tres bandejas mutuamente excluyentes** según el campo `alert_level`.

### Flujo paso a paso
1. Se seleccionan pestañas (`Tabs`) correspondientes a `alert_level`: `branch_operational`, `escalable`, `logistics_admin_decision`. Por defecto se abre `branch_operational`.
2. Al cambiar de tab se dispara una query (`["anomalies", tab]`) que trae hasta 50 registros de `ai_anomalies` filtrados por `alert_level = tab`, con el `branch` relacionado, ordenados por `created_at` descendente.
3. Cada alerta se pinta con un estilo de severidad (`critical`, `warning`, `info`) que define color de borde, chip y punto de estado.
4. Si la alerta no está reconocida (`is_acknowledged = false`), se muestran dos acciones: "Reconocer" (resolución manual) y "Resuelta auto" (para casos donde el problema ya se resolvió sin intervención directa registrable, p. ej. el sistema detectó que el dato faltante finalmente se completó).
5. Al reconocer, se actualiza `ai_anomalies` con `is_acknowledged = true`, `acknowledged_by`, `acknowledged_at`, y se guarda el tipo de resolución (`resolution_type: resolved_manual | resolved_auto`) dentro del campo JSON `supporting_data`, preservando el resto de su contenido existente.
6. Las alertas reconocidas quedan visibles pero atenuadas (`opacity-60`) con un badge indicando si fueron resueltas manual o automáticamente, en vez de desaparecer de la lista (hasta el límite de 50 registros).
7. El contador de "pendientes" en el encabezado de la tarjeta cuenta las alertas no reconocidas de la bandeja actualmente seleccionada.

### Niveles de alerta y su propósito
| `alert_level` | Label en UI | A quién le corresponde |
|---|---|---|
| `branch_operational` | Operativa Sucursal | Problemas que la propia sucursal puede resolver en el día a día |
| `escalable` | Escalable | Situaciones que requieren coordinación entre sucursales o seguimiento más cercano |
| `logistics_admin_decision` | Decisión logística/admin | Casos que requieren intervención de logística central o administración |

Esta clasificación (`alert_level`) es un atributo de la anomalía generada por el motor de detección (fuera del alcance de este documento de frontend: se asume calculado al insertar en `ai_anomalies`, probablemente por un job/trigger de análisis de anomalías no revisado en detalle aquí). El frontend solo consume y filtra por ese campo, no lo calcula.

### Severidad visual
| `severity` | Estilo | Significado |
|---|---|---|
| `critical` | Rojo, borde izquierdo destacado | Requiere atención inmediata |
| `warning` | Amarillo | Advertencia, seguimiento recomendado |
| `info` | Celeste | Informativa, sin urgencia |

Si `severity` no coincide con ninguna de las tres claves, se usa `info` como valor por defecto (fallback definido en el propio diccionario `SEVERITY_STYLES`).

### Reglas de negocio
- Una anomalía puede marcarse como recurrente (`is_recurring`) mostrando un contador `occurrence_count`, indicando que el mismo patrón se detectó varias veces (útil para priorizar problemas sistémicos vs. puntuales).
- El reconocimiento es una acción irreversible desde la UI: no hay botón para "des-reconocer" una alerta ya marcada.
- No hay filtro de sucursal en esta pantalla más allá de lo que ya resuelve RLS; se listan hasta 50 alertas más recientes por bandeja, sin paginación.

### Tablas usadas
`ai_anomalies` (incluye columnas `alert_level`, `severity`, `title`, `description`, `is_acknowledged`, `acknowledged_by`, `acknowledged_at`, `is_recurring`, `occurrence_count`, `supporting_data`, `branch_id`, `affected_entities`) y `branches` (join para mostrar nombre/código de sucursal).

Nota de consistencia: esta misma tabla `ai_anomalies` es la fuente de las "anomalías" que aparecen también en el Dashboard Ejecutivo (`useCriticalAlerts`, `useActionableItems`) y en el conteo de "operaciones con alerta" del panel ejecutivo — son la misma señal de origen, consumida desde dos vistas con propósitos distintos (bandeja operativa de resolución vs. panel agregado de salud).

### Permisos
No se observó en el archivo ninguna restricción de rol explícita a nivel de componente (no hay guard de `<Navigate>` como en el Dashboard Ejecutivo); el control de qué anomalías puede ver y reconocer cada usuario depende enteramente de las políticas RLS de `ai_anomalies` (no incluidas en el alcance de archivos revisados para esta sección, por lo que no se documenta su detalle exacto aquí — se recomienda confirmarlas en una revisión de RLS específica de `ai_anomalies` si se necesita precisión total).

### Archivos relevantes
- `src/pages/Alertas.tsx`
- `src/lib/constants.ts` (`ALERT_LEVEL_LABELS`)

## Solicitudes y Pedidos

El módulo "Solicitudes y Pedidos" (ruta `/solicitudes`, página `src/pages/Solicitudes.tsx`) es la bandeja operativa central de MoviLog: administra el ciclo de vida completo de una solicitud de mercadería, desde su creación (reposición interna, pedido a cliente, pedido online o pre-venta comercial) hasta su cierre logístico y administrativo. Todo el dominio gira alrededor de la tabla `branch_requests` (una fila por "pedido") y su tabla de líneas `branch_request_items`.

Este documento cubre exclusivamente lo verificado en el código de:
- `src/pages/Solicitudes.tsx`
- `src/components/solicitudes/*.tsx`
- `src/lib/branch-requests-query.ts`, `src/lib/request-status.ts`, `src/lib/business-rules.ts`
- `src/hooks/use-supply-resolution.ts`, `use-solicitudes-integrity.ts`, `use-parent-request-ids.ts`

No se tuvo acceso a herramientas de consulta directa a la base de datos en esta sesión; las referencias a columnas, RPC y triggers provienen de lo que el código frontend efectivamente invoca y comenta (incluidos comentarios explícitos del equipo sobre el comportamiento del backend).

### Modelo de datos base

La tabla `branch_requests` es la entidad central. Columnas confirmadas por `REQUEST_COLUMNS` en `src/lib/branch-requests-query.ts` (lista blanca usada por el módulo, deliberadamente excluye `client_phone`/`client_email` por ser PII):

`id, request_number, request_type, requesting_branch_id, source_branch_id, shipping_method, shipping_paid_by, shipping_cost, bims_invoice_number, bims_sale_reference, client_name, client_address, status, current_custody_holder_id, current_location_branch_id, expected_next_event, expected_next_event_deadline, priority, notes, created_by, accepted_by, accepted_at, rejected_by, rejected_at, rejection_reason, closed_by, closed_at, created_at, updated_at, rejection_reason_type, logistic_closed_at, logistic_closed_by, admin_closed_at, admin_closed_by, shipping_origin_paid, shipping_destination_paid, delivery_target, delivery_payer, parent_request_id, courier_billing_mode, operational_responsible_id, attached_file_path, flow_type, consolidation_override, is_pre_sale, pre_sale_status, sales_channel, pre_sale_confirmed_at, pre_sale_sent_at, pre_sale_pdf_generated_at, converted_to_request_id, created_from_presale_id, converted_at, converted_by_user_id, commercial_terms, client_uuid`.

El teléfono/email del cliente se obtiene aparte, vía la función RPC `fn_get_request_client_contact(p_request_id)`, reservada a usuarios autorizados (`fetchRequestClientContact`).

Tablas relacionadas usadas activamente por el módulo:
- `branch_request_items`: líneas del pedido (`product_id`, `quantity_requested`, `local_supply_qty`, `item_purpose`, y campos de cliente por línea).
- `request_bims_documents`: documentos BIMS vinculados (facturas/transferencias).
- `operational_events`: bitácora de eventos operativos (usada para reconstruir el historial y para detectar `supply_resolution_committed`).
- `fulfillment_orders`: órdenes de despacho asociadas al pedido.
- `trips`: viajes de distribución, usados al asignar un pedido interurbano.
- `profiles`, `user_roles`, `profile_branch_access`: resolución de responsables operativos y permisos por sucursal.
- `branches`: catálogo de sucursales (nombre, código, `logistic_group`, `is_central_warehouse`).
- `availability_consultations` / `consultation_products` / `consultation_targets` / `consultation_requests`: integración con el módulo de Consultas (precarga de un pedido a partir de una consulta de disponibilidad ya respondida).

`src/lib/branch-requests-query.ts` documenta tres "modos de acceso" reutilizables como helpers:
- `operationalRequests()`: excluye pre-ventas en borrador (`is_pre_sale=false`). Uso general en módulos operativos.
- `operationalLogisticsRequests()`: además excluye los estados de abastecimiento (`in_supply`, `supplied`), para módulos puramente logísticos (ruteo, chofer, consolidación) donde el pedido todavía no debe ser visible.
- `allRequests()`: acceso completo, incluye pre-ventas — reservado a Solicitudes/Administración.
- `preSaleRequests()`: solo pre-ventas.

Esta separación existe porque **las pre-ventas online son borradores comerciales sin operación logística asociada** y no deben "contaminar" dashboards, ruteo ni cumplimiento hasta que se conviertan explícitamente en un pedido real.

### Estados del pedido

`src/lib/request-status.ts` es la fuente única de verdad de qué estados se consideran "activos" (requieren seguimiento) y cuáles "cerrados" (históricos). El comentario del archivo advierte explícitamente que duplicar esta lista en otros módulos causó una regresión de producción (#306/#307: pedidos que desaparecían de la bandeja operativa aunque seguían activos), por eso todo módulo que necesite esta distinción debe importar desde acá.

| Estado | Grupo | Notas |
|---|---|---|
| `in_supply` | Activo | Fase de resolución de abastecimiento (Fase 5A) |
| `supplied` | Activo | Abastecido; pendiente de "Iniciar operación" |
| `pending` | Activo | Pedido creado, esperando aceptación del origen |
| `accepted` | Activo (legacy) | Paso intermedio; hoy se encadena automáticamente a `in_preparation` |
| `in_preparation` | Activo | En preparación en la sucursal origen |
| `ready_for_pickup` | Activo | Listo para que el chofer retire (flujos urbano/interurbano) |
| `ready_for_delivery` | Activo | Listo para entrega directa a cliente (flujo `client_delivery`) |
| `in_consolidation` | Activo | En consolidación de carga (flujo interurbano) |
| `assigned_to_trip` | Activo | Asignado a un viaje |
| `in_transit` | Activo | En tránsito |
| `delivered` | Activo | Entregado (pendiente confirmación de recepción) |
| `delivered_to_third_party` | Activo | Entregado directo a cliente/tercero |
| `picking` / `dispatched` | Activo (legacy) | Estados históricos previos a la migración de flujos |
| `received` | Cerrado | Recepción confirmada por destino |
| `logistic_closed` | Cerrado | Cierre logístico |
| `closed` | Cerrado | Cierre administrativo final |
| `rejected` | Cerrado | Rechazado por el origen o por rollback de creación |

Adicionalmente existe `DASHBOARD_PENDING_REQUEST_STATUSES` (subconjunto de activos usado para la "cola pendiente" del Dashboard) y `FULFILLMENT_TERMINAL_STATUSES` para `fulfillment_orders`.

### Reglas de negocio de origen/destino (`business-rules.ts`)

El archivo `src/lib/business-rules.ts` documenta la "matriz de negocio" que decide, en función de `request_type` (`reposition` | `client` | `online`) y `delivery_target` (`branch` | `client`), si el pedido es **mono-origen** o **multi-origen**:

| Tipo de solicitud | Destino sucursal | Destino cliente |
|---|---|---|
| Reposición | Multi-origen | No aplica (reposición solo permite destino sucursal) |
| Pedido cliente | Multi-origen | Mono-origen |
| Pedido online | Multi-origen | Mono-origen |

Regla explícita: **si la entrega involucra a un cliente final (facturación/despacho), se fuerza mono-origen**. Esta misma regla se valida tanto en frontend (`SolicitudCreateForm`, Consultas) como en el trigger de base de datos `fn_validate_business_rules` (mencionado en el comentario de cabecera del archivo como validación espejo en backend).

Otras validaciones de la matriz:
- `validateShippingMethod`: `delivery` y `pickup` no son válidos para reposición con destino sucursal.
- `requiresShippingCost`: el costo de envío es obligatorio si el método es `delivery`, o si es `courier` con modalidad `on_invoice`.
- `getDemandSeverity`: clasifica la demanda concurrente de un producto en baja (1-2 solicitudes abiertas), media (3-4) o alta (5+); es puramente informativa, no bloquea ni reserva stock.
- Sección de reglas de stock (documentada como comentario formal): el stock mostrado en pantalla es siempre referencial (snapshot de la última sincronización BIMS); antes de persistir cualquier pedido el sistema **debe** revalidar contra stock fresco (`revalidateStock`/`revalidateLiveStock`). En esta etapa del MVP no hay stock comprometido ni reservas automáticas, solo verificación de suficiencia al momento de confirmar.
- Estrategia de rollback documentada: la creación multi-origen **no usa una transacción de base de datos real**, sino un patrón de compensación lógica: si falla la creación de un hijo, el padre y todos los hijos creados hasta ese punto se marcan como `rejected` con motivo explicativo, evitando huérfanos sin necesidad de atomicidad transaccional.

### Creación de solicitud (`SolicitudCreateForm.tsx`)

**Propósito**: formulario único para los cuatro tipos de alta operativa: Reposición, Pedido Cliente, Pedido Online y Pre-Venta Online. Existe para centralizar reglas de negocio (matriz origen/destino, validación de stock, splits multi-origen) en un solo componente reutilizado también desde "Iniciar operación" y desde el detalle de pre-venta.

**Por qué existe**: sin este formulario cada tipo de pedido tendría su propia lógica de validación, duplicando reglas de negocio y aumentando el riesgo de divergencia (el mismo problema que motivó centralizar `request-status.ts`).

**Flujo paso a paso**:
1. **Paso 1 — Contexto**: elegir sucursal solicitante (auto-detectada según el usuario), tipo de solicitud y destino (sucursal o cliente). El destino disponible depende de `getAllowedDeliveryTargets(requestType)`.
2. **Paso 2 — Productos**: búsqueda de producto (`ProductSearch`), carga manual o por Excel (solo habilitado en flujo de Pre-Venta dentro de este formulario), edición de cantidades. Al agregar un producto en modo multi-origen, el formulario auto-sugiere el origen con más stock (`stock_by_warehouse`).
3. **Paso 3 — Origen**: en modo mono-origen se elige una única sucursal origen global; en modo multi-origen cada producto puede tener su propio origen individual o dividirse entre varias sucursales mediante `SplitOriginPanel` (ver más abajo).
4. **Paso 4 — Logística** (`LogisticsFieldsForm`, componente compartido): método de envío, quién paga, modalidad de cobro de encomienda, monto de envío, datos de cliente (si aplica), responsable operativo (solo pedidos online) y notas.
5. **Confirmación**: antes de persistir, se revalida stock en vivo contra BIMS (`revalidateLiveStock`) y se bloquea el envío si algún producto quedó con stock insuficiente, mostrando el error por línea específica (no un mensaje genérico), cumpliendo la regla de negocio documentada en `business-rules.ts`.
6. **Persistencia**: 
   - Si hay un único origen real resultante (`uniqueSourceIds.length === 1`): inserta un único registro en `branch_requests` + sus líneas en `branch_request_items`.
   - Si hay dos o más orígenes reales (`uniqueSourceIds.length >= 2`): crea un **pedido padre** (ver sección Multi-origen) y un pedido hijo por cada sucursal origen.
   - Si el pedido proviene de una Consulta de disponibilidad (`fromConsultationId`), se vincula en `consultation_requests` y se marca la consulta como `converted`.

**Reglas y validaciones clave**:
- El tipo de solicitud determina campos visibles: reposición nunca muestra campos de cliente ni admite destino cliente.
- Al cambiar de multi a mono-origen se limpian los orígenes por producto; al revés se limpia el origen global.
- Splits válidos requieren al menos 2 sucursales con cantidad > 0 cuya suma sea exactamente igual a la cantidad solicitada del ítem; si la suma no coincide, el CTA de envío queda bloqueado con aviso visual.
- Import desde Excel: al agregar productos ya existentes en la lista, se suman las cantidades en vez de duplicar la línea.

**Tablas usadas**: `branch_requests`, `branch_request_items`, `consultation_requests`, `availability_consultations`, `products` (búsqueda), `profiles`/`user_roles`/`profile_branch_access` (para el selector de responsable operativo online).

**Archivos**: `SolicitudCreateForm.tsx`, `ContextBanner.tsx`, `DemandAlert.tsx`, `SplitOriginPanel.tsx`, `ExcelImport.tsx`, `LogisticsFieldsForm.tsx`, `business-rules.ts`.

### Pre-venta y su conversión a pedido

**Propósito operativo**: permitir a un vendedor armar una cotización comercial para un cliente (por WhatsApp, Instagram, Ecommerce, etc.) sin comprometer stock ni generar ninguna operación logística, hasta que el cliente confirme y se decida ejecutar la venta.

**Por qué existe**: separa la etapa comercial (negociación, cotización, envío de PDF) de la etapa operativa (reserva/abastecimiento/logística), evitando que pedidos "tentativos" contaminen los tableros operativos, el ruteo o los indicadores de cumplimiento.

**Modelo**: la pre-venta es una fila más de `branch_requests` con `is_pre_sale = true`. Vive exclusivamente en la bandeja "Pre-Ventas" del módulo Solicitudes; todos los demás módulos operativos la excluyen explícitamente (`operationalRequests()`).

**Campos comerciales propios**: `sales_channel` (whatsapp, ecommerce, instagram, tiktok, facebook, presencial), `commercial_terms`, `pre_sale_status` (`draft` | `confirmed` | `converted`, más `sent_to_operation` visto en el mapeo de etiquetas), `pre_sale_confirmed_at`, `pre_sale_sent_at`, `pre_sale_pdf_generated_at`, `converted_to_request_id`, `converted_at`, `converted_by_user_id`.

**Flujo paso a paso** (`PreSaleDetail.tsx`):
1. **Borrador (`draft`)**: se crea/edita libremente con `SolicitudCreateForm` en modo `defaultRequestType="pre_sale_online"`. En este modo se neutralizan los campos logísticos (no hay origen, no hay dirección obligatoria, no hay método de envío).
2. **Descargar PDF**: genera una cotización (`generatePreSalePdf`) y registra `pre_sale_pdf_generated_at`.
3. **"Cliente confirmó"**: marca `pre_sale_status = confirmed` y `pre_sale_confirmed_at`. Es reversible (al volver a editar, el estado vuelve a `draft` según el comentario de cabecera del componente).
4. **Convertir a pedido**: el operador elige la sucursal ejecutora (`convertExecBranchId`) y confirma. Se invoca el RPC `fn_send_presale_to_operation(p_request_id, p_requesting_branch_id)`, que:
   - Crea un **pedido operativo nuevo** (`request_type = online`) en estado `in_supply` (bandeja "En abastecimiento").
   - Dejar la pre-venta original en `pre_sale_status = converted`, con `converted_to_request_id` apuntando al pedido nuevo — la conversión es idempotente (no permite reconvertir).
5. Desde ese punto el pedido nuevo sigue el flujo normal de abastecimiento y operación (ver secciones siguientes).

**Reglas de negocio**: una pre-venta convertida no puede editarse ni reconvertirse; solo permite descargar el PDF y ver el link al pedido generado. El badge visual "AB Preventa" (ver sección de badges) se propaga a los pedidos internos generados durante el abastecimiento de un pedido nacido de una pre-venta, para preservar la prioridad comercial en toda la cadena.

**Tablas/RPC**: `branch_requests` (mismo registro, cambia de estado), RPC `fn_send_presale_to_operation`, `fn_get_request_client_contact` (para tel/email), `profiles` (nombre del vendedor).

**Archivos**: `PreSaleDetail.tsx`, `SolicitudCreateForm.tsx`, `RequestDetailRouter.tsx`, `CommercialBackedBadge.tsx`.

### Importación por Excel

**Propósito**: cargar masivamente líneas de producto/cantidad desde un archivo `.xlsx`/`.csv`, útil para reposiciones administrativas grandes o pre-ventas con muchos ítems, evitando la carga manual producto por producto.

**Dónde se usa**: dentro de `SolicitudCreateForm` (solo para Pre-Venta Online) y dentro de `AdminReposicionForm` (reposición administrativa, con pestaña "Desde Excel").

**Flujo paso a paso** (`ExcelImport.tsx`):
1. El usuario descarga una plantilla (`ExcelTemplate.ts`) con columnas `id`, `codigo`, `codigo_secundario`, `descripcion`, `cantidad`.
2. Sube el archivo; se valida tamaño (máx. 5 MB) y cantidad de filas (máx. 500).
3. Se detectan encabezados de forma tolerante a acentos/mayúsculas (`normalizeHeader`).
4. Se hace una consulta batch a `products` combinando `bims_code`, `barcode` y `sku`, con orden de confianza de matching: `id` (BIMS) → `codigo` contra `barcode`/`bims_code` → `codigo_secundario` contra `barcode` → `codigo` contra `sku` (fallback de menor confianza).
5. Cada fila se clasifica en un estado: `ok`, `duplicate_merged` (dos filas del mismo producto, cantidades sumadas), `not_found` o `invalid_qty`.
6. Se muestra una tabla de validación con badges por fila; el botón "Confirmar" solo se habilita si no hay filas con error (`errorCount === 0`).
7. Al confirmar, se entregan los ítems válidos al formulario padre vía `onConfirm`.

**Reglas de negocio**: no permite continuar si hay filas sin match de producto o con cantidad inválida (≤0 o no numérica); esto evita crear pedidos con datos corruptos por error de tipeo en el Excel.

**Tablas usadas**: `products` (lectura), `branch_requests`/`branch_request_items` (destino final, vía el formulario padre) y, en Reposición administrativa, `storage.request-attachments` (el archivo Excel original se sube y se referencia en `attached_file_path`).

**Archivos**: `ExcelImport.tsx`, `ExcelTemplate.ts`.

### Reposición administrativa dirigida (`AdminReposicionForm.tsx`)

**Propósito operativo**: permitir a administradores crear directamente una reposición entre dos sucursales específicas (origen → destino), sin pasar por el flujo genérico de creación (sin selección de tipo, sin matriz multi-origen), pensado para movimientos puntuales decididos "desde arriba".

**Por qué existe**: la reposición ordinaria vía `SolicitudCreateForm` fuerza multi-origen y pasa por reglas de negociación de origen por producto; este formulario cubre el caso simple y frecuente de "mover stock de la sucursal A a la B" con control administrativo directo, incluyendo carga masiva por Excel.

**Flujo paso a paso**:
1. Selección de sucursal origen y destino (con exclusión mutua: no pueden coincidir).
2. Notas opcionales.
3. Carga de productos: manual (`ProductSearch`) o vía Excel (`ExcelImport`).
4. Confirmación mediante `AlertDialog` (acción irreversible).
5. Al confirmar: inserta un único registro en `branch_requests` con `request_type = "reposition"`, `delivery_target = "branch"`, `shipping_method = "own_fleet"`, notas prefijadas con el tag `[Reposición administrativa]`, estado inicial `pending` explícito y prioridad `normal`. Inserta las líneas en `branch_request_items` con `item_purpose = "reposition"`. Si se usó Excel, sube el archivo original a `request-attachments` y guarda la ruta en `attached_file_path`.

**Reglas y validaciones**: origen y destino no pueden ser iguales; se requiere al menos un producto; si la subida del Excel falla, el pedido igual se crea (con aviso de advertencia, no error bloqueante).

**Permisos**: en `Solicitudes.tsx` este formulario solo se ofrece a usuarios con rol `admin` o `isOwner` (botón "Reposición admin.").

**Tablas usadas**: `branch_requests`, `branch_request_items`, storage `request-attachments`.

**Archivos**: `AdminReposicionForm.tsx`, `ExcelImport.tsx`.

### Multi-origen y pedido padre/hijo

**Propósito operativo**: permitir que una única solicitud de una sucursal se resuelva combinando stock de varias sucursales distintas, generando trazabilidad clara entre "lo que se pidió" y "de dónde salió cada unidad".

**Por qué existe**: en reposiciones y pedidos con destino sucursal, es común que ningún origen único tenga todo el stock requerido; el modelo padre/hijo evita forzar al usuario a crear pedidos separados manualmente y preserva un punto de consulta agregado.

**Modelo estructural**: 
- El **pedido padre** es un registro contenedor en `branch_requests` (no ejecuta acciones operativas por sí mismo). Se detecta de forma estructural: es padre si existe al menos una fila cuyo `parent_request_id` apunte a su `id` — esto lo calcula `useParentRequestIds()` (hook) y `ParentRequestSummary` para el detalle. El código deja explícito que la detección por texto en `notes` (`[Pedido padre multi-origen]`) es solo un fallback defensivo para datos legacy, **no la fuente de verdad**; usar solo el substring causó la regresión #306/#307 (un `NOT ILIKE` contra `notes = NULL` producía `NULL` y excluía filas sin notas).
- Cada **pedido hijo** referencia al padre vía `parent_request_id`, tiene su propia `source_branch_id` real (una por sucursal de origen) y sigue el ciclo de vida operativo normal e independiente.
- La FK `parent_request_id` es validada en backend por el trigger `fn_validate_business_rules` (todo hijo debe apuntar a un padre existente).
- El estado del padre se sincroniza automáticamente según el avance de los hijos mediante un trigger de base de datos (`tr_sync_parent_status`, según el comentario de `ParentRequestSummary.tsx`); el padre nunca se transiciona manualmente.

**Flujo de creación** (dentro de `SolicitudCreateForm`, función `onSubmit`):
1. Se "aplanan" los ítems: los que tienen splits válidos se explotan en N líneas (una por sucursal), los que no, conservan su origen único.
2. Se calculan los orígenes únicos reales de todas las líneas resultantes.
3. Si hay ≥2 orígenes: se inserta primero el padre (con `source_branch_id` como placeholder igual al `requesting_branch_id`, y notas con el tag `[Pedido padre multi-origen]`), luego se agrupan las líneas por sucursal origen y se crea un hijo por grupo, cada uno con sus propias líneas en `branch_request_items`.
4. **Rollback lógico**: si falla la creación de cualquier hijo, se marca el padre y todos los hijos ya creados como `rejected` con un motivo explicativo — no hay una transacción SQL real, es compensación aplicativa (documentado explícitamente en `business-rules.ts`).

**Visualización en la bandeja**: `Solicitudes.tsx` **oculta los padres** de todas las tablas operativas (usando el set de IDs padre real, vía FK) para no duplicar visualmente el mismo trabajo, ya que las acciones concretas ocurren en los hijos. Existe también la etiqueta legacy `isLegacySingleChildParent` para padres saneados que originalmente tenían un solo hijo.

**Búsqueda inteligente padre↔hijo**: si el usuario busca un número de pedido (`#N`), la bandeja resuelve automáticamente el conjunto relacionado completo (el propio + su padre + sus hermanos, o sus hijos si es padre) y lo muestra ignorando el resto de filtros de tab/estado/sucursal, permitiendo ubicar cualquier nodo de la cadena aunque el padre normalmente esté oculto.

**Vista de detalle del padre** (`ParentRequestSummary.tsx`): muestra el resumen de la solicitud original, contadores de avance (hijos cerrados/en curso) y el listado de hijos con acceso directo a cada uno; no ofrece ningún botón de acción operativa.

**Tablas/RPC**: `branch_requests` (self-referencia por `parent_request_id`), trigger `fn_validate_business_rules`, trigger `tr_sync_parent_status` (mencionado, sincroniza estado del padre).

**Archivos**: `SolicitudCreateForm.tsx`, `ParentRequestSummary.tsx`, `use-parent-request-ids.ts`, `SplitOriginPanel.tsx`, `Solicitudes.tsx`.

### Resolución de abastecimiento — Fase 5A (con abastecimiento parcial)

**Propósito operativo**: cuando un pedido queda en estado `in_supply`, el operador debe decidir, ítem por ítem, cuánto se cubre con stock local de la sucursal solicitante y cuánto se pide a otras sucursales (generando pedidos internos automáticos), aceptando también que el pedido continúe aunque no se cubra el 100% de lo solicitado (abastecimiento parcial).

**Por qué existe**: reemplaza el modelo anterior donde el abastecimiento debía resolverse 100% antes de avanzar; ahora el sistema registra explícitamente la "demanda no satisfecha" para análisis de compras y deja avanzar el pedido igual, evitando cuellos de botella operativos por falta de stock puntual.

**Flujo paso a paso** (`SupplyResolutionPanel.tsx` + `useSupplyResolution` + `SupplyCommitModal.tsx`):
1. El panel detecta si está en **modo resolución** (el operador aún debe definir cantidades) o **modo monitor** (la resolución ya fue confirmada y se espera el cierre de los pedidos internos generados). El modo monitor se activa por evidencia real: existencia de hijos, evento `supply_resolution_committed` en `operational_events`, o estado `supplied`/cerrado — nunca solo por estar en `in_supply` (hardening explícito documentado en el código para evitar falsos positivos).
2. En modo resolución, por cada línea (`branch_request_items`) el operador ingresa: cantidad local (`localQty`) y, opcionalmente, una lista de externos (`{branchId, qty}`) mediante `SplitOriginPanel` reutilizado.
3. El hook `useSupplyResolution` valida en tiempo real: la suma (local + externos) nunca puede superar lo solicitado (`isItemValid`); un ítem está "totalmente cubierto" cuando la suma iguala exactamente lo solicitado (`isItemFullyCovered`), pero **no es obligatorio llegar a cobertura total** para continuar — solo no se permite exceder.
4. Auto-focus: al completar un ítem, el panel enfoca automáticamente el siguiente ítem incompleto (`nextIncompleteId`), optimizando la carga en cadena.
5. **Revalidación pre-commit**: antes de abrir el modal de confirmación, se refresca el stock vivo de BIMS (`revalidateLiveStock`) y se recalculan las disponibilidades; si algún ítem quedó con stock insuficiente respecto a lo cargado, se resaltan las líneas afectadas (`staleItemIds`) y se bloquea el avance con el mensaje "El stock cambió. Revisá los items resaltados."
6. **Modal de confirmación** (`SupplyCommitModal.tsx`): resume, antes de ejecutar, exactamente lo que se va a generar: stock local a registrar, un bloque por cada pedido interno a crear (agrupado por sucursal externa), y el detalle de "demanda no satisfecha" (línea, faltante, cantidad solicitada) si corresponde. Aclara textualmente que la acción no se puede revertir.
7. **Commit**: invoca el RPC `fn_commit_supply_resolution(p_request_id, p_resolutions, p_idempotency_key)`. El payload (`buildPayload`) envía, por línea, `request_item_id`, `local_qty` y la lista de `externals` (filtrando filas vacías o sin sucursal). Se genera una clave de idempotencia por intento (`crypto.randomUUID()`), que se descarta y regenera si el commit falla, para permitir un reintento limpio sin duplicar efectos.
8. Tras el commit exitoso: se invalidan todas las queries relacionadas (detalle, listado, hijos, ítems, stock vivo) y se notifica éxito ("Abastecimiento confirmado").

**Validaciones de backend expuestas como mensajes de error** (detectadas por substring en el mensaje del RPC): `oversupply_not_allowed` (no se puede abastecer más de lo solicitado), `self_source_not_allowed` (la sucursal ejecutora no puede ser su propio origen externo), `incomplete_resolution` (faltan ítems por resolver — es decir, cada ítem debe tener al menos una decisión registrada, aunque sea parcial).

**Modo monitor**: mientras existan pedidos internos hijos abiertos, el panel los lista con su estado (`StatusBadge`) y permite navegar a cada uno; cuando todos los hijos están cerrados, muestra "Todos los pedidos internos están cerrados." La transición final de `in_supply`/hijos internos a `supplied` es responsabilidad de un trigger/proceso de backend (el comentario del código lo llama "promoción automática" del pedido, refrescada por polling cada 15 s mientras se está en este panel).

**Tablas/RPC**: `branch_request_items` (lectura de `local_supply_qty` tras el commit), `branch_requests` (padre e hijos generados), `operational_events` (evento `supply_resolution_committed`), RPC `fn_commit_supply_resolution`.

**Archivos**: `SupplyResolutionPanel.tsx`, `SupplyCommitModal.tsx`, `use-supply-resolution.ts`, `SplitOriginPanel.tsx`.

### Iniciar operación (transición `supplied` → `pending`)

**Propósito**: una vez que un pedido quedó `supplied` (abastecido, sea porque se generó directo desde una conversión de pre-venta o tras resolver el abastecimiento), un operador debe definir recién en ese momento los datos logísticos definitivos (destino, método de envío, dirección, responsable) para que el pedido entre al flujo operativo normal.

**Por qué existe**: separa la etapa de "asegurar stock" de la etapa de "definir cómo se entrega", que en pedidos originados desde pre-venta o abastecimiento no se conocían de antemano con precisión logística completa.

**Flujo**: `StartOperationModal.tsx` reutiliza `LogisticsFieldsForm` (los mismos campos que en la creación estándar, garantizando paridad) y agrega el selector de destino (`client`/`branch`). Si el destino es cliente y el método es `delivery` o `courier`, la dirección es obligatoria. Al confirmar, invoca el RPC `fn_start_operation_from_supplied(p_payload)` con el payload logístico completo; el pedido pasa a `pending` y entra al flujo operativo normal (con las mismas acciones de aceptación/preparación que cualquier otro pedido).

**Tablas/RPC**: `branch_requests` (update de campos logísticos vía RPC), `profiles` (lista de responsables operativos), RPC `fn_start_operation_from_supplied`.

**Archivos**: `StartOperationModal.tsx`, `LogisticsFieldsForm.tsx`.

### Transición de estados y flujos logísticos

**Propósito**: mover un pedido de un estado a otro respetando reglas por tipo de flujo logístico y por rol del actor.

`SolicitudDetail.tsx` calcula el **flujo efectivo** (`flow_type`) del pedido: si ya está persistido lo usa; si no, lo infiere replicando la lógica de backend: `client_delivery` si el destino es cliente, `urban` si origen y destino son la misma sucursal o comparten `logistic_group`, `interurban` en caso contrario. Este cálculo espejo existe explícitamente para no ofrecer en la UI transiciones que el backend rechazaría.

Los pasos disponibles según flujo (`getStatusActions`):

| Flujo | Pasos operativos (además de pending→aceptar/rechazar) |
|---|---|
| Legacy (sin `flow_type`) | in_preparation → in_transit → delivered → received → logistic_closed |
| `client_delivery` | in_preparation → ready_for_delivery → delivered_to_third_party |
| `urban` | in_preparation → ready_for_pickup → (chofer) → in_transit → delivered → received → logistic_closed |
| `interurban` | in_preparation → ready_for_pickup → (chofer) → in_consolidation → assigned_to_trip → in_transit → delivered → received → logistic_closed |

Notas de flujo:
- Desde `pending`, la acción "Aceptar" ejecuta en una sola interacción visible dos transiciones de backend encadenadas: `pending → accepted` y luego `accepted → in_preparation`, ambas vía el mismo RPC `fn_transition_request_status`. Si el segundo paso falla, la UI refresca y muestra el estado intermedio real (`accepted`) con el botón de fallback "Preparar".
- Los pasos marcados como ejecutados "por el chofer" (`ready_for_pickup → in_transit` o `→ in_consolidation`) no se disparan desde este panel sino desde el módulo de choferes, vía una función distinta (`fn_driver_action`, mencionada en comentarios del código pero no implementada en estos archivos).
- La asignación a viaje (`assigned_to_trip`) requiere elegir un `trip_id` existente entre viajes `planned`/`in_progress` (tabla `trips`).
- El rechazo (`rejected`) exige seleccionar un motivo tipificado (`REJECTION_REASONS`) y admite una observación libre.

**Permisos por acción**: cada acción define un `actor` (`origin`, `destination`, `admin`, `driver`). Se filtra así:
- Administradores (`admin`, `supervisor` o `isOwner`) ven todas las acciones.
- `origin`: requiere que el usuario tenga acceso a la sucursal `source_branch_id`.
- `destination`: requiere acceso a `requesting_branch_id`.
- `driver`: requiere rol `driver`, `warehouse_operator`, `jefe_logistica`, `admin` o `supervisor`.
- Acciones de tipo `admin` puro nunca se muestran desde este panel (siempre `false` salvo por el chequeo de `isAdmin` general).

**Bloqueo por documentación**: si el pedido está `in_preparation` y no tiene ningún documento BIMS vinculado (`request_bims_documents`), se bloquea el avance a `in_transit`/`ready_for_pickup`/`ready_for_delivery` con un tooltip explicativo ("Vincule un documento BIMS primero") y un warning visible en la parte superior del detalle.

**RPC**: `fn_transition_request_status(p_request_id, p_new_status, p_reason, p_rejection_reason_type, p_trip_id)`, que devuelve el número de pedido y los estados `old_status`/`new_status` usados para el toast de confirmación.

**Archivos**: `SolicitudDetail.tsx`, `RequestProgressBar.tsx` (barra visual de progreso, con configuraciones de pasos distintas por flujo), `request-status.ts`.

### Bandeja con tabs y filtros

**Propósito operativo**: dar una vista segmentada y persistente por usuario de todos los pedidos relevantes, evitando que un operador tenga que revisar manualmente toda la tabla para encontrar lo que le corresponde.

**Tabs** (`TabKey`): 
- **Activos**: todos los pedidos en estados activos donde el usuario tiene visibilidad (por sucursal solicitante o de origen).
- **Mis pedidos**: pedidos donde `requesting_branch_id` pertenece a las sucursales del usuario (yo pedí).
- **Otros pedidos**: pedidos donde `source_branch_id` pertenece a mis sucursales pero `requesting_branch_id` NO (otros me piden, o cualquier participación mía sin ser el solicitante).
- **Cerrados**: histórico en estados terminales.
- **Pre-Ventas**: exclusiva de borradores comerciales (`is_pre_sale = true`), ordenada por `updated_at` en lugar de `created_at`, e incluye el precio de venta de cada ítem para calcular el total estimado.

Notas explícitas del código: "Activos" y "Mis pedidos" pueden solaparse (un pedido propio activo aparece en ambas); para usuarios con acceso a todas las sucursales (`isAllBranches`) las tabs "Mis"/"Otros" siguen mostrándose pero funcionan usando el filtro de sucursal explícito como ancla de "mi sucursal".

**Filtros**: sucursal (selector, disponible para todos los roles como herramienta operativa de segmentación — no es control de permisos, ya que el RLS de backend sigue aplicando por separado) y estado (dentro de cada tab). Los filtros y la tab activa se persisten en `localStorage` por usuario (`movilog:pedidos:filters:<userId>`), con reseteo automático si la sucursal filtrada deja de existir/activa.

**Conteos por tab**: se calculan en paralelo con queries `head:true` (solo cuentan, no traen filas), replicando exactamente la misma lógica de pertenencia que la query principal, para mostrar badges numéricos en cada tab y detectar si un tab "vacío" en pantalla en realidad tiene datos ocultos por otros filtros (mensaje contextual: "Hay pedidos en esta bandeja, pero los filtros los están ocultando.").

**Chips de dirección**: cada fila muestra un ícono compacto con tooltip que indica si el movimiento es "Entrada" (alguien me pidió a mí), "Salida" (yo pedí) o "Interno" (origen = destino), coloreado de forma neutral respecto al estado del pedido.

**Antigüedad**: cada fila muestra edad relativa ("Hoy", "Ayer", "Nd", meses/años) con color de alerta (ámbar a partir de 3 días, rojo a partir de 7) solo para pedidos activos.

**Búsqueda**: por texto libre contra `client_name` y `bims_invoice_number`, o modo numérico inteligente (`#N`) descrito en la sección de multi-origen.

**Ocultamiento de padres**: en todas las tabs operativas (no en el modo de búsqueda numérica) se excluyen los IDs detectados como padre multi-origen mediante `.not("id", "in", ...)`.

**Observabilidad preventiva** (`useSolicitudesIntegrityCheck`): montado una sola vez en la página, corre en paralelo sin alterar ninguna query operativa. Cada 2 minutos revisa hasta 1000 pedidos activos y detecta, emitiendo solo `console.warn` (nunca bloquea ni modifica UI):
1. **Paridad Dashboard↔Pedidos**: pedidos activos y visibles para el usuario que deberían aparecer en la bandeja de Solicitudes pero que la exclusión de padres los está ocultando indebidamente.
2. **Huérfanos**: hijos cuyo `parent_request_id` no corresponde a ningún registro existente.
3. **Padres fantasma**: registros marcados por texto `[Pedido padre multi-origen]` en `notes` que no tienen ningún hijo real apuntándolos.
4. **Estados desconocidos**: pedidos con un `status` fuera de la whitelist conocida (`ACTIVE_REQUEST_STATUSES` ∪ `CLOSED_REQUEST_STATUSES`), señal de drift entre frontend y backend.

**Archivos**: `Solicitudes.tsx`, `use-solicitudes-integrity.ts`, `use-parent-request-ids.ts`, `request-status.ts`.

### Badges — "AB Preventa" y otros indicadores

**Propósito**: comunicar de un vistazo, en listados y en el detalle, contexto crítico que de otro modo requeriría abrir el pedido.

- **`CommercialBackedBadge` ("AB Preventa")**: se muestra en pedidos hijos generados durante el abastecimiento (transferencias internas) cuando su padre proviene realmente de una preventa convertida. La fuente de verdad es estrictamente estructural: `parent.is_pre_sale === true` o `parent.created_from_presale_id` no nulo. El código es explícito en **no** inferir esto por `request_type` (`online`/`client`) ni por heurísticas de texto, ya que eso generó un falso positivo documentado (caso #611, un hijo de un pedido online normal etiquetado incorrectamente). El tooltip aclara: "Abastecimiento de venta comprometida (preventa / pedido cliente / online). Prioridad comercial heredada del pedido padre."
- **`StatusBadge`**: badge de estado configurado centralmente en `REQUEST_STATUS_CONFIG` (constants), reutilizado en listado, detalle, resumen de padre y panel de abastecimiento.
- Badge "Multi-origen" en `ParentRequestSummary` para identificar visualmente al contenedor.
- Badge "Hijo" en el listado de hijos del padre.
- Badge "Pre-Venta" + sub-estado (Borrador / Cliente confirmó / Convertida a pedido / Enviada a operación) en `PreSaleDetail`.

**Archivos**: `CommercialBackedBadge.tsx`, `StatusBadge` (componente compartido, no incluido en el alcance de lectura de este documento pero referenciado consistentemente).

### Detalle del pedido

**Propósito**: vista unificada de todo el ciclo de vida de un pedido concreto: progreso visual, datos generales, acciones disponibles, historial de eventos, documentos y, si corresponde, panel de abastecimiento.

**Enrutamiento**: `RequestDetailRouter.tsx` resuelve primero, con una query liviana (`is_pre_sale`), si el registro es una pre-venta o un pedido operativo, y renderiza `PreSaleDetail` o `SolicitudDetail` según corresponda. Esto permite deep-links genéricos (`?detail=<uuid>`) sin que el llamador necesite saber de antemano qué tipo de registro es.

**`SolicitudDetail.tsx`** compone:
- Detección de si el registro es un pedido padre (tiene hijos): si es así, renderiza directamente `ParentRequestSummary` sin exponer ninguna acción operativa (defensa de frontend; el backend además bloquea vía RPC).
- `RequestProgressBar`: línea de tiempo visual de pasos según el flujo efectivo, con eventos reales u sintéticos (reconstruidos a partir de columnas como `accepted_at`, `rejected_at`, `logistic_closed_at`, `admin_closed_at` cuando no hay fila en `operational_events` para ese hito — fallback documentado explícitamente en el código para no perder trazabilidad histórica).
- Cabecera con número de pedido, badge de estado, tipo, badge "AB Preventa" si corresponde, fecha y ruta origen→destino (o cliente, si el destino es un cliente).
- Panel de abastecimiento (`SupplyResolutionPanel`) cuando `status = in_supply`, o card de "Pedido abastecido" con botón "Iniciar operación" cuando `status = supplied`.
- Bloque de motivo de rechazo cuando `status = rejected` (motivo tipificado, quién rechazó — resuelto contra `profiles` —, fecha y observación libre).
- Panel de acciones disponibles filtradas por rol/actor (ver sección de transición de estados), con formularios inline para rechazo y para selección de viaje.
- Listado de líneas de producto con miniatura, stock vivo BIMS informativo por sucursal origen, y advertencia si hay diferencia entre `quantity_requested` y `quantity_accepted`.
- `RequestDocuments` (documentos BIMS vinculados).
- Historial de eventos (`operational_events`) con nombre del actor resuelto contra `profiles` (o "Sistema" si no hay actor).

**Tablas usadas**: `branch_requests`, `branch_request_items`, `fulfillment_orders`, `operational_events`, `request_bims_documents`, `trips`, `profiles`.

**Archivos**: `RequestDetailRouter.tsx`, `SolicitudDetail.tsx`, `PreSaleDetail.tsx`, `ParentRequestSummary.tsx`, `RequestProgressBar.tsx`, `StartOperationModal.tsx`.

### Adjuntos y documentos BIMS

**Propósito operativo**: vincular al pedido los comprobantes emitidos en el ERP BIMS (factura o transferencia de stock), como respaldo documental y como condición para poder avanzar el flujo logístico.

**Tipo esperado según el pedido**: `RequestDocuments.tsx` calcula el tipo de documento esperado — `invoice` (factura) si `request_type = "client"` y `delivery_target = "client"`; `transfer` (transferencia) en cualquier otro caso.

**Quién puede editar**: usuarios con acceso a la sucursal origen (`isOrigin`) o administradores (`isAdmin`), y únicamente mientras el pedido está en `pending` o `in_preparation` (`canEdit`).

**Flujo**: alta de un número de documento (`document_number`) asociado al `request_id`, tipo (`document_type`) y usuario que lo creó (`created_by`); eliminación (desvinculación) del documento por quien tiene permiso de edición.

**Regla de bloqueo**: si el pedido está `in_preparation` y no tiene ningún documento vinculado, se muestra la advertencia "Se requiere al menos un documento BIMS para avanzar a tránsito" tanto en este componente como replicada en `SolicitudDetail` para bloquear el botón de transición correspondiente.

**Adjunto de archivo Excel de origen** (distinto de los documentos BIMS): en `AdminReposicionForm`, si la carga fue por Excel, el archivo original se sube al bucket `request-attachments` con ruta `branch_requests/<id>/<nombre>` y se referencia en la columna `attached_file_path` de `branch_requests`, quedando disponible como respaldo del pedido, con manejo tolerante a fallos (si la subida falla, el pedido igual se crea, solo con una advertencia).

**Tablas usadas**: `request_bims_documents`, storage bucket `request-attachments`.

**Archivos**: `RequestDocuments.tsx`, `AdminReposicionForm.tsx`.

## Cumplimiento (Ejecución Física)

### Propósito y por qué existe
Cumplimiento es la bandeja operativa que muestra en tiempo real todas las órdenes de fulfillment activas (`fulfillment_orders`) priorizadas para que el equipo de sucursal/logística sepa qué mover primero. Existe porque `branch_requests` describe la intención comercial de un pedido, pero la ejecución física (quién tiene la mercadería, dónde está, qué falta) necesita su propia entidad y su propio tablero: `fulfillment_orders` es esa capa de "verdad física" separada del pedido comercial.

### Flujo paso a paso
1. Se genera un `fulfillment_order` a partir de un `branch_request` (o directamente, en flujos de acopio) con `status = pending`.
2. La pantalla agrupa las órdenes activas por prioridad visual (no bloqueante): consultas, entregas a cliente, online/mixto, redistribución, reposición sucursal — según `branch_requests.request_type`.
3. Cada fila muestra: sucursal origen → destino/cliente, método de envío, custodia actual (traducida con `CUSTODY_LABELS`) y el estado de fulfillment con su badge (`FULFILLMENT_STATUS_CONFIG`).
4. Filtros: búsqueda server-side por cliente o número de factura BIMS, y filtro de sucursal según el acceso del usuario (`useUserBranchFilter`).
5. Si la orden tiene una excepción comercial (`commercial_exception_status`), se marca con badge "No bloqueante": la incidencia comercial no frena la operación logística.

### Estados y transiciones (fulfillment_orders.status)
| Estado | Significado | Custodia típica |
|---|---|---|
| pending | Orden creada, aún sin preparar | Sucursal origen |
| picking | En preparación física | Sucursal origen |
| waiting_for_cut / waiting_for_courier | Esperando corte de camión propio o retiro de courier | Sucursal origen |
| dispatched / in_transit | Chofer retiró la carga | Chofer (driver) |
| at_hub | Dejada en depósito de consolidación | Sucursal (hub) |
| pending_physical_confirmation | Chofer descargó, sucursal aún no confirmó | En tránsito de custodia |
| delivered | Entregada (sucursal o cliente) | Nadie / cliente |
| received | Sucursal confirmó recepción física | Sucursal destino |
| completed / cancelled | Estados terminales | — |

### Reglas de negocio y validaciones
- La agrupación por prioridad es puramente visual; no bloquea ni reordena la cola real de trabajo.
- La búsqueda es server-side (debounce de 300ms) sobre `destination_client_name` y `bims_invoice_number`.
- El filtro de sucursal usa `source_branch_id` o `destination_branch_id` cuando el usuario no tiene acceso global (`isAllBranches`).
- Las excepciones comerciales (ver módulo Distribución) se muestran pero no cambian el `status` de fulfillment.

### Tablas
- `fulfillment_orders` (tabla central del módulo)
- `branches`, `trips`, `branch_requests` (joins de contexto)

### RPC / triggers / edge functions
No dispara RPC propias; es de solo lectura sobre datos que otros módulos (Chofer, Ruteo, Recepción) modifican vía `fn_driver_action`, actualizaciones directas y eventos.

### Permisos
Lectura vía política RLS `View fulfillments` (autenticados, filtrada en la UI por sucursal accesible). No requiere rol específico para ver la bandeja, pero el alcance de filas visibles depende de `can_access_branch`/`is_privileged` aplicado en las policies de `fulfillment_orders`.

### Archivos
`src/pages/Cumplimiento.tsx`

---

## Ruteo y viajes

### Propósito y por qué existe
Ruteo es el centro de planificación logística: consolidación de pedidos interurbanos, gestión de viajes (`trips`) programados y en curso, y visibilidad de pedidos a cliente con flota propia. Existe para separar la planificación (qué viaje se arma, con qué chofer y vehículo, qué cargas lleva) de la ejecución (que ocurre en el módulo Chofer).

### Estructura y flujo paso a paso
La página tiene 4 pestañas, cada una respaldada por un componente propio:

1. **Consolidación** (`LogisticaConsolidacion.tsx`): pedidos con `branch_requests.status = in_consolidation`, `flow_type = interurban`, `is_pre_sale = false`. Es la cola de pedidos que están juntándose en el depósito/hub antes de asignarse a un viaje.
2. **Pedidos cliente / flota propia** (`PedidosClienteFlotaPropia.tsx`): `branch_requests` con `request_type = client`, `shipping_method = own_fleet`, `delivery_target = client`, en cualquiera de los estados `in_preparation, ready_for_pickup, in_consolidation, assigned_to_trip, in_transit`.
3. **Programados** (`LogisticaViajesProgramados.tsx`): viajes con `trips.status = planned`. Permite crear viaje (`CrearViajeForm`), ver detalle (`LogisticaViajeDetalle`), contar cargas asignadas (`fulfillment_orders.trip_id`) y cancelar viaje.
4. **En curso** (`LogisticaViajesEnCurso.tsx`): viajes con `status = in_progress`, monitoreo en tiempo real.

Los KPIs superiores (chips clicables) muestran conteos en vivo de cada bandeja y funcionan como atajos de navegación entre pestañas.

### Creación y edición de viajes
- **Crear viaje**: formulario `CrearViajeForm.tsx` — inserta en `trips` con `vehicle_id`, `driver_id`, `origin_branch_id`, `trip_type`, `planned_departure`, etc. Solo visible/operable para roles logísticos (`admin`, `supervisor`, `jefe_logistica`, `warehouse_operator`).
- **Editar viaje**: `EditarViajeForm.tsx` invoca la RPC `fn_edit_trip`, que solo permite editar viajes en estado `planned` y registra un evento `trip_edited` con el detalle de los campos modificados (chofer, vehículo, fecha de salida, destino).
- **Cancelar viaje**: botón de la lista invoca `fn_cancel_trip`. Solo permite cancelar viajes `planned` y **sin cargas asignadas** (si `fulfillment_orders.trip_id` tiene registros, la función rechaza la cancelación con excepción explícita). Genera evento `trip_cancelled`.

### Estados de viaje (trips.status)
| Estado | Significado |
|---|---|
| planned | Viaje creado, con o sin cargas asignadas, aún no salió |
| in_progress | Viaje iniciado (chofer aceptó cargas y salió) |
| completed | Viaje finalizado por el chofer (kilometraje final cargado) |
| cancelled | Viaje cancelado antes de iniciar (solo si no tiene cargas) |

### Reglas de negocio y validaciones
- `fn_edit_trip` y `fn_cancel_trip` exigen `status = planned`; una vez iniciado el viaje, ya no se edita ni cancela desde Ruteo (el ciclo de vida pasa a manos del chofer).
- La autorización de edición/cancelación es explícita en la función SQL: `admin`, `supervisor`, `jefe_logistica`, `warehouse_operator` o `is_owner`. No depende únicamente de RLS de tabla.
- El conteo de cargas por viaje se recalcula client-side contando `fulfillment_orders.trip_id` — es la fuente de verdad para habilitar/deshabilitar "Aceptar e iniciar" en el panel del chofer.
- Iniciar el viaje (aceptar cargas) es responsabilidad de `fn_accept_and_start_trip`, documentada en el módulo Chofer.

### Tablas
`trips`, `fulfillment_orders`, `branch_requests`, `vehicles`, `drivers`, `branches`, `operational_events`

### RPC / triggers
- `fn_edit_trip(p_trip_id, p_driver_id, p_vehicle_id, p_clear_vehicle, p_planned_departure, p_destination_description)`
- `fn_cancel_trip(p_trip_id, p_reason)`
- `fn_accept_and_start_trip` (ver Chofer)
- Edge function `trip-eligible-drivers`: dado un caller con rol logístico (verificado vía `user_roles` con service role), devuelve la lista de choferes elegibles para asignar a un viaje (con su vehículo asignado), usada por `CrearViajeForm`/`EditarViajeForm`.

### Permisos
- Ver pestañas: cualquier usuario autenticado con acceso de módulo Ruteo.
- Crear/editar/cancelar viaje: roles `admin`, `supervisor`, `jefe_logistica`, `warehouse_operator`, o `owner` (validado tanto en frontend —oculta el botón— como en las funciones SQL con `SECURITY DEFINER`).

### Archivos
`src/pages/Ruteo.tsx`, `src/components/logistica/LogisticaConsolidacion.tsx`, `src/components/logistica/PedidosClienteFlotaPropia.tsx`, `src/components/logistica/LogisticaViajesProgramados.tsx`, `src/components/logistica/LogisticaViajesEnCurso.tsx`, `src/components/logistica/CrearViajeForm.tsx`, `src/components/logistica/EditarViajeForm.tsx`, `src/components/logistica/LogisticaViajeDetalle.tsx`

---

## App del Chofer

### Propósito y por qué existe
Es la interfaz operativa que usa el chofer desde el móvil para gestionar sus tareas del día: retirar cargas, iniciar/finalizar viajes o cortes urbanos, entregar mercadería, dejar/tomar cargas de un acopio (hub) y transferir custodia a otro chofer. Existe porque el chofer necesita una vista simplificada, orientada a acción, distinta de la vista analítica de Ruteo/Cumplimiento; y porque la custodia física de la mercadería (`current_custody_holder_id`) debe quedar siempre en manos de una persona identificable durante el transporte.

### Estructura de la pantalla
`src/pages/Chofer.tsx` arma 3 KPIs (custodia actual, viaje/corte activo, cargas en acopio de su sucursal) y 4 pestañas:
1. **Mis cargas**: `MisCargasEnCurso` (cargas bajo su custodia) + `CargasEnAcopio` (cargas en `at_hub` en su sucursal asignada).
2. **Retiro**: `CargasDisponibles` — lista de cargas listas para retirar en la sucursal seleccionada.
3. **Cortes/Viajes**: `CorteUrbano` (viajes `trip_type = urban_cutoff`) y `ViajeInterurbano` (viajes `trip_type = interurban_planned`).
4. **Historial**: eventos `operational_events` disparados por el propio chofer (`triggered_by = user.id`).

### Flujo paso a paso — Retiro de carga
1. El chofer selecciona su sucursal de trabajo (por defecto la asignada en `drivers.assigned_branch_id`).
2. `CargasDisponibles` trae `fulfillment_orders` sin `trip_id`, en estados `pending, waiting_for_cut, waiting_for_courier, picking`, y también pedidos `branch_requests` en `ready_for_pickup` que todavía no tienen fulfillment creado (flujos urbanos desde depósito central).
3. Antes de listar una carga como "lista para retirar", se valida documentación: `isReadyForPickup` exige que tenga transferencia/factura BIMS vinculada (`hasBindingDocument`) o que el pedido ya esté `ready_for_pickup`. Complementariamente, la RPC `fn_validate_driver_pickup(p_fulfillment_id)` corrobora contra `request_bims_documents` y, si falta todo, genera una alerta `ai_anomalies` de tipo `missing_bims_document` (no bloquea, pero deja trazabilidad).
4. Retiro:
   - Si la fila viene de un `fulfillment_order`, se llama `runDriverAction({ action: "pickup", fulfillmentId, tripId })`, que ejecuta la RPC `fn_driver_action`.
   - Si la fila viene de un `branch_request` sin fulfillment (flujo urbano puro), se encadenan llamadas a `fn_transition_request_status` respetando la máquina de estados según `flow_type` (urbano: 1 paso directo a `in_transit`; interurbano: 3 pasos `ready_for_pickup → in_consolidation → assigned_to_trip → in_transit`, y exige viaje activo).
5. El chofer también puede **rechazar** un retiro (registra evento `driver_pickup_rejected` + alerta `ai_anomalies`, la carga vuelve a la cola) o **enviar a acopio** (combina `pickup` + `drop_at_hub` en una sola acción de UI).

### Flujo paso a paso — Viaje interurbano
1. Logística crea el viaje en `planned` (desde Ruteo o desde el propio panel del chofer si tiene rol de gestión) y le asigna cargas (`fulfillment_orders.trip_id`).
2. El chofer ve el viaje planificado con el conteo de cargas asignadas; el botón "Aceptar e iniciar" solo se habilita si `loadCount > 0`.
3. Al aceptar, se abre `AceptarCargasViajeModal`, que llama a la RPC `fn_accept_and_start_trip(p_trip_id, p_fulfillment_ids, p_start_mileage, p_force_empty)`:
   - Verifica que el viaje esté `planned` y que quien ejecuta sea el chofer asignado o un rol logístico (`warehouse_operator`, `jefe_logistica`, `supervisor`, `admin`, `owner`).
   - Por cada `fulfillment_id` enviado, valida que pertenezca al viaje y que no esté en estado terminal; si es válido, lo pasa a `in_transit`, asigna custodia al chofer y registra evento `load_accepted_by_driver`; si no, lo reporta en `skipped[]` sin frenar el proceso.
   - Si no queda ninguna carga válida y no se fuerza (`p_force_empty=false`), lanza excepción.
   - Actualiza `trips.status = in_progress`, `actual_departure = now()`, guarda `start_mileage`, y registra eventos `loads_accepted` y `trip_started`.
4. Durante el viaje el chofer puede agregar tareas en ruta (`AgregarTareaViaje`, se guardan en `trips.planned_stops` con flag `added_in_transit`).
5. Al finalizar, el chofer ingresa kilometraje final; si aún tiene cargas bajo custodia (`current_custody_holder_id = user.id` en estados `in_transit, dispatched, delivery_failed`) se le muestra una advertencia (no bloqueante) antes de cerrar el viaje. El cierre actualiza `trips.status = completed`, `actual_arrival`, `end_mileage`, y registra evento `trip_completed`.

### Acciones del chofer sobre una carga (`fn_driver_action`)
Todas viajan a través del wrapper `runDriverAction` (`src/lib/driver-actions.ts`), que llama a la RPC `fn_driver_action(p_action, p_fulfillment_id, p_trip_id, p_metadata)`:

| Acción | Efecto en fulfillment_orders | Efecto en branch_requests | Evento generado |
|---|---|---|---|
| pickup | status→in_transit, custody_type=driver, custody_holder=chofer, location_type=vehicle | status→in_transit, custodia=chofer | driver_pickup |
| pickup_from_hub | status→in_transit, custody=driver | status→in_transit | driver_pickup_from_hub |
| drop_at_hub | status→at_hub, custody_type=branch, location=hub_branch_id (metadata) | status→in_consolidation | driver_drop_at_hub |
| deliver_branch | status→delivered, custody=branch, location=destination_branch_id, received_at/by | status→delivered | driver_delivery_to_branch |
| deliver_customer | status→delivered, custody=customer | status→delivered_to_third_party | driver_delivery_to_customer |
| delivery_failed | no cambia status; marca delivery_failed_at/reason | sin cambios | driver_delivery_failed |
| transfer_to_driver | custody_holder→nuevo chofer (metadata.new_driver_user_id) | custodia→nuevo chofer | driver_custody_transfer |

### Estados y custodia en el ciclo del chofer
| Momento | fulfillment_orders.status | current_custody_type | current_location_type |
|---|---|---|---|
| Antes del retiro | pending / waiting_for_cut / picking | branch | branch |
| Tras retiro | in_transit | driver | vehicle |
| Dejado en acopio | at_hub | branch | branch (hub) |
| Tomado del acopio | in_transit | driver | vehicle |
| Entregado a sucursal | delivered | branch | branch (destino) |
| Entregado a cliente | delivered | customer | customer |
| Entrega fallida | (sin cambio) | (sin cambio) | (sin cambio) |

### Corte urbano (`CorteUrbano.tsx`)
Es la variante de viaje para reparto urbano de corta duración (`trip_type = urban_cutoff`). Comparte la misma máquina de `trips` (planned/in_progress/completed) pero está pensada para recorridos de un solo día dentro de la ciudad, con inicio/fin de corte en vez de "viaje" propiamente dicho. Usa los mismos componentes de detalle (`CorteDetalle`).

### Reglas de negocio y validaciones
- La documentación BIMS (transferencia o factura) es el gate principal antes del retiro; si falta, no bloquea técnicamente pero genera alerta de anomalía y la carga se separa visualmente en "pendiente de documentos".
- Las transiciones de `branch_requests` para filas sin fulfillment respetan siempre `flow_type` (urbano vs interurbano) y, para interurbano, exigen viaje activo — si no lo hay, se lanza un error explicativo pidiendo iniciar viaje o pedir asignación desde Ruteo.
- `fn_accept_and_start_trip` es transaccional: bloquea el viaje (`FOR UPDATE`) y cada fulfillment antes de tocarlos, evitando condiciones de carrera si dos usuarios intentan iniciar el mismo viaje.
- Al finalizar viaje con cargas aún en custodia del chofer, el sistema advierte pero permite forzar el cierre (deuda operativa queda registrada, no bloqueada).
- Transferencia de custodia (`transfer_to_driver`) se usa para traspasar mercadería entre choferes sin pasar por un hub físico (`TransferirCustodiaModal`).

### Tablas
`fulfillment_orders`, `branch_requests`, `trips`, `drivers`, `vehicles`, `operational_events`, `ai_anomalies`, `request_bims_documents`

### RPC / triggers
- `fn_driver_action(p_action, p_fulfillment_id, p_trip_id, p_metadata)` — SECURITY DEFINER, motor de todas las acciones físicas del chofer sobre una carga.
- `fn_accept_and_start_trip(p_trip_id, p_fulfillment_ids, p_start_mileage, p_force_empty)` — inicia el viaje aceptando cargas.
- `fn_validate_driver_pickup(p_fulfillment_id)` — valida/propaga documento BIMS antes del retiro; genera alerta si no hay documento.
- `fn_cancel_trip`, `fn_edit_trip` — usadas también desde el panel del chofer cuando tiene rol de gestión (crear/cancelar viaje propio).
- `fn_transition_request_status` — máquina de estados genérica de `branch_requests`, invocada en cadena para flujos sin fulfillment previo.

### Permisos
- Acceso a la app del chofer: cualquier usuario con registro en `drivers` vinculado a su `user_id`; también accesible a roles de gestión para crear/asignar viajes desde el mismo panel.
- Ejecutar `fn_driver_action` sobre una carga: la función no valida rol explícitamente más allá de requerir sesión autenticada (`auth.uid()`); el control de acceso real de qué filas puede ver/tocar el chofer llega por RLS de `fulfillment_orders` (custodia propia o acceso de sucursal).
- Iniciar/cancelar/editar viaje: exige ser el chofer asignado al viaje o tener rol logístico (`fn_accept_and_start_trip`, `fn_edit_trip`, `fn_cancel_trip`).

### Archivos
`src/pages/Chofer.tsx`, `src/lib/driver-actions.ts`, `src/components/chofer/CargasDisponibles.tsx`, `src/components/chofer/MisCargasEnCurso.tsx`, `src/components/chofer/CargasEnAcopio.tsx`, `src/components/chofer/CorteUrbano.tsx`, `src/components/chofer/ViajeInterurbano.tsx`, `src/components/chofer/AceptarCargasViajeModal.tsx`, `src/components/chofer/AgregarTareaViaje.tsx`, `src/components/chofer/CorteDetalle.tsx`, `src/components/chofer/EntregaModal.tsx`, `src/components/chofer/TransferirCustodiaModal.tsx`

---

## Distribución (Mayorista)

### Propósito y por qué existe
Distribución es la vista especializada en pedidos con destino final "cliente" (`branch_requests.delivery_target = client`), separada de Cumplimiento porque introduce una capa de gestión comercial que no aplica a reposiciones entre sucursales: las **excepciones comerciales**. Existe para que el equipo comercial/administrativo pueda intervenir cuando una entrega a cliente mayorista se complica (dirección incorrecta, cliente no disponible, negociación de condiciones) sin bloquear el resto de la operación logística.

### Flujo paso a paso
1. Se listan `fulfillment_orders` filtradas por `branch_request.delivery_target = client` o con `destination_client_name` propio, en 3 pestañas: **en curso**, **entregadas**, **excepciones**.
2. Se muestran también los viajes planificados/en curso con paradas de tipo `delivery_client` (`planned_stops`).
3. Cualquier fila en estado `dispatched`, `in_transit` o `delivered` puede marcarse como **excepción comercial** (botón "Excepción"): setea `commercial_exception_status = pending_commercial` y `commercial_exception_at = now()`.
4. A partir de ahí corre un cronómetro visual (`getExceptionAge`) con codificación de color por antigüedad: gris (<3h), secundario (3-5h), destructivo (5-24h), destructivo+negrita/"ESCALADA" (≥24h).
5. La resolución se hace desde un diálogo (`ExceptionResolutionForm`, definido más abajo en el mismo archivo) donde se elige un `commercial_resolution_type` (reprogramar, negociar, cancelar, redirigir) y notas; esto marca `commercial_exception_status = resolved` con auditoría (`commercial_resolved_by/at`).

### Estados y transiciones de excepción comercial
| Estado | Significado | Disparador |
|---|---|---|
| null | Sin excepción | Default |
| pending_commercial | Excepción abierta, requiere intervención comercial | Botón "Excepción" en fila dispatched/in_transit/delivered |
| pending_commercial (+24h) | Escalada por antigüedad (visual + alerta) | Edge function `commercial-escalation` (cron) |
| resolved | Excepción resuelta con una decisión concreta | Formulario de resolución |

Importante: la excepción comercial **nunca cambia** el `status` operativo del fulfillment (sigue viajando por `dispatched → in_transit → delivered` en paralelo); es un estado independiente, "no bloqueante" por diseño.

### Reglas de negocio y validaciones
- El umbral de escalación visual está hardcodeado en frontend en `ESCALATION_THRESHOLD_HOURS = 24`.
- La escalación real (creación de alerta) la hace la edge function `commercial-escalation`, que corre periódicamente (cron), busca `fulfillment_orders` con `commercial_exception_status = pending_commercial` y `commercial_exception_at` de más de 24h, y por cada una verifica en `ai_anomalies` si ya existe una alerta `commercial_exception_escalated` para esa orden (evita duplicar alertas). Si no existe, inserta una con `severity: critical`, `alert_level: logistics_admin_decision`. Es explícitamente "visibility only": no toca `status` ni custodia.
- El ordenamiento de la pestaña "Excepciones" prioriza: escaladas (24h+) → pendientes → resueltas.

### Tablas
`fulfillment_orders`, `branch_requests`, `trips`, `branches`, `ai_anomalies`

### RPC / triggers / edge functions
- Sin RPC propia: las actualizaciones de excepción son `UPDATE` directos a `fulfillment_orders` desde el cliente.
- **Edge function `commercial-escalation`**: job que corre con `SUPABASE_SERVICE_ROLE_KEY`, sin autenticación de usuario (se asume disparado por cron/scheduler). Genera alertas de escalamiento por antigüedad.

### Permisos
Lectura/edición vía políticas de `fulfillment_orders` (autenticados con acceso de sucursal o privilegio). No hay un rol exclusivo "comercial" documentado en el esquema de roles (`app_role`); en la práctica, cualquier usuario con acceso al fulfillment puede marcar/resolver excepciones.

### Archivos
`src/pages/Distribucion.tsx`, `supabase/functions/commercial-escalation/index.ts`

---

## Etiquetas y bultos

### Propósito y por qué existe
Genera e imprime etiquetas físicas para los bultos de un envío (`shipment_packages`), necesarias para identificar cada paquete en tránsito hacia un cliente o sucursal. Existe porque `fulfillment_orders` es una orden lógica (puede incluir varios bultos), pero cada bulto físico necesita su propia etiqueta con número de bulto, destinatario, referencia de transferencia/factura y teléfono de contacto.

### Flujo paso a paso
1. Se listan `fulfillment_orders` no canceladas cuyo destino es cliente, método de envío es courier, o ya tienen `package_count > 0`.
2. Para cada fulfillment, se muestran los `shipment_packages` ya creados (si los hay) y cuántos fueron impresos (`label_printed`).
3. "Crear etiquetas" abre `LabelForm`: el usuario define cantidad de bultos, destinatario, dirección y teléfono (con defaults tomados del fulfillment/branch_request). Al enviar:
   - Inserta N filas en `shipment_packages` (una por bulto, `package_number` correlativo), con `label_type` derivado del `delivery_target` (`client_delivery` vs `inter_branch`).
   - Actualiza `fulfillment_orders.package_count = count`.
4. "Imprimir" (`PrintLabelsButton`) genera un HTML standalone (sin backend) con una tarjeta por etiqueta y abre una ventana nueva del navegador con `window.print()`. No genera PDF real ni se apoya en ninguna librería de PDF: es HTML impreso directamente vía diálogo del navegador.

### Estados y transiciones
`shipment_packages` no tiene máquina de estados propia; solo el flag booleano `label_printed` (se setea en `printed_at`/`label_printed`, aunque en el código actual revisado no se ve un UPDATE explícito que marque `label_printed = true` tras imprimir — el conteo de "impresas" se calcula leyendo ese campo, pero el flujo de impresión mostrado no lo actualiza. Esto es un punto a verificar/completar en el código, no algo confirmado como implementado).

### Reglas de negocio y validaciones
- Cantidad de bultos debe ser ≥1.
- Los valores por defecto de destinatario/dirección/teléfono se autocompletan desde `fulfillment_orders`/`branch_requests`, pero son editables.
- `label_type` es `client_delivery` cuando `branch_request.delivery_target = client`, si no `inter_branch`.

### Tablas
`shipment_packages`, `fulfillment_orders`, `branches`, `branch_requests`

Columnas: `fulfillment_order_id`, `package_number`, `label_type`, `destination_description`, `transfer_reference`, `invoice_reference`, `sending_branch_code`, `contact_phone`, `recipient_name`, `label_printed`, `printed_at`.

### RPC / triggers / edge functions
Ninguno; son `insert`/`update` directos desde el cliente.

### Permisos
RLS de `shipment_packages`: ver/gestionar solo si el usuario puede acceder al fulfillment relacionado (`fn_can_access_fulfillment`), lo cual cubre custodia propia o acceso de sucursal (origen/destino/ubicación actual) o privilegio de rol.

### Archivos
`src/pages/Etiquetas.tsx`, `src/components/etiquetas/LabelPDF.tsx`

---

## Recepción física

### Propósito y por qué existe
Registra la recepción física de la mercadería en la sucursal destino, como paso intermedio entre "el chofer descargó" y "BIMS confirma el ingreso administrativo". Existe porque hay una ventana de tiempo en la que la mercadería ya está físicamente en la sucursal pero el sistema comercial (BIMS) todavía no la refleja, y esa ventana necesita visibilidad y un plazo de control.

### Flujo paso a paso
1. **Chofer descarga** (`markDriverDrop`): cuando el chofer deja la mercadería en destino, se marca `fulfillment_orders.status = pending_physical_confirmation` y se registra evento `driver_delivery_drop` con `expected_next_event = branch_physical_confirmation`.
2. **Sucursal confirma recepción** (`confirmReception`, acción sugerida, no obligatoria): actualiza `status = received`, `received_at/by`, `received_at_branch/by_branch`, y registra evento `branch_reception_confirmed` con `expected_next_event = bims_confirmation` y un `expected_next_event_deadline` de **48 horas** desde la confirmación.
3. La pantalla separa visualmente "pendiente de confirmación física" (prioridad alta, banda amarilla) de "en camino" (`dispatched, in_transit, delivered`), con filtros rápidos.
4. Se muestra el conteo de recepciones cuyo plazo BIMS de 48h está vencido (`bimsOverdueCount`), calculado comparando `bims_confirmation_deadline` con la hora actual, solo si `!bims_transfer_verified`.
5. Un banner explicativo aclara que la confirmación es **sugerida**: "Si BIMS ya muestra la recepción confirmada, la recepción logística se cierra automáticamente" (sincronización externa no cubierta en este código, delegada a integración BIMS).

### Estados y transiciones
| Estado | Descripción | Siguiente paso esperado |
|---|---|---|
| dispatched / in_transit / delivered | Carga en camino o recién marcada entregada por el chofer | Confirmación física de sucursal |
| pending_physical_confirmation | Chofer descargó, sucursal debe confirmar | branch_physical_confirmation |
| received | Sucursal confirmó recepción física | bims_confirmation (con deadline de 48h) |

### Reglas de negocio y validaciones
- El plazo BIMS es de exactamente 48 horas desde la confirmación de recepción (`Date.now() + 48*60*60*1000`), y se muestra como cuenta regresiva (`getBimsCountdown`) o "Vencido" si ya pasó.
- La confirmación física es explícitamente no bloqueante/no obligatoria (documentado en el propio banner de la UI); el cierre automático por BIMS no está implementado en este módulo (se asume manejado por otra integración/edge function no incluida en el alcance revisado).
- Solo se consideran "recientes" las recepciones de los últimos 7 días para la lista de `received`.

### Tablas
`fulfillment_orders` (campos: `status`, `received_at`, `received_by`, `received_at_branch`, `received_by_branch`, `bims_confirmation_deadline`, `bims_transfer_verified`, `bims_transfer_number`, `bims_invoice_number`), `branches`, `branch_requests`, `operational_events`

### RPC / triggers / edge functions
Ninguna RPC; son `UPDATE`/`INSERT` directos a `fulfillment_orders` y `operational_events`.

### Permisos
Gobernado por RLS estándar de `fulfillment_orders` (acceso por sucursal/custodia/privilegio). No hay un rol exclusivo de "recepción"; en la práctica lo opera el personal de la sucursal destino.

### Archivos
`src/pages/Recepcion.tsx`

---

## Incidencias

### Propósito y por qué existe
Registra y resuelve incidentes logísticos: producto averiado, faltante, sobrante, producto incorrecto, diferencia de stock. Existe porque las anomalías de mercadería son eventos separados del flujo normal de fulfillment: necesitan su propia entidad para clasificar causa, contexto de detección, decisión administrativa y, opcionalmente, disposición física del stock afectado (`special_stock`).

### Flujo paso a paso
1. **Creación** (`CrearIncidencia.tsx`): el usuario elige tipo de incidencia, contexto de detección (interno vs. en recepción de otra sucursal/proveedor — `DETECTION_CONTEXT_LABELS`), sucursal, producto opcional, cantidad afectada, y hasta 4 fotos de evidencia (bucket `incident-photos`).
   - Si el contexto es `internal`, se habilita el campo "causa del daño" (`damage_cause`); en contexto no interno, la UI aclara que causa y responsable no aplican, porque se registra como "recibido en esa condición".
   - Se puede marcar de entrada `pending_shipment_to_admin` si la mercadería debe enviarse físicamente a administración.
   - Inserta en `logistics_incidents` con `status = open` (default) y registra evento `incident_created`.
2. **Decisión administrativa** (`AdminDecisionForm`, dentro de `Incidencias.tsx`): sobre incidencias `open` o `under_review` sin decisión previa, un admin elige una disposición:
   - `send_to_admin_stock`, `sell_discounted`, `assign_responsibility`, `bims_adjustment`, `supplier_claim`, `loss_absorbed`.
   - Si la disposición es `loss_absorbed` o `bims_adjustment`, la incidencia pasa directo a `resolved` (con `resolution`, `resolved_by/at`).
   - Cualquier otra disposición dispara `status = under_review` (decisión tomada, pendiente de ejecución operativa).
   - Si la disposición es `send_to_admin_stock`, se marca `pending_shipment_to_admin = true`.
3. **Cierre**: desde `under_review` con disposición ya tomada, o desde `resolved`, un botón "Cerrar"/"Archivar" pasa la incidencia a `closed` con `resolved_at/by`.
4. **Recordatorios de envío a administración**: la edge function `shipment-reminders` corre (según su propia lógica) solo los días 9 y 24 del mes; busca incidencias con `pending_shipment_to_admin = true`, `status in (open, under_review)` y el flag de recordatorio del día (`shipment_reminder_9th` / `shipment_reminder_24th`) en `false`. Genera una alerta `ai_anomalies` por cada una (severidad `warning` el día 9, `critical` el día 24 con `alert_level: logistics_admin_decision`) y marca el flag correspondiente como enviado para no duplicar en el mes.

### Estados y transiciones (logistics_incidents.status)
| Estado | Significado | Disparador |
|---|---|---|
| open | Incidencia recién creada | Insert desde `CrearIncidencia` |
| under_review | Decisión administrativa tomada, pendiente de ejecutarse (o en análisis) | `AdminDecisionForm` con disposición ≠ loss_absorbed/bims_adjustment |
| resolved | Decisión ejecutada / incidencia cerrada por disposición directa | `loss_absorbed`, `bims_adjustment`, o cierre manual desde under_review |
| escalated | Estado del enum disponible; no se ve disparado explícitamente en el código de frontend revisado (posible uso futuro o desde otro flujo no cubierto) | — |
| closed | Incidencia archivada definitivamente | Botón "Cerrar"/"Archivar" |

### Reglas de negocio y validaciones
- Campos obligatorios en creación: título, sucursal, contexto de detección.
- `damage_cause` solo se persiste si `detection_context = internal`.
- Máximo 4 fotos de evidencia, 5MB cada una (validado en `FileUpload`).
- El flag `pending_shipment_to_admin` es lo que activa el ciclo de recordatorios automáticos de `shipment-reminders`.
- KPI "Pend. envío" en la lista cuenta incidencias con `pending_shipment_to_admin = true` y estado aún no terminal.
- El filtro por sucursal respeta `useUserBranchFilter` (usuarios no globales solo ven incidencias de sus sucursales permitidas).

### Tablas
`logistics_incidents`, `special_stock` (destino de mercadería con disposición administrativa), `branches`, `products`, `operational_events`, `ai_anomalies`

Columnas clave de `logistics_incidents`: `incident_type`, `branch_id`, `branch_request_id`, `fulfillment_order_id`, `trip_id`, `inventory_id`, `product_id`, `quantity_affected`, `status`, `current_custody_holder_id`, `current_location_branch_id`, `title`, `description`, `photo_urls`, `resolution`, `resolved_by/at`, `reported_by`, `assigned_to`, más los campos incorporados luego (`detection_context`, `damage_cause`, `admin_disposition`, `admin_disposition_notes`, `admin_decision_by/at`, `pending_shipment_to_admin`, `shipment_reminder_9th`, `shipment_reminder_24th`) que se usan activamente en el código pero no forman parte del `CREATE TABLE` original (fueron agregados en migraciones posteriores no auditadas línea por línea; se confirma su existencia por el uso consistente en frontend y edge functions).

### RPC / triggers / edge functions
Sin RPC dedicada: las transiciones son `UPDATE`/`INSERT` directos.
- **Edge function `shipment-reminders`**: cron-like, corre con service role, sin control de rol de usuario (se asume trigger externo por scheduler). Genera alertas de recordatorio los días 9 y 24 de cada mes para incidencias con envío pendiente a administración.

### Permisos
- `Create incidents`: solo el propio `reported_by` (`auth.uid() = reported_by`).
- `View incidents` / `Update incidents`: autenticados (con posible refinamiento posterior por sucursal en migraciones más recientes, no confirmado explícitamente para esta tabla en el barrido de RLS final).

### Archivos
`src/pages/Incidencias.tsx`, `src/components/incidencias/CrearIncidencia.tsx`, `supabase/functions/shipment-reminders/index.ts`

---

## Documentos (Trazabilidad documental)

### Propósito y por qué existe
Da seguimiento a documentos físicos/administrativos (facturas, remitos, facturas firmadas, notas de crédito, comprobantes de entrega) a lo largo de la cadena logística. Existe porque un documento en papel (por ejemplo, una factura que debe volver firmada por el cliente) tiene su propio ciclo de vida y ubicación, independiente de la mercadería: puede quedar "con el chofer" mientras la carga ya fue entregada, o viajar de vuelta a administración para cobranza.

### Flujo paso a paso (según lo observable en el frontend, de solo lectura)
1. Se listan hasta 50 `tracked_documents` más recientes, con su sucursal de ubicación actual.
2. Cada fila muestra: número de documento, tipo (`DOC_TYPE_LABELS`: factura, remito, factura firmada, nota de entrega), sucursal de ubicación, estado (vía `DOCUMENT_STATUS_CONFIG`/`StatusBadge`), próximo evento esperado (`expected_next_event`) y fecha de emisión.
3. El módulo actual (`Documentos.tsx`) es puramente de consulta: no se observan acciones de creación/edición de documentos en esta página; los tracked_documents se generan y transicionan desde otros puntos del sistema (fulfillment, recepción, cobranzas) que no forman parte del alcance de archivos revisado para esta página.

### Estados (document_status, enum de base)
| Estado | Significado |
|---|---|
| issued | Documento emitido |
| with_driver | En poder del chofer |
| delivered_to_client | Entregado al cliente |
| signed_by_client | Firmado por el cliente |
| with_admin | De vuelta en administración |
| sent_to_collector | Enviado a cobrador |
| received_by_collector | Recibido por cobrador |
| presented_to_client | Presentado al cliente (cobranza) |
| collection_scheduled | Cobranza programada |
| collection_completed | Cobranza completada |
| archived | Archivado (fin de ciclo) |

### Reglas de negocio y validaciones
- El KPI "Activos" cuenta todo documento cuyo estado no sea `archived`.
- No se identificó, dentro de los archivos en alcance, lógica de validación adicional (plazos, alertas) para documentos; a diferencia de Incidencias, este módulo no muestra evidencia de recordatorios automáticos propios.

### Tablas
`tracked_documents` (columnas: `document_type`, `document_number`, `branch_request_id`, `fulfillment_order_id`, `trip_id`, `status`, `current_holder_id`, `current_holder_role`, `current_location_branch_id`, `expected_next_event`, `expected_next_event_deadline`, `issued_at`, `signed_at`, `archived_at`, `bims_reference`, `notes`), `branches`

### RPC / triggers / edge functions
Ninguno identificado en el alcance de archivos revisado para esta página; es de solo lectura sobre datos escritos por otros procesos del sistema.

### Permisos
RLS `View documents`/`Manage documents`: usuario privilegiado, tenedor actual del documento (`current_holder_id`), acceso a la sucursal de ubicación actual, o acceso al `branch_request`/`fulfillment_order` asociado (vía `fn_can_access_request` / `fn_can_access_fulfillment`).

### Archivos
`src/pages/Documentos.tsx`

---

## Notas transversales del dominio

- **Custodia como concepto central**: casi todos los módulos de este dominio (Cumplimiento, Chofer, Recepción, Documentos) giran alrededor de dos campos que viajan juntos en `fulfillment_orders`/`branch_requests`/`tracked_documents`: `current_custody_holder_id` (quién tiene la mercadería/documento en la mano) y `current_location_branch_id`/`current_location_type` (dónde está físicamente). Esto permite trazabilidad punto a punto sin depender de un único "estado maestro".
- **Trazabilidad por eventos**: toda transición relevante en estos módulos se refleja en `operational_events`, con `category` clasificada por `event-categories.ts` (`categoryForTripEvent`). Esta tabla es la base de auditoría y de las vistas de historial (por ejemplo, la pestaña "Historial" del chofer).
- **Diseño "no bloqueante"**: un patrón repetido en el dominio es registrar excepciones/incidencias/documentación faltante como alertas visuales o entradas en `ai_anomalies`, sin frenar la operación logística de fondo (excepciones comerciales en Distribución, documentación BIMS faltante en retiro del chofer, recepción física sugerida en Recepción). El sistema prioriza mantener el flujo de mercadería en movimiento y resolver comercialmente en paralelo.
- **Automatizaciones por edge function**: las tres funciones de este dominio (`shipment-reminders`, `commercial-escalation`, `trip-eligible-drivers`) corren con `SUPABASE_SERVICE_ROLE_KEY` y no dependen de RLS; las dos primeras están pensadas como jobs programados (cron) que generan alertas en `ai_anomalies`, y la tercera es invocada bajo demanda desde el frontend para resolver choferes elegibles al crear/editar un viaje.

## Ventas — Catálogo del Vendedor

### Visión general del módulo

`src/pages/Ventas.tsx` es la página central del rol vendedor externo. Es un componente cliente (`VentasContent`) montado dentro de `SalesPresentationProvider` y solo se renderiza cuando `useAuth()` ya resolvió la sesión (`loading=false && user`), justamente para que todas las claves de persistencia por-usuario (carrito, filtros, pestaña activa, cliente) usen el `userId` correcto desde el primer render y no se pise un guardado bueno con un estado vacío inicial.

La pantalla se organiza en 4 pestañas persistidas (`Tabs` de shadcn) manejadas con `useIdbState`: `cliente`, `catalogo`, `carrito`, `pedidos`. Esto permite que el vendedor cierre la app o pierda señal y, al volver, siga exactamente donde estaba. Arriba de las pestañas hay una barra con:
- `EstadoConexion`: chip de conectividad y cola pendiente (ver sección offline).
- Botón "Catálogo PDF" (solo visible en la pestaña catálogo) que activa el modo selección múltiple de productos.
- Botón "Modo cliente / Modo vendedor" que alterna `SalesPresentationContext`.

Por qué existe: los vendedores externos (playeros/promotores de campo) visitan clientes sin conexión confiable a internet y necesitan armar pedidos ("pre-ventas") mostrando el catálogo en la pantalla del celular/tablet directamente al cliente, sin exponerle datos internos (stock exacto por depósito, código interno, etc.) y sin perder el trabajo si se corta la conexión o se cierra la app.

### Búsqueda y filtros por marca/categoría

Implementado en `CatalogoGrid.tsx`. El estado de filtros (`search`, `onlyStock`, `category`, `brand`) se guarda como un objeto único `CatalogViewState` en IndexedDB vía `useIdbState` con clave `${stateKey}-view`, donde `stateKey` es `sales-catalog-${userId}`. Esto asegura que cada vendedor recupere sus propios filtros al reabrir la app.

- El campo de búsqueda usa `useDebounce` (300ms) sobre `search`, filtrando por `name`, `bims_code` o `barcode` con `ilike` (OR) sobre la tabla `products`.
- El filtro "Con stock" agrega `gt("total_stock", 0)`.
- Categoría y marca se resuelven contra `facets`, obtenidos con `supabase.rpc("fn_catalog_facets")`, una función SQL `STABLE SECURITY DEFINER` que devuelve pares `(kind, value, total)` agregando `products` por `category` y por `brand` (esta última solo si tiene 3 o más productos, para evitar ruido de marcas sueltas). El resultado se cachea 10 minutos (`staleTime`) porque cambia poco.
- La marca usa un combobox tipo `Command`/`Popover` (buscador dentro del listado de marcas) porque puede haber decenas de marcas.
- Limpiar filtros resetea `category` y `brand` a `"all"` con un botón que solo aparece si hay algún filtro activo.

Reglas: todos los queries filtran siempre `is_active = true`; nunca se muestran productos inactivos. Cambiar cualquier filtro reinicia el punto de scroll guardado (ver más abajo).

Tablas: `products`. Función: `fn_catalog_facets()` (RPC, `SECURITY DEFINER`, revocada de `anon`, otorgada a `authenticated`/`service_role`).

Archivos: `src/components/ventas/CatalogoGrid.tsx`, `src/hooks/use-debounce.ts` (uso), `src/hooks/use-idb-state.ts`.

### Scroll infinito

El listado usa `useInfiniteQuery` de TanStack Query con páginas de `PAGE_SIZE = 48` productos, ordenados por `name`. `getNextPageParam` calcula el offset sumando filas ya cargadas contra el `count` exacto devuelto por Supabase (`{ count: "exact" }`). Un `IntersectionObserver` sobre un `div` centinela al final de la grilla dispara `fetchNextPage()` cuando el usuario se acerca (`rootMargin: "400px"`), evitando que el usuario vea un salto brusco de carga.

Por qué existe: el catálogo puede tener miles de productos; cargar todo de una sola vez sería lento y pesado en datos móviles.

**Recordar posición de scroll y páginas cargadas.** Además del scroll infinito normal, el componente persiste en IndexedDB (clave `${stateKey}-scroll`) cuántas páginas se cargaron y el `scrollTop` del contenedor con overflow (detectado subiendo por los `parentElement` hasta encontrar uno con `overflow-y: auto|scroll`). Al montar, si hay un estado guardado, dispara `fetchNextPage()` en bucle hasta reconstruir la cantidad de páginas que había (con tope de 40 páginas por seguridad) y luego reintenta fijar `scrollTop` varias veces (hasta 20 intentos con 150ms de espera) porque las imágenes van cambiando la altura del documento mientras cargan. Este mecanismo evita que el vendedor, al volver a la pestaña catálogo o reabrir la app, tenga que desplazarse de nuevo desde el principio. El guardado del scroll está debounced (300ms) y solo se activa después de que la restauración terminó, para no sobrescribir la posición guardada con un "0" del montaje inicial.

También existe "Seleccionar todo el filtro": cuando está activo el modo selección (para el catálogo PDF), un botón trae en lotes de 1.000 (`SELECT_ALL_BATCH`) todos los ids de productos que matchean el filtro actual, mostrando progreso ("Seleccionando X de Y").

Archivos: `src/components/ventas/CatalogoGrid.tsx`, `src/lib/offline-store.ts` (idbGet/idbSet).

### Ficha de producto

`ProductoFicha.tsx` es un diálogo grande (`Dialog` de shadcn) que se abre al tocar una card del catálogo (cuando no está en modo selección) o desde otros puntos con cantidad 0. Muestra:
- Imagen ampliable (zoom) vía `proxyImageUrl` (ver Availability e imágenes más abajo).
- Badge de stock total o `AvailabilityChip` según el modo de presentación.
- Tabla de "cantidad por sucursal", cruzando `stock_by_warehouse` (guardado en `products`) o el stock en vivo (`useLiveStock`) contra los nombres reales de sucursal (`useBranches`); depósitos ERP sin sucursal conocida se marcan como "depósito ERP" y se ocultan si además no tienen stock, para no generar ruido.
- Escalas de precio (ver debajo) y descripción expandible (`line-clamp-4` con "Ver más/menos" si supera 240 caracteres).
- Selector de cantidad con steppers +/-, input numérico y atajos rápidos (`QUICK_STEPS = [6,12,24]`).
- Precio total y por unidad, con indicación de ahorro si aplica una escala.
- Alerta si la cantidad ingresada supera el stock disponible (mensaje distinto según si el modo cliente oculta el dato exacto).

Por qué existe: centraliza toda la información de decisión de compra en un solo lugar, reutilizable tanto para agregar al carrito desde la grilla como desde el propio catálogo PDF.

Archivos: `src/components/ventas/ProductoFicha.tsx`, `src/lib/ventas.ts`, `src/hooks/use-live-stock.ts`, `src/hooks/use-branches.ts`.

### Escalas de precio y ahorro

La lógica de precios vive en `src/lib/ventas.ts` y se reutiliza en toda la superficie de ventas (grilla, ficha, carrito, PDF):

- `resolvePrice(product, customerPriceListId, quantity)` resuelve el precio en este orden de prioridad: (1) lista de precios fija del cliente si `product.price_lists` contiene una entrada cuyo `pricing_id` o `name` matchea `customerPriceListId`; (2) la escala de cantidad más alta que el `quantity` alcanza, buscando en `product.price_scales` (array de `{min_quantity, price}`); (3) `product.sell_price` como base.
- `getScales(product)` normaliza y ordena las escalas ascendentemente.
- `resolveScaleInfo(product, quantity)` devuelve la escala activa y la próxima disponible, usado para mostrar el cartel motivador "Agregá N más y bajás a Gs. X" tanto en la ficha como en cada fila del carrito (`CartItemRow`).
- `hasFixedListPrice` (calculado en `Ventas.tsx` al agregar el ítem) indica si el precio vino de una lista fija del cliente; en ese caso `priceForQuantity` (en `use-sales-cart.ts`) no recalcula por escalas al cambiar la cantidad, respetando el acuerdo comercial cerrado con ese cliente.

Por qué existe: es habitual que el mayorista tenga descuentos por volumen (escalas) y, en paralelo, algunos clientes grandes tengan una lista de precios negociada que debe primar sobre cualquier escala. El cartel de "ahorro" es una herramienta de venta: incentiva al vendedor y al cliente a subir la cantidad para llegar al próximo escalón de precio.

Tablas: `products` (columnas `sell_price`, `price_scales` jsonb, `price_lists` jsonb). No hay tabla separada de escalas: viven embebidas en `products`.

Archivos: `src/lib/ventas.ts`, `src/hooks/use-sales-cart.ts`, `src/components/ventas/ProductoFicha.tsx`, `src/components/ventas/CarritoPanel.tsx`.

### Stock en vivo por sucursal

`use-live-stock.ts` expone `useLiveStock(bimsCodes)`, que invoca la edge function `bims-stock-live` en lotes de 20 códigos (`CHUNK_SIZE`) vía `supabase.functions.invoke`, con `staleTime` de 30s y `gcTime` de 60s (para no golpear el ERP en cada apertura de ficha). Devuelve un mapa `bims_code -> {stock_by_warehouse, total_stock}`. Si falla, degrada silenciosamente a `null` y el resto de la UI usa el stock local ya persistido en `products` (`resolveStock`) como respaldo — importante porque el vendedor puede estar sin señal y aun así ver un número de stock razonable (el último sincronizado).

También existe `revalidateLiveStock`, una función imperativa (no-hook) pensada para revalidar justo antes de confirmar un pedido, aunque en el flujo actual de `ConfirmarVenta.tsx` no se invoca explícitamente: la validación de stock es informativa en la ficha, no bloqueante al cerrar la pre-venta (la pre-venta se puede confirmar igual; el ajuste real de stock ocurre después, en el proceso de preparación/logística, fuera de este módulo).

Un badge "En vivo" (ícono `Radio`) se muestra en la ficha cuando el dato viene de BIMS y no del snapshot local, y solo en modo vendedor (nunca en modo cliente).

Por qué existe: el stock guardado en `products.stock_by_warehouse` es un snapshot sincronizado periódicamente desde el ERP (BIMS); puede quedar desactualizado durante el día. Consultar en vivo, aunque sea solo al abrir la ficha de un producto puntual, reduce el riesgo de prometerle al cliente algo que ya no hay.

Archivos: `src/hooks/use-live-stock.ts`, edge function `bims-stock-live` (no incluida en el detalle de este documento salvo su contrato de I/O), `src/lib/ventas.ts` (`resolveStock` como fallback).

### Modo Cliente y peek

`SalesPresentationContext.tsx` es un contexto minimalista que guarda un booleano `clientMode` en `localStorage` (clave `movilog.sales.clientMode`), con `toggleClientMode()`. Se usa `localStorage` (no IndexedDB) porque es un ajuste de presentación instantáneo, no un dato de negocio que deba sobrevivir a limpiezas agresivas del navegador.

Cuando `clientMode = true`:
- El botón superior cambia a "Modo cliente" y el subtítulo indica "Catálogo en modo cliente".
- En `CatalogoGrid`, la marca visual de "En carrito" y ciertos datos internos se atenúan (el componente completo del grid recibe `clientMode` desde el contexto para adaptar detalles).
- En `ProductoFicha`, se ocultan: código interno (`bims_code`), código de barras, la tabla de "cantidad por sucursal", y el stock exacto se reemplaza por `AvailabilityChip` (ver debajo). El badge "En vivo" tampoco se muestra.

**Peek (vistazo de 5 segundos):** dentro de `ProductoFicha`, cuando `clientMode` está activo, el vendedor puede mantener presionado (pointer down) el chip de disponibilidad durante 600ms (`pressTimer`) para activar `peek`, que revela momentáneamente el detalle interno completo (stock exacto, código, sucursales) durante 5 segundos (`peekTimer`), tras lo cual vuelve a ocultarse solo. Se bloquea el menú contextual (`onContextMenu` prevenido) para que un long-press no dispare el menú nativo del navegador/celular. Esto le permite al vendedor consultar rápidamente un dato interno frente al cliente sin tener que salir del modo cliente y volver a entrar (lo cual además dejaría el toggle "abierto" y expuesto).

Por qué existe: la misma pantalla se usa para vender mostrándosela literalmente al cliente (mostrador/reunión) y para trabajo interno del vendedor; exponer stock exacto por depósito o códigos internos al cliente sería una fuga de información comercial sensible.

Archivos: `src/contexts/SalesPresentationContext.tsx`, `src/components/ventas/ProductoFicha.tsx`, `src/components/ventas/AvailabilityChip.tsx`.

`AvailabilityChip.tsx` traduce un número de stock a un semáforo de 3 niveles sin revelar la cantidad: `available` (>5, ícono check verde "Disponible"), `low` (1-5, ícono alerta ámbar "Últimas unidades"), `none` (≤0, ícono X rojo "Sin stock · consultar"). El umbral `LOW_STOCK_THRESHOLD = 5` es una constante exportada y reutilizable.

### Carrito persistente con notas

`use-sales-cart.ts` es un hook sobre `useIdbState` (clave `sales-cart-${userId}`) que mantiene el array `CartItem[]` en IndexedDB. Cada `CartItem` guarda no solo `productId/quantity/unitPrice`, sino también una copia de `priceScales`, `basePrice` y `hasFixedListPrice`, de forma que el recálculo de precio al cambiar cantidad (`priceForQuantity`) no dependa de volver a consultar el producto en el servidor: todo el cálculo es local y funciona sin conexión.

Operaciones expuestas: `addItem` (suma cantidades si el producto ya está, y recalcula el precio con `priceForQuantity` sobre la cantidad acumulada), `updateQuantity` (elimina el ítem si la cantidad llega a 0 o menos), `updateNotes`, `removeItem`, `clearCart`, además de `total` y `count` derivados.

**Notas por ítem:** cada fila del carrito (`CartItemRow` en `CarritoPanel.tsx`) tiene un botón de nota (ícono `StickyNote`) que abre un `Textarea` inline; al perder foco, si quedó vacío se limpia el campo. Sirve para anotar variantes, condiciones de entrega puntuales, etc., que viajan con el ítem hasta la pre-venta (`branch_request_items.notes`).

**Recuperación de carga en curso:** en `Ventas.tsx`, un `useEffect` con `useRef` (`restoreNotified`) muestra un único toast "Se recuperó tu carga en curso" la primera vez que el carrito termina de hidratarse (`cartHydrated`) y tiene ítems, para que el vendedor sepa explícitamente que no perdió nada al reabrir la app.

Un FAB flotante (bottom-right) muestra el ícono de carrito con badge de cantidad y el total, visible en cualquier pestaña salvo "carrito" mismo, cuando no hay un diálogo o modo de selección abierto; permite abrir `CarritoPanel` (un `Sheet` lateral) sin cambiar de pestaña.

Tablas relacionadas en el servidor (una vez confirmada la pre-venta): `sales_carts` y `sales_cart_items`, aunque en el flujo actual el guardado en `sales_carts` se hace como registro de trazabilidad (upsert por `client_uuid`) en `submitPreSale`, no como reflejo en vivo del carrito local mientras se arma (el carrito en curso vive solo en IndexedDB del dispositivo, nunca en el servidor, hasta que se confirma).

Archivos: `src/hooks/use-sales-cart.ts`, `src/components/ventas/CarritoPanel.tsx`, `src/lib/offline-store.ts`.

### Selección de cliente y cartera del vendedor

`ClientePicker.tsx` gestiona el objeto `CartCustomer` (`{id?, name, phone, email, address, ruc, priceListId}`), persistido también con `useIdbState` bajo `sales-customer-${userId}`.

Flujo de búsqueda (`runLocalSearch`): consulta `sales_customers` filtrando `is_active = true` y, si hay término, `ilike` sobre `name` o `ruc` (OR), limitado a 50 resultados. Si la búsqueda local no encuentra nada y el término tiene 3+ caracteres, intenta un fallback en vivo contra la edge function `bims-proxy` (`action=search-contacts`) para traer contactos existentes en el ERP BIMS que aún no se sincronizaron a `sales_customers`; si esa llamada tiene resultados, vuelve a correr la búsqueda local (asumiendo que el proxy ya persistió el contacto del lado servidor). Si el fetch falla (ej. sin conexión), se devuelve silenciosamente el resultado local vacío, sin romper la UI.

También permite dar de alta un cliente manual (`isManual`) con nombre, RUC, teléfono, email y dirección, sin pasar por BIMS; ese cliente se crea recién en el momento de confirmar la pre-venta (`submitPreSale`, con `source: "manual"`), no al completarlo en el formulario, para no ensuciar la base con clientes manuales abandonados.

**Cartera del vendedor:** la tabla `salesperson_customers` vincula `salesperson_id` con `customer_id` (con `UNIQUE(salesperson_id, customer_id)` y flag `is_active`), pensada para restringir o priorizar qué clientes ve/gestiona cada vendedor. Las políticas RLS de `sales_customers` permiten `SELECT` a cualquier usuario autenticado (`USING (true)`), es decir que el picker actual no filtra por cartera al buscar — cualquier vendedor puede ver y elegir cualquier cliente activo del catálogo comercial. La tabla `salesperson_customers` sí restringe su propio acceso: solo se ve/gestiona la fila si `salesperson_id = auth.uid()` o el usuario es `admin`/`supervisor`. En el código de `Ventas` revisado no se encontró un consumo directo de `salesperson_customers` (ni un hook ni query que la lea); queda como infraestructura de datos preparada para una futura vista de "mi cartera de clientes", pero hoy el picker de clientes no la usa: es una funcionalidad de modelo de datos existente y con RLS lista, pero sin UI conectada. Esto se documenta explícitamente porque el código no muestra ningún uso real de esa tabla en el flujo de Ventas actual.

Tablas: `sales_customers`, `salesperson_customers`.

Archivos: `src/components/ventas/ClientePicker.tsx`, `src/hooks/use-sales-cart.ts` (tipo `CartCustomer`).

### Cierre de pre-venta

`ConfirmarVenta.tsx` es el diálogo final antes de enviar el pedido. Pide: sucursal de origen (obligatoria, con lógica de preselección en cascada — `profile.default_branch_id`, luego única sucursal permitida, luego `lastBranchId` guardado en IDB, luego única entrada de `allowedBranchIds`), forma de envío (flota propia/courier/retiro/entrega a domicilio), forma de pago (contado/crédito/cheque/transferencia), costo de envío opcional y notas generales.

Al confirmar (`createOrder` mutation):
1. Guarda `selectedBranchId` como `lastBranchId` en IndexedDB (para agilizar el próximo pedido).
2. Encola el pedido en el outbox local (`enqueuePreSale`, ver sección offline) — esto ocurre siempre, haya o no conexión, porque es la única fuente de verdad hasta que se confirme el envío.
3. Si `navigator.onLine`, intenta enviarlo de inmediato (`processEntry`); si no hay red, queda como "queued".
4. Muestra un toast distinto según el resultado: pre-venta creada (envío inmediato exitoso), guardada sin conexión (quedará para reintento automático), o guardada con error puntual (igual queda en la cola, reintentable).
5. En éxito, dispara `onSuccess` en `Ventas.tsx`: limpia el carrito, resetea el cliente y cambia a la pestaña "pedidos".

Reglas de negocio: no se puede confirmar sin cliente, sin ítems, ni sin sucursal seleccionada. El pedido nunca se pierde ante error de red: el registro del outbox se mantiene y solo cambia de estado (`pending → sending → error/sent`).

Tablas del lado servidor al confirmarse: `branch_requests` (con `is_pre_sale = true`, `pre_sale_status = 'confirmed'`, `request_type = 'pre_sale_online'`, `sales_channel = 'vendedor_externo'`), `branch_request_items` (uno por producto del carrito), y `sales_carts` (upsert de trazabilidad por `client_uuid`, sin filas en `sales_cart_items` en este flujo — esa tabla existe en el modelo pero `submitPreSale` no inserta en ella).

Archivos: `src/components/ventas/ConfirmarVenta.tsx`, `src/lib/sales-outbox.ts`.

## Catálogo PDF para el Cliente

### Selección de productos para el catálogo

Desde la pestaña "Catálogo", el botón "Catálogo PDF" activa `selectionMode` en `CatalogoGrid`: las cards dejan de agregar al carrito al tocarlas y en cambio alternan su inclusión en un `Set<string>` de ids seleccionados (`selectedIds`), persistido como array en IDB (`sales-selected-ids-${userId}`) junto con el flag `selectionMode` (`sales-selection-mode-${userId}`). Cada card marcada muestra un checkmark superpuesto. También está disponible "Seleccionar todo el filtro" para armar catálogos masivos por categoría/marca sin tocar producto por producto.

Al terminar de elegir, "Generar" abre `CatalogoPdfPanel`.

### Generación del PDF

`CatalogoPdfPanel.tsx` orquesta la construcción del documento usando `src/lib/catalogo-pdf.ts` (basado en `jsPDF`). Carga los productos seleccionados en lotes de 200 (`BATCH`) vía `supabase.from("products").select("*").in("id", chunk)`. Opciones configurables por el vendedor:
- **Incluir fotos** (`showImages`): activa/desactiva la descarga e inserción de imágenes.
- **Mostrar precios** (`showPrices`) y, dependiente de esta, **mostrar escalas por cantidad** (`showScales`).
- **Ordenar por**: categoría y marca (default), nombre A-Z, o precio ascendente (`sortCatalogProducts`).
- **Nota para el cliente**: texto libre que aparece en la portada (ej. vigencia de precios).

El documento se arma con: header con logo de marca, título, fecha, datos del cliente (si hay uno seleccionado) y del vendedor (`salespersonName`, tomado de `profile.full_name`), grilla de 3 columnas por página con imagen, nombre, precio y escalas por producto, y un footer de marca (contacto, leyenda legal "Documento no fiscal", numeración de página/parte) repetido en todas las páginas.

Tablas: `products` (lectura). No hay tabla de "catálogos generados"; el PDF es un artefacto efímero (blob) que se descarga o comparte, no se guarda en el servidor.

### Modo sin fotos

Cuando `showImages = false`, el tamaño de parte sube de `CATALOG_PDF_PART_SIZE = 300` a `CATALOG_PDF_PART_SIZE_NO_IMG = 1000` productos por archivo, porque sin binarios de imagen el PDF es mucho más liviano. El costo estimado por ítem baja de `CATALOG_SEC_PER_ITEM_WITH_IMG = 0.35s` a `CATALOG_SEC_PER_ITEM_NO_IMG = 0.01s` (constantes usadas para calcular el ETA mostrado al usuario, `fmtEta`). A partir de `CATALOG_SUGGEST_NO_IMG_FROM = 500` productos seleccionados, el panel sugiere automáticamente (una sola vez por apertura) desactivar las fotos, mostrando además una alerta con el tiempo estimado con y sin fotos ("Con fotos va a tardar ≈ X. Sin fotos son ≈ Y").

Por qué existe: generar cientos de imágenes en el dispositivo (descarga + decodificación + reescalado + compresión JPEG) es lento y pesado en datos móviles; para catálogos grandes tipo "lista de precios completa", el modo sin fotos es la opción práctica para compartir por WhatsApp sin que el archivo pese demasiado ni tarde minutos.

### Partición en múltiples archivos

Si la cantidad de productos seleccionados supera el tamaño de parte vigente, `catalogPartSize(showImages)` determina cuántos productos entran por archivo y el panel arma automáticamente varios PDFs (`CatalogPart[]`), cada uno rotulado "Parte X de N" en portada y pie de página. Al compartir (`share()`) se intenta primero compartir todas las partes juntas vía Web Share API (`navigator.share`/`canShare`); si el sistema no admite compartir múltiples archivos a la vez, se comparte solo la Parte 1 y el resto se descarga automáticamente (con un pequeño delay escalonado entre descargas para no saturar el navegador) avisando al usuario por toast. Al descargar (`download()`) todas las partes se guardan con nombres de archivo distintos, con el mismo mecanismo de espaciado temporal.

### Compuerta de calidad de imágenes

El pipeline de imágenes (`prefetchCatalogImages` / `getImage` / `loadImage` en `catalogo-pdf.ts`) es deliberadamente estricto: descarga cada foto con `fetch` explícito (`mode: cors, credentials: omit, cache: no-store`) para evitar tanto canvases "contaminados" (tainted) como respuestas opacas cacheadas de instalaciones previas del PWA; valida que el `content-type` sea `image/*`, valida además la firma binaria real del archivo (`hasImageSignature`: cabeceras JPEG/PNG/GIF/WEBP) para descartar cuerpos corruptos o de error disfrazados de imagen, y decodifica preferentemente con `createImageBitmap` (más rápido/robusto) con fallback a `Image` + canvas. Cada etapa de fallo se clasifica (`fetch|http|mime|signature|decode|canvas`) y se reintenta una vez con un pequeño delay (250ms) antes de darse por vencido con esa imagen puntual.

Si al terminar la generación hubo fallos y el operador no marcó explícitamente "permitir fallas" (`allowImageFailures`), se lanza `CatalogImageQualityError` con un reporte (`ready`, `missingSource`, `failed[]`) y el PDF **no se entrega**: el panel muestra la alerta "PDF detenido para cuidar la calidad" con las opciones de Reintentar o Generar sin fotos. Esto es intencional: se prioriza que el vendedor nunca le entregue al cliente un catálogo con recuadros grises rotos sin darse cuenta, en vez de simplemente omitir en silencio las fotos que fallan.

Archivos: `src/lib/catalogo-pdf.ts`, `src/components/ventas/CatalogoPdfPanel.tsx`, `src/lib/image-utils.ts` (`proxyImageUrl`), edge function `bims-image-proxy`.

### Borradores de selección (`sales_catalog_drafts`)

Cada vez que se dispara una generación de PDF, el panel autoguarda la selección actual como borrador "Autoguardado catálogo" (`saveDraft`) antes de procesar imágenes, de forma que si la app se cierra a mitad de una generación larga (miles de fotos), la selección de productos no se pierde y puede recuperarse. El vendedor también puede guardar manualmente selecciones con nombre propio (ej. "Catálogo temporada verano"), reutilizando el mismo nombre para sobrescribir un borrador existente (comparación case-insensitive).

Cada fila de `sales_catalog_drafts` guarda: `user_id`, `name`, `product_ids` (array), `customer` (jsonb, snapshot del cliente activo al guardar), `filters` (jsonb, hoy enviado vacío `{}`) y `pdf_options` (jsonb con `showPrices/showScales/showImages/sortBy/note`). El panel lista los borradores del usuario (ordenados por `updated_at` desc) permitiendo restaurarlos (`onRestoreIds`, que repuebla `selectedIds`, reactiva `selectionMode` y vuelve a la pestaña catálogo) o borrarlos.

Por qué existe: armar una selección de cientos o miles de productos filtrando por categoría/marca lleva tiempo; guardar la selección permite reutilizarla en visitas futuras al mismo cliente o regenerar el PDF con otras opciones (por ejemplo, con precios distintos si cambia de lista) sin rehacer la selección manual.

Tablas: `sales_catalog_drafts` (RLS: cada usuario solo ve/gestiona sus propios borradores, filtrando por `user_id = auth.uid()` en las 4 políticas CRUD). Permisos: `GRANT SELECT, INSERT, UPDATE, DELETE` a `authenticated`.

Archivos: `src/components/ventas/CatalogoPdfPanel.tsx`.

### Proxy de imágenes BIMS

`supabase/functions/bims-image-proxy/index.ts` es una edge function que reenvía imágenes del servidor ERP BIMS (host fijo `190.128.128.182`, único permitido, con validación explícita del host para evitar que se use como proxy abierto — SSRF). Rechaza si el host no coincide (`403`) o si la URL es inválida (`400`). Verifica que la respuesta upstream sea efectivamente una imagen (`content-type` que empiece con `image/`), devolviendo `502` si no. Responde con headers CORS abiertos (`Access-Control-Allow-Origin: *`) y `X-Content-Type-Options: nosniff`.

Tiene dos políticas de caché según el `mode`:
- **Modo normal** (catálogo, fichas): `Cache-Control: public, max-age=86400, s-maxage=86400` (1 día), pensado para que el service worker del PWA (ver sección offline) pueda cachear agresivamente las miniaturas de producto.
- **Modo `pdf`** (`?mode=pdf`): `Cache-Control: no-store, no-cache, must-revalidate`, para forzar que cada generación de catálogo PDF traiga la imagen fresca del origen y no arrastre una respuesta opaca ya cacheada de una versión vieja del PWA (esto es justamente lo que exige la compuerta de calidad descrita arriba: sin una copia fresca, un fallo viejo podría "pegarse" indefinidamente).

`proxyImageUrl(url, requestId?, mode?)` (en `src/lib/image-utils.ts`, no detallado en extenso pero referenciado en todo el módulo) arma la URL hacia esta función, agregando parámetros de modo/`requestId` quesirven de cache-buster para el modo PDF.

## Trabajo sin Conexión (Offline)

### Filosofía general

Todo el módulo Ventas está diseñado bajo la premisa de que la conexión a internet es un lujo intermitente, no una garantía: los vendedores externos visitan clientes en zonas con señal débil o nula. La regla de oro, repetida en varios componentes y comentarios del código, es "nada se pierde": cualquier dato ingresado por el vendedor (filtros, carrito, cliente, pre-venta) se escribe primero en el dispositivo (IndexedDB) y recién después, si hay señal, se intenta sincronizar contra Supabase. Ningún flujo bloquea al usuario por falta de conexión salvo la imposibilidad física de traer datos que no existen localmente (ej. clientes nuevos vía BIMS).

### `useIdbState`: React state persistido

`use-idb-state.ts` es el hook base de toda la persistencia del módulo. Envuelve un `useState` normal pero lo hidrata desde IndexedDB al montar (por clave) y persiste cada cambio posterior. La particularidad importante es el manejo de la clave dinámica: mientras se está leyendo el valor guardado para una clave (`hydratedKey !== key`), el hook **no escribe nada**, evitando la condición de carrera donde, por ejemplo, la clave cambia de `sales-cart-undefined` a `sales-cart-<userId real>` apenas se resuelve la sesión, y un guardado prematuro con el estado inicial vacío pisaría el carrito real ya guardado para ese usuario. El hook expone `[value, setValue, hydrated]`, y varios componentes (`Ventas.tsx`, `CatalogoGrid.tsx`) usan explícitamente `hydrated`/`viewHydrated` para no disparar queries o efectos antes de tener el estado real.

Se usa para: pestaña activa, modo de selección PDF, ids seleccionados, cliente activo, carrito completo, filtros y scroll del catálogo, última sucursal usada en `ConfirmarVenta`.

Archivo: `src/hooks/use-idb-state.ts`, apoyado en `src/lib/offline-store.ts`.

### `offline-store.ts`: capa IndexedDB

Define un store dedicado (`movilogStore`, base `movilog-offline`, tabla `kv`) usando la librería `idb-keyval`, con funciones simples `idbGet/idbSet/idbDel` que nunca lanzan excepción hacia arriba (los errores se tragan con `console.warn`, salvo en `idbGet` que directamente devuelve `undefined`), para que un fallo de almacenamiento (cuota llena, navegador raro) nunca tumbe la UI.

También define `createIdbPersister()`, un `Persister` de `@tanstack/react-query-persist-client` que permite persistir el caché completo de React Query en IndexedDB bajo la clave `react-query-cache`. Esto es lo que le permite al catálogo de productos y a las listas de clientes ya consultadas seguir disponibles (aunque desactualizadas) incluso reabriendo la app completamente sin conexión, más allá de la caché HTTP del service worker.

### Estado de conexión

`use-online-status.ts` es un hook mínimo que refleja `navigator.onLine` y se actualiza escuchando los eventos globales `online`/`offline` del navegador. Es la fuente de verdad que consume `EstadoConexion.tsx` (chip visible en la barra superior de Ventas: "Sin conexión" en rojo, "Sincronizando (N)" en ámbar mientras hay pendientes o se está enviando, "En línea" en verde) y `useSalesOutbox`.

### Cola de envío idempotente (outbox)

El corazón de la resiliencia offline es `src/lib/sales-outbox.ts`, combinado con el hook `use-sales-outbox.ts`.

**Modelo de datos local:** cada `OutboxEntry` tiene `clientUuid` (generado con `crypto.randomUUID()` en el dispositivo), el `payload` completo de la pre-venta (`PreSalePayload`: cliente, ítems, sucursal, forma de envío/pago, costo de envío, notas, `userId`), un `status` (`pending|sending|error|sent`), contador de `attempts`, `lastError`, timestamps y, una vez enviado, el `requestId` del pedido creado en el servidor. Todo el array de entradas se guarda como un único valor en IndexedDB bajo la clave `sales-outbox-v1`, y cualquier mutación (`enqueuePreSale`, `patchEntry`, `removeEntry`) notifica a los `listeners` suscritos (patrón pub/sub simple) para que la UI se actualice reactivamente sin necesidad de refetch.

**Idempotencia:** `submitPreSale(clientUuid, payload)` primero consulta si ya existe un `branch_requests` con ese `client_uuid` (`.eq("client_uuid", clientUuid).maybeSingle()`); si existe, devuelve el `id` existente sin volver a insertar nada. Esto es crítico porque un mismo `OutboxEntry` puede reintentarse varias veces (por ejemplo, si la conexión se corta justo después de que el insert llegó al servidor pero antes de que la respuesta vuelva al dispositivo): sin esta verificación se duplicaría el pedido. El `client_uuid` viaja también hacia el upsert de `sales_carts` (`onConflict: "client_uuid"`), reforzando la idempotencia en esa tabla también.

**Procesamiento:** `processEntry(entry)` marca la entrada como `sending`, ejecuta `submitPreSale` y, según el resultado, la deja en `sent` (con `requestId`, `lastError: null`) o en `error` (incrementando `attempts` y guardando `lastError`) — pero **nunca la elimina** ante un fallo; el registro persiste hasta que el vendedor lo reintente manualmente y tenga éxito, o lo descarte explícitamente (`removeEntry`, con confirmación en la UI vía `AlertDialog`, marcado como acción irreversible). `processOutbox()` recorre todas las entradas no enviadas (`isUnsent`) una por una (nunca en paralelo, con un flag `processing` para evitar reentradas concurrentes) y solo corre si `navigator.onLine` es verdadero.

**Reintento con backoff:** `useSalesOutbox` calcula el máximo de `attempts` entre las entradas pendientes y programa un reintento automático con backoff exponencial escalonado: `BACKOFF_MS = [5s, 30s, 2min, 10min, 30min]` (tope en el último valor si se superan los intentos definidos). El flush también se dispara inmediatamente al montar y cada vez que `online` pasa a `true` (evento de reconexión). Además, el vendedor puede forzar un reintento puntual de una entrada específica desde `PendientesEnvio.tsx` (botón "Reintentar", deshabilitado si está sincronizando o sin conexión).

**UI de pendientes:** `PendientesEnvio.tsx`, visible en la pestaña "Pedidos", lista cada entrada no enviada con: nombre de cliente, cantidad de ítems y total, tiempo relativo desde que se guardó (`formatDistanceToNow`), badge de estado (Pendiente/Enviando/Con error), el último error si lo hubo, un detalle expandible de productos, y las acciones Reintentar/Descartar. El texto explicativo es deliberadamente tranquilizador: "Estos pedidos están guardados en el dispositivo. Se envían solos cuando hay conexión y no se borran ante un error."

**Camino feliz vs. con cola:** en `ConfirmarVenta.tsx`, el flujo siempre pasa primero por `enqueuePreSale` (persistencia local garantizada) y solo después, si hay red, intenta el envío inmediato con `processEntry`; si ese envío inmediato falla (ej. error de validación del servidor, no de red), la entrada igual queda en la cola marcada como `error`, visible y reintentable desde "Pendientes de envío", en vez de mostrar un error fatal que obligue a rehacer todo el pedido.

Tablas del lado servidor tocadas por `submitPreSale`: `branch_requests`, `branch_request_items`, `sales_customers` (alta de cliente manual si no existía), `sales_carts` (upsert de trazabilidad).

Archivos: `src/lib/sales-outbox.ts`, `src/hooks/use-sales-outbox.ts`, `src/components/ventas/PendientesEnvio.tsx`, `src/components/ventas/EstadoConexion.tsx`, `src/components/ventas/ConfirmarVenta.tsx`.

### Service worker y caché de imágenes

La app usa `vite-plugin-pwa` (configurado en `vite.config.ts`) con `registerType: "autoUpdate"` e `injectRegister: null` (el registro se hace a mano, no automáticamente por el plugin). El `workbox` generado precachea (`globPatterns`) todos los assets estáticos de build (`js, css, html, ico, png, svg, woff2`), con un límite de tamaño de archivo a cachear de 6MB, y excluye explícitamente de la navegación offline las rutas de funciones (`navigateFallbackDenylist: [/^\/functions\//]`) para que las llamadas a edge functions nunca se resuelvan con el fallback de navegación del SW.

Dos estrategias de runtime caching:
1. **Navegación (HTML de la SPA):** `NetworkFirst` con `networkTimeoutSeconds: 5` bajo el cache `movilog-pages` — intenta red primero, y si no responde en 5 segundos, sirve la versión cacheada, permitiendo abrir la app aunque esté sin señal.
2. **Imágenes de producto** (proxy BIMS en modo no-PDF, o storage de Supabase): `CacheFirst` bajo el cache `movilog-product-images-v2`, con `expiration` de hasta 2.000 entradas y 30 días de antigüedad máxima, `cacheableResponse` limitado a status 200, y `fetchOptions: { mode: "cors", credentials: "omit" }` (mismo criterio CORS explícito que usa el generador de PDF, para evitar respuestas opacas). Es clave que este patrón excluya explícitamente `mode=pdf` (`url.searchParams.get("mode") !== "pdf"`): las descargas para el catálogo PDF nunca deben tocar esta caché, deben ir siempre a buscar la imagen fresca, coherente con la política `no-store` que la propia edge function `bims-image-proxy` define para ese modo.

Por qué existe esta separación: las miniaturas que se ven navegando el catálogo pueden (y deben) cachearse agresivamente para que la app sea usable sin conexión y cargue rápido; pero un catálogo PDF que se entrega formalmente al cliente no puede arriesgarse a incluir una imagen corrupta que quedó pegada en una caché vieja de una instalación anterior del PWA.

`src/lib/register-app-sw.ts` controla cuándo efectivamente se activa el service worker: se desactiva (y desregistra cualquier worker previo en `/sw.js`) si la build no es de producción, si la app corre dentro de un iframe (`window.self !== window.top`, típico de entornos de preview/editor), si el hostname pertenece a alguno de los dominios de preview conocidos (Lovable), o si la URL trae el parámetro `?sw=off`. Solo en producción "real" se llama a `registerSW({ immediate: true })` de `virtual:pwa-register`. Esto evita que el entorno de desarrollo/preview quede atrapado sirviendo assets viejos desde una caché de service worker.

Archivos: `vite.config.ts`, `src/lib/register-app-sw.ts`, `supabase/functions/bims-image-proxy/index.ts`.

### `pdf-image.ts`: utilidad de imágenes livianas (uso limitado)

`src/lib/pdf-image.ts` define `fetchProductImageForPdf`/`fetchProductImagesForPdf`, un helper más simple y antiguo que el pipeline de `catalogo-pdf.ts`: reduce imágenes a 64px de lado mayor, calidad JPEG 0.6 con fallback a 0.4 y timeout de 3s/2s, cache en memoria por sesión (no persistente), y placeholder gris con el código del producto si todo falla. Está documentado en su propio comentario de cabecera como pensado para "Pre Venta Online". A diferencia del pipeline de `catalogo-pdf.ts`, no hace fetch explícito con `mode: cors` sino que carga la imagen directamente con `new Image()` (`img.crossOrigin = "anonymous"`), por lo que es más simple pero también más expuesto a los problemas de canvas contaminado que el pipeline nuevo evita a propósito. Revisando el uso actual del módulo Ventas, `CatalogoPdfPanel.tsx` y `catalogo-pdf.ts` no importan este archivo: la generación real del catálogo usa exclusivamente su propio pipeline de imágenes (`getImage`/`loadImage` en `catalogo-pdf.ts`). `pdf-image.ts` queda documentado aquí como una utilidad presente en el código con un propósito declarado similar, pero sin consumidores activos localizados dentro de los archivos de Ventas revisados; puede tratarse de código de una iteración anterior o pensado para otro flujo de PDF no cubierto en esta revisión.

### Resumen de resiliencia por capa

| Capa | Mecanismo | Sobrevive a |
|---|---|---|
| Filtros, pestaña activa, selección | `useIdbState` → IndexedDB | Cierre de app, recarga, pérdida de red |
| Carrito con notas | `useSalesCart` sobre `useIdbState` | Cierre de app, recarga, pérdida de red |
| Cliente elegido/manual | `useIdbState` | Cierre de app, recarga |
| Catálogo de productos y clientes ya vistos | Persister de React Query sobre IndexedDB + cache HTTP del SW | Sin conexión, reapertura de la app |
| Imágenes de catálogo (no PDF) | Service worker `CacheFirst` | Sin conexión |
| Pre-venta confirmada | Outbox (`sales-outbox-v1`) con reintento y backoff | Pérdida de red al confirmar, cierre de app con envíos pendientes |
| Duplicados por reintento | `client_uuid` + verificación idempotente en `submitPreSale` | Reintentos manuales o automáticos repetidos |
| Selección de catálogo PDF en generación larga | Autoguardado en `sales_catalog_drafts` | Cierre de app a mitad de generación |

Esta arquitectura en capas es la que permite que "Ventas" funcione de punta a punta —desde abrir el catálogo hasta cerrar una pre-venta y generar un PDF— en condiciones de conectividad pobre o nula, con la garantía explícita (repetida en varios mensajes de la UI) de que ningún dato cargado por el vendedor se pierde silenciosamente.

## Flota y Control de Móviles

### Propósito y por qué existe

El módulo de Flota (`src/pages/Flota.tsx`) centraliza todo lo relacionado a los vehículos de la empresa: qué unidades existen, quién las está usando en cada momento, cuánto combustible consumen, qué mantenimientos tienen programados, qué multas acumulan y si están prestadas entre sucursales. Existe porque MoviLog necesita trazabilidad dura de kilometraje y responsabilidad del chofer sobre cada uso del vehículo (para evitar uso indebido, cargar combustible sin justificación, o perder el rastro de quién manejó y cuándo). El diseño se apoya en fotos obligatorias de odómetro y comprobantes para que cada registro tenga evidencia verificable, no solo un dato tipiado.

Roles: cualquier usuario autenticado con ficha de chofer activa (tabla `drivers`) o rol `admin`/`supervisor`/`owner` puede ver vehículos y operar viajes/combustible según las políticas RLS. Las pestañas de "Reportes" y "Configuración" solo se muestran a usuarios privilegiados (`isOwner || hasRole("admin") || hasRole("supervisor")`), determinado en el propio componente `Flota.tsx`.

### Vehículos (tabla `vehicles`)

Ficha maestra de cada unidad: patente (`plate`, única), marca, modelo, año, apodo (`nickname`), sucursal asignada (`assigned_branch_id`), kilometraje actual (`current_mileage`), vencimientos de VTV y seguro, estado (`vehicle_status`: available, in_route, in_trip, maintenance, out_of_service) y flag `is_active` para borrado lógico.

- Alta/edición: componente `VehicleForm.tsx`, solo visible para usuarios privilegiados (botón "Nuevo vehículo" e ícono de lápiz condicionados a `isPrivileged`).
- El estado "efectivo" que se muestra en la lista no es solo `status`: `Flota.tsx` calcula `effectiveStatus(v)` cruzando con la existencia de un viaje abierto (`vehicle_usages.status = 'open'`) para mostrar "En viaje" aunque el campo `status` de la tabla siga en "available". Esto evita tener que sincronizar manualmente el estado del vehículo cada vez que se abre o cierra un viaje.
- Alertas de documentación: la pantalla calcula localmente `overdueVtv` y `overdueInsurance` comparando `vtv_expiry`/`insurance_expiry` con la fecha actual, y las destaca en un bloque rojo arriba del listado.
- Permisos (RLS): "View vehicles" permite ver si `fn_is_fleet_manager(auth.uid())` es verdadero (privilegiado o tiene ficha de chofer activa) o si el usuario tiene acceso a la sucursal asignada (`can_access_branch`). "Manage vehicles" (insert/update/delete) requiere rol `admin` o `supervisor`.
- Archivos: `src/pages/Flota.tsx`, `src/components/flota/VehicleForm.tsx`.

### Usos de vehículo / flujo de dos pasos Iniciar → Terminar viaje (tabla `vehicle_usages`)

Este es el corazón operativo del control de móviles. Existe para que quede constancia de cada trayecto interno (reparto, trámite, uso administrativo, etc.), separado del módulo de "Viajes" logísticos formales (`trips`), que es otro circuito. Se modela como un ciclo de vida de dos pasos obligatorios:

**Paso 1 — Iniciar viaje** (`VehicleUsageForm.tsx`, botón "Iniciar viaje" en `Flota.tsx`):
1. El usuario elige el vehículo. El formulario busca si ese vehículo ya tiene un uso con `status = 'open'` (`vehicle-open-trip` query); si existe, bloquea el envío y muestra advertencia "Este vehículo ya tiene un viaje abierto. Terminalo primero." Esto es reforzado también a nivel de base de datos con el índice único parcial `uniq_vehicle_open_trip` sobre `vehicle_id WHERE status='open'`, es decir, es imposible tener dos viajes abiertos simultáneos para la misma unidad aunque el frontend fallara.
2. El chofer se autocompleta: el formulario resuelve la ficha de chofer del usuario en sesión (`drivers` por `user_id`) y muestra su nombre en un campo de solo lectura (no editable); si el usuario no tiene ficha de chofer, se guarda igual el nombre como texto libre en `driver_name_text`.
3. Se elige categoría de uso (`vehicle_usage_categories`, obligatoria) y destino (texto libre, obligatorio).
4. Se ingresa el kilometraje inicial. El formulario trae el último kilometraje conocido del vehículo (del último `vehicle_usages` o, si no hay historial, `vehicles.current_mileage`) y advierte (sin bloquear) si el valor ingresado es menor al último registrado.
5. Se sube la foto del odómetro inicial (`FileUpload` a bucket `vehicle-photos`, carpeta `usages/{vehicleId}/start`, con URLs firmadas). Esta foto es obligatoria para habilitar el botón de envío.
6. La fecha/hora de inicio (`started_at`) **no la tipea el usuario**: se autocompleta al momento de subir la foto (`useEffect` que dispara `toLocalDatetimeInput()` cuando `startPhoto` cambia y `startedAt` está vacío), y el campo queda deshabilitado en la UI. Esto asegura que la fecha registrada corresponda al momento real de la evidencia fotográfica, no a un valor manipulable después.
7. Al enviar, se inserta en `vehicle_usages` con `status: "open"`.

**Paso 2 — Terminar viaje** (`CloseTripModal.tsx`, accedido desde el botón "Terminar viaje" en `Flota.tsx` o desde `OpenTripsSection.tsx`):
1. Se lista a los viajes abiertos (`OpenTripsSection`, refetch cada 60s) mostrando patente, categoría, destino, chofer, hora de inicio y kilometraje inicial. Si el viaje lleva más de 24 horas abierto se marca con badge "+24h" en rojo.
2. Solo puede cerrar el viaje: un usuario privilegiado (admin/supervisor/owner), el chofer dueño del viaje (`driver.user_id === user.id`) o quien lo creó (`created_by === user.id`). Si no cumple, el botón "Terminar viaje" aparece deshabilitado con tooltip explicativo.
3. Se ingresa kilometraje final; debe ser mayor o igual al inicial (validado en frontend y reforzado por el `CHECK` `vehicle_usages_check` en la base).
4. Se sube foto del odómetro final (obligatoria, mismo patrón de bucket `usages/{vehicleId}/end`).
5. La fecha de fin (`ended_at`) se autocompleta igual que en el inicio, al subir la foto, y queda de solo lectura.
6. Al guardar se actualiza el registro con `end_mileage`, `ended_at`, `end_odometer_photo_path`, `status: "closed"`, `closed_at`, `closed_by`.

Reglas y validaciones adicionales a nivel de base:
- Trigger `trg_vu_enforce_status` (función `fn_vu_enforce_status`) impide cerrar (`status='closed'`) un uso si falta `end_mileage`, `ended_at` o `end_odometer_photo_path`; lanza excepción SQL, es la última barrera aunque alguien intente cerrar por API directa.
- Columna generada `km_traveled = end_mileage - start_mileage` (almacenada), calculada automáticamente por Postgres.
- Trigger `trg_vu_recompute_mileage` (función `fn_trg_recompute_mileage`, que llama a `fn_recompute_vehicle_mileage(vehicle_id)`) se dispara en cada insert/update de `vehicle_usages` y recalcula `vehicles.current_mileage` como el máximo entre el kilometraje actual y los máximos de `end_mileage`/`start_mileage` de usos, `mileage_at_fill` de cargas de combustible y los kilometrajes de `trips`. Es decir, el odómetro del vehículo nunca retrocede y siempre refleja el dato más alto reportado por cualquier fuente.
- Políticas RLS de `vehicle_usages`: cualquier autenticado puede leer (`vu_select` con `USING (true)`); inserción permitida a privilegiados o al propio chofer (`vu_insert`, valida que el `driver_id` insertado corresponda al chofer logueado); actualización a privilegiados o a quien creó el registro (`vu_update`); borrado solo a privilegiados.
- Archivos: `src/components/flota/VehicleUsageForm.tsx`, `src/components/flota/CloseTripModal.tsx`, `src/components/flota/OpenTripsSection.tsx`.

### Categorías de uso (`vehicle_usage_categories`)

Catálogo simple (nombre, descripción, activo/inactivo) que clasifica los motivos de uso del vehículo (ej. reparto, trámite, uso administrativo). Se administra desde `UsageCategoryManager.tsx`, visible solo en la pestaña "Configuración" para usuarios privilegiados. RLS: lectura abierta a autenticados, gestión (insert/update/delete) restringida a admin/supervisor/owner (`vuc_manage`).

### Combustible (tabla `fuel_records`)

Registra cada carga de combustible por vehículo y chofer. Existe para controlar el gasto real de combustible, detectar caídas de rendimiento (posible robo/desvío) y alimentar la rendición del chofer.

- Formulario `FuelRecordForm.tsx` (botón "Cargar combustible" en `Flota.tsx`, y también reutilizado desde Rendición): vehículo, fecha, kilometraje al momento de la carga, litros, estación, precio por litro y total (calculados bidireccionalmente: si cambia litros y precio se recalcula el total, y viceversa), foto obligatoria del comprobante/surtidor.
- Chofer: por defecto se autoasigna la ficha de chofer del usuario logueado; si el usuario tiene rol admin/supervisor/owner puede elegir otro chofer de una lista (`allDrivers`). Si el usuario no tiene ficha de chofer todavía, el formulario llama a la función `fn_ensure_driver_for_user(_user_id)` vía RPC para crear (o reactivar) automáticamente su registro en `drivers`, siempre que quien ejecuta la acción tenga rol operativo habilitante (admin, supervisor, jefe_logistica u owner) y el usuario destino sea elegible (operador de depósito, chofer o jefe de logística). Esta función es `SECURITY DEFINER` y valida explícitamente los roles antes de insertar, para que un usuario común no pueda auto-otorgarse una ficha de chofer sin pasar por alguien con permiso.
- Rendimiento histórico: el formulario consulta las últimas 20 cargas con `computed_efficiency_kmpl` no nulo del vehículo y muestra el promedio; si la carga nueva cae más del 20% respecto al promedio se advierte al usuario (mensaje informativo, no bloqueante).
- Trigger de eficiencia: la función `fn_compute_fuel_efficiency()` corre antes de insertar/actualizar `fuel_records` y calcula `computed_efficiency_kmpl` = (kilometraje de esta carga − kilometraje de la carga anterior del mismo vehículo) / litros cargados, solo si hay una carga previa con kilometraje menor; si no hay dato previo válido, el campo queda nulo. Esto es lo que permite detectar anomalías de consumo sin intervención manual.
- Cada carga también dispara `trg_vu_recompute_mileage`-equivalente sobre `fuel_records` (mismo mecanismo de recomputar `vehicles.current_mileage`).
- Permisos: no se relevó una política RLS explícita separada para `fuel_records` en esta revisión más allá de las mostradas en pantalla (las cargas del chofer se ven filtradas por `driver_id` en las consultas de Rendición); el control de "quién puede cargar a nombre de quién" se resuelve en el frontend con `canPickDriver`.
- Archivos: `src/components/flota/FuelRecordForm.tsx`.

### Mantenimiento (tabla `vehicle_maintenance`)

Gestiona el mantenimiento preventivo y correctivo de cada vehículo: tipo, descripción, fecha/kilometraje programado, proveedor/taller, costo, y al completarse, fecha y kilometraje real de servicio.

- Formulario `MaintenanceForm.tsx`: permite crear o editar un registro. Exige vehículo, descripción, y al menos fecha o kilometraje programado. Incluye umbrales de alerta configurables (`alert_km_threshold`, por defecto 500 km; `alert_days_threshold`, por defecto 7 días) y campos de recurrencia (`recurrence_km`, `recurrence_days`) para mantenimientos periódicos (ej. cambio de aceite cada 5000 km).
- Autoprogramación: el trigger `trg_maintenance_autoschedule` (función `fn_maintenance_autoschedule`) se dispara al pasar un registro a `status = 'completed'`. Si tiene `recurrence_km` o `recurrence_days` definidos, crea automáticamente el siguiente mantenimiento programado (con `parent_maintenance_id` apuntando al que se acaba de completar) usando el kilometraje/fecha de servicio más el intervalo de recurrencia, evitando duplicar si ya existe un hijo generado.
- `MaintenanceAlertsBadge.tsx` muestra en la lista de vehículos un badge de alerta cuando un mantenimiento está próximo o vencido según los umbrales configurados, comparando contra `current_mileage` del vehículo.
- Permisos: lectura permitida a privilegiados o al chofer cuyo vehículo asignado (`drivers.assigned_vehicle_id`) coincide; gestión (insert/update/delete) restringida a admin/supervisor.
- Archivos: `src/components/flota/MaintenanceForm.tsx`, `src/components/flota/MaintenanceAlertsBadge.tsx`.

### Multas (tabla `vehicle_fines`)

Registra infracciones de tránsito asociadas a un vehículo y, opcionalmente, a un chofer: número de multa, fecha, lugar, tipo de infracción, monto, vencimiento, estado (`fine_status`: pending/paid/appealed/cancelled) y comprobante de pago.

- Formulario `FineForm.tsx`: al marcar estado "Pagada" se habilita carga de comprobante de pago y se completa `paid_by` con el usuario en sesión.
- Permisos RLS: lectura para privilegiados o para el chofer al que está asignada la multa (`is_own_driver`); alta y edición para admin/supervisor/owner (la actualización también la puede hacer el propio chofer asignado, por ejemplo para subir el comprobante de pago); borrado solo admin/owner.
- Se listan en `FinesList.tsx` dentro de la pestaña "Multas" de `Flota.tsx`.
- Archivos: `src/components/flota/FineForm.tsx`, `src/components/flota/FinesList.tsx`.

### Fotos de vehículo (`VehiclePhotoGallery.tsx`, storage bucket `vehicle-photos`)

Galería de fotos generales del vehículo (no las de odómetro/comprobantes, que van con carpetas dedicadas dentro del mismo bucket). El componente `SignedImg.tsx` resuelve URLs firmadas para mostrar imágenes privadas del bucket sin exponerlas públicamente.

### Préstamos entre sucursales (tabla `vehicle_loans`)

Permite gestionar el préstamo temporal de un vehículo de una sucursal (`lending_branch_id`) a otra (`borrowing_branch_id`): quién lo solicita, quién lo aprueba, fechas y kilometrajes de inicio y devolución, estado (`vehicle_loan_status`: requested y otros estados del ciclo de préstamo). Permisos: solo pueden ver/gestionar usuarios privilegiados o con acceso a alguna de las dos sucursales involucradas (`can_access_branch`).

### Reportes (`FleetDashboard.tsx`)

Pestaña "Reportes", visible solo para usuarios privilegiados, con indicadores agregados de la flota (no se detalla su contenido interno en esta revisión, pero se referencia como el tablero gerencial del módulo).

### Función `fn_is_fleet_manager`

Determina si un usuario es "gestor de flota": devuelve verdadero si el usuario es privilegiado (`is_privileged`) o si tiene una ficha activa en `drivers`. Se usa en la política de SELECT de `vehicles` para que cualquier chofer activo pueda ver el listado completo de vehículos (no solo el que tiene asignado), lo cual es necesario porque un chofer puede iniciar un viaje con cualquier unidad disponible, no solo con la suya.

### Edge Function `fleet-daily-alerts`

Job programado que corre server-side (con `service_role`, sin restricciones de RLS) y genera alertas centralizadas en la tabla `ai_anomalies` con área `logistics`. No modifica datos operativos, solo crea anomalías para el panel de alertas de la aplicación. Antes de insertar, verifica que no exista ya una anomalía abierta (`is_acknowledged = false`) del mismo `anomaly_type` para la misma entidad afectada, evitando duplicados si el job corre más de una vez al día. Genera cuatro tipos de alerta:
1. **Mantenimientos** (`maintenance_overdue` / `maintenance_upcoming`): recorre mantenimientos en estado `scheduled` o `in_progress` y compara fecha/kilometraje programado contra hoy y el kilometraje actual del vehículo, usando los umbrales configurados en cada registro; si ya pasó la fecha o el kilometraje, severidad "critical"; si está dentro del umbral, "warning".
2. **Multas vencidas** (`fine_overdue`): multas `pending` cuyo `due_date` ya pasó, severidad "critical".
3. **Documentación vencida o próxima a vencer** (`vtv_expiring`, `insurance_expiring`): VTV o seguro que vencen dentro de 15 días; "critical" si ya venció, "warning" si es próximo.
4. **Viajes abiertos por más de 24 horas** (`trip_open_overdue`): usos de vehículo (`vehicle_usages`) con `status='open'` iniciados hace más de 24 horas, severidad "warning".

Archivo: `supabase/functions/fleet-daily-alerts/index.ts`.

## Rendición

### Propósito

Es la vista personal del chofer: acá cada chofer registra y consulta sus propios movimientos de dinero y gastos asociados a los viajes que realiza (cobranzas a clientes, depósitos bancarios, combustible y viáticos), para poder rendir cuentas de manera ordenada. Existe porque el chofer que reparte mercadería suele cobrar en efectivo/cheque/transferencia directamente al cliente y necesita un registro digital de ese dinero hasta que lo deposita, además de justificar los gastos de combustible y viáticos que se le adelantan o reembolsan.

Toda la pantalla gira en torno al `driverId` del usuario en sesión, resuelto contra `drivers.user_id`; si el usuario no tiene ficha de chofer, ninguna de las queries se ejecuta (`enabled: !!driverId`).

### KPIs y saldo

La cabecera calcula en el cliente: total cobrado (`driver_collections`), total depositado (`bank_deposits`), total gastado en combustible (`fuel_records` del chofer) y total de viáticos (`per_diem_records` del chofer), y deriva un "saldo" = cobrado − depositado, mostrando si el chofer tiene plata pendiente de depositar o a favor.

### Viajes pendientes de rendición

Se listan los viajes (`trips`) del chofer con `status = 'completed'` y `settlement_status = 'pending'`, para recordarle que todavía tiene rendiciones abiertas.

### Combustible y viáticos

- **Combustible**: reutiliza el mismo flujo y formulario que en Flota (`FuelRecordForm.tsx`), filtrado por chofer. Ver reglas en la sección A (foto de comprobante obligatoria, cálculo bidireccional de precio/total, eficiencia calculada por trigger).
- **Viáticos** (`per_diem_records`): concepto, monto, fecha, comprobante opcional (`receipt_photo_url`) y aprobación (`approved_by`/`approved_at`, que se completa desde el circuito administrativo, no desde esta pantalla). Política RLS de inserción es permisiva (`WITH CHECK (true)`), es decir, cualquier autenticado puede insertar un viático (la app en la práctica lo asocia siempre al `driver_id` del usuario en sesión), mientras que la lectura sí está restringida a privilegiados o al propio chofer (`is_own_driver`).

### Cobranzas del chofer (`driver_collections`)

Cada cobro registrado por el chofer a un cliente: monto, método de pago (efectivo, cheque, transferencia), número de cheque o referencia de transferencia, vinculado opcionalmente a un viaje (`trip_id`) y a una orden de cumplimiento (`fulfillment_order_id`). RLS: el chofer solo ve y gestiona sus propias cobranzas (`is_own_driver`); privilegiados ven todas.

### Depósitos bancarios (`bank_deposits`)

Cuando el chofer deposita en el banco el dinero cobrado, registra el depósito: banco, fecha, monto, comprobante (`receipt_url`). Un depósito puede quedar "verificado" por un administrador (`verified_by`/`verified_at`), aunque esa verificación no se gestiona desde esta pantalla del chofer.

### Vinculación cobro ↔ depósito (`deposit_collection_links`)

Como un depósito bancario puede agrupar varios cobros (y un cobro puede depositarse en partes), existe esta tabla puente con `deposit_id`, `collection_id` y `amount` (el monto de ese cobro específico que fue cubierto por ese depósito). Desde la pestaña "Depósitos" el chofer puede abrir el diálogo "Vincular cobros" para asociar sus cobranzas pendientes a un depósito ya registrado. La UI calcula, por cada cobro, si está "Vinculado" (monto enlazado ≥ monto del cobro) o "Parcial" (enlazado > 0 pero menor al monto total), y por cada depósito muestra cuántos cobros y qué monto tiene enlazado. RLS: solo puede vincular quien es dueño del depósito (`is_own_driver` sobre `bank_deposits.driver_id`) o un privilegiado.

Archivos: `src/pages/Rendicion.tsx` (contiene además, más abajo en el archivo —no listado en el extracto—, los formularios internos `CollectionForm` y `DepositForm` usados en los diálogos de alta).

## Cobranzas

### Propósito

Es la contraparte administrativa de Rendición: acá supervisores/administradores revisan, concilian y cierran las rendiciones que cada chofer generó por viaje, comparando lo cobrado contra lo depositado y contra los gastos (combustible + viáticos), y gestionando adelantos de dinero entregados al chofer. Existe para que la conciliación de caja de los choferes no dependa de planillas externas y quede auditada con fecha y responsable de revisión.

### Rendiciones por viaje (`driver_settlements`)

Cada fila representa la rendición de un viaje específico de un chofer: totales acumulados de cobranzas, combustible, viáticos, otros gastos, monto neto, estado (`pending` → `reviewed`/`approved` → `closed`), adelanto entregado (`advance_amount`) y si ya fue conciliado (`advance_reconciled`), además de instrucciones de depósito del administrador y comprobante asociado. La pantalla organiza las rendiciones en tres bandejas mediante pestañas: "Pendientes" (`status = pending`), "Revisados" (`reviewed`/`approved`) y "Cerrados" (`closed`).

### Viajes sin rendición

Se calcula por separado (`unsettled-trips`) la lista de `trips` completados cuyo `settlement_status` sigue en `pending`, como alerta de viajes que ni siquiera generaron todavía una fila en `driver_settlements`, para que el administrador pueda hacer seguimiento y exigir la rendición al chofer.

### Flujo de revisión

Al hacer clic en una rendición se abre un diálogo de detalle que recalcula en vivo, cruzando por `trip_id` + `driver_id`:
- Cobranzas del viaje (`driver_collections`).
- Depósitos del viaje (`bank_deposits`).
- Enlaces cobro↔depósito de esos depósitos (`deposit_collection_links`), para detectar cobros sin vincular (`unlinkedCollections`), que se muestran como advertencia.
- Combustible del viaje (`fuel_records`).
- Viáticos del viaje (`per_diem_records`).

Con esos datos se recalculan en el cliente: saldo del chofer (cobrado − depositado − combustible − viáticos, "a rendir" si es positivo, "a favor" si es negativo) y, si hubo adelanto, la conciliación del adelanto (adelanto entregado − gastos rendidos en combustible/viáticos), indicando si hay que devolver saldo o si falta rendir más.

Acciones disponibles para el administrador:
- **Cambiar estado** (`updateSettlementStatus`): pasa la rendición a `reviewed`, `approved` o `closed`. Al aprobar o cerrar se registra `reviewed_by` y `reviewed_at` con el usuario y fecha actuales. Al cerrar (`closed`) además se actualiza el viaje asociado (`trips.settlement_status = 'closed'`, `settled_at`, `settled_by`), cerrando el círculo entre el módulo de viajes y el de rendición.
- **Registrar adelanto** (`setAdvance`): permite fijar o corregir el `advance_amount` de la rendición.

### Permisos

RLS de `driver_settlements`: lectura y escritura permitidas a privilegiados o al propio chofer dueño de la rendición (`is_own_driver`); en la práctica esta pantalla está pensada para uso administrativo (roles admin/supervisor/owner), mientras que la escritura del lado chofer ocurre indirectamente a través de sus registros de cobranza/depósito/gastos, no editando directamente `driver_settlements`.

Archivo: `src/pages/Cobranzas.tsx`.

## Stock Comprometido y Stock Especial

### Propósito

Este dominio existe para separar, dentro del inventario físico de cada sucursal, la porción de stock que **no está disponible para venderse o asignarse libremente** porque ya está reservada para algo (un pedido, un cumplimiento) o porque tiene un estado excepcional (dañado, en cuarentena, extraviado, etc.). Sin esta separación, el stock "libre" mostrado a otras áreas podría incluir unidades que en la práctica ya tienen un destino comprometido o que no son vendibles.

### Stock Comprometido — implementado (tabla `committed_stock`, pantalla `StockComprometido.tsx`)

Cada fila es una reserva de una cantidad (`quantity`) de un producto (`product_id`) en una sucursal (`branch_id`), con:
- `reserve_type` (`soft` o `hard`): una reserva "soft" es más flexible/informativa, mientras que "hard" es una reserva firme que bloquea de forma más estricta la disponibilidad (la distinción de comportamiento exacto entre ambos tipos no está implementada en esta pantalla, que solo los lista y cuenta; la lógica de qué hace cada tipo vive en otras partes del sistema que consumen `committed_stock`, no relevadas en este documento).
- `reserve_reason`: motivo de la reserva (tipo enumerado `reserve_reason`), mostrado en la tabla con guiones bajos reemplazados por espacios.
- `expires_at` / `is_expired`: una reserva puede tener vencimiento; si `is_expired` es verdadero se marca en rojo como "Expirada" en la columna correspondiente.
- `branch_request_id` / `fulfillment_order_id`: vínculo opcional al pedido de sucursal o a la orden de cumplimiento que originó la reserva.
- `released_at` / `released_by` / `release_reason`: cuando la reserva se libera, deja de contar como comprometida. La pantalla filtra explícitamente `is("released_at", null)`, es decir, **solo muestra reservas activas** (no liberadas); no hay en esta pantalla una vista histórica de reservas ya liberadas.

La pantalla es de solo lectura: no tiene formularios de alta, edición ni liberación de reservas; solo un tablero con tres contadores (reservas soft, reservas hard, expiradas) y una tabla con producto, sucursal, cantidad, tipo, razón y vencimiento. La creación y liberación de estas reservas ocurre en otros módulos del sistema (por ejemplo, al generar o cumplir solicitudes de sucursal), no en esta pantalla.

Permisos: lectura para privilegiados o para quien tiene acceso a la sucursal de la reserva (`can_access_branch`); gestión (alta/baja/edición) limitada a admin, supervisor, warehouse_operator u owner, aunque —como se indicó— la pantalla actual no ejercita esos permisos de escritura.

Archivo: `src/pages/StockComprometido.tsx`.

### Stock Especial — tabla existe, sin pantalla propia (tabla `special_stock`)

`special_stock` está definida en la base de datos con columnas `branch_id`, `product_id`, `stock_type` (texto libre, ej. dañado/vencido/cuarentena), `quantity`, `incident_id` (vínculo a `logistics_incidents`), `disposition` (tipo `stock_disposition`, es decir, qué se decidió hacer con ese stock especial) y `disposition_date`. Tiene políticas RLS de gestión para admin/supervisor/warehouse_operator/owner y de lectura por acceso a sucursal, igual patrón que `committed_stock`.

**Este documento deja constancia explícita de que no se encontró ninguna pantalla ni componente en `src/pages` o `src/components` que lea o escriba `special_stock`.** La única referencia en el código fuente del frontend es la definición de tipos autogenerada (`src/integrations/supabase/types.ts`), que refleja el esquema de la base pero no implica uso real. Es decir, "Stock Especial" existe como modelo de datos y como intención de producto, pero es una funcionalidad pendiente de construir en la interfaz: hoy no hay forma de registrar, ver o resolver stock especial desde la aplicación.

### Inventarios dirigidos — tablas existen, sin pantalla propia (`directed_inventories`, `directed_inventory_items`)

Aunque no fueron pedidas explícitamente como pantalla en el enunciado más que como tablas de apoyo, se relevaron porque suelen asociarse al circuito de stock especial/comprometido (un inventario físico dirigido a un producto o sucursal puede ser el origen de un ajuste a `special_stock`). `directed_inventories` modela una campaña de conteo dirigido (título, sucursal, alcance —`inventory_scope`/`scope_filter`—, fecha programada, estado del ciclo de vida `directed_inventory_status`, asignado a un usuario, quién lo completó y quién lo revisó, y si el origen de datos es manual o por archivo cargado). `directed_inventory_items` guarda el detalle por producto: cantidad esperada, cantidad contada, diferencia calculada, quién y cuándo contó.

Al igual que con `special_stock`, **no se encontró ninguna pantalla en `src/pages` ni componente en `src/components` que use estas tablas**; solo aparecen en `src/integrations/supabase/types.ts`. Sus políticas RLS (control de acceso vía `fn_can_access_inventory`, y gestión para admin/supervisor/warehouse_operator/owner) están listas para soportar una futura pantalla de inventarios dirigidos, pero esa pantalla todavía no existe en el frontend actual de MoviLog.

### Resumen del estado real de este dominio

De las cuatro piezas de datos que sostienen "Stock Comprometido y Stock Especial", solo `committed_stock` tiene una experiencia de usuario completa (aunque de solo lectura) en `StockComprometido.tsx`. `special_stock`, `directed_inventories` y `directed_inventory_items` son tablas completamente funcionales a nivel de base (con RLS, foreign keys y triggers de `updated_at` ya configurados) pero sin ningún punto de entrada visual: son, en la práctica, funcionalidad de backend construida por adelantado a la espera de su interfaz.

## Usuarios, Roles y Accesos

### Modelo de datos

El sistema de usuarios se apoya en cuatro tablas del esquema `public`:

- **`profiles`**: perfil operativo de cada usuario (`id`, `user_id` referenciando a `auth.users`, `full_name`, `default_branch_id`, `all_branches_access`, `is_active`). Se crea automáticamente vía trigger (`fn_handle_new_user`) cuando se da de alta un usuario en `auth.users`.
- **`user_roles`**: relación `user_id` → `role` (tipo enumerado `app_role`). Un usuario tiene normalmente un único rol operativo (`admin`, `supervisor`, `jefe_logistica`, `branch_operator`, `warehouse_operator`, `viewer`, `driver`) más el rol especial `owner`.
- **`user_module_access`**: overrides de módulos por perfil (`profile_id`, `module_key`, `is_enabled`). Si no hay registro para un módulo, el acceso se considera habilitado por defecto (ver `hasModule` en `AuthContext`).
- **`profile_branch_access`**: sucursales adicionales asignadas a un perfil cuando no tiene `all_branches_access = true`.
- **`branches`**: catálogo de sucursales sincronizado desde BIMS, referenciado por casi todas las tablas operativas para filtrar visibilidad.

### Roles definidos en la aplicación (`src/pages/Usuarios.tsx`)

El archivo `Usuarios.tsx` define en el arreglo `ROLES` seis perfiles de negocio, cada uno con una lista fija de módulos habilitados (`modules`) y si por defecto ve todas las sucursales (`allBranchesByDefault`):

| Rol | Alcance de sucursales | Resumen de capacidades |
|---|---|---|
| `admin` | Todas | Configuración general, gestión de usuarios, sincronización BIMS, acceso total a módulos |
| `supervisor` | Todas | Visión global, coordinación multi-origen, supervisión operativa completa |
| `jefe_logistica` | Todas | Coordinación logística global (pedidos, cargas, viajes, incidencias, rendición); sin acceso a usuarios ni configuración |
| `branch_operator` | Asignadas | Operación de sucursal: consultas, solicitudes, pedidos, recepción, incidencias |
| `warehouse_operator` | Asignadas | Preparación, despacho, transporte, entrega, recepción y rendición |
| `viewer` (Auditor) | Asignadas | Solo lectura: dashboard, consultas, cumplimiento, documentos |

Existe además el rol `owner` (Propietario), que **no se puede asignar desde la interfaz ni desde la edge function `create-user`** (bloqueado explícitamente con un error 403); solo se asigna manualmente en la base de datos. El rol `owner` tiene protección especial a nivel de base (ver "Modelo de Seguridad").

Los "módulos" del rol (`MODULE_LABELS`) son estáticos por rol: la UI aclara que "para cambiar permisos, cambie el rol del usuario", es decir, el ajuste fino módulo por módulo vía `user_module_access` existe en el modelo de datos pero la pantalla de Usuarios no expone edición individual de módulos; solo aplica el conjunto fijo del rol al crear el usuario.

### Página de gestión de usuarios (`src/pages/Usuarios.tsx`)

Es un componente extenso (~1270 líneas) que combina:

- **Listado y filtros**: búsqueda por nombre/email, filtro por rol, por estado (activo/inactivo) y por sucursal. Usa `useQuery` de TanStack Query sobre `profiles`, `user_roles`, `profile_branch_access` y una función RPC `get_users_emails` (necesaria porque el email vive en `auth.users`, no accesible directamente por RLS desde el cliente).
- **Alta de usuario**: diálogo que arma un payload (nombre, email, contraseña temporal por defecto `"Movilog2026!"`, rol, sucursal principal, sucursales adicionales) y lo envía a la edge function `create-user`.
- **Detalle/edición de usuario**: permite cambiar nombre, rol, sucursal por defecto, `all_branches_access` y sucursales adicionales, con tracking de "dirty state" para habilitar el guardado solo si hay cambios reales.
- **Confirmaciones**: diálogos de confirmación para cambio de rol, activar/desactivar usuario y reseteo de contraseña.
- **Restablecer contraseña**: invoca la edge function `reset-user-password`.
- Toda la pantalla respeta al `owner`: `isUserOwner()` identifica usuarios con rol `owner` para aplicar reglas visuales/de negocio distintas (por ejemplo, impedir que un no-owner altere a un owner), reforzado además por los triggers de protección en la base de datos.

### Autenticación (`src/pages/Login.tsx`, `AuthContext`)

- `Login.tsx` es un formulario simple con dos modos (`login` / `signup`) que usa `supabase.auth.signInWithPassword` y `supabase.auth.signUp` directamente. El modo `signup` está disponible en el código, pero en la práctica la alta de usuarios operativos se hace exclusivamente vía la pantalla de Usuarios y la edge function `create-user` (que fuerza rol, sucursal y módulos); el registro libre por `signup` no asigna rol ni perfil operativo más allá del trigger `fn_handle_new_user`.
- `AuthContext` (`src/contexts/AuthContext.tsx`) centraliza el estado de sesión:
  - Se suscribe a `supabase.auth.onAuthStateChange` y además consulta la sesión existente al montar.
  - Al detectar un usuario autenticado, carga en paralelo `profiles`, `user_module_access` y `user_roles` (perfil, módulos y roles), diferido con `setTimeout(...,0)` para evitar deadlocks conocidos del cliente de Supabase.
  - Expone helpers: `hasModule(key)` (default `true` si no hay override), `hasBranch(branchId)`, `allowedBranchIds`, `isOwner`, `hasRole(role)` y el flag `mustChangePassword`, derivado de `user.user_metadata.must_change_password`.
- **Cambio de contraseña obligatorio**: cuando `mustChangePassword` es `true` (seteado por la edge function `create-user`/`reset-user-password` al generar una contraseña temporal), la aplicación redirige a `CambiarContrasena.tsx`, que llama `supabase.auth.updateUser({ password })` y luego limpia el flag `must_change_password` en los metadatos del usuario. No hay flujo de "olvidé mi contraseña" por correo implementado en esta pantalla; el restablecimiento lo hace un admin/owner desde Usuarios.

### Hook de acceso por sucursal (`src/hooks/use-user-access.ts`)

`useUserBranchFilter()` es el hook transversal que usan los módulos operativos para filtrar datos por sucursal sin repetir lógica:

- `isAllBranches`: deriva de `profile.all_branches_access`.
- `filterByBranch(branchId)`: función memoizada que devuelve `true` siempre si el usuario tiene acceso a todas las sucursales, o valida contra el `Set` de `allowedBranchIds` en caso contrario.
- `defaultBranchId`: sucursal a preseleccionar en formularios.

Este hook opera solo sobre el estado ya cargado en el cliente (para UX/filtrado de UI); la seguridad real de los datos la garantiza el RLS en la base de datos (ver sección Modelo de Seguridad), no este hook.

### Edge functions de gestión de usuarios

Ambas funciones corren con `verify_jwt = false` en `supabase/config.toml` (la validación de identidad la hacen manualmente dentro del código, no vía el verificador automático de Supabase) y usan el cliente con `SUPABASE_SERVICE_ROLE_KEY` para poder operar sobre `auth.admin`:

- **`create-user`**:
  1. Valida el `Authorization: Bearer` del que llama y obtiene su `sub` (id de usuario) vía `getClaims`.
  2. Verifica que el llamante tenga rol `admin` u `owner` en `user_roles`; si no, responde 403.
  3. Rechaza explícitamente si se intenta crear con `role: "owner"`.
  4. Crea el usuario en `auth.users` con `admin.createUser` (email confirmado automáticamente, sin flujo de verificación por correo).
  5. Espera (polling hasta 10 intentos de 300ms) a que el trigger de base de datos cree la fila en `profiles`.
  6. Actualiza el perfil con nombre, sucursal por defecto y `all_branches_access`.
  7. Inserta el rol en `user_roles` y, si vienen, los módulos en `user_module_access` y las sucursales adicionales en `profile_branch_access`.
- **`reset-user-password`**:
  1. Valida el token del llamante con `auth.getUser` (no `getClaims`) usando el cliente de service role.
  2. Verifica rol `admin`/`owner` del llamante.
  3. Si el usuario objetivo es `owner`, exige que el llamante también sea `owner` (un admin no puede resetear la contraseña de un owner).
  4. Genera una contraseña temporal aleatoria de 10 caracteres (`generateTempPassword`, alfabeto sin caracteres ambiguos) y la aplica con `admin.updateUserById`, marcando (según el patrón del resto del flujo) `must_change_password: true` en los metadatos para forzar el cambio en el próximo login.

## Sincronización con BIMS

BIMS es el sistema externo de origen (catálogo, stock, sucursales, contactos) con el que MoviLog se integra. La sincronización se organiza en cuatro edge functions y se opera desde la pantalla `SincronizacionBims.tsx`.

### Edge functions

- **`bims-proxy`** (729 líneas): actúa como proxy/normalizador genérico hacia la API de BIMS. Maneja login contra BIMS (usuario/contraseña con hash MD5, soporta autenticación tanto por token Bearer como por cookie de sesión, cacheando la sesión), y expone acciones como `test-connection`. Define tipos normalizados (`NormalizedProduct`, `NormalizedContact`) que homogeneizan las distintas formas en que BIMS puede devolver arrays (`data`, `results`, `items`, `warehouses`/`Warehouses`, anidados).
- **`bims-sync`** (553 líneas): función principal de sincronización batch hacia las tablas locales. Soporta `entity=warehouses` (sucursales) y `entity=products` (catálogo paginado por `offset`/`limit`), y una acción especial `action=deactivate_missing` para dar de baja lógica productos que ya no están activos en BIMS. Registra el resultado de cada corrida (por lote) en `sync_logs`.
- **`bims-stock-live`** (168 líneas): consulta de stock en tiempo real contra BIMS (sin persistir en `products`), usada para verificar disponibilidad puntual sin depender de la última sincronización batch.
- **`bims-image-proxy`** (77 líneas): proxy de imágenes de productos. Solo permite reenviar solicitudes hacia el host fijo `190.128.128.182` (allowlist explícita) y valida que la respuesta upstream sea efectivamente una imagen antes de reenviarla, evitando así usarse como proxy abierto.

### Flujo de sincronización de productos (paginado, con control de umbral)

`SincronizacionBims.tsx` implementa una máquina de estados (`SyncPhase`: `idle` → `syncing` → `completed` / `completed_with_observations` / `incomplete` / `error` / `awaiting_confirmation`) para la sincronización de productos:

1. Se recorre el catálogo de BIMS en lotes de `PAGE_SIZE = 100` mediante llamadas sucesivas a `bims-sync?entity=products&offset=...&limit=100`, acumulando métricas: `total_received`, `total_processed`, `total_inserted`, `total_updated`, `total_failed`, `total_skipped`, códigos BIMS activos recolectados y errores por etapa (`fetch`, `validation`, `transform`, `upsert`, `deactivation`).
2. Se detecta **bloqueo por duplicados** (`duplicateBlockDetected`): si dos lotes consecutivos devuelven el mismo conjunto de códigos activos, se asume que la API de BIMS dejó de paginar correctamente y se corta el ciclo para evitar loops infinitos.
3. Al finalizar la paginación, se ejecuta la etapa de **baja lógica** (`action=deactivate_missing`) enviando la lista completa de códigos BIMS activos vistos. El backend calcula qué productos locales activos no están en esa lista y los desactivaría.
4. **Control de umbral de seguridad**: si el porcentaje de productos a desactivar respecto del total activo actual supera un umbral configurado en el backend, la función responde `reason: "threshold_exceeded", requires_confirmation: true` en lugar de ejecutar la baja. La UI muestra un diálogo de confirmación (`ThresholdAlert`) con el detalle (cantidad a desactivar, porcentaje, umbral) y solo procede si el usuario confirma explícitamente (`force_confirmed: true`), evitando que un corte parcial de la sincronización borre masivamente el catálogo por error.
5. Si la sincronización estuvo incompleta o tuvo errores (`sync_incomplete` / `sync_had_errors`), la baja lógica se bloquea directamente sin pedir confirmación, para no desactivar productos con información parcial.
6. Existe reintento selectivo por `offset` (`retryOffsets`) para reprocesar solo los lotes que fallaron, en vez de repetir toda la sincronización.

### Observabilidad

- **`sync_logs`**: tabla de auditoría de cada ejecución (por sucursal/lote), con columnas como `entity`, `status`, `total_received`, `total_processed`, `total_failed`, `triggered_by` (identifica lotes por convención `offset_<n>`) y `created_at`. La pantalla arma con estas filas un resumen de la última hora (`syncRunTotals`) para estimar el tamaño total del catálogo remoto cuando la sincronización en curso aún no lo informó.
- **`diagnostic_logs`**: tabla de logs de diagnóstico de propósito general; permite inserción libre desde clientes autenticados o anónimos (usada por funciones/edge functions para dejar rastro de incidentes), pero solo administradores/owner pueden leerla.
- El estado del catálogo se resume con `getCatalogSyncStatus` (`src/lib/business-rules.ts`), que compara `productCount` (productos activos en `products`) contra el tamaño estimado del catálogo remoto, devolviendo estados como completo, completo con observaciones o incompleto, reflejados en la UI con iconografía y colores (`PHASE_COLORS`, `PHASE_LABELS`).

### Sincronización de sucursales

Es más simple: `syncWarehouses()` llama a `bims-sync?entity=warehouses`, reemplaza/actualiza la tabla `branches` y refresca las queries de React Query relacionadas (`branches-count`, `branches`) para que el resto de la app vea las sucursales actualizadas de inmediato.

## Modelo de Seguridad

MoviLog delega la autorización real de datos en **Row Level Security (RLS) de PostgreSQL**, no en el cliente. Se relevaron 117 políticas activas sobre el esquema `public`. El patrón dominante es: cada tabla tiene una política de `SELECT` basada en pertenencia/sucursal/rol, y una política más amplia (a veces `ALL`) restringida a roles privilegiados para las operaciones de escritura.

### Funciones helper de seguridad (`SECURITY DEFINER`)

Todas están escritas en SQL/plpgsql, marcadas `STABLE SECURITY DEFINER` y con `search_path` fijado a `public` (mitigación estándar contra hijacking de search_path). Se ejecutan con los privilegios del definer, evitando así problemas de recursión de RLS al consultar `profiles`/`user_roles` desde dentro de otra política:

- **`has_role(_user_id, _role)`**: existe una fila en `user_roles` con ese rol exacto.
- **`has_role_in_branch(_user_id, _role, _branch_id)`**: variante con filtro adicional por `branch_id` en `user_roles` (para roles asignados por sucursal).
- **`is_owner(_user_id)`**: `true` si el usuario tiene el rol especial `owner`.
- **`is_privileged(_user_id)`**: `true` si es owner, admin, supervisor o jefe_logistica. Es el helper más usado para dar acceso amplio de lectura a roles de coordinación/gestión sin tener que enumerar cada rol en cada política.
- **`can_access_branch(_user_id, _branch_id)`**: `true` si el perfil tiene `all_branches_access = true`, o si existe una fila en `profile_branch_access` para ese perfil y esa sucursal. Es la base de casi todo el filtrado geográfico de datos operativos (solicitudes, fulfillments, stock comprometido, choferes, KPIs por sucursal, etc.).
- **`fn_can_access_request(_user_id, _request_id)`**, **`fn_can_access_fulfillment`**, **`fn_can_access_inventory`**: helpers específicos que resuelven, a partir del id de la entidad hija (ítem de solicitud, ítem de fulfillment, ítem de inventario dirigido), si el usuario puede acceder a la entidad padre, evitando duplicar la lógica de `can_access_branch`/roles en cada tabla de detalle.
- **`fn_can_view_consultation`**: equivalente para consultas de disponibilidad (`availability_consultations` y sus mensajes/productos/objetivos asociados).

### Protección del rol `owner`

Existen tres triggers `BEFORE UPDATE OR DELETE` que bloquean modificaciones sobre las filas del owner:

- `trg_protect_owner_profiles` (sobre `profiles`, función `fn_protect_owner_profiles`)
- `trg_protect_owner_roles` (sobre `user_roles`, función `fn_protect_owner_roles`)
- `trg_protect_owner_branch_access` (sobre `profile_branch_access`, función `fn_protect_owner_branch_access`)

Esto significa que ni siquiera un usuario con rol `admin` (que sí tiene permiso de RLS para gestionar roles y perfiles en general) puede editar o borrar por error/abuso el perfil, rol o accesos de sucursal del propietario del sistema: la protección está a nivel de trigger de base de datos, por debajo de la capa de RLS, como última línea de defensa. Es coherente con lo visto en el frontend, donde `create-user` y `reset-user-password` también aplican reglas especiales para el rol `owner`.

### Protección de datos de contacto del cliente (teléfono y email)

`branch_requests` guarda pedidos/solicitudes con datos de contacto del cliente (`client_phone`, `client_email`, además de `client_name`, `client_address`, no sensibles). El código documenta explícitamente esta separación en `src/lib/branch-requests-query.ts`:

- La constante `REQUEST_COLUMNS`, usada en todas las consultas normales del listado de solicitudes, **excluye deliberadamente** `client_phone` y `client_email` del `select`.
- El acceso al teléfono/email se hace exclusivamente a través de la función `fn_get_request_client_contact(p_request_id)`, marcada `SECURITY DEFINER`, que:
  - Exige `auth.uid()` no nulo (usuario autenticado).
  - Solo devuelve las columnas si el usuario es privilegiado (`is_privileged`), es el creador de la solicitud (`created_by`) o es el responsable operativo asignado (`operational_responsible_id`).
  - Si ninguna condición se cumple, la consulta no retorna filas (no lanza error, simplemente no hay datos).
- Esto es una protección **a nivel de aplicación por convención** (columnas fuera del `select` estándar) reforzada por una función con su propia verificación de autorización, y no una restricción de privilegios de columna a nivel de PostgreSQL (`GRANT`/`REVOKE` column-level): la relevación de privilegios de columna no mostró restricciones especiales para `authenticated` sobre `client_phone`/`client_email` más allá de la política de fila estándar de `branch_requests` (que ya de por sí es bastante permisiva: cualquiera con acceso a la sucursal de origen o destino puede ver la fila completa por otras vías si construye su propio `select("*")`). En la práctica, la protección efectiva depende de que todo el código cliente use `REQUEST_COLUMNS`/`fn_get_request_client_contact` y no un `select("*")` directo sobre `branch_requests`.

### Storage: buckets y políticas

Se relevaron 6 buckets, todos privados (`public = false`) y con límite de tamaño de archivo (5 MB en la mayoría):

| Bucket | Contenido | Límite | Tipos permitidos |
|---|---|---|---|
| `incident-photos` | Fotos de incidencias | 5 MB | image/jpeg, png, webp |
| `receipts` | Comprobantes/recibos | 5 MB | image/jpeg, png, webp, application/pdf |
| `mileage-photos` | Fotos de kilometraje | 5 MB | image/jpeg, png, webp |
| `deposit-proofs` | Comprobantes de depósito bancario | 5 MB | image/jpeg, png, webp, application/pdf |
| `request-attachments` | Adjuntos de solicitudes/pedidos | sin límite explícito | sin restricción de tipo declarada |
| `vehicle-photos` | Fotos de vehículos de flota | sin límite explícito | sin restricción de tipo declarada |

Políticas relevantes sobre `storage.objects`:

- **Buckets operativos** (`receipts`, `incident-photos`, `mileage-photos`, `deposit-proofs`): lectura permitida al dueño del objeto (`owner = auth.uid()`) o a usuarios privilegiados (`is_privileged`); subida permitida a usuarios autenticados para sus propios archivos operativos.
- **`request-attachments`**: la descarga exige ser admin/owner, o que el segundo segmento del path del archivo (`string_to_array(name, '/')[2]`) corresponda a un `branch_requests.id` cuya `source_branch_id` sea accesible por el usuario (`can_access_branch`). Esto ata el control de acceso al archivo con el control de acceso al pedido al que pertenece, usando una convención de nombres de archivo tipo `algo/<request_id>/archivo.ext`.
- **`vehicle-photos`**: lectura pública para cualquier autenticado; escritura/borrado restringido al dueño del objeto o a admin/supervisor/owner.

### Tabla resumen de políticas RLS (selección representativa)

La siguiente tabla resume el criterio de acceso por tabla clave (no es exhaustiva de las 117 políticas relevadas, pero cubre las tablas centrales de negocio y las mencionadas en este documento):

| Tabla | Operación | Quién puede |
|---|---|---|
| `profiles` | SELECT | El propio usuario (`user_id = auth.uid()`), o admin/owner |
| `profiles` | UPDATE | El propio usuario, o admin/owner |
| `profiles` | INSERT | Admin, o el proceso interno (`Service insert profiles`, vía trigger/service role) |
| `user_roles` | SELECT | Solo el propio usuario ve su rol |
| `user_roles` | ALL (gestión) | Admin u owner; protegido además por trigger `fn_protect_owner_roles` contra edición/borrado del owner |
| `profile_branch_access` | SELECT | El propio perfil, o admin/owner |
| `profile_branch_access` | ALL (gestión) | Admin u owner; protegido por trigger contra el owner |
| `user_module_access` | SELECT | El propio perfil, o admin/owner |
| `user_module_access` | ALL (gestión) | Admin u owner |
| `branches` | SELECT | Cualquier usuario autenticado |
| `branches` | ALL (gestión) | Admin u owner |
| `products` | SELECT | Cualquier usuario autenticado |
| `products` | ALL (gestión) | Admin u owner (en la práctica, gestionado por las edge functions de BIMS con service role) |
| `sync_logs` | SELECT / INSERT | Abierto (`true`) a autenticados y anónimos, pensado para que las edge functions dejen rastro sin fricción |
| `diagnostic_logs` | INSERT | Cualquiera (autenticado); SELECT solo admin/owner |
| `branch_requests` | SELECT | Usuario con acceso a la sucursal de origen o destino, o admin/supervisor/jefe_logistica/owner |
| `branch_requests` | INSERT | El creador (`created_by = auth.uid()`) |
| `branch_requests` | UPDATE | Admin/supervisor/owner, el creador, o quien tenga acceso a la sucursal de origen o destino; regla especial para editar el propio borrador de pre-venta no convertido |
| `branch_request_items` | SELECT / ALL | Determinado por `fn_can_access_request` sobre la solicitud padre |
| `fulfillment_orders` | SELECT | Acceso a sucursal de origen o destino, o admin/supervisor/jefe_logistica/owner |
| `fulfillment_orders` | ALL (gestión) | Admin/supervisor/warehouse_operator/driver/owner |
| `fulfillment_items` | SELECT / ALL | Determinado por `fn_can_access_fulfillment` sobre el fulfillment padre |
| `directed_inventories` | SELECT | Privilegiado, asignado a la tarea (`assigned_to`), o con acceso a la sucursal |
| `directed_inventories` | ALL (gestión) | Admin/supervisor/warehouse_operator/owner |
| `directed_inventory_items` | SELECT / ALL | Determinado por `fn_can_access_inventory` sobre el inventario padre |
| `committed_stock` | SELECT | Privilegiado, o con acceso a la sucursal |
| `drivers` | SELECT | Privilegiado, el propio chofer, o quien tenga acceso a su sucursal asignada |
| `driver_collections` / `driver_settlements` / `bank_deposits` | SELECT / ALL | Privilegiado, o el propio chofer (`is_own_driver`) |
| `availability_consultations` | SELECT | Determinado por `fn_can_view_consultation` |
| `ai_anomalies` / `ai_recommendations` | SELECT | Abierto a autenticados; gestión (ALL) solo admin/supervisor/owner |
| `kpi_definitions` / `kpi_targets` | SELECT | Público a autenticados (`kpi_definitions`) o filtrado por sucursal (`kpi_targets`); gestión solo admin/owner |

En general, ninguna política habilita el rol `anon` salvo casos puntuales de inserción de logs (`sync_logs`, `diagnostic_logs`) pensados para procesos automáticos sin sesión de usuario.

## Arquitectura y Convenciones Técnicas

### Stack

- **Frontend**: React + TypeScript sobre Vite, con React Router (rutas declarativas, incluye `AppLayout` como layout raíz con `Outlet`) y TanStack Query para el manejo de datos remotos (cache, invalidación, estados de carga).
- **UI**: componentes basados en shadcn/ui (Radix + Tailwind) — `Card`, `Dialog`, `AlertDialog`, `Select`, `Sidebar`, etc. bajo `src/components/ui`. Iconografía con `lucide-react`. Notificaciones con `sonner` (`toast`).
- **Backend**: Supabase (Postgres + Auth + Storage + Edge Functions en Deno). No hay backend propio fuera de Supabase; toda la lógica de servidor vive en funciones SQL (`SECURITY DEFINER`), triggers, y edge functions en `supabase/functions/`.
- **Integración externa**: BIMS (ERP/sistema de stock) vía HTTP, integrado exclusivamente a través de edge functions (nunca desde el cliente directamente), con autenticación por usuario/contraseña (hash MD5) que devuelve token Bearer o cookie de sesión, cacheada en memoria del edge function mientras esté vigente.

### Estructura de carpetas (relevante a esta plataforma transversal)

```
src/
  contexts/AuthContext.tsx        # estado global de sesión, perfil, roles, módulos
  hooks/use-user-access.ts        # filtrado de datos por sucursal en el cliente
  hooks/use-branches.ts           # catálogo de sucursales (React Query)
  components/AppLayout.tsx        # layout raíz con sidebar + header
  components/AppSidebar.tsx       # navegación, agrupada por módulo y filtrada por rol/permiso
  pages/
    Login.tsx, CambiarContrasena.tsx
    Usuarios.tsx                  # ABM de usuarios, roles y accesos
    SincronizacionBims.tsx        # panel de sincronización con BIMS
    ...módulos operativos (Solicitudes, Consultas, Chofer, Rendicion, etc.)
  lib/
    business-rules.ts             # reglas de negocio compartidas (p.ej. estado de sync de catálogo)
    format-currency.ts, catalogo-pdf.ts, ventas.ts  # formato numérico/moneda
    branch-requests-query.ts      # helpers de queries seguras sobre branch_requests
supabase/
  functions/                      # edge functions (Deno)
  migrations/                     # migraciones SQL versionadas
  config.toml                     # config de functions (p.ej. verify_jwt)
```

### `AppLayout` y `AppSidebar`

- `AppLayout` monta `SidebarProvider` + `AppSidebar` + un header sticky con botón de toggle del sidebar, nombre del usuario (`profile.full_name`, oculto en pantallas chicas) e iniciales en un avatar circular. El contenido de cada página se renderiza en `<Outlet />` dentro de un `<main>` con padding responsive.
- `AppSidebar` agrupa los ítems de navegación en secciones (`mainItems`, `coreItems`, `logisticsItems`, `adminItems`), cada ítem con un `moduleKey`. La visibilidad de cada ítem se resuelve combinando `hasModule(moduleKey)` de `AuthContext` con chequeos de rol (`isOwner`, `hasRole`) para las secciones administrativas (Usuarios, Sincronización BIMS), de modo que el menú refleja exactamente los módulos y permisos efectivos del usuario logueado, sin necesidad de mantener una lista de rutas visibles separada.

### Deep-linking con `?detail=UUID`

Varios módulos (por ejemplo `Solicitudes.tsx`) usan `useSearchParams` de React Router para exponer el estado de "detalle abierto" en la URL: parámetros como `detail` (id de la entidad a mostrar en un panel/modal de detalle), `from_consultation` y `action` permiten compartir un enlace directo a un registro específico (por ejemplo, un pedido puntual) y que la aplicación abra automáticamente su vista de detalle al cargar, además de mantener la navegación (atrás/adelante del navegador) coherente con el panel abierto.

### Formato numérico y moneda

Convención uniforme en toda la app: los montos se formatean con el locale `"de-DE"` de `Intl`/`toLocaleString`, que usa punto como separador de miles (ej. `1.234.567`), pese a no representar moneda alemana — se aprovecha únicamente el formato de agrupación. Se implementa en varios puntos con la misma fórmula:

- `src/lib/format-currency.ts`: `formatGuaranies` (con prefijo `₲`) y una variante sin prefijo, ambas con `Math.round(n).toLocaleString("de-DE")`.
- `src/lib/catalogo-pdf.ts`: formato de precios para el catálogo en PDF, con prefijo `"Gs."`.
- `src/lib/ventas.ts`: formato de montos en el módulo de ventas, con prefijo `"₲ "`.

Esto refleja que la moneda de la operación es el guaraní paraguayo (sin decimales, ya que `Math.round` trunca a entero antes de formatear), consistente con el uso de guaraníes sin centavos en Paraguay.

### Diseño y tokens

El sistema visual usa Tailwind con tokens semánticos definidos como variables CSS (detectadas ~65 declaraciones de variables en `src/index.css`) consumidas por clases utilitarias como `bg-background`, `text-muted-foreground`, `border-border`, `bg-primary`, `bg-card/80`, etc. Esto permite temas (claro/oscuro) y consistencia de color sin hardcodear valores hex en los componentes; los componentes de shadcn/ui (`Card`, `Badge`, `Separator`, `Progress`, etc.) ya vienen alineados a estos tokens.

### Testing

El proyecto usa **Vitest** (`vitest.config.ts`) con entorno `jsdom`, modo `globals: true` y `setupFiles: ["./src/test/setup.ts"]`. Los tests se ubican junto al código (`src/**/*.{test,spec}.{ts,tsx}`) y se apoyan en `@testing-library/react` para hooks (`renderHook`, `act`, `waitFor`). Se relevaron actualmente tests para:

- `src/hooks/use-idb-state.test.tsx`: persistencia/rehidratación de estado en IndexedDB, incluyendo un caso de condición de carrera (sesión que carga tarde) para no pisar datos ya guardados.
- `src/hooks/use-supply-resolution.test.tsx`
- `src/lib/catalogo-pdf.test.ts`
- `src/test/example.test.ts`

La cobertura de tests automatizados es acotada (4 archivos de test relevados) frente al tamaño del proyecto; gran parte de la lógica de negocio (por ejemplo, la máquina de estados de sincronización BIMS o el flujo de creación de usuarios) no tiene tests unitarios propios verificados en el código, y su corrección se apoya actualmente en revisión manual y en las validaciones server-side (RLS, edge functions).


---

# Parte III — Anexos Técnicos

## Anexo A — Diccionario de tablas

Todas las tablas viven en el esquema `public` y tienen RLS activo. La columna "Columnas" lista el contenido real verificado contra la base.

### Pedidos y abastecimiento

| Tabla | Para qué sirve | Columnas |
|---|---|---|
| `branch_requests` | Entidad central: el pedido. Cubre reposición, pedido de cliente, online y pre-venta. Concentra origen, destino, condiciones de envío, custodia, estado y trazabilidad de cierre | id, request_number, request_type, requesting_branch_id, source_branch_id, shipping_method, shipping_paid_by, shipping_cost, bims_invoice_number, bims_sale_reference, client_name, client_address, status, current_custody_holder_id, current_location_branch_id, expected_next_event, expected_next_event_deadline, priority, notes, created_by, accepted_by, accepted_at, rejected_by, rejected_at, rejection_reason, closed_by, closed_at, created_at, updated_at, rejection_reason_type, logistic_closed_at, logistic_closed_by, admin_closed_at, admin_closed_by, shipping_origin_paid, shipping_destination_paid, delivery_target, delivery_payer, parent_request_id, courier_billing_mode, operational_responsible_id, attached_file_path, flow_type, consolidation_override, is_pre_sale, pre_sale_status, sales_channel, client_phone, client_email, pre_sale_confirmed_at, pre_sale_sent_at, pre_sale_pdf_generated_at, converted_to_request_id, created_from_presale_id, converted_at, converted_by_user_id, commercial_terms, client_uuid |
| `branch_request_items` | Líneas del pedido, con el avance por cantidad en cada etapa (pedido, pickeado, enviado, recibido, aceptado) más el abastecimiento local y el faltante | id, request_id, product_id, quantity_requested, quantity_picked, quantity_shipped, quantity_received, quantity_accepted, notes, created_at, item_purpose, client_name, client_address, rejection_reason_type, local_supply_qty, quantity_unfulfilled |
| `request_bims_documents` | Documentos del ERP vinculados al pedido (factura, transferencia). Requisito para despachar | id, request_id, document_type, document_number, created_by, created_at, notes |

### Cumplimiento y transporte

| Tabla | Para qué sirve | Columnas |
|---|---|---|
| `fulfillment_orders` | Orden de cumplimiento: el tramo físico origen→destino de un pedido. Lleva custodia, ubicación, deadline del próximo evento y el ciclo de excepción comercial | id, branch_request_id, bims_invoice_number, source_branch_id, destination_branch_id, destination_client_name, destination_client_address, shipping_method, status, current_custody_holder_id, current_location_branch_id, expected_next_event, expected_next_event_deadline, trip_id, dispatched_at, dispatched_by, received_at, received_by, notes, created_at, updated_at, bims_transfer_number, bims_transfer_verified, package_count, bims_confirmation_deadline, received_at_branch, received_by_branch, commercial_exception_at, commercial_exception_status, commercial_resolution_type, commercial_resolution_notes, commercial_resolved_by, commercial_resolved_at, current_custody_type, current_location_type, delivery_failed_at, delivery_failed_reason, cleared_for_pickup, cleared_for_pickup_at, cleared_for_pickup_by |
| `fulfillment_items` | Líneas despachadas, recibidas, aceptadas y rechazadas de cada orden | id, fulfillment_id, product_id, request_item_id, quantity_dispatched, quantity_received, quantity_accepted, quantity_rejected, rejection_reason, created_at |
| `shipment_packages` | Bultos físicos con su etiqueta (inter-sucursal, cliente o courier) | id, fulfillment_order_id, package_number, label_type, destination_description, transfer_reference, invoice_reference, sending_branch_code, sending_area, contact_phone, recipient_name, label_printed, printed_at, created_at |
| `trips` | Viajes: corte urbano, interurbano planificado o retiro de proveedor. Guarda kilometraje con foto de odómetro y estado de rendición | id, trip_number, vehicle_id, driver_id, origin_branch_id, planned_stops, status, start_mileage, end_mileage, start_mileage_photo_url, end_mileage_photo_url, planned_departure, actual_departure, planned_arrival, actual_arrival, settlement_status, settled_at, settled_by, notes, created_at, updated_at, trip_type, cutoff_started_at, cutoff_ended_at, destination_description, created_by |
| `drivers` | Ficha del chofer, con licencia, vencimiento y vehículo/sucursal asignados | id, user_id, license_number, license_expiry, assigned_vehicle_id, assigned_branch_id, is_active, created_at, updated_at |

### Trazabilidad

| Tabla | Para qué sirve | Columnas |
|---|---|---|
| `operational_events` | Bitácora inmutable de todo lo que pasa: cambio de estado, de custodio y de ubicación, con geolocalización opcional | id, category, reference_id, reference_type, event_type, event_description, previous_status, new_status, previous_custody_holder_id, new_custody_holder_id, previous_location_branch_id, new_location_branch_id, expected_next_event, expected_next_event_deadline, triggered_by, metadata, latitude, longitude, created_at |
| `tracked_documents` | Ciclo de vida del documento físico: emitido, con el chofer, firmado por el cliente, con administración, con el cobrador, archivado | id, document_type, document_number, branch_request_id, fulfillment_order_id, trip_id, status, current_holder_id, current_holder_role, current_location_branch_id, expected_next_event, expected_next_event_deadline, issued_at, signed_at, archived_at, bims_reference, notes, created_at, updated_at |
| `logistics_incidents` | Incidencias: averiado, faltante, sobrante, producto equivocado, vencido. Incluye origen del daño, responsable y disposición administrativa | id, incident_type, branch_id, branch_request_id, fulfillment_order_id, trip_id, inventory_id, product_id, quantity_affected, status, current_custody_holder_id, current_location_branch_id, title, description, photo_urls, resolution, resolved_by, resolved_at, reported_by, assigned_to, created_at, updated_at, incident_origin, damage_origin, responsible_user_id, pending_shipment_to_admin, shipment_reminder_9th, shipment_reminder_24th, detection_context, damage_cause, admin_disposition, admin_disposition_notes, admin_decision_by, admin_decision_at |
| `diagnostic_logs` | Registro técnico de errores de operaciones críticas, con payload y código de error, para depurar sin adivinar | id, created_at, user_id, session_user_id, ids_match, step_name, table_name, payload, error_message, error_code, error_details, error_hint, requesting_branch_id, target_branches |

### Stock e inventarios

| Tabla | Para qué sirve | Columnas |
|---|---|---|
| `committed_stock` | Reservas de stock (blandas o duras) asociadas a un pedido o a una orden de cumplimiento, con vencimiento y liberación | id, product_id, branch_id, quantity, reserve_type, reserve_reason, expires_at, is_expired, branch_request_id, fulfillment_order_id, created_by, released_at, released_by, release_reason, created_at, updated_at |
| `special_stock` | Stock que no está disponible para la venta normal: averiado, feria, administrativo, con su disposición final | id, branch_id, product_id, stock_type, quantity, incident_id, disposition, disposition_date, notes, created_by, created_at, updated_at |
| `directed_inventories` | Inventarios dirigidos: conteos puntuales planificados sobre un alcance definido | id, branch_id, title, description, status, inventory_scope, scope_filter, scheduled_date, started_at, completed_at, assigned_to, completed_by, reviewed_by, data_source, upload_file_url, notes, created_at, updated_at |
| `directed_inventory_items` | Líneas del conteo: esperado, contado y diferencia | id, inventory_id, product_id, expected_quantity, counted_quantity, difference, counted_by, counted_at, notes, created_at |
| `products` | Espejo del catálogo BIMS: código, marca, categoría, precios, escalas, stock por depósito e imagen | id, bims_code, sku, name, category, unit, weight_kg, volume_cm3, is_active, created_at, updated_at, barcode, description, image_url, sell_price, buy_price, price_scales, price_lists, stock_by_warehouse, total_stock, bims_warehouse_id, brand, bims_label_id |

### Consultas de disponibilidad

| Tabla | Para qué sirve | Columnas |
|---|---|---|
| `availability_consultations` | La consulta: quién pregunta, por qué producto y hasta cuándo queda abierta | id, requesting_branch_id, product_id, created_by, status, auto_close_at, created_at, updated_at |
| `consultation_products` | Productos incluidos en una consulta multi-producto | id, consultation_id, product_id, notes, created_at |
| `consultation_targets` | Sucursales consultadas y su respuesta (cantidad, colores, nota) | id, consultation_id, branch_id, response_quantity, response_colors, response_note, responded_by, responded_at, created_at |
| `consultation_messages` | Chat de negociación dentro de la consulta | id, consultation_id, sender_id, message, created_at |
| `consultation_requests` | Vínculo entre una consulta y el pedido que se generó a partir de ella | id, consultation_id, branch_request_id, created_at |

### Ventas

| Tabla | Para qué sirve | Columnas |
|---|---|---|
| `sales_customers` | Clientes traídos de BIMS o cargados en MoviLog, con lista de precios y geolocalización | id, bims_contact_id, name, ruc, address, phone, email, price_list_id, price_list_name, is_active, latitude, longitude, source, created_by, created_at, updated_at |
| `salesperson_customers` | Cartera: qué cliente atiende cada vendedor | id, salesperson_id, customer_id, is_active, assigned_at, created_at, updated_at |
| `sales_carts` | Carrito / pre-venta en armado, con datos del cliente y `client_uuid` para envío idempotente desde el celular | id, salesperson_id, customer_id, client_name, client_phone, client_email, client_address, notes, sales_channel, status, client_uuid, created_at, updated_at |
| `sales_cart_items` | Ítems del carrito con cantidad y nota por producto | id, cart_id, product_id, quantity, notes, created_at, updated_at |
| `sales_catalog_drafts` | Selecciones guardadas de catálogo PDF (productos, cliente, filtros y opciones) para poder regenerar sin volver a elegir | id, user_id, name, product_ids, customer, filters, pdf_options, created_at, updated_at |

### Flota

| Tabla | Para qué sirve | Columnas |
|---|---|---|
| `vehicles` | Vehículos con patente, apodo, kilometraje actual y vencimientos | id, plate, brand, model, year, status, assigned_branch_id, current_mileage, insurance_expiry, vtv_expiry, notes, is_active, created_at, updated_at, nickname |
| `vehicle_usages` | Uso del móvil en dos pasos: inicio y cierre, con foto de odómetro en ambos extremos | id, vehicle_id, driver_id, driver_name_text, category_id, destination, start_mileage, end_mileage, km_traveled, linked_request_id, started_at, ended_at, start_odometer_photo_path, end_odometer_photo_path, notes, created_by, created_at, updated_at, status, closed_at, closed_by |
| `vehicle_usage_categories` | Motivos de uso configurables (reparto, trámite, retiro, etc.) | id, name, description, is_active, created_at, updated_at |
| `fuel_records` | Cargas de combustible con foto de comprobante y eficiencia calculada | id, trip_id, vehicle_id, driver_id, date, liters, price_per_liter, total_amount, mileage_at_fill, station_name, receipt_photo_url, payment_method, notes, created_at, computed_efficiency_kmpl |
| `vehicle_fines` | Multas con estado de pago y comprobante | id, vehicle_id, driver_id, fine_number, issued_at, location, infraction_type, amount, due_date, status, paid_at, paid_by, receipt_photo_url, notes, created_by, created_at, updated_at |
| `vehicle_maintenance` | Mantenimientos con programación por kilómetro o por fecha y recurrencia automática | id, vehicle_id, maintenance_type, description, scheduled_date, completed_date, mileage_at_service, cost, provider, next_maintenance_date, next_maintenance_mileage, status, notes, created_at, updated_at, scheduled_km, alert_km_threshold, alert_days_threshold, recurrence_km, recurrence_days, parent_maintenance_id |
| `vehicle_loans` | Préstamo de un vehículo entre sucursales | id, vehicle_id, lending_branch_id, borrowing_branch_id, status, requested_by, approved_by, start_date, expected_return_date, actual_return_date, start_mileage, return_mileage, reason, notes, created_at, updated_at |

### Rendición y cobranzas

| Tabla | Para qué sirve | Columnas |
|---|---|---|
| `driver_settlements` | Rendición del viaje: cobranzas, combustible, viáticos, adelantos y neto | id, trip_id, driver_id, total_collections, total_fuel, total_per_diem, total_other_expenses, net_amount, status, reviewed_by, reviewed_at, documents_returned, notes, created_at, updated_at, advance_amount, advance_reconciled, admin_deposit_instruction, admin_deposit_proof_url |
| `driver_collections` | Cobros hechos por el chofer, con medio de pago y referencia | id, trip_id, driver_id, fulfillment_order_id, client_name, amount, payment_method, check_number, transfer_reference, notes, created_at |
| `bank_deposits` | Depósitos bancarios con comprobante y verificación administrativa | id, driver_id, trip_id, amount, bank_name, deposit_date, receipt_url, notes, verified_by, verified_at, created_at |
| `deposit_collection_links` | Conciliación: qué cobros cubre cada depósito | id, deposit_id, collection_id, amount, created_at |
| `per_diem_records` | Viáticos por viaje con comprobante y aprobación | id, trip_id, driver_id, date, concept, amount, receipt_photo_url, approved_by, approved_at, notes, created_at |

### Indicadores e inteligencia

| Tabla | Para qué sirve | Columnas |
|---|---|---|
| `kpi_definitions` | Catálogo de indicadores: de dónde sale cada uno y cómo se agrega | id, code, name, description, area, source_table, aggregation, value_column, filter_conditions, date_column, unit, format, decimal_places, is_active, display_order, created_at, updated_at |
| `kpi_targets` | Metas y umbrales por indicador, sucursal y período | id, kpi_id, branch_id, period_start, period_end, target_value, warning_threshold, critical_threshold, weight, created_at, updated_at |
| `kpi_values` | Valores calculados con comparación contra el período anterior y la meta | id, kpi_id, branch_id, period_date, value, previous_value, change_percentage, target_value, achievement_percentage, calculated_at |
| `ai_anomalies` | Anomalías detectadas automáticamente, con severidad y nivel de alerta | id, area, branch_id, anomaly_type, severity, title, description, supporting_data, affected_entities, is_acknowledged, acknowledged_by, acknowledged_at, is_recurring, occurrence_count, first_detected_at, created_at, alert_level |
| `ai_recommendations` | Recomendaciones accionables derivadas de las anomalías | id, area, branch_id, title, description, expected_impact, supporting_data, anomaly_id, status, actioned_by, actioned_at, action_notes, expires_at, created_at |

### Plataforma

| Tabla | Para qué sirve | Columnas |
|---|---|---|
| `branches` | Sucursales y depósitos, con grupo logístico | id, code, name, address, city, phone, is_central_warehouse, is_active, created_at, updated_at, logistic_group |
| `profiles` | Perfil del usuario ligado a la cuenta de acceso | id, user_id, full_name, phone, default_branch_id, avatar_url, is_active, created_at, updated_at, all_branches_access |
| `user_roles` | Roles del usuario, en tabla separada por seguridad | id, user_id, role, branch_id, created_at |
| `profile_branch_access` | Sucursales habilitadas por perfil | id, profile_id, branch_id, created_at |
| `user_module_access` | Módulos habilitados o deshabilitados por perfil | id, profile_id, module_key, is_enabled, created_at |
| `sync_logs` | Historial de cada corrida de sincronización con BIMS y su resultado | id, entity, status, total_received, total_processed, total_inserted, total_updated, total_failed, total_skipped, errors, started_at, completed_at, triggered_by, created_at, duration_seconds |

## Anexo B — Tipos enumerados

Los enums son el vocabulario cerrado del sistema: si un valor no está acá, la base lo rechaza.

| Enum | Valores |
|---|---|
| `alert_level` | branch_operational, escalable, logistics_admin_decision |
| `anomaly_severity` | info, warning, critical |
| `app_role` | admin, supervisor, warehouse_operator, driver, collector, branch_manager, branch_operator, viewer, owner, jefe_logistica, salesperson |
| `consultation_status` | open, responded, converted, expired |
| `damage_cause` | collaborator, customer, sealed_package, product_defect |
| `damage_origin` | transfer_reception, collaborator, customer, sealed_package, product_defect |
| `delivery_target` | branch, client |
| `detection_context` | transfer_reception, supplier_reception, internal |
| `directed_inventory_status` | planned, in_progress, completed, cancelled |
| `document_status` | issued, with_driver, delivered_to_client, signed_by_client, with_admin, sent_to_collector, received_by_collector, presented_to_client, collection_scheduled, collection_completed, archived |
| `document_type` | invoice, remission, signed_invoice, credit_note, delivery_receipt |
| `event_category` | request, fulfillment, document, trip, inventory, incident, vehicle, collection, stock, preparation, transport, reception, closure |
| `fine_status` | pending, paid, appealed, cancelled |
| `fulfillment_status` | pending, picking, waiting_for_cut, waiting_for_courier, dispatched, in_transit, delivered, pending_physical_confirmation, received, partial, completed, cancelled, at_hub, delivery_failed |
| `incident_status` | open, under_review, resolved, escalated, closed |
| `incident_type` | damaged, missing, surplus, wrong_product, expired, admin_stock, fair_stock |
| `item_purpose` | client, reposition |
| `kpi_aggregation` | count, sum, average, percentage, ratio, min, max |
| `kpi_area` | logistics, warehouse, fleet, collections, inventory, fulfillment, general |
| `package_label_type` | inter_branch, customer, courier |
| `recommendation_status` | pending, accepted, rejected, expired |
| `rejection_reason_type` | no_stock_real, stock_difference, product_not_found, stock_reserved, not_convenient_rotation, other |
| `request_status` | pending, in_preparation, accepted, rejected, picking, dispatched, in_transit, delivered, received, logistic_closed, closed, ready_for_pickup, ready_for_delivery, in_consolidation, assigned_to_trip, delivered_to_third_party, draft, in_supply, supplied |
| `request_type` | client, reposition, mixed, online, redistribution, pre_sale_online |
| `reserve_reason` | branch_request, client_order, pending_fulfillment |
| `reserve_type` | soft, hard |
| `shipping_method` | own_fleet, courier, pickup, delivery |
| `stock_disposition` | ajuste_inventario, reclamo_proveedor, descuento_colaborador, imputacion_salon, imputacion_sucursal, perdida_empresa, venta_feria, reconteo_pendiente, other |
| `trip_status` | planned, in_progress, completed, cancelled |
| `trip_type` | urban_cutoff, interurban_planned, supplier_pickup |
| `vehicle_loan_status` | requested, approved, active, returned, cancelled |
| `vehicle_status` | available, in_route, maintenance, out_of_service |

## Anexo C — Funciones de base de datos

Todas las funciones marcadas como `SECURITY DEFINER` corren con los privilegios del dueño: se usan para validar accesos sin caer en recursión de políticas y para ejecutar operaciones transaccionales completas. El permiso de ejecución está revocado para usuarios anónimos.

### Control de acceso

| Función | Qué hace |
|---|---|
| `has_role(user, role)` | Verdadero si el usuario tiene ese rol. Base de casi todas las políticas |
| `has_role_in_branch(user, role, branch)` | Igual, pero acotado a una sucursal |
| `can_access_branch(user, branch)` | Verdadero si el usuario tiene acceso total o esa sucursal habilitada |
| `is_owner(user)` / `is_privileged(user)` | Atajos para dueño y para el conjunto dueño/admin/supervisor |
| `is_own_driver(user, driver)` | Verdadero si ese registro de chofer es del propio usuario |
| `fn_can_access_request(user, request)` | Acceso al pedido por participación: origen, destino, creador o rol privilegiado |
| `fn_can_access_fulfillment(user, fulfillment)` | Igual para órdenes de cumplimiento, incluyendo al chofer asignado |
| `fn_can_access_inventory(user, inventory)` | Acceso a inventarios dirigidos por sucursal o asignación |
| `fn_can_view_consultation(user, consultation)` | Acceso a la consulta: quien la creó o una sucursal consultada |
| `fn_is_fleet_manager(user)` | Verdadero para quien administra flota |
| `fn_get_request_client_contact(request)` | Única vía para leer teléfono y email del cliente, con control de acceso |
| `get_users_emails()` | Lista de correos para la administración de usuarios |

### Pedidos y abastecimiento

| Función | Qué hace |
|---|---|
| `fn_transition_request_status(...)` | Único punto de cambio de estado del pedido: bloquea la fila, valida la transición, registra el evento |
| `fn_commit_supply_resolution(request, resoluciones, idempotency_key)` | Confirma el abastecimiento en una sola transacción: guarda el aporte local, crea los pedidos hijos por sucursal y registra el faltante |
| `fn_try_promote_supplied(parent)` / `fn_auto_promote_to_supplied()` / `fn_auto_promote_on_local_qty()` | Promueven el pedido de `in_supply` a `supplied` cuando la cobertura está resuelta, incluso si es 100% local y no hay hijos |
| `fn_confirm_local_supply(request)` | Confirmación de abastecimiento local (uso interno, sin exposición al cliente) |
| `fn_start_operation_from_supplied(payload)` | Arranca la operación logística sobre un pedido ya abastecido |
| `fn_send_presale_to_operation(request, branch)` | Convierte una pre-venta en pedido operativo nuevo, dejando la pre-venta original bloqueada |
| `fn_sync_parent_status()` / `fn_close_parent_if_complete(parent)` / `fn_trg_close_parent_on_child_change()` / `fn_is_parent_request(request)` | Mantienen coherente el pedido padre con sus hijos multi-origen |
| `fn_recalculate_flow_type(request)` / `fn_derive_flow_type(...)` / `fn_autoset_flow_type()` | Derivan si el pedido es de entrada, salida o interno |
| `fn_check_request_closure()` / `fn_validate_request_edit()` | Controlan el cierre y bloquean ediciones después del tránsito |
| `fn_validate_business_rules()` / `fn_validate_different_branches()` / `fn_validate_delivery_charges()` | Reglas duras: método de envío válido, origen distinto del destino (con la excepción de la sucursal online) y costo de envío obligatorio cuando corresponde |
| `fn_validate_pre_sale_coherence()` / `fn_block_items_on_converted_presale()` / `fn_block_fulfillment_for_presale()` / `fn_block_fulfillment_in_supply()` / `fn_block_supply_transitions()` | Impiden estados imposibles: tocar una pre-venta ya convertida o despachar algo todavía sin abastecer |
| `fn_clear_for_pickup(request_ids)` | Habilita el retiro de uno o varios pedidos |

### Consultas

| Función | Qué hace |
|---|---|
| `fn_respond_consultation_target(target, cantidad, colores, nota)` | Responde una consulta con bloqueo de fila para evitar respuestas pisadas |
| `fn_close_expired_consultations()` | Cierre automático por vencimiento, ejecutado por tarea programada |
| `fn_catalog_facets()` | Devuelve marcas y categorías con su conteo para los filtros del catálogo |

### Viajes y chofer

| Función | Qué hace |
|---|---|
| `fn_driver_action(accion, fulfillment, trip, metadata)` | Punto único para las acciones del chofer: retirar, cargar, transferir custodia, entregar, fallar entrega, dejar en acopio, recibir |
| `fn_accept_and_start_trip(trip, fulfillments, km_inicial, forzar_vacio)` | Acepta cargas y arranca el viaje en una sola operación |
| `fn_validate_driver_pickup(fulfillment)` | Verifica que existan los documentos requeridos antes de que el chofer retire |
| `fn_edit_trip(...)` / `fn_cancel_trip(trip, motivo)` | Edición y cancelación controladas del viaje |
| `fn_get_trip_detail(trip)` / `fn_get_trip_driver_names(trips)` | Lectura de viaje y de nombres de chofer sin exponer tablas sensibles |
| `fn_ensure_driver_for_user(user)` | Crea o recupera la ficha de chofer del usuario |

### Flota

| Función | Qué hace |
|---|---|
| `fn_compute_fuel_efficiency()` | Calcula km/litro al registrar una carga |
| `fn_recompute_vehicle_mileage(vehicle)` / `fn_trg_recompute_mileage()` | Recalculan el kilometraje del vehículo a partir de los usos cerrados |
| `fn_maintenance_autoschedule()` | Programa el próximo mantenimiento según recurrencia por km o por días |
| `fn_vu_enforce_status()` | Impide cerrar un uso sin los datos obligatorios y mantiene coherente el estado |

### Alertas y control

| Función | Qué hace |
|---|---|
| `fn_preparation_time_alert()` | Alerta cuando la preparación excede el tiempo esperado |
| `fn_bims_deadline_check()` | Alerta por vencimiento del plazo de confirmación en BIMS |
| `fn_rejection_inventory_alert()` | Genera alerta de inventario ante un rechazo por diferencia o producto no encontrado |
| `fn_auto_resolve_alerts()` | Cierra alertas cuando la condición que las originó desaparece |
| `fn_auto_close_commercial_exception()` | Cierra la excepción comercial una vez resuelta |
| `fn_protect_owner_profiles()` / `fn_protect_owner_roles()` / `fn_protect_owner_branch_access()` | Impiden que el dueño sea desactivado, degradado o dejado sin acceso |
| `fn_handle_new_user()` | Crea el perfil al darse de alta un usuario |
| `update_updated_at_column()` / `set_sales_catalog_draft_updated_at()` | Mantienen la marca de última modificación |

## Anexo D — Edge functions

| Función | Disparador | Qué hace |
|---|---|---|
| `bims-proxy` | Llamada desde la app | Puerta de entrada de sólo lectura al ERP: catálogo, clientes, precios. Concentra las credenciales del lado del servidor |
| `bims-stock-live` | Llamada desde la app | Consulta de stock en vivo por producto y depósito, usada para validar antes de comprometer mercadería |
| `bims-sync` | Manual y programado | Sincroniza el catálogo a `products`, con control de cobertura, bajas suaves y registro en `sync_logs` |
| `bims-image-proxy` | Etiqueta `<img>` y generación de PDF | Sirve las fotos de producto evitando problemas de origen cruzado; en modo PDF responde sin caché para que el archivo salga con las imágenes reales |
| `create-user` | Administración de usuarios | Alta de usuario con perfil, roles y accesos en una sola operación |
| `reset-user-password` | Administración de usuarios | Restablece la contraseña y obliga al cambio en el próximo ingreso |
| `commercial-escalation` | Tarea programada | Escala las excepciones comerciales que superan el plazo de resolución |
| `shipment-reminders` | Tarea programada | Recuerda los envíos de mercadería averiada pendientes hacia administración |
| `fleet-daily-alerts` | Tarea programada | Avisos diarios de flota: viajes abiertos hace más de 24 horas, vencimientos y mantenimientos próximos |
| `executive-insights` | Tablero ejecutivo | Genera el análisis narrativo y las recomendaciones del tablero de dirección |
| `trip-eligible-drivers` | Armado de viajes | Devuelve los choferes habilitados para tomar un viaje |

## Anexo E — Convenciones del proyecto

**Estados de pedido compartidos.** Ninguna pantalla define su propia lista de estados activos o cerrados: todas importan desde `src/lib/request-status.ts` (`ACTIVE_REQUEST_STATUSES`, `CLOSED_REQUEST_STATUSES`, `DASHBOARD_PENDING_REQUEST_STATUSES`, `FULFILLMENT_TERMINAL_STATUSES`). Esta regla existe porque duplicar la lista ya provocó que pedidos reales desaparecieran de la bandeja.

**Formato numérico.** Números y montos se muestran con `toLocaleString("de-DE")` y guaraní como moneda (₲), que es el formato con punto de miles usado en Paraguay.

**Enlaces profundos.** Los detalles se abren con `?detail=UUID` en la URL, y la URL se limpia al abrir el modal. Así se puede compartir un pedido puntual por mensaje.

**Lenguaje.** Toda la interfaz está en castellano paraguayo operativo, con frases directas. La lectura de contexto es siempre "De: origen / Para: destino".

**Diseño.** Producto técnico minimalista, tema oscuro, Space Grotesk para títulos e Inter para texto. Los colores se definen como tokens semánticos en el CSS global; no se usan colores fijos en los componentes para no romper el tema.

**Pruebas.** Vitest cubre la lógica de negocio más frágil: resolución de abastecimiento (`use-supply-resolution.test.tsx`), persistencia local (`use-idb-state.test.tsx`) y generación de catálogo PDF (`catalogo-pdf.test.ts`).

## Anexo F — Módulos en fase futura

Estas rutas existen en el menú o en el ruteo pero todavía no tienen funcionalidad completa. Se listan para que no se las confunda con módulos activos:

| Ruta | Estado real |
|---|---|
| `/abastecimiento` | Pantalla informativa. Prevista para retiros de proveedor y órdenes de compra |
| `/reposicion` | Pantalla informativa. La reposición hoy se hace desde Pedidos |
| `/pedidos` | Pantalla informativa. Los pedidos online se gestionan hoy desde `/solicitudes` |
| `/distribucion` | Implementación parcial de distribución; el flujo principal sigue siendo Ruteo y la app del Chofer |

