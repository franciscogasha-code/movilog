import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerSW } from "virtual:pwa-register";

// Service worker: permite abrir la app y ver el catálogo cacheado sin señal
if (import.meta.env.PROD) {
  registerSW({ immediate: true });
}

createRoot(document.getElementById("root")!).render(<App />);
