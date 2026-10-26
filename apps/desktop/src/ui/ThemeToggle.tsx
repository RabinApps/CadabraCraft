import { Monitor, Moon, Sun } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { useTheme } from "../app/theme";
import { Segmented } from "./Segmented";

export function ThemeToggle() {
  const { t } = useLingui();
  const { theme, setTheme } = useTheme();
  return (
    <Segmented
      label={t`Theme`}
      value={theme}
      onChange={setTheme}
      items={[
        { value: "system", label: t`System theme`, icon: Monitor, iconOnly: true },
        { value: "light", label: t`Light theme`, icon: Sun, iconOnly: true },
        { value: "dark", label: t`Dark theme`, icon: Moon, iconOnly: true },
      ]}
    />
  );
}
