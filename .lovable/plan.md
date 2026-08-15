# Acceso de Claude Code a MoviLog

Claude pide una de dos cosas: el código fuente, o acceso de solo lectura a la base. Mi recomendación: **arrancar por el código fuente** y dejar el acceso a datos para después, con un camino distinto al que él propone.

## Por qué el código primero

- Es el camino de menor riesgo: no expone ni un dato real de clientes, precios ni operaciones.
- Cubre el 90% de lo que Claude dice querer hacer (depurar, proponer mejoras, revisar módulos flojos).
- Ya tenés el documento maestro (`docs/MOVILOG.md`) que explica el modelo de datos, así que puede razonar sobre la operación sin ver filas reales.
- Es reversible en un click: se quita el acceso al repo y listo.

## Paso 1 — Código fuente (hoy)

1. Conectar el proyecto a GitHub desde Lovable (GitHub → Connect).
2. Crear el repo como **privado**.
3. Invitar la cuenta de Claude Code como colaborador con permiso de lectura.
4. Que clone el repo y trabaje ahí. Los cambios que proponga vuelven como Pull Request, los revisás vos antes de mergear.

Antes de compartir hay que verificar dos puntos del repo:

- `.env` está versionado y contiene la URL y la clave pública del backend. Esa clave es publicable (ya viaja al navegador), así que no es una fuga, pero conviene confirmarlo explícitamente antes de compartir.
- Ninguna clave privada (service role, claves de BIMS, `LOVABLE_API_KEY`) vive en el código: están en el almacén de secretos del backend. Se verifica con una búsqueda antes de dar acceso.

## Paso 2 — Datos, solo si hace falta (después)

**No** recomiendo entregar una connection string de Postgres:

- En Lovable Cloud no tenés acceso a la contraseña de la base ni al panel del proveedor, así que no hay forma limpia de emitir esa credencial.
- Una connection string directa saltea todas las políticas de seguridad por sucursal y por rol que acabamos de endurecer. Es acceso total a PII de clientes, precios y rendiciones.

En su lugar, dos alternativas sanas:

- **Opción A (recomendada): usuario de solo lectura dentro de MoviLog.** Se crea una cuenta real con rol de solo consulta y acceso limitado a las sucursales que definas. Claude consulta con esa cuenta usando la API del backend, y todas las reglas de seguridad siguen aplicando. Se revoca desactivando el usuario.
- **Opción B: extracciones puntuales.** Cuando necesite analizar algo (KPIs, calidad de datos, patrones de error), se le pasa un export anonimizado de esa consulta específica. Cero acceso permanente.

## Qué haría yo en concreto

1. Auditar el repo (secretos, `.env`) y confirmarte que está limpio para compartir.
2. Guiarte en la conexión a GitHub y la invitación de solo lectura.
3. Preparar, si querés, un `CLAUDE.md` en la raíz del repo con las convenciones del proyecto (stack, estilo, reglas de negocio clave, qué no tocar) para que Claude no rompa cosas por desconocer el contexto.
4. Recién si el análisis de datos resulta necesario, implementar la Opción A con el rol de solo lectura.

## Nota técnica

El acceso a datos por rol de aplicación (Opción A) respeta las políticas de acceso por fila que protegen `branch_requests` (teléfono y email de clientes enmascarados), tablas financieras y datos de flota. Una conexión directa a Postgres con rol de base no las respeta salvo que se configure explícitamente, y esa configuración no está disponible en este entorno.
