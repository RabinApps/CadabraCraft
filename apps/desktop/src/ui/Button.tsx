import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink hover:brightness-110",
  secondary: "border border-border bg-surface text-ink hover:bg-accent-soft",
  ghost: "text-ink hover:bg-accent-soft",
  danger: "bg-danger text-accent-ink hover:brightness-110",
};

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  icon?: LucideIcon;
  children: ReactNode;
}

export function Button({
  variant = "secondary",
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
        "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        focus,
        className,
      )}
      {...rest}
    >
      {Icon && <Icon size={16} aria-hidden />}
      {children}
    </button>
  );
}

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: LucideIcon;
  /** Required: becomes the accessible name and tooltip. */
  label: string;
  active?: boolean;
}

/** 44px touch target on small screens, 36px from md. */
export function IconButton({
  icon: Icon,
  label,
  active,
  className,
  type = "button",
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cx(
        "inline-flex size-11 items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-40 md:size-9",
        active ? "bg-accent-soft text-accent" : "text-ink hover:bg-accent-soft",
        focus,
        className,
      )}
      {...rest}
    >
      <Icon size={18} aria-hidden />
    </button>
  );
}
