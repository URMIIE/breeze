// 옛 번역기의 자료(말투 지침 · 용어집)를 새 꼴로 읽는다. 읽기만 한다: 옛 자료는 고치지도 지우지도 않는다. 글만 다룬다.

import { fold, forms } from '../core/find.js';

const HANGUL_ONLY = /^[가-힣][가-힣 ·]*$/;
const MODE = { polite: '존댓말', casual: '반말' };
const styleOf = profile => [MODE[profile.mode] || '', String(profile.note ?? '').trim()].filter(Boolean).join(', ');

/**
 * @param {object} old
 * @param {{speaker: string, listener?: string, mutual?: boolean, mode: string, note?: string}[]} [old.profiles] 옛 말투 지침(이름 칸은 쉼표로 별칭)
 * @param {{src: string, dst: string}[]} [old.glossary] 지금 쓰이는 용어집 항목(범위 차례대로 고른 것)
 * @param {{name: string, gender?: string}[]} [old.cast] 캐릭터(그룹이면 참가자들)와 페르소나. 늘 사람으로 넣는다
 * @returns {{ people: object[], terms: {src: string, dst: string}[], always: string[] }}
 *   people: 새 사람 줄. terms: 사람 이름이 아닌 용어집 항목. always: 요청에 늘 넣을 사람 id(cast)
 */
export function fromOld({ profiles = [], glossary = [], cast = [] } = {}) {
    const book = registry();
    const always = addCast(book, cast);
    addProfiles(book, profiles);
    const terms = adoptGlossary(book, glossary);
    // 한글 이름으로만 적은 사람은 그 이름이 곧 표기다. 원문 이름과 한글 이름을 같이 적은 사람은 한글 이름을 표기로 삼지 않는다:
    //   별칭 칸의 한글 이름은 "이렇게도 불린다"일 뿐 "이렇게 옮겨라"가 아니다(다른 설정의 이름을 별칭으로 적어 둔 사람이 그 이름으로 바뀌어 번역됐다)
    for (const p of book.people) if (!p.ko && p.names.length && p.names.every(n => HANGUL_ONLY.test(n))) p.ko = p.names[0];
    return { people: book.people, terms, always };
}

/** 사람 모음: 이름 칸(쉼표로 별칭)을 주면 그 사람을 찾거나 새로 만든다 */
function registry() {
    const people = [], byKey = new Map();
    // 성까지 적은 이름(Alex Kim)과 앞 이름만 적은 이름(Alex)은 한 사람으로 본다. 그런 사람이 둘이면 누구인지 알 수 없어 묶지 않는다
    const first = name => {
        const parts = String(name).trim().split(/\s+/);
        return parts.length > 1 && /^\p{Script=Latin}{3,}$/u.test(parts[0]) ? fold(parts[0]) : '';
    };
    const near = name => {
        const key = fold(name), mine = first(name);
        const hits = people.filter(p => p.names.some(n => first(n) === key || (mine && fold(n) === mine)));
        return hits.length === 1 ? hits[0] : null;
    };
    const person = nameField => {
        const names = forms(nameField);
        if (!names.length) return null;
        let found = names.map(n => byKey.get(fold(n))).find(Boolean) || names.map(near).find(Boolean);
        if (!found) { found = { id: fold(names[0]), names: [], ko: '', gender: '', style: '', to: [] }; people.push(found); }
        for (const n of names) if (!byKey.has(fold(n))) { byKey.set(fold(n), found); found.names.push(n); }
        return found;
    };
    return { people, byKey, person };
}

/** 캐릭터 · 페르소나는 늘 사람으로 넣는다 → 요청에 늘 넣을 사람 id */
function addCast(book, cast) {
    const always = [];
    for (const member of cast) {
        const p = book.person(member?.name);
        if (!p) continue;
        if (member.gender && !p.gender) p.gender = member.gender;
        if (!always.includes(p.id)) always.push(p.id);
    }
    return always;
}

/** 옛 말투 지침 → 그 사람의 말투 글(듣는 이가 있으면 "누구에게" 줄, 서로 지침이면 양쪽에) */
function addProfiles(book, profiles) {
    for (const profile of profiles) {
        const speaker = book.person(profile.speaker), listener = profile.listener ? book.person(profile.listener) : null, style = styleOf(profile);
        if (!speaker || !style) continue;
        if (!listener) { speaker.style = style; continue; }
        speaker.to.push({ who: listener.id, style });
        if (profile.mutual) listener.to.push({ who: speaker.id, style });
    }
}

/** 용어집에서 사람 이름인 항목은 그 사람의 표기로 옮기고(원문 칸의 다른 표기는 별칭), 나머지를 용어로 돌려준다 */
function adoptGlossary(book, glossary) {
    const terms = [];
    for (const entry of glossary) {
        const sources = forms(entry?.src), targets = forms(entry?.dst);
        const owner = sources.map(s => book.byKey.get(fold(s))).find(Boolean);
        const isSpelling = owner && targets.length === 1 && HANGUL_ONLY.test(targets[0]);
        if (!isSpelling) {
            if (entry?.src && entry?.dst) terms.push({ src: entry.src, dst: entry.dst });
            continue;
        }
        if (!owner.ko) owner.ko = targets[0];
        for (const s of sources) if (!book.byKey.has(fold(s)) && !HANGUL_ONLY.test(s)) { book.byKey.set(fold(s), owner); owner.names.push(s); }
    }
    return terms;
}
