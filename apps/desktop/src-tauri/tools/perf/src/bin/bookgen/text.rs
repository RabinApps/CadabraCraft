//! Deterministic text: the PRNG and the chapter documents of the generated book.
/// mulberry32, the same generator as `bigBook.ts`.
pub(crate) struct Rng(pub(crate) u32);
impl Rng {
    pub(crate) fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b79f5);
        let mut t = self.0;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        f64::from(t ^ (t >> 14)) / 4_294_967_296.0
    }
    pub(crate) fn below(&mut self, n: usize) -> usize {
        (self.next() * n as f64) as usize
    }
}

pub(crate) const WORDS: &str = "the of and to a in that he she it was for on with as his her at by from they had but not said you one all would there their what out up about who get which go me when make can like time no just him know take people into year your good some could them see other than then now look only come its over think also back after use two how our work first well way even new want because any these give day most us night door hand eyes face stood walked turned silence light rain window road house long dark quiet moment heart voice remember never always something nothing together lost found morning evening garden river stone letter shadow whisper";
pub(crate) const NAMES: [&str; 6] = ["Mara", "Idris", "Colm", "Perrin", "Odile", "Tamsin"];

pub(crate) fn esc(s: &str) -> String {
    let mut o = String::with_capacity(s.len() + 2);
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            c if (c as u32) < 0x20 => o.push_str(&format!("\\u{:04x}", c as u32)),
            c => o.push(c),
        }
    }
    o
}

pub(crate) fn sentence(r: &mut Rng, words: &[&str]) -> String {
    let n = 6 + (r.next() * 14.0) as usize;
    let mut out = String::new();
    for i in 0..n {
        let w = words[r.below(words.len())];
        if i == 0 {
            let mut cs = w.chars();
            out.extend(cs.next().unwrap().to_uppercase());
            out.push_str(cs.as_str());
        } else {
            out.push(' ');
            out.push_str(w);
        }
    }
    out.push(if r.next() < 0.15 { '?' } else { '.' });
    out
}

pub(crate) fn text_node(s: &str, mark: Option<&str>) -> String {
    match mark {
        Some(m) => format!("{{\"type\":\"text\",\"text\":\"{}\",\"marks\":[{{\"type\":\"{m}\"}}]}}", esc(s)),
        None => format!("{{\"type\":\"text\",\"text\":\"{}\"}}", esc(s)),
    }
}

pub(crate) fn count_words(s: &str) -> usize {
    s.split_whitespace().count()
}

/// One paragraph node JSON and its word count (footnote text counts like bigBook.ts: it is part of the tree).
pub(crate) fn paragraph(r: &mut Rng, words: &[&str]) -> (String, usize) {
    let mut parts: Vec<String> = vec![];
    let mut n = 0;
    if r.next() < 0.3 {
        let s = format!("\u{201c}{}\u{201d} {} said. ", sentence(r, words), NAMES[r.below(NAMES.len())]);
        n += count_words(&s);
        parts.push(text_node(&s, None));
    }
    let k = 2 + (r.next() * 4.0) as usize;
    for _ in 0..k {
        let s = format!("{} ", sentence(r, words));
        n += count_words(&s);
        if r.next() < 0.06 {
            let m = if r.next() < 0.5 { "italic" } else { "bold" };
            parts.push(text_node(&s, Some(m)));
        } else {
            parts.push(text_node(&s, None));
        }
        if r.next() < 0.01 {
            let f = sentence(r, words);
            n += count_words(&f);
            parts.push(format!("{{\"type\":\"footnote\",\"content\":[{}]}}", text_node(&f, None)));
        }
    }
    (format!("{{\"type\":\"paragraph\",\"content\":[{}]}}", parts.join(",")), n)
}

/// A chapter document of about `words` words. `images` lists the asset paths to place in it, spread evenly.
pub(crate) fn chapter_doc(words_target: usize, seed: u32, title: &str, images: &[String]) -> String {
    let words: Vec<&str> = WORDS.split(' ').collect();
    let mut r = Rng(seed);
    let mut blocks = vec![format!("{{\"type\":\"heading\",\"attrs\":{{\"level\":1}},\"content\":[{}]}}", text_node(title, None))];
    let mut n = 0;
    let mut placed = 0;
    while n < words_target {
        let x = r.next();
        if x < 0.01 {
            let s = sentence(&mut r, &words);
            blocks.push(format!("{{\"type\":\"heading\",\"attrs\":{{\"level\":2}},\"content\":[{}]}}", text_node(&s[..s.len() - 1], None)));
        } else if x < 0.03 {
            blocks.push("{\"type\":\"sceneBreak\"}".into());
        } else {
            let (p, k) = paragraph(&mut r, &words);
            blocks.push(p);
            n += k;
        }
        // Place the next image once the chapter has passed its share of words.
        if placed < images.len() && n * images.len() >= (placed + 1) * words_target {
            blocks.push(format!("{{\"type\":\"image\",\"attrs\":{{\"src\":\"{}\",\"alt\":\"Illustration {}\",\"title\":null}}}}", images[placed], placed + 1));
            placed += 1;
        }
    }
    while placed < images.len() {
        blocks.push(format!("{{\"type\":\"image\",\"attrs\":{{\"src\":\"{}\",\"alt\":\"Illustration {}\",\"title\":null}}}}", images[placed], placed + 1));
        placed += 1;
    }
    format!("{{\"type\":\"doc\",\"content\":[{}]}}\n", blocks.join(","))
}
