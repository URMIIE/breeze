// 사람(이름 · 한글 표기 · 말투). 글만 다룬다. 저장은 store 가 한다.
//
// 한 사람: { id, names: ['Alex', 'Al'], ko: '알렉스', gender: '', style: '말투 글', to: [{ who: 사람 id, style: '글' }] }
//   names 는 원문에 나오는 표기들. ko 는 번역에 쓰는 한글 표기(없으면 모델이 정한다). style 은 자유 글.

import { fold, plain, occurs } from './find.js';

/** 성까지 적은 라틴 이름(Alex Kim)의 앞 이름. 본문에는 이름만 나오는 일이 흔하다 */
const given = name => {
    const parts = String(name).trim().split(/\s+/);
    return parts.length > 1 && /^\p{Script=Latin}{3,}$/u.test(parts[0]) ? parts[0] : '';
};

/**
 * 표기 → 그 표기의 주인. 두 사람이 같이 쓰는 표기는 누구인지 알 수 없어 뺀다.
 * 앞 이름은 한 사람만 가질 때 그 사람의 표기로 본다.
 */
function owners(people) {
    const map = new Map();
    const add = (key, person) => { if (key) map.set(key, map.has(key) && map.get(key) !== person ? null : person); };
    for (const p of people) for (const name of [...(p.names || []), p.ko]) add(fold(name), p);
    const firsts = new Map();
    for (const p of people) for (const name of p.names || []) {
        const key = fold(given(name));
        if (key && !map.has(key)) firsts.set(key, firsts.has(key) && firsts.get(key) !== p ? null : p);
    }
    for (const [key, p] of firsts) map.set(key, p);
    return map;
}

// 짝 기록에 적는 사람: 사람 목록에 있는 사람은 '@' + 사람 id(이름을 바꿔도 기록을 고쳐 쓸 일이 없다), 없는 사람은 모델이 적은 이름 그대로.
// 옛 기록(이름 글자)도 그대로 읽는다: '@' 로 시작하지 않는 것은 이름이다
export const ID_MARK = '@';
/** 이름 → 기록에 적을 것(사람 목록에 있으면 '@id') */
export const recordOf = (people, name) => { const p = name ? resolve(people, name) : null; return p ? `${ID_MARK}${p.id}` : name; };
/** 기록에 적힌 것 → 화면 이름(사람 id 면 그 사람의 한글 표기, 없으면 첫 원문 이름. 지금 목록에 없는 id 는 '') */
export const shownOf = (people, who) => {
    const text = String(who ?? '');
    if (!text.startsWith(ID_MARK)) return text;
    const p = (people || []).find(x => x.id === text.slice(ID_MARK.length));
    return p ? (p.ko || p.names?.[0] || '') : '';
};

/** 이름(원문 표기든 한글 표기든)으로 사람을 찾는다. 없거나 둘 이상이면 null */
export function resolve(people, name) {
    return owners(people).get(fold(name)) || null;
}

/**
 * 이 요청에 넣을 사람들.
 * always(캐릭터 · 페르소나)는 글에 이름이 없어도 늘 넣는다(You 로만 쓰인 답에서도 누구인지 알게).
 * 그 밖은 texts(이 답 · 바로 앞 답)에 이름이 나올 때만(그래서 따로 수를 자르지 않는다), 넘겨준 차례대로.
 */
export function pick(people, { always = [], texts = [] } = {}) {
    const hay = texts.map(plain).join('\n'), byName = owners(people), named = new Set();
    for (const [key, person] of byName) if (person && occurs(hay, key, { strict: true })) named.add(person);
    const first = people.filter(p => always.includes(p.id));
    const rest = people.filter(p => !always.includes(p.id) && named.has(p));
    return [...first, ...rest];
}

// 사용자가 적은 말투 글은 줄이지 않는다(줄바꿈만 한 칸으로): 잘린 지시는 틀린 지시가 된다
const oneLine = text => String(text ?? '').replace(/\s+/g, ' ').trim();

/**
 * 사람 한 줄: Alex (Al) = 알렉스; female; 말투 글; to B: 말투 글
 * @param {(id: string) => string} [nameOf] 상대 사람 id → 줄에 적을 이름(요청의 사람 표에 있으면 그 글자)
 */
export function line(person, people = [], nameOf = id => { const p = people.find(x => x.id === id); return p ? (p.ko || p.names?.[0] || '') : String(id ?? ''); }) {
    const [main, ...aliases] = person.names?.length ? person.names : [person.ko];
    const parts = [`${main}${aliases.length ? ` (${aliases.join(', ')})` : ''}${person.ko && person.ko !== main ? ` = ${person.ko}` : ''}`];
    if (person.gender) parts.push(person.gender);
    if (person.style) parts.push(`speaks: ${oneLine(person.style)}`);
    for (const t of person.to || []) if (t?.style && nameOf(t.who)) parts.push(`to ${nameOf(t.who)}: ${oneLine(t.style)}`);
    return parts.join('; ');
}

// 사람 표의 글자: 이 요청에서만 쓰는 이름표. 답의 문단 머리 ¶n{A} 로 돌아온다(core/reply.js).
// 이름을 한글로 적게 하면 표기가 흔들려(호칭 · 조사가 붙거나 다른 표기) 누구인지 다시 찾다 놓쳤다. 글자는 흔들리지 않는다.
// I · O 는 뺀다: 영어 본문의 I, 숫자 0 과 헷갈린다.
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const letterAt = i => LETTERS[i] ?? `P${i + 1}`;

export const BLOCK_HEAD = '[People]';
const PEOPLE_RULE = [
    'Names: write each person as given after "=", every time. A name that changes reads as a different person. Where no "=" is given, choose one Korean spelling and keep it.',
    'Speech: "speaks" is how that person talks in their own lines. "to X" is how they talk to X, and wins over "speaks". Keep it steady through the whole text; if the source shows the relationship has changed, follow the source.',
].join('\n');
// 위 마지막 문장: 적어 둔 말투 때문에 사이가 바뀐 뒤에도 옛 말투로 번역된 일이 있었다(연인이라 서로 반말 → 초면이 된 뒤에도 반말). 적어 둔 말투는 기본이고, 원문에서 사이가 분명히 바뀌었으면 원문을 따르게 한다

/** 사람 묶음: 고른 사람마다 한 줄. withLetters 면 줄 앞에 글자(list 의 차례가 글자 차례다: letters 와 같은 차례), 상대도 표에 있으면 글자로 */
export const block = (list, people = list, { withLetters = true } = {}) => {
    if (!list.length) return '';
    const shown = id => { const p = people.find(x => x.id === id); return p ? (p.ko || p.names?.[0] || '') : String(id ?? ''); };
    const nameOf = id => { const at = list.findIndex(p => p.id === id); return withLetters && at >= 0 ? letterAt(at) : shown(id); };
    const rows = list.map((p, i) => (withLetters ? `${letterAt(i)}: ` : '') + line(p, people, nameOf));
    return `${BLOCK_HEAD}\n${rows.join('\n')}\n${PEOPLE_RULE}`;
};

/** 이 요청의 글자 → 사람(block 과 같은 차례) */
export const letters = list => new Map(list.map((p, i) => [letterAt(i), p]));

/**
 * 사람 묶음 글에서 글자 → 그 줄의 첫 원문 이름을 읽는다(사람 목록을 넘겨받지 못한 쪽이 답의 글자를 이름으로 풀 때).
 * block 이 쓴 꼴만 읽는다.
 */
export function lettersOfBlock(text) {
    const out = new Map();
    const at = String(text ?? '').indexOf(`${BLOCK_HEAD}\n`);
    if (at < 0) return out;
    for (const row of String(text).slice(at + BLOCK_HEAD.length + 1).split('\n')) {
        const hit = /^([A-Z]|P\d+): ([^;(=]+?)(?: \(| = |;|$)/.exec(row);
        if (hit) out.set(hit[1], hit[2].trim());
        else break;
    }
    return out;
}

// ── 원문의 이름표 줄 ──  이름 | "대사"
const LABEL = /^[\t >*_]*([^\s|"“”「『][^|\n"“”「『]{0,39}?)[\t *_]*\|[\t *_]*["“「『]/;
const QUOTE = /["“「『]/;

// 이름 자리에 문장이 온 줄은 이름표가 아니다(설명 글 속의 `이름 | "대사"` 예시 · 번호 매긴 줄). 실제 이름표의 이름은 낱말 셋 이하이고 문장 부호가 없다
const NOT_A_NAME = /[`,，、。:：(（)）!?！？;；]|^\d+[.)]|^[-*#]/;
export const labelOf = text => {
    const name = LABEL.exec(String(text ?? ''))?.[1].trim() || '';
    return name && !NOT_A_NAME.test(name) && name.split(/\s+/).length <= 3 ? name : '';
};

/** 조각 원문의 이름표에서 읽은 말하는 이들(요청 없이 안다) */
export function labeled(src) {
    const out = new Set();
    for (const l of String(src ?? '').split('\n')) { const name = labelOf(l); if (name) out.add(name); }
    return [...out];
}

/** 모델에게 대사 주인을 적게 할 필요가 있나: 따옴표가 든 줄 가운데 이름표가 없는 줄이 하나라도 있으면 */
export function needsMarks(bodies) {
    return bodies.some(body => String(body ?? '').split('\n').some(l => QUOTE.test(l) && !labelOf(l)));
}
