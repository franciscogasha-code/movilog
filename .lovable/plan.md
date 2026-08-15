# Documentación maestra de MoviLog

Un solo documento que describe todo el sistema: cada módulo, cada funcionalidad, por qué existe, cómo está programada y para qué sirve en la operación.

## Qué se entrega

1. `docs/MOVILOG.md` — fuente de verdad, versionada junto al código.
2. `MoviLog-Documentacion-Tecnica-Funcional.docx` — mismo contenido en Word, con portada SANSEI, índice navegable y tablas, listo para compartir.

## Estructura del documento

**Parte I — Contexto**
- Qué es MoviLog, qué reemplaza (WhatsApp, Vector), a quién sirve.
- Mapa de módulos y cómo se conectan entre sí.
- Ciclo de vida de un pedido de punta a punta (diagrama en texto).
- Roles operativos y qué puede hacer cada uno.
- Relación con BIMS (ERP): qué es fuente de verdad y qué no.

**Parte II — Módulos** (una sección por módulo, mismo formato en todos)

Para cada uno: propósito operativo · por qué se creó (problema que resuelve) · flujo de usuario paso a paso · reglas de negocio y validaciones · qué se ve en pantalla · datos que usa (tablas) · lógica de servidor (RPC, triggers, edge functions) · permisos y visibilidad (RLS) · archivos del código.

Módulos cubiertos:
- Principal / Panel operativo unificado
- Dashboard Ejecutivo (KPIs, SLAs, score)
- Consultas de disponibilidad
- Solicitudes y Pedidos (incluye pre-venta, importación Excel, multi-origen, abastecimiento Fase 5A)
- Stock comprometido y stock especial
- Cumplimiento / fulfillment
- Logística: ruteo, viajes, consolidación
- App del Chofer (custodia, entregas, cortes urbanos)
- Recepción física y conciliación con BIMS
- Incidencias y averiados
- Documentos y trazabilidad documental
- Etiquetas y bultos
- Alertas y excepciones comerciales
- Rendición (combustible, viáticos, cobranzas, depósitos)
- Flota / Control de móviles (usos, combustible, multas, mantenimientos)
- Ventas (catálogo, cliente, carrito, PDF, modo cliente, offline)
- Usuarios, roles y accesos por sucursal
- Sincronización BIMS
- Módulos en fase futura (Abastecimiento, Reposición, Distribución, Cobranzas)

**Parte III — Anexos técnicos**
- Diccionario de tablas: cada tabla, para qué sirve, columnas clave, relaciones.
- Catálogo de funciones de base de datos: qué hace cada RPC y cada trigger, y quién lo invoca.
- Edge functions: propósito, disparador (manual/cron), entradas y salidas.
- Modelo de seguridad: RLS por tabla, helpers de acceso, protección de datos del cliente (teléfono/email), Storage.
- Trabajo sin conexión: carrito persistente, cola de envío, service worker.
- Convenciones del proyecto: estados de pedido, formato numérico paraguayo, deep-linking, diseño de UI.

## Cómo se construye

- Lectura sistemática del código real: páginas, componentes, hooks, `src/lib`, edge functions.
- Consulta directa a la base para columnas, políticas RLS, definiciones de funciones y triggers, de modo que el anexo refleje el estado real y no una suposición.
- Los flujos se describen tal como están implementados hoy; lo que esté a medias o pendiente se marca explícitamente como tal en vez de presentarse como terminado.
- El Word se genera desde el Markdown con estilos SANSEI (tipografía legible, tablas con bordes, encabezados de nivel 1-3, numeración de páginas).

## Verificación antes de entregar

- Revisión página por página del DOCX convertido a imágenes: sin texto cortado, tablas sin desbordes, índice correcto.
- Chequeo cruzado de que cada ruta de `src/App.tsx`, cada tabla y cada edge function del proyecto aparezca en el documento; ninguna queda sin describir.

## Nota de alcance

Es un documento extenso (estimado 70-100 páginas). Se escribe en castellano paraguayo operativo, con la parte narrativa entendible por alguien no técnico y el detalle de tablas/funciones concentrado en cada sección técnica y en los anexos.
