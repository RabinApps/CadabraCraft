import { t as translate } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import {
  SCENE_BREAK_ORNAMENT_IDS,
  SCENE_BREAK_ORNAMENTS,
  type SceneBreakOrnamentId,
} from "@cadabracraft/shared";
import { DEFAULT_TEMPLATE_ID, getTemplate, hasTemplate } from "@cadabracraft/templates";
import { Select } from "../../ui/forms/Select";
import { useProject } from "../../state/project/index";

/** The name of a scene-break ornament in the author's language. */
function ornamentName(id: SceneBreakOrnamentId): string {
  switch (id) {
    case "asterism":
      return translate`Asterism`;
    case "three-dots":
      return translate`Three dots`;
    case "fleuron":
      return translate`Fleuron`;
    case "dinkus":
      return translate`Dinkus`;
    case "em-dash":
      return translate`Em dash`;
    case "none":
      return translate`No mark`;
  }
}

/** Scene-break ornament of the book: each choice shows its glyph; "Template default" keeps the template's own mark. */
export function SceneBreakField({
  value,
  onChange,
}: {
  value: SceneBreakOrnamentId | null;
  onChange: (value: SceneBreakOrnamentId | null) => void;
}) {
  const { t } = useLingui();
  const manifest = useProject((s) => s.manifest);
  const templateId =
    manifest && hasTemplate(manifest.template) ? manifest.template : DEFAULT_TEMPLATE_ID;
  const templateGlyph = getTemplate(templateId).print.sceneBreak.glyph;
  return (
    <Select
      label={t`Scene break`}
      value={value ?? ""}
      onChange={(e) =>
        onChange(e.target.value === "" ? null : (e.target.value as SceneBreakOrnamentId))
      }
      hint={t`The mark between scenes in the print PDF, EPUB and Word files.`}
    >
      <option value="">{`${t`Template default`} (${templateGlyph || "—"})`}</option>
      {SCENE_BREAK_ORNAMENT_IDS.map((id) => {
        const glyph = SCENE_BREAK_ORNAMENTS[id].glyph;
        return (
          <option key={id} value={id}>
            {glyph ? `${glyph}  ${ornamentName(id)}` : ornamentName(id)}
          </option>
        );
      })}
    </Select>
  );
}
