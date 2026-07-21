import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SignedImg } from "./SignedImg";

export function VehiclePhotoGallery({ vehicleId }: { vehicleId: string }) {
  const { data: usages } = useQuery({
    queryKey: ["gallery-usages", vehicleId],
    queryFn: async () => {
      const { data } = await supabase
        .from("vehicle_usages")
        .select("id, started_at, start_odometer_photo_path, end_odometer_photo_path")
        .eq("vehicle_id", vehicleId)
        .order("started_at", { ascending: false })
        .limit(50);
      return data ?? [];
    },
  });

  const { data: fuels } = useQuery({
    queryKey: ["gallery-fuel", vehicleId],
    queryFn: async () => {
      const { data } = await supabase
        .from("fuel_records")
        .select("id, date, receipt_photo_url")
        .eq("vehicle_id", vehicleId)
        .not("receipt_photo_url", "is", null)
        .order("date", { ascending: false })
        .limit(50);
      return data ?? [];
    },
  });

  const items: { key: string; date: string; path: string; label: string }[] = [];
  usages?.forEach((u: any) => {
    if (u.start_odometer_photo_path)
      items.push({ key: `u-s-${u.id}`, date: u.started_at, path: u.start_odometer_photo_path, label: "Od. inicial" });
    if (u.end_odometer_photo_path)
      items.push({ key: `u-e-${u.id}`, date: u.started_at, path: u.end_odometer_photo_path, label: "Od. final" });
  });
  fuels?.forEach((f: any) => {
    items.push({ key: `f-${f.id}`, date: f.date, path: f.receipt_photo_url, label: "Combustible" });
  });
  items.sort((a, b) => (a.date < b.date ? 1 : -1));

  if (!items.length) return <p className="text-sm text-muted-foreground p-3 text-center">Sin fotos registradas</p>;

  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
      {items.map((it) => (
        <div key={it.key} className="space-y-1">
          <SignedImg path={it.path} className="h-24 w-full object-cover rounded-md border border-border/40" />
          <div className="text-[10px] text-muted-foreground text-center">
            <p>{it.label}</p>
            <p>{new Date(it.date).toLocaleDateString("es-PY")}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
