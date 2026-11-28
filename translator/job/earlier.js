// 앞 대화 참고: 번역할 답 앞의 메시지 몇 개의 원문 끝부분.
// 프롬프트가 정한다: 프롬프트에 앞 대화 자리({{llmContext}})가 있을 때만 만들고, 프롬프트가 놓은 그 자리에 넣는다(자리 앞뒤에 쓴 설명 글과 맞물리게).
//   자리가 없는 프롬프트의 요청에는 앞 대화가 실리지 않는다. 앞 대화는 번역을 잘하게 하려는 재료라 자리를 다른 곳으로 옮기지 않는다(2026-11-26 사용자 결정).
// 개수와 조건은 옛 번역 확장의 설정 칸을 읽는다(contextOptions). 글만 다룬다: 채팅 배열을 넘겨받는다.
// 이미 번역된 대사는 붙이지 않는다(2026-11-26 사용자 결정): 사람마다의 말투와 표기는 사람 줄 · 이름 줄이 요청에 싣는다.
//
// 옛 번역기에서 옮긴 판단:
//   끝부분만 넣는다: 답을 통째로 넣었더니 긴 답 둘이 요청의 80%(7만 자)였다(2026-11-07). 지칭과 이어지는 장면은 앞 답 끝에서 풀린다.
//   번역에 보내지 않는 글(생각 · 숨긴 블록 · 사용자 규칙)은 뺀다.
//   개수는 실제로 넣는 메시지의 수로 센다(시스템 메시지와, 내 글을 넣지 않을 때의 내 글을 빼고).
//   번역할 메시지의 앞에서 고른다(채팅 끝이 아니라): 옛 답을 번역할 때 뒤 이야기가 참고로 가지 않게.
//   자리에 글을 넣을 때 바꾸기 기호($' · $$)로 읽히지 않게 넣는다(fillSlot).

import { SETTINGS_KEY } from '../store/settings.js';

const SLOT = '{{llmContext}}';
const COUNT_DEFAULT = 5;         // 개수 칸이 빈 설정에서 쓰는 수(옛 번역 확장의 기본값: 그 칸을 한 번도 안 건드린 사람의 값과 같게)
const TAIL = 1200;               // 답 하나에서 넣는 끝부분 글자 수(옛 값, 근거는 위 2026-11-07)
const strip = (text, hold) => hold.reduce((s, rule) => s.replace(new RegExp(rule.source, rule.flags.includes('g') ? rule.flags : rule.flags + 'g'), ''), String(text ?? ''));

/** 끝부분: 문단 첫머리부터 TAIL 자 안쪽 */
function tailOf(text) {
    const clean = text.replace(/\n{3,}/g, '\n\n').trim();
    if (clean.length <= TAIL) return clean;
    const cut = clean.slice(-TAIL), at = cut.indexOf('\n\n');
    return at >= 0 && at < TAIL / 2 ? cut.slice(at + 2) : cut;
}

/** 프롬프트에 앞 대화 자리가 있나 */
export const hasSlot = prompt => String(prompt ?? '').includes(SLOT);

/** 프롬프트의 앞 대화 자리에 글을 넣는다(글을 안 주면 자리를 비운다) */
export const fillSlot = (prompt, text = '') => String(prompt ?? '').split(SLOT).join(text);

/**
 * 앞 대화의 개수와 조건: 옛 번역 확장의 설정 칸 그대로.
 * @returns {{ count: number, includeUser: boolean, excludeLast: boolean }}
 *   count 넣는 메시지 수 · includeUser 내가 쓴 글도 넣나 · excludeLast 번역할 메시지는 빼나(끄면 그 메시지까지 넣는다)
 */
export function contextOptions(extensionSettings) {
    const s = extensionSettings?.[SETTINGS_KEY] ?? {}, count = Math.floor(Number(s.context_message_count));
    return {
        count: count > 0 ? count : COUNT_DEFAULT,
        includeUser: s.context_include_user === true,
        excludeLast: s.context_exclude_last !== false,
    };
}

/** 넣을 메시지들: end 번째 앞에서 가까운 것부터 고른다(돌려줄 때는 가까운 것이 뒤) */
function previous(chat, end, { count, includeUser }) {
    const out = [];
    for (let i = Math.min(end, chat.length) - 1; i >= 0 && out.length < count; i--) {
        const m = chat[i];
        if (!m || m.is_system || (m.is_user && !includeUser)) continue;
        if (String(m.mes ?? '').trim()) out.unshift(m);
    }
    return out;
}

/**
 * @param {object[]} chat 실리태번 채팅 배열
 * @param {number} end 이 번호 앞의 메시지만 본다(번역할 메시지의 번호. 그 메시지까지 넣으려면 번호 + 1)
 * @param {RegExp[] | ((message: object) => RegExp[])} [hold] 번역에 보내지 않는 글의 규칙. 함수면 앞 답마다 그 답의 규칙을 받는다
 *   (화면에서 지워지는 블록은 답마다 글자가 달라 답마다 규칙이 다르다)
 * @param {{ count?: number, includeUser?: boolean }} [options] contextOptions 의 값
 * @returns {string} 프롬프트의 앞 대화 자리에 넣을 글('' 이면 앞 대화 없음): 메시지마다 원문 끝부분(가까운 메시지가 뒤)
 */
export function earlier(chat, end, hold = [], { count = COUNT_DEFAULT, includeUser = false } = {}) {
    const rulesOf = typeof hold === 'function' ? hold : () => hold;
    return previous(chat, end, { count, includeUser }).map(m => tailOf(strip(m.mes, rulesOf(m)))).filter(Boolean).join('\n\n');
}
