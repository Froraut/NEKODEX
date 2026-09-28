import React from "react";
import ReactDOM from "react-dom/client";
// Stylesheet order: design tokens, then the design-system components, then the legacy stylesheets
// (App's own stylesheet imports keep their place ahead of styles.css).
import "./tokens.css";
import "./design/components.css";
import { App } from "./App";
import "./styles.css";
import "./nekodex.css";
import "./overview.css";
import "./browser-actions.css";
import "./settings-polish.css";
import "./theme-boot";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
