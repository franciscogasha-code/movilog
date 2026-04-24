
# Plan quirúrgico — Visibilidad y UX en Pedidos (etapa 1)

**Alcance estricto**: solo `src/pages/Solicitudes.tsx` y `src/components/solicitudes/SolicitudDetail.tsx`. **Sin** tocar RLS, RPC, triggers, queries de creación, choferes, transporte, consultas, dashboard ni schema. Sin migraciones SQL.

---

## Diagnóstico confirmado (consulta a DB)

| # | Rol | parent_id | requesting | source | Estado | Notes |
|---|---|---|---|---|---|---|
| 256 | Padre legacy | — | San Roque | San Roque | pending | `[Pedido padre multi-origen] [LEGACY 1-hijo]` |
| 257 | Hijo de 256 | 256 | San Roque | Caballero | ready_for_pickup | — |
| 260 | Padre legacy | — | San Roque | San Roque | pending | `[Pedido padre multi-origen] [LEGACY 1-hijo]` |
| 261 | Hijo de 260 | 260 | San Roque | Caballero | pending | — |
| 264 | Padre real | — | Caballero | Caballero | accepted | `[Pedido padre multi-origen] enviar con el corte.` |
| 268 | Hijo de 264 | 264 | Caballero | San Roque | rejected | `enviar con el corte.` |

**Conclusiones**:
1. Datos correctos. **No hay inversión** en #268 (Caballero pide, San Roque abastece).
2. #256/#260/#264 hoy están filtrados out por `notes ilike '%[Pedido padre multi-origen]%'`. Por eso "no aparecen" al buscar `#256`.
3. #257/#261 sí aparecen al buscar por su número, pero no muestran su vínculo con el padre.
4. La confusión percibida es de **microcopy** ("origen" vs "solicitante") + **falta de vínculo visual** padre↔hijo.

---

## Cambio 1 — Búsqueda inteligente padre↔hijo (Solicitudes.tsx)

**Archivo**: `src/pages/Solicitudes.tsx`, en `buildQuery` (líneas ~252-325).

**Comportamiento nuevo cuando el término de búsqueda es numérico**:

1. Pre-fetch ligero: `select id, parent_request_id from branch_requests where request_number = <n>`.
2. Construir set de IDs relacionados:
   - El propio registro encontrado.
   - Su `parent_request_id` (si existe).
   - Todos los hermanos con el mismo `parent_request_id`.
   - Todos los hijos cuyo `parent_request_id = <id encontrado>` (caso buscar padre).
3. **Bypass del filtro `notes ilike '%[Pedido padre multi-origen]%'`** únicamente en este modo de búsqueda numérica, para que el padre aparezca en el listado.
4. **Bypass de filtros de tab/estado/sucursal** durante búsqueda numérica explícita (cuando el usuario tipea un `#N`, el resultado debe encontrarse siempre que tenga permisos RLS — no debe quedar oculto por la pestaña activa).
5. Construir `query.in("id", [...idsRelacionados])` sustituyendo el `or(request_number.eq.<n>, ...)` actual.

Pseudocódigo dentro de `buildQuery`:

```ts
if (debouncedSearch) {
  const term = debouncedSearch.replace(/^#/, "");
  const numeric = /^\d+$/.test(term);

  if (numeric) {
    // (resuelto vía hook auxiliar useRelatedIds o fetch awaitable previo)
    // ids = [match.id, match.parent_request_id, ...siblings, ...children].filter(Boolean)
    query = query.in("id", ids);
    // NO aplicar filtro de notes para padre, NO restringir por tab/status/branch
  } else {
    // texto: comportamiento actual (client_name, bims_invoice)
    query = query.or(`client_name.ilike.%${term}%,bims_invoice_number.ilike.%${term}%`);
  }
}
```

Como `usePaginatedQuery.buildQuery` es síncrono, el resolver de IDs relacionados se hace en una `useQuery` previa (`["request-related-ids", debouncedSearch]`) y los `ids` se inyectan en el `queryKey` para refrescar correctamente. Si la búsqueda numérica no arroja match, se cae al comportamiento actual (`request_number.eq.<n>` directo) para no romper.

**RLS intacto**: Supabase sigue aplicando las políticas; solo le mostramos los IDs relacionados que el usuario pueda ver según su rol.

---

## Cambio 2 — Badge "Parte de #N" en filas hijas (Solicitudes.tsx)

En el mapeo de filas (mobile + desktop, líneas ~676-810), cuando `r.parent_request_id != null`:

- Agregar un `Badge variant="outline"` pequeño junto al `#request_number`:
  - Texto: `Parte de #<parentNumber>`
  - Estilo: `text-[10px] border-accent/50 text-accent`
  - Tooltip: "Pertenece a un pedido padre multi-origen. Click para abrir el padre."
  - **Click independiente** (con `e.stopPropagation()`) que setea `setSelectedId(parentId)`.

Para resolver el `request_number` del padre sin un join pesado, se agrega al `select()` actual:
```
parent:branch_requests!branch_requests_parent_request_id_fkey(id, request_number)
```
Si la FK nombrada no existe en el cliente, se usa `parent:parent_request_id(request_number)` o un mapa pre-fetcheado de IDs únicos visibles. Validaré antes de tocar.

**Sin cambios** en el filtro general: los padres siguen ocultos en navegación normal (solo accesibles por búsqueda numérica o deep-link), preservando la decisión actual de no saturar bandejas.

---

## Cambio 3 — Microcopy Solicitante / Abastecedora (SolicitudDetail.tsx)

**Archivo**: `src/components/solicitudes/SolicitudDetail.tsx`, líneas 553-567.

Reemplazar las dos cards "Sucursal origen (abastecedora)" y "Sucursal solicitante (destino)" por versiones con tooltip y aclaración explícita:

```
┌─ Sucursal solicitante ─────────────┐  ┌─ Sucursal abastecedora ────────────┐
│ <reqName>                          │  │ <srcName>                          │
│ Quien necesita el stock            │  │ Quien provee el stock              │
└────────────────────────────────────┘  └────────────────────────────────────┘
```

- **Orden invertido**: primero "Solicitante" (lectura natural: quién pide → quién provee).
- Subtítulo `text-[11px] text-muted-foreground` con la definición.
- Tooltip en el ícono `?` opcional (`HelpCircle`) con texto extendido.
- Mantener todos los campos existentes debajo (delivery_target, shipping_method, etc.) sin cambios.

Cero cambios de lógica, solo presentación.

---

## Lo que NO se toca (garantía de no regresión)

- ❌ Creación mono-origen ni multi-origen (`SolicitudCreateForm.tsx`).
- ❌ RLS, RPCs (`fn_transition_request_status`, etc.), triggers, schema.
- ❌ Filtros de tab `mios`/`otros`/`activos`/`cerrados` en navegación normal.
- ❌ Conteos de tabs (`tabCounts`).
- ❌ Dashboard (`Index.tsx`), Chofer, Transporte, Consultas, Recepción.
- ❌ Limpieza/cierre de padres legacy (queda para etapa siguiente).
- ❌ `ParentRequestSummary.tsx` (ya muestra hijos cuando se abre el padre por deep-link).

---

## Pruebas a ejecutar en preview (con evidencia)

| Caso | Acción | Resultado esperado |
|---|---|---|
| A | Buscar `#257` | Aparecen #257 (hijo) y #256 (padre legacy). Fila #257 muestra badge "Parte de #256". |
| B | Buscar `#256` | Aparecen #256 (padre) y #257 (hijo). |
| C | Buscar `#261` | Aparecen #261 + #260. |
| D | Buscar `#268` | Aparecen #268 + #264 (padre real, accepted). |
| E | Buscar `#264` | Aparecen #264 + #268. |
| F | Abrir #268 | Detalle muestra: "Sucursal solicitante: Caballero — Quien necesita el stock" / "Sucursal abastecedora: San Roque — Quien provee el stock". |
| G | Listado normal sin búsqueda | #256/#260/#264 siguen ocultos (sin regresión de bandejas). |
| H | Crear pedido nuevo mono-origen | Funciona idéntico. |
| I | Dashboard / Chofer / Consultas | Sin cambios visuales ni de comportamiento. |

---

## Entregables

1. Archivos modificados (solo dos).
2. Capturas de los casos A, D, F (desktop) + A en mobile (390px).
3. Confirmación explícita de que las pruebas G/H/I pasan sin cambios.
4. Nota: limpieza de padres legacy y opción de "ocultar/mostrar contenedores" quedan documentadas para una segunda etapa.
