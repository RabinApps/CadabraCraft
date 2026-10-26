import { createRoot } from "react-dom/client";
import { I18nProvider } from "@lingui/react";
import "./index.css";
import { App } from "./app/App";
import { applyTheme, readTheme } from "./app/theme";
import { i18n, initI18n } from "./i18n/i18n";

applyTheme(readTheme());
initI18n().then(() => {
  createRoot(document.getElementById("root")!).render(
    <I18nProvider i18n={i18n}>
      <App />
    </I18nProvider>,
  );
});
