import { createRoot } from "react-dom/client";
import { I18nProvider } from "@lingui/react";
import "./index.css";
import { setAssetUrlResolver } from "@cadabracraft/editor-schema";
import { App } from "./app/shell/App";
import { ErrorBoundary } from "./app/shell/ErrorBoundary";
import { installRejectionNotice } from "./state/attempt";
import { useProject } from "./state/project/index";
import { assetUrl } from "./lib/assets";
import { applyTheme, readTheme } from "./state/theme";
import { i18n, initI18n } from "./i18n/i18n";

// Chapter JSON keeps `assets/...` paths; the webview shows them through blob URLs read via the Tauri bridge.
setAssetUrlResolver((src) => {
  const root = useProject.getState().root;
  return root ? assetUrl(root, src) : Promise.reject(new Error("no project open"));
});
applyTheme(readTheme());
installRejectionNotice();
// If the language files cannot be loaded the app still opens (with untranslated text) instead of staying blank.
initI18n()
  .catch(() => {})
  .then(() => {
    createRoot(document.getElementById("root")!).render(
      <I18nProvider i18n={i18n}>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </I18nProvider>,
    );
  });
