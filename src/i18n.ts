export type Language = "ko" | "en" | "ja";

export const LANGUAGES: { code: Language; name: string }[] = [
  { code: "ko", name: "한국어" },
  { code: "en", name: "English" },
  { code: "ja", name: "日本語" },
];

export type Texts = {
  resize: string;
  lookRange: string;
  changeSheet: string;
  language: string;
  quit: string;
  sheetFilter: string;
  size: string;
  sheetSizeError: (width: number, height: number) => string;
  sheetReadError: (reason: string) => string;
  savedSheetFallback: (reason: string) => string;
};

const TEXTS: Record<Language, Texts> = {
  ko: {
    resize: "크기 조절",
    lookRange: "시선 범위 조절",
    changeSheet: "시트 이미지 변경…",
    language: "언어",
    quit: "종료",
    sheetFilter: "스프라이트 시트",
    size: "크기",
    sheetSizeError: (width, height) =>
      `시트 크기가 맞지 않습니다. 1536×1872(9행) 또는 1536×2288(11행) 이미지가 필요하지만, 선택한 이미지는 ${width}×${height}입니다.`,
    sheetReadError: (reason) => `이미지를 열 수 없습니다. (${reason})`,
    savedSheetFallback: (reason) => `저장된 시트를 불러오지 못해 기본 시트로 시작합니다.\n${reason}`,
  },
  en: {
    resize: "Resize",
    lookRange: "Adjust Gaze Range",
    changeSheet: "Change Sheet Image…",
    language: "Language",
    quit: "Quit",
    sheetFilter: "Sprite sheet",
    size: "Size",
    sheetSizeError: (width, height) =>
      `The sheet size doesn't match. A 1536×1872 (9 rows) or 1536×2288 (11 rows) image is required, but the selected image is ${width}×${height}.`,
    sheetReadError: (reason) => `Couldn't open the image. (${reason})`,
    savedSheetFallback: (reason) => `Couldn't load the saved sheet, so the default sheet is used.\n${reason}`,
  },
  ja: {
    resize: "サイズ調整",
    lookRange: "視線範囲の調整",
    changeSheet: "シート画像を変更…",
    language: "言語",
    quit: "終了",
    sheetFilter: "スプライトシート",
    size: "サイズ",
    sheetSizeError: (width, height) =>
      `シートのサイズが合いません。1536×1872(9行)または 1536×2288(11行)の画像が必要ですが、選択した画像は ${width}×${height} です。`,
    sheetReadError: (reason) => `画像を開けませんでした。(${reason})`,
    savedSheetFallback: (reason) => `保存されたシートを読み込めなかったため、デフォルトのシートで起動します。\n${reason}`,
  },
};

export function texts(language: Language): Texts {
  return TEXTS[language];
}

export function systemLanguage(): Language {
  const prefix = navigator.language.slice(0, 2).toLowerCase();
  return LANGUAGES.find(({ code }) => code === prefix)?.code ?? "en";
}
