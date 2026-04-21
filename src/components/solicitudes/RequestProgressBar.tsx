import { Check, Clock, Package, Truck, MapPin, Archive, Lock, X, PackageCheck, Warehouse, Route, Send } from "lucide-react";
import { cn } from "@/lib/utils";

// Flow-specific step configurations
const CLIENT_DELIVERY_STEPS = [
  { status: "pending", label: "Pendiente", icon: Clock },
  { status: "in_preparation", label: "En preparación", icon: Package },
  { status: "ready_for_delivery", label: "Listo entrega", icon: Send },
  { status: "delivered_to_third_party", label: "Entregado", icon: MapPin },
  { status: "closed", label: "Cerrado", icon: Lock },
];

const URBAN_STEPS = [
  { status: "pending", label: "Pendiente", icon: Clock },
  { status: "in_preparation", label: "En preparación", icon: Package },
  { status: "ready_for_pickup", label: "Listo retiro", icon: PackageCheck },
  { status: "in_transit", label: "En tránsito", icon: Truck },
  { status: "delivered", label: "Entregado", icon: MapPin },
  { status: "received", label: "Recibido", icon: Check },
  { status: "logistic_closed", label: "Cierre log.", icon: Archive },
  { status: "closed", label: "Cerrado", icon: Lock },
];

const INTERURBAN_STEPS = [
  { status: "pending", label: "Pendiente", icon: Clock },
  { status: "in_preparation", label: "En preparación", icon: Package },
  { status: "ready_for_pickup", label: "Listo retiro", icon: PackageCheck },
  { status: "in_consolidation", label: "Consolidación", icon: Warehouse },
  { status: "assigned_to_trip", label: "Asignado", icon: Route },
  { status: "in_transit", label: "En tránsito", icon: Truck },
  { status: "delivered", label: "Entregado", icon: MapPin },
  { status: "received", label: "Recibido", icon: Check },
  { status: "logistic_closed", label: "Cierre log.", icon: Archive },
  { status: "closed", label: "Cerrado", icon: Lock },
];

// Legacy flow (for orders without flow_type)
const LEGACY_STEPS = [
  { status: "pending", label: "Pendiente", icon: Clock },
  { status: "in_preparation", label: "En preparación", icon: Package },
  { status: "in_transit", label: "En tránsito", icon: Truck },
  { status: "delivered", label: "Entregado", icon: MapPin },
  { status: "received", label: "Recibido", icon: Check },
  { status: "logistic_closed", label: "Cierre logístico", icon: Archive },
  { status: "closed", label: "Cerrado", icon: Lock },
];

interface StepEvent {
  status: string;
  date?: string;
  user?: string;
}

interface RequestProgressBarProps {
  currentStatus: string;
  events?: StepEvent[];
  flowType?: string | null;
}

function getStepsForFlow(flowType?: string | null) {
  switch (flowType) {
    case "client_delivery": return CLIENT_DELIVERY_STEPS;
    case "urban": return URBAN_STEPS;
    case "interurban": return INTERURBAN_STEPS;
    default: return LEGACY_STEPS;
  }
}

export function RequestProgressBar({ currentStatus, events = [], flowType }: RequestProgressBarProps) {
  const isRejected = currentStatus === "rejected";

  const steps = getStepsForFlow(flowType);
  const currentIndex = steps.findIndex((s) => s.status === currentStatus);
  const eventMap = new Map(events.map((e) => [e.status, e]));

  if (isRejected) {
    return (
      <div className="flex items-center gap-3 p-4 rounded-xl bg-destructive/5 border border-destructive/20">
        <div className="flex items-center justify-center w-10 h-10 rounded-full bg-destructive/10">
          <X className="h-5 w-5 text-destructive" />
        </div>
        <div>
          <p className="font-semibold text-destructive">Pedido rechazado</p>
          {eventMap.get("rejected") && (
            <p className="text-xs text-muted-foreground">
              {eventMap.get("rejected")?.date}
            </p>
          )}
        </div>
      </div>
    );
  }

  // Mobile: scroll horizontal interno; desktop: ancho completo
  const minWidth = `${steps.length * 64}px`;
  return (
    <div className="w-full overflow-x-auto -mx-1 px-1 pb-1">
      <div className="flex items-center justify-between relative" style={{ minWidth }}>
        {/* Connecting line */}
        <div className="absolute top-5 left-5 right-5 h-0.5 bg-border z-0" />
        <div
          className="absolute top-5 left-5 h-0.5 bg-primary z-0 transition-all duration-500"
          style={{
            width: currentIndex >= 0 ? `${(currentIndex / (steps.length - 1)) * 100}%` : "0%",
            maxWidth: "calc(100% - 40px)",
          }}
        />

        {steps.map((step, idx) => {
          const isCompleted = idx < currentIndex;
          const isCurrent = idx === currentIndex;
          const isFuture = idx > currentIndex;
          const event = eventMap.get(step.status);
          const Icon = step.icon;

          return (
            <div key={step.status} className="flex flex-col items-center z-10 relative" style={{ flex: 1 }}>
              <div
                className={cn(
                  "flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all",
                  isCompleted && "bg-primary border-primary text-primary-foreground",
                  isCurrent && "bg-primary/10 border-primary text-primary ring-4 ring-primary/20",
                  isFuture && "bg-background border-muted-foreground/30 text-muted-foreground/50"
                )}
              >
                {isCompleted ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Icon className="h-4 w-4" />
                )}
              </div>
              <span
                className={cn(
                  "text-[10px] mt-1.5 text-center leading-tight font-medium max-w-[70px]",
                  isCompleted && "text-primary",
                  isCurrent && "text-primary font-semibold",
                  isFuture && "text-muted-foreground/50"
                )}
              >
                {step.label}
              </span>
              {event?.date && (
                <span className="text-[9px] text-muted-foreground mt-0.5 text-center max-w-[80px] truncate">
                  {event.date}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
