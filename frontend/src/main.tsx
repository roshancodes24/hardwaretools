import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./ThemeProvider";
import "./index.css";
import { APP_TITLE } from "./lib/branding";
import { applyThemePreference, readStoredThemePreference } from "./lib/theme";

document.title = APP_TITLE;
applyThemePreference(readStoredThemePreference());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>
);
