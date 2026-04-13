

# Plan: Descarga de Excel vinculado en reposición administrativa

## Resumen

Persistir el archivo Excel original al crear una reposición administrativa, almacenarlo en un bucket privado, guardar el path en `branch_requests.attached_file_path`, y mostrar un botón "Descargar Excel" en el detalle de la solicitud para usuarios autorizados (sucursal origen + roles globales).

---

## 1. Migración SQL

### a) Bucket privado

```sql
INSERT INTO storage.buckets (id, name, public) VALUES ('request-attachments', 'request-attachments', false);
```

### b) Columna `attached_file_path`

```sql
ALTER TABLE public.branch_requests ADD COLUMN attached_file_path text DEFAULT NULL;
```

### c) Políticas de storage en `storage.objects`

- **INSERT**: usuarios autenticados pueden subir a `request-attachments`
- **SELECT**: usuarios autenticados que tengan acceso a la sucursal origen de la solicitud referenciada en el path, o roles admin/owner. Se implementa extrayendo el `request_id` del path (`branch_requests/{id}/...`) y validando con `can_access_branch` sobre `source_branch_id`.

---

## 2. `ExcelImport.tsx`

Agregar prop opcional:

```ts
onFileSelected?: (file: File | null) => void;
```

Invocar `onFileSelected(file)` cuando se selecciona un archivo válido y parsea correctamente. Invocar `onFileSelected(null)` cuando se limpia.

---

## 3. `AdminReposicionForm.tsx`

- Agregar estado `const [excelFile, setExcelFile] = useState<File | null>(null)`
- Pasar `onFileSelected={setExcelFile}` al `ExcelImport`
- En `handleSubmit`, después de crear la solicitud exitosamente:
  1. Si `excelFile` existe, subir a `request-attachments` con path `branch_requests/{request.id}/{excelFile.name}`
  2. Actualizar `branch_requests.attached_file_path` con ese path
  3. Si falla la subida, mostrar warning pero no bloquear (la solicitud ya se creó)

---

## 4. `SolicitudDetail.tsx`

- Verificar si `r.attached_file_path` tiene valor
- Verificar si el usuario es `isOrigin` o `isAdmin`
- Si ambas condiciones se cumplen, mostrar botón "Descargar Excel" con ícono `FileSpreadsheet`
- Al hacer clic: usar `supabase.storage.from('request-attachments').download(r.attached_file_path)` para descargar el archivo
- Extraer nombre del archivo del path para nombrar el archivo descargado
- Manejar errores con toast

---

## Archivos afectados

| Archivo | Cambio |
|---|---|
| Migración SQL | Bucket + columna + políticas storage |
| `ExcelImport.tsx` | Agregar prop `onFileSelected` |
| `AdminReposicionForm.tsx` | Capturar File, subir post-creación, guardar path |
| `SolicitudDetail.tsx` | Botón condicional "Descargar Excel" |

## Lo que NO se toca

- Flujo de creación, aprobación, preparación, transporte, recepción
- Validaciones existentes
- Otros módulos
- No se guardan URLs en DB, solo paths estables

