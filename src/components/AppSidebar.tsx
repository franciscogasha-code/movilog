import {
  Truck,
  Package,
  ShoppingCart,
  ArrowRightLeft,
  MapPin,
  CreditCard,
  Route,
  LayoutDashboard,
  FileText,
  Lock,
  AlertTriangle,
  Search,
  ClipboardList,
  User,
  Tag,
  Bell,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";

const mainItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Alertas", url: "/alertas", icon: Bell },
];

const coreItems = [
  { title: "Consultas", url: "/consultas", icon: Search },
  { title: "Pedidos", url: "/solicitudes", icon: ClipboardList },
  { title: "Stock Comprometido", url: "/stock-comprometido", icon: Lock },
  { title: "Ejecución Física", url: "/cumplimiento", icon: Package },
  { title: "Incidencias", url: "/incidencias", icon: AlertTriangle },
  { title: "Documentos", url: "/documentos", icon: FileText },
];

const driverItems = [
  { title: "Panel Chofer", url: "/chofer", icon: User },
  { title: "Etiquetas", url: "/etiquetas", icon: Tag },
];

const operationItems = [
  { title: "Abastecimiento", url: "/abastecimiento", icon: Package },
  { title: "Reposición", url: "/reposicion", icon: ArrowRightLeft },
  { title: "Pedidos Online", url: "/pedidos", icon: ShoppingCart },
  { title: "Distribución", url: "/distribucion", icon: MapPin },
];

const managementItems = [
  { title: "Cobranzas", url: "/cobranzas", icon: CreditCard },
  { title: "Flota", url: "/flota", icon: Truck },
  { title: "Ruteo", url: "/ruteo", icon: Route },
];

function MenuGroup({
  label,
  items,
  collapsed,
}: {
  label: string;
  items: typeof mainItems;
  collapsed: boolean;
}) {
  const location = useLocation();

  return (
    <SidebarGroup>
      <SidebarGroupLabel className="text-sidebar-foreground/50 uppercase text-[10px] tracking-widest font-semibold">
        {label}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton asChild>
                <NavLink
                  to={item.url}
                  end={item.url === "/"}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
                  activeClassName="bg-sidebar-accent text-sidebar-primary font-semibold"
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {!collapsed && <span>{item.title}</span>}
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  return (
    <Sidebar collapsible="icon" className="border-r-0">
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-sidebar-primary flex items-center justify-center">
            <Truck className="h-4 w-4 text-sidebar-primary-foreground" />
          </div>
          {!collapsed && (
            <div>
              <h2 className="font-display font-bold text-sm text-sidebar-foreground">
                SANSEI
              </h2>
              <p className="text-[10px] text-sidebar-foreground/50 uppercase tracking-wider">
                Logística
              </p>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2">
        <MenuGroup label="Principal" items={mainItems} collapsed={collapsed} />
        <MenuGroup label="Núcleo" items={coreItems} collapsed={collapsed} />
        <MenuGroup label="Chofer / Despacho" items={driverItems} collapsed={collapsed} />
        <MenuGroup label="Operaciones" items={operationItems} collapsed={collapsed} />
        <MenuGroup label="Gestión" items={managementItems} collapsed={collapsed} />
      </SidebarContent>

      <SidebarFooter className="p-4">
        {!collapsed && (
          <p className="text-[10px] text-sidebar-foreground/30 text-center">
            v2.0.0 — Fase 2
          </p>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
