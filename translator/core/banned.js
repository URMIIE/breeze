// 번역문에서 정해 둔 낱말을 다른 낱말로 바꾼다. 글만 다룬다.
// 왜: 프롬프트로 막아도 모델이 가끔 쓰는 말이 있다. 답을 받은 뒤 글에서 바로 바꾼다.
// 바꿀 낱말은 쓰는 사람이 설정에 적는다(store/word-replacements.js). 여기에는 낱말을 적어 두지 않는다.
// 받침 있는 낱말을 받침 없는 낱말로 바꾸면 바로 뒤에 붙은 조사도 맞춘다(은 → 는, 을 → 를).
// 태그 안(속성 값)은 건드리지 않는다: 화면에 글자로 나오는 글만 바꾼다.

// 받침 뒤에 붙는 조사 → 받침 없는 말 뒤의 조사. '이'는 뒤에 한글이 이어지지 않을 때만(이름의 일부일 수 있다)
const PARTICLES = [
    [/^으로/, '로'], [/^이랑/, '랑'], [/^이나/, '나'], [/^이야/, '야'], [/^이었/, '였'], [/^이에요/, '예요'], [/^이다/, '다'],
    [/^이(?![가-힣])/, '가'], [/^을/, '를'], [/^은/, '는'], [/^과/, '와'],
];

const NONE = [];
let readWords = () => NONE;

/**
 * 목록을 주지 않고 부를 때 쓸 목록을 어디서 읽을지 정한다. 부를 때마다 읽으므로 설정이 바뀌면 다음 번역부터 바로 먹는다.
 * @param {() => ({ find: string, to: string }[] | undefined)} read
 */
export function useWords(read) {
    readWords = typeof read === 'function' ? read : () => NONE;
}

/** 끝 글자가 한글일 때 받침 번호(없으면 0). 한글이 아니면 -1 */
function lastCoda(word) {
    const code = word.charCodeAt(word.length - 1) - 0xAC00;
    return code >= 0 && code <= 11171 ? code % 28 : -1;
}

const escaped = word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 목록을 한 번에 찾는 꼴로 만든다. 긴 낱말부터 견준다: 짧은 낱말의 줄이 긴 낱말 안을 먼저 바꾸면 긴 낱말의 줄이 먹지 않는다.
 * 같은 찾을 말이 두 번 있으면 앞의 줄을 쓴다.
 */
function compile(rows) {
    const to = new Map();
    for (const row of Array.isArray(rows) ? rows : NONE) {
        const find = typeof row?.find === 'string' ? row.find : '';
        if (find && !to.has(find)) to.set(find, typeof row.to === 'string' ? row.to : '');
    }
    const finds = [...to.keys()].sort((a, b) => b.length - a.length);
    return { to, find: finds.length ? new RegExp(finds.map(escaped).join('|'), 'g') : null };
}

const compiled = new WeakMap();

function ready(rows) {
    if (!Array.isArray(rows)) return compile(NONE);
    if (!compiled.has(rows)) compiled.set(rows, compile(rows));
    return compiled.get(rows);
}

/** 바꾼 자리 바로 뒤의 조사를 받침 없는 말에 맞춘 것. 맞출 조사가 없으면 null */
function particleAfter(text, at) {
    const next = text.slice(at, at + 4);
    const fit = PARTICLES.find(([from]) => from.test(next));
    return fit ? { text: fit[1], length: fit[0].exec(next)[0].length } : null;
}

/** 태그 밖 글 한 토막에서 목록의 낱말을 전부 바꾼다. 바꾼 글은 다시 견주지 않는다 */
function swap(text, { find, to }) {
    let out = '', last = 0;
    for (const hit of text.matchAll(find)) {
        const word = to.get(hit[0]);
        out += text.slice(last, hit.index) + word;
        last = hit.index + hit[0].length;
        if (lastCoda(hit[0]) <= 0 || lastCoda(word) !== 0) continue;
        const particle = particleAfter(text, last);
        if (!particle) continue;
        out += particle.text;
        last += particle.length;
    }
    return out + text.slice(last);
}

/**
 * @param {string} text 번역문
 * @param {{ find: string, to: string }[]} [rows] 바꿀 낱말들(주지 않으면 useWords 로 정한 곳에서 읽는다)
 * @returns {string} 글이 아니거나 바꿀 것이 없으면 받은 그대로
 */
export function replaceBanned(text, rows = readWords()) {
    if (typeof text !== 'string') return text;
    const words = ready(rows);
    if (!words.find || text.search(words.find) < 0) return text;
    return text.split(/(<[^>]*>)/).map((part, i) => (i % 2 ? part : swap(part, words))).join('');
}
