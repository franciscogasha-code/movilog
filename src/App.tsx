import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
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
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Index />} />
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
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
