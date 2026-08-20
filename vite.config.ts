import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { execSync } from "child_process";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

/** Fallback: fecha del build (solo YYYY-MM-DD) en hora de Asunción. */
function formatAsuncion(date: Date): string {
  try {
    const parts = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'America/Asuncion',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function git(command: string): string {
  try {
    return execSync(command, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

/** Sello determinístico: fecha del commit + hash corto. Mismo commit = mismo sello. */
function buildVersion(): string {
  const commitDate = git("git show -s --date=short --format=%cd HEAD");
  const hash = git("git rev-parse --short HEAD");
  const stamp = commitDate || formatAsuncion(new Date());
  return hash ? `${stamp} · ${hash}` : stamp;
}

const APP_VERSION = buildVersion();

/** Emite /version.json para el chequeo de versión publicada (independiente del service worker). */
function versionManifestPlugin() {
  return {
    name: "movilog-version-manifest",
    apply: "build" as const,
    generateBundle(this: { emitFile: (file: { type: "asset"; fileName: string; source: string }) => void }) {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ version: APP_VERSION }),
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
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
    versionManifestPlugin(),
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
