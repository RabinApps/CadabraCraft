import { createRoot } from "react-dom/client";
import { I18nProvider } from "@lingui/react";
import "./index.css";
import { setAssetUrlResolver } from "@cadabracraft/editor-schema";
import { App } from "./app/App";
import { useProject } from "./app/store";
import { assetUrl } from "./lib/assets";
import { applyTheme, readTheme } from "./app/theme";
import { i18n, initI18n } from "./i18n/i18n";

// Chapter JSON keeps `assets/...` paths; the webview shows them through blob URLs read via the Tauri bridge.
setAssetUrlResolver((src) => {
  const root = useProject.getState().root;
  return root ? assetUrl(root, src) : Promise.reject(new Error("no project open"));
});
applyTheme(readTheme());
initI18n().then(() => {
  createRoot(document.getElementById("root")!).render(
    <I18nProvider i18n={i18n}>
      <App />
    </I18nProvider>,
  );
});
