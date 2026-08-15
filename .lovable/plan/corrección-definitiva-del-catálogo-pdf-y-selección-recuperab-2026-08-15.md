# Corrección definitiva del catálogo PDF y selección recuperable

## Diagnóstico confirmado

El PDF subido permite reconstruir exactamente la selección de **Todo Carne S.A.: 136 productos**.

La falla no está en el visor PDF ni en la maquetación:

- El archivo tiene 16 páginas y 136 imágenes de producto incrustadas, pero todas son placeholders grises de 320×320.
- Los 136 códigos siguen existiendo en el catálogo.
- **125 productos tienen `image_url` y 11 no tienen foto de origen**; esos 11 deben mantener un reemplazo explícito.
- Durante la generación registrada entre 13:20 y 13:27, el proxy recibió solo **59 solicitudes GET**; 58 respondieron 200 y una falló. Es decir, gran parte de las 125 fotos ni siquiera completó el recorrido hasta el proxy.
- Las fotos probadas individualmente (incluyendo 302027, 37743 y 327918) responden correctamente desde el proxy con contenido de imagen válido.

La causa raíz es la arquitectura actual del generador: el navegador intenta descargar, decodificar, redimensionar y convertir cada foto remota mientras el service worker también intercepta esas URLs. Ante timeout, cancelación, caché incompatible o error de decodificación, el código captura el error sin registrar su etapa y lo reemplaza silenciosamente por un recuadro gris. Después permite descargar el PDF aunque la generación haya fallado masivamente. El parámetro `fresh` cambia la URL, pero no evita que la ruta siga pasando por la estrategia `CacheFirst` del service worker.

## Implementación

### 1. Guardar y recuperar esta selección

- Crear un borrador nombrado **“Todo Carne – diagnóstico 15/08/2026”** con los 136 productos reconstruidos del PDF subido.
- Guardar borradores de catálogo por usuario en Lovable Cloud con RLS estricta: solo su creador puede ver, editar o borrar sus selecciones.
- Guardar IDs, cliente, filtros, opciones del PDF, nombre y fecha; **no guardar el PDF ni duplicar las imágenes**.
- Agregar en Ventas acciones simples para guardar, restaurar, renombrar y borrar una selección.
- Autoguardar la selección activa antes de iniciar una generación y dejar de borrarla automáticamente al salir del modo PDF; “Limpiar selección” será una acción explícita.

### 2. Sacar las solicitudes PDF de la caché problemática

- Marcar las solicitudes de generación con un modo `pdf` explícito.
- Excluir esas solicitudes de la regla `CacheFirst` del PWA y servirlas por red directa; la caché normal del catálogo visual queda intacta.
- En el proxy, responder `no-store` cuando la solicitud sea para PDF y conservar caché pública para la navegación normal.
- Mantener el proxy restringido al host BIMS permitido.

### 3. Endurecer descarga y decodificación

- Separar etapas: URL de origen → proxy → bytes → validación MIME/firma → decodificación → canvas → JPEG → jsPDF.
- Preferir `createImageBitmap(blob)` para decodificar y redimensionar; usar fallback compatible para navegadores que no lo soporten.
- No revocar URLs temporales antes de terminar el dibujo.
- Aplicar timeout por etapa, reintento con espera breve y concurrencia adaptativa para no saturar el navegador ni el proxy.
- Distinguir tres resultados: foto real, producto sin foto de origen y error técnico. Los productos sin foto no contarán como falla de red.

### 4. No volver a descargar un PDF roto

- Mostrar diagnóstico real durante la preparación: fotos listas, sin foto de origen y fallas técnicas.
- Antes de habilitar “Descargar/Compartir”, ejecutar una compuerta de calidad:
  - permitir el PDF cuando todas las fotos disponibles fueron procesadas;
  - si quedan fallas técnicas, reintentar solo esas fotos;
  - si persisten fallas masivas, bloquear la descarga con una explicación y ofrecer “Reintentar” o “Generar sin fotos”.
- El PDF solo usará placeholder para los 11 productos realmente sin imagen o para fallas individuales que el usuario acepte expresamente.
- Eliminar `catch` silenciosos y registrar códigos de error seguros por etapa, producto y duración, sin exponer datos sensibles.

### 5. Validación con la selección real

- Restaurar el borrador de 136 productos y verificar previamente las 125 URLs de origen.
- Generar el PDF en la app publicada con service worker activo y caché previa cargada, que es el escenario real del problema.
- Probar desktop y móvil, incluyendo recarga, cierre/reapertura y restauración del borrador.
- Inspeccionar el PDF descargado página por página y con herramientas de PDF:
  - 136 productos presentes;
  - 125 fotos reales cuando el origen responda correctamente;
  - 11 placeholders identificados como “Sin foto”; 
  - ninguna imagen gris causada por timeout/caché/decodificación;
  - logo, precios, escalas, textos y paginación sin regresiones.
- Agregar pruebas automatizadas para caché PWA, timeout/reintento, MIME inválido, origen sin foto, restauración del borrador y bloqueo de descarga ante fallas masivas.

## Archivos y backend involucrados

- `src/lib/catalogo-pdf.ts`: pipeline de imagen, diagnóstico y compuerta de calidad.
- `src/lib/image-utils.ts`: URL diferenciada para navegación y generación PDF.
- `vite.config.ts`: exclusión/estrategia de caché para solicitudes PDF.
- `supabase/functions/bims-image-proxy/index.ts`: política de caché y validación de respuesta.
- `src/components/ventas/CatalogoPdfPanel.tsx`: borradores, progreso, reintento y bloqueo seguro.
- `src/pages/Ventas.tsx` y `src/components/ventas/CatalogoGrid.tsx`: restauración y limpieza explícita.
- Migración para borradores de catálogo con grants y RLS por usuario.
