import assert from "node:assert/strict";
import { test } from "node:test";
import { iconNames, iconPathData, iconToFrame, replaceIcons, shapeToPath } from "./icons.mjs";

test("shapeToPath converts each lucide shape and ignores unknown ones", () => {
  assert.equal(shapeToPath(["path", { d: "m16 9-5.5 5.5" }]), "m16 9-5.5 5.5");
  assert.equal(shapeToPath(["line", { x1: "1", y1: "2", x2: "3", y2: "4" }]), "M1 2L3 4");
  assert.equal(shapeToPath(["polyline", { points: "1 2 3 4" }]), "M1 2L3 4");
  assert.equal(shapeToPath(["polygon", { points: "1 2 3 4 5 6" }]), "M1 2L3 4L5 6z");
  assert.match(shapeToPath(["circle", { cx: "12", cy: "12", r: "10" }]), /^M2 12a10 10 0 1 0 20 0/);
  assert.match(
    shapeToPath(["rect", { x: "3", y: "3", width: "18", height: "18", rx: "2" }]),
    /^M5 3h14a2 2/,
  );
  assert.equal(shapeToPath(["rect", { x: "1", y: "1", width: "2", height: "3" }]), "M1 1h2v3h-2z");
  assert.equal(shapeToPath(["blob", {}]), "");
});

test("iconPathData pins the 24 grid and restarts at the origin for each shape", () => {
  assert.equal(
    iconPathData([
      ["path", { d: "m1 1h2" }],
      ["path", { d: "m5 5" }],
    ]),
    "M0 0M24 24M0 0m1 1h2M0 0m5 5",
  );
});

test("iconToFrame keeps id, name and size and strokes the path with the icon's fill", () => {
  const frame = iconToFrame(
    { id: "a", name: "check", icon: "circle-check", width: 16, height: 16, fill: "$success" },
    [["path", { d: "m1 1" }]],
  );
  assert.equal(frame.type, "frame");
  assert.equal(frame.id, "a");
  assert.equal(frame.children[0].stroke.fill, "$success");
  assert.equal(frame.children[0].stroke.thickness, (2 * 16) / 24);
});

test("an icon without known shapes becomes an empty frame of the same size", () => {
  const frame = iconToFrame({ id: "a", icon: "github", width: 20 }, undefined);
  assert.deepEqual(frame, {
    type: "frame",
    id: "a",
    name: "github",
    width: 20,
    height: 20,
    layout: "none",
  });
});

test("replaceIcons swaps icon nodes anywhere in the tree and reports unknown names", () => {
  const doc = {
    children: [
      {
        type: "frame",
        id: "f",
        children: [{ type: "icon", id: "i1", icon: "x", library: "lucide" }],
      },
      { type: "icon", id: "i2", icon: "nope", library: "lucide" },
      { type: "icon", id: "i3", icon: "other", library: "material" },
    ],
  };
  assert.deepEqual(iconNames(doc), ["x", "nope"]);
  assert.deepEqual(
    iconNames({
      type: "ref",
      id: "r",
      descendants: { a: { icon: "italic" }, b: { fill: "#fff" } },
    }),
    ["italic"],
  );
  const result = replaceIcons(doc, (name) =>
    name === "x" ? [["path", { d: "m1 1" }]] : undefined,
  );
  assert.deepEqual(result, {
    replaced: 2,
    missing: ["nope"],
    ids: new Map([
      ["i1", "x"],
      ["i2", "nope"],
    ]),
  });
  assert.equal(doc.children[0].children[0].type, "frame");
  assert.equal(doc.children[1].type, "frame");
  assert.equal(doc.children[2].type, "icon");
});
