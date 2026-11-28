// 번역을 받는 동안 다 받은 문단(닫힌 문단)을 화면 쪽에 알리는 길. 화면은 이것으로 받은 문단부터 번역으로 바꿔 보여 준다(ui/message/live.js).
// 엔진은 고치지 않는다: 보내기 함수를 한 겹 싸서, 엔진이 보는 것과 같은 답 글에서 닫힌 문단을 같은 풀이(core/reply.js feed)로 읽는다.
// 알리는 것은 화면에 그리는 데만 쓴다. 듣는 쪽이 없거나 듣는 쪽에서 오류가 나도 번역 결과는 그대로다.
//
// 알림 꼴(id = 그 메시지의 번호, at = 번역에 보내는 문단 가운데 몇 번째인가)
//   { type: 'wait',  id, sources: string[], ats: number[] }  요청을 보냄. sources 보내는 문단들의 원문 전부, ats 이번 요청으로 기다리는 문단
//   { type: 'piece', id, at, text }                          그 문단을 다 받음
//   { type: 'end',   id }                                    번역이 끝남(붙었든 멈췄든 실패했든)

import { split, isSent } from '../core/split.js';
import { mask, unmask } from '../core/protect.js';
import { feed } from '../core/reply.js';
import { sentBodies } from '../core/refusal.js';
import { isKorean } from '../core/lang.js';

const listeners = new Set();

/** 닫힌 문단 알림을 듣는다. @returns 듣기를 그만두는 함수 */
export function onClosed(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function tell(event) {
    for (const listener of listeners) {
        try { listener(event); } catch (error) { console.warn('[번역] 받는 중 화면 그리기를 건너뛰었어요', error); }
    }
}

/** 보내는 문단들: 엔진이 원문을 나누고 가리는 것과 같은 방법으로(run/translate.js plan) */
function sentParagraphs(plan) {
    const pieces = split(plan.original, { hold: plan.hold, skip: plan.keepKorean ? isKorean : undefined }).filter(isSent);
    return pieces.map(piece => ({ src: piece.src, masked: mask(piece) }));
}

/** 요청에 실린 글마다 그것이 몇 번째 문단인지(같은 글이 두 번 있으면 차례대로). 문단이 아닌 글(같이 실어 보낸 다른 글)은 -1 */
function placesOf(bodies, paragraphs) {
    const used = new Set();
    return bodies.map(body => {
        const at = paragraphs.findIndex((p, i) => !used.has(i) && p.masked.body === body);
        if (at >= 0) used.add(at);
        return at;
    });
}

/**
 * 보내기 함수를 싸서, 답이 오는 동안 닫힌 문단을 알린다.
 * @param {(prompt: string, o: object) => Promise<string>} send
 * @param {object} plan job/run.js prepare 의 값
 * @param {() => number} idOf 지금 그 메시지의 번호(대상이 사라졌으면 -1: 알리지 않는다)
 */
export function tellClosed(send, plan, idOf) {
    if (!listeners.size) return send;
    const paragraphs = sentParagraphs(plan), sources = paragraphs.map(p => p.src);
    return (prompt, o = {}) => {
        const bodies = sentBodies(prompt), places = placesOf(bodies, paragraphs);
        let told = 0;
        const onText = raw => {
            o.onText?.(raw);
            const id = idOf(), closed = id < 0 ? [] : feed(raw, bodies.length);
            for (; told < closed.length; told++) {
                const at = places[told];
                if (at >= 0) tell({ type: 'piece', id, at, text: unmask(closed[told].text, paragraphs[at].masked).text });
            }
        };
        const id = idOf();
        if (id >= 0) tell({ type: 'wait', id, sources, ats: places.filter(at => at >= 0) });
        return send(prompt, { ...o, onText });
    };
}
