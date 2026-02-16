import React from "react";
import ReactDOM from "react-dom/client";
import { AgentuityProvider } from "@agentuity/react";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AgentuityProvider>
      <App />
    </AgentuityProvider>
  </React.StrictMode>
);
