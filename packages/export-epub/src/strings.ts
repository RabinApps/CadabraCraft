import { primaryLanguage } from "@cadabracraft/shared";

/** Reader-visible text the exporter itself writes (not book content). */
const CONTENTS: Record<string, string> = {
  en: "Contents",
  he: "תוכן העניינים",
  ar: "المحتويات",
  it: "Indice",
  ja: "目次",
  ru: "Содержание",
  fr: "Table des matières",
  de: "Inhaltsverzeichnis",
  es: "Índice",
};

/** Heading for the navigation document. Throws for languages we have no translation for, never falls back to English. */
export function contentsHeading(language: string): string {
  const s = CONTENTS[primaryLanguage(language)];
  if (!s)
    throw new Error(
      `export-epub: no "Contents" translation for language "${language}"; add one in strings.ts`,
    );
  return s;
}

const LANDMARKS: Record<string, string> = {
  en: "Landmarks",
  he: "ציוני דרך",
  ar: "معالم",
  it: "Punti di riferimento",
  ja: "ランドマーク",
  ru: "Ориентиры",
  fr: "Repères",
  de: "Orientierungspunkte",
  es: "Puntos de referencia",
};

const START_OF_CONTENT: Record<string, string> = {
  en: "Start of content",
  he: "תחילת התוכן",
  ar: "بداية المحتوى",
  it: "Inizio del contenuto",
  ja: "本文の開始",
  ru: "Начало содержимого",
  fr: "Début du contenu",
  de: "Beginn des Inhalts",
  es: "Inicio del contenido",
};

const COVER: Record<string, string> = {
  en: "Cover",
  he: "כריכה",
  ar: "الغلاف",
  it: "Copertina",
  ja: "表紙",
  ru: "Обложка",
  fr: "Couverture",
  de: "Umschlag",
  es: "Portada",
};

const BACK_TO_TEXT: Record<string, string> = {
  en: "Back to text",
  he: "חזרה לטקסט",
  ar: "العودة إلى النص",
  it: "Torna al testo",
  ja: "本文に戻る",
  ru: "Вернуться к тексту",
  fr: "Retour au texte",
  de: "Zurück zum Text",
  es: "Volver al texto",
};

function pick(table: Record<string, string>, what: string, language: string): string {
  const s = table[primaryLanguage(language)];
  if (!s)
    throw new Error(
      `export-epub: no "${what}" translation for language "${language}"; add one in strings.ts`,
    );
  return s;
}

/** Heading of the (hidden) landmarks navigation. Throws for languages without a translation. */
export const landmarksHeading = (language: string): string =>
  pick(LANDMARKS, "Landmarks", language);

/** Label of the "start of content" landmark. Throws for languages without a translation. */
export const startOfContentLabel = (language: string): string =>
  pick(START_OF_CONTENT, "Start of content", language);

/** Label of the "cover" landmark and alt text prefix of the cover page. Throws for languages without a translation. */
export const coverLabel = (language: string): string => pick(COVER, "Cover", language);

/** Accessible name of the footnote back-link (its visible text is only an arrow). Throws for languages without a translation. */
export const backToTextLabel = (language: string): string =>
  pick(BACK_TO_TEXT, "Back to text", language);

/**
 * Sentences of the EPUB accessibility summary (schema:accessibilitySummary), one table per sentence.
 * MACHINE-DRAFTED translations (not by a native speaker): native review is a release blocker, see docs/roadmap.md.
 */
const SUMMARY_BASE: Record<string, string> = {
  en: "This publication is reflowable text with a table of contents and a linear reading order.",
  he: "פרסום זה הוא טקסט זורם עם תוכן עניינים וסדר קריאה ליניארי.",
  ar: "هذا المنشور نص قابل لإعادة التدفق مع جدول محتويات وترتيب قراءة خطي.",
  it: "Questa pubblicazione è un testo a layout riflusso con un indice e un ordine di lettura lineare.",
  ja: "この出版物はリフロー型のテキストで、目次と直線的な読み順があります。",
  ru: "Это издание представляет собой текст с изменяемой разметкой, с оглавлением и линейным порядком чтения.",
  fr: "Cette publication est un texte reflowable avec une table des matières et un ordre de lecture linéaire.",
  de: "Diese Publikation ist ein umfließender Text mit Inhaltsverzeichnis und linearer Lesereihenfolge.",
  es: "Esta publicación es un texto de formato fluido con un índice y un orden de lectura lineal.",
};

const SUMMARY_ALL_ALT: Record<string, string> = {
  en: "Every image has alternative text.",
  he: "לכל התמונות יש טקסט חלופי.",
  ar: "لكل صورة نص بديل.",
  it: "Ogni immagine ha un testo alternativo.",
  ja: "すべての画像に代替テキストがあります。",
  ru: "У каждого изображения есть альтернативный текст.",
  fr: "Chaque image a un texte alternatif.",
  de: "Jedes Bild hat einen Alternativtext.",
  es: "Cada imagen tiene texto alternativo.",
};

const SUMMARY_SOME_ALT: Record<string, string> = {
  en: "Some images have no alternative text.",
  he: "לחלק מהתמונות אין טקסט חלופי.",
  ar: "بعض الصور ليس لها نص بديل.",
  it: "Alcune immagini non hanno un testo alternativo.",
  ja: "一部の画像には代替テキストがありません。",
  ru: "У некоторых изображений нет альтернативного текста.",
  fr: "Certaines images n'ont pas de texte alternatif.",
  de: "Einige Bilder haben keinen Alternativtext.",
  es: "Algunas imágenes no tienen texto alternativo.",
};

const SUMMARY_NO_IMAGES: Record<string, string> = {
  en: "It has no images.",
  he: "אין בו תמונות.",
  ar: "لا تحتوي على صور.",
  it: "Non contiene immagini.",
  ja: "画像はありません。",
  ru: "В нём нет изображений.",
  fr: "Elle ne contient aucune image.",
  de: "Sie enthält keine Bilder.",
  es: "No contiene imágenes.",
};

const SUMMARY_UNEVALUATED: Record<string, string> = {
  en: "Its accessibility has not been formally evaluated against a standard.",
  he: "הנגישות שלו לא נבדקה באופן רשמי מול תקן.",
  ar: "لم يتم تقييم إمكانية الوصول إليها رسميًا وفق معيار.",
  it: "La sua accessibilità non è stata valutata formalmente rispetto a uno standard.",
  ja: "このアクセシビリティは、いかなる規格に対しても正式には評価されていません。",
  ru: "Его доступность не проходила формальной оценки по какому-либо стандарту.",
  fr: "Son accessibilité n'a pas fait l'objet d'une évaluation formelle selon une norme.",
  de: "Ihre Barrierefreiheit wurde nicht formal nach einem Standard bewertet.",
  es: "Su accesibilidad no se ha evaluado formalmente con respecto a ningún estándar.",
};

/** The accessibility summary in the book's language. `images` is what the book holds: none, all with alt text, or some without. Throws for languages without a translation. */
export function accessibilitySummaryText(
  language: string,
  images: "none" | "all-alt" | "some-missing-alt",
): string {
  const middle =
    images === "none"
      ? pick(SUMMARY_NO_IMAGES, "Accessibility summary", language)
      : images === "all-alt"
        ? pick(SUMMARY_ALL_ALT, "Accessibility summary", language)
        : pick(SUMMARY_SOME_ALT, "Accessibility summary", language);
  return [
    pick(SUMMARY_BASE, "Accessibility summary", language),
    middle,
    pick(SUMMARY_UNEVALUATED, "Accessibility summary", language),
  ].join(" ");
}
