

## Plan: Stock en tiempo real desde BIMS — Opción B (siempre fresco)

### Problema
El stock mostrado en búsquedas, consultas y pedidos viene de la DB local (hasta 1h de atraso). El usuario puede ver stock disponible, armar un pedido, y al confirmar descubrir que ya no hay.

### Solución
Consultar BIMS directamente cada vez que se muestran productos, con cache corto (30s) para no saturar la API.

### Cambios

**1. Nueva Edge Function: `supabase/functions/bims-stock-live/index.ts`**
- Recibe `{ bims_codes: string[] }` (máx 20 por llamada)
- Para cada código, llama a BIMS `GET /products?code={code}` y extrae `Availability`
- Retorna `{ [bims_code]: { stock_by_warehouse: Record<string, number>, total_stock: number } }`
- Reutiliza la misma autenticación MD5 + sesión cacheada de los otros proxies

**2. Nuevo hook: `src/hooks/use-live-stock.ts`**
- `useLiveStock(bimsCodes: string[])` — React Query con `staleTime: 30s`
- Retorna `Record<string, { stock_by_warehouse, total_stock }>` + `isLoading` + `isLive` flag
- Fallback silencioso: si BIMS falla, retorna `null` y se usan datos locales

**3. Integrar en `ProductSearch`**
- Después de recibir resultados de la DB, llama `useLiveStock` con los `bims_code` de los resultados
- Sobreescribe `stock_by_warehouse` y `total_stock` antes de renderizar
- Muestra indicador de carga mientras consulta BIMS

**4. Integrar en `ProductCard`**
- Acepta prop opcional `liveStock` que sobreescribe los datos locales
- Muestra badge "⚡ En vivo" (verde) cuando usa datos BIMS o "🕐 Sincronizado" (gris) cuando usa datos locales

**5. Integrar en `SolicitudCreateForm`**
- Al agregar producto y al mostrar la lista, usar `useLiveStock` para mostrar stock real
- `revalidateStock()` cambia de consultar la DB local a llamar `bims-stock-live` directamente

**6. Integrar en `Consultas` (ConsultationForm)**
- Los productos agregados muestran stock en vivo via `useLiveStock`

### Arquitectura

```text
Usuario busca/agrega producto
        │
        ▼
  useLiveStock(bims_codes)
        │ cache 30s
        ▼
  POST /bims-stock-live
        │
        ▼
  BIMS API: GET /products?code=X
        │ extrae Availability
        ▼
  { stock_by_warehouse, total_stock }
        │
        ▼
  UI muestra stock real + badge "En vivo"
```

### Archivos
| Archivo | Acción |
|---------|--------|
| `supabase/functions/bims-stock-live/index.ts` | Nuevo |
| `src/hooks/use-live-stock.ts` | Nuevo |
| `src/components/shared/ProductSearch.tsx` | Modificar — integrar live stock |
| `src/components/shared/ProductCard.tsx` | Modificar — prop liveStock + badge frescura |
| `src/components/solicitudes/SolicitudCreateForm.tsx` | Modificar — revalidateStock via BIMS |
| `src/pages/Consultas.tsx` | Modificar — live stock en formulario |

### Consideraciones
- Cache de 30s evita llamadas repetitivas sin perder frescura
- Máximo 20 códigos por llamada para evitar timeouts
- Si BIMS no responde, se muestran datos locales con indicador visual
- La sincronización horaria sigue activa para catálogo, precios y datos base

