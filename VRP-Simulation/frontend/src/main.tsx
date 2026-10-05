import React from "react";
import ReactDOM from "react-dom/client";
import App from "./ScenarioApp";
import "./styles.css";
import "./carbon/tokens.css";
import "./carbon/components.css";
import "./carbon-theme.css";
import "./studio-theme.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
