# Plan: Mejorar búsqueda de cliente en ventas

## Objetivo
Extender el buscador de clientes del catálogo de ventas para que permita buscar por **RUC** y por **cualquier palabra contenida en el nombre** (nombre, razón social, apellido), no solo por coincidencia al inicio del nombre.

## Cambios

1. Frontend: `src/components/ventas/ClientePicker.tsx`
   - Reemplazar el filtro actual `ilike("name", %search%)` por una condición OR que también busque en `ruc`.
   - Usar un término normalizado (trim, sin tildes opcional) para mejorar coincidencias.
   - Agregar un pequeño debounce (300 ms) para no disparar una query por cada tecla.
   - Mantener el límite de 50 resultados y el orden por nombre.
   - Mostrar resultados coincidentes con el mismo render actual: nombre, RUC y teléfono.

2. UX: Mensaje de ayuda
   - Actualizar el placeholder del input a "Buscar por nombre, razón social o RUC..." para que el vendedor sepa qué campos funcionan.

3. Validación rápida
   - Verificar en el preview que buscar por RUC devuelva el cliente correcto.
   - Verificar que buscar por un apellido/palabra intermedia del nombre también devuelva resultados.

## Criterios de aceptación
- El buscador muestra resultados cuando se escribe un RUC completo o parcial.
- El buscador muestra resultados cuando se escribe una palabra que aparece en cualquier parte del nombre.
- No se rompe el modo manual de carga de cliente.
- No se generan queries excesivas al servidor por cada tecla presionada.

## Alcance
Solo cambio en el frontend del picker. No se requiere modificar el backend, tabla ni Edge Functions, ya que `sales_customers` ya tiene las columnas `name` y `ruc`.
