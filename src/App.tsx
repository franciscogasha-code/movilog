import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/AppLayout";
import Login from "./pages/Login";
import CambiarContrasena from "./pages/CambiarContrasena";
import Index from "./pages/Index";
import Abastecimiento from "./pages/Abastecimiento";
import Reposicion from "./pages/Reposicion";
import Pedidos from "./pages/Pedidos";
import Distribucion from "./pages/Distribucion";
import Cobranzas from "./pages/Cobranzas";
import Flota from "./pages/Flota";
import Ruteo from "./pages/Ruteo";
import Solicitudes from "./pages/Solicitudes";
import Consultas from "./pages/Consultas";
import StockComprometido from "./pages/StockComprometido";
import Cumplimiento from "./pages/Cumplimiento";
import Incidencias from "./pages/Incidencias";
import Documentos from "./pages/Documentos";
import Chofer from "./pages/Chofer";
import Etiquetas from "./pages/Etiquetas";
import Alertas from "./pages/Alertas";
import Recepcion from "./pages/Recepcion";
import Rendicion from "./pages/Rendicion";
import Usuarios from "./pages/Usuarios";
import SincronizacionBims from "./pages/SincronizacionBims";
import DashboardEjecutivo from "./pages/DashboardEjecutivo";
import NotFound from "./pages/NotFound";
import { Loader2 } from "lucide-react";

const queryClient = new QueryClient();

function ProtectedRoutes() {
  const { user, loading, mustChangePassword } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (mustChangePassword) {
    return <Navigate to="/cambiar-contrasena" replace />;
  }

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Index />} />
        <Route path="/ejecutivo" element={<DashboardEjecutivo />} />
        <Route path="/consultas" element={<Consultas />} />
        <Route path="/solicitudes" element={<Solicitudes />} />
        <Route path="/stock-comprometido" element={<StockComprometido />} />
        <Route path="/cumplimiento" element={<Cumplimiento />} />
        <Route path="/incidencias" element={<Incidencias />} />
        <Route path="/documentos" element={<Documentos />} />
        <Route path="/abastecimiento" element={<Abastecimiento />} />
        <Route path="/reposicion" element={<Reposicion />} />
        <Route path="/pedidos" element={<Pedidos />} />
        <Route path="/distribucion" element={<Distribucion />} />
        <Route path="/cobranzas" element={<Cobranzas />} />
        <Route path="/flota" element={<Flota />} />
        <Route path="/ruteo" element={<Ruteo />} />
        <Route path="/chofer" element={<Chofer />} />
        <Route path="/etiquetas" element={<Etiquetas />} />
        <Route path="/alertas" element={<Alertas />} />
        <Route path="/recepcion" element={<Recepcion />} />
        <Route path="/rendicion" element={<Rendicion />} />
        <Route path="/usuarios" element={<Usuarios />} />
        <Route path="/sincronizacion" element={<SincronizacionBims />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function LoginRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (user) {
    return <Navigate to="/" replace />;
}

function ChangePasswordRoute() {
  const { user, loading, mustChangePassword } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!mustChangePassword) {
    return <Navigate to="/" replace />;
  }

  return <CambiarContrasena />;
}

  return <Login />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginRoute />} />
            <Route path="/cambiar-contrasena" element={<ChangePasswordRoute />} />
            <Route path="/*" element={<ProtectedRoutes />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
