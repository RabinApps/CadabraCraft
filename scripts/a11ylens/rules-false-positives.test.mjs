// A11yLens guard tests: patterns CadabraCraft really uses must stay clean; known tool false positives are recorded as todo tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, scanJson } from "./run.mjs";

/** A clean HTML page; `body` starts on line 8. Document-level cases pass whole files instead. */
const page = (body, head = "") =>
  `<!doctype html>\n<html lang="en">\n<head><title>T</title>${head}</head>\n<body>\n<a href="#main">Skip to content</a>\n<main id="main">\n<h1>Title</h1>\n${body}\n</main>\n</body>\n</html>\n`;
const asFiles = (x) => (typeof x === "string" ? { "index.html": page(x) } : x);

function findings(x) {
  const dir = fixture(asFiles(x));
  const { report, stderr } = scanJson([dir, "--fail-on", "none"]);
  assert.ok(report, `no JSON report: ${stderr}`);
  return report.findings;
}

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./run.mjs";

const ids = (x) => findings(x).map((f) => `${f.ruleId}:${f.file}:${f.line}`);
const cleanTest = (name, files) => test(name, () => assert.deepEqual(ids(files), []));

// ---- Patterns that must stay clean -------------------------------------------------------

cleanTest("Radix-style dropdown menu and dialog (labelled trigger, compound parts) stay clean", {
  "src/Menu.tsx": `import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Dialog from "@radix-ui/react-dialog";
export function Menu() {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" aria-label="More actions"><svg aria-hidden="true" /></button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content>
        <DropdownMenu.Item onSelect={go}>Rename</DropdownMenu.Item>
      </DropdownMenu.Content>
      <Dialog.Root>
        <Dialog.Content aria-describedby={undefined}>
          <Dialog.Title>Settings</Dialog.Title>
        </Dialog.Content>
      </Dialog.Root>
    </DropdownMenu.Root>
  );
}
`,
});

cleanTest("rendered Radix-like DOM: haspopup button, native menuitem buttons, modal dialog, tabs", {
  "index.html":
    page(`<button type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="m1" id="t1">Actions</button>
<div role="menu" id="m1" aria-labelledby="t1" hidden><button role="menuitem" type="button">Rename</button></div>
<div role="dialog" aria-modal="true" aria-labelledby="dt"><h2 id="dt">Settings</h2><button type="button" aria-pressed="true">Bold</button></div>
<div role="tablist" aria-label="Views"><button role="tab" aria-selected="true" aria-controls="tp" id="tb">One</button></div>
<div role="tabpanel" id="tp" aria-labelledby="tb">Panel</div>`),
});

cleanTest("TipTap contenteditable with role=textbox and aria-label (HTML)", {
  "index.html": page(
    '<div role="textbox" aria-multiline="true" aria-label="Chapter text" contenteditable="true" tabindex="0"><p>Hello</p></div>',
  ),
});

cleanTest("TipTap host component with role=textbox, aria-label and EditorContent (TSX)", {
  "src/Editor.tsx": `export function Editor({ editor }) {
  return (
    <div>
      <div role="textbox" aria-multiline="true" aria-label="Chapter text" contentEditable suppressContentEditableWarning tabIndex={0} />
      <EditorContent editor={editor} />
    </div>
  );
}
`,
});

cleanTest("aria-live regions (status, alert, polite, assertive) in HTML", {
  "index.html": page(
    '<div role="status" aria-live="polite" aria-atomic="true"></div><div role="alert" aria-live="assertive"></div>',
  ),
});

cleanTest("aria-live region in a component", {
  "src/Live.tsx":
    'export function Live({ msg }) {\n  return <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">{msg}</div>;\n}\n',
});

cleanTest("form with a live status region has no form-live-region finding", {
  "index.html": page(
    '<form><label for="q">Find</label><input id="q" autocomplete="off"><button>Go</button><div role="status" aria-live="polite"></div></form>',
  ),
});

cleanTest("toolbar of icon buttons labelled with aria-label (literal and translated expression)", {
  "src/Toolbar.tsx": `export function Toolbar({ t }) {
  return (
    <div role="toolbar" aria-label="Formatting">
      <button type="button" aria-pressed={true} aria-label="Bold"><svg aria-hidden="true" /></button>
      <button type="button" aria-label={t("close")} onClick={go}><svg aria-hidden="true" /></button>
      <button type="button" aria-label="Italic"><Icon /></button>
    </div>
  );
}
`,
});

cleanTest("button that forwards children and props (Chip pattern with children)", {
  "src/Btn.tsx":
    'export function Btn({ children, ...rest }) {\n  return <button type="button" {...rest}>{children}</button>;\n}\n',
});

cleanTest("roving-tabindex listbox option with a key handler (Radix/cmdk style)", {
  "src/List.tsx":
    'export function List() {\n  return <ul role="listbox" aria-label="L"><li role="option" aria-selected={s} tabIndex={-1} onClick={go} onKeyDown={k}>x</li></ul>;\n}\n',
});

test("the real apps/desktop Chip.tsx has no src-icon-button finding", () => {
  const chip = readFileSync(join(ROOT, "apps/desktop/src/ui/feedback/Chip.tsx"), "utf8");
  assert.deepEqual(ids({ "src/Chip.tsx": chip }), []);
});

// ---- Known tool false positives (observed 1.0.0 behaviour + todo for the desired one) ----

// Chip.tsx at git HEAD rendered children through the spread: `<button ... {...rest} />`.
// Callers pass aria-label via rest, which the tool cannot see; src-icon-button treats the
// self-closing button as icon-only and errors. The working tree fixed it by rendering
// {children}; the pattern below is kept as the original shape.
const CHIP_SPREAD = `import type { ComponentPropsWithRef } from "react";
interface ChipProps extends Omit<ComponentPropsWithRef<"button">, "type"> {
  pressed: boolean;
}
export function Chip({ pressed, className, ...rest }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={className}
      {...rest}
    />
  );
}
`;

test("OBSERVED: self-closing <button {...rest} /> is flagged by src-icon-button (line 7)", () => {
  const hits = findings({ "src/Chip.tsx": CHIP_SPREAD }).filter(
    (f) => f.ruleId === "src-icon-button",
  );
  assert.deepEqual(
    hits.map((f) => [f.severity, f.file, f.line]),
    [["error", "src/Chip.tsx", 7]],
  );
});

test.todo(
  "DESIRED: self-closing <button {...rest} /> should not be flagged (aria-label arrives via rest) — tool false positive: src-icon-button ignores {...spread} props, unlike src-img-alt and src-anchor-href",
);

const SPREAD_ICON =
  'export function B(props) {\n  return <button type="button" {...props}><Icon /></button>;\n}\n';

test("OBSERVED: <button {...props}><Icon /></button> is flagged by src-icon-button", () => {
  const hits = findings({ "src/B.tsx": SPREAD_ICON }).filter((f) => f.ruleId === "src-icon-button");
  assert.equal(hits.length, 1);
});

test.todo(
  "DESIRED: a spread button whose child is an <Icon /> component should not be flagged — tool false positive: src-icon-button also matches <Icon .../> components and ignores {...props}",
);

const ROVING = '<div role="menu" aria-label="M"><div role="menuitem" tabindex="-1">Cut</div></div>';

test("OBSERVED: roving tabindex=-1 on a div role=menuitem is flagged by interactive-role-focusable", () => {
  const hits = findings(ROVING).filter((f) => f.ruleId === "interactive-role-focusable");
  assert.deepEqual(
    hits.map((f) => [f.severity, f.line]),
    [["warning", 8]],
  );
});

test.todo(
  "DESIRED: roving-tabindex menu items (tabindex=-1 inside a menu) should not be flagged — tool false positive: interactive-role-focusable demands tabindex=0 even for roving-tabindex composites",
);

test("OBSERVED: <label> wrapping its input is reported as info src-label-for (documented as 'verify')", () => {
  const hits = findings({
    "src/L.tsx":
      'export function L() {\n  return <label>Name <input aria-label="n" /></label>;\n}\n',
  }).filter((f) => f.ruleId === "src-label-for");
  assert.deepEqual(
    hits.map((f) => [f.severity, f.line]),
    [["info", 2]],
  );
});
