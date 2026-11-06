import { TRIM_SIZES, type TrimSize } from "@cadabracraft/export-pdf";

/** Display name of a trim size, such as "5.5 × 8.5 in". */
export const trimLabel = (id: TrimSize): string => `${TRIM_SIZES[id].w} × ${TRIM_SIZES[id].h} in`;
