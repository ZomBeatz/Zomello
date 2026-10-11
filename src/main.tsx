import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { RemoteGate } from "./components/RemoteGate";
import { isRemote } from "./remote";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RemoteGate>
      <App />
    </RemoteGate>
  </StrictMode>,
);

// Phones & tablets: lets Chrome offer "Install app" and keeps the app opening when the PC is off.
// (Browsers only allow this on secure origins — see Settings → Phones & tablets.)
if (isRemote && "serviceWorker" in navigator && window.isSecureContext) {
  void navigator.serviceWorker.register("/sw.js").catch(() => {});
}
