import React from "react";
import ReactDOM from "react-dom/client";
// Stylesheet order: design tokens, the app base (document frame and element resets), then the
// design-system components; App's imports add the shell and surface layout sheets after them.
import "./tokens.css";
import "./styles.css";
import "./design/components.css";
import { App } from "./App";
import "./theme-boot";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
