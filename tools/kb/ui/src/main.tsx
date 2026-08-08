import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/components/App";
import { initScrollbarManager } from "@/lib/scrollbar-manager";
import { initPrefs } from "@/stores/prefs.store";
import "./index.css";

initPrefs();
initScrollbarManager();

const el = document.getElementById("root");
if (!el) throw new Error("#root missing");

createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
