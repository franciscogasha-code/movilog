

# Plan integral — Módulo Consultas (UX/UI + orden operativo)

Una sola implementación, conservadora, sin tocar lógica de negocio, RLS, RPCs ni queries de detalle/chat/conversión.

## Alcance único: `src/pages/Consultas.tsx`

No se tocan: `ConsultationDetail`, `ConsultationForm`, RLS, `fn_close_expired_consultations`, cron, conversión a pedido, deep-link (`?detail=UUID` ya implementado), invalidaciones existentes.

---

## Cambios a aplicar

### 1. Bandeja activa — blindaje
- Conservar `usePaginatedQuery` con whitelist server-side `.in("status", ["open", "responded"])` (ya implementado, solo confirmar).
- Mantener `count: "exact"`, orden por `created_at desc`, paginación 25.
- Sin cambios de queryKey (`availability-consultations-base`) → invalidaciones siguen funcionando.

### 2. Resumen de conteos (cabecera del listado)
Agregar **una sola query liviana** independiente, en paralelo, que **no interfiere con paginación**:

```ts
useQuery({
  queryKey: ["availability-consultations-counts"],
  queryFn: async () => {
    const [openRes, respRes] = await Promise.all([
      supabase.from("availability_consultations")
        .select("id", { count: "exact", head: true }).eq("status", "open"),
      supabase.from("availability_consultations")
        .select("id", { count: "exact", head: true }).eq("status", "responded"),
    ]);
    return { open: openRes.count ?? 0, responded: respRes.count ?? 0 };
  },
  staleTime: 30_000,
});
```

Render discreto sobre la tabla:

```text
[ Abiertas: 3 ]  [ Respondidas: 1 ]  [ Total activas: 4 ]
```

Estilo: chips muted pequeños, sin recargar visual. Ocultos si total = 0 (el empty state ya cubre).

### 3. Header compacto
- Título: `Consultas` (más corto, semánticamente claro en contexto del módulo).
- Subtítulo: `Disponibilidad entre sucursales`.

### 4. Empty state — mantener y pulir
Ya implementado correctamente. Solo verificar spacing y que el CTA "Nueva Consulta" funcione (ok).

### 5. Toggle / filtro
**Decisión conservadora: NO agregar.** Justificación: la decisión operativa ya excluye expired/converted; agregar toggle "Todas" reabre el ruido que se acaba de eliminar. Se documenta como decisión deliberada.

### 6. Tabla — ajustes conservadores de layout
- Columna **Productos**: subir `max-w` de `[200px]` a `[260px]` para reducir truncado agresivo.
- Columna **Ruta**: agregar `whitespace-nowrap` al wrapper de `buildRouteLabel` y `truncate` para evitar quiebres a múltiples líneas; tooltip ya existe para multi-destino.
- Columna **Pedidos**: chip más sobrio → `Badge variant="outline"` con texto `text-[11px]` en lugar de `secondary` (deja de "gritar" más que el estado).
- Columna **Respuestas**: mantener (ya es discreta).
- Columna **Fecha**: `whitespace-nowrap`.
- Columna **acción**: cambiar texto `Ver consulta` → `Abrir`. Mantener variante ghost.
- Tabla: mantener `overflow-x-auto` (defensivo en pantallas <1024px).

### 7. Microcopy
| Antes | Después |
|---|---|
| "Consultas de Disponibilidad" | "Consultas" |
| "Historial de consultas de stock entre sucursales" | "Disponibilidad entre sucursales" |
| "Ver consulta" | "Abrir" |
| Diálogo crear: "Consultar Disponibilidad" | "Nueva consulta" |

### 8. Singular/plural pedidos
Reemplazar `{c.orders_count} pedido(s)` por:
```ts
{c.orders_count} {c.orders_count === 1 ? "pedido" : "pedidos"}
```
Aplicar en mobile (línea 251) y desktop (línea 311).

### 9. Post-conversión
Sin cambios de código. La invalidación actual (`["availability-consultations"]`) en `onOrderCreated` cubre. La query base usa key `["availability-consultations-base", ...]` — al invalidar el prefijo `availability-consultations` ambas se refrescan. **Validar manualmente** tras conversión: la consulta convertida sale del listado.

### 10. Deep-link / detalle
Sin cambios. El `useEffect` que lee `?detail=UUID` y abre el modal sigue intacto y funciona aunque la consulta no esté en la página actual del listado (carga por id desde `ConsultationDetail`).

### 11. Jerarquía de badges
Aplicada en punto 6 (Pedidos baja a outline). Estado mantiene su `StatusBadge` (jerarquía visual primaria).

### 12. Mobile/desktop
- Mobile (cards): aplicar mismo plural fix y mismo cambio "pedido(s)"→"pedido/pedidos".
- Header: ya es `flex-col sm:flex-row`, sin cambios.
- Resumen de conteos: en mobile se renderiza en una sola fila con `flex-wrap`.

### 13. Semántica "Cerrar consulta" (converted sin pedido)
**No se toca en esta tanda.** Documentado: el botón sigue marcando `converted`; revisar en una iteración futura dedicada a semántica de estados (decisión de negocio explícita pendiente).

---

## Diseño visual del resumen (texto)

```text
┌──────────────────────────────────────────────────────────────┐
│  [Abiertas: 3]  [Respondidas: 1]  [Total activas: 4]         │
├──────────────────────────────────────────────────────────────┤
│  Productos     │ Ruta          │ Estado │ Resp │ Pedidos │ … │
│  ────────────────────────────────────────────────────────    │
│  Tornillo …    │ De: X → Para: │ Abierta│ 1/3  │ 1 pedido│ Abrir │
└──────────────────────────────────────────────────────────────┘
```

---

## Checklist de no regresión (a validar tras implementar)

- [ ] Crear consulta funciona (form + insert + invalidación).
- [ ] Responder consulta funciona (RPC sin cambios).
- [ ] Convertir a pedido funciona y la consulta desaparece del listado tras invalidación.
- [ ] Paginación server-side: page/pageSize/total/PaginationBar funcionando.
- [ ] Conteos del nuevo resumen consistentes con el listado (open + responded).
- [ ] RLS intacto (no se tocan policies ni funciones SQL).
- [ ] Deep-link `?detail=UUID` abre detalle aunque la consulta esté fuera de la página visible.
- [ ] Empty state visible cuando no hay activas; CTA Nueva Consulta funcional.
- [ ] Plural correcto: "1 pedido" / "2 pedidos".
- [ ] Sin errores TypeScript ni en consola.
- [ ] Mobile: cards legibles, sin overflow horizontal del header.

---

## Lo que NO se toca (decisión explícita)

- Lógica del botón "Cerrar consulta" (semántica `converted` sin pedido) — requiere decisión de negocio.
- Toggle "Activas / Todas" — se evita reintroducir ruido de expired/converted.
- `STATUS_CONFIG` keys — siguen alineadas al enum BD.
- `ConsultationDetail`, `ConsultationForm`, chat, RPCs.
- `usePaginatedQuery`, `PaginationBar`, `useUserBranchFilter`.

**Archivo único modificado:** `src/pages/Consultas.tsx`.

