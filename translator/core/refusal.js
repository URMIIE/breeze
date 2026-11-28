// 답이 우리가 시킨 꼴로 왔는지 본다. 글만 다룬다.
//
// 거절 말투나 공급자의 차단 문구를 목록으로 알아보지 않는다: 모델 · 공급자마다 말이 달라 목록은 늘 모자라다.
// 대신 '번역이면 반드시 갖는 것이 있나'를 본다. 근거는 번역기가 스스로 보낸 꼴과 우리가 잰 길이 비뿐이다.
//   답 전체에 문단 머리가 하나도 없다 → 번역이 아닌 답(거절문이든 차단 문구든). 첫 줄을 까닭으로 보여 준다(사용자가 읽는다)
//   긴 원문 문단의 답이 아주 짧다 → 그 문단은 번역이 아니다(한두 줄 거절문). 그 문단만 빼고, 엔진이 '안 온 조각'으로 보고 원문 그대로 둔다
// 거절문이 번역으로 붙으면 기억에 들어가 다시 눌러도 같은 글이 붙는다. 그래서 빼는 쪽으로 둔다.

import { passages } from './reply.js';
export { sentBodies } from './request.js';

const letters = text => (String(text ?? '').replace(/<[^>]*>|\[\[__VAR_\d+__\]\]/g, '').match(/[\p{L}\p{N}]/gu) || []).length;

// 이만큼 긴 원문 문단만 길이로 본다(짧은 대사는 번역이 원문보다 아주 짧을 수 있다)
const LONG_SOURCE = 80;
// 번역 문단 글자 수 / 원문 문단 글자 수의 아래 끝. 이미 번역된 문단 짝 수만 개로 잼(원문 80자 이상 문단):
// 가장 짧은 비가 영어 0.143(19,094쌍) · 중국어 0.22(4,987쌍) · 일본어 0.186(1,763쌍).
// 그보다 조금 아래로 둔다: 잰 자료에서 맞는 번역을 번역 아님으로 본 문단이 0이다. 한국어를 다른 말로 옮기는 글(ko)은 보지 않는다
const FLOOR = { en: 0.12, zh: 0.2, ja: 0.16 };

/** 이 조각의 답이 번역이 아닌가(길이로만) */
export function tooShort(source, output, lang) {
    const floor = FLOOR[lang], src = letters(source);
    return Boolean(floor) && src >= LONG_SOURCE && letters(output) < src * floor;
}

/**
 * 머리가 하나도 없는 답이면 그 까닭(답의 첫 줄)을, 아니면 ''.
 * @param {string} raw 답 전체  @param {number} count 보낸 조각 수
 */
export function notAnAnswer(raw, count) {
    const text = String(raw ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    if (!text || !count || passages(text, count).length) return '';
    return text.split('\n').find(line => line.trim())?.trim().slice(0, 120) ?? '';
}

/**
 * 번역이 아닌 조각을 답에서 뺀다. 뺀 조각은 엔진이 '안 온 조각'으로 보고 원문 그대로 둔다.
 * @param {string} raw 지금까지 온 답  @param {string[]} bodies 보낸 조각 원문(번호 1 = bodies[0])  @param {string} lang 원문 언어
 * @param {boolean} final 답이 끝났나. 아직 오는 중이면 마지막 조각은 쓰는 중이라 보지 않는다
 * @returns {{ text: string, dropped: number[] }} dropped: 뺀 조각 번호(1부터)
 */
export function dropShort(raw, bodies, lang, final) {
    const lines = String(raw ?? '').split('\n');
    const found = passages(raw, bodies.length);
    const checked = final ? found : found.slice(0, -1);
    const gone = new Set(), dropped = [];
    checked.forEach((p, k) => {
        if (!tooShort(bodies[p.id - 1], p.lines.join('\n'), lang)) return;
        dropped.push(p.id);
        const end = found[k + 1]?.at ?? lines.length;
        for (let at = p.at; at < end; at++) gone.add(at);
    });
    if (!dropped.length) return { text: String(raw ?? ''), dropped };
    return { text: lines.filter((_, at) => !gone.has(at)).join('\n'), dropped };
}
