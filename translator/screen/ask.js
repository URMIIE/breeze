// 상태창 · 카드의 짧은 글 여러 개를 번역해 달라고 묻는다. 글만 다룬다: 보내는 함수는 넘겨받는다.
// 본문 번역과 같은 방식을 쓴다(번호 붙이기 · 받는 대로 풀기 · 맞게 온 것만 살리기 · 출력 한도에 맞춰 나누기). 두 번째 방식을 따로 두지 않는다.

import { build, groups, PLAIN_SHAPE } from '../core/request.js';
import { feed, finish } from '../core/reply.js';
import { sourceLanguage } from '../core/lang.js';

const LANG = { en: 'English', zh: 'Chinese', ja: 'Japanese' };

/** 옮기는 법: 화면에 쓰이는 짧은 글이라는 것과, 지켜야 할 표시 둘({0} 자리 · ⟪n⟫ 조각 표시) */
export const method = lang => `You are translating the on-screen text of a roleplay character card from ${LANG[lang] || 'its original language'} into Korean: status panels, phone screens, menus, buttons, labels, short notices and messages.

Write what a Korean app or game screen would show: short and natural. A label stays a label, a sentence stays a sentence. Do not add or drop punctuation, emoji, numbers or symbols.
Write names as the people list and glossary below give them. A name that is not listed is written in Hangul by its sound.
{0}, {1} are slots where the screen puts a value later. Keep each slot exactly as it is, placed where it reads naturally in Korean.
Some passages are one line of the screen cut into pieces, each piece starting with a marker like ⟪1⟫. Translate the line as a whole, then give each piece its part: every marker appears exactly once, followed by that piece's Korean. Pieces may change order when Korean word order needs it. Never merge two pieces into one or leave a piece empty.`;

/** 본문 요청에 같이 실어 보낼 때 붙이는 안내: 어느 번호가 화면 글자인지와 지킬 표시 */
//   조각 표시 규칙은 따로 물을 때의 옮기는 법(위 method 의 마지막 문장)과 같게: 조각마다 한 번, 차례는 바꿔도 됨, 합치거나 비우지 않음
export const TOGETHER_NOTE = (from, to) => `Passages ${from} to ${to} are on-screen text of the character card (buttons, headers, short labels), not story: translate each as short UI text, no braces. Keep each {0} slot exactly. A passage may be one screen line cut into pieces marked ⟪1⟫, ⟪2⟫: write every piece marker exactly once, followed by that piece's Korean; pieces may change order; never merge pieces or leave one empty.`;

/** 답의 꼴: 번호 표시만(대사 주인 표시는 본문에만 쓴다) */
export const SHAPE = PLAIN_SHAPE;

/**
 * @param {object} p
 * @param {string[]} p.units 번역할 글(조각 표시 ⟪n⟫ · 자리 {0} 이 든 것 포함)
 * @param {string} [p.people] 사람 묶음  @param {string} [p.terms] 용어 묶음
 * @param {(text: string, o: { fixed: string, onText: (raw: string) => void, signal?: AbortSignal }) => Promise<string>} p.send
 * @param {number} [p.outputTokens] 연결의 출력 한도(모르면 0: 한 번에 다 보냄)
 * @param {(index: number, text: string) => void} p.onUnit 글 하나의 답이 닫힐 때마다(받는 중에도)
 * @param {AbortSignal} [p.signal]
 * @returns {Promise<{ requests: number, got: number, missing: number[] }>} missing: 답이 안 온 글의 차례
 */
export async function ask({ units, people = '', terms = '', send, outputTokens = 0, onUnit, signal }) {
    const lang = sourceLanguage(units.join('\n')), got = new Set();
    let requests = 0;
    /** 글 묶음 하나를 보내고 답이 온 글을 넘긴다 */
    const sendGroup = async group => {
        const bodies = group.map(i => units[i].replace(/\s*\n\s*/g, ' '));
        const built = build({ method: method(lang), people, terms, bodies, shape: SHAPE });
        const take = (k, text) => { const i = group[k]; if (got.has(i) || !text) return; got.add(i); onUnit(i, text); };
        requests++;
        const raw = await send(built.text, { fixed: built.fixed, signal, onText: soFar => feed(soFar, bodies.length).forEach((p, k) => take(k, p.text)) });
        finish(raw, bodies.length).pieces.forEach((p, k) => { if (p) take(k, p.text); });
    };
    for (const group of groups(units, outputTokens, lang)) {
        if (signal?.aborted) break;
        // 답이 중간에 끊겨도 남은 글을 저절로 다시 보내지 않는다(받은 데까지만: decisions.md '끊기면 끊기는대로').
        //   못 받은 글은 missing 으로 돌려주고, 기록이 '물었지만 못 받은 글'로 적어 다음에 화면을 볼 때 다시 묻는다
        await sendGroup(group);
    }
    return { requests, got: got.size, missing: units.map((_, i) => i).filter(i => !got.has(i)) };
}
