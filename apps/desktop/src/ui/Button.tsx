import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cx } from "./cx";
import { mirrorClass } from "./directional";
import { Tooltip } from "./Tooltip";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink hover:brightness-110",
  secondary: "border border-border-strong bg-surface text-ink hover:bg-accent-soft",
  ghost: "text-ink hover:bg-accent-soft",
  danger: "bg-danger text-accent-ink hover:brightness-110",
};

export type ButtonSize = "md" | "sm";

const sizes: Record<ButtonSize, string> = {
  md: "px-4 py-2.5 text-sm max-md:min-h-11",
  sm: "px-3 py-1.5 text-xs max-md:min-h-11",
};

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** `sm` is the compact size used in toolbars and the Find bar. */
  size?: ButtonSize;
  icon?: LucideIcon;
  children: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon: Icon,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50",
        sizes[size],
        variants[variant],
        focus,
        className,
      )}
      {...rest}
    >
      {Icon && <Icon size={16} aria-hidden className={mirrorClass(Icon)} />}
      {children}
    </button>
  );
}

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: LucideIcon;
  /** Required: becomes the accessible name and tooltip. */
  label: string;
  /** Shown after the label in the tooltip (a keyboard shortcut); also set `aria-keyshortcuts`. */
  hint?: string;
  active?: boolean;
}

/** 44px touch target on small screens, 36px from md. */
export function IconButton({
  icon: Icon,
  label,
  hint,
  active,
  className,
  type = "button",
  ...rest
}: IconButtonProps) {
  return (
    <Tooltip content={hint ? `${label} (${hint})` : label}>
      <button
        type={type}
        aria-label={label}
        aria-pressed={active}
        className={cx(
          "inline-flex size-11 items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-40 md:size-9",
          active ? "bg-accent-soft text-accent" : "text-ink hover:bg-accent-soft",
          focus,
          className,
        )}
        {...rest}
      >
        <Icon size={18} aria-hidden className={mirrorClass(Icon)} />
      </button>
    </Tooltip>
  );
}
