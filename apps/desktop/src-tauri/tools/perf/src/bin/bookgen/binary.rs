//! Checksums, PNG, a minimal zip writer and a tiny deflate encoder (just enough for a high-ratio bomb).
use std::io::Write;
use crate::text::*;

// ---------------------------------------------------------------- checksums, PNG, zip

pub(crate) fn crc_table() -> [u32; 256] {
    let mut t = [0u32; 256];
    for (i, slot) in t.iter_mut().enumerate() {
        let mut c = i as u32;
        for _ in 0..8 {
            c = if c & 1 != 0 { 0xedb88320 ^ (c >> 1) } else { c >> 1 };
        }
        *slot = c;
    }
    t
}

pub(crate) struct Crc {
    pub(crate) table: [u32; 256],
    pub(crate) state: u32,
}
impl Crc {
    pub(crate) fn new() -> Crc {
        Crc { table: crc_table(), state: 0xffff_ffff }
    }
    pub(crate) fn update(&mut self, b: &[u8]) {
        for &x in b {
            self.state = self.table[((self.state ^ u32::from(x)) & 0xff) as usize] ^ (self.state >> 8);
        }
    }
    pub(crate) fn finish(&self) -> u32 {
        !self.state
    }
}

pub(crate) fn crc32(b: &[u8]) -> u32 {
    let mut c = Crc::new();
    c.update(b);
    c.finish()
}

pub(crate) fn adler32(b: &[u8]) -> u32 {
    let (mut a, mut s) = (1u32, 0u32);
    for &x in b {
        a = (a + u32::from(x)) % 65521;
        s = (s + a) % 65521;
    }
    (s << 16) | a
}

pub(crate) fn png_chunk(out: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    out.extend((data.len() as u32).to_be_bytes());
    let mut body = kind.to_vec();
    body.extend(data);
    out.extend(&body);
    out.extend(crc32(&body).to_be_bytes());
}

/// A valid 8-bit grayscale PNG of about `kb` KiB (noise, stored deflate blocks, so it does not compress).
pub(crate) fn png(kb: usize, rng: &mut Rng) -> Vec<u8> {
    let w = 256usize;
    let h = (kb * 1024 / (w + 1)).max(1);
    let mut raw = Vec::with_capacity(h * (w + 1));
    for _ in 0..h {
        raw.push(0);
        for _ in 0..w {
            raw.push((rng.next() * 256.0) as u8);
        }
    }
    let mut z = vec![0x78, 0x01];
    let mut chunks = raw.chunks(65535).peekable();
    while let Some(c) = chunks.next() {
        z.push(u8::from(chunks.peek().is_none()));
        z.extend((c.len() as u16).to_le_bytes());
        z.extend((!(c.len() as u16)).to_le_bytes());
        z.extend(c);
    }
    z.extend(adler32(&raw).to_be_bytes());
    let mut ihdr = vec![];
    ihdr.extend((w as u32).to_be_bytes());
    ihdr.extend((h as u32).to_be_bytes());
    ihdr.extend([8, 0, 0, 0, 0]);
    let mut out = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    png_chunk(&mut out, b"IHDR", &ihdr);
    png_chunk(&mut out, b"IDAT", &z);
    png_chunk(&mut out, b"IEND", &[]);
    out
}

pub(crate) struct Entry {
    pub(crate) name: String,
    pub(crate) method: u16,
    pub(crate) crc: u32,
    pub(crate) csize: u64,
    pub(crate) usize: u64,
    pub(crate) offset: u64,
}

/// A small streaming zip writer (no zip64, so every entry and the archive stay under 4 GiB).
pub(crate) struct Zip<W: Write> {
    pub(crate) w: W,
    pub(crate) at: u64,
    pub(crate) entries: Vec<Entry>,
}
impl<W: Write> Zip<W> {
    pub(crate) fn new(w: W) -> Zip<W> {
        Zip { w, at: 0, entries: vec![] }
    }
    pub(crate) fn put(&mut self, b: &[u8]) {
        self.w.write_all(b).unwrap();
        self.at += b.len() as u64;
    }
    /// A local header with the known sizes, then the bytes `data` writes (exactly `csize` of them).
    pub(crate) fn entry(&mut self, name: &str, method: u16, crc: u32, csize: u64, usize: u64, data: &mut dyn FnMut(&mut dyn FnMut(&[u8]))) {
        let offset = self.at;
        let mut h = vec![];
        h.extend(0x04034b50u32.to_le_bytes());
        h.extend([20, 0, 0, 0]);
        h.extend(method.to_le_bytes());
        h.extend([0, 0, 0x21, 0]); // time 0, date 1980-01-01
        h.extend(crc.to_le_bytes());
        h.extend((csize as u32).to_le_bytes());
        h.extend((usize as u32).to_le_bytes());
        h.extend((name.len() as u16).to_le_bytes());
        h.extend([0, 0]);
        h.extend(name.as_bytes());
        self.put(&h);
        let before = self.at;
        data(&mut |b| self.put(b));
        assert_eq!(self.at - before, csize, "entry {name} wrote the wrong number of bytes");
        self.entries.push(Entry { name: name.into(), method, crc, csize, usize, offset });
    }
    pub(crate) fn stored(&mut self, name: &str, bytes: &[u8]) {
        self.entry(name, 0, crc32(bytes), bytes.len() as u64, bytes.len() as u64, &mut |put| put(bytes));
    }
    pub(crate) fn finish(mut self) {
        let start = self.at;
        let mut cd = vec![];
        for e in &self.entries {
            cd.extend(0x02014b50u32.to_le_bytes());
            cd.extend([20, 0, 20, 0, 0, 0]);
            cd.extend(e.method.to_le_bytes());
            cd.extend([0, 0, 0x21, 0]);
            cd.extend(e.crc.to_le_bytes());
            cd.extend((e.csize as u32).to_le_bytes());
            cd.extend((e.usize as u32).to_le_bytes());
            cd.extend((e.name.len() as u16).to_le_bytes());
            cd.extend([0u8; 12]);
            cd.extend((e.offset as u32).to_le_bytes());
            cd.extend(e.name.as_bytes());
        }
        let count = self.entries.len() as u16;
        self.put(&cd);
        let mut end = vec![];
        end.extend(0x06054b50u32.to_le_bytes());
        end.extend([0, 0, 0, 0]);
        end.extend(count.to_le_bytes());
        end.extend(count.to_le_bytes());
        end.extend((cd.len() as u32).to_le_bytes());
        end.extend((start as u32).to_le_bytes());
        end.extend([0, 0]);
        self.put(&end);
        self.w.flush().unwrap();
    }
}

// ---------------------------------------------------------------- deflate (just enough for a high-ratio bomb)

/// LSB-first bit packer for a deflate stream with one fixed-Huffman block.
pub(crate) struct Bits {
    pub(crate) out: Vec<u8>,
    pub(crate) acc: u32,
    pub(crate) n: u32,
}
impl Bits {
    pub(crate) fn bits(&mut self, v: u32, n: u32) {
        self.acc |= v << self.n;
        self.n += n;
        while self.n >= 8 {
            self.out.push(self.acc as u8);
            self.acc >>= 8;
            self.n -= 8;
        }
    }
    /// Huffman codes are packed most significant bit first.
    pub(crate) fn code(&mut self, code: u32, n: u32) {
        let mut r = 0;
        for i in 0..n {
            r |= ((code >> i) & 1) << (n - 1 - i);
        }
        self.bits(r, n);
    }
    pub(crate) fn literal(&mut self, b: u8) {
        if b < 144 {
            self.code(0x30 + u32::from(b), 8);
        } else {
            self.code(0x190 + u32::from(b) - 144, 9);
        }
    }
    /// A match of length 258 (symbol 285) at distance 1.
    pub(crate) fn run258(&mut self) {
        self.code(0xc0 + (285 - 280), 8);
        self.code(0, 5);
    }
    pub(crate) fn finish(mut self) -> Vec<u8> {
        self.code(0, 7); // end of block (symbol 256)
        if self.n > 0 {
            self.out.push(self.acc as u8);
        }
        self.out
    }
}

/// A deflate stream for `prefix`, then `1 + 258 * runs` spaces, then `suffix`. About 13 bits per 258 bytes (160:1).
pub(crate) fn deflate_spaces(prefix: &[u8], runs: u64, suffix: &[u8]) -> Vec<u8> {
    let mut b = Bits { out: vec![], acc: 0, n: 0 };
    b.bits(1, 1); // last block
    b.bits(1, 2); // fixed Huffman
    for &x in prefix {
        b.literal(x);
    }
    b.literal(b' ');
    for _ in 0..runs {
        b.run258();
    }
    for &x in suffix {
        b.literal(x);
    }
    b.finish()
}
