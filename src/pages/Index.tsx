import { useState } from "react";
import { motion } from "framer-motion";
import {
  Truck,
  Package,
  ShoppingCart,
  ArrowRightLeft,
  TrendingUp,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Database,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const kpis = [
  {
    title: "Viajes del día",
    value: "12",
    change: "+3 vs ayer",
    icon: Truck,
    color: "text-primary",
    bg: "bg-primary/10",
  },
  {
    title: "Pedidos pendientes",
    value: "28",
    change: "5 urgentes",
    icon: ShoppingCart,
    color: "text-secondary",
    bg: "bg-secondary/10",
  },
  {
    title: "Reposiciones hoy",
    value: "6",
    change: "3 completadas",
    icon: ArrowRightLeft,
    color: "text-accent",
    bg: "bg-accent/10",
  },
  {
    title: "Entregas completadas",
    value: "89%",
    change: "+2% esta semana",
    icon: TrendingUp,
    color: "text-success",
    bg: "bg-accent/10",
  },
];

const recentActivity = [
  { time: "08:45", text: "Camión SAL-201 salió a ruta CDE-Encarnación", status: "active" },
  { time: "08:30", text: "Reposición #R-0042 completada — Suc. Fernando de la Mora", status: "done" },
  { time: "08:15", text: "Pedido online #P-1205 — Esperando preparación", status: "pending" },
  { time: "07:50", text: "Mantenimiento preventivo — Camión SAL-105", status: "warning" },
  { time: "07:30", text: "Chofer Juan Benítez inició turno", status: "active" },
];

const statusIcon = {
  active: <Clock className="h-3.5 w-3.5 text-primary" />,
  done: <CheckCircle2 className="h-3.5 w-3.5 text-accent" />,
  pending: <Package className="h-3.5 w-3.5 text-secondary" />,
  warning: <AlertTriangle className="h-3.5 w-3.5 text-destructive" />,
};

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35 } },
};

export default function Index() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">
          Centro de Control Logístico
        </h1>
        <p className="text-muted-foreground mt-1">
          Resumen operativo del día — {new Date().toLocaleDateString("es-PY", { weekday: "long", day: "numeric", month: "long" })}
        </p>
      </div>

      {/* KPI Cards */}
      <motion.div
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
        variants={container}
        initial="hidden"
        animate="show"
      >
        {kpis.map((kpi) => (
          <motion.div key={kpi.title} variants={item}>
            <Card className="glass-card hover:shadow-xl transition-shadow duration-300">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      {kpi.title}
                    </p>
                    <p className="text-3xl font-display font-bold mt-2 text-foreground">
                      {kpi.value}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">{kpi.change}</p>
                  </div>
                  <div className={`${kpi.bg} p-2.5 rounded-xl`}>
                    <kpi.icon className={`h-5 w-5 ${kpi.color}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </motion.div>

      {/* Bottom Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Activity Feed */}
        <motion.div
          className="lg:col-span-2"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <Card className="glass-card">
            <CardHeader className="pb-3">
              <CardTitle className="font-display text-lg">Actividad reciente</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                {recentActivity.map((a, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    {statusIcon[a.status as keyof typeof statusIcon]}
                    <span className="text-xs font-mono text-muted-foreground w-10 shrink-0">
                      {a.time}
                    </span>
                    <span className="text-sm text-foreground">{a.text}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Quick Stats */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <Card className="glass-card">
            <CardHeader className="pb-3">
              <CardTitle className="font-display text-lg">Estado de flota</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                { label: "En ruta", count: 8, total: 15, color: "bg-primary" },
                { label: "En sucursal", count: 5, total: 15, color: "bg-accent" },
                { label: "En mantenimiento", count: 2, total: 15, color: "bg-secondary" },
              ].map((s) => (
                <div key={s.label} className="space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{s.label}</span>
                    <span className="font-semibold text-foreground">{s.count}/{s.total}</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-muted">
                    <div
                      className={`h-2 rounded-full ${s.color} transition-all duration-500`}
                      style={{ width: `${(s.count / s.total) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
