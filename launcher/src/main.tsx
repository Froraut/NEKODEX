import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./tokens.css";
import "./styles.css";
import "./nekodex.css";
import "./overview.css";
import "./browser-actions.css";
import "./settings-polish.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
