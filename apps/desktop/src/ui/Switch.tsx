import { cx } from "./cx";

/** On/off switch (role="switch"). Pass a visible label through `label`, which becomes the accessible name. */
export function Switch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative h-[22px] w-10 shrink-0 rounded-full p-[3px] transition-colors focus-visible:outline-2 focus-visible:outline-accent",
        checked ? "bg-accent" : "bg-border",
      )}
    >
      <span
        className={cx(
          "block size-4 rounded-full bg-surface transition-transform",
          checked && "translate-x-[18px] rtl:-translate-x-[18px]",
        )}
      />
    </button>
  );
}
