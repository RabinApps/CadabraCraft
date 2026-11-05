import type { LucideIcon } from "lucide-react";

/** One button of the formatting bar, or one command of the More formatting menu. */
export interface ToolbarItem {
  id: string;
  label: string;
  icon: LucideIcon;
  active?: boolean;
  disabled?: boolean;
  run: () => void;
}
