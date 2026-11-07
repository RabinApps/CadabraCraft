import * as M from "@radix-ui/react-dropdown-menu";
import { useLingui } from "@lingui/react/macro";
import { ArrowDown, ArrowUp, Ellipsis, PenLine } from "lucide-react";
import { IconButton } from "../../ui/Button";
import { menuContentClass, menuItemClass, menuLabelClass } from "../../ui/Menu";
import type { CardMoves } from "./SceneCard";

/**
 * The card's actions menu: the move commands and Open scene. While a filter is on `moves` is null and only Open scene is left,
 * because a move's place is an index in the whole chapter, not in the cards that are shown.
 */
export function CardMenu({
  title,
  moves,
  onOpen,
}: {
  title: string;
  moves: CardMoves | null;
  onOpen: () => void;
}) {
  const { t } = useLingui();
  return (
    <M.Root>
      <M.Trigger asChild>
        <IconButton
          icon={Ellipsis}
          label={t`Actions for ${title}`}
          className="shrink-0 md:size-7"
        />
      </M.Trigger>
      <M.Portal>
        <M.Content align="end" className={menuContentClass("min-w-48")}>
          {moves && (
            <>
              <M.Item
                className={menuItemClass()}
                disabled={moves.index === 0}
                onSelect={() => moves.step(-1)}
              >
                <ArrowUp size={14} aria-hidden />
                {t`Move earlier`}
              </M.Item>
              <M.Item
                className={menuItemClass()}
                disabled={moves.index === moves.count - 1}
                onSelect={() => moves.step(1)}
              >
                <ArrowDown size={14} aria-hidden />
                {t`Move later`}
              </M.Item>
              {moves.chapters.length > 0 && (
                <>
                  <M.Separator className="my-1 h-px bg-border" />
                  <M.Label className={menuLabelClass} aria-hidden>
                    {t`Move to chapter`}
                  </M.Label>
                  {moves.chapters.map((c) => (
                    <M.Item
                      key={c.id}
                      className={menuItemClass()}
                      onSelect={() => moves.toChapter(c.id)}
                    >
                      {c.title}
                    </M.Item>
                  ))}
                </>
              )}
              <M.Separator className="my-1 h-px bg-border" />
            </>
          )}
          <M.Item className={menuItemClass()} onSelect={onOpen}>
            <PenLine size={14} aria-hidden />
            {t`Open scene`}
          </M.Item>
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}
