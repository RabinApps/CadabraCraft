import { strFromU8 } from "fflate";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { errMsg } from "@cadabracraft/shared";
import { ImportError } from "../types";

// fast-xml-parser, preserveOrder, namespace prefixes removed

/** One element in fast-xml-parser's `preserveOrder` output: `{ <tag>: XNode[], ":@": attributes }` or a text node `{ "#text": string }`. */
export interface XNode {
  ":@"?: Record<string, string | undefined>;
  [tag: string]: XNode[] | string | Record<string, string | undefined> | undefined;
}

const xml = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
});

export function parseXml(bytes: Uint8Array, name: string): XNode[] {
  const s = strFromU8(bytes).replace(/^﻿/, "");
  const ok = XMLValidator.validate(s);
  if (ok !== true)
    throw new ImportError("invalid-xml", `${name} is not well-formed XML (${ok.err.msg}).`);
  try {
    return xml.parse(s) as XNode[];
  } catch (e) {
    throw new ImportError("invalid-xml", `${name} could not be parsed (${errMsg(e)}).`);
  }
}

export const tagOf = (n: XNode): string | undefined => {
  for (const k in n) if (k !== ":@") return k;
  return undefined;
};
export const kids = (n: XNode): XNode[] => {
  const t = tagOf(n);
  const v = t ? n[t] : undefined;
  return Array.isArray(v) ? v : [];
};
export const attr = (n: XNode, name: string): string | undefined => n[":@"]?.[`@_${name}`];
export const child = (n: XNode, name: string): XNode | undefined =>
  kids(n).find((k) => tagOf(k) === name);
export const childrenNamed = (n: XNode, name: string): XNode[] =>
  kids(n).filter((k) => tagOf(k) === name);
export const on = (n: XNode | undefined): boolean => {
  if (!n) return false;
  const v = attr(n, "val");
  return !(v === "0" || v === "false" || v === "off" || v === "none");
};

export const MAX_XML_DEPTH = 100;
export function descendants(n: XNode, name: string, out: XNode[] = [], depth = 0): XNode[] {
  if (depth > MAX_XML_DEPTH) return out;
  for (const k of kids(n)) {
    if (tagOf(k) === name) out.push(k);
    descendants(k, name, out, depth + 1);
  }
  return out;
}

/** Visible text of an element (w:t and m:t), ignoring deleted text. */
export function rawText(n: XNode, depth = 0): string {
  if (depth > MAX_XML_DEPTH) return "";
  let s = "";
  for (const k of kids(n)) {
    const t = tagOf(k);
    if (t === "#text") s += String(k["#text"] ?? "");
    else if (t === "t")
      s += kids(k)
        .map((x) => String(x["#text"] ?? ""))
        .join("");
    else if (t === "tab") s += " ";
    else if (t === "del" || t === "moveFrom" || t === "delText" || t === "instrText") continue;
    else if (t === "p" && s && !s.endsWith(" ")) s += " " + rawText(k, depth + 1);
    else s += rawText(k, depth + 1);
  }
  return s;
}
