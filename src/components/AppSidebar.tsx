import {
  Truck, Package, ShoppingCart, ArrowRightLeft, MapPin, CreditCard,
  Route, LayoutDashboard, FileText, Lock, AlertTriangle, Search,
  ClipboardList, User, Tag, Bell, PackageCheck, Receipt, Users, Database,
  LogOut,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarHeader, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

type MenuItem = { title: string; url: string; icon: any; moduleKey: string };

const mainItems: MenuItem[] = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard, moduleKey: "dashboard" },
  { title: "Alertas", url: "/alertas", icon: Bell, moduleKey: "alertas" },
  { title: "Usuarios", url: "/usuarios", icon: Users, moduleKey: "usuarios" },
  { title: "Sincronización BIMS", url: "/sincronizacion", icon: Database, moduleKey: "sincronizacion" },
];

const coreItems: MenuItem[] = [
  { title: "Consultas", url: "/consultas", icon: Search, moduleKey: "consultas" },
  { title: "Pedidos", url: "/solicitudes", icon: ClipboardList, moduleKey: "solicitudes" },
  { title: "Stock Comprometido", url: "/stock-comprometido", icon: Lock, moduleKey: "stock-comprometido" },
  { title: "Ejecución Física", url: "/cumplimiento", icon: Package, moduleKey: "cumplimiento" },
  { title: "Recepción", url: "/recepcion", icon: PackageCheck, moduleKey: "recepcion" },
  { title: "Incidencias", url: "/incidencias", icon: AlertTriangle, moduleKey: "incidencias" },
  { title: "Documentos", url: "/documentos", icon: FileText, moduleKey: "documentos" },
];

const driverItems: MenuItem[] = [
  { title: "Panel Chofer", url: "/chofer", icon: User, moduleKey: "chofer" },
  { title: "Etiquetas", url: "/etiquetas", icon: Tag, moduleKey: "etiquetas" },
  { title: "Rendición", url: "/rendicion", icon: Receipt, moduleKey: "rendicion" },
];

const operationItems: MenuItem[] = [
  { title: "Abastecimiento", url: "/abastecimiento", icon: Package, moduleKey: "abastecimiento" },
  { title: "Reposición", url: "/reposicion", icon: ArrowRightLeft, moduleKey: "reposicion" },
  { title: "Pedidos Online", url: "/pedidos", icon: ShoppingCart, moduleKey: "pedidos" },
  { title: "Distribución", url: "/distribucion", icon: MapPin, moduleKey: "distribucion" },
];

const managementItems: MenuItem[] = [
  { title: "Cobranzas", url: "/cobranzas", icon: CreditCard, moduleKey: "cobranzas" },
  { title: "Flota", url: "/flota", icon: Truck, moduleKey: "flota" },
  { title: "Ruteo", url: "/ruteo", icon: Route, moduleKey: "ruteo" },
];

function MenuGroup({ label, items, collapsed }: { label: string; items: MenuItem[]; collapsed: boolean }) {
  const { hasModule } = useAuth();

  const visibleItems = items.filter((item) => hasModule(item.moduleKey));
  if (visibleItems.length === 0) return null;

  return (
    <SidebarGroup>
      <SidebarGroupLabel className="text-sidebar-foreground/50 uppercase text-[10px] tracking-widest font-semibold">{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {visibleItems.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton asChild>
                <NavLink to={item.url} end={item.url === "/"} className="flex items-center gap-3 px-3 py-2 rounded-lg text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors" activeClassName="bg-sidebar-accent text-sidebar-primary font-semibold">
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
  const { profile, signOut } = useAuth();

  return (
    <Sidebar collapsible="icon" className="border-r-0">
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-sidebar-primary flex items-center justify-center">
            <Truck className="h-4 w-4 text-sidebar-primary-foreground" />
          </div>
          {!collapsed && (
            <div>
              <h2 className="font-display font-bold text-sm text-sidebar-foreground">MoviLog</h2>
              <p className="text-[10px] text-sidebar-foreground/50 uppercase tracking-wider">Logística</p>
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
      <SidebarFooter className="p-4 space-y-2">
        {!collapsed && profile && (
          <p className="text-[11px] text-sidebar-foreground/60 truncate">
            {profile.full_name}
          </p>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-sidebar-foreground/50 hover:text-sidebar-foreground"
          onClick={signOut}
        >
          <LogOut className="h-4 w-4" />
          {!collapsed && <span className="text-xs">Cerrar sesión</span>}
        </Button>
        {!collapsed && <p className="text-[10px] text-sidebar-foreground/30 text-center">v5.1.0 — Operacional</p>}
      </SidebarFooter>
    </Sidebar>
  );
}
