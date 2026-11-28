// 메시지 본문에서 이야기 문단 요소를 찾고, 넘겨받은 번역 문단과 짝지어 그 문단의 원문을 고른다. 보기 방식(view.js)이 쓴다.
// 화면 요소를 다루는 함수(proseIn, wrapLoose, ownText)와 글만 다루는 함수(alignTo, originalFor, isDialogue, lightHtml)가 같이 있다.
// 글만 다루는 쪽은 브라우저 없이 시험한다.

export const lettersOf = text => String(text ?? '').replace(/[^\p{L}\p{N}]/gu, '');

const PROSE = 'p, span.btr-view-para, li, blockquote, h1, h2, h3, h4, h5, h6';
const OURS = '.btr-view-box, .btr-view-acts';
const PARA = 'btr-view-para';
/** 이야기 문단으로 보지 않는 곳: 코드, 접기 제목, 스크립트로 그린 틀 */
export const SKIP = 'pre, code, summary, iframe, .TH-render';

// 메시지 글의 HTML 이 들고 온 클래스에는 실리태번이 custom- 을 붙인다: 이 클래스가 있으면 정규식이나 카드가 그린 틀이다
const drawn = node => [...(node.classList || [])].some(name => name.startsWith('custom-'));

/**
 * 틀 안의 요소가 이야기 문단인가: 본문을 통째로 감싼 틀(접기 칸 안에 이야기 문단들)이면 그 안의 문단은 본문이다.
 * 클래스 없는 문단이 그 틀 바로 아래에 둘 이상일 때만(상태창의 값 한 줄을 문단으로 세지 않게)
 */
const wrapsBody = (frame, el) => el.classList.contains(PARA) || (!el.getAttribute('class') && frame.querySelectorAll(':scope > p:not([class])').length >= 2);

function isProse(el, body, skip) {
    let inBody = false;
    for (let node = el; node && node !== body; node = node.parentElement) {
        if (node.matches(skip)) return false;
        if (inBody || !drawn(node)) continue;
        if (node === el || !wrapsBody(node, el)) return false;
        inBody = true;   // 본문을 감싼 틀을 지났으면 그 바깥 틀도 지난다
    }
    return true;
}

/**
 * 본문의 이야기 문단 요소들(문단, 목록 항목, 인용, 제목). 안쪽 것만 센다:
 * 느슨한 목록과 인용은 항목 안에 문단이 또 있어서, 바깥과 안쪽을 둘 다 세면 원문 칸이 두 개 붙는다.
 */
export function proseIn(body, skip = SKIP) {
    const all = [...body.querySelectorAll(PROSE)].filter(el => !el.closest(OURS) && isProse(el, body, skip));
    const found = new Set(all);
    return all.filter(el => ![...el.querySelectorAll(PROSE)].some(inner => found.has(inner)));
}

/** 누른 곳이 든 가장 안쪽 문단 요소 */
export const proseOf = target => target.closest(PROSE);

/**
 * 문단 요소의 제 글자. 안에 든 작은 목록과 우리가 붙인 칸의 글은 뺀다
 * (목록 전체가 빈 줄 없이 한 문단이라, 작은 목록까지 세면 항목마다 문단 전체의 원문이 붙는다).
 */
export function ownText(el) {
    const extra = el.tagName === 'LI' ? `ul, ol, ${OURS}` : OURS;
    if (!el.querySelector(extra)) return el.textContent || '';
    const copy = el.cloneNode(true);
    copy.querySelectorAll(extra).forEach(node => node.remove());
    return copy.textContent || '';
}

const GAP = /(\n[ \t]*\n\s*)/;
const STOP = /^(DIV|P|DETAILS|SUMMARY|TABLE|UL|OL|BLOCKQUOTE|PRE|H[1-6]|HR|SECTION|ARTICLE|FIGURE|IFRAME|STYLE|SCRIPT)$/;
const looseText = box => [...box.childNodes].some(node => node.nodeType === 3 && GAP.test(node.nodeValue));

/** 글자 마디를 빈 줄에서 끊어 조각마다 새 마디로. 빈 줄 마디는 묶음 밖에 둔다 */
function cutText(node, run, flush) {
    const parts = node.nodeValue.split(GAP);
    if (parts.length === 1) { run.push(node); return; }
    parts.forEach((part, i) => {
        if (part) {
            const piece = document.createTextNode(part);
            node.before(piece);
            if (i % 2 === 0) run.push(piece);
        }
        if (i % 2) flush();
    });
    node.remove();
}

function wrapRuns(box, skip) {
    const run = [];
    const flush = () => {
        if (run.some(node => (node.textContent || '').trim())) {
            const span = document.createElement('span');
            span.className = PARA;
            run[0].before(span);
            span.append(...run);
        }
        run.length = 0;
    };
    for (const node of [...box.childNodes]) {
        if (node.nodeType === 3) cutText(node, run, flush);
        else if (node.nodeType === 1 && (STOP.test(node.tagName) || node.matches(skip))) flush();
        else run.push(node);
    }
    flush();
}

/**
 * 본문을 감싼 틀 안에 이야기가 문단 요소 없이 빈 줄로만 나뉜 글자 덩어리로 들어 있으면, 빈 줄마다 끊어 문단 하나씩 span 으로 감싼다.
 * 모양은 그대로이고, 누르기와 원문 칸이 문단 요소처럼 된다. 한 번 본 틀은 다시 건드리지 않는다
 * (감쌀 것이 없어도 마디를 갈아 끼우면 부를 때마다 화면이 바뀌어, 바뀜을 지켜보는 쪽이 다시 부른다).
 */
export function wrapLoose(body, skip = SKIP) {
    for (const box of body.querySelectorAll('[class*="custom-"]')) {
        if (box.dataset.btrSplit || box.closest(`${skip}, ${OURS}`) || !looseText(box)) continue;
        box.dataset.btrSplit = '1';
        wrapRuns(box, skip);
    }
}

/** 앞부분이 겹치는 번역 문단 가운데 길이가 가장 비슷한 것. 짧은 대사가 그 말이 든 긴 문단에 먼저 걸리지 않게 */
function nearest(keys, shown, from) {
    let best = -1, score = 0;
    keys.forEach((key, i) => {
        if (!key || !(key.includes(shown.slice(0, 40)) || shown.includes(key.slice(0, 40)))) return;
        const fit = Math.min(key.length, shown.length) / Math.max(key.length, shown.length) + (i >= from ? 0.001 : 0);
        if (fit > score) { best = i; score = fit; }
    });
    return best;
}

/**
 * 화면 문단들을 번역 문단에 맞춘다: 글자가 똑같은 것 먼저, 없으면 앞 40자가 겹치는 것.
 * 화면 차례대로 앞에서부터 찾는다(같은 글의 문단이 두 번 나오면 둘째 화면 문단은 둘째 번역 문단에).
 * @param {string[]} texts 화면 문단의 글
 * @param {string[]} paragraphs 번역 문단의 글
 * @returns {number[]} 화면 문단마다 번역 문단 번호(못 찾으면 -1)
 */
export function alignTo(texts, paragraphs) {
    const keys = paragraphs.map(lettersOf);
    let from = 0;
    return texts.map(text => {
        const shown = lettersOf(text);
        if (!shown) return -1;
        let at = keys.indexOf(shown, from);
        if (at < 0) at = keys.indexOf(shown);
        if (at >= 0) { from = at + 1; return at; }
        // 한 번역 문단이 화면에서 여러 요소로 그려지기도 한다(목록 항목들): 다음 요소도 같은 문단에서 찾을 수 있게 그 자리에 머문다
        at = nearest(keys, shown, from);
        if (at >= 0) from = at;
        return at;
    });
}

const LIST_MARK = /^\s*(?:[*+-]|\d+[.)])\s+/;
// 줄 머리의 목록 표시(3. )는 빼고 견준다: 화면 항목의 글에는 번호가 없다
const lineKey = line => lettersOf(String(line).replace(LIST_MARK, ''));
const filled = text => String(text).split('\n').filter(line => line.trim());

/** 한 문단이 여러 줄(목록 항목들)이면 그 항목과 같은 차례의 원문 줄만. 줄 수가 같을 때만 */
function itemLines(source, translation, own) {
    const tr = filled(translation), src = filled(source), mine = lettersOf(own);
    if (tr.length < 2 || tr.length !== src.length || !mine) return null;
    let at = tr.findIndex(line => lineKey(line) === mine);
    if (at < 0) at = tr.findIndex(line => { const key = lineKey(line); return key && (key.includes(mine.slice(0, 30)) || mine.includes(key.slice(0, 30))); });
    if (at < 0) return null;
    // 항목이 여러 줄이면(제목 줄 + 들여 쓴 다음 줄) 다음 항목이 시작되기 전까지의 줄도 같이
    let end = at + 1;
    while (end < src.length && !LIST_MARK.test(src[end]) && !LIST_MARK.test(tr[end])) end++;
    return src.slice(at, end).map((line, i) => (i ? line.trim() : line.replace(LIST_MARK, ''))).join('\n');
}

/** 빈 줄 없이 붙은 줄 가운데 화면에서는 다른 요소로 그려진 줄을 뺀 원문. 줄 수가 같고 빠지는 줄이 있을 때만 */
function shownLines(source, translation, own) {
    const src = String(source).split('\n'), tr = String(translation).split('\n'), mine = lettersOf(own);
    if (src.length < 2 || src.length !== tr.length) return null;
    const kept = src.filter((_, i) => { const key = lineKey(tr[i]); return !key || mine.includes(key.slice(0, 30)); });
    return kept.some(lettersOf) && kept.length < src.length ? kept.join('\n') : null;
}

/**
 * 번역 한 문단에 원문 여러 문단이 합쳐졌으면 짝 없이 남은 이웃 원문 문단까지. @returns {[number, number]} 원문 문단의 처음과 끝 번호
 */
function spanOf(data, at, pair) {
    const used = new Set(data.map.filter(i => i >= 0));
    let from = pair, to = pair;
    while (from - 1 >= 0 && !used.has(from - 1)) from--;
    while (to + 1 < data.source.length && !used.has(to + 1)) to++;
    // 앞쪽에 남은 문단은 바로 앞 번역 문단에 짝이 있을 때만 이 문단 몫으로 본다
    const before = at > 0 ? data.map[at - 1] : -1;
    return [before >= 0 && before < from ? from : pair, to];
}

/**
 * 번역 문단 하나(화면 요소 하나)의 원문 글.
 * @param {{ source: string[], translation: string[], map: number[] }} data map[번역 문단 번호] = 원문 문단 번호(없으면 -1)
 * @param {number} at 번역 문단 번호
 * @param {string} own 화면 요소의 글
 * @param {boolean} [isItem] 목록 항목인가
 * @returns {string | null} 짝이 없으면 null
 */
export function originalFor(data, at, own, isItem = false) {
    const pair = at < 0 ? -1 : data.map[at] ?? -1;
    if (pair < 0) return null;
    const source = data.source[pair], translation = data.translation[at];
    if (isItem) {
        const line = itemLines(source, translation, own);
        if (line != null) return line;
    }
    const [from, to] = spanOf(data, at, pair);
    if (from === to) return shownLines(source, translation, own) ?? source;
    return data.source.slice(from, to + 1).filter(text => text.trim()).join('\n\n');
}

const QUOTE = /["“”「」『』]/;
// 이름: 값 칸이 | 로 이어진 줄(시간, 장소, 날씨를 적은 머리줄)은 따옴표로 감싸여 있어도 대사가 아니다
const INFO_LINE = /[^|｜\n]{1,20}[:：][^|｜\n]*[|｜][^|｜\n]*[|｜]/;
/** 따옴표로 말한 줄이 든 문단인가 */
export const isDialogue = text => QUOTE.test(text) && !INFO_LINE.test(text);

const escapeText = text => String(text).replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]);
// 실리태번이 대사로 꾸미는 따옴표와 같은 것: 원문 칸의 대사에도 테마의 대사 색이 들어가게 q 로 감싼다
const QUOTED = /(".*?")|(“.*?”)|(«.*?»)|(「.*?」)|(『.*?』)|(＂.*?＂)/g;
// 줄 머리의 제목 표시(# ~ ######)와 가로줄(--- · *** · ___, 사이를 띄운 * * * 도)은 글자로 남기지 않는다: 원문 칸에 '## 제목'이 기호째 보였다. 제목은 굵게, 가로줄은 뺀다
const HEADING = /^[ \t　]*#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm;
const RULE = /^[ \t　]*(?:(?:-[ \t]?){3,}|(?:\*[ \t]?){3,}|(?:_[ \t]?){3,})[ \t]*$/gm;
const CODE = /`([^`\n]+)`/g;
// 강조는 실리태번이 메시지를 그릴 때와 같은 판정으로 건다(showdown 의 굵게 · 기울임 규칙): 여는 별 바로 뒤와 닫는 별 바로 앞이 빈칸이 아닐 때만,
// 별 셋(굵은 기울임) → 둘(굵게) → 하나(기울임) 차례로. 빈칸을 안 보면 '2 * 3 * 4' 의 곱셈표가 기울임이 되고, 차례가 다르면 별 셋의 태그가 엇갈린다.
// 한 문단 안에서만 짝짓는다(빈 줄을 넘지 않는다).
const INSIDE = '(?:(?!\\n[ \\t]*\\n)[\\s\\S])*?';
const EMPHASIS = [
    [new RegExp(`\\*\\*\\*(\\S${INSIDE})\\*\\*\\*`, 'g'), '<strong><em>', '</em></strong>'],
    [new RegExp(`\\*\\*(\\S${INSIDE})\\*\\*`, 'g'), '<strong>', '</strong>'],
    [new RegExp(`\\*([^\\s*]${INSIDE})\\*`, 'g'), '<em>', '</em>'],
];
const emphasized = text => EMPHASIS.reduce(
    (left, [find, open, close]) => left.replace(find, (hit, inner) => (/\S$/.test(inner) ? open + inner + close : hit)),
    text,
);
const HELD_CODE = /\u0001(\d+)\u0001/g;

/** 글자를 이스케이프하고 가로줄, 제목, 대사, 강조, 지움, 코드를 입힌다. 코드(백틱 안)는 먼저 떼어 두어 그 안의 별과 따옴표를 건드리지 않는다 */
function marked(text) {
    const codes = [];
    const hold = (_, body) => `\u0001${codes.push(body) - 1}\u0001`;
    const plain = escapeText(String(text).replace(/\u0001/g, '')).replace(CODE, hold)
        .replace(RULE, '')
        .replace(HEADING, '<strong>$1</strong>')
        .replace(QUOTED, hit => `<q>${hit}</q>`);
    return emphasized(plain)
        .replace(/~~(.+?)~~/g, '<s>$1</s>')
        .replace(HELD_CODE, (_, i) => `<code>${codes[i]}</code>`);
}
// 줄 머리의 목록 표시, 인용 표시, 들여쓰기는 뺀다(원문 칸은 목록이 아니라 맨 줄로 보인다)
const LINE_HEAD = /^[ \t　]*(?:>[ \t]?)*(?:(?:[*+-]|\d+[.)])[ \t]+)?/gm;
/** 가로줄과 줄 머리 표시를 걷어 낸 글. 가로줄이 먼저다: 목록 표시를 먼저 떼면 '* * *' 가 '* *' 로 남는다 */
const bare = text => text.replace(RULE, '').replace(LINE_HEAD, '');
// 태그로 보는 것: '<' 바로 뒤가 글자(또는 닫는 '/')인 것과 주석. '2 < 3 * 4 > 1' 의 '< 3 * 4 >' 는 태그가 아니라 글이다
const TAG = /<\/?[a-zA-Z][^>]*>|<!--[\s\S]*?-->/g;

/** 원문 글을 칸에 넣을 HTML 로: 태그는 빼고 글자는 이스케이프한 뒤 대사, 굵게, 기울임만 입힌다 */
export function lightHtml(text) {
    return marked(bare(String(text).replace(TAG, '')).trim());
}

/**
 * 문단 자리를 원문으로 바꿀 때 쓸 HTML: 원문의 글자 꾸밈 태그는 살린다(빼면 가운데 맞춤, 색 같은 꾸밈이 빠진 맨글이 된다).
 * 태그는 그대로 두고 글자만 이스케이프하므로, 돌려준 글은 반드시 허용한 태그만 남기는 함수를 거쳐 넣는다.
 */
export function richHtml(text) {
    const source = bare(String(text).replace(/<\/?(p|div)\b[^>]*>/gi, '')).trim();
    return source.split(new RegExp(`(${TAG.source})`)).map((part, i) => (i % 2 ? part : marked(part))).join('');
}
