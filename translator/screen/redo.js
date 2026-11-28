// 상태창 번역 목록에서 고른 줄을 다시 번역받는다. 글만 다룬다: 저장(store/status.js)과 보내는 함수는 넘겨받는다.
// 화면을 다시 읽지 않고 저장에 적힌 원문으로 묻는다: 화면에는 이미 옛 번역이 입혀져 있어, 새 번역이 올 때까지 그대로 보이게 하려는 것이다.
// 요청은 한 번이다(보내는 글이 출력 한도를 넘지 않는 한: screen/ask.js).

import { ask as askModel } from './ask.js';
import { fromOld } from '../store/carry.js';
import * as people from '../core/people.js';
import * as terms from '../core/terms.js';

/**
 * 같은 번역이 줄과 글 조각 양쪽에 든 쌍(store/status.js 의 목록에는 한 줄로 보인다)의 글 조각 쪽도 같이 표시한다.
 * 줄만 새 번역으로 바꾸면 글 조각 쪽에 옛 번역이 남아 목록에 줄이 하나 더 생긴다.
 * @returns {Map<string, string>} 줄 id → 쌍인 글 조각 id
 */
function markTwins(rec, asks) {
    const listed = new Set(rec.list().map(line => line.id)), asked = new Set(asks.map(a => a.id)), twins = new Map();
    for (const { id, text } of asks) {
        const twin = `s:${text}`;
        if (id.startsWith('l:') && !asked.has(twin) && !listed.has(twin) && rec.markRedo([twin]).length) twins.set(id, twin);
    }
    return twins;
}

/**
 * 다시 번역받기로 표시된 줄 전부(store/status.js markRedo 로 표시한 것)를 묻고, 받은 답을 저장에 적는다.
 * 답을 못 받았거나 쓸 수 없는 답이 온 줄은 표시만 풀고 옛 번역을 그대로 둔다. 직접 고친 줄은 새 번역을 받으면 직접 고침 표시가 풀린다.
 * @param {object} o
 * @param {object} o.rec store/status.js open 의 것
 * @param {(prompt: string, o: object) => Promise<string>} o.send 보내는 함수
 * @param {object} o.sources 사람 · 용어(screen/bridge.js oldSources 의 꼴)
 * @returns {Promise<{ asked: number, learned: number, put: { id: string, t: string | string[] }[] }>}
 *   asked 물은 줄 수, learned 새 번역으로 바뀐 줄 수, put 바뀐 기록(줄과, 쌍인 글 조각)과 그 번역
 */
export async function redoLines({ rec, send, sources }) {
    const asks = rec.redoAsks();
    if (!asks.length) return { asked: 0, learned: 0, put: [] };
    const twins = markTwins(rec, asks), got = new Set();
    const units = asks.map(a => a.text), joined = units.join('\n'), old = fromOld(sources);
    const cast = people.pick(old.people, { always: old.always, texts: [joined] });
    const onUnit = (i, value) => {
        const { id } = asks[i];
        if (rec.takeRedo(id, value) !== 'learned') return;
        got.add(id);
        if (twins.has(id)) rec.takeRedo(twins.get(id), value);
    };
    try {
        await askModel({
            units, send, outputTokens: sources.outputTokens, onUnit,
            people: people.block(cast, old.people), terms: terms.block(terms.pick(old.terms, joined)),
        });
    } finally {
        // 새 번역을 못 받은 줄: 보낸 글을 그대로 답으로 넣어 표시만 푼다(번역과 직접 고침 표시는 그대로 남는다)
        for (const { id, text } of asks) {
            if (!got.has(id)) rec.takeRedo(id, text);
            if (twins.has(id)) rec.takeRedo(twins.get(id), text);
        }
    }
    const now = new Map(rec.list().map(line => [line.id, line.pieces ?? line.text]));
    // 쌍인 글 조각도 같은 번역으로 바뀌었으므로 같이 알린다(화면에 입히는 쪽이 글 조각 기록도 쓴다)
    const changed = [...got].filter(id => now.has(id)).flatMap(id => [id, twins.get(id)].filter(Boolean).map(each => ({ id: each, t: now.get(id) })));
    return { asked: asks.length, learned: changed.filter(line => got.has(line.id)).length, put: changed };
}
