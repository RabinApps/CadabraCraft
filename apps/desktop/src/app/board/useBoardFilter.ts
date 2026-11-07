import { useMemo } from "react";
import { boardRows, filterBoard, isFiltering } from "../../lib/scenes/sceneFilter";
import { useSceneFilter } from "../../state/view/sceneFilter";
import type { BoardChapter } from "./useBoardData";

/**
 * The board under the shared scene filter: the chapters with only the scenes that pass, every scene of the book (for the filter
 * menus' values and counts) and how many pass. The full chapters stay with the caller, since moves index them.
 */
export function useBoardFilter(all: BoardChapter[], duplicates: string[]) {
  const { filter, colourBy, clear } = useSceneFilter();
  const board = useMemo(
    () => filterBoard({ chapters: all, duplicates }, filter),
    [all, duplicates, filter],
  );
  const rows = useMemo(() => boardRows({ chapters: all, duplicates }), [all, duplicates]);
  return {
    shown: board.chapters,
    rows,
    shownCount: boardRows(board).length,
    filtering: isFiltering(filter),
    colourBy,
    clear,
  };
}
