import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { execSync } from "child_process";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

function formatAsuncion(date: Date): string {
  try {
    const parts = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'America/Asuncion',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
  } catch {
    return date.toISOString().slice(0, 16).replace('T', ' ');
  }
}

function buildVersion(): string {
  const stamp = formatAsuncion(new Date());
  let hash = "";
  try {
    hash = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    hash = "";
  }
  return hash ? `${stamp} · ${hash}` : stamp;
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(buildVersion()),
  },

  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: null,
      manifest: false,
      includeAssets: ["favicon.ico", "icon-192.png", "icon-512.png"],
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/functions\//],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "movilog-pages",
              networkTimeoutSeconds: 5,
            },
          },
          {
            // Fotos de producto (proxy BIMS y storage)
            urlPattern: ({ url }) =>
              (url.pathname.includes("/bims-image-proxy") &&
                url.searchParams.get("mode") !== "pdf") ||
              url.pathname.includes("/storage/v1/object"),
            handler: "CacheFirst",
            options: {
              cacheName: "movilog-product-images-v3",
              expiration: { maxEntries: 2000, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
              fetchOptions: { mode: "cors", credentials: "omit" },
            },

          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
