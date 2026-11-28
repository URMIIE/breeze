// 글 → 조각. 조각의 src 를 차례로 이으면 원문과 글자 하나까지 같다.
//
// 조각 종류
//   text  글 문단. 보낸다.
//   cell  구조가 든 덩이(div · details · table · 목록 · 코드 블록 …). 덩이 하나를 통째로 보낸다.
//   tag   태그만 있는 줄. 안 보낸다.
//   hold  보호 블록(주석 · 숨긴 블록 · 밖에서 넘겨받은 규칙에 맞은 글). 안 보낸다.
//   keep  옮길 글자가 없거나 이미 옮길 필요가 없는 문단. 안 보낸다.
//   gap   문단 사이 빈 줄.
//
// 차례가 중요하다: 보호 블록과 구조 덩이를 먼저 한 글자짜리 표로 바꾼 뒤에 빈 줄로 나눈다.
// 빈 줄을 품은 주석 · 덩이가 문단 사이에서 갈라지면 여는 쪽과 닫는 쪽이 따로 번역돼 닫는 표시를 잃는다.

const GAP = /(\r?\n[\t ]*\r?\n(?:[\t ]*\r?\n)*)/;
const TAG_ONLY_LINE = /^[\t ]*(?:<\/?[A-Za-z][\w-]*(?:\s[^<>]*)?>[\t ]*)+$/;
const COMMENT = /<!--[\s\S]*?-->/g;
const FENCE = /^[\t ]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[\t ]*\1[\t ]*$/gm;
const SILENT = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const CONTAINERS = new Set(['div', 'details', 'table', 'pre', 'ul', 'ol', 'blockquote']);
const INLINE = new Set(['span', 'font', 'q', 'b', 'i', 'strong', 'em', 'u', 's', 'del', 'small', 'mark', 'code', 'a', 'p']);
const ANY_TAG = /<(\/?)([A-Za-z][\w-]*)\b[^<>]*>/g;
// 표: 원문에 나올 일이 없는 사용자 정의 영역 글자 둘 사이에 블록 번호
const T0 = '', T1 = '';
const TOKEN = /(\d+)/g;

/** 겹치지 않는 구간만 남긴다. 먼저 시작한 것, 같으면 긴 것이 이긴다 */
function pickRanges(ranges) {
    ranges.sort((a, b) => a.from - b.from || b.to - a.to);
    const out = [];
    let end = 0;
    for (const r of ranges) {
        if (r.from < end || r.to <= r.from) continue;
        out.push(r);
        end = r.to;
    }
    return out;
}

/** 바깥 구조 덩이의 구간. 짝이 안 맞는 여는 태그는 거기서 글 끝까지를 한 덩이로 본다(통째로 포기하지 않는다) */
function containerRanges(text, taken) {
    const inTaken = at => taken.some(r => at >= r.from && at < r.to);
    const out = [];
    let depth = 0, from = -1;
    for (const m of text.matchAll(ANY_TAG)) {
        const name = m[2].toLowerCase();
        if (!CONTAINERS.has(name) || /\/\s*>$/.test(m[0]) || inTaken(m.index)) continue;
        if (!m[1]) { if (depth++ === 0) from = m.index; }
        else if (depth > 0 && --depth === 0) { out.push({ from, to: m.index + m[0].length, kind: 'cell' }); from = -1; }
    }
    if (depth > 0 && from >= 0) out.push({ from, to: text.length, kind: 'cell' });
    return out;
}

function findBlocks(text, holdRules) {
    const hold = [];
    const add = (pattern, kind) => {
        const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
        for (const m of text.matchAll(new RegExp(pattern.source, flags))) if (m[0]) hold.push({ from: m.index, to: m.index + m[0].length, kind });
    };
    add(COMMENT, 'hold');
    add(SILENT, 'hold');
    for (const rule of holdRules) add(rule, 'hold');
    add(FENCE, 'cell');
    const first = pickRanges(hold);
    const picked = pickRanges([...first, ...containerRanges(text, first)]);
    // 구조 덩이가 품은 보호 구간은 덩이에 묻히지 않게 따로 적어 둔다(덩이를 보낼 때도 그 자리는 가려야 한다)
    for (const block of picked) {
        if (block.kind !== 'cell') continue;
        const inside = first.filter(h => h !== block && h.from >= block.from && h.to <= block.to);
        block.inner = inside.map(h => ({ at: h.from - block.from, len: h.to - h.from }));
    }
    return picked;
}

/** 글자 꾸밈 태그(span · b · br …)가 아닌 태그만 있는 줄인가 */
function isBlockTagLine(line) {
    if (!TAG_ONLY_LINE.test(line)) return false;
    for (const m of line.matchAll(ANY_TAG)) { const name = m[2].toLowerCase(); if (INLINE.has(name) || name === 'br') return false; }
    return true;
}

/** 문단 끝에서 닫히지 않은 글자 꾸밈 태그가 남았는가 */
function leavesOpen(part) {
    const stack = [];
    for (const m of part.matchAll(ANY_TAG)) {
        const name = m[2].toLowerCase();
        if (!INLINE.has(name) || /\/\s*>$/.test(m[0])) continue;
        if (!m[1]) stack.push(name);
        else if (stack[stack.length - 1] === name) stack.pop();
    }
    return stack.length > 0;
}

/** 꾸밈 태그가 빈 줄을 건너 이어지는 문단들은 한 문단으로 붙인다(여는 태그와 닫는 태그가 따로 번역되지 않게) */
function mergeOpenRuns(parts) {
    const out = [];
    for (let i = 0; i < parts.length; i += 2) {
        let body = parts[i], j = i;
        if (leavesOpen(body)) {
            let probe = body, k = i;
            while (k + 2 < parts.length) {
                probe += parts[k + 1] + parts[k + 2];
                k += 2;
                if (!leavesOpen(probe)) { body = probe; j = k; break; }
            }
        }
        out.push(body);
        if (j + 1 < parts.length) out.push(parts[j + 1]);
        i = j;
    }
    return out;
}

/** 블록 구간을 표로 바꾼 글 */
function maskBlocks(source, blocks) {
    let masked = '', at = 0;
    blocks.forEach((block, n) => { masked += source.slice(at, block.from) + T0 + n + T1; at = block.to; });
    return masked + source.slice(at);
}

/** 표가 든 글을 원문으로 되돌리고, 그 안에서 가려야 할 구간(보호 블록 · 구조 덩이 속 보호 구간)의 자리를 같이 낸다 */
function expand(source, blocks, marked) {
    const holds = [];
    let src = '', last = 0;
    for (const m of marked.matchAll(TOKEN)) {
        const block = blocks[Number(m[1])], body = source.slice(block.from, block.to);
        src += marked.slice(last, m.index);
        if (block.kind === 'hold') holds.push({ at: src.length, len: body.length });
        for (const h of block.inner || []) holds.push({ at: src.length + h.at, len: h.len });
        src += body;
        last = m.index + m[0].length;
    }
    return { src: src + marked.slice(last), holds };
}

/** 조각을 차례로 받아 모으는 것. 태그 줄을 지나며 지금 어느 태그 안인지(wrap)를 따라간다 */
function collector(source, blocks, skip) {
    const pieces = [], wraps = [];
    const push = (kind, marked) => {
        if (marked === '') return;
        const { src, holds } = expand(source, blocks, marked);
        const sent = kind === 'text' || kind === 'cell';
        pieces.push({ kind, src, holds: sent ? holds : [], wrap: wraps[wraps.length - 1] || '' });
    };
    return {
        pieces,
        gap: marked => push('gap', marked),
        tagLine(line) {
            push('tag', line);
            const tags = [...line.matchAll(ANY_TAG)];
            if (tags.length !== 1 || /\/\s*>$/.test(tags[0][0])) return;
            const name = tags[0][2].toLowerCase();
            if (!tags[0][1]) wraps.push(name);
            else if (wraps.lastIndexOf(name) >= 0) wraps.length = wraps.lastIndexOf(name);
        },
        /** 문단 글: 블록 표만 있으면 그 블록의 종류, 옮길 글자가 없거나 skip 이면 keep, 그 밖은 text */
        body(marked) {
            const tokens = [...marked.matchAll(TOKEN)], onlyTokens = tokens.length > 0 && !marked.replace(TOKEN, '').trim();
            if (onlyTokens && tokens.every(m => blocks[Number(m[1])].kind === 'hold')) return push('hold', marked);
            if (onlyTokens && tokens.length === 1) return push('cell', marked);
            const { src } = expand(source, blocks, marked);
            const hasLetters = /\p{L}/u.test(src.replace(/<[^<>]*>/g, ' '));
            push(!hasLetters || skip(src) ? 'keep' : 'text', marked);
        },
    };
}

/**
 * 문단 하나를 내보낸다. 태그만 있는 줄은 문단에서 떼어 따로 둔다: 가장자리의 것은 전부, 가운데 것은 글자 꾸밈 태그가 아닐 때만.
 * (닫는 태그 줄이 문단에 붙어 있으면, 그 아래 문단을 지웠을 때 글이 안 바뀐 윗문단까지 새 문단으로 보인다)
 */
function emitParagraph(paragraph, out) {
    const lines = paragraph.split(/(\r?\n)/);   // [줄, 줄바꿈, 줄, …]
    let first = 0, last = lines.length - 1;
    while (first < last && TAG_ONLY_LINE.test(lines[first])) first += 2;
    while (last > first && TAG_ONLY_LINE.test(lines[last])) last -= 2;

    for (let k = 0; k < first; k += 2) { out.tagLine(lines[k]); out.gap(lines[k + 1]); }
    if (first === last && TAG_ONLY_LINE.test(lines[first])) out.tagLine(lines[first]);
    else {
        let from = first;
        for (let k = first + 2; k < last; k += 2) {
            if (!isBlockTagLine(lines[k])) continue;
            if (from < k) { out.body(lines.slice(from, k - 1).join('')); out.gap(lines[k - 1]); }
            out.tagLine(lines[k]); out.gap(lines[k + 1]);
            from = k + 2;
        }
        out.body(lines.slice(from, last + 1).join(''));
    }
    for (let k = last + 2; k < lines.length; k += 2) { out.gap(lines[k - 1]); out.tagLine(lines[k]); }
}

/**
 * @param {string} text 원문
 * @param {{ hold?: RegExp[], skip?: (body: string) => boolean }} [options]
 *   hold: 보내지 않고 제자리에 둘 글의 규칙. skip: 보내지 않을 문단인가(예: 이미 한국어)
 * @returns {{ kind: string, src: string, holds: {at: number, len: number}[], wrap: string }[]}
 */
export function split(text, { hold = [], skip = () => false } = {}) {
    const source = String(text ?? '');
    if (!source) return [];
    if (source.includes(T0) || source.includes(T1)) return [{ kind: 'cell', src: source, holds: [], wrap: '' }];

    const blocks = findBlocks(source, hold);
    const out = collector(source, blocks, skip);
    const parts = mergeOpenRuns(maskBlocks(source, blocks).split(GAP));   // [문단, 빈 줄, 문단, …]
    for (let i = 0; i < parts.length; i += 2) {
        emitParagraph(parts[i], out);
        if (i + 1 < parts.length) out.gap(parts[i + 1]);
    }
    return out.pieces;
}

/** 보내는 조각인가 */
export const isSent = piece => piece.kind === 'text' || piece.kind === 'cell';

/** 조각을 다시 잇는다. translated: 조각 번호 → 번역 글(없으면 원문 그대로) */
export function join(pieces, translated = new Map()) {
    return pieces.map((piece, i) => (translated.has(i) ? translated.get(i) : piece.src)).join('');
}
