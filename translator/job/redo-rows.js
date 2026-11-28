// 다시 번역 판에 줄 자료 만들기: 번역문의 문단마다 짝 원문 자리, 대사인지, 누가 말했는지.
//
// 짝은 번역할 때 메시지에 적어 둔 기록(store/pairs.js)으로 찾는다. 기록이 없거나 원문이 번역할 때와 다르면(예전 번역)
// 원문과 번역의 문단 수가 같을 때만 차례대로 짝짓고, 누가 말했는지는 이름으로 짐작한다(guessed).
// 문단 수도 다르면 고를 문단을 내놓지 않는다: 일부만 갈아 끼우다 엉뚱한 문단을 바꿀 수 있다(글 전체만 된다).

import { split } from '../core/split.js';
import { labelOf, resolve, ID_MARK, shownOf } from '../core/people.js';
import { fold, plain, occurs } from '../core/find.js';
import { match } from '../store/pairs.js';
import { withoutHeld } from '../rules/hold.js';

/** 글을 엔진 · 짝 기록과 같은 덩이(빈 줄 · 태그만 있는 줄에서 나뉜 것)로 자른다. 빈 줄 덩이는 뺀다 */
export function paragraphs(text, hold = []) {
    const out = [];
    let at = 0;
    for (const piece of split(text, { hold })) {
        if (piece.kind !== 'gap' && piece.src.trim()) out.push({ start: at, end: at + piece.src.length, body: piece.src });
        at += piece.src.length;
    }
    return out;
}

const QUOTE = /["“”„‟「」『』«»]/;
const STARTS = /^\s*(?:[^"“”„‟「」『』«»\n]{1,40}[|:：]\s*)?["“„「『«]/;
const KEY_LINE = /^\s*"[^"\n]{1,40}"\s*[:：]/;
const letters = text => (text.match(/[\p{L}\p{N}]/gu) || []).length;

/**
 * 대사 문단인가. 따옴표가 한 글자라도 있으면 대사로 치면 따옴표로 낱말을 인용한 설명 덩이나 "이름": "값" 꼴의 자료 줄까지 올라왔다.
 * 대사로 보는 것: 줄이 따옴표로 시작하거나(앞에 짧은 이름표 `이름 | ` · `이름: ` 는 됨), 따옴표 안의 글이 문단 글자의 30% 이상.
 */
export function isSaid(text) {
    const lines = String(text ?? '').replace(/<[^>]*>/g, '').split('\n').filter(line => !KEY_LINE.test(line));
    const body = lines.join('\n');
    if (!QUOTE.test(body)) return false;
    if (lines.some(line => STARTS.test(line))) return true;
    const quoted = [...body.matchAll(/["“„「『«]([^"“”„‟「」『』«»\n]+)["”‟」』»]/g)].reduce((sum, m) => sum + letters(m[1]), 0);
    return quoted > 0 && quoted >= letters(body) * 0.3;
}

/** 기록의 이름(원문 표기일 수 있음) → 보여 줄 이름: 사람 목록의 한글 표기 → 그 문단 번역의 이름표 → 그대로 */
function shownName(name, people, label) {
    if (String(name).startsWith(ID_MARK)) return shownOf(people, name);
    const person = resolve(people, name);
    if (person?.ko) return person.ko;
    return label || person?.names?.[0] || name;
}

/** 이름이 낱말로 처음 나오는 자리(core/find.js occurs 와 같은 판정: Me 가 Come 에 걸리지 않게). 없으면 -1 */
function firstAt(hay, name) {
    const probe = fold(name);
    if (!probe) return -1;
    for (let at = hay.indexOf(probe); at >= 0; at = hay.indexOf(probe, at + 1)) {
        if (occurs(hay.slice(Math.max(0, at - 1), at + probe.length + 1), name, { strict: true })) return at;
    }
    return -1;
}

/** 글에서 가장 먼저 나오는 알려진 이름(기록 없는 예전 번역의 짐작: 이름 | "대사" 꼴이면 말하는 사람) */
function firstName(texts, names) {
    let best = '', bestAt = Infinity;
    for (const hay of texts.map(plain)) {
        for (const name of names) {
            const at = firstAt(hay, name);
            if (at >= 0 && at < bestAt) { bestAt = at; best = name; }
        }
    }
    return best;
}

/** 기록으로 짝을 찾은 문단들 */
function fromRecord(saved, found, ctx) {
    const paraUnit = [];
    saved.units.forEach(([from], u) => { if (from >= 0) paraUnit.push(u); });
    return found.translation.map((part, at) => {
        const s = found.map[at], unit = s >= 0 ? paraUnit[s] : -1;
        if (unit < 0) return null;
        const src = found.source[s], info = saved.units[unit][3];
        const sent = [withoutHeld(src.body, ctx.hold), withoutHeld(part.body, ctx.hold)];
        const fixed = Boolean(info?.[2]), names = (info?.[0] || []).filter(Boolean);
        const label = names.length === 1 && !fixed ? labelOf(sent[1].split('\n').find(l => l.trim()) || '') : '';
        const who = names.map(name => (fixed ? name : shownName(name, ctx.people, label)));
        return { at, unit, part, src, said: Boolean(info) || sent.some(isSaid), who, fixed, doubt: Boolean(saved.doubt?.includes(unit)), lead: sent[0].trim(), text: sent[1].trim() };
    }).filter(Boolean);
}

/** 기록 없이: 문단 수가 같을 때만 차례대로 */
function fromCount(source, translation, ctx) {
    const src = paragraphs(source, ctx.hold), out = paragraphs(translation, ctx.hold);
    if (!src.length || src.length !== out.length) return null;
    return out.map((part, at) => {
        const sent = [withoutHeld(src[at].body, ctx.hold), withoutHeld(part.body, ctx.hold)];
        const said = sent.some(isSaid), who = said ? firstName(sent, ctx.names) : '';
        return { at, unit: -1, part, src: src[at], said, who: who ? [who] : [], fixed: false, lead: sent[0].trim(), text: sent[1].trim() };
    });
}

/**
 * @param {object} message
 * @param {{ source: string, translation: string, hold: RegExp[], people: object[], names: string[] }} ctx
 *   source = 매크로를 푼 원문, people = core/people.js 의 사람들, names = 짐작에 쓸 이름(사람 표기 · 캐릭터 · 페르소나)
 * @returns {{ rows: object[], guessed: boolean, even: boolean }} even = 고를 문단을 내놓을 수 있나
 */
export function readRows(message, ctx) {
    const saved = message?.extra?.llmt_pairs;
    const found = ctx.translation ? match(saved, ctx.source, ctx.translation, ctx.hold) : null;
    if (found) return { rows: fromRecord(saved, found, ctx), guessed: false, even: true };
    const rows = ctx.translation ? fromCount(ctx.source, ctx.translation, ctx) : null;
    return rows ? { rows, guessed: true, even: true } : { rows: [], guessed: false, even: false };
}
