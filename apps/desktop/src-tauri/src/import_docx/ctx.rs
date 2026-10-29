//! State shared while one `.docx` is read (`docx/types.ts`).
use super::archive::Files;
use super::assets::AssetRegistry;
use super::node::{Item, Mark};
use super::parts::{Note, Numbering, Rels, Styles};
use super::warnings::Warnings;
use std::collections::HashMap;

pub struct DCtx {
    pub warn: Warnings,
    pub assets: AssetRegistry,
    pub rels: Rels,
    pub styles: Styles,
    pub numbering: Numbering,
    pub files: Files,
    pub notes: HashMap<String, Note>,
    pub comment_refs: u32,
}

/// A Word field being read: its instruction text, then its result.
pub struct Field {
    pub instr: String,
    /// `true` once the `separate` marker has been seen (the instruction is complete and the result follows).
    pub in_result: bool,
    pub link: Option<Mark>,
}

/// The paragraph being built.
#[derive(Default)]
pub struct PState {
    pub items: Vec<Item>,
    pub fields: Vec<Field>,
    pub in_note: bool,
    /// A Word checkbox content control began the paragraph: its checked state. Set at most once, before any text.
    pub checkbox: Option<bool>,
}

impl PState {
    pub fn new(in_note: bool) -> PState {
        PState { in_note, ..PState::default() }
    }
}
