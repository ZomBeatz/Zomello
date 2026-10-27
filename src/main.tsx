import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { RemoteGate } from "./components/RemoteGate";
import { ServerGate } from "./components/ServerGate";
import { isRemote } from "./remote";
import { isServer } from "./server";
import { placeStartup } from "./places";
import { isPhoneOrTablet } from "./storage";
import "./styles.css";

// Touch screens get bigger targets in the stylesheet. iPads don't always say so in their media queries
// (they can report a fine pointer), so mark them here too.
if (isPhoneOrTablet) document.documentElement.dataset.touch = "";

// Phones and tablets: reopen the computer or server the app was last on (or remember the way back).
void placeStartup().then((leaving) => {
  if (leaving) return;
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ServerGate>
        <RemoteGate>
          <App />
        </RemoteGate>
      </ServerGate>
    </StrictMode>,
  );
});

// Phones & tablets: lets Chrome offer "Install app" and keeps the app opening when the PC is off.
// (Browsers only allow this on secure origins — see Settings → Phones & tablets.)
if ((isRemote || isServer) && "serviceWorker" in navigator && window.isSecureContext) {
  void navigator.serviceWorker.register("/sw.js").catch(() => {});
}
