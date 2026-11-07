import { newProject } from "./helpers";
import { shown, type Screen } from "./a11yScreenHelpers";

/** Where the page is on screen, in the physical pixels Tauri reports a drag position in. */
const onPage = (p: Parameters<Screen["open"]>[0]) =>
  p.locator(".ProseMirror").evaluate((n) => {
    const r = n.getBoundingClientRect();
    return { x: (r.left + r.width / 2) * devicePixelRatio, y: (r.top + 60) * devicePixelRatio };
  });

/** Files dragged from the desktop onto the page: the drop highlight and the warning for a file that cannot be added. */
export const dropScreens: Screen[] = [
  {
    name: "editor taking a picture drop",
    open: async (p) => {
      await newProject(p);
      const position = await onPage(p);
      await p.evaluate(
        (pos) =>
          window.__emit!("tauri://drag-enter", { paths: ["/pics/photo.png"], position: pos }),
        position,
      );
      await shown(p.getByText("Drop a picture to add it"));
    },
  },
  {
    name: "editor unsupported file warning",
    open: async (p) => {
      await newProject(p);
      const position = await onPage(p);
      await p.evaluate(
        (pos) => window.__emit!("tauri://drag-drop", { paths: ["/docs/notes.pdf"], position: pos }),
        position,
      );
      await shown(p.getByText("This file type can't be added here."));
    },
  },
];
