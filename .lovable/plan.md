

## Plan: Limpiar datos de prueba de Consultas y Pedidos

### Datos encontrados

| Tabla | Registros |
|-------|-----------|
| availability_consultations | 3 |
| consultation_products | 5 |
| consultation_messages | 2 |
| consultation_requests | 0 |
| branch_requests | 8 |
| branch_request_items | 6 |
| fulfillment_orders | 0 |
| fulfillment_items | 0 |
| operational_events | 0 |

### Accion

Crear una migración SQL que elimine todos los registros de estas tablas en el orden correcto (tablas hijas primero para respetar foreign keys):

1. `DELETE FROM consultation_messages`
2. `DELETE FROM consultation_products`
3. `DELETE FROM consultation_requests`
4. `DELETE FROM availability_consultations`
5. `DELETE FROM branch_request_items`
6. `DELETE FROM branch_requests`

No se tocan tablas de usuarios, productos, sucursales ni configuración.

### Archivo modificado
- Nueva migración SQL (via herramienta de migración)

