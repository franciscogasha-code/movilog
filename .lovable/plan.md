

## Plan: Bloque de motivo de rechazo en SolicitudDetail

### Archivo a modificar
`src/components/solicitudes/SolicitudDetail.tsx`

### Cambios

**1. Resolver nombre del usuario que rechazó**

Agregar un `useQuery` que consulte `profiles.full_name` usando `r.rejected_by`, habilitado solo cuando `r.status === "rejected"` y `r.rejected_by` existe. Reutiliza el mismo patrón que `OperationalResponsibleName`.

**2. Agregar bloque visual de rechazo**

Insertar inmediatamente después del header (después de la línea 247, antes del action panel) un bloque condicional `{r.status === "rejected" && (...)}` con:

- **Contenedor**: `rounded-lg border border-destructive/20 bg-destructive/5 p-4`
- **Encabezado**: icono `XCircle` rojo suave + título "Motivo del rechazo" en `font-semibold`
- **Contenido** (grid 1-2 columnas):
  - **Motivo**: `REJECTION_REASONS[r.rejection_reason_type]` o fallback "No especificado"
  - **Observación**: `r.rejection_reason` si existe, sino "Sin observaciones"
  - **Rechazado por**: nombre resuelto del query, o "Usuario desconocido"
  - **Fecha**: `r.rejected_at` formateado con `toLocaleString("es-PY")`, o "Sin fecha"

**3. Import adicional**

Agregar `XCircle` de lucide-react.

### No se modifica
- Lógica de negocio ni flujo de rechazo
- Backend ni RPC
- Otros componentes
- Layout existente

### Validación
- TypeScript sin errores
- Responsive: el bloque usa `grid-cols-1 sm:grid-cols-2`, legible en mobile
- Sin desbordes ni doble scroll
- Cumple checklist UI

