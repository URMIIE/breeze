// 채팅 기록의 이름 바꾸기: 글 속의 옛 이름을 새 이름으로 바꾸면서, 그 글에 묶여 저장된 것을 같이 맞춘다.
//
// 같이 맞추는 것과 까닭:
//   원문(mes, swipes) · 번역문(extra.display_text, original_translation_backup, 스와이프 사본의 것도)
//   원문 해시(extra.original_text_hash)   번역기는 이 값이 지금 원문과 다르면 '원문이 바뀐 옛 번역'으로 본다.
//                                          매크로를 푼 원문의 해시를 글자로 적는다(숫자나 매크로를 안 푼 글의 해시면 어긋난다)
//   문단 짝 기록(extra.llmt_pairs)        원문 지문, 문단 자리, 번역 문단 지문이 전부 글에서 나온 값이라 이름 길이만 달라져도 짝을 못 찾는다
//   옛 꼴의 번역 기록(extra.translation_source)  원문 해시 o, 번역 해시 d, 번역 글 t
//   이 채팅에 적힌 사람 · 이름 · 규칙(chat_metadata.story_translation)과 옛 자리의 말투 · 용어 · 상태창 번역 기록
// 바꾸기 전에 지금 글과 맞던 기록만 새 글에 맞춘다. 전부터 어긋나 있던 기록(원문이 바뀐 옛 번역)은 그대로 둬서 번역기가 알아보게 한다.
// 다시 번역 전의 번역(extra.llmt_before)은 손대지 않는다: 번역문 지문이 달라져 저절로 안 쓰인다.
//
// 글만 다룬다. 실리태번을 모른다: 해시, 매크로 풀기, 번역에 보내지 않는 글의 규칙은 넘겨받는다(브라우저 없이 시험하려고).

import { mark } from './pairs.js';
import { split } from '../core/split.js';

const HANGUL = /[가-힣]/;
// 받침에 따라 바뀌는 조사 [받침 있음, 받침 없음]
const PARTICLES = [['이었', '였'], ['이에요', '예요'], ['이랑', '랑'], ['이나', '나'], ['으로', '로'], ['이', '가'], ['은', '는'], ['을', '를'], ['과', '와'], ['아', '야']];
const PARTICLE = `(${[...new Set(PARTICLES.flat())].sort((a, b) => b.length - a.length).join('|')})?`;
// 한 글자 조사 뒤에 이어져도 조사로 보는 글자(알렉스는요, 알렉스와의, 알렉스로서)
const AFTER_PARTICLE = '요의도만은는서부써';
const WORD_EDGE = '[\\p{Script=Latin}\\p{N}_]';

/** 끝 글자의 받침: 0 없음, 8 ㄹ, 그 밖의 수 있음, null 모름. 라틴 글자 이름은 끝 글자로 어림한다(l, n, m, ng 만 받침) */
function finalOf(word) {
    const code = word.charCodeAt(word.length - 1) - 0xAC00;
    if (code >= 0 && code <= 11171) return code % 28;
    const low = word.toLowerCase();
    if (!/[a-z]$/.test(low)) return null;
    return low.endsWith('l') ? 8 : /(?:n|m|ng)$/.test(low) ? 4 : 0;
}

/** 조사를 새 이름의 받침에 맞춘다. 받침을 모르면 그대로 */
function fit(particle, name) {
    const final = finalOf(name), pair = PARTICLES.find(p => p.includes(particle));
    if (final === null || !pair) return particle;
    if (pair[0] === '으로') return final === 0 || final === 8 ? '로' : '으로';
    return final === 0 ? pair[1] : pair[0];
}

/** "Alex, 알렉스, 艾利克斯" → 표기들(긴 것부터: 짧은 표기가 긴 표기의 앞부분을 먼저 잡지 않게) */
export const namesOf = value => [...new Set(String(value ?? '').split(/[,，、]/).map(v => v.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);

const escaped = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** 라틴 글자 이름은 앞뒤가 글자 · 숫자가 아닐 때만(Alex 가 Alexander 를 잡지 않게). 한글 조사나 한자에는 붙어 있어도 된다 */
const nameRule = name => (/\p{Script=Latin}/u.test(name) ? `(?<!${WORD_EDGE})${escaped(name)}(?!${WORD_EDGE})` : escaped(name));
const finder = names => new RegExp(`(${names.map(nameRule).join('|')})${PARTICLE}`, 'gu');

/** 찾은 자리에 넣을 글. 이름이 아니라고 보면 null */
function putFor(hit, whole, newName) {
    const [all, name, particle] = hit;
    const before = whole[hit.index - 1] || '', next = whole[hit.index + all.length] || '';
    // 한 글자 한글 이름은 다른 낱말 속에도 있다(준 → 준비): 앞이 한글이거나, 조사 없이 한글이 이어지면 이름이 아니다
    if (name.length === 1 && HANGUL.test(name) && (HANGUL.test(before) || (particle === undefined && HANGUL.test(next)))) return null;
    if (particle === undefined) return newName;
    // 받침 있는 이름 뒤의 '이' + 한글(하늘이는, 하늘이가)은 조사가 아니라 이름에 붙는 '이'다. 새 이름에 받침이 없으면 뗀다
    if (particle === '이' && finalOf(name) > 0 && HANGUL.test(next)) return newName + (finalOf(newName) === 0 ? '' : '이');
    // 한 글자 조사 뒤에 한글이 이어지면 대개 다음 낱말의 첫 글자다(하늘나라, 하늘과자): 그 글자는 그대로 둔다
    if (particle.length === 1 && HANGUL.test(next) && !AFTER_PARTICLE.includes(next)) return newName + particle;
    return newName + fit(particle, newName);
}

/**
 * 글 속의 옛 이름을 새 이름으로(뒤의 조사는 새 이름의 받침에 맞춘다).
 * @param {string} oldNames 옛 이름(쉼표로 여러 표기)
 * @returns {{ text: string, count: number, cuts: [number, number, number][] }} cuts: [바꾸기 전 자리, 옛 길이, 새 길이]
 */
export function swapName(text, oldNames, newName) {
    const whole = String(text ?? ''), cuts = [];
    const names = newName ? namesOf(oldNames).filter(name => whole.includes(name)) : [];
    if (!names.length) return { text: whole, count: 0, cuts };
    let out = '', last = 0;
    for (const hit of whole.matchAll(finder(names))) {
        const put = putFor(hit, whole, newName);
        if (put === null || put === hit[0]) continue;
        out += whole.slice(last, hit.index) + put;
        last = hit.index + hit[0].length;
        cuts.push([hit.index, hit[0].length, put.length]);
    }
    return { text: out + whole.slice(last), count: cuts.length, cuts };
}

/** 바꾸기 전 글에서의 자리 → 바꾼 글에서의 자리 */
const movedTo = (cuts, at) => cuts.reduce((to, [from, was, now]) => (from + was <= at ? to + now - was : to), at);

// ── 문단 짝 기록 ──

/** 문단의 지문(store/pairs.js 가 적는 것과 같은 꼴: 태그 · 기호 · 빈칸을 뺀 글자만) */
function shapeOf(text) {
    const letters = String(text).replace(/<[^>]*>/g, '').normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '');
    return letters ? mark(letters) : '';
}

/** 글을 번역할 때와 같은 덩이로 잘라, 덩이마다 [바꾸기 전 값, 바꾼 뒤 값]을 적는다 */
function changedKeys(text, hold, pair, keyOf) {
    const out = new Map();
    for (const piece of split(text, { hold })) {
        if (piece.kind === 'gap' || !piece.src.trim()) continue;
        const next = swapName(piece.src, pair[0], pair[1]);
        if (next.count) out.set(keyOf(piece.src), keyOf(next.text));
    }
    return out;
}

/** 대사의 주인으로 적힌 이름이 옛 이름과 같으면 새 이름으로 */
function renameWho(said, names) {
    const swap = name => {
        for (const [old, now] of [names.shown, names.source]) if (now && namesOf(old).includes(name)) return now;
        return name;
    };
    said[0] = (said[0] || []).map(swap);
    said[1] = (said[1] || []).map(swap);
}

/**
 * 짝 기록을 바꾼 글에 맞춘다(제자리에서). 바꾸기 전 원문과 맞던 기록만.
 * @param {object} saved extra.llmt_pairs
 * @param {{ was: string, cuts: [number, number, number][], now: string }} source 매크로를 푼 원문의 바꾸기 전, 바뀐 자리, 바꾼 뒤
 * @param {string} shownWas 바꾸기 전 번역문
 */
function fixPairs(saved, source, shownWas, names, hold) {
    if (!saved || saved.v !== 1 || !Array.isArray(saved.units) || !Array.isArray(saved.pieces) || saved.s !== mark(source.was)) return;
    const sentKeys = changedKeys(source.was, hold, names.source, mark);        // 보낸 원문 조각의 지문
    const heldKeys = changedKeys(source.was, hold, names.source, shapeOf);     // 보내지 않은 덩이의 지문
    const shownKeys = changedKeys(shownWas, hold, names.shown, shapeOf);       // 번역 문단의 지문
    for (const unit of saved.units) {
        const keys = unit[0] < 0 ? heldKeys : shownKeys;
        unit[2] = unit[2].map(key => keys.get(key) ?? key);
        if (unit[0] >= 0) { unit[0] = movedTo(source.cuts, unit[0]); unit[1] = movedTo(source.cuts, unit[1]); }
        if (unit[3]) renameWho(unit[3], names);
    }
    for (const piece of saved.pieces) piece[0] = sentKeys.get(piece[0]) ?? piece[0];
    saved.s = mark(source.now);
}

// ── 메시지 ──

/** 붙어 있는 번역문이 든 칸 이름(원문을 보는 중이면 치워 둔 칸). 번역이 없으면 '' */
const shownKey = extra => (typeof extra.original_translation_backup === 'string' ? 'original_translation_backup' : typeof extra.display_text === 'string' ? 'display_text' : '');

/** 번역문과 그 글에 묶인 기록을 바꾼다. @returns {number} 바꾼 곳 수 */
function renameExtra(extra, source, names, tools, message) {
    const key = shownKey(extra), shownWas = key ? extra[key] : '';
    const shown = swapName(shownWas, names.shown[0], names.shown[1]);
    const wasHash = tools.hash(source.was), nowHash = tools.hash(source.now);
    if (shown.count) extra[key] = shown.text;
    // 원문을 보는 중이면 보이는 글이 매크로를 푼 원문이다
    if (key === 'original_translation_backup' && extra.display_text === source.was) extra.display_text = source.now;
    if (extra.original_text_hash !== undefined && String(extra.original_text_hash) === wasHash) extra.original_text_hash = nowHash;
    const old = extra.translation_source;
    if (old && typeof old === 'object') {
        if (String(old.o) === wasHash) old.o = nowHash;
        if (shown.count && String(old.d) === tools.hash(shownWas)) {
            old.d = tools.hash(shown.text);
            if (typeof old.t === 'string') old.t = swapName(old.t, names.shown[0], names.shown[1]).text;
        }
    }
    if (source.cuts.length || shown.count) fixPairs(extra.llmt_pairs, source, shownWas, names, tools.hold(message));
    let count = shown.count;
    if (typeof extra.reasoning === 'string') {
        const thought = swapName(extra.reasoning, names.source[0], names.source[1]);
        if (thought.count) { extra.reasoning = thought.text; count += thought.count; }
    }
    return count;
}

/** 메시지의 글 자리들: 지금 글과 스와이프마다 [읽기, 쓰기, 그 글의 extra] */
function slotsOf(message) {
    const out = [{ text: message.mes, write: text => { message.mes = text; }, extra: message.extra }];
    (message.swipes || []).forEach((text, i) => out.push({ text, write: next => { message.swipes[i] = next; }, extra: message.swipe_info?.[i]?.extra }));
    return out.filter(slot => typeof slot.text === 'string');
}

/**
 * 메시지 하나의 원문, 번역문, 기록을 같이 바꾼다(제자리에서).
 * @param {{ source: [string, string], shown: [string, string] }} names 원문 쪽 [옛 이름, 새 이름], 번역문 쪽 [옛 이름, 새 이름]. 새 이름이 비면 그쪽은 안 바꾼다
 * @param {{ hash: (text: string) => string, expand: (text: string, message: object) => string, hold: (message: object) => RegExp[] }} tools
 *   hash: 글의 해시를 글자로(String(getStringHash)). expand: 매크로를 푼 글. hold: 번역에 보내지 않는 글의 규칙
 * @returns {number} 바꾼 곳 수
 */
export function renameMessage(message, names, tools) {
    let count = 0;
    for (const slot of slotsOf(message)) {
        const was = tools.expand(slot.text, message), plain = swapName(slot.text, names.source[0], names.source[1]);
        if (plain.count) slot.write(plain.text);
        const expanded = swapName(was, names.source[0], names.source[1]);
        // 매크로가 든 글은 푼 글에서 바뀐 자리를 믿을 수 없다(매크로가 이름으로 풀린다): 그때는 자리를 옮기지 않고 해시만 맞춘다
        const now = plain.count ? tools.expand(plain.text, message) : was;
        const source = { was, now, cuts: expanded.text === now ? expanded.cuts : [] };
        count += plain.count;
        if (slot.extra && typeof slot.extra === 'object') count += renameExtra(slot.extra, source, names, tools, message);
    }
    return count;
}

/** 바꿀 곳 수만 센다(아무것도 고치지 않는다) */
export function countIn(chat, names) {
    let count = 0;
    for (const message of chat || []) {
        for (const slot of slotsOf(message)) {
            count += swapName(slot.text, names.source[0], names.source[1]).count;
            const key = slot.extra ? shownKey(slot.extra) : '';
            if (key) count += swapName(slot.extra[key], names.shown[0], names.shown[1]).count;
        }
    }
    return count;
}

// ── 이 채팅에 적힌 것 ──

/** 원문 쪽 이름과 번역문 쪽 이름을 둘 다 바꾼다(먼저 바꿀 쪽을 고른다) */
function swapBoth(text, names, first = 'shown') {
    let out = String(text ?? ''), count = 0;
    for (const side of first === 'shown' ? ['shown', 'source'] : ['source', 'shown']) {
        const next = swapName(out, names[side][0], names[side][1]);
        out = next.text;
        count += next.count;
    }
    return { text: out, count };
}

/** 객체의 글 칸 하나를 바꾼다. @returns {number} */
function swapField(holder, key, swap) {
    if (typeof holder?.[key] !== 'string') return 0;
    const next = swap(holder[key]);
    if (next.count) holder[key] = next.text;
    return next.count;
}

const sourceSide = names => text => swapName(text, names.source[0], names.source[1]);
const shownSide = names => text => swapName(text, names.shown[0], names.shown[1]);
const list = value => (Array.isArray(value) ? value : []);

/** 새 자리(chat_metadata.story_translation)의 사람, 사람이 아닌 이름, 규칙, 뺀 이름 */
function renameLayer(layer, names) {
    if (!layer || layer.v !== 1) return 0;
    let count = 0;
    const both = text => swapBoth(text, names);
    for (const person of list(layer.people)) {
        list(person.names).forEach((_, i) => { count += swapField(person.names, i, sourceSide(names)); });
        count += swapField(person, 'ko', shownSide(names)) + swapField(person, 'style', both);
        for (const to of list(person.to)) count += swapField(to, 'style', both);
    }
    for (const name of list(layer.names)) count += swapField(name, 'src', sourceSide(names)) + swapField(name, 'dst', shownSide(names));
    for (const rule of list(layer.rules)) count += swapField(rule, 'text', both);
    list(layer.ignore).forEach((_, i) => { count += swapField(layer.ignore, i, sourceSide(names)); });
    return count;
}

/** 옛 자리의 말투, 용어, 상태창 번역 기록(새 자리가 비어 있는 채팅은 아직 여기서 읽는다) */
function renameOldKeys(meta, names) {
    let count = 0;
    const both = text => swapBoth(text, names);
    for (const profile of list(meta.llmt_style_profiles_v1)) for (const key of ['speaker', 'listener', 'note']) count += swapField(profile, key, both);
    for (const term of list(meta.llmt_chat_glossary_v1)) count += swapField(term, 'src', sourceSide(names)) + swapField(term, 'dst', shownSide(names));
    const lines = meta.llmt_screen_cache;
    if (!lines || typeof lines !== 'object') return count;
    // 상태창 번역 기록은 원문 줄이 열쇠다: 열쇠는 원문 쪽 이름으로, 값은 번역문 쪽 이름으로
    for (const [key, value] of Object.entries(lines)) {
        const nextKey = sourceSide(names)(key), nextValue = typeof value === 'string' ? both(value) : { text: value, count: 0 };
        if (!nextKey.count && !nextValue.count) continue;
        delete lines[key];
        lines[nextKey.text] = nextValue.text;
        count += nextKey.count + nextValue.count;
    }
    return count;
}

// 이름을 바꿔도 되는 글이 아닌 칸(다른 것을 가리키는 값)
const POINTER_KEYS = new Set(['id', 'scope', 'avatar', 'owner', 'file', 'uid', 'hash']);
const FILE_NAME = /^[^\s]+\.(png|jpe?g|webp|gif|json|jsonl)$/i;

/** 다른 기능이 이 채팅에 적어 둔 기록 속의 글을 전부 바꾼다(칸 이름과 다른 것을 가리키는 값은 두고) */
function renameDeep(node, names) {
    if (!node || typeof node !== 'object') return 0;
    let count = 0;
    for (const [key, value] of Object.entries(node)) {
        if (!Array.isArray(node) && POINTER_KEYS.has(key)) continue;
        if (typeof value === 'string') { if (!FILE_NAME.test(value)) count += swapField(node, key, text => swapBoth(text, names, 'source')); }
        else count += renameDeep(value, names);
    }
    return count;
}

// 이 채팅의 기록 가운데 같이 바꾸는 열쇠(되돌릴 때 이 열쇠들만 되돌린다)
export const META_KEYS = ['story_translation', 'llmt_style_profiles_v1', 'llmt_chat_glossary_v1', 'llmt_screen_cache', 'story_memory', 'long_memory'];

/** 이 채팅에 적힌 사람 목록과 기록들의 이름을 바꾼다(제자리에서). @returns {number} 바꾼 곳 수 */
export function renameMeta(meta, names) {
    if (!meta || typeof meta !== 'object') return 0;
    return renameLayer(meta.story_translation, names) + renameOldKeys(meta, names)
        + renameDeep(meta.story_memory, names) + renameDeep(meta.long_memory, names);
}

// ── 채팅 전체와 되돌리기 ──

/**
 * 채팅 전체를 바꾼다. 바뀐 메시지와 기록의 바꾸기 전 사본을 돌려준다(되돌리기용).
 * @returns {{ texts: number, records: number, before: { messages: Map<number, object>, meta: Record<string, any> } }}
 */
export function renameChat(chat, meta, names, tools) {
    const before = { messages: new Map(), meta: {} };
    let texts = 0;
    chat.forEach((message, index) => {
        if (!message || typeof message !== 'object') return;
        const copy = structuredClone(message), count = renameMessage(message, names, tools);
        if (count) before.messages.set(index, copy);
        texts += count;
    });
    for (const key of META_KEYS) before.meta[key] = meta?.[key] === undefined ? undefined : structuredClone(meta[key]);
    return { texts, records: renameMeta(meta, names), before };
}

/**
 * 되돌린다. 채팅을 다시 불러온 뒤라 메시지 객체가 새것이니 번호와 보낸 시각으로 찾는다.
 * @returns {number} 그사이 바뀌어 되돌리지 못한 메시지 수
 */
export function restoreChat(chat, meta, before) {
    let missed = 0;
    for (const [index, old] of before.messages) {
        if (chat[index]?.send_date === old.send_date) chat[index] = old; else missed++;
    }
    for (const [key, value] of Object.entries(before.meta)) {
        if (value === undefined) delete meta[key]; else meta[key] = value;
    }
    return missed;
}
