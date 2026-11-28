// 번역이 붙은 답의 원문이 바뀌었을 때 할 일. 글만 다룬다(화면 그리기와 저장은 부르는 쪽).
//
// 원문이 바뀌면(적어 둔 원문 해시가 지금 원문과 다르면) 붙어 있던 번역은 옛 글의 번역이다:
//   - 그림 표시만 바뀌었으면(그림 요청 태그 → 그림 태그) 번역문의 그 자리만 새 것으로 바꾸고 번역은 둔다.
//     그림만 바뀐 것인지는 번역을 붙였을 때의 원문을 알아야 가릴 수 있다. 이번에 화면을 연 뒤 붙인 번역만 안다.
//   - 그 밖에는 번역을 남긴다(사용자 결정 2026-11-28: 원문을 고쳐도 번역은 그대로, 문단을 지우면 그 번역도 지운다, store/pairs.js carry).
//     더한 문단은 원문 그대로 그 자리에 보이고, 요청은 저절로 보내지 않는다.
//   - 문단 기록이 없어 짝을 못 찾으면 옛 길대로 번역을 뗀다. 뗀 번역문과 문단 짝 기록은 여기 맡아 뒀다가, 다음 번역 때 글이 그대로인
//     문단의 번역으로 쓴다(그 문단은 다시 보내지 않는다). 맡아 두는 것은 화면이 떠 있는 동안뿐이다.

import { viewOf, translationOf, attach, detach, showOriginal } from './message.js';
import { reusable, dependsOf, mark, carry } from './pairs.js';
import { picturesOnly, swapPictures } from '../core/picture.js';

const attachedTo = new WeakMap();   // 메시지 → 번역을 붙였을 때의 원문
const taken = new WeakMap();        // 메시지 → 원문이 바뀌어 뗀 { text 번역문, pairs 문단 짝 기록 }

/** 번역이 붙었다: 그때의 원문을 적고, 맡아 둔 옛 번역은 버린다 */
export function noteAttached(message, source) {
    attachedTo.set(message, source);
    taken.delete(message);
}

/** 그림 표시만 바뀐 글이면 번역문의 그림 표시를 바꿔 다시 붙인다. @returns {boolean} 그렇게 했으면 true */
function keepWithNewPictures(message, source, hash) {
    const before = attachedTo.get(message);
    if (typeof before !== 'string' || viewOf(message) !== 'shown' || !picturesOnly(before, source)) return false;
    const text = swapPictures(message.extra.display_text, before, source);
    if (text === null) return false;
    // 문단 짝 기록은 원문 자리로 적혀 있어 그림 글자 수가 바뀌면 맞지 않는다
    attach(message, { text, pairs: null, hash });
    attachedTo.set(message, source);
    return true;
}

/**
 * 원문을 고쳤어도 번역을 남긴다(store/pairs.js carry). 보던 보기도 그대로: 원문을 보던 중이면 보이는 글만 새 원문으로.
 * 문단 기록이 없거나 옛 번역을 하나도 못 찾으면 false(옛 길대로 번역을 뗀다)
 */
function keepThrough(message, source, hash, hold) {
    const wasOriginal = viewOf(message) === 'original';
    const kept = carry(message.extra.llmt_pairs, translationOf(message), source, hold);
    if (!kept) return false;
    attach(message, { text: kept.text, pairs: kept.pairs, hash });
    if (wasOriginal) showOriginal(message, source);
    noteAttached(message, source);
    return true;
}

/**
 * 메시지가 바뀌었다는 신호가 왔을 때 부른다.
 * @param {object} message  @param {string} source 지금 원문(매크로를 푼 글)  @param {string} hash 지금 원문의 해시
 * @param {RegExp[]} [hold] 그 답의 뺄 글 규칙(문단을 번역할 때와 같은 덩이로 자르려고)
 * @returns {'same' | 'pictures' | 'kept' | 'detached'} same: 번역이 없거나 원문이 그대로 · pictures: 그림 표시만 바꿈 · kept: 번역을 남김(store/pairs.js carry) · detached: 번역을 떼어 맡아 둠
 */
export function sourceEdited(message, source, hash, hold = []) {
    const was = message?.extra?.original_text_hash;
    if (!message || viewOf(message) === 'none' || was === undefined || String(was) === String(hash)) return 'same';
    if (keepWithNewPictures(message, source, hash)) return 'pictures';
    if (keepThrough(message, source, hash, hold)) return 'kept';
    taken.set(message, { text: translationOf(message), pairs: message.extra.llmt_pairs ?? null });
    detach(message);
    return 'detached';
}

/**
 * 이 답을 번역할 때 그대로 쓸 번역: 문단 원문 지문 → { 번역 글, 그 조각에 걸린 것(짝 기록에 적혀 있으면) }.
 * 원문이 그대로면 null(그때 누른 번역은 새 번역을 받으려는 것이다). 번역문은 원문이 바뀌어 떼어 둔 것, 없으면 지금 붙어 있는 것.
 * 걸린 것은 엔진이 지금 설정과 견준다(job/engine.js fromPrior: 사람 · 말투 · 용어가 바뀐 문단은 그대로 쓰지 않는다).
 * @param {RegExp[]} hold 그 답의 뺄 글 규칙(번역문을 번역할 때와 같은 덩이로 자르려고)
 * @returns {Map<string, { text: string, depends?: any }> | null}
 */
export function priorFor(message, source, hold) {
    const kept = taken.get(message);
    const saved = kept?.pairs ?? message?.extra?.llmt_pairs, before = kept?.text ?? translationOf(message);
    if (!saved || !before || saved.s === mark(source)) return null;
    const prior = reusable(saved, before, hold), depends = dependsOf(saved);
    return prior.size ? new Map([...prior].map(([key, text]) => [key, { text, depends: depends.get(key) }])) : null;
}
