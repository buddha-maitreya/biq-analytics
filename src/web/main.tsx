import React from "react";
import ReactDOM from "react-dom/client";
import { AgentuityProvider } from "@agentuity/react";
import { AuthProvider } from "@agentuity/auth/react";
import { authClient } from "./lib/auth";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AgentuityProvider>
      <AuthProvider authClient={authClient} refreshInterval={300_000}>
        <App />
      </AuthProvider>
    </AgentuityProvider>
  </React.StrictMode>
);
