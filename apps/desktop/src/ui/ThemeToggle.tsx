import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "../app/theme";
import { Segmented } from "./Segmented";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <Segmented
      label="Theme"
      value={theme}
      onChange={setTheme}
      items={[
        { value: "system", label: "System theme", icon: Monitor, iconOnly: true },
        { value: "light", label: "Light theme", icon: Sun, iconOnly: true },
        { value: "dark", label: "Dark theme", icon: Moon, iconOnly: true },
      ]}
    />
  );
}
