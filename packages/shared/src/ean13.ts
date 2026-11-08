/**
 * EAN-13 barcode modules for an ISBN-13 (X02). Pure data: the back-cover drawing turns each module into a bar, so
 * this file knows nothing about PDF or SVG. Input must be a valid ISBN-13 (see `normalizeIsbn`); anything else throws,
 * so a bad number never reaches a print file.
 *
 * The 95 modules are: a start guard (101), six left digits, a centre guard (01010), six right digits and an end
 * guard (101). `true` is a bar, `false` a space. The first digit is not drawn as a bar; it selects the left-hand
 * parity pattern (see the GS1 general specifications).
 */

const L_CODES = [
  "0001101",
  "0011001",
  "0010011",
  "0111101",
  "0100011",
  "0110001",
  "0101111",
  "0111011",
  "0110111",
  "0001011",
];
const G_CODES = [
  "0100111",
  "0110011",
  "0011011",
  "0100001",
  "0011101",
  "0111001",
  "0000101",
  "0010001",
  "0001001",
  "0010111",
];
const R_CODES = [
  "1110010",
  "1100110",
  "1101100",
  "1000010",
  "1011100",
  "1001110",
  "1010000",
  "1000100",
  "1001000",
  "1110100",
];

/** For each first digit, which of the six left-hand digits use G (the rest use L). */
const LEFT_PARITY = [
  "LLLLLL",
  "LLGLGG",
  "LLGGLG",
  "LLGGGL",
  "LGLLGG",
  "LGGLLG",
  "LGGGLL",
  "LGLGLG",
  "LGLGGL",
  "LGGLGL",
] as const;

/** GS1 check digit for the first twelve digits of an EAN-13. */
export function ean13CheckDigit(twelve: string): string {
  if (!/^\d{12}$/.test(twelve)) throw new Error("ean13CheckDigit needs exactly 12 digits");
  const sum = [...twelve].reduce((acc, ch, i) => acc + Number(ch) * (i % 2 === 0 ? 1 : 3), 0);
  return String((10 - (sum % 10)) % 10);
}

/** The 95 modules of an ISBN-13 (no hyphens). `true` is a bar. Throws when the check digit or shape is wrong. */
export function ean13Modules(isbn13: string): boolean[] {
  if (!/^\d{13}$/.test(isbn13)) throw new Error("ean13Modules needs exactly 13 digits");
  if (ean13CheckDigit(isbn13.slice(0, 12)) !== isbn13[12])
    throw new Error("ean13Modules: wrong check digit");

  const first = Number(isbn13[0]);
  // The regex above guarantees a digit, so the table always has this row.
  const parity = LEFT_PARITY[first] as string;
  const digits = [...isbn13.slice(1, 7)].map(Number);
  const right = [...isbn13.slice(7, 13)].map(Number);

  let pattern = "101";
  digits.forEach((d, i) => {
    pattern += parity[i] === "G" ? G_CODES[d] : L_CODES[d];
  });
  pattern += "01010";
  for (const d of right) pattern += R_CODES[d];
  pattern += "101";

  return [...pattern].map((c) => c === "1");
}
