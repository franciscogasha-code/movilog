// Status labels and colors for the UI
export const REQUEST_STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "Pendiente", variant: "secondary" },
  accepted: { label: "Aceptada", variant: "default" },
  partially_accepted: { label: "Parcialmente aceptada", variant: "outline" },
  rejected: { label: "Rechazada", variant: "destructive" },
  picking: { label: "En picking", variant: "default" },
  dispatched: { label: "Despachada", variant: "default" },
  in_transit: { label: "En tránsito", variant: "default" },
  delivered: { label: "Entregada", variant: "default" },
  received: { label: "Recibida", variant: "default" },
  logistic_closed: { label: "Cierre logístico", variant: "outline" },
  closed: { label: "Cerrada", variant: "outline" },
};

export const FULFILLMENT_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending: { label: "Pendiente", color: "bg-muted text-muted-foreground" },
  picking: { label: "En picking", color: "bg-info/10 text-info" },
  waiting_for_cut: { label: "Esperando corte", color: "bg-warning/10 text-warning" },
  waiting_for_courier: { label: "Esperando transporte", color: "bg-warning/10 text-warning" },
  dispatched: { label: "Despachado", color: "bg-primary/10 text-primary" },
  in_transit: { label: "En tránsito", color: "bg-primary/10 text-primary" },
  delivered: { label: "Entregado", color: "bg-accent/10 text-accent" },
  received: { label: "Recibido", color: "bg-accent/10 text-accent" },
  partial: { label: "Parcial", color: "bg-secondary/10 text-secondary" },
  completed: { label: "Completado", color: "bg-accent/10 text-accent" },
  cancelled: { label: "Cancelado", color: "bg-destructive/10 text-destructive" },
};

export const DOCUMENT_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  issued: { label: "Emitido", color: "bg-muted text-muted-foreground" },
  with_driver: { label: "Con chofer", color: "bg-info/10 text-info" },
  delivered_to_client: { label: "Entregado al cliente", color: "bg-primary/10 text-primary" },
  signed_by_client: { label: "Firmado por cliente", color: "bg-accent/10 text-accent" },
  with_admin: { label: "En administración", color: "bg-info/10 text-info" },
  sent_to_collector: { label: "Enviado a cobrador", color: "bg-primary/10 text-primary" },
  received_by_collector: { label: "Recibido por cobrador", color: "bg-primary/10 text-primary" },
  presented_to_client: { label: "Presentado al cliente", color: "bg-warning/10 text-warning" },
  collection_scheduled: { label: "Cobranza programada", color: "bg-warning/10 text-warning" },
  collection_completed: { label: "Cobranza realizada", color: "bg-accent/10 text-accent" },
  archived: { label: "Archivado", color: "bg-muted text-muted-foreground" },
};

export const INCIDENT_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  open: { label: "Abierto", color: "bg-destructive/10 text-destructive" },
  under_review: { label: "En revisión", color: "bg-warning/10 text-warning" },
  resolved: { label: "Resuelto", color: "bg-accent/10 text-accent" },
  escalated: { label: "Escalado", color: "bg-destructive/10 text-destructive" },
  closed: { label: "Cerrado", color: "bg-muted text-muted-foreground" },
};

export const REJECTION_REASONS: Record<string, string> = {
  no_stock_real: "Sin stock real",
  stock_difference: "Diferencia de stock",
  product_not_found: "Producto no encontrado",
  stock_reserved: "Stock reservado",
  not_convenient_rotation: "Rotación no conveniente",
  other: "Otro motivo",
};

export const ITEM_PURPOSE_LABELS: Record<string, string> = {
  client: "Cliente",
  reposition: "Reposición",
};

export const SHIPPING_METHOD_LABELS: Record<string, string> = {
  own_fleet: "Flota propia",
  courier: "Encomienda",
  cut: "Corte",
  pickup: "Retiro en sucursal",
  direct_client: "Envío directo al cliente",
};

export const REQUEST_TYPE_LABELS: Record<string, string> = {
  reposition: "Reposición",
  client: "Pedido Cliente",
  mixed: "Mixto",
  online: "Pedido Online",
  redistribution: "Redistribución",
};

export const STOCK_DISPOSITION_LABELS: Record<string, string> = {
  ajuste_inventario: "Ajuste de inventario",
  reclamo_proveedor: "Reclamo a proveedor",
  descuento_colaborador: "Descuento a colaborador",
  imputacion_salon: "Imputación al salón",
  imputacion_sucursal: "Imputación a sucursal",
  perdida_empresa: "Pérdida absorbida",
  venta_feria: "Venta feria",
  reconteo_pendiente: "Reconteo pendiente",
  other: "Otro",
};

export const DAMAGE_ORIGIN_LABELS: Record<string, string> = {
  transfer_reception: "Recepción de transferencia",
  collaborator: "Colaborador",
  customer: "Cliente",
  sealed_package: "Paquete sellado (CJ/PQ)",
  product_defect: "Defecto de producto",
};

export const TRIP_TYPE_LABELS: Record<string, string> = {
  urban_cutoff: "Corte urbano",
  interurban_planned: "Interurbano planificado",
};

export const CONSULTATION_STATUS_LABELS: Record<string, string> = {
  open: "Abierta",
  responded: "Respondida",
  converted: "Convertida a pedido",
  expired: "Expirada",
};
