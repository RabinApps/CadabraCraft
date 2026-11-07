import * as M from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import { menuItemClass, menuLabelClass } from "../../../ui/Menu";

/** A labelled group of radio choices in a row menu. */
export function ChoiceGroup({
  label,
  value,
  choices,
  onValueChange,
}: {
  label: string;
  value: string;
  choices: readonly (readonly [string, string])[];
  onValueChange: (v: string) => void;
}) {
  return (
    <>
      <M.Label className={menuLabelClass} aria-hidden>
        {label}
      </M.Label>
      <M.RadioGroup aria-label={label} value={value} onValueChange={onValueChange}>
        {choices.map(([v, text]) => (
          <M.RadioItem key={v} value={v} className={menuItemClass()}>
            <span className="flex size-3.5 items-center justify-center text-accent">
              <M.ItemIndicator>
                <Check size={14} aria-hidden />
              </M.ItemIndicator>
            </span>
            {text}
          </M.RadioItem>
        ))}
      </M.RadioGroup>
    </>
  );
}
