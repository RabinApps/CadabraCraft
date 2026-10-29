//! Import warnings: `common/warnings.ts`. `tally` aggregates a count and a few examples per code; `at` keeps one
//! entry (the .docx importer only uses it for the chapter-splitting messages, each of which is raised once).
use super::text::{collapse_ws, js_trim, slice_utf16};
use serde::Serialize;
use std::collections::HashMap;

const MAX_EXAMPLES: usize = 5;

#[derive(Serialize, Debug, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Warning,
    Info,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Warning {
    pub code: String,
    pub severity: Severity,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<u32>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub examples: Vec<String>,
}

#[derive(Default)]
pub struct Warnings {
    list: Vec<Warning>,
    by_code: HashMap<String, usize>,
}

impl Warnings {
    pub fn new() -> Warnings {
        Warnings::default()
    }

    /// A warning that stands for one place.
    pub fn at(&mut self, code: &str, severity: Severity, message: &str) {
        self.list.push(Warning { code: code.to_string(), severity, message: message.to_string(), count: None, examples: Vec::new() });
    }

    /// Counts one more occurrence of `code`; the first call fixes the severity and message. `example` is collapsed to one
    /// line and cut to 80 characters; at most five distinct examples are kept.
    pub fn tally(&mut self, code: &str, severity: Severity, message: &str, example: Option<&str>) {
        let idx = *self.by_code.entry(code.to_string()).or_insert_with(|| {
            self.list.push(Warning { code: code.to_string(), severity, message: message.to_string(), count: Some(0), examples: Vec::new() });
            self.list.len() - 1
        });
        let w = &mut self.list[idx];
        w.count = Some(w.count.unwrap_or(0) + 1);
        if let Some(ex) = example {
            let ex = slice_utf16(js_trim(&collapse_ws(ex)), 80);
            if !ex.is_empty() && w.examples.len() < MAX_EXAMPLES && !w.examples.contains(&ex) {
                w.examples.push(ex);
            }
        }
    }

    pub fn into_list(self) -> Vec<Warning> {
        self.list
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tally_counts_and_keeps_distinct_trimmed_examples_in_first_seen_order() {
        let mut w = Warnings::new();
        w.tally("b", Severity::Info, "first message", Some("  one \n two  "));
        w.tally("a", Severity::Warning, "a", None);
        w.tally("b", Severity::Warning, "ignored", Some("one two"));
        w.tally("b", Severity::Info, "ignored", Some(""));
        w.tally("b", Severity::Info, "ignored", Some("   "));
        for i in 0..10 {
            w.tally("b", Severity::Info, "ignored", Some(&format!("e{i}")));
        }
        w.at("c", Severity::Warning, "located");
        let l = w.into_list();
        assert_eq!(l.iter().map(|x| x.code.as_str()).collect::<Vec<_>>(), ["b", "a", "c"]);
        assert_eq!(l[0].count, Some(14));
        assert_eq!(l[0].severity, Severity::Info);
        assert_eq!(l[0].message, "first message");
        assert_eq!(l[0].examples, ["one two", "e0", "e1", "e2", "e3"]);
        assert_eq!(l[1].examples, Vec::<String>::new());
        assert_eq!(l[2].count, None);
    }

    #[test]
    fn examples_are_cut_to_eighty_utf16_units_and_the_json_shape_matches_typescript() {
        let mut w = Warnings::new();
        w.tally("x", Severity::Warning, "m", Some(&"a".repeat(100)));
        w.tally("y", Severity::Info, "m", None);
        w.at("z", Severity::Warning, "m");
        let l = w.into_list();
        assert_eq!(l[0].examples[0].len(), 80);
        let json = serde_json::to_string(&l).unwrap();
        assert!(json.contains(r#"{"code":"y","severity":"info","message":"m","count":1}"#), "{json}");
        assert!(json.contains(r#"{"code":"z","severity":"warning","message":"m"}"#), "{json}");
        assert!(json.starts_with(r#"[{"code":"x","severity":"warning","message":"m","count":1,"examples":["aaa"#), "{json}");
    }
}
