import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerAppServiceWorker } from "@/lib/register-app-sw";

void registerAppServiceWorker();

createRoot(document.getElementById("root")!).render(<App />);
