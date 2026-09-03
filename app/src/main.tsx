// Must run before pdf.js loads. See the file for why.
import "./webkit-shims.js";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

// The title bar is drawn by the OS on Windows and Linux, and by us on macOS,
// so the topbar's left gutter for the traffic lights is platform dependent.
// The user agent is enough here: WKWebView reports "Mac OS X", WebView2 reports
// "Windows NT", and anything unrecognised falls back to the decorated layout.
document.documentElement.dataset.os = /Mac OS X/.test(navigator.userAgent) ? "macos" : "other";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
