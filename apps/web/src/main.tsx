import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { applyPersistedAppScale } from "@hyros-ai/ui";
import { App } from "./App.js";
import "./globals.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root element not found");

// Apply the persisted UI scale before first paint (inline bootstrap scripts
// are blocked by the desktop CSP, so it runs here instead of index.html).
applyPersistedAppScale();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);