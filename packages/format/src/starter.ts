import {
  primaryLanguage,
  type ChapterDoc,
  type DocNode,
  type MatterKind,
} from "@cadabracraft/shared";

/** What a starter page needs to know about the book. `year` is passed in so the function stays pure. */
export interface StarterBook {
  title: string;
  author: string;
  language: string;
  isbn: string | null;
  year: number;
}

interface Words {
  titlePage: string;
  copyright: string;
  dedication: string;
  epigraph: string;
  contents: string;
  foreword: string;
  preface: string;
  acknowledgments: string;
  aboutTheAuthor: string;
  /** `{author}` is replaced by the author name. */
  alsoBy: string;
  colophon: string;
  newPage: string;
  blank: string;
  rights: string;
  /** Rights paragraph for the copyright page. Only written for languages that have one (English for now). */
  reproduction?: string;
  dedicationText: string;
}

/**
 * Text the generator writes into a new page. It is ordinary book content from then on (editable), so it follows the book's
 * language rather than the app's. Languages without an entry get English; there is no error because the author can edit it.
 */
const WORDS: Record<string, Words> = {
  en: {
    titlePage: "Title Page",
    copyright: "Copyright",
    dedication: "Dedication",
    epigraph: "Epigraph",
    contents: "Contents",
    foreword: "Foreword",
    preface: "Preface",
    acknowledgments: "Acknowledgments",
    aboutTheAuthor: "About the Author",
    alsoBy: "Also by {author}",
    colophon: "Colophon",
    newPage: "New Page",
    blank: "Blank page",
    rights: "All rights reserved.",
    reproduction:
      "No part of this book may be reproduced, stored in a retrieval system, or transmitted in any form or by any means, electronic, mechanical, photocopying, recording, or otherwise, without the prior written permission of the author, except for brief quotations in reviews.",
    dedicationText: "For …",
  },
  he: {
    titlePage: "עמוד שער",
    copyright: "זכויות יוצרים",
    dedication: "הקדשה",
    epigraph: "מוטו",
    contents: "תוכן העניינים",
    foreword: "הקדמה",
    preface: "פתח דבר",
    acknowledgments: "תודות",
    aboutTheAuthor: "על המחבר",
    alsoBy: "עוד מאת {author}",
    colophon: "קולופון",
    newPage: "עמוד חדש",
    blank: "עמוד ריק",
    rights: "כל הזכויות שמורות.",
    dedicationText: "ל…",
  },
  ar: {
    titlePage: "صفحة العنوان",
    copyright: "حقوق النشر",
    dedication: "إهداء",
    epigraph: "اقتباس افتتاحي",
    contents: "المحتويات",
    foreword: "تقديم",
    preface: "مقدمة",
    acknowledgments: "شكر وتقدير",
    aboutTheAuthor: "عن المؤلف",
    alsoBy: "مؤلفات أخرى لـ {author}",
    colophon: "بيانات الإنتاج",
    newPage: "صفحة جديدة",
    blank: "صفحة فارغة",
    rights: "جميع الحقوق محفوظة.",
    dedicationText: "إلى …",
  },
  it: {
    titlePage: "Frontespizio",
    copyright: "Copyright",
    dedication: "Dedica",
    epigraph: "Epigrafe",
    contents: "Indice",
    foreword: "Prefazione",
    preface: "Premessa",
    acknowledgments: "Ringraziamenti",
    aboutTheAuthor: "Sull’autore",
    alsoBy: "Altri libri di {author}",
    colophon: "Colophon",
    newPage: "Nuova pagina",
    blank: "Pagina bianca",
    rights: "Tutti i diritti riservati.",
    dedicationText: "A …",
  },
  ja: {
    titlePage: "扉",
    copyright: "著作権",
    dedication: "献辞",
    epigraph: "エピグラフ",
    contents: "目次",
    foreword: "序文",
    preface: "まえがき",
    acknowledgments: "謝辞",
    aboutTheAuthor: "著者紹介",
    alsoBy: "{author}の他の作品",
    colophon: "奥付",
    newPage: "新しいページ",
    blank: "空白のページ",
    rights: "無断転載を禁じます。",
    dedicationText: "…へ",
  },
  ru: {
    titlePage: "Титульный лист",
    copyright: "Авторские права",
    dedication: "Посвящение",
    epigraph: "Эпиграф",
    contents: "Содержание",
    foreword: "Предисловие",
    preface: "Вступление",
    acknowledgments: "Благодарности",
    aboutTheAuthor: "Об авторе",
    alsoBy: "Другие книги автора: {author}",
    colophon: "Выходные данные",
    newPage: "Новая страница",
    blank: "Пустая страница",
    rights: "Все права защищены.",
    dedicationText: "Для …",
  },
  fr: {
    titlePage: "Page de titre",
    copyright: "Copyright",
    dedication: "Dédicace",
    epigraph: "Épigraphe",
    contents: "Table des matières",
    foreword: "Avant-propos",
    preface: "Préface",
    acknowledgments: "Remerciements",
    aboutTheAuthor: "À propos de l’auteur",
    alsoBy: "Autres livres de {author}",
    colophon: "Colophon",
    newPage: "Nouvelle page",
    blank: "Page blanche",
    rights: "Tous droits réservés.",
    dedicationText: "À …",
  },
  de: {
    titlePage: "Titelseite",
    copyright: "Impressum",
    dedication: "Widmung",
    epigraph: "Motto",
    contents: "Inhaltsverzeichnis",
    foreword: "Vorwort",
    preface: "Einleitung",
    acknowledgments: "Danksagung",
    aboutTheAuthor: "Über den Autor",
    alsoBy: "Weitere Bücher von {author}",
    colophon: "Kolophon",
    newPage: "Neue Seite",
    blank: "Leere Seite",
    rights: "Alle Rechte vorbehalten.",
    dedicationText: "Für …",
  },
  es: {
    titlePage: "Portada",
    copyright: "Derechos de autor",
    dedication: "Dedicatoria",
    epigraph: "Epígrafe",
    contents: "Índice",
    foreword: "Prólogo",
    preface: "Prefacio",
    acknowledgments: "Agradecimientos",
    aboutTheAuthor: "Sobre el autor",
    alsoBy: "Otros libros de {author}",
    colophon: "Colofón",
    newPage: "Nueva página",
    blank: "Página en blanco",
    rights: "Todos los derechos reservados.",
    dedicationText: "Para …",
  },
};

const words = (language: string): Words => WORDS[primaryLanguage(language)] ?? WORDS.en!;
const alsoByTitle = (w: Words, author: string): string => w.alsoBy.replace("{author}", author);

/** Default page title for a new page of this kind, in the book's language. */
export function starterTitle(kind: MatterKind, language: string): string {
  const w = words(language);
  switch (kind) {
    case "title-page":
      return w.titlePage;
    case "copyright":
      return w.copyright;
    case "dedication":
      return w.dedication;
    case "epigraph":
      return w.epigraph;
    case "contents":
      return w.contents;
    case "foreword":
      return w.foreword;
    case "preface":
      return w.preface;
    case "acknowledgments":
      return w.acknowledgments;
    case "about-the-author":
      return w.aboutTheAuthor;
    case "also-by":
      return w.alsoBy.replace(/\s*\{author\}\s*/, " ").trim();
    case "colophon":
      return w.colophon;
    case "custom":
      return w.newPage;
    case "blank":
      return w.blank;
  }
}

const text = (t: string, italic = false): DocNode => ({
  type: "text",
  text: t,
  ...(italic ? { marks: [{ type: "italic" as const }] } : {}),
});
const para = (t = "", italic = false): DocNode =>
  t ? { type: "paragraph", content: [text(t, italic)] } : { type: "paragraph" };
const h1 = (t: string): DocNode => ({ type: "heading", attrs: { level: 1 }, content: [text(t)] });

/**
 * The generated starting content for a front or back matter page. Pure: a fresh document every call, v1 schema nodes only.
 * Once written to the page's file it is an ordinary chapter file that the author edits like any other.
 */
export function starterDoc(kind: MatterKind, book: StarterBook): ChapterDoc {
  const w = words(book.language);
  const content = ((): DocNode[] => {
    switch (kind) {
      case "title-page":
        return [h1(book.title), para(book.author)];
      case "copyright":
        return [
          para(`© ${book.year} ${book.author}`),
          para(w.rights),
          ...(book.isbn?.trim() ? [para(`ISBN ${book.isbn.trim()}`)] : []),
          ...(w.reproduction ? [para(w.reproduction)] : []),
        ];
      case "dedication":
        return [para(w.dedicationText, true)];
      case "epigraph":
        return [para("…", true), para("— …")];
      case "contents":
        return [h1(starterTitle(kind, book.language))];
      case "also-by":
        return [h1(alsoByTitle(w, book.author)), para()];
      case "custom":
        return [h1(w.newPage), para()];
      // A blank page holds no text at all: one empty paragraph keeps the document valid, and the PDF prints an empty page
      // for the kind whatever it holds.
      case "blank":
        return [para()];
      default:
        return [h1(starterTitle(kind, book.language)), para()];
    }
  })();
  return { type: "doc", content };
}
