# [ENTREGADO] Paso 1 — Preparar el repo para Claude Code local

Claude Code corre en tu máquina, así que no hay que invitar a nadie: alcanza con tener el repo privado en GitHub y clonarlo localmente. Lo que falta es dejar el repo listo para que Claude trabaje bien y sin riesgo.

## Resultado de la auditoría de secretos (ya hecha)

- **No hay ninguna credencial privada en el código.** Todas las apariciones de `SUPABASE_SERVICE_ROLE_KEY` son lecturas de variables de entorno dentro de las funciones de servidor; el valor real vive en el almacén de secretos del backend y nunca se versiona. Lo mismo con `LOVABLE_API_KEY` y las credenciales de BIMS.
- **`.env` está versionado** y contiene solo la URL del backend, el ID del proyecto y la clave *publicable*. Esa clave ya viaja al navegador de cualquier usuario, así que no es una fuga; la protección real son las políticas de acceso por fila, que ya endurecimos.
- **`.gitignore` no cubre `.env`** hoy. Se deja como está a propósito: si lo ignoráramos, la app dejaría de arrancar al clonar. Se documenta en el `CLAUDE.md` que ese archivo es público por diseño y que ninguna clave privada debe agregarse ahí nunca.

Conclusión: el repo es seguro para clonar y trabajar localmente.

## Lo que se va a crear: `CLAUDE.md` en la raíz

Un archivo que Claude Code lee automáticamente al abrir el proyecto, para que entienda el contexto sin tener que descubrirlo a golpes. Contenido:

**1. Qué es MoviLog** — WMS/TMS de SANSEI que reemplaza WhatsApp y Vector; resumen de los dominios y puntero a `docs/MOVILOG.md` como fuente de verdad detallada.

**2. Stack y comandos** — React 18 + Vite + TypeScript + Tailwind + shadcn; backend Supabase gestionado por Lovable. Comandos: `npm i`, `npm run dev` (puerto 8080), `npx vitest run`.

**3. Reglas duras (qué NO tocar)**
- `src/integrations/supabase/client.ts` y `types.ts` son autogenerados.
- `.env` y `supabase/config.toml` son gestionados por la plataforma.
- Las migraciones existentes en `supabase/migrations/` no se editan; los cambios de base van en migraciones nuevas.
- Nada de claves privadas en el repo; los secretos se cargan en el backend.

**4. Convenciones del proyecto**
- Idioma: castellano paraguayo operativo en toda la interfaz.
- Números y guaraníes con `toLocaleString("de-DE")`.
- Colores solo por tokens semánticos del sistema de diseño; nada de `text-white` ni hex sueltos.
- Deep-linking de detalle con `?detail=UUID`.
- Toda tabla nueva: `GRANT` + RLS estricta, nunca `USING (true)`.

**5. Reglas de negocio que no son obvias en el código**
- BIMS es el ERP y la única fuente de verdad de stock y catálogo; MoviLog lo lee, nunca lo escribe.
- Las pre-ventas (`is_pre_sale = true`) no aparecen en módulos operativos.
- Los teléfonos y correos de clientes están enmascarados y se leen solo por función autorizada.
- Los roles viven en `user_roles`, jamás en el perfil.
- El filtrado por sucursal se aplica con `useUserBranchFilter` en el frontend y con RLS en la base.

**6. Cómo trabajar en este repo**
- Lovable también escribe en `main`. Antes de empezar: `git pull`. Trabajar en rama aparte y abrir Pull Request; no pushear directo a `main` para evitar conflictos con los cambios hechos desde Lovable.
- Correr los tests antes de proponer cambios.

**7. Mapa rápido de archivos** — dónde está cada módulo (ventas, flota, pedidos, chofer, logística, ejecutivo), los hooks compartidos y las funciones de servidor.

## Pasos que hacés vos

1. En Lovable: menú **+** → **GitHub** → conectar y crear el repo como **privado**.
2. En tu PC: `git clone <url-del-repo>` y `npm i`.
3. Abrir esa carpeta con Claude Code. Va a leer `CLAUDE.md` solo.
4. `.env` viene en el clone, así que `npm run dev` arranca sin configuración extra.

## Para después

El acceso a datos queda pendiente con la Opción A: una cuenta de MoviLog de solo lectura, con sucursales acotadas, que respeta todas las políticas de seguridad. Se implementa cuando lo pidas.
