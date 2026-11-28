// 이 채팅에서 말한 사람들: 메시지마다 적어 둔 문단 짝 기록(extra.llmt_pairs)의 '누가 말했는지' 칸을 모은다.
// 대사 예시는 번역문에서 그 문단의 따옴표 든 한 줄. 글만 다룬다(채팅 배열을 넘겨받는다). 채팅 글을 밖으로 내보내지 않는다.

import { told, match } from './pairs.js';
import { translationOf } from './message.js';
import { fold, plain, occurs } from '../core/find.js';

const QUOTE = /["“”「」『』«»]/;
const SAID_MAX = 80;
const UNKNOWN = new Set(['', '?', '？']);

/** 문단에서 따옴표가 든 첫 줄(태그는 뺀다) */
function quoteLine(paragraph) {
    // 이름표(이름 | "대사")는 떼고 대사만
    const found = paragraph.replace(/<[^>]+>/g, '').split('\n').map(l => l.trim()).find(l => QUOTE.test(l)) ?? '';
    const line = found.replace(/^[^|"“「『\n]{1,40}\|\s*/, '');
    return line.length > SAID_MAX ? `${line.slice(0, SAID_MAX)}…` : line;
}

/**
 * @param {object[]} chat 실리태번 채팅 배열
 * @returns {Map<string, { name: string, lines: number, said: string }>} 접은 이름 → 적힌 이름, 대사 문단 수, 대사 예시(가장 최근 것)
 */
export function seenSpeakers(chat) {
    const out = new Map();
    for (let i = (chat?.length ?? 0) - 1; i >= 0; i--) {
        const m = chat[i], saved = m?.extra?.llmt_pairs;
        if (!saved || m.is_user || m.is_system) continue;
        const text = translationOf(m);
        for (const row of told(saved, text)) {
            for (const who of row.who) {
                if (UNKNOWN.has(String(who).trim())) continue;
                const key = fold(who), entry = out.get(key) ?? { name: String(who).trim(), lines: 0, said: '' };
                entry.lines++;
                if (!entry.said) entry.said = quoteLine(text.slice(row.start, row.end));
                out.set(key, entry);
            }
        }
    }
    return out;
}

// ── 번역에 나온 한글 이름이 누구의 표기인가 ──
// 한글 표기를 안 적어 둔 사람은 모델이 대사 주인을 글자(A) 대신 한글 이름({알렉스})으로 적는 일이 있다. 그 이름은 사람 목록의 어느 표기와도
// 같지 않아 '새 이름'으로 따로 섰다(같은 사람이 두 번 보임). 소리가 비슷한지로는 묶지 않는다(틀리게 묶으면 다른 사람의 말투가 섞인다).
// 근거는 번역할 때 적어 둔 문단 짝(원문 문단 ↔ 번역 문단)이다: 그 한글 이름이 든 번역 문단과 원문 이름이 든 원문 문단이 같은 짝으로 겹치는 정도.
// 겹침은 '둘 다 든 짝 ÷ 어느 한쪽이라도 든 짝'으로 잰다. 둘이 같이 나오는 장면이 많아서 '둘 다 든 짝'만 세면 상대 이름도 높게 나왔다
// (두 사람이 나오는 채팅: 한 사람의 한글 이름 ↔ 그 사람 0.63 · 상대 0.34, 다른 사람의 한글 이름 ↔ 그 사람 0.64 · 상대 0.40, 원문에 이름이 없는 인물의 한글 이름 ↔ 누구와도 0.01).

/** 묶는 기준: 겹침이 이만큼 넘고, 둘째로 높은 사람보다 이만큼 배로 높고, 둘 다 든 짝이 이만큼 있을 때만 */
const LINK_SHARE = 0.5, LINK_LEAD = 1.5, LINK_MIN_BOTH = 3;

/**
 * 원문에서 찾을 이름: 적힌 이름들과, 여러 낱말로 된 라틴 이름의 첫 낱말(원문은 'Alex Kim' 보다 'Alex' 로 더 자주 부른다).
 * 한자 한 글자 이름은 뺀다: 띄어 쓰지 않는 글이라 다른 낱말 속에도 들어 있어(森林 속의 林) 엉뚱한 한글 낱말이 그 사람에게 붙었다.
 */
function sourceNamesOf(person) {
    const names = (person.names ?? []).filter(name => name && !/^\p{Script=Han}$/u.test(name.trim()));
    const firsts = names.map(name => /^([A-Za-z][A-Za-z'’-]{2,})\s/.exec(name)?.[1]).filter(Boolean);
    return [...new Set([...names, ...firsts])];
}

/** 번역할 때 적어 둔 문단 짝들(원문 · 번역 문단을 접은 글로). 원문이 그때와 다른 답은 뺀다 */
function pairedParagraphs(chat, sourceOf) {
    const out = [];
    for (const m of chat ?? []) {
        const saved = m?.extra?.llmt_pairs;
        if (!saved || m.is_user || m.is_system) continue;
        const found = match(saved, sourceOf(m), translationOf(m));
        if (!found) continue;
        found.map.forEach((s, t) => { if (s >= 0) out.push([plain(found.source[s].body), plain(found.translation[t].body)]); });
    }
    return out;
}

/** 한 사람과 한 한글 이름의 겹침 { share, both } */
function overlap(pairs, sourceNames, spelling) {
    let both = 0, either = 0;
    for (const [src, out] of pairs) {
        const x = sourceNames.some(name => occurs(src, name, { strict: true })), y = occurs(out, spelling, { strict: true });
        if (x && y) both++;
        if (x || y) either++;
    }
    return { share: either ? both / either : 0, both };
}

/**
 * 번역에 나온 한글 이름 가운데, 한글 표기가 빈 사람의 표기로 볼 근거가 있는 것.
 * @param {object[]} chat 실리태번 채팅 배열
 * @param {{ id: string, names?: string[] }[]} people 후보(한글 표기가 빈 사람)
 * @param {string[]} spellings 볼 한글 이름
 * @param {(message: object) => string} sourceOf 그 답을 번역할 때 엔진에 준 원문(매크로를 푼 글)
 * @returns {Map<string, string>} 접은 한글 이름 → 사람 id
 */
export function spellingOwners(chat, people, spellings, sourceOf) {
    if (!people.length || !spellings.length) return new Map();
    return ownersFromPairs(pairedParagraphs(chat, sourceOf), people, spellings);
}

/**
 * 문단 짝(접은 원문, 접은 번역)들로 본 한글 이름의 주인(spellingOwners 의 속. 짝을 다른 데서 얻은 시험도 쓴다).
 * @param {[string, string][]} pairs  @returns {Map<string, string>} 접은 한글 이름 → 사람 id
 */
export function ownersFromPairs(pairs, people, spellings) {
    const out = new Map();
    for (const spelling of spellings) {
        const scored = people.map(person => ({ id: person.id, ...overlap(pairs, sourceNamesOf(person), spelling) })).sort((a, b) => b.share - a.share);
        const [best, next] = scored;
        if (best.both >= LINK_MIN_BOTH && best.share >= LINK_SHARE && best.share >= (next?.share ?? 0) * LINK_LEAD) out.set(fold(spelling), best.id);
    }
    return out;
}
