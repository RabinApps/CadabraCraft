// The editor/exporter contract. The schema lives in the files below; this barrel is the public API.
export * from "./nodes/blocks";
export * from "./nodes/tables";
export * from "./nodes/lists";
export * from "./nodes/image";
export * from "./marks/marks";
export * from "./alignment";
export { EDITOR_KEY_COMMANDS, shortcutRemap } from "./keys";
export * from "./extensions";
export * from "./validate";
