// 상태창 번역 엔진(screen/live.js)과 새 저장(store/status.js) · 새 사람 자료(store/layers.js) 사이에서 꼴을 맞춘다. 글만 다룬다.
// live.js 는 기록을 제 꼴(v: 1, screen/records.js)로 열고 닫고, 사람 · 용어를 옛 꼴(말투 지침 · 용어집)로 받는다.
// 그 파일은 고치지 않으므로 넘겨주는 값을 여기서 바꾼다: 새 저장 → 옛 꼴(읽을 때), 옛 꼴에서 새로 생긴 줄 → 새 저장(쓸 때).

import { keyOf } from './lines.js';
import { sentBodies } from '../core/refusal.js';
import { finish } from '../core/reply.js';

const openers = new WeakMap();   // 여는 손 → 캐릭터 열쇠마다 한 번만 여는 손

/**
 * 상태창 번역 저장을 여는 손(store/hands.js 의 status)을, 같은 캐릭터면 같은 기록을 돌려주게 감싼다.
 * 그 손은 부를 때마다 파일을 새로 읽어 새 기록을 만든다: 설정 판과 상태창 번역이 따로 열면 한쪽에서 고친 것을 다른 쪽이 모르고,
 * 나중에 저장한 쪽이 파일을 통째로 덮는다. 같은 손을 감싼 것끼리는 기록 하나를 나눠 쓴다.
 * @param {(key: string) => Promise<object>} status
 * @returns {(key: string) => Promise<object>}
 */
export function shared(status) {
    if (!openers.has(status)) {
        const byKey = new Map();
        openers.set(status, key => { if (!byKey.has(key)) byKey.set(key, status(key)); return byKey.get(key); });
    }
    return openers.get(status);
}

/**
 * 다시 번역받은 줄의 새 번역을 live.js 의 기록(v: 1)과, 그 기록과 주고받은 자료에 바로 적는다.
 * live.js 는 기록을 처음 한 번만 읽어 새 저장이 바뀐 것을 모른다. 주고받은 자료에도 적어 두어야
 * 다음 저장 때 이 줄이 '새로 생긴 줄'로 돌아와 원문 없이 다시 적히지 않는다(takeBack).
 * 줄은 손으로 고친 번역으로 적는다: live.js 의 기록에는 번역을 바꿔 적는 길이 그것뿐이다(그 표시는 새 저장으로 돌아오지 않는다).
 * @param {object} liveRec screen/records.js 꼴  @param {object | undefined} given toOld 의 꼴
 * @param {string} id 줄 열쇠('l:…#n' · 's:…')  @param {string | string[]} t 새 번역
 */
export function putRedone(liveRec, given, id, t) {
    if (id.startsWith('s:')) {
        liveRec.strings.set(id.slice(2), t);
        if (given?.strings) given.strings[id.slice(2)] = t;
        return;
    }
    const key = id.slice(2);
    liveRec.fix({ key: key.replace(/#\d+$/, ''), nodes: { length: Number(/#(\d+)$/.exec(key)?.[1] || 1) } }, t);
    if (given?.lines) given.lines[key] = t;
}

const same = (a, b) => (Array.isArray(a) || Array.isArray(b) ? JSON.stringify(a) === JSON.stringify(b) : a === b);

/**
 * 새 저장의 자료(v: 2) → live.js 가 여는 꼴(v: 1).
 * @param {{ rows?: Record<string, { t: any, hand?: number }> } | null} data store/status.js data() 의 값
 */
export function toOld(data) {
    const out = { v: 1, lines: {}, strings: {}, hand: [], tried: [] };
    for (const [id, row] of Object.entries(data?.rows ?? {})) {
        const isString = id.startsWith('s:'), key = isString ? id : id.slice(2);
        if (row.t == null) out.tried.push(key);
        else if (isString) out.strings[id.slice(2)] = row.t;
        else out.lines[key] = row.t;
        if (row.hand) out.hand.push(key);
    }
    return out;
}

/** 줄 열쇠('글자만#조각 수')와 원문으로 저장이 받는 줄 꼴을 만든다(원문을 모르면 빈 글) */
function lineOf(key, src) {
    const n = Number(/#(\d+)$/.exec(key)?.[1] || 1), pieces = Array.isArray(src) ? src : [src ?? ''];
    const nodes = Array.from({ length: n }, (_, i) => ({ nodeValue: pieces[i] ?? '' }));
    return { key: key.replace(/#\d+$/, ''), nodes, text: pieces.join(' ') };
}

/**
 * live.js 가 저장하라고 준 것(v: 1)에서 지난번 뒤로 새로 생기거나 바뀐 줄만 새 저장에 적는다.
 * @param {object} rec store/status.js open 의 것
 * @param {object} now live.js 가 준 자료  @param {object} before 지난번에 주고받은 자료(toOld 의 꼴)
 * @param {{ sources?: Map<string, string | string[]>, place?: (text: string) => object | undefined }} [o]
 *   sources: 줄 id → 원문(요청에 실어 보낸 글에서 모은 것). place: 원문이 있던 곳(store/status.js placer)
 * @returns {number} 적은 줄 수
 */
export function takeBack(rec, now, before, { sources = new Map(), place = () => undefined } = {}) {
    const srcText = src => (Array.isArray(src) ? src.join(' ') : src || '');
    const lineFor = key => { const src = sources.get(`l:${key}`); return { line: lineOf(key, src), from: place(srcText(src)) }; };
    let count = 0;
    for (const [key, t] of Object.entries(now?.lines ?? {})) {
        if (same(before?.lines?.[key], t)) continue;
        const { line, from } = lineFor(key);
        rec.learn(line, t, from); count++;
    }
    for (const [text, t] of Object.entries(now?.strings ?? {})) {
        if (before?.strings?.[text] === t) continue;
        rec.learnString(text, t, place(text)); count++;
    }
    const tried = new Set(before?.tried ?? []);
    for (const key of now?.tried ?? []) {
        if (tried.has(key)) continue;
        if (key.startsWith('s:')) rec.gaveUpString(key.slice(2), place(key.slice(2)));
        else { const { line, from } = lineFor(key); rec.gaveUp(line, from); }
        count++;
    }
    return count;
}

/**
 * 요청 글에 실린 줄들의 원문을 줄 id 로 모은다(live.js 의 기록에는 줄 원문이 없어서, 보낼 때 적어 둔다).
 * 조각이 여럿인 줄은 번호표(⟪n⟫)마다의 글 배열.
 * @param {string} prompt core/request.js build 의 글  @param {Map<string, string | string[]>} into
 */
export function noteSources(prompt, into) {
    for (const body of sentBodies(prompt)) {
        const pieces = [...body.matchAll(/⟪\d+⟫([^⟪]*)/g)].map(m => m[1].trim());
        if (pieces.length > 1) into.set(`l:${keyOf(pieces.join(''))}#${pieces.length}`, pieces);
        else if (keyOf(body)) into.set(`l:${keyOf(body)}#1`, body);
    }
    return into;
}

/**
 * 새 꼴의 사람 · 이름을 live.js 가 읽는 옛 꼴로 돌려 적는다(live.js 가 store/carry.js fromOld 로 다시 새 꼴로 읽는다).
 * 사람의 말투는 말투 지침 한 줄로, 누구에게 하는 말투는 듣는 이가 있는 지침으로, 한글 표기는 용어집 한 줄로 간다.
 * @param {object} o
 * @param {object[]} [o.people] core/people.js 꼴  @param {{ src: string, dst: string }[]} [o.names]  @param {{ name: string }[]} [o.cast] 캐릭터 · 페르소나
 * @returns {{ profiles: object[], glossary: object[], cast: object[], outputTokens: 0 }}
 *   outputTokens 0: 줄을 나누지 않고 한 번에 보낸다. 요청에 싣는 최대 출력 토큰은 보내기가 실린 줄의 길이로 정한다(send/room.js)
 */
export function oldSources({ people = [], names = [], cast = [] } = {}) {
    const field = person => (person.names ?? []).join(', '), byId = new Map(people.map(p => [p.id, p]));
    const profiles = [], spellings = [];
    for (const person of people) {
        if (!field(person)) continue;
        profiles.push({ speaker: field(person), mode: '', note: person.style ?? '' });
        for (const to of person.to ?? []) {
            const listener = byId.get(to.who);
            if (listener && to.style) profiles.push({ speaker: field(person), listener: field(listener), mode: '', note: to.style });
        }
        if (person.ko) spellings.push({ src: field(person), dst: person.ko });
    }
    const genderOf = name => people.find(p => (p.names ?? []).includes(name))?.gender || '';
    return {
        profiles, glossary: [...spellings, ...names.map(n => ({ src: n.src, dst: n.dst }))],
        cast: cast.map(c => ({ name: c.name, gender: genderOf(c.name) })), outputTokens: 0,
    };
}

/**
 * 답은 왔는데 그 안에 없던 글을 '물었지만 못 받은 글'로 적는다(live.js 는 원문 그대로 돌아온 글과 표시가 안 맞는 답만 적고,
 * 답에서 아예 빠진 글은 적지 않아서 그 글이 번역할 때마다 다시 나갔다). 나중에 번역이 오면 기록이 그 표시를 스스로 지운다.
 * 요청이 실패했을 때(답이 없음)는 부르지 않는다: 그때는 다음에 다시 묻는 것이 맞다.
 * @param {object} rec live.js 의 기록(screen/records.js 꼴)  @param {string} prompt 보낸 요청 글  @param {string} raw 받은 답
 * @param {number} [from] 요청의 몇째 조각부터 상태창 글인가(본문 요청에 같이 실어 보냈을 때: 앞쪽은 본문 문단이라 적지 않는다)
 * @returns {number} 적은 글 수
 */
export function markUnanswered(rec, prompt, raw, from = 0) {
    const bodies = sentBodies(prompt), pieces = finish(raw, bodies.length).pieces;
    let count = 0;
    bodies.forEach((body, k) => {
        if (k < from || pieces[k]) return;
        const marks = (body.match(/⟪\d+⟫/g) || []).length;
        // 번호표가 없는 글은 줄인지 글 조각인지 여기서 알 수 없어 양쪽에 적는다
        if (marks > 1) rec.gaveUp({ key: keyOf(body.replace(/⟪\d+⟫/g, '')), nodes: { length: marks } });
        else { rec.gaveUp({ key: keyOf(body), nodes: { length: 1 } }); rec.gaveUpString(body); }
        count++;
    });
    return count;
}
