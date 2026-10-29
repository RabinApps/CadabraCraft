//! Text helpers. The first half reproduces the JavaScript string and number semantics the TypeScript importer relies on
//! (`\s`, `trim`, `Number()`, `Math.min/max/round`, `slice` in UTF-16 units), because the two importers must agree on
//! odd input. The second half is `common/text.ts`: control-character cleaning, mark ordering and inline merging.
use super::node::{Item, Mark, Node};

/// The characters JavaScript's `\s` and `String.prototype.trim` treat as white space (not the same set as `char::is_whitespace`).
pub fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}'
    ) || ('\u{2000}'..='\u{200a}').contains(&c)
}

pub fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_space)
}

/// `s.replace(/\s+/g, " ")`.
pub fn collapse_ws(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_ws = false;
    for c in s.chars() {
        if is_js_space(c) {
            if !in_ws {
                out.push(' ');
            }
            in_ws = true;
        } else {
            in_ws = false;
            out.push(c);
        }
    }
    out
}

/// `s.slice(0, n)` with `n` in UTF-16 units. A cut through the middle of a surrogate pair drops the whole character
/// (JavaScript would keep a lone surrogate, which a Rust string cannot hold).
pub fn slice_utf16(s: &str, n: usize) -> String {
    let mut used = 0;
    let mut out = String::new();
    for c in s.chars() {
        used += c.len_utf16();
        if used > n {
            break;
        }
        out.push(c);
    }
    out
}

/// JavaScript `Number(string)`: white space trimmed, `""` is 0, `Infinity`, `0x`/`0o`/`0b` literals, decimal literals
/// with an optional exponent, anything else NaN.
pub fn js_number(s: &str) -> f64 {
    let t = js_trim(s);
    if t.is_empty() {
        return 0.0;
    }
    match t {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    let radix = |p: &str, r: u32| -> Option<f64> {
        let digits = t.strip_prefix(p)?;
        if digits.is_empty() {
            return Some(f64::NAN);
        }
        let mut v = 0f64;
        for c in digits.chars() {
            match c.to_digit(r) {
                Some(d) => v = v * f64::from(r) + f64::from(d),
                None => return Some(f64::NAN),
            }
        }
        Some(v)
    };
    for (lower, upper, r) in [("0x", "0X", 16), ("0o", "0O", 8), ("0b", "0B", 2)] {
        if let Some(v) = radix(lower, r).or_else(|| radix(upper, r)) {
            return v;
        }
    }
    if is_decimal_literal(t) {
        t.parse().unwrap_or(f64::NAN)
    } else {
        f64::NAN
    }
}

/// `[+-]? (digits [. digits?] | . digits) ([eE] [+-]? digits)?`, the grammar of a JavaScript decimal string.
fn is_decimal_literal(t: &str) -> bool {
    let b = t.as_bytes();
    let mut i = 0;
    if matches!(b.first(), Some(b'+' | b'-')) {
        i += 1;
    }
    let digits = |i: &mut usize| {
        let start = *i;
        while *i < b.len() && b[*i].is_ascii_digit() {
            *i += 1;
        }
        *i - start
    };
    let int = digits(&mut i);
    let mut frac = 0;
    if i < b.len() && b[i] == b'.' {
        i += 1;
        frac = digits(&mut i);
    }
    if int == 0 && frac == 0 {
        return false;
    }
    if i < b.len() && matches!(b[i], b'e' | b'E') {
        i += 1;
        if matches!(b.get(i), Some(b'+' | b'-')) {
            i += 1;
        }
        if digits(&mut i) == 0 {
            return false;
        }
    }
    i == b.len()
}

/// `Math.min`: NaN if either side is NaN (Rust's `f64::min` would return the other side).
pub fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.min(b)
    }
}

pub fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.max(b)
    }
}

/// `Math.round`: halves round toward +Infinity (Rust's `f64::round` rounds them away from zero).
pub fn js_round(x: f64) -> f64 {
    let r = x.floor();
    if x - r >= 0.5 {
        r + 1.0
    } else {
        r
    }
}

/// A `Map<number, _>` key: NaN equals NaN and -0 equals 0 (SameValueZero).
pub fn level_key(x: f64) -> u64 {
    if x.is_nan() {
        u64::MAX
    } else if x == 0.0 {
        0.0f64.to_bits()
    } else {
        x.to_bits()
    }
}

/// Characters XML 1.0 and UTF-8 files cannot carry, as `cleanText` removes them: C0 controls other than tab, line feed and
/// carriage return... exactly the set `[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]`. (Lone surrogates cannot occur in a Rust string.)
fn is_bad_char(c: char) -> bool {
    matches!(c, '\u{0}'..='\u{8}' | '\u{b}' | '\u{c}' | '\u{e}'..='\u{1f}' | '\u{fffe}' | '\u{ffff}')
}

pub fn clean_text(text: &str) -> String {
    if text.chars().any(is_bad_char) {
        text.chars().filter(|c| !is_bad_char(*c)).collect()
    } else {
        text.to_string()
    }
}

/// Marks in the editor schema's rank order (ProseMirror requires sorted mark sets).
const MARK_ORDER: [&str; 8] = ["link", "bold", "italic", "strike", "underline", "smallCaps", "superscript", "subscript"];

fn rank(m: &Mark) -> usize {
    MARK_ORDER.iter().position(|t| *t == m.ty).unwrap_or(MARK_ORDER.len())
}

/// De-duplicated (first of each type wins) and ordered marks; `None` when there are none. Super- and subscript exclude
/// each other in the schema: the one added last wins. (The inline `code` mark never comes from a Word file, so its
/// "excludes everything" rule is not needed here.)
pub fn sort_marks(marks: &[Mark]) -> Option<Vec<Mark>> {
    let mut out: Vec<Mark> = Vec::new();
    for m in marks {
        if !out.iter().any(|o| o.ty == m.ty) {
            out.push(m.clone());
        }
    }
    if out.is_empty() {
        return None;
    }
    if let Some(script) = marks.iter().rev().find(|m| m.ty == "superscript" || m.ty == "subscript") {
        out.retain(|m| !(matches!(m.ty, "superscript" | "subscript") && m.ty != script.ty));
    }
    out.sort_by_key(rank);
    Some(out)
}

pub fn text_node(raw: &str, marks: &[Mark]) -> Option<Node> {
    let text = clean_text(raw);
    if text.is_empty() {
        return None;
    }
    Some(Node { text: Some(text), marks: sort_marks(marks), ..Node::new("text") })
}

/// Merges adjacent text nodes with identical marks and drops empty ones.
pub fn merge_inline(nodes: Vec<Node>) -> Vec<Node> {
    let mut out: Vec<Node> = Vec::new();
    for n in nodes {
        if n.is("text") {
            if n.text.as_deref() == Some("") {
                continue;
            }
            if let Some(prev) = out.last_mut() {
                if prev.is("text") && prev.marks == n.marks {
                    if let (Some(p), Some(t)) = (prev.text.as_mut(), n.text.as_deref()) {
                        p.push_str(t);
                    }
                    continue;
                }
            }
        }
        out.push(n);
    }
    out
}

/// The text of inline content, ignoring footnotes (their text belongs to the note).
pub fn plain_text(nodes: &[Node]) -> String {
    let mut s = String::new();
    for n in nodes {
        if n.is("text") {
            s.push_str(n.text.as_deref().unwrap_or(""));
        } else if !n.is("footnote") {
            s.push_str(&plain_text(n.children()));
        }
    }
    s
}

/// Items as one run of inline nodes: a line break becomes a space, lifted blocks are dropped; adjacent text is merged.
pub fn flatten_items(items: &[Item]) -> Vec<Node> {
    let mut nodes = Vec::new();
    for i in items {
        match i {
            Item::Node(n) => nodes.push(n.clone()),
            Item::Break => nodes.push(Node::plain_text(" ")),
            Item::Block(_) => {}
        }
    }
    merge_inline(nodes)
}

pub fn paragraph_of(content: Vec<Node>) -> Node {
    let c = merge_inline(content);
    if c.is_empty() {
        Node::paragraph()
    } else {
        Node::with("paragraph", c)
    }
}

/// `/^(\*(\s*\*){2,}|#)$/`: three or more asterisks (white space allowed between), or a single `#`.
pub fn is_scene_break_text(s: &str) -> bool {
    if s == "#" {
        return true;
    }
    let stars = s.chars().filter(|c| *c == '*').count();
    s.starts_with('*') && s.ends_with('*') && stars >= 3 && s.chars().all(|c| c == '*' || is_js_space(c))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn js_whitespace_is_not_rust_whitespace() {
        assert!(is_js_space('\u{feff}') && is_js_space('\u{a0}') && is_js_space('\u{2003}'));
        assert!(!is_js_space('\u{85}') && !is_js_space('a'));
        assert_eq!(js_trim("\u{feff} a b \u{a0}"), "a b");
        assert_eq!(collapse_ws(" a \n\t b\u{a0}\u{a0}c "), " a b c ");
    }

    #[test]
    fn slices_in_utf16_units_without_splitting_a_pair() {
        assert_eq!(slice_utf16("abcdef", 3), "abc");
        assert_eq!(slice_utf16("ab", 10), "ab");
        assert_eq!(slice_utf16("a\u{1F600}b", 2), "a"); // the emoji is two units: 1 + 2 > 2
        assert_eq!(slice_utf16("a\u{1F600}b", 3), "a\u{1F600}");
    }

    #[test]
    fn number_follows_javascript() {
        let n = js_number;
        assert_eq!(n(""), 0.0);
        assert_eq!(n("  "), 0.0);
        assert_eq!(n(" 12 "), 12.0);
        assert_eq!(n("-3.5"), -3.5);
        assert_eq!(n("+.5"), 0.5);
        assert_eq!(n("5."), 5.0);
        assert_eq!(n("1e2"), 100.0);
        assert_eq!(n("1E-2"), 0.01);
        assert_eq!(n("0x1F"), 31.0);
        assert_eq!(n("0X10"), 16.0);
        assert_eq!(n("0o17"), 15.0);
        assert_eq!(n("0b101"), 5.0);
        assert_eq!(n("Infinity"), f64::INFINITY);
        assert_eq!(n("+Infinity"), f64::INFINITY);
        assert_eq!(n("-Infinity"), f64::NEG_INFINITY);
        for bad in ["abc", "1x", "1e", "e5", ".", "+", "-", "0x", "0xg", "0b2", "0o8", "inf", "NaN", "infinity", "1 2", "--1", "1_000", "0x-1"] {
            assert!(n(bad).is_nan(), "{bad}");
        }
    }

    #[test]
    fn math_helpers_follow_javascript() {
        assert!(js_min(f64::NAN, 1.0).is_nan() && js_min(1.0, f64::NAN).is_nan());
        assert_eq!(js_min(1.0, 2.0), 1.0);
        assert!(js_max(f64::NAN, 1.0).is_nan() && js_max(1.0, f64::NAN).is_nan());
        assert_eq!(js_max(1.0, 2.0), 2.0);
        assert_eq!(js_round(2.5), 3.0);
        assert_eq!(js_round(-1.5), -1.0);
        assert_eq!(js_round(-0.4), 0.0);
        assert_eq!(js_round(1.4), 1.0);
        assert_eq!(level_key(f64::NAN), level_key(f64::NAN));
        assert_eq!(level_key(-0.0), level_key(0.0));
        assert_ne!(level_key(1.0), level_key(2.0));
    }

    #[test]
    fn cleans_control_characters() {
        assert_eq!(clean_text("a\u{0}b\u{c}c\td\ne\rf\u{fffe}\u{ffff}g"), "abc\td\ne\rfg");
        assert_eq!(clean_text("plain"), "plain");
        assert!(text_node("\u{0}\u{1}", &[]).is_none());
    }

    #[test]
    fn marks_are_deduplicated_ordered_and_exclusive() {
        let m = |t| Mark::of(t);
        assert_eq!(sort_marks(&[]), None);
        let s = sort_marks(&[m("underline"), m("bold"), Mark::link("https://a/".into()), m("bold"), m("italic")]).unwrap();
        assert_eq!(s.iter().map(|x| x.ty).collect::<Vec<_>>(), ["link", "bold", "italic", "underline"]);
        let s = sort_marks(&[m("superscript"), m("subscript")]).unwrap();
        assert_eq!(s, [m("subscript")], "the last script mark wins");
        let s = sort_marks(&[m("subscript"), m("bold"), m("superscript")]).unwrap();
        assert_eq!(s.iter().map(|x| x.ty).collect::<Vec<_>>(), ["bold", "superscript"]);
        assert_eq!(sort_marks(&[m("weird"), m("bold")]).unwrap()[0].ty, "bold");
    }

    #[test]
    fn merges_text_with_equal_marks_only() {
        let t = |s: &str, marks: &[Mark]| text_node(s, marks).unwrap();
        let b = [Mark::of("bold")];
        let merged = merge_inline(vec![t("a", &b), t("b", &b), t("c", &[]), Node::plain_text(""), t("d", &[]), Node::new("footnote"), t("e", &[])]);
        let texts: Vec<_> = merged.iter().map(|n| n.text.clone().unwrap_or_else(|| n.ty.to_string())).collect();
        assert_eq!(texts, ["ab", "cd", "footnote", "e"]);
    }

    #[test]
    fn plain_text_skips_footnotes_and_flatten_turns_breaks_into_spaces() {
        let foot = Node::with("footnote", vec![Node::plain_text("note")]);
        let p = Node::with("paragraph", vec![Node::plain_text("in "), foot.clone()]);
        assert_eq!(plain_text(&[Node::plain_text("a"), foot.clone(), p]), "ain ");
        let items = [Item::Node(Node::plain_text("a")), Item::Break, Item::Node(Node::plain_text("b")), Item::Block(Node::new("image"))];
        assert_eq!(flatten_items(&items), [Node::plain_text("a b")]);
        assert_eq!(paragraph_of(vec![]), Node::paragraph());
        assert_eq!(paragraph_of(vec![Node::plain_text("x")]).children().len(), 1);
    }

    #[test]
    fn scene_break_text() {
        for yes in ["***", "* * *", "*  *\n*", "#", "****"] {
            assert!(is_scene_break_text(yes), "{yes}");
        }
        for no in ["**", "* *", "##", "# ", "***a", "a***", "*-*-*", "", "# #"] {
            assert!(!is_scene_break_text(no), "{no}");
        }
    }
}
