// 글의 언어를 가늠한다. 글만 본다(화면 · 저장 · 요청 없음).
// 글을 한 번만 훑어 글자 종류를 세고(letterCounts), 판정들은 그 셈을 읽는다.
// 셀 때 태그 · 링크 · 변수 표시([[__VAR_0__]])는 글자로 치지 않는다: 태그 이름의 영어가 한국어 · 중국어 글을 영어로 보이게 한다.

/** 이미 한국어로 보는 한글의 몫(대문자로 시작하는 낱말을 뺀 글자 가운데) */
const KOREAN_SHARE = 0.8;
/** 일본어로 보는 가나의 몫. 낮게 잡는다: 서술은 영어이고 대사만 일본어인 답이 흔하다(그런 답의 가나는 2~30%).
 *  한두 글자 섞인 가나(중국어 글의 の · 얼굴 그림의 ノ ツ)는 0.5% 아래라 일본어로 보지 않는다. 그 사이(0.5~2%)인 답은 거의 없다. */
const JAPANESE_KANA_SHARE = 0.02;
/** 가나 없이 중국어로 보는 한자의 몫 */
const CHINESE_HAN_SHARE = 0.3;
/** 한국어로 보려면 있어야 하는 한글 수(기본) */
const KOREAN_MIN_HANGUL = 4;

const NOT_LETTERS = [/<[^<>]*>/g, /https?:\/\/\S+/g, /\[\[__VAR_\d+__\]\]/g];
const withoutMarkup = text => NOT_LETTERS.reduce((left, pattern) => left.replace(pattern, ' '), String(text ?? ''));

// 글자 하나의 종류(비트). 같은 글자를 다시 물으면 표에서 읽는다(글자마다 유니코드 식을 돌리면 옛 셈보다 느렸다)
const LETTER = 1, HANGUL = 2, KANA = 4, HAN = 8, UNKNOWN = 255;
const bmpKinds = new Uint8Array(0x10000).fill(UNKNOWN);
const astralKinds = new Map();
function classify(char) {
    return (/\p{L}/u.test(char) ? LETTER : 0)
        | (/\p{Script=Hangul}/u.test(char) ? HANGUL : 0)
        | (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(char) ? KANA : 0)
        | (/\p{Script=Han}/u.test(char) ? HAN : 0);
}
function kindOf(code) {
    if (code < 0x10000) {
        if (bmpKinds[code] === UNKNOWN) bmpKinds[code] = classify(String.fromCharCode(code));
        return bmpKinds[code];
    }
    if (!astralKinds.has(code)) astralKinds.set(code, classify(String.fromCodePoint(code)));
    return astralKinds.get(code);
}

// 라틴 글자 · 숫자와 대문자로 시작한 낱말이 이어지는 글자(낱말 속 따옴표 · 붙임표까지)를 글자 번호로
const isUpper = code => code >= 65 && code <= 90;
const isLower = code => code >= 97 && code <= 122;
const isLatin = code => isUpper(code) || isLower(code);
const isDigit = code => code >= 48 && code <= 57;
const inName = code => isLatin(code) || code === 39 || code === 0x2019 || code === 45;

/**
 * 글자 종류별 개수(태그 · 링크 · 변수 표시는 뺀 글에서).
 * @returns {{ letters: number, hangul: number, kana: number, han: number, nameLetters: number, lowerWord: boolean }}
 *   nameLetters: 대문자로 시작하는 라틴 낱말(이름)의 글자 수. lowerWord: 소문자로 시작하는 라틴 낱말이 있나
 */
export function letterCounts(text) {
    const counts = { letters: 0, hangul: 0, kana: 0, han: 0, nameLetters: 0, lowerWord: false };
    const body = withoutMarkup(text);
    let before = -1, name = false;
    for (let i = 0; i < body.length; i++) {
        const code = body.codePointAt(i);
        if (code > 0xffff) i++;
        const kind = kindOf(code);
        if (kind & LETTER) counts.letters++;
        if (kind & HANGUL) counts.hangul++;
        if (kind & KANA) counts.kana++;
        if (kind & HAN) counts.han++;
        name = (name && inName(code)) || (isUpper(code) && !isLatin(before));
        if (name && isLatin(code)) counts.nameLetters++;
        if (isLower(code) && !isLatin(before) && !isDigit(before)) counts.lowerWord = true;
        before = code;
    }
    return counts;
}

/** 옮길 글자가 하나도 없는 글인가(숫자 · 기호 · 태그뿐) */
export const hasNoLetters = (text, counts = letterCounts(text)) => counts.letters === 0;

/**
 * 이미 한국어인 글인가. 애매하면 아니라고 한다(보내는 쪽이 안전하다).
 * 한글이 글자의 80% 이상이고, 가나가 없고, 소문자로 시작하는 라틴 낱말이 없을 때만. 대문자로 시작하는 낱말(이름)은 몫을 셀 때 뺀다.
 */
export function isKorean(text, min = KOREAN_MIN_HANGUL, counts = letterCounts(text)) {
    if (counts.kana || counts.lowerWord) return false;
    return counts.hangul >= min && counts.hangul / (counts.letters - counts.nameLetters) >= KOREAN_SHARE;
}

/** 원문 언어: 'ja' | 'zh' | 'en'(가나 → 한자 차례로 몫을 본다. 그 밖은 영어) */
export function sourceLanguage(text, counts = letterCounts(text)) {
    const { letters } = counts;
    if (letters && counts.kana / letters >= JAPANESE_KANA_SHARE) return 'ja';
    if (letters && counts.han / letters >= CHINESE_HAN_SHARE) return 'zh';
    return 'en';
}
