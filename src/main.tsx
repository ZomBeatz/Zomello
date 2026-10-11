import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { RemoteGate } from "./components/RemoteGate";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RemoteGate>
      <App />
    </RemoteGate>
  </StrictMode>,
);
