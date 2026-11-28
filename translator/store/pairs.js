// 번역할 때 알게 된 "이 원문 문단의 번역은 이 문단"을 메시지에 적어 두고, 나중에 그것으로 짝을 되찾는다.
//
// 적는 것: 문단마다 [원문에서의 자리, 그 번역 문단의 지문], 대사가 든 문단에는 누가 누구에게 말했는지도. 번역 글 자체는 적지 않는다(메시지에 이미 있다).
// 자리(몇 글자째)가 아니라 지문으로 번역 문단을 찾는다. 번역문은 번역이 붙은 뒤에도 바뀐다(문단을 손으로 고침, 딸려 온 원문 괄호 지우기,
// 자료 블록 값 채우기). 자리로 적으면 한 글자만 바뀌어도 그 뒤가 전부 어긋나지만, 지문으로 찾으면 바뀐 문단 하나만 못 찾고 나머지는 그대로 맞는다.
// 못 찾은 문단도 앞뒤로 찾은 문단 사이에 낀 개수가 같으면 차례대로 짝짓는다.
//
// 쓰는 곳 둘:
//   match    문단을 눌렀을 때 그 문단의 원문(원문 칸)
//   reusable 원문을 고친 뒤 다시 번역할 때, 글이 그대로인 문단의 번역(그 문단은 다시 보내지 않는다)

import { split, isSent } from '../core/split.js';
import { labeled } from '../core/people.js';

/** 글의 지문(길이 + 해시). 같은 글인지 가리는 데만 쓴다 */
export function mark(text) {
    let hash = 5381;
    for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
    return `${text.length}:${(hash >>> 0).toString(36)}`;
}

/** 문단의 지문: 태그 · 기호 · 빈칸을 뺀 글자만 본다(꾸밈이나 띄어쓰기만 바뀐 문단은 같은 문단). 글자가 없으면 '' */
function shape(text) {
    const letters = String(text).replace(/<[^>]*>/g, '').normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '');
    return letters ? mark(letters) : '';
}

/** 글을 엔진과 같은 방식으로 문단(빈 줄 · 태그만 있는 줄에서 나뉜 덩이)으로 자른다. 빈 줄 덩이는 뺀다 */
function paragraphs(text, hold = []) {
    const out = [];
    let at = 0;
    for (const piece of split(text, { hold })) {
        if (piece.kind !== 'gap' && piece.src.trim()) out.push({ start: at, end: at + piece.src.length, body: piece.src });
        at += piece.src.length;
    }
    return out;
}

/**
 * 번역 한 번의 결과로 메시지에 적어 둘 기록을 만든다.
 * @param {string} source 엔진에 준 원문
 * @param {{ kind: string, src: string, out?: string }[]} pieces 엔진의 조각(차례대로, 이으면 원문)
 * @param {(name: string) => string} [nameOf] 이름을 적어 둘 표기로 바꾼다(같은 사람의 원문 이름과 한글 이름을 하나로)
 * @param {(piece: object) => any} [dependsOf] 보낸 조각마다 그 조각에 걸린 것(job/engine.js: 말한 사람 · 사람 줄 · 용어 줄의 지문). 주면 pieces 넷째 칸에 적는다
 * @returns {{ v: 1, s: string, units: [number, number, string[], [string[], string[]]?][], pieces: [string, number, number, any?][], doubt?: number[] }}
 *   units: [원문 시작, 원문 끝, 번역 문단 지문들, [말한 사람들, 듣는 사람들(지금은 늘 빔), 사용자가 바로잡았으면 1]]. 넷째 칸은 누가 말했는지 아는 문단에만 있다(모델이 모른다고 한 대사는 '').
 *   보내지 않은 덩이(태그 줄 · 보호한 블록)는 시작이 -1(자리 맞추는 닻으로만 쓴다)
 *   pieces: 보낸 조각마다 [원문 조각 지문, 첫 unit, 끝 unit, 걸린 것?] (다시 번역할 때 글이 같은 조각을 찾는다. 걸린 것은 원문을 고친 뒤 그대로 쓸지 견줄 때)
 */
export function record(source, pieces, nameOf = name => name, dependsOf = null) {
    const units = [], sent = [], doubt = [];
    let at = 0;
    for (const piece of pieces) {
        const from = at;
        at += piece.src.length;
        if (piece.kind === 'gap' || !piece.src.trim()) continue;
        const done = isSent(piece) && typeof piece.out === 'string';
        if (!done) { units.push([-1, -1, [shape(piece.src)]]); continue; }
        const first = units.length, src = paragraphs(piece.src), out = paragraphs(piece.out);
        // 조각 하나에 문단이 여럿이고(태그로 감싸 한 덩이로 보낸 본문) 원문과 번역의 문단 수가 같으면 문단마다 짝. 다르면 조각 통째로 한 짝
        const unit = (start, end, shapes, said) => units.push(said ? [start, end, shapes, said] : [start, end, shapes]);
        if (src.length === out.length) src.forEach((part, i) => unit(from + part.start, from + part.end, [shape(out[i].body)], saidIn(piece, part.body, nameOf, src.length === 1)));
        else unit(from, at, out.map(part => shape(part.body)), saidIn(piece, piece.src, nameOf, true));
        sent.push(dependsOf ? [mark(piece.src), first, units.length - 1, dependsOf(piece)] : [mark(piece.src), first, units.length - 1]);
        if (piece.doubt?.length) for (let u = first; u < units.length; u++) doubt.push(u);
    }
    // doubt: 받은 뒤 확인(core/checks.js)에 걸린 조각의 unit 번호. 다시 번역 판이 이 문단들을 먼저 골라 둔다(없으면 칸째 없음)
    return doubt.length ? { v: 1, s: mark(source), units, pieces: sent, doubt } : { v: 1, s: mark(source), units, pieces: sent };
}

// 대사 따옴표(이름표 줄 · 상태창 글은 따로 읽는다)
const QUOTE = /["“”「」『』]/;

/**
 * 원문 문단 하나에서 누가 말했는지: 원문의 이름표(이름 | "대사")에서 읽은 이름 + 모델이 그 조각의 머리에 적은 사람.
 * 모델은 조각마다 한 번 적는다. 한 조각에 문단이 여럿이면(태그로 감싸 한 덩이로 보낸 본문) 따옴표가 든 문단에만 그 사람들을 적는다.
 * 듣는 사람은 받지 않는다(읽어 쓰는 곳이 없다): 둘째 칸은 늘 빈 목록이다(기록의 꼴은 그대로).
 * @param {{ speakers?: string[] }} piece  @param {string} sourceBody 그 문단의 원문  @param {boolean} whole 조각 통째로 한 문단인가
 * @returns {[string[], string[]] | null} 아는 것이 없으면 null
 */
function saidIn(piece, sourceBody, nameOf, whole) {
    const who = new Set(labeled(sourceBody).map(nameOf));
    if (whole || QUOTE.test(sourceBody)) for (const name of piece.speakers || []) who.add(name ? nameOf(name) : '');
    return who.size ? [[...who], []] : null;
}

const sameMark = (x, y) => Boolean(x) && x === y;

/** 가장 긴 공통 부분 차례(같은 지문끼리, 차례를 지키며). 빈 지문은 서로 같지 않다. same: 두 칸이 같은가 @returns {[number, number][]} */
function commonOrder(a, b, same = sameMark) {
    const n = a.length, m = b.length, width = m + 1, best = new Uint16Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            best[i * width + j] = same(a[i], b[j]) ? best[(i + 1) * width + j + 1] + 1 : Math.max(best[(i + 1) * width + j], best[i * width + j + 1]);
        }
    }
    const out = [];
    for (let i = 0, j = 0; i < n && j < m;) {
        if (same(a[i], b[j])) { out.push([i, j]); i++; j++; }
        else if (best[(i + 1) * width + j] >= best[i * width + j + 1]) i++;
        else j++;
    }
    return out;
}

/**
 * 지금 번역문의 문단마다 기록의 어느 unit 인지 찾는다.
 * @returns {{ parts: {start: number, end: number, body: string}[], unitOf: number[] }} unitOf[문단 번호] = unit 번호(못 찾으면 -1)
 */
function locate(saved, translation, hold) {
    const parts = paragraphs(translation, hold);
    const keys = [], owner = [];   // 기록의 번역 문단 지문을 차례로 편 것과, 각 지문이 든 unit
    saved.units.forEach((unit, u) => unit[2].forEach(key => { keys.push(key); owner.push(u); }));
    const found = commonOrder(keys, parts.map(part => shape(part.body)));
    const unitOf = parts.map(() => -1);
    for (const [k, p] of found) unitOf[p] = owner[k];
    // 찾은 것들 사이에 낀 것: 양쪽 개수가 같으면 차례대로 같은 문단으로 본다(번역이 붙은 뒤 글이 바뀐 문단)
    const edges = [[-1, -1], ...found, [keys.length, parts.length]];
    for (let e = 0; e + 1 < edges.length; e++) {
        const [k0, p0] = edges[e], [k1, p1] = edges[e + 1];
        if (k1 - k0 !== p1 - p0) continue;
        for (let step = 1; k0 + step < k1; step++) unitOf[p0 + step] = owner[k0 + step];
    }
    return { parts, unitOf };
}

const usable = saved => saved && saved.v === 1 && Array.isArray(saved.units) && Array.isArray(saved.pieces);

/**
 * 원문 문단 ↔ 지금 번역문 문단의 짝. 기록이 없거나 원문이 번역할 때와 다르면 null(부르는 쪽이 두 글을 견줘 다시 맞춘다).
 * @param {RegExp[]} [hold] 번역에 보내지 않는 블록의 규칙(번역문을 번역할 때와 같은 덩이로 자르려고)
 * @returns {{ source: {start: number, end: number, body: string}[], translation: {start: number, end: number, body: string}[], map: number[] } | null}
 *   map[번역 문단 번호] = 원문 문단 번호(짝이 없으면 -1)
 */
export function match(saved, source, translation, hold = []) {
    if (!usable(saved) || saved.s !== mark(source)) return null;
    const { parts, unitOf } = locate(saved, translation, hold);
    const sourceAt = new Map(), paras = [];
    saved.units.forEach(([from, to], u) => { if (from >= 0) { sourceAt.set(u, paras.length); paras.push({ start: from, end: to, body: source.slice(from, to) }); } });
    return { source: paras, translation: parts, map: unitOf.map(u => sourceAt.get(u) ?? -1) };
}

/**
 * 지금 번역문의 문단 가운데 누가 말했는지 적힌 것.
 * @returns {{ start: number, end: number, unit: number, who: string[], to: string[], fixed: boolean }[]} start · end 는 번역문에서의 자리, fixed 는 사용자가 바로잡은 것
 */
export function told(saved, translation, hold = []) {
    if (!usable(saved) || typeof translation !== 'string') return [];
    const { parts, unitOf } = locate(saved, translation, hold), out = [];
    parts.forEach((part, p) => {
        const said = saved.units[unitOf[p]]?.[3];
        if (said) out.push({ start: part.start, end: part.end, unit: unitOf[p], who: said[0] || [], to: said[1] || [], fixed: Boolean(said[2]) });
    });
    return out;
}

/** 사용자가 바로잡은 주인을 기록에 적는다(듣는 사람은 그대로 둔다). @returns {boolean} 적었으면 true */
export function setWho(saved, unit, who) {
    const row = usable(saved) ? saved.units[unit] : null;
    if (!row || !who) return false;
    row[3] = [[who], row[3]?.[1] || [], 1];
    return true;
}

/** 조각마다 적어 둔 걸린 것: 원문 조각 지문 → 걸린 것(적힌 조각만) */
export function dependsOf(saved) {
    return new Map(usable(saved) ? saved.pieces.filter(row => row[3] !== undefined).map(row => [row[0], row[3]]) : []);
}

/**
 * 다시 번역할 때 그대로 쓸 번역: 원문 조각 지문 → 지금 번역문에서 그 조각에 해당하는 글.
 * 조각의 번역 문단을 지금 번역문에서 전부, 이어진 자리에서 찾았을 때만 넣는다(하나라도 못 찾은 조각은 다시 번역한다).
 * @returns {Map<string, string>}
 */
export function reusable(saved, translation, hold = []) {
    const out = new Map();
    if (!usable(saved) || typeof translation !== 'string' || !translation) return out;
    const { parts, unitOf } = locate(saved, translation, hold);
    for (const [key, first, last] of saved.pieces) {
        const mine = [];
        unitOf.forEach((u, p) => { if (u >= first && u <= last) mine.push(p); });
        const need = saved.units.slice(first, last + 1).reduce((sum, unit) => sum + unit[2].length, 0);
        const together = mine.every((p, i) => i === 0 || p === mine[i - 1] + 1);
        if (mine.length && mine.length === need && together) out.set(key, translation.slice(parts[mine[0]].start, parts[mine[mine.length - 1]].end));
    }
    return out;
}

// ── 원문을 고친 뒤 번역을 남기기 ──

/** 기록에 적힌 옛 원문의 덩이들(차례대로): 보낸 조각 { sent, key 조각 지문, first, last, depends } · 보내지 않은 덩이 { key 문단 지문 } */
function oldBlocks(saved) {
    const startOf = new Map(saved.pieces.map(row => [row[1], row]));
    const out = [];
    saved.units.forEach((unit, u) => {
        if (unit[0] < 0) { out.push({ sent: false, key: unit[2][0] ?? '' }); return; }
        const row = startOf.get(u);
        if (row) out.push({ sent: true, key: row[0], first: row[1], last: row[2], depends: row[3] });
    });
    return out;
}

/** 옛 덩이와 새 조각이 같은 글인가: 보낸 조각은 조각 지문, 보내지 않은 덩이는 문단 지문으로 */
const sameBlock = (old, fresh) => (old.sent ? old.key === fresh.mark : Boolean(old.key) && old.key === fresh.shape);

/** 그 조각의 말한 사람(옛 기록의 첫 unit 에 적힌 것) */
const speakersOf = (saved, block) => saved.units[block.first]?.[3]?.[0] ?? [];

/**
 * 짝지은 것 사이에 낀 것: 옛 보낸 조각과 새 보낼 조각을 차례대로 짝(글이 바뀐 문단). 새 쪽이 남으면 더한 문단(번역 없음),
 * 옛 쪽이 남으면 지운 문단(그 번역은 버린다)
 */
function pairGap(oldGap, newGap, give) {
    const olds = oldGap.filter(block => block.sent), news = newGap.filter(item => isSent(item.piece));
    news.forEach((item, i) => { if (olds[i]) give(item, olds[i], true); });
}

/**
 * 원문을 고친 뒤에도 번역을 남긴다(사용자 결정: 원문을 고쳐도 번역은 그대로, 문단을 지우면 그 번역도 지운다).
 * 새 원문을 문단으로 자르고 옛 기록의 지문으로 옛 문단과 짝짓는다(자리로 맞추면 가운데 문단 하나만 지워도 뒤가 전부 어긋난다).
 *   글이 그대로인 문단 · 글이 바뀐 문단: 옛 번역 그대로. 바뀐 문단은 기록에 옛 원문 지문을 남겨, 다음 번역 때 그 문단만 다시 보낸다
 *   새로 더한 문단: 번역이 없어 원문 그대로 그 자리에 · 지운 문단: 그 번역도 뺀다
 * @param {object} saved 옛 기록  @param {string} translation 붙어 있던 번역문  @param {string} source 새 원문  @param {RegExp[]} [hold]
 * @returns {{ text: string, pairs: object, kept: number, changed: number, added: number } | null} 옛 번역을 하나도 찾지 못하면 null
 */
export function carry(saved, translation, source, hold = []) {
    if (!usable(saved) || typeof translation !== 'string' || !translation) return null;
    const texts = reusable(saved, translation, hold), olds = oldBlocks(saved);
    if (!texts.size) return null;
    const pieces = split(source, { hold });
    const items = pieces.filter(piece => piece.kind !== 'gap' && piece.src.trim()).map(piece => ({ piece, mark: mark(piece.src), shape: shape(piece.src) }));
    const count = { kept: 0, changed: 0, added: 0 };
    const give = (item, block, changed) => {
        if (!block.sent || !texts.has(block.key)) return;
        Object.assign(item.piece, { out: texts.get(block.key), speakers: speakersOf(saved, block) });
        item.old = block; item.changed = changed;
        count[changed ? 'changed' : 'kept']++;
    };
    const found = commonOrder(olds, items, sameBlock);
    for (const [o, i] of found) give(items[i], olds[o], false);
    const edges = [[-1, -1], ...found, [olds.length, items.length]];
    for (let e = 0; e + 1 < edges.length; e++) pairGap(olds.slice(edges[e][0] + 1, edges[e + 1][0]), items.slice(edges[e][1] + 1, edges[e + 1][1]), give);
    count.added = items.filter(item => isSent(item.piece) && typeof item.piece.out !== 'string').length;
    const pairs = record(source, pieces);
    // 기록의 보낸 조각 줄은 out 이 있는 조각 차례 그대로다: 바뀐 문단은 옛 원문 지문으로(다음 번역 때 다시 보내게), 걸린 것은 옛 것 그대로
    const done = items.filter(item => isSent(item.piece) && typeof item.piece.out === 'string');
    done.forEach((item, i) => {
        const row = pairs.pieces[i];
        if (item.changed) row[0] = item.old.key;
        else if (item.old.depends !== undefined) row[3] = item.old.depends;
    });
    const text = pieces.map(piece => (typeof piece.out === 'string' ? piece.out : piece.src)).join('');
    return { text, pairs, ...count };
}
