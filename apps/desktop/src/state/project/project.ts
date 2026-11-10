import type { ProjectActions } from "./types";
import type { Ctx } from "./context";
import { createDetailsActions } from "./book/details";
import { createGoalActions } from "./book/goal";
import { createExternalActions } from "./book/external";
import { createOpenActions } from "./book/open";

/** Opening, closing and creating a book, changes from outside the app, import, and the book-level settings in cadabra.json. */
export const createProjectActions = (ctx: Ctx): ProjectActions => ({
  ...createExternalActions(ctx),
  ...createOpenActions(ctx),
  ...createDetailsActions(ctx),
  ...createGoalActions(ctx),
});
