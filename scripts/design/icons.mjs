// The pen stores icons as { type: "icon", icon: "circle-check", library: "lucide", fill: "$success" }.
// OpenPencil's .pen reader does not know that type and turns it into an empty frame (a plain square).
// Before the pen goes into the reader, each lucide icon is replaced by a frame holding one stroked path
// built from the icon's shapes (24 x 24 grid, 2 px round strokes, like lucide itself).

const GRID = 24;

const n = (value) => Number(value ?? 0);

function circlePath(cx, cy, rx, ry) {
  return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0`;
}

function rectPath({ x, y, width, height, rx, ry }) {
  const w = n(width);
  const h = n(height);
  const r = Math.min(n(rx ?? ry), w / 2, h / 2);
  const left = n(x);
  const top = n(y);
  if (r <= 0) return `M${left} ${top}h${w}v${h}h${-w}z`;
  return (
    `M${left + r} ${top}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}` +
    `h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`
  );
}

const points = (list, close) => {
  const pairs = String(list)
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
  const out = [];
  for (let i = 0; i + 1 < pairs.length; i += 2) out.push(`${pairs[i]} ${pairs[i + 1]}`);
  return out.length ? `M${out.join("L")}${close ? "z" : ""}` : "";
};

/** One lucide shape ([tag, attributes]) as SVG path data; "" for a shape this does not know. */
export function shapeToPath([tag, a]) {
  switch (tag) {
    case "path":
      return a.d ?? "";
    case "circle":
      return circlePath(n(a.cx), n(a.cy), n(a.r), n(a.r));
    case "ellipse":
      return circlePath(n(a.cx), n(a.cy), n(a.rx), n(a.ry));
    case "rect":
      return rectPath(a);
    case "line":
      return `M${n(a.x1)} ${n(a.y1)}L${n(a.x2)} ${n(a.y2)}`;
    case "polyline":
      return points(a.points, false);
    case "polygon":
      return points(a.points, true);
    default:
      return "";
  }
}

/** All shapes of an icon as one path. Two move-only points pin the box to the full 24 x 24 grid. */
export function iconPathData(shapes) {
  // "M0 0" before each shape: lucide paths start with a relative "m", which would otherwise be
  // measured from wherever the previous subpath ended.
  return `M0 0M${GRID} ${GRID}${shapes.map((shape) => `M0 0${shapeToPath(shape)}`).join("")}`;
}

/** The frame that replaces one icon node. `shapes` is the lucide node list for the icon, or undefined. */
export function iconToFrame(icon, shapes) {
  const width = typeof icon.width === "number" ? icon.width : 16;
  const height = typeof icon.height === "number" ? icon.height : width;
  const frame = {
    type: "frame",
    id: icon.id,
    name: icon.name ?? icon.icon,
    width,
    height,
    layout: "none",
  };
  if (!shapes?.length) return frame;
  frame.children = [
    {
      type: "path",
      id: `${icon.id}-shape`,
      name: icon.icon,
      x: 0,
      y: 0,
      width,
      height,
      geometry: iconPathData(shapes),
      stroke: {
        align: "center",
        thickness: (2 * Math.min(width, height)) / GRID,
        fill: icon.fill ?? "#000000",
        join: "round",
        cap: "round",
      },
    },
  ];
  return frame;
}

/**
 * Replaces every lucide icon node in a parsed pen document (in place) and returns what it did.
 * @param {unknown} doc parsed .pen JSON
 * @param {(name: string) => Array<[string, Record<string, string>]> | undefined} loadShapes (e.g. `(name) => map.get(name)`)
 * @returns {{ replaced: number, missing: string[] }}
 */
export function replaceIcons(doc, loadShapes) {
  let replaced = 0;
  const missing = new Set();
  const visit = (parent) => {
    for (const [key, value] of Object.entries(parent)) {
      if (!value || typeof value !== "object") continue;
      if (value.type === "icon" && value.icon && (value.library ?? "lucide") === "lucide") {
        const shapes = loadShapes(value.icon);
        if (!shapes) missing.add(value.icon);
        parent[key] = iconToFrame(value, shapes);
        replaced++;
      } else {
        visit(value);
      }
    }
  };
  visit({ root: doc });
  return { replaced, missing: [...missing] };
}

/** The lucide icon names used in a parsed pen document. */
export function iconNames(doc) {
  const names = new Set();
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (value.type === "icon" && value.icon && (value.library ?? "lucide") === "lucide")
      names.add(value.icon);
    for (const child of Object.values(value)) visit(child);
  };
  visit(doc);
  return [...names];
}
