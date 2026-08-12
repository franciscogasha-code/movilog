# Módulo Ventas (Catálogo Vendedor) — reemplazo de Vector

## Objetivo
Dar al vendedor externo un módulo de catálogo con fotos, carrito y cierre de pre-venta desde tablet/celular, con datos vivos de BIMS (precios, listas por cliente, stock, nuevos ingresos), que termine creando una **Pre-Venta Online** con el flujo operativo que ya existe en MoviLog.

## Decisiones tomadas
- Clientes: cartera desde BIMS + posibilidad de cargar cliente nuevo a mano.
- Precios: lista de precios por cliente (BIMS), más escalas por cantidad.
- Offline básico: catálogo cacheado y carrito local, sincroniza al recuperar señal.
- Cierre: crea una Pre-Venta Online existente (`pre_sale_online`), sin cambiar reglas ni el flujo de preparación.

## Cómo lo va a usar el vendedor
```text
Inicio Ventas → Elegir cliente (cartera BIMS o nuevo)
   → Catálogo (categorías, buscador, filtros marca/subcategoría, "solo con stock")
   → Ficha de producto (fotos, precio del cliente, escalas, stock por depósito)
   → Carrito (editar cantidad, quitar, total)
   → Confirmar (forma de pago, tipo de envío, notas)
   → Pre-Venta creada → sigue el flujo operativo actual de MoviLog
```

Pantallas:
1. **Mis clientes** — buscador de cartera, últimos visitados, botón "Cliente nuevo".
2. **Catálogo** — grilla con foto, código, descripción, precio y chip de stock; navegación por categorías; toggle "Stock disponible"; filtros por marca y subcategoría; escaneo de código de barras con la cámara. Modo selección múltiple (tildes por producto) para armar una lista y **generar PDF**.
3. **Ficha de producto** — galería, descripción, stock por almacén, precio del cliente, escalas por cantidad, selector de cantidad, "Agregar al carrito".
4. **Carrito** — ítems con +/−, edición de cantidad, total, notas, "Guardar pedido" (borrador) y "Enviar pedido".
5. **Confirmar** — cliente, forma de pago, moneda, tipo de envío, total, notas, "Confirmar".
6. **Mis pedidos** — lista de pre-ventas del vendedor con su estado real (preparación, tránsito, entregado), es decir la trazabilidad completa.
7. **Visitas** — check-in/check-out en el cliente, mapa de clientes cercanos y agenda del día.

## Catálogo en PDF para enviar al cliente
- En el catálogo, el vendedor tilda los productos que quiere mostrar y toca "Generar PDF".
- El PDF sale con marca SANSEI (mismo estándar del PDF de Pre-Venta): logo, datos del cliente si hay uno seleccionado, y por producto foto, código, descripción, precio del cliente y escalas por cantidad. Opción de mostrar u ocultar precios.
- Se descarga en el dispositivo y se comparte por WhatsApp, mail o lo que el vendedor prefiera (botón "Compartir" nativo cuando el dispositivo lo soporta).
- Queda registrado qué catálogo se envió a qué cliente y cuándo, para seguimiento comercial.


## Datos vivos de BIMS
- **Catálogo base**: sigue viniendo de la sincronización actual de `products` (rápido, buscable, con imágenes).
- **Stock y precio en vivo**: al abrir la ficha y al confirmar el carrito se consulta BIMS en vivo (mismo mecanismo de `bims-stock-live`), con indicador "Stock en vivo / sincronizado".
- **Lista de precios del cliente**: se resuelve con la lista asignada al contacto en BIMS aplicada sobre los precios ya sincronizados del producto.
- **Revalidación al confirmar**: si un precio o stock cambió respecto de lo que vio el vendedor, se avisa antes de cerrar la pre-venta (no bloquea, informa).

## Trazabilidad desde el cierre
- La pre-venta queda con vendedor, cliente, sucursal y canal registrados.
- El vendedor ve en "Mis pedidos" el estado operativo real en cada etapa, sin acceso al resto de módulos.
- Nada del ciclo actual de preparación/logística se modifica.

## Alcance por fases

**Fase 1 — Catálogo y venta (núcleo)**
- Rol vendedor y módulo `/ventas` con acceso restringido.
- Cartera de clientes (BIMS + alta manual), catálogo, ficha, carrito, confirmación.
- Cierre creando Pre-Venta Online con el flujo existente.

**Fase 2 — Precio por cliente y en vivo**
- Resolución de lista de precios por cliente, escalas por cantidad, revalidación al confirmar.

**Fase 3 — Offline básico**
- Catálogo e imágenes cacheados, carrito y borradores persistidos en el dispositivo, cola de envío que sincroniza al recuperar conexión, indicador de estado.

**Fase 4 — Seguimiento del vendedor**
- "Mis pedidos" con estado operativo, historial por cliente y reordenar pedido anterior.

## Detalle técnico

Base de datos (una migración por fase):
- `sales_customers`: espejo local de contactos BIMS (`bims_contact_id`, nombre, RUC, dirección, teléfono, `price_list_id`, `is_active`) + clientes creados en MoviLog (`created_by`, `source`).
- `salesperson_customers`: asignación vendedor ↔ cliente (cartera).
- `sales_carts` / `sales_cart_items`: borradores del vendedor (permite "Guardar pedido" y offline sync idempotente por `client_uuid`).
- Nuevo valor de rol `salesperson` en `app_role`; RLS: el vendedor sólo ve su cartera, sus carritos y sus pre-ventas.
- GRANTs explícitos en cada tabla nueva + RLS estricta (sin `USING (true)`).

Backend:
- Extender `bims-proxy` con `sync-contacts` (usa el `get-contacts` que ya existe) y sincronización de listas de precios; cron diario + botón manual en Sincronización BIMS.
- Reusar `bims-stock-live` para stock y precio en vivo (chunks de 20).

Frontend:
- Nueva ruta `/ventas` con layout mobile-first (viewport tablet/celular), entrada en el sidebar sólo para rol vendedor/admin.
- Componentes nuevos en `src/components/ventas/`: `ClientePicker`, `CatalogoGrid`, `CategoriaNav`, `ProductoFicha`, `CarritoPanel`, `ConfirmarVenta`, `MisPedidosVendedor`.
- El cierre reutiliza exactamente la lógica de creación de `pre_sale_online` que hoy vive en `SolicitudCreateForm` (se extrae a un helper compartido, sin cambiar reglas de negocio ni validaciones).
- Offline: React Query con persistencia en IndexedDB + service worker para imágenes; carrito en almacenamiento local con reconciliación al reconectar.

## Fuera de alcance inicial
- Cobranzas o pagos dentro del módulo de ventas.
- Comisiones y objetivos de venta por vendedor.
- Geolocalización o control de visitas.
