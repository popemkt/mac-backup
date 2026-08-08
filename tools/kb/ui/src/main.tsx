import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/components/App";
import { initPrefs } from "@/stores/prefs.store";
import "./index.css";

initPrefs();

const el = document.getElementById("root");
if (!el) throw new Error("#root missing");

createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
