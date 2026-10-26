import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./app/App";
import { applyTheme, readTheme } from "./app/theme";

applyTheme(readTheme());
createRoot(document.getElementById("root")!).render(<App />);
