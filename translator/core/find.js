// 글 안에서 이름 · 용어를 "낱말로" 찾는다. 글만 다룬다.

/** 견주기용으로 접는다: 소문자, 이음표 · 밑줄 · 가운뎃점 · 빈칸(점자 빈칸 포함)은 한 칸 */
export const fold = text => String(text ?? '').normalize('NFKC').replace(/⠀/g, ' ').toLowerCase().replace(/[\s\-‐‑–—_·・]+/g, ' ').trim();

/** 찾기 전에 태그 · 주석을 뺀다(속성 글자 · alt 의 이름이 걸리지 않게) */
export const plain = text => fold(String(text ?? '').replace(/<!--[\s\S]*?-->|<\/?[A-Za-z][^<>]*>/g, ' '));

/** "길드, 조합" → ['길드', '조합'] (같은 것의 여러 표기) */
export function forms(value) {
    const seen = new Set();
    return String(value ?? '').split(/[,，、]/).map(v => v.trim()).filter(v => v && !seen.has(fold(v)) && seen.add(fold(v)));
}

const latin = ch => !!ch && /[\p{Script=Latin}\p{Number}]/u.test(ch);
const hangul = ch => !!ch && /[가-힣]/.test(ch);
const kana = ch => !!ch && /[ァ-ヺー]/.test(ch);
/**
 * 접은 글(plain 을 거친 것) 안에 이 말이 낱말로 들어 있나.
 * 라틴 글자 말은 앞뒤가 글자 · 숫자가 아니어야 한다(Klein 이 Kleinstein 에 걸리지 않게).
 * strict(사람 이름): 한글은 앞에, 가나는 앞뒤에 같은 갈래 글자가 이어지면 더 긴 낱말의 일부로 본다.
 *   한자는 따지지 않는다: 띄어 쓰지 않는 글이라 이름 앞뒤가 거의 늘 한자다(따지면 이름이 든 답의 3분의 1을 놓친다).
 *   한글 뒤도 따지지 않는다: 뒤에 붙는 것은 조사 · 호칭이고, 그 갈래를 목록으로 다 적을 수 없다.
 */
export function occurs(haystack, word, { strict = false } = {}) {
    const probe = fold(word);
    if (!probe) return false;
    const first = probe[0], last = probe[probe.length - 1];
    for (let from = 0; ;) {
        const at = haystack.indexOf(probe, from);
        if (at < 0) return false;
        const before = haystack[at - 1] || '', after = haystack[at + probe.length] || '';
        const insideLatin = (latin(first) && latin(before)) || (latin(last) && latin(after));
        const insideName = strict && ((hangul(first) && hangul(before)) || (kana(first) && kana(before)) || (kana(last) && kana(after)));
        if (!insideLatin && !insideName) return true;
        from = at + 1;
    }
}

/** 접은 글 안에서 이 말이 낱말로 나온 자리들(occurs 와 같은 판정) → [[시작, 끝]…] */
export function spans(haystack, word, { strict = false } = {}) {
    const probe = fold(word), out = [];
    if (!probe) return out;
    for (let from = 0; ;) {
        const at = haystack.indexOf(probe, from);
        if (at < 0) return out;
        if (occurs(haystack.slice(Math.max(0, at - 1), at + probe.length + 1), word, { strict })) out.push([at, at + probe.length]);
        from = at + 1;
    }
}

/** 토큰 수 어림(영문 4자 · 그 밖 1.5자 = 1토큰) */
export function tokens(text) {
    const s = String(text ?? '');
    let ascii = 0;
    for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) < 128) ascii++;
    return Math.ceil(ascii / 4 + (s.length - ascii) / 1.5);
}
