import { useEffect, useRef } from "react";
import { runCommand } from "../../state/app/commands";
import { useQuickNav } from "../../state/app/quickNav";
import { pressed } from "../settings/shortcutBindings";
import { CommandPalette } from "./CommandPalette";
import { OutlineNavigator } from "./OutlineNavigator";

/**
 * Hosts the command palette and the outline navigator, and answers their keys: Cmd/Ctrl+K and Cmd/Ctrl+Shift+O. The native menu
 * owns the accelerators on the desktop; this listener covers the browser and any platform where the key also reaches the page,
 * so a second call within a few ms is ignored (the same guard as Find).
 */
export function QuickNav() {
  const panel = useQuickNav((s) => s.panel);
  const close = useQuickNav((s) => s.close);
  const last = useRef({ palette: 0, outline: 0 });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const palette = pressed(e, "view.palette");
      const outline = pressed(e, "view.outline");
      if (!palette && !outline) return;
      e.preventDefault();
      const which = palette ? "palette" : "outline";
      if (Date.now() - last.current[which] < 80) return;
      last.current[which] = Date.now();
      const { panel: open, close: shut } = useQuickNav.getState();
      // The same key closes the palette it opened. Any other dialog keeps the key for itself.
      if (open === which) shut();
      else runCommand(`view.${which}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (panel === "palette") return <CommandPalette onClose={close} />;
  if (panel === "outline") return <OutlineNavigator onClose={close} />;
  return null;
}
