import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Upload, X, FileImage, Loader2 } from "lucide-react";
import { toast } from "sonner";

const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];

interface FileUploadProps {
  bucket: string;
  folder?: string;
  onUpload: (value: string) => void;
  currentUrl?: string | null;
  label?: string;
  accept?: string;
  /** If true, the bucket is private: store the storage path (not the URL) and preview with a signed URL. */
  signed?: boolean;
}

export function FileUpload({
  bucket,
  folder = "",
  onUpload,
  currentUrl,
  label = "Subir archivo",
  accept = "image/*,.pdf",
  signed = false,
}: FileUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(currentUrl || null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_SIZE) {
      toast.error("El archivo excede el límite de 5MB");
      return;
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error("Tipo de archivo no permitido. Usa JPG, PNG, WebP o PDF.");
      return;
    }

    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `${folder ? folder + "/" : ""}${crypto.randomUUID()}.${ext}`;

      const { error } = await supabase.storage
        .from(bucket)
        .upload(path, file, { upsert: false });

      if (error) throw error;

      if (signed) {
        const { data: signedData, error: signErr } = await supabase.storage
          .from(bucket)
          .createSignedUrl(path, 3600);
        if (signErr) throw signErr;
        setPreview(signedData.signedUrl);
        onUpload(path);
      } else {
        const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);
        setPreview(urlData.publicUrl);
        onUpload(urlData.publicUrl);
      }
      toast.success("Archivo subido correctamente");
    } catch (err: any) {
      toast.error(err.message || "Error al subir archivo");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const clearFile = () => {
    setPreview(null);
    onUpload("");
  };

  return (
    <div className="space-y-2">
      {preview ? (
        <div className="relative inline-block">
          {preview.match(/\.(jpg|jpeg|png|webp)$/i) ? (
            <img
              src={preview}
              alt="Preview"
              className="h-24 w-24 object-cover rounded-lg border border-border"
            />
          ) : (
            <div className="h-24 w-24 rounded-lg border border-border flex items-center justify-center bg-muted/30">
              <FileImage className="h-8 w-8 text-muted-foreground" />
            </div>
          )}
          <button
            type="button"
            onClick={clearFile}
            className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-0.5"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="gap-2"
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          {uploading ? "Subiendo..." : label}
        </Button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleFile}
        className="hidden"
      />
    </div>
  );
}
