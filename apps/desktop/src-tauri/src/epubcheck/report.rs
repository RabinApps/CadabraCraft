//! EPUBCheck's `--json` report as plain data for the UI. Only what the dialog shows is kept, and long messages and long lists are
//! cut so one broken book cannot flood the webview.
use serde::Serialize;
use serde_json::Value;

const MAX_MESSAGES: usize = 200;
const MAX_TEXT: usize = 400;

#[derive(Serialize, Debug, PartialEq, Clone)]
pub struct Message {
    /// `fatal`, `error`, `warning`, `info`, `usage` or `suppressed`.
    pub severity: String,
    /// EPUBCheck's message id, for example `RSC-005`.
    pub id: String,
    pub message: String,
    pub file: Option<String>,
    pub line: Option<u64>,
    pub column: Option<u64>,
}

#[derive(Serialize, Debug, PartialEq, Default)]
pub struct Counts {
    pub fatal: u64,
    pub error: u64,
    pub warning: u64,
    pub usage: u64,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Report {
    pub version: String,
    pub counts: Counts,
    pub messages: Vec<Message>,
    /// How many messages were left out of `messages` (the list is capped).
    pub omitted: usize,
}

fn cut(s: &str) -> String {
    if s.chars().count() <= MAX_TEXT {
        s.to_string()
    } else {
        s.chars().take(MAX_TEXT).collect::<String>() + "…"
    }
}

/// A line or column of -1 (or none) means "not known".
fn position(v: Option<&Value>) -> Option<u64> {
    v.and_then(Value::as_i64).filter(|n| *n > 0).map(|n| n as u64)
}

fn message(m: &Value) -> Message {
    let first = m.get("locations").and_then(Value::as_array).and_then(|l| l.first());
    Message {
        severity: m.get("severity").and_then(Value::as_str).unwrap_or("error").to_lowercase(),
        id: m.get("ID").and_then(Value::as_str).unwrap_or("").to_string(),
        message: cut(m.get("message").and_then(Value::as_str).unwrap_or("")),
        file: first.and_then(|l| l.get("path")).and_then(Value::as_str).map(str::to_string),
        line: position(first.and_then(|l| l.get("line"))),
        column: position(first.and_then(|l| l.get("column"))),
    }
}

pub fn parse_report(json: &str) -> Result<Report, String> {
    let v: Value = serde_json::from_str(json).map_err(|e| format!("the EPUBCheck report is not valid JSON: {e}"))?;
    let checker = v.get("checker").ok_or("the EPUBCheck report has no checker section")?;
    let n = |k: &str| checker.get(k).and_then(Value::as_u64).unwrap_or(0);
    let all: Vec<Message> = v.get("messages").and_then(Value::as_array).map(|a| a.iter().map(message).collect()).unwrap_or_default();
    let omitted = all.len().saturating_sub(MAX_MESSAGES);
    Ok(Report {
        version: checker.get("checkerVersion").and_then(Value::as_str).unwrap_or("").to_string(),
        counts: Counts { fatal: n("nFatal"), error: n("nError"), warning: n("nWarning"), usage: n("nUsage") },
        messages: all.into_iter().take(MAX_MESSAGES).collect(),
        omitted,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const CLEAN: &str = r#"{"messages":[],"checker":{"checkerVersion":"5.4.0","nFatal":0,"nError":0,"nWarning":0,"nUsage":0}}"#;

    #[test]
    fn a_clean_report_has_no_messages() {
        let r = parse_report(CLEAN).unwrap();
        assert_eq!(r, Report { version: "5.4.0".into(), counts: Counts::default(), messages: vec![], omitted: 0 });
    }

    #[test]
    fn messages_keep_severity_id_text_and_the_first_location() {
        let json = r#"{"messages":[
            {"ID":"RSC-005","severity":"ERROR","message":"Duplicate ID \"x\"","locations":[{"path":"OEBPS/a.xhtml","line":3,"column":466},{"path":"OEBPS/a.xhtml","line":3,"column":481}]},
            {"ID":"OPF-099","severity":"WARNING","message":"No place","locations":[{"path":"OEBPS/b.xhtml","line":-1,"column":-1}]},
            {"ID":"ACC-009","severity":"USAGE","message":"Plain","locations":[]}
          ],"checker":{"checkerVersion":"5.4.0","nFatal":0,"nError":1,"nWarning":1,"nUsage":1}}"#;
        let r = parse_report(json).unwrap();
        assert_eq!(r.counts, Counts { fatal: 0, error: 1, warning: 1, usage: 1 });
        assert_eq!(r.messages[0], Message { severity: "error".into(), id: "RSC-005".into(), message: "Duplicate ID \"x\"".into(), file: Some("OEBPS/a.xhtml".into()), line: Some(3), column: Some(466) });
        assert_eq!((r.messages[1].line, r.messages[1].column), (None, None));
        assert_eq!((r.messages[2].file.clone(), r.messages[2].severity.as_str()), (None, "usage"));
    }

    #[test]
    fn long_messages_and_long_lists_are_cut() {
        let long = "x".repeat(MAX_TEXT + 50);
        let many: Vec<String> = (0..MAX_MESSAGES + 7).map(|i| format!(r#"{{"ID":"E-{i}","severity":"INFO","message":"{long}","locations":[]}}"#)).collect();
        let json = format!(r#"{{"messages":[{}],"checker":{{"checkerVersion":"5.4.0"}}}}"#, many.join(","));
        let r = parse_report(&json).unwrap();
        assert_eq!(r.messages.len(), MAX_MESSAGES);
        assert_eq!(r.omitted, 7);
        assert_eq!(r.messages[0].message.chars().count(), MAX_TEXT + 1);
        assert!(r.messages[0].message.ends_with('…'));
    }

    #[test]
    fn a_report_that_is_not_a_report_is_an_error() {
        assert!(parse_report("not json").is_err());
        assert!(parse_report(r#"{"messages":[]}"#).is_err());
    }
}
