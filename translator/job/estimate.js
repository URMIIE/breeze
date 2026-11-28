// 번역에 드는 요청 수 어림. 엔진(run/translate.js)과 같게 조각내서 보낼 조각이 있는지 본다.
// 번역은 나눠 보내지 않으므로(job/engine.js) 보낼 조각이 하나라도 있으면 1, 없으면 0 이다.
// 답이 끊겨 이어 받는 요청과 원문 글이 남아 고쳐 받는 요청은 일어났을 때만 나가므로 여기서 세지 않는다.
// 진행 표시의 '이어서 (요청 n번)', 다시 번역 판의 '요청 n번', 채팅 전부 번역의 시작 전 어림이 같은 셈을 쓰게 여기 한 곳에 둔다.

import { split, isSent } from '../core/split.js';
import { isKorean } from '../core/lang.js';

/**
 * @param {{ original: string, hold: RegExp[], keepKorean?: boolean }} plan 번역 재료(job/run.js 의 prepare 꼴)
 * @param {(piece: object, index: number) => boolean} [only] 이 조각만 센다(못 받은 조각만 이어 받을 때, 기억에 없는 조각만 셀 때)
 * @returns {0 | 1} 보낼 조각이 없으면 0
 */
export function requestsFor(plan, only = () => true) {
    const pieces = split(plan.original, { hold: plan.hold, skip: plan.keepKorean ? isKorean : undefined });
    return pieces.some((piece, i) => isSent(piece) && only(piece, i)) ? 1 : 0;
}
