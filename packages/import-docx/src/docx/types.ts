import type { Mark } from "@cadabracraft/shared";
import type { AssetRegistry, Item, Warnings } from "../common";
import type { XNode } from "./xml";

export interface Rel {
  target: string;
  external: boolean;
}

export interface StyleInfo {
  type: string;
  name: string;
  basedOn?: string;
  numId?: string;
  ilvl?: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  smallCaps: boolean;
}

export interface Numbering {
  nums: Map<string, string>;
  abstracts: Map<string, Map<number, string>>;
}

export interface DCtx {
  warn: Warnings;
  assets: AssetRegistry;
  rels: Map<string, Rel>;
  styles: Map<string, StyleInfo>;
  numbering: Numbering;
  files: Record<string, Uint8Array>;
  notes: Map<string, { el: XNode; kind: "footnote" | "endnote" }>;
  commentRefs: number;
}

export interface Field {
  instr: string;
  phase: "instr" | "result";
  link?: Mark;
}
export interface PState {
  ctx: DCtx;
  items: Item[];
  fields: Field[];
  inNote: boolean;
  /** A Word checkbox content control began the paragraph: its checked state. Set at most once, before any text. */
  checkbox?: boolean;
}
