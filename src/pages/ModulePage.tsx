import { motion } from "framer-motion";
import { Construction } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface ModulePageProps {
  title: string;
  description: string;
  phase: string;
}

export default function ModulePage({ title, description, phase }: ModulePageProps) {
  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">{title}</h1>
        <p className="text-muted-foreground mt-1">{description}</p>
      </div>

      <Card className="glass-card">
        <CardContent className="flex flex-col items-center justify-center py-20 text-center">
          <div className="bg-muted p-4 rounded-2xl mb-4">
            <Construction className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="font-display text-lg font-semibold text-foreground">
            Módulo en desarrollo
          </h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-md">
            Este módulo está planificado para la <strong>{phase}</strong>. Próximamente podrás gestionar todas las operaciones desde aquí.
          </p>
        </CardContent>
      </Card>
    </motion.div>
  );
}
